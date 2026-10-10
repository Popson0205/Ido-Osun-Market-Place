CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  first TEXT NOT NULL,
  last TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer','vendor','admin')),
  referral TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  owner_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'General',
  location TEXT,
  whatsapp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INT NOT NULL CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  buyer_name TEXT,
  buyer_location TEXT,
  items JSONB NOT NULL,
  total INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, id DESC);

-- Photos (added in v1.1; safe to re-run on an existing database)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS image BYTEA;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS image_v INT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image BYTEA;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_v INT NOT NULL DEFAULT 0;

-- Order alerts and reports (added in v1.2; safe to re-run)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seen BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Product descriptions and deal prices (added in v1.3; safe to re-run)
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price INT;
