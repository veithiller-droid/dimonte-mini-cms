-- ─────────────────────────────────────────
-- EXISTING: posts
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  post_date DATE NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_post_date ON posts(post_date DESC);

-- ─────────────────────────────────────────
-- NEW: messages (Kontaktformular)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ─────────────────────────────────────────
-- NEW: products (Shop)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  type TEXT NOT NULL CHECK (type IN ('sitzung','paket','event','download')),
  stripe_price_id TEXT,
  stripe_product_id TEXT,
  cal_event_type_slug TEXT,
  download_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

-- ─────────────────────────────────────────
-- NEW: orders (Bestellungen via Stripe)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  stripe_session_id TEXT UNIQUE NOT NULL,
  stripe_payment_intent TEXT,
  customer_email TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled','refunded')),
  cal_booking_uid TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders(stripe_session_id);

-- ─────────────────────────────────────────
-- SEED: Bianca's Produkte
-- ─────────────────────────────────────────
INSERT INTO products (name, description, price_cents, type, sort_order) VALUES
  ('Hypnose Sitzung',            'Einzelne Hypnosesitzung, 60–90 Minuten via Zoom.',             23000, 'sitzung', 1),
  ('Hypnose Maxisitzung',        'Intensive Hypnosesitzung, 120 Minuten via Zoom.',               38000, 'sitzung', 2),
  ('Mikrocoaching',              'Fokussiertes Coaching-Gespräch, 15 Minuten via Zoom.',           7500, 'sitzung', 3),
  ('Hypnose Paket',              '4er-Paket Hypnosesitzungen. Erster Termin direkt buchbar.',     96000, 'paket',   4),
  ('Hypnotisches Magenband 1:1', 'Intensives 1:1-Programm zur Gewichtsreduktion via Hypnose.',   96000, 'paket',   5),
  ('3 Tage Intensiv Transformation', 'Dreitägiges Intensivprogramm für tiefgreifende Veränderung.', 390000, 'paket', 6),
  ('Live: Ruhe im Kopf',         'Kostenloser Live-Event. Anmeldung erforderlich.',                   0, 'event',  7)
ON CONFLICT DO NOTHING;