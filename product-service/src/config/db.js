const { Pool } = require("pg");

const sslConfig =
  process.env.DATABASE_SSL === "true" ||
  (process.env.DATABASE_URL && process.env.DATABASE_URL.includes("supabase.co"))
    ? { rejectUnauthorized: false }
    : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
