require('dotenv').config();
const fs = require('fs'), path = require('path');
const express = require('express'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const { Pool } = require('pg'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');

const { DATABASE_URL, JWT_SECRET, ADMIN_EMAIL = '' } = process.env;
if (!DATABASE_URL || !JWT_SECRET || JWT_SECRET.length < 24) {
  console.error('Set DATABASE_URL and a JWT_SECRET of at least 24 characters (see .env.example).');
  process.exit(1);
}
const db = new Pool({
  connectionString: DATABASE_URL,
  // No SSL for local or Railway private-network URLs; SSL for public hosts (Neon, Railway proxy).
  // Override with DB_SSL=true or DB_SSL=false if your database needs it.
  ssl: (process.env.DB_SSL ? process.env.DB_SSL === 'true'
    : !/localhost|127\.0\.0\.1|\.railway\.internal/.test(DATABASE_URL)) ? { rejectUnauthorized: false } : false,
});

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '50kb' }));

const ah = f => (req, res, next) => f(req, res, next).catch(next);
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const orderLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 40 });
const sign = u => jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const ngn = n => '₦' + n.toLocaleString('en-NG');
const money = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 100000000 ? n : null; };
const need = (...roles) => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').slice(7), JWT_SECRET); }
  catch { return bad(res, 'Please log in', 401); }
  if (roles.length && !roles.includes(req.user.role)) return bad(res, 'Not allowed', 403);
  next();
};

/* ---------- auth ---------- */
app.post('/api/auth/register', authLimit, ah(async (req, res) => {
  const b = req.body, v = b.vendor, email = String(b.email || '').trim().toLowerCase();
  if (!b.first || !b.last || !/^\S+@\S+\.\S+$/.test(email) || String(b.password || '').length < 8)
    return bad(res, 'Fill all required fields. Password needs at least 8 characters.');
  const wa = v ? String(v.whatsapp || '').replace(/\D/g, '') : '';
  if (v && (!String(v.shop || '').trim() || wa.length < 10 || wa.length > 15))
    return bad(res, 'Shop name and a valid WhatsApp number (e.g. 2348012345678) are required.');
  const role = email === ADMIN_EMAIL.trim().toLowerCase() ? 'admin' : v ? 'vendor' : 'buyer';
  const hash = await bcrypt.hash(String(b.password), 11);
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const u = (await c.query(
      'INSERT INTO users(first,last,email,password_hash,role,referral) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,first,role',
      [String(b.first).trim().slice(0, 60), String(b.last).trim().slice(0, 60), email, hash, role, String(b.referral || '').slice(0, 40)])).rows[0];
    if (v) await c.query(
      'INSERT INTO stores(owner_id,name,description,category,location,whatsapp) VALUES($1,$2,$3,$4,$5,$6)',
      [u.id, String(v.shop).trim().slice(0, 80), '', String(v.category || 'General').slice(0, 40), String(v.location || '').slice(0, 80), wa]);
    await c.query('COMMIT');
    res.json({ token: sign(u), user: { first: u.first, role: u.role } });
  } catch (e) {
    await c.query('ROLLBACK');
    if (e.code === '23505') return bad(res, 'That email is already registered', 409);
    throw e;
  } finally { c.release(); }
}));

app.post('/api/auth/login', authLimit, ah(async (req, res) => {
  const u = (await db.query('SELECT id,first,role,password_hash FROM users WHERE email=$1',
    [String(req.body.email || '').trim().toLowerCase()])).rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) return bad(res, 'Wrong email or password', 401);
  res.json({ token: sign(u), user: { first: u.first, role: u.role } });
}));

/* ---------- public catalogue ---------- */
app.get('/api/stores', ah(async (req, res) => {
  const q = '%' + String(req.query.q || '').toLowerCase() + '%', cat = String(req.query.cat || '');
  res.json((await db.query(
    `SELECT id,name,description,category,location,(image IS NOT NULL) AS img,image_v FROM stores
     WHERE status='approved' AND ($1='' OR category=$1)
     AND lower(name||' '||coalesce(description,'')||' '||category||' '||coalesce(location,'')) LIKE $2
     ORDER BY id DESC LIMIT 200`, [cat, q])).rows);
}));

app.get('/api/stores/:id', ah(async (req, res) => {
  const s = (await db.query("SELECT id,name,description,category,location,whatsapp,(image IS NOT NULL) AS img,image_v FROM stores WHERE id=$1 AND status='approved'", [req.params.id])).rows[0];
  if (!s) return bad(res, 'Store not found', 404);
  s.products = (await db.query('SELECT id,name,price,(image IS NOT NULL) AS img,image_v FROM products WHERE store_id=$1 AND active ORDER BY id', [s.id])).rows;
  res.json(s);
}));

/* ---------- orders: prices come from the database, never the browser ---------- */
app.post('/api/orders', orderLimit, ah(async (req, res) => {
  const { store_id, items, name, location } = req.body;
  if (!Array.isArray(items) || !items.length || items.length > 50) return bad(res, 'Your cart is empty');
  const s = (await db.query("SELECT id,name,whatsapp FROM stores WHERE id=$1 AND status='approved'", [store_id])).rows[0];
  if (!s) return bad(res, 'Store not available', 404);
  const ids = items.map(i => parseInt(i.product_id, 10)).filter(Number.isInteger);
  const ps = (await db.query('SELECT id,name,price FROM products WHERE store_id=$1 AND active AND id=ANY($2::int[])', [s.id, ids])).rows;
  let total = 0; const lines = [], snap = [];
  for (const i of items) {
    const p = ps.find(x => x.id === parseInt(i.product_id, 10)), q = Math.floor(Number(i.qty));
    if (!p || !(q >= 1 && q <= 100)) return bad(res, 'An item in your cart is no longer available');
    total += p.price * q; snap.push({ name: p.name, price: p.price, qty: q });
    lines.push(`- ${q} x ${p.name} (${ngn(p.price * q)})`);
  }
  const buyer = String(name || '').trim().slice(0, 80), loc = String(location || '').trim().slice(0, 160);
  await db.query('INSERT INTO orders(store_id,buyer_name,buyer_location,items,total) VALUES($1,$2,$3,$4,$5)',
    [s.id, buyer, loc, JSON.stringify(snap), total]);
  const text = [`Hello ${s.name}, I'd like to order from Ido-Osun Market:`, ...lines, `Total: ${ngn(total)}`,
    buyer && `Name: ${buyer}`, loc && `Delivery/pickup: ${loc}`].filter(Boolean).join('\n');
  res.json({ url: `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(text)}` });
}));

/* ---------- vendor dashboard ---------- */
const mine = `(SELECT id FROM stores WHERE owner_id=$1)`;
app.get('/api/vendor/store', need('vendor'), ah(async (req, res) => {
  const s = (await db.query('SELECT id,name,description,category,location,whatsapp,status,(image IS NOT NULL) AS img,image_v FROM stores WHERE owner_id=$1', [req.user.id])).rows[0];
  if (!s) return bad(res, 'No store found', 404);
  s.products = (await db.query('SELECT id,name,price,active,(image IS NOT NULL) AS img,image_v FROM products WHERE store_id=$1 ORDER BY id', [s.id])).rows;
  res.json(s);
}));

app.put('/api/vendor/store', need('vendor'), ah(async (req, res) => {
  const b = req.body, wa = String(b.whatsapp || '').replace(/\D/g, '');
  if (!String(b.name || '').trim() || wa.length < 10 || wa.length > 15) return bad(res, 'Shop name and a valid WhatsApp number are required.');
  await db.query('UPDATE stores SET name=$2,description=$3,category=$4,location=$5,whatsapp=$6 WHERE owner_id=$1',
    [req.user.id, String(b.name).trim().slice(0, 80), String(b.description || '').slice(0, 500), String(b.category || 'General').slice(0, 40), String(b.location || '').slice(0, 80), wa]);
  res.json({ ok: true });
}));

app.post('/api/vendor/products', need('vendor'), ah(async (req, res) => {
  const price = money(req.body.price), name = String(req.body.name || '').trim().slice(0, 100);
  if (!name || price === null) return bad(res, 'Enter a product name and a valid price');
  const r = await db.query(`INSERT INTO products(store_id,name,price) SELECT id,$2,$3 FROM stores WHERE owner_id=$1 RETURNING id`, [req.user.id, name, price]);
  r.rowCount ? res.json({ id: r.rows[0].id }) : bad(res, 'No store found', 404);
}));

app.put('/api/vendor/products/:id', need('vendor'), ah(async (req, res) => {
  const b = req.body, price = b.price === undefined ? null : money(b.price);
  if (b.price !== undefined && price === null) return bad(res, 'Invalid price');
  await db.query(`UPDATE products SET name=COALESCE($3,name),price=COALESCE($4,price),active=COALESCE($5,active)
    WHERE id=$2 AND store_id=${mine}`, [req.user.id, req.params.id, b.name ? String(b.name).slice(0, 100) : null, price, typeof b.active === 'boolean' ? b.active : null]);
  res.json({ ok: true });
}));

app.delete('/api/vendor/products/:id', need('vendor'), ah(async (req, res) => {
  await db.query(`DELETE FROM products WHERE id=$2 AND store_id=${mine}`, [req.user.id, req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/vendor/orders', need('vendor'), ah(async (req, res) => {
  res.json((await db.query(`SELECT id,buyer_name,buyer_location,items,total,created_at FROM orders
    WHERE store_id=${mine} ORDER BY id DESC LIMIT 100`, [req.user.id])).rows);
}));

/* ---------- photos (stored in Postgres; the browser shrinks them first) ---------- */
const jpeg = express.raw({ type: 'image/jpeg', limit: '400kb' });
const isJpeg = b => Buffer.isBuffer(b) && b.length > 4 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
app.put('/api/vendor/store/image', need('vendor'), jpeg, ah(async (req, res) => {
  if (!isJpeg(req.body)) return bad(res, 'Please upload a JPEG photo under 400 KB');
  await db.query('UPDATE stores SET image=$2, image_v=image_v+1 WHERE owner_id=$1', [req.user.id, req.body]);
  res.json({ ok: true });
}));
app.put('/api/vendor/products/:id/image', need('vendor'), jpeg, ah(async (req, res) => {
  if (!isJpeg(req.body)) return bad(res, 'Please upload a JPEG photo under 400 KB');
  const r = await db.query(`UPDATE products SET image=$3, image_v=image_v+1 WHERE id=$2 AND store_id=${mine}`, [req.user.id, req.params.id, req.body]);
  r.rowCount ? res.json({ ok: true }) : bad(res, 'Product not found', 404);
}));
const IMG = { store: 'stores', product: 'products' };
app.get('/img/:kind/:id', ah(async (req, res) => {
  const t = IMG[req.params.kind];
  const r = t && await db.query(`SELECT image FROM ${t} WHERE id=$1`, [req.params.id]);
  if (!r || !r.rows[0] || !r.rows[0].image) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(r.rows[0].image);
}));

/* ---------- admin ---------- */
app.get('/api/admin/stores', need('admin'), ah(async (req, res) => {
  res.json((await db.query(`SELECT s.id,s.name,s.category,s.location,s.whatsapp,s.status,u.email
    FROM stores s JOIN users u ON u.id=s.owner_id ORDER BY (s.status='pending') DESC, s.id DESC`)).rows);
}));

app.post('/api/admin/stores/:id/:action', need('admin'), ah(async (req, res) => {
  const st = { approve: 'approved', reject: 'rejected', suspend: 'suspended' }[req.params.action];
  if (!st) return bad(res, 'Unknown action');
  await db.query('UPDATE stores SET status=$2 WHERE id=$1', [req.params.id, st]);
  res.json({ ok: true });
}));

/* ---------- static site + errors ---------- */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => bad(res, 'Not found', 404));
app.use((e, req, res, next) => {
  if (e.code === '22P02') return bad(res, 'Invalid request');
  if (e.type === 'entity.too.large') return bad(res, 'That photo is too large. Try a smaller one.', 413);
  console.error(e); bad(res, 'Server error', 500);
});

(async () => {
  await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  app.listen(process.env.PORT || 3000, () => console.log('Ido-Osun Market running'));
})().catch(e => { console.error(e); process.exit(1); });
