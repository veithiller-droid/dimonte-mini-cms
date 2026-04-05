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

app.set('trust proxy', 1);

const NODE_ENV = process.env.NODE_ENV || 'development';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';

console.log(`[BOOT] DiMonte CMS running on port ${PORT}`);
console.log(`[BOOT] NODE_ENV = ${NODE_ENV}`);
console.log(`[BOOT] DATABASE_URL present = ${!!process.env.DATABASE_URL}`);
console.log(`[BOOT] STRIPE_SECRET_KEY present = ${!!process.env.STRIPE_SECRET_KEY}`);
console.log(`[BOOT] RESEND_API_KEY present = ${!!process.env.RESEND_API_KEY}`);
console.log(`[BOOT] CAL_API_KEY present = ${!!process.env.CAL_API_KEY}`);

// ─────────────────────────────────────────
// 1. CORS — muss als erstes kommen
// ─────────────────────────────────────────
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

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─────────────────────────────────────────
// 2. STRIPE WEBHOOK — vor json middleware (braucht raw body)
// ─────────────────────────────────────────
const shopRouter = require('./shop/index');
app.use('/api/shop', shopRouter);

// ─────────────────────────────────────────
// 3. JSON Middleware
// ─────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Sessions
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
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

// Admin static files
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.user) {
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
  if (!['draft', 'published'].includes(status)) status = 'draft';

  return { title, category, post_date, body: content, status };
}

// ─────────────────────────────────────────
// Health
// ─────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as now');
    res.json({ ok: true, db: true, now: r.rows[0].now });
  } catch (e) {
    res.status(200).json({ ok: false, db: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// DB Init
// ─────────────────────────────────────────
app.post('/api/init-db', requireAuth, async (req, res) => {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    res.json({ ok: true, message: 'DB initialized' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// Auth
// ─────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (username !== ADMIN_USERNAME) {
      return res.status(401).json({ ok: false, error: 'Ungültige Zugangsdaten' });
    }

    let passwordOk = false;
    if (ADMIN_PASSWORD.startsWith('$2')) {
      passwordOk = await bcrypt.compare(password, ADMIN_PASSWORD);
    } else {
      passwordOk = password === ADMIN_PASSWORD;
    }

    if (!passwordOk) {
      return res.status(401).json({ ok: false, error: 'Ungültige Zugangsdaten' });
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) return res.status(500).json({ ok: false, error: 'Session-Fehler' });
      req.session.user = { username: ADMIN_USERNAME, role: 'admin' };
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ ok: false, error: 'Session-Fehler' });
        return res.json({ ok: true, user: req.session.user });
      });
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Logout fehlgeschlagen' });
    res.clearCookie('dimonte.sid');
    return res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  return res.json({ ok: true, user: req.session.user });
});

// ─────────────────────────────────────────
// PUBLIC API — Posts
// ─────────────────────────────────────────
app.get('/api/public/posts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, category, post_date, body, created_at, updated_at
       FROM posts WHERE status = 'published'
       ORDER BY post_date DESC, id DESC`
    );
    return res.json({ ok: true, items: result.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/public/posts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    const result = await pool.query(
      `SELECT id, title, category, post_date, body, created_at, updated_at
       FROM posts WHERE id = $1 AND status = 'published' LIMIT 1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// PUBLIC API — Contact Form
// ─────────────────────────────────────────
app.post('/api/public/contact', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || req.body.message || '').trim();

    if (!name || !email || !body) {
      return res.status(400).json({ ok: false, error: 'Name, E-Mail und Nachricht sind Pflichtfelder' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Ungültige E-Mail-Adresse' });
    }

    await pool.query(
      'INSERT INTO messages (name, email, subject, body) VALUES ($1, $2, $3, $4)',
      [name, email, subject, body]
    );
    return res.json({ ok: true, message: 'Nachricht gesendet' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// ADMIN API — Posts
// ─────────────────────────────────────────
app.get('/api/posts', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, category, post_date, body, status, created_at, updated_at
       FROM posts ORDER BY post_date DESC, id DESC`
    );
    return res.json({ ok: true, items: result.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    const result = await pool.query('SELECT * FROM posts WHERE id = $1 LIMIT 1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/posts', requireAuth, async (req, res) => {
  try {
    const data = normalizePostInput(req.body);
    const result = await pool.query(
      `INSERT INTO posts (title, category, post_date, body, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.title, data.category, data.post_date, data.body, data.status]
    );
    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

app.put('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    const data = normalizePostInput(req.body);
    const result = await pool.query(
      `UPDATE posts SET title=$1, category=$2, post_date=$3, body=$4, status=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [data.title, data.category, data.post_date, data.body, data.status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    const result = await pool.query('DELETE FROM posts WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    return res.json({ ok: true, deletedId: id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// ADMIN API — Nachrichten
// ─────────────────────────────────────────
app.get('/api/messages', requireAuth, async (req, res) => {
  try {
    const showArchived = req.query.archived === 'true';
    const result = await pool.query(
      `SELECT id, name, email, subject, body, read, archived, created_at
       FROM messages WHERE archived = $1 ORDER BY created_at DESC`,
      [showArchived]
    );
    const unreadCount = await pool.query(
      `SELECT COUNT(*) FROM messages WHERE read = false AND archived = false`
    );
    return res.json({ ok: true, items: result.rows, unread: parseInt(unreadCount.rows[0].count) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/messages/:id/read', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('UPDATE messages SET read = true WHERE id = $1', [id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/messages/:id/archive', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('UPDATE messages SET archived = true, read = true WHERE id = $1', [id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/messages/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('DELETE FROM messages WHERE id = $1', [id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/messages/:id/reply', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const replyBody = String(req.body.body || '').trim();
    const replySubject = String(req.body.subject || '').trim();
    if (!replyBody) return res.status(400).json({ ok: false, error: 'Antworttext fehlt' });
    const msg = await pool.query('SELECT * FROM messages WHERE id = $1 LIMIT 1', [id]);
    if (msg.rows.length === 0) return res.status(404).json({ ok: false, error: 'Nachricht nicht gefunden' });
    const { sendMessageReply } = require('./shop/delivery');
    await sendMessageReply({
      to: msg.rows[0].email,
      subject: replySubject || `Re: ${msg.rows[0].subject || 'Ihre Anfrage'}`,
      body: replyBody
    });
    await pool.query('UPDATE messages SET read = true WHERE id = $1', [id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// ADMIN API — Produkte
// ─────────────────────────────────────────
app.get('/api/products', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY sort_order ASC, id ASC');
    return res.json({ ok: true, items: result.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/products', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const price_cents = Math.round(parseFloat(req.body.price_euros || 0) * 100);
    const type = String(req.body.type || 'sitzung').trim();
    const cal_event_type_slug = String(req.body.cal_event_type_slug || '').trim() || null;
    const download_url = String(req.body.download_url || '').trim() || null;
    const active = req.body.active !== false && req.body.active !== 'false';
    const sort_order = parseInt(req.body.sort_order || 0);
    if (!name) return res.status(400).json({ ok: false, error: 'Name fehlt' });
    if (!['sitzung', 'paket', 'event', 'download'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'Ungültiger Typ' });
    }
    const result = await pool.query(
      `INSERT INTO products (name, description, price_cents, type, cal_event_type_slug, download_url, active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, description, price_cents, type, cal_event_type_slug, download_url, active, sort_order]
    );
    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

app.put('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Ungültige ID' });
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const price_cents = Math.round(parseFloat(req.body.price_euros || 0) * 100);
    const type = String(req.body.type || 'sitzung').trim();
    const cal_event_type_slug = String(req.body.cal_event_type_slug || '').trim() || null;
    const download_url = String(req.body.download_url || '').trim() || null;
    const active = req.body.active !== false && req.body.active !== 'false';
    const sort_order = parseInt(req.body.sort_order || 0);
    if (!name) return res.status(400).json({ ok: false, error: 'Name fehlt' });
    const current = await pool.query('SELECT price_cents FROM products WHERE id = $1', [id]);
    const priceChanged = current.rows[0]?.price_cents !== price_cents;
    const result = await pool.query(
      `UPDATE products
       SET name=$1, description=$2, price_cents=$3, type=$4,
           cal_event_type_slug=$5, download_url=$6, active=$7, sort_order=$8,
           ${priceChanged ? 'stripe_price_id=NULL, stripe_product_id=NULL,' : ''}
           updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [name, description, price_cents, type, cal_event_type_slug, download_url, active, sort_order, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    return res.json({ ok: true, item: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// ADMIN API — Bestellungen
// ─────────────────────────────────────────
app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, p.name as product_name, p.type as product_type
       FROM orders o
       LEFT JOIN products p ON o.product_id = p.id
       ORDER BY o.created_at DESC LIMIT 200`
    );
    return res.json({ ok: true, items: result.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/orders/:id/notes', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const notes = String(req.body.notes || '').trim();
    await pool.query('UPDATE orders SET notes = $1, updated_at = NOW() WHERE id = $2', [notes, id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// ADMIN API — Cal.com Bookings
// ─────────────────────────────────────────
app.get('/api/bookings', requireAuth, async (req, res) => {
  try {
    const { getBookings } = require('./shop/calcom');
    const bookings = await getBookings();
    return res.json({ ok: true, items: bookings });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// Fallback
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.type('text/plain').send('DiMonte CMS running');
});

app.listen(PORT, () => {
  console.log(`[BOOT] Listening on port ${PORT}`);
});