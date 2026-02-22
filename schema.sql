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