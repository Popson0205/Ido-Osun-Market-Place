// Demo data for presentations. Everything it creates uses an email ending in @demo.idoosun.local,
// so it can be removed in one step without touching real vendors.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), bcrypt = require('bcryptjs');
const DEMO = require('./seed/demo.json');
const DOMAIN = '@demo.idoosun.local', IMG = path.join(__dirname, 'seed', 'images');
const pic = f => { try { return fs.readFileSync(path.join(IMG, f)); } catch { return null; } };

const count = async db => (await db.query('SELECT count(*)::int AS n FROM users WHERE email LIKE $1', ['%' + DOMAIN])).rows[0].n;
const clear = async db => (await db.query('DELETE FROM users WHERE email LIKE $1', ['%' + DOMAIN])).rowCount;

// Loads (or reloads) the demo vendors. Orders placed on demo products go to `whatsapp`.
async function load(db, whatsapp) {
  const c = await db.connect(), password = crypto.randomBytes(5).toString('hex');
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM users WHERE email LIKE $1', ['%' + DOMAIN]);
    const hash = await bcrypt.hash(password, 10), stores = [];
    for (const s of DEMO.stores) {
      const email = `${s.slug}${DOMAIN}`;
      const u = (await c.query("INSERT INTO users(first,last,email,password_hash,role) VALUES($1,'Demo',$2,$3,'vendor') RETURNING id",
        [s.name.split(' ')[0], email, hash])).rows[0];
      const st = (await c.query(
        "INSERT INTO stores(owner_id,name,description,category,location,whatsapp,status,image,image_v,lat,lng,address) VALUES($1,$2,$3,$4,$5,$6,'approved',$7,1,$8,$9,$10) RETURNING id",
        [u.id, s.name, s.description, s.category, s.location, whatsapp, pic(`store-${s.slug}.jpg`), s.lat, s.lng, s.address || null])).rows[0];
      stores.push({ id: st.id, s });
    }
    let products = 0;   // interleave stores so the home page shows variety
    for (let i = 0; i < Math.max(...DEMO.stores.map(s => s.products.length)); i++) {
      for (const { id, s } of stores) {
        const p = s.products[i]; if (!p) continue;
        await c.query('INSERT INTO products(store_id,name,price,old_price,description,image,image_v) VALUES($1,$2,$3,$4,$5,$6,1)',
          [id, p.name, p.price, p.old_price || null, p.description, pic(`${p.slug}.jpg`)]);
        products++;
      }
    }
    await c.query('COMMIT');
    return { stores: stores.length, products, login: { email: `${DEMO.stores[0].slug}${DOMAIN}`, password } };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

module.exports = { count, clear, load };
