const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://ta_aqui_db_user:Dw9Qzyz0YhEMw6JACsevgF5AQURMyXgG@dpg-d45osifdiees738dv79g-a.oregon-postgres.render.com/ta_aqui_db';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
