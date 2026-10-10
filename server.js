require('dotenv').config();
const fs = require('fs'), path = require('path');
const express = require('express'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const { Pool } = require('pg'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const demo = require('./demo');
const webpush = require('web-push');
const crypto = require('crypto');
const mailer = require('./mailer');
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');   // e.g. https://market.example.com (used in email links)
const link = p => (APP_URL ? APP_URL + p : '');

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

// Web Push for vendor order notifications. Optional: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (see README).
let pushOn = false;
try {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:' + (ADMIN_EMAIL || 'admin@example.com'), process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    pushOn = true;
  }
} catch (e) { console.error('Push notifications disabled:', e.message); }
// Subscriptions are only accepted from the browsers' own push services (stops vendors pointing the server at other sites).
const PUSH_HOSTS = new RegExp('^(fcm\\.googleapis\\.com|android\\.googleapis\\.com|updates\\.push\\.services\\.mozilla\\.com|[\\w.-]+\\.push\\.services\\.mozilla\\.com|[\\w.-]+\\.push\\.apple\\.com|[\\w.-]+\\.notify\\.windows\\.com' +
  (process.env.PUSH_EXTRA_HOSTS ? '|' + process.env.PUSH_EXTRA_HOSTS.split(',').map(h => h.trim().replace(/[^\w.-]/g, '')).filter(Boolean).join('|').replace(/\./g, '\\.') : '') + ')$');

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
    if (!v) mailer.send({ to: email, ...mailer.tpl.welcome(u.first, link('/')) });   // confirmation email for buyers (and the admin)
    if (v) {   // emails never block sign-up
      mailer.send({ to: email, ...mailer.tpl.welcomeVendor(String(v.shop).trim(), link('/#/dash')) });
      if (ADMIN_EMAIL) mailer.send({ to: ADMIN_EMAIL, ...mailer.tpl.adminNewVendor(String(v.shop).trim(), `${b.first} ${b.last}`, email, wa, link('/admin')) });
    }
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

/* ---------- password reset by email ---------- */
app.post('/api/auth/forgot', authLimit, ah(async (req, res) => {
  res.json({ ok: true });   // same answer whether or not the email has an account, so nobody can probe for accounts
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!mailer.enabled || !APP_URL || !/^\S+@\S+\.\S+$/.test(email)) return;
    const u = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0];
    if (!u) return;
    const token = crypto.randomBytes(32).toString('hex');
    const c = await db.connect(); let allowed = false;
    try {   // the lock makes "at most 3 per hour" hold even when requests arrive at the same moment
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock($1)', [u.id]);
      const recent = (await c.query("SELECT count(*)::int AS n FROM password_resets WHERE user_id=$1 AND created_at > now() - interval '1 hour'", [u.id])).rows[0].n;
      if (recent < 3) {
        await c.query("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2, now() + interval '1 hour')", [u.id, crypto.createHash('sha256').update(token).digest('hex')]);
        allowed = true;
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    if (allowed) await mailer.send({ to: email, ...mailer.tpl.reset(link('/#/reset/' + token)) });
  } catch (e) { console.error('forgot password failed', e.message); }
}));

app.post('/api/auth/reset', authLimit, ah(async (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8) return bad(res, 'Password needs at least 8 characters.');
  const h = crypto.createHash('sha256').update(String(req.body.token || '')).digest('hex');
  const hash = await bcrypt.hash(pw, 11);
  const c = await db.connect();
  let email;
  try {
    await c.query('BEGIN');
    const r = (await c.query('UPDATE password_resets SET used=true WHERE token_hash=$1 AND NOT used AND expires_at>now() RETURNING user_id', [h])).rows[0];
    if (!r) { await c.query('ROLLBACK'); return bad(res, 'This reset link is invalid or has expired. Please request a new one.'); }
    email = (await c.query('UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING email', [r.user_id, hash])).rows[0].email;
    await c.query('UPDATE password_resets SET used=true WHERE user_id=$1', [r.user_id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  mailer.send({ to: email, ...mailer.tpl.passwordChanged() });
  res.json({ ok: true });
}));

app.get('/api/admin/email', need('admin'), (req, res) => res.json({ enabled: mailer.enabled, appUrl: !!APP_URL, from: mailer.from }));
app.post('/api/admin/email/test', need('admin'), ah(async (req, res) => {
  if (!mailer.enabled) return bad(res, 'Email is not set up yet. Add BREVO_API_KEY and MAIL_FROM on your host.');
  const u = (await db.query('SELECT email FROM users WHERE id=$1', [req.user.id])).rows[0];
  const r = await mailer.send({ to: u.email, ...mailer.tpl.test() });
  r.ok ? res.json({ ok: true, to: u.email }) : bad(res, 'Brevo said: ' + r.error, 502);
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
  s.products = (await db.query('SELECT id,name,price,old_price,(image IS NOT NULL) AS img,image_v FROM products WHERE store_id=$1 AND active ORDER BY id DESC', [s.id])).rows;
  res.json(s);
}));

/* ---------- product browsing (all approved stores) ---------- */
app.get('/api/products', ah(async (req, res) => {
  const q = '%' + String(req.query.q || '').trim().toLowerCase() + '%', cat = String(req.query.cat || ''), deals = req.query.deals === '1';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 48), offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const sorts = { new: 'p.id DESC', price_asc: 'p.price ASC, p.id DESC', price_desc: 'p.price DESC, p.id DESC' };
  const order = sorts[req.query.sort] || (deals ? '(p.old_price-p.price)*100.0/p.old_price DESC, p.id DESC' : 'p.id DESC');
  res.json((await db.query(
    `SELECT p.id,p.name,p.price,p.old_price,(p.image IS NOT NULL) AS img,p.image_v,
            s.id AS store_id,s.name AS store_name,s.category,s.location
     FROM products p JOIN stores s ON s.id=p.store_id
     WHERE p.active AND s.status='approved' AND ($1='' OR s.category=$1)
       AND (NOT $2::boolean OR (p.old_price IS NOT NULL AND p.old_price>p.price))
       AND lower(p.name||' '||s.name||' '||s.category) LIKE $3
     ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, [cat, deals, q])).rows);
}));

app.get('/api/products/:id', ah(async (req, res) => {
  const p = (await db.query(
    `SELECT p.id,p.name,p.price,p.old_price,p.description,(p.image IS NOT NULL) AS img,p.image_v,
            s.id AS store_id,s.name AS store_name,s.category,s.location,s.whatsapp
     FROM products p JOIN stores s ON s.id=p.store_id
     WHERE p.id=$1 AND p.active AND s.status='approved'`, [req.params.id])).rows[0];
  if (!p) return bad(res, 'Product not found', 404);
  p.related = (await db.query(
    `SELECT id,name,price,old_price,(image IS NOT NULL) AS img,image_v FROM products
     WHERE store_id=$1 AND active AND id<>$2 ORDER BY id DESC LIMIT 8`, [p.store_id, p.id])).rows;
  res.json(p);
}));

/* ---------- order alert email to the vendor (Brevo, see mailer.js) ---------- */
async function notify(storeId, text) {
  try {
    const u = (await db.query('SELECT u.email FROM stores s JOIN users u ON u.id=s.owner_id WHERE s.id=$1', [storeId])).rows[0];
    if (u) await mailer.send({ to: u.email, ...mailer.tpl.order(text, link('/#/dash')) });
  } catch (e) { console.error('order email failed', e.message); }
}

async function pushOrder(storeId, title, body) {
  if (!pushOn) return;
  try {
    const subs = (await db.query('SELECT ps.id,ps.endpoint,ps.p256dh,ps.auth FROM push_subs ps JOIN stores s ON s.owner_id=ps.user_id WHERE s.id=$1', [storeId])).rows;
    await Promise.all(subs.map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body, url: '/#/dash' }), { TTL: 86400, timeout: 5000 });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await db.query('DELETE FROM push_subs WHERE id=$1', [s.id]);
        else console.error('push failed', e.statusCode || e.message);
      }
    }));
  } catch (e) { console.error('push failed', e.message); }
}

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
  notify(s.id, text);
  pushOrder(s.id, 'New order 🛒', `${buyer || 'A buyer'} ordered ${snap.length} item${snap.length > 1 ? 's' : ''} (${ngn(total)})`);
  res.json({ url: `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(text)}` });
}));

/* ---------- vendor dashboard ---------- */
const mine = `(SELECT id FROM stores WHERE owner_id=$1)`;
app.get('/api/vendor/store', need('vendor'), ah(async (req, res) => {
  const s = (await db.query('SELECT id,name,description,category,location,whatsapp,status,(image IS NOT NULL) AS img,image_v FROM stores WHERE owner_id=$1', [req.user.id])).rows[0];
  if (!s) return bad(res, 'No store found', 404);
  s.products = (await db.query('SELECT id,name,price,old_price,description,active,(image IS NOT NULL) AS img,image_v FROM products WHERE store_id=$1 ORDER BY id', [s.id])).rows;
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
  const raw = req.body.old_price, hasOld = !(raw === undefined || raw === null || raw === '');
  const old = hasOld ? money(raw) : null;
  if (!name || price === null) return bad(res, 'Enter a product name and a valid price');
  if (hasOld && (old === null || old <= price)) return bad(res, 'Old price must be higher than the price');
  const r = await db.query('INSERT INTO products(store_id,name,price,old_price,description) SELECT id,$2,$3,$4,$5 FROM stores WHERE owner_id=$1 RETURNING id',
    [req.user.id, name, price, old, String(req.body.description || '').trim().slice(0, 500)]);
  r.rowCount ? res.json({ id: r.rows[0].id }) : bad(res, 'No store found', 404);
}));

app.put('/api/vendor/products/:id', need('vendor'), ah(async (req, res) => {
  const b = req.body, sets = [], vals = [req.user.id, req.params.id];
  const add = (c, v) => { vals.push(v); sets.push(`${c}=$${vals.length}`); };
  if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 100); if (!n) return bad(res, 'Name cannot be empty'); add('name', n); }
  if (b.price !== undefined) { const p = money(b.price); if (p === null) return bad(res, 'Invalid price'); add('price', p); }
  if (typeof b.active === 'boolean') add('active', b.active);
  if (b.description !== undefined) add('description', String(b.description).trim().slice(0, 500));
  if (b.old_price !== undefined) {
    const none = b.old_price === null || b.old_price === '', o = none ? null : money(b.old_price);
    if (!none && o === null) return bad(res, 'Invalid old price');
    add('old_price', o);
  }
  if (!sets.length) return res.json({ ok: true });
  await db.query(`UPDATE products SET ${sets.join(',')} WHERE id=$2 AND store_id=${mine}`, vals);
  res.json({ ok: true });
}));

app.delete('/api/vendor/products/:id', need('vendor'), ah(async (req, res) => {
  await db.query(`DELETE FROM products WHERE id=$2 AND store_id=${mine}`, [req.user.id, req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/vendor/orders', need('vendor'), ah(async (req, res) => {
  res.json((await db.query(`SELECT id,buyer_name,buyer_location,items,total,created_at,seen FROM orders
    WHERE store_id=${mine} ORDER BY id DESC LIMIT 100`, [req.user.id])).rows);
}));

app.get('/api/vendor/orders/unread', need('vendor'), ah(async (req, res) => {
  res.json({ n: (await db.query(`SELECT count(*)::int AS n FROM orders WHERE NOT seen AND store_id=${mine}`, [req.user.id])).rows[0].n });
}));
app.post('/api/vendor/orders/seen', need('vendor'), ah(async (req, res) => {
  await db.query(`UPDATE orders SET seen=true WHERE NOT seen AND store_id=${mine}`, [req.user.id]);
  res.json({ ok: true });
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
  const r = await db.query('UPDATE stores SET status=$2 WHERE id=$1 RETURNING owner_id,name', [req.params.id, st]);
  res.json({ ok: true });
  const s = r.rows[0];   // tell the vendor by email (never blocks the response)
  if (s && st !== 'pending') db.query('SELECT email FROM users WHERE id=$1', [s.owner_id])
    .then(q => q.rows[0] && mailer.send({ to: q.rows[0].email, ...mailer.tpl.storeStatus(s.name, st, link('/#/dash')) })).catch(() => {});
}));

/* ---------- public config, reports, QR codes ---------- */
app.get('/api/config', (req, res) => res.json({ whatsapp: (process.env.ADMIN_WHATSAPP || '').replace(/\D/g, ''), email: mailer.enabled && !!APP_URL }));

const REASONS = ['Fake or misleading listing', 'Did not deliver after payment', 'Prohibited item', 'Harassment or abuse', 'Other'];
app.post('/api/reports', orderLimit, ah(async (req, res) => {
  const { store_id, reason, details } = req.body;
  if (!REASONS.includes(reason)) return bad(res, 'Choose a reason');
  const r = await db.query("INSERT INTO reports(store_id,reason,details) SELECT id,$2,$3 FROM stores WHERE id=$1 AND status='approved' RETURNING id",
    [store_id, reason, String(details || '').slice(0, 500)]);
  r.rowCount ? res.json({ ok: true }) : bad(res, 'Store not found', 404);
}));
app.get('/api/admin/reports', need('admin'), ah(async (req, res) => {
  res.json((await db.query(`SELECT r.id,r.store_id,r.reason,r.details,r.created_at,s.name AS store_name
    FROM reports r JOIN stores s ON s.id=r.store_id WHERE NOT r.resolved ORDER BY r.id DESC LIMIT 200`)).rows);
}));
app.post('/api/admin/reports/:id/resolve', need('admin'), ah(async (req, res) => {
  await db.query('UPDATE reports SET resolved=true WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/qr.svg', ah(async (req, res) => {
  const u = String(req.query.u || '');
  if (!/^https?:\/\//.test(u) || u.length > 300) return bad(res, 'Invalid URL');
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400')
    .send(await QRCode.toString(u, { type: 'svg', margin: 1, width: 600 }));
}));

/* ---------- push notification subscriptions ---------- */
app.get('/api/push/key', (req, res) => res.json({ key: pushOn ? process.env.VAPID_PUBLIC_KEY : null }));
app.post('/api/vendor/push/subscribe', need('vendor'), ah(async (req, res) => {
  if (!pushOn) return bad(res, 'Notifications are not set up on this server yet');
  const { endpoint, keys } = req.body || {};
  let host = '';
  try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch {}
  if (!host || String(endpoint).length > 600 || !PUSH_HOSTS.test(host) || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100)
    return bad(res, 'Invalid subscription');
  await db.query('INSERT INTO push_subs(user_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4) ON CONFLICT (endpoint) DO UPDATE SET user_id=$1,p256dh=$3,auth=$4',
    [req.user.id, endpoint, keys.p256dh, keys.auth]);
  res.json({ ok: true });
}));
app.post('/api/vendor/push/unsubscribe', need('vendor'), ah(async (req, res) => {
  await db.query('DELETE FROM push_subs WHERE user_id=$1 AND endpoint=$2', [req.user.id, String(req.body.endpoint || '')]);
  res.json({ ok: true });
}));

/* ---------- demo data for presentations (admin only) ---------- */
app.get('/api/admin/demo', need('admin'), ah(async (req, res) => res.json({ stores: await demo.count(db) })));
app.post('/api/admin/demo/load', need('admin'), ah(async (req, res) => {
  const wa = String(req.body.whatsapp || '').replace(/\D/g, '');
  if (wa.length < 10 || wa.length > 15) return bad(res, 'Enter a valid WhatsApp number (e.g. 2348012345678) to receive demo orders');
  res.json(await demo.load(db, wa));
}));
app.post('/api/admin/demo/clear', need('admin'), ah(async (req, res) => res.json({ removed: await demo.clear(db) })));

/* ---------- static site + errors ---------- */
app.get('/admin', (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'public', 'admin.html')); });   // separate admin site
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
