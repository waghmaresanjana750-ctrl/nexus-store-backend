const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================================
   DATABASE TEST
========================================= */

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


/* =========================================
   DATABASE SETUP
========================================= */

async function setupDatabase() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC DEFAULT 0,
      duration TEXT,
      prices JSONB DEFAULT '{}'::jsonb,
      video TEXT DEFAULT '',
      pid TEXT DEFAULT '',
      maintenance BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'active',
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

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS prices JSONB
      DEFAULT '{}'::jsonb;

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS video TEXT
      DEFAULT '';

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS pid TEXT
      DEFAULT '';

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS maintenance BOOLEAN
      DEFAULT FALSE;

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS status TEXT
      DEFAULT 'active';

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS duration TEXT;

  `);

  console.log("Database tables ready");
}

setupDatabase().catch(console.error);


/* =========================================
   HOME
========================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Nexus Store backend is working"
  });
});


/* =========================================
   HEALTH
========================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend is healthy"
  });
});


/* =========================================
   ADMIN AUTH
========================================= */

function checkAdmin(req, res) {

  const adminKey =
    req.headers["x-admin-key"];

  if (
    !adminKey ||
    adminKey !== process.env.ADMIN_KEY
  ) {

    res.status(401).json({
      ok: false,
      message: "Unauthorized"
    });

    return false;
  }

  return true;
}


/* =========================================
   GET PRODUCTS
========================================= */

app.get("/api/products", async (req, res) => {

  try {

    const result =
      await pool.query(
        `SELECT
          id,
          name,
          description,
          price,
          duration,
          prices,
          video,
          pid,
          maintenance,
          status,
          created_at
         FROM products
         ORDER BY id DESC`
      );

    res.json({
      ok: true,
      products: result.rows
    });

  } catch (error) {

    console.error(
      "GET PRODUCTS ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      message:
        "Products table is not ready yet"
    });

  }

});


/* =========================================
   ADD PRODUCT
========================================= */

app.post("/api/products", async (req, res) => {

  try {

    if (!checkAdmin(req, res))
      return;


    const {
      name,
      pid,
      description,
      video,
      price,
      duration,
      prices
    } = req.body;


    if (!name) {

      return res.status(400).json({
        ok: false,
        message:
          "Product name is required"
      });

    }


    /*
      Multi-duration prices
    */

    const productPrices =
      prices &&
      typeof prices === "object"
      ? prices
      : {};


    /*
      Main price fallback
    */

    let mainPrice =
      Number(price) || 0;


    if (
      !mainPrice &&
      productPrices["1 Day"]
    ) {

      mainPrice =
        Number(
          productPrices["1 Day"]
        ) || 0;

    }


    const result =
      await pool.query(
        `INSERT INTO products
        (
          name,
          pid,
          description,
          video,
          price,
          duration,
          prices,
          maintenance,
          status
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          FALSE,
          'active'
        )
        RETURNING *`,
        [
          name,
          pid || "",
          description || "",
          video || "",
          mainPrice,
          duration || "",
          JSON.stringify(
            productPrices
          )
        ]
      );


    res.status(201).json({
      ok: true,
      message:
        "Product added successfully",
      product:
        result.rows[0]
    });


  } catch (error) {

    console.error(
      "ADD PRODUCT ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      message:
        "Failed to create product"
    });

  }

});


/* =========================================
   MAINTENANCE ON / OFF
========================================= */

app.patch(
  "/api/products/:id/maintenance",
  async (req, res) => {

    try {

      if (!checkAdmin(req, res))
        return;


      const id =
        Number(req.params.id);


      if (!Number.isInteger(id)) {

        return res.status(400).json({
          ok: false,
          message:
            "Invalid product ID"
        });

      }


      const maintenance =
        req.body.maintenance;


      if (
        typeof maintenance !==
        "boolean"
      ) {

        return res.status(400).json({
          ok: false,
          message:
            "maintenance must be true or false"
        });

      }


      const status =
        maintenance
        ? "maintenance"
        : "active";


      const result =
        await pool.query(
          `UPDATE products
           SET
             maintenance = $1,
             status = $2
           WHERE id = $3
           RETURNING *`,
          [
            maintenance,
            status,
            id
          ]
        );


      if (!result.rows.length) {

        return res.status(404).json({
          ok: false,
          message:
            "Product not found"
        });

      }


      res.json({
        ok: true,
        message:
          maintenance
          ? "Maintenance enabled"
          : "Maintenance disabled",
        product:
          result.rows[0]
      });


    } catch (error) {

      console.error(
        "MAINTENANCE ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to update maintenance"
      });

    }

  }
);


/* =========================================
   UPDATE PRODUCT
========================================= */

app.patch(
  "/api/products/:id",
  async (req, res) => {

    try {

      if (!checkAdmin(req, res))
        return;


      const id =
        Number(req.params.id);


      if (!Number.isInteger(id)) {

        return res.status(400).json({
          ok: false,
          message:
            "Invalid product ID"
        });

      }


      const {
        name,
        pid,
        description,
        video,
        price,
        duration,
        prices
      } = req.body;


      const result =
        await pool.query(
          `UPDATE products
           SET
             name =
               COALESCE($1, name),

             pid =
               COALESCE($2, pid),

             description =
               COALESCE($3, description),

             video =
               COALESCE($4, video),

             price =
               COALESCE($5, price),

             duration =
               COALESCE($6, duration),

             prices =
               COALESCE(
                 $7::jsonb,
                 prices
               )

           WHERE id = $8

           RETURNING *`,
          [
            name ?? null,
            pid ?? null,
            description ?? null,
            video ?? null,
            price !== undefined
              ? Number(price)
              : null,
            duration ?? null,
            prices
              ? JSON.stringify(prices)
              : null,
            id
          ]
        );


      if (!result.rows.length) {

        return res.status(404).json({
          ok: false,
          message:
            "Product not found"
        });

      }


      res.json({
        ok: true,
        product:
          result.rows[0]
      });


    } catch (error) {

      console.error(
        "UPDATE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to update product"
      });

    }

  }
);


/* =========================================
   DELETE PRODUCT
========================================= */

app.delete(
  "/api/products/:id",
  async (req, res) => {

    try {

      if (!checkAdmin(req, res))
        return;


      const id =
        Number(req.params.id);


      if (!Number.isInteger(id)) {

        return res.status(400).json({
          ok: false,
          message:
            "Invalid product ID"
        });

      }


      const result =
        await pool.query(
          `DELETE FROM products
           WHERE id = $1
           RETURNING *`,
          [id]
        );


      if (!result.rows.length) {

        return res.status(404).json({
          ok: false,
          message:
            "Product not found"
        });

      }


      res.json({
        ok: true,
        message:
          "Product deleted",
        product:
          result.rows[0]
      });


    } catch (error) {

      console.error(
        "DELETE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to delete product"
      });

    }

  }
);


/* =========================================
   WALLET
========================================= */

app.get(
  "/api/wallet",
  (req, res) => {

    res.json({
      ok: true,
      balance: 0
    });

  }
);


/* =========================================
   ORDERS
========================================= */

app.get(
  "/api/orders",
  (req, res) => {

    res.json({
      ok: true,
      orders: []
    });

  }
);


/* =========================================
   SERVER
========================================= */

const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);
