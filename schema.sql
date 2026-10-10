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

-- Vendor push notification subscriptions (added in v1.5; safe to re-run)
CREATE TABLE IF NOT EXISTS push_subs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Password reset links (added in v1.6; safe to re-run). Only a hash of each token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stock (added in v1.3; safe to re-run). NULL = quantity not tracked (older products); 0 = sold out.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT CHECK (stock >= 0);

-- Shop locations (added in v1.7; safe to re-run). Plain WGS84 lat/lng; distances use the haversine formula.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS location_public BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_stores_geo ON stores(lat, lng);
