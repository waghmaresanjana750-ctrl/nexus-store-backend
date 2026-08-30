const express = require("express");
const { Pool } = require("pg");

const app = express();

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Database test
app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      ok: true,
      database: "connected",
      time: result.rows[0].now
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      database: "connection failed"
    });
  }
});

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id),
      balance NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id),
      product_id INTEGER REFERENCES products(id),
      amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Database tables ready");
}

setupDatabase().catch(console.error);

// Home
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Nexus Store backend is working"
  });
});

// Health
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend is healthy"
  });
});

// Products
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products ORDER BY id DESC"
    );

    res.json({
      ok: true,
      products: result.rows
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      message: "Products table is not ready yet"
    });
  }
});

// Wallet
app.get("/api/wallet", (req, res) => {
  res.json({
    ok: true,
    balance: 0
  });
});

// Orders
app.get("/api/orders", (req, res) => {
  res.json({
    ok: true,
    orders: []
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
