const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[DB] WARNING: DATABASE_URL is not set');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err);
});

module.exports = pool;