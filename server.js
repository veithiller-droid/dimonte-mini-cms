const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const pool = require('./db');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Railway / Reverse Proxy
app.set('trust proxy', 1);

const NODE_ENV = process.env.NODE_ENV || 'development';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';

console.log(`[BOOT] Mini CMS running on port ${PORT}`);
console.log(`[BOOT] NODE_ENV = ${NODE_ENV}`);
console.log(`[BOOT] ADMIN_USERNAME = ${ADMIN_USERNAME}`);
console.log(`[BOOT] DATABASE_URL present = ${!!process.env.DATABASE_URL}`);
console.log(`[BOOT] SESSION_SECRET present = ${!!SESSION_SECRET}`);

// -----------------------------
// Middleware
// -----------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS für Frontend-Website (öffentliche API)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://dimontehypnose.de',
    'https://www.dimontehypnose.de'
  ];

  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Sessions (Postgres Store)
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true
    }),
    name: 'dimonte.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    rolling: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 8 // 8 Stunden
    }
  })
);

// Admin static files
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// -----------------------------
// Helpers
// -----------------------------
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

function normalizePostInput(body) {
  const title = String(body.title || '').trim();
  const category = String(body.category || '').trim();
  const post_date = String(body.post_date || '').trim();
  const content = String(body.body || '').trim();
  let status = String(body.status || 'draft').trim().toLowerCase();

  if (!title) throw new Error('Titel fehlt');
  if (!post_date) throw new Error('Datum fehlt');
  if (!content) throw new Error('Text fehlt');

  if (!['draft', 'published'].includes(status)) {
    status = 'draft';
  }

  return { title, category, post_date, body: content, status };
}

// -----------------------------
// Health
// -----------------------------
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as now');
    res.json({ ok: true, db: true, now: r.rows[0].now });
  } catch (e) {
    res.status(200).json({ ok: false, db: false, error: e.message || '' });
  }
});

// -----------------------------
// DB Init (einmalig)
// -----------------------------
app.post('/api/init-db', async (req, res) => {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    res.json({ ok: true, message: 'DB initialized' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || '' });
  }
});


// -----------------------------
// Auth
// -----------------------------
app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (username !== ADMIN_USERNAME) {
      return res.status(401).json({ ok: false, error: 'Ungültige Zugangsdaten' });
    }

    let passwordOk = false;
    if (
      ADMIN_PASSWORD.startsWith('$2a$') ||
      ADMIN_PASSWORD.startsWith('$2b$') ||
      ADMIN_PASSWORD.startsWith('$2y$')
    ) {
      passwordOk = await bcrypt.compare(password, ADMIN_PASSWORD);
    } else {
      passwordOk = password === ADMIN_PASSWORD;
    }

    if (!passwordOk) {
      return res.status(401).json({ ok: false, error: 'Ungültige Zugangsdaten' });
    }

    // neue Session für Login erzeugen (stabiler)
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return res.status(500).json({ ok: false, error: 'Session konnte nicht initialisiert werden' });
      }

      req.session.user = {
        username: ADMIN_USERNAME,
        role: 'admin'
      };

      req.session.save((saveErr) => {
        if (saveErr) {
          return res.status(500).json({ ok: false, error: 'Session konnte nicht gespeichert werden' });
        }

        return res.json({ ok: true, user: req.session.user });
      });
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || '' });
  }
});

app.post('/api/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ ok: false, error: 'Logout fehlgeschlagen' });
    }
    res.clearCookie('dimonte.sid');
    return res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return res.json({ ok: true, user: req.session.user });
});

// -----------------------------
// Public API
// -----------------------------
app.get('/api/public/posts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, category, post_date, body, created_at, updated_at
      FROM posts
      WHERE status = 'published'
      ORDER BY post_date DESC, id DESC
    `);

    return res.json({ ok: true, items: result.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || '' });
  }
});

app.get('/api/public/posts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    }

    const result = await pool.query(
      `
      SELECT id, title, category, post_date, body, created_at, updated_at
      FROM posts
      WHERE id = $1 AND status = 'published'
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    }

    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || '' });
  }
});

// -----------------------------
// Admin API (geschützt)
// -----------------------------
app.get('/api/posts', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, category, post_date, body, status, created_at, updated_at
      FROM posts
      ORDER BY post_date DESC, id DESC
    `);

    return res.json({ ok: true, items: result.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || '' });
  }
});

app.get('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    }

    const result = await pool.query(
      `
      SELECT id, title, category, post_date, body, status, created_at, updated_at
      FROM posts
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    }

    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || '' });
  }
});

app.post('/api/posts', requireAuth, async (req, res) => {
  try {
    const data = normalizePostInput(req.body);

    const result = await pool.query(
      `
      INSERT INTO posts (title, category, post_date, body, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, category, post_date, body, status, created_at, updated_at
      `,
      [data.title, data.category, data.post_date, data.body, data.status]
    );

    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || '' });
  }
});

app.put('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    }

    const data = normalizePostInput(req.body);

    const result = await pool.query(
      `
      UPDATE posts
      SET title = $1,
          category = $2,
          post_date = $3,
          body = $4,
          status = $5,
          updated_at = NOW()
      WHERE id = $6
      RETURNING id, title, category, post_date, body, status, created_at, updated_at
      `,
      [data.title, data.category, data.post_date, data.body, data.status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    }

    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || '' });
  }
});

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    }

    const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    }

    return res.json({ ok: true, deletedId: id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || '' });
  }
});

// -----------------------------
// Fallback root
// -----------------------------
app.get('/', (req, res) => {
  res.type('text/plain').send('DiMonte Mini CMS running');
});

// -----------------------------
// Start
// -----------------------------
app.listen(PORT, () => {
  // Boot logs oben
});