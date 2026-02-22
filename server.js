require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-please';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// Optional: hashed password support
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  session({
    name: 'dimonte_admin_session',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);

// --- Request logs (minimal) ---
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// --- Health ---
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as now');
    res.json({ ok: true, db: true, now: result.rows[0].now });
  } catch (e) {
    console.error('[HEALTH] DB error:', e.message);
    res.status(500).json({ ok: false, db: false, error: e.message });
  }
});

// --- Init DB route (run once manually, then optional keep/remove) ---
app.post('/api/init-db', async (req, res) => {
  try {
    const sql = `
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
    `;
    await pool.query(sql);
    res.json({ ok: true, message: 'DB initialized' });
  } catch (e) {
    console.error('[INIT-DB] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Auth helpers ---
function requireAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

async function verifyPassword(password) {
  if (ADMIN_PASSWORD_HASH) {
    return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  }
  return password === ADMIN_PASSWORD;
}

// --- Admin static pages ---
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// Redirect root to admin login (optional)
app.get('/', (req, res) => {
  res.redirect('/admin/login.html');
});

// --- Auth API ---
app.get('/api/me', (req, res) => {
  res.json({
    ok: true,
    authenticated: !!(req.session && req.session.isAuthenticated),
    username: req.session?.username || null,
  });
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password required' });
    }

    const usernameOk = username === ADMIN_USERNAME;
    const passwordOk = await verifyPassword(password);

    if (!usernameOk || !passwordOk) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    req.session.isAuthenticated = true;
    req.session.username = username;

    return res.json({ ok: true });
  } catch (e) {
    console.error('[LOGIN] error:', e);
    return res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('dimonte_admin_session');
    res.json({ ok: true });
  });
});

// --- Admin Posts API ---
app.get('/api/posts', requireAuth, async (req, res) => {
  try {
    const q = `
      SELECT id, title, category, post_date, body, status, created_at, updated_at
      FROM posts
      ORDER BY post_date DESC, id DESC
    `;
    const result = await pool.query(q);
    res.json({ ok: true, items: result.rows });
  } catch (e) {
    console.error('[GET /api/posts] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const result = await pool.query(
      `SELECT id, title, category, post_date, body, status, created_at, updated_at
       FROM posts WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    console.error('[GET /api/posts/:id] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/posts', requireAuth, async (req, res) => {
  try {
    const { title, category, post_date, body, status } = req.body || {};

    if (!title || !post_date || !body) {
      return res.status(400).json({ ok: false, error: 'title, post_date, body are required' });
    }

    const safeStatus = status === 'published' ? 'published' : 'draft';

    const result = await pool.query(
      `INSERT INTO posts (title, category, post_date, body, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, category, post_date, body, status, created_at, updated_at`,
      [title.trim(), (category || '').trim(), post_date, body.trim(), safeStatus]
    );

    res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    console.error('[POST /api/posts] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const { title, category, post_date, body, status } = req.body || {};
    if (!title || !post_date || !body) {
      return res.status(400).json({ ok: false, error: 'title, post_date, body are required' });
    }

    const safeStatus = status === 'published' ? 'published' : 'draft';

    const result = await pool.query(
      `UPDATE posts
       SET title = $1,
           category = $2,
           post_date = $3,
           body = $4,
           status = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, title, category, post_date, body, status, created_at, updated_at`,
      [title.trim(), (category || '').trim(), post_date, body.trim(), safeStatus, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    console.error('[PUT /api/posts/:id] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    res.json({ ok: true, id });
  } catch (e) {
    console.error('[DELETE /api/posts/:id] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/posts/:id/publish', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const result = await pool.query(
      `UPDATE posts
       SET status = 'published', updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, updated_at`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    console.error('[POST /api/posts/:id/publish] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Public API (published only) ---
app.get('/api/public/posts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, category, post_date, body, created_at, updated_at
       FROM posts
       WHERE status = 'published'
       ORDER BY post_date DESC, id DESC`
    );
    res.json({ ok: true, items: result.rows });
  } catch (e) {
    console.error('[GET /api/public/posts] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Optional single public post
app.get('/api/public/posts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const result = await pool.query(
      `SELECT id, title, category, post_date, body, created_at, updated_at
       FROM posts
       WHERE id = $1 AND status = 'published'`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    console.error('[GET /api/public/posts/:id] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`[BOOT] Mini CMS running on port ${PORT}`);
  console.log('[BOOT] NODE_ENV =', process.env.NODE_ENV || 'development');
  console.log('[BOOT] ADMIN_USERNAME =', ADMIN_USERNAME);
  console.log('[BOOT] DATABASE_URL present =', !!process.env.DATABASE_URL);
  console.log('[BOOT] SESSION_SECRET present =', !!process.env.SESSION_SECRET);
});