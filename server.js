const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* =========================================
   DATABASE
========================================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================================
   DATABASE SETUP
========================================= */

async function setupDatabase() {
  try {

    /* =========================================
       CREATE TABLES
    ========================================= */

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        price NUMERIC(12,2) DEFAULT 0,
        duration TEXT DEFAULT '',
        prices JSONB DEFAULT '{}'::jsonb,
        video TEXT DEFAULT '',
        pid TEXT DEFAULT '',
        category TEXT DEFAULT '',
        maintenance BOOLEAN DEFAULT false,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER UNIQUE NOT NULL
          REFERENCES customers(id)
          ON DELETE CASCADE,
        balance NUMERIC(12,2) NOT NULL DEFAULT 0
          CHECK (balance >= 0),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL
          REFERENCES customers(id)
          ON DELETE CASCADE,
        product_id INTEGER NOT NULL
          REFERENCES products(id)
          ON DELETE CASCADE,
        product_name TEXT DEFAULT '',
        duration TEXT DEFAULT '',
        amount NUMERIC(12,2) NOT NULL,
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS wallet_requests (
        id SERIAL PRIMARY KEY,

        customer_id INTEGER NOT NULL
          REFERENCES customers(id)
          ON DELETE CASCADE,

        amount NUMERIC(12,2) NOT NULL
          CHECK (amount > 0),

        utr TEXT NOT NULL,

        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (
            status IN (
              'pending',
              'approved',
              'rejected'
            )
          ),

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        reviewed_at TIMESTAMP
      );
    `);

    /* =========================================
       OLD DATABASE FIXES
       IMPORTANT
    ========================================= */

    await pool.query(`
      ALTER TABLE wallets
      ADD COLUMN IF NOT EXISTS updated_at
      TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS description
      TEXT DEFAULT '';

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS price
      NUMERIC(12,2) DEFAULT 0;

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS duration
      TEXT DEFAULT '';

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS prices
      JSONB DEFAULT '{}'::jsonb;

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS video
      TEXT DEFAULT '';

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS pid
      TEXT DEFAULT '';

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS category
      TEXT DEFAULT '';

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS maintenance
      BOOLEAN DEFAULT false;

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS status
      TEXT DEFAULT 'active';
    `);

    /* =========================================
       UNIQUE INDEXES
    ========================================= */

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
      wallets_customer_id_unique
      ON wallets(customer_id);
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
      wallet_requests_utr_unique
      ON wallet_requests(LOWER(utr));
    `);

    console.log("DATABASE SETUP COMPLETE");

  } catch (error) {

    console.error(
      "DATABASE SETUP ERROR:",
      error
    );
  }
}

/* =========================================
   START DATABASE SETUP
========================================= */

setupDatabase();

/* =========================================
   ADMIN AUTH
========================================= */

function checkAdmin(req, res) {

  const adminKey =
    req.headers["x-admin-key"];

  if (
    !adminKey ||
    !process.env.ADMIN_KEY ||
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
   HEALTH
========================================= */

app.get("/", (req, res) => {

  res.json({
    ok: true,
    message: "NEXUS STORE BACKEND RUNNING"
  });
});

/* =========================================
   DB TEST
========================================= */

app.get("/api/db-test", async (req, res) => {

  try {

    const result =
      await pool.query(`
        SELECT NOW() AS time
      `);

    res.json({
      ok: true,
      database: "connected",
      time: result.rows[0].time
    });

  } catch (error) {

    console.error(
      "DB TEST ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      message: "Database connection failed"
    });
  }
});

/* =========================================
   PRODUCTS - PUBLIC
========================================= */

app.get("/api/products", async (req, res) => {

  try {

    const result =
      await pool.query(`
        SELECT *
        FROM products
        ORDER BY id DESC
      `);

    res.json({
      ok: true,
      products: result.rows
    });

  } catch (error) {

    console.error(
      "PRODUCT GET ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      message: "Failed to load products"
    });
  }
});

/* =========================================
   PRODUCTS - ADMIN ADD
========================================= */

app.post("/api/products", async (req, res) => {

  if (!checkAdmin(req, res)) return;

  try {

    const {
      name,
      description = "",
      price = 0,
      duration = "",
      prices = {},
      video = "",
      pid = "",
      category = "",
      maintenance = false,
      status = "active"
    } = req.body;

    if (
      !name ||
      !String(name).trim()
    ) {

      return res.status(400).json({
        ok: false,
        message: "Product name required"
      });
    }

    const result =
      await pool.query(`
        INSERT INTO products
        (
          name,
          description,
          price,
          duration,
          prices,
          video,
          pid,
          category,
          maintenance,
          status
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `, [
        String(name).trim(),
        description,
        Number(price) || 0,
        duration,
        prices,
        video,
        pid,
        category,
        Boolean(maintenance),
        status
      ]);

    res.json({
      ok: true,
      product: result.rows[0]
    });

  } catch (error) {

    console.error(
      "PRODUCT CREATE ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      message: "Failed to create product"
    });
  }
});

/* =========================================
   PRODUCT MAINTENANCE
========================================= */

app.patch(
  "/api/products/:id/maintenance",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    try {

      const id =
        Number(req.params.id);

      const maintenance =
        Boolean(req.body.maintenance);

      const result =
        await pool.query(`
          UPDATE products
          SET maintenance = $1
          WHERE id = $2
          RETURNING *
        `, [
          maintenance,
          id
        ]);

      if (!result.rows.length) {

        return res.status(404).json({
          ok: false,
          message: "Product not found"
        });
      }

      res.json({
        ok: true,
        product: result.rows[0]
      });

    } catch (error) {

      console.error(
        "MAINTENANCE ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message: "Failed to update maintenance"
      });
    }
  }
);

/* =========================================
   PRODUCT UPDATE
========================================= */

app.patch(
  "/api/products/:id",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    try {

      const id =
        Number(req.params.id);

      const {
        name,
        description,
        price,
        duration,
        prices,
        video,
        pid,
        category,
        maintenance,
        status
      } = req.body;

      const result =
        await pool.query(`
          UPDATE products
          SET
            name =
              COALESCE($1, name),

            description =
              COALESCE($2, description),

            price =
              COALESCE($3, price),

            duration =
              COALESCE($4, duration),

            prices =
              COALESCE($5, prices),

            video =
              COALESCE($6, video),

            pid =
              COALESCE($7, pid),

            category =
              COALESCE($8, category),

            maintenance =
              COALESCE($9, maintenance),

            status =
              COALESCE($10, status)

          WHERE id = $11

          RETURNING *
        `, [
          name,
          description,
          price === undefined
            ? null
            : Number(price),
          duration,
          prices,
          video,
          pid,
          category,
          maintenance,
          status,
          id
        ]);

      if (!result.rows.length) {

        return res.status(404).json({
          ok: false,
          message: "Product not found"
        });
      }

      res.json({
        ok: true,
        product: result.rows[0]
      });

    } catch (error) {

      console.error(
        "PRODUCT UPDATE ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message: "Failed to update product"
      });
    }
  }
);

/* =========================================
   PRODUCT DELETE
========================================= */

app.delete(
  "/api/products/:id",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    try {

      const id =
        Number(req.params.id);

      const result =
        await pool.query(`
          DELETE FROM products
          WHERE id = $1
          RETURNING *
        `, [id]);

      if (!result.rows.length) {

        return res.status(404).json({
          ok: false,
          message: "Product not found"
        });
      }

      res.json({
        ok: true,
        message: "Product deleted"
      });

    } catch (error) {

      console.error(
        "PRODUCT DELETE ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message: "Failed to delete product"
      });
    }
  }
);

/* =========================================
   CUSTOMER CREATE / UPDATE
========================================= */

app.post(
  "/api/customers",
  async (req, res) => {

    try {

      const {
        name,
        email
      } = req.body;

      const cleanName =
        String(name || "").trim();

      const cleanEmail =
        String(email || "")
          .trim()
          .toLowerCase();

      if (
        !cleanName ||
        !cleanEmail
      ) {

        return res.status(400).json({
          ok: false,
          message:
            "Name and email required"
        });
      }

      const customerResult =
        await pool.query(`
          INSERT INTO customers
          (
            name,
            email
          )
          VALUES
          ($1,$2)

          ON CONFLICT (email)
          DO UPDATE SET
            name = EXCLUDED.name

          RETURNING *
        `, [
          cleanName,
          cleanEmail
        ]);

      const customer =
        customerResult.rows[0];

      const walletResult =
        await pool.query(`
          INSERT INTO wallets
          (
            customer_id,
            balance
          )
          VALUES
          ($1,0)

          ON CONFLICT (customer_id)
          DO UPDATE SET
            updated_at =
              CURRENT_TIMESTAMP

          RETURNING *
        `, [
          customer.id
        ]);

      res.json({
        ok: true,
        customer,
        wallet:
          walletResult.rows[0]
      });

    } catch (error) {

      console.error(
        "CUSTOMER CREATE ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to create customer"
      });
    }
  }
);

/* =========================================
   CUSTOMER GET
========================================= */

app.get(
  "/api/customers/:id",
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      const result =
        await pool.query(`
          SELECT
            c.*,

            COALESCE(
              w.balance,
              0
            ) AS balance

          FROM customers c

          LEFT JOIN wallets w
            ON w.customer_id = c.id

          WHERE c.id = $1
        `, [id]);

      if (!result.rows.length) {

        return res.status(404).json({
          ok: false,
          message:
            "Customer not found"
        });
      }

      res.json({
        ok: true,
        customer:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        "CUSTOMER GET ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to load customer"
      });
    }
  }
);

/* =========================================
   WALLET GET
========================================= */

app.get(
  "/api/wallet/:customerId",
  async (req, res) => {

    try {

      const customerId =
        Number(req.params.customerId);

      const result =
        await pool.query(`
          SELECT
            customer_id,
            balance,
            updated_at

          FROM wallets

          WHERE customer_id = $1
        `, [customerId]);

      if (!result.rows.length) {

        return res.json({
          ok: true,
          customerId,
          balance: 0
        });
      }

      res.json({
        ok: true,
        wallet:
          result.rows[0],
        balance:
          Number(
            result.rows[0].balance
          )
      });

    } catch (error) {

      console.error(
        "WALLET GET ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to load wallet"
      });
    }
  }
);

/* =========================================
   ADMIN ADD WALLET BALANCE
========================================= */

app.post(
  "/api/wallet/:customerId/add",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    try {

      const customerId =
        Number(req.params.customerId);

      const amount =
        Number(req.body.amount);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {

        return res.status(400).json({
          ok: false,
          message:
            "Invalid amount"
        });
      }

      const customer =
        await pool.query(`
          SELECT id
          FROM customers
          WHERE id = $1
        `, [customerId]);

      if (!customer.rows.length) {

        return res.status(404).json({
          ok: false,
          message:
            "Customer not found"
        });
      }

      const result =
        await pool.query(`
          INSERT INTO wallets
          (
            customer_id,
            balance
          )
          VALUES
          ($1,$2)

          ON CONFLICT (customer_id)
          DO UPDATE SET

            balance =
              wallets.balance +
              EXCLUDED.balance,

            updated_at =
              CURRENT_TIMESTAMP

          RETURNING *
        `, [
          customerId,
          amount
        ]);

      res.json({
        ok: true,
        wallet:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        "ADMIN WALLET ADD ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to add wallet balance"
      });
    }
  }
);

/* =========================================
   CREATE WALLET PAYMENT REQUEST
========================================= */

app.post(
  "/api/wallet-requests",
  async (req, res) => {

    try {

      const customerId =
        Number(req.body.customerId);

      const amount =
        Number(req.body.amount);

      const utr =
        String(
          req.body.utr || ""
        ).trim();

      if (!customerId) {

        return res.status(400).json({
          ok: false,
          message:
            "Customer ID required"
        });
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {

        return res.status(400).json({
          ok: false,
          message:
            "Invalid amount"
        });
      }

      if (amount > 1000000) {

        return res.status(400).json({
          ok: false,
          message:
            "Amount too large"
        });
      }

      if (
        !utr ||
        utr.length < 4 ||
        utr.length > 100
      ) {

        return res.status(400).json({
          ok: false,
          message:
            "Valid UTR required"
        });
      }

      const customerResult =
        await pool.query(`
          SELECT id
          FROM customers
          WHERE id = $1
        `, [customerId]);

      if (!customerResult.rows.length) {

        return res.status(404).json({
          ok: false,
          message:
            "Customer not found"
        });
      }

      try {

        const result =
          await pool.query(`
            INSERT INTO wallet_requests
            (
              customer_id,
              amount,
              utr
            )
            VALUES
            ($1,$2,$3)

            RETURNING *
          `, [
            customerId,
            amount,
            utr
          ]);

        res.json({
          ok: true,
          message:
            "Payment request submitted",
          request:
            result.rows[0]
        });

      } catch (insertError) {

        if (
          insertError.code ===
          "23505"
        ) {

          return res.status(409).json({
            ok: false,
            message:
              "This UTR has already been submitted"
          });
        }

        throw insertError;
      }

    } catch (error) {

      console.error(
        "WALLET REQUEST CREATE ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to submit payment request"
      });
    }
  }
);

/* =========================================
   CUSTOMER PAYMENT REQUESTS
========================================= */

app.get(
  "/api/wallet-requests/:customerId",
  async (req, res) => {

    try {

      const customerId =
        Number(req.params.customerId);

      const result =
        await pool.query(`
          SELECT
            id,
            customer_id,
            amount,
            utr,
            status,
            created_at,
            reviewed_at

          FROM wallet_requests

          WHERE customer_id = $1

          ORDER BY id DESC
        `, [customerId]);

      res.json({
        ok: true,
        requests:
          result.rows
      });

    } catch (error) {

      console.error(
        "CUSTOMER WALLET REQUEST ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to load payment requests"
      });
    }
  }
);

/* =========================================
   ADMIN - ALL WALLET REQUESTS
========================================= */

app.get(
  "/api/admin/wallet-requests",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    try {

      const result =
        await pool.query(`
          SELECT

            wr.id,
            wr.customer_id,
            wr.amount,
            wr.utr,
            wr.status,
            wr.created_at,
            wr.reviewed_at,

            c.name AS customer_name,
            c.email AS customer_email

          FROM wallet_requests wr

          JOIN customers c
            ON c.id = wr.customer_id

          ORDER BY

            CASE
              WHEN wr.status =
                'pending'
              THEN 0
              ELSE 1
            END,

            wr.id DESC
        `);

      res.json({
        ok: true,
        requests:
          result.rows
      });

    } catch (error) {

      console.error(
        "ADMIN WALLET REQUESTS ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to load payment requests"
      });
    }
  }
);

/* =========================================
   ADMIN - APPROVE / REJECT PAYMENT
========================================= */

app.patch(
  "/api/admin/wallet-requests/:id",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    const requestId =
      Number(req.params.id);

    const status =
      String(
        req.body.status || ""
      )
        .trim()
        .toLowerCase();

    if (
      ![
        "approved",
        "rejected"
      ].includes(status)
    ) {

      return res.status(400).json({
        ok: false,
        message:
          "Status must be approved or rejected"
      });
    }

    const client =
      await pool.connect();

    try {

      await client.query(
        "BEGIN"
      );

      /* =========================================
         LOCK PAYMENT REQUEST
      ========================================= */

      const requestResult =
        await client.query(`
          SELECT *
          FROM wallet_requests
          WHERE id = $1
          FOR UPDATE
        `, [requestId]);

      if (
        !requestResult.rows.length
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          ok: false,
          message:
            "Payment request not found"
        });
      }

      const request =
        requestResult.rows[0];

      /* =========================================
         PREVENT DOUBLE APPROVAL
      ========================================= */

      if (
        request.status !==
        "pending"
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          ok: false,
          message:
            `Request already ${request.status}`
        });
      }

      /* =========================================
         REJECT
      ========================================= */

      if (
        status === "rejected"
      ) {

        const result =
          await client.query(`
            UPDATE wallet_requests

            SET
              status =
                'rejected',

              reviewed_at =
                CURRENT_TIMESTAMP

            WHERE id = $1

            RETURNING *
          `, [requestId]);

        await client.query(
          "COMMIT"
        );

        return res.json({
          ok: true,
          message:
            "Payment request rejected",
          request:
            result.rows[0]
        });
      }

      /* =========================================
         CUSTOMER
      ========================================= */

      const customerResult =
        await client.query(`
          SELECT id
          FROM customers
          WHERE id = $1
          FOR UPDATE
        `, [
          request.customer_id
        ]);

      if (
        !customerResult.rows.length
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          ok: false,
          message:
            "Customer not found"
        });
      }

      /* =========================================
         ADD MONEY TO WALLET
      ========================================= */

      const walletResult =
        await client.query(`
          INSERT INTO wallets
          (
            customer_id,
            balance
          )
          VALUES
          ($1,$2)

          ON CONFLICT (customer_id)

          DO UPDATE SET

            balance =
              wallets.balance +
              EXCLUDED.balance,

            updated_at =
              CURRENT_TIMESTAMP

          RETURNING *
        `, [
          request.customer_id,
          request.amount
        ]);

      /* =========================================
         UPDATE REQUEST
      ========================================= */

      const updateResult =
        await client.query(`
          UPDATE wallet_requests

          SET
            status =
              'approved',

            reviewed_at =
              CURRENT_TIMESTAMP

          WHERE id = $1

          RETURNING *
        `, [requestId]);

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        message:
          "Payment approved and wallet credited",
        request:
          updateResult.rows[0],
        wallet:
          walletResult.rows[0]
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "PAYMENT REVIEW ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to review payment request"
      });

    } finally {

      client.release();
    }
  }
);

/* =========================================
   PURCHASE PRODUCT
========================================= */

app.post(
  "/api/purchase",
  async (req, res) => {

    const customerId =
      Number(req.body.customerId);

    const productId =
      Number(req.body.productId);

    const duration =
      String(
        req.body.duration || ""
      ).trim();

    if (
      !customerId ||
      !productId
    ) {

      return res.status(400).json({
        ok: false,
        message:
          "Customer and product required"
      });
    }

    const client =
      await pool.connect();

    try {

      await client.query(
        "BEGIN"
      );

      /* =========================================
         CUSTOMER
      ========================================= */

      const customerResult =
        await client.query(`
          SELECT *
          FROM customers
          WHERE id = $1
        `, [customerId]);

      if (
        !customerResult.rows.length
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          ok: false,
          message:
            "Customer not found"
        });
      }

      /* =========================================
         PRODUCT
      ========================================= */

      const productResult =
        await client.query(`
          SELECT *
          FROM products
          WHERE id = $1
          FOR UPDATE
        `, [productId]);

      if (
        !productResult.rows.length
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          ok: false,
          message:
            "Product not found"
        });
      }

      const product =
        productResult.rows[0];

      /* =========================================
         MAINTENANCE
      ========================================= */

      if (
        product.maintenance === true ||
        product.status !== "active"
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Product is currently unavailable"
        });
      }

      /* =========================================
         PRICE
      ========================================= */

      let amount =
        Number(
          product.price || 0
        );

      if (
        product.prices &&
        typeof product.prices ===
          "object" &&
        duration &&
        product.prices[duration] !==
          undefined
      ) {

        amount =
          Number(
            product.prices[duration]
          );
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Invalid product price"
        });
      }

      /* =========================================
         LOCK WALLET
      ========================================= */

      const walletResult =
        await client.query(`
          SELECT *
          FROM wallets
          WHERE customer_id = $1
          FOR UPDATE
        `, [customerId]);

      if (
        !walletResult.rows.length
      ) {

        await client.query(`
          INSERT INTO wallets
          (
            customer_id,
            balance
          )
          VALUES
          ($1,0)

          ON CONFLICT (customer_id)
          DO NOTHING
        `, [customerId]);

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Wallet has no balance"
        });
      }

      const wallet =
        walletResult.rows[0];

      const balance =
        Number(wallet.balance);

      if (
        balance < amount
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Insufficient wallet balance"
        });
      }

      /* =========================================
         DEDUCT WALLET
      ========================================= */

      const newBalance =
        balance - amount;

      await client.query(`
        UPDATE wallets

        SET
          balance = $1,
          updated_at =
            CURRENT_TIMESTAMP

        WHERE customer_id = $2
      `, [
        newBalance,
        customerId
      ]);

      /* =========================================
         CREATE ORDER
      ========================================= */

      const orderResult =
        await client.query(`
          INSERT INTO orders
          (
            customer_id,
            product_id,
            product_name,
            duration,
            amount,
            status
          )

          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            'completed'
          )

          RETURNING *
        `, [
          customerId,
          product.id,
          product.name,
          duration,
          amount
        ]);

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        message:
          "Purchase successful",
        order:
          orderResult.rows[0],
        balance:
          newBalance
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "PURCHASE ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Purchase failed"
      });

    } finally {

      client.release();
    }
  }
);

/* =========================================
   CUSTOMER ORDERS
========================================= */

app.get(
  "/api/orders/:customerId",
  async (req, res) => {

    try {

      const customerId =
        Number(req.params.customerId);

      const result =
        await pool.query(`
          SELECT *
          FROM orders
          WHERE customer_id = $1
          ORDER BY id DESC
        `, [customerId]);

      res.json({
        ok: true,
        orders:
          result.rows
      });

    } catch (error) {

      console.error(
        "ORDERS GET ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to load orders"
      });
    }
  }
);

/* =========================================
   ADMIN CUSTOMERS
========================================= */

app.get(
  "/api/admin/customers",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    try {

      const result =
        await pool.query(`
          SELECT

            c.id,
            c.name,
            c.email,
            c.created_at,

            COALESCE(
              w.balance,
              0
            ) AS balance,

            COUNT(o.id)::INTEGER
              AS purchases,

            COALESCE(
              SUM(
                CASE
                  WHEN o.status =
                    'completed'
                  THEN o.amount
                  ELSE 0
                END
              ),
              0
            ) AS spent

          FROM customers c

          LEFT JOIN wallets w
            ON w.customer_id = c.id

          LEFT JOIN orders o
            ON o.customer_id = c.id

          GROUP BY
            c.id,
            c.name,
            c.email,
            c.created_at,
            w.balance

          ORDER BY
            c.id DESC
        `);

      res.json({
        ok: true,
        customers:
          result.rows
      });

    } catch (error) {

      console.error(
        "ADMIN CUSTOMERS ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to load customers"
      });
    }
  }
);

/* =========================================
   ADMIN ORDERS
========================================= */

app.get(
  "/api/admin/orders",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    try {

      const result =
        await pool.query(`
          SELECT

            o.*,

            c.name AS customer_name,
            c.email AS customer_email,

            p.name AS product_name_db

          FROM orders o

          JOIN customers c
            ON c.id = o.customer_id

          LEFT JOIN products p
            ON p.id = o.product_id

          ORDER BY
            o.id DESC
        `);

      res.json({
        ok: true,
        orders:
          result.rows
      });

    } catch (error) {

      console.error(
        "ADMIN ORDERS ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to load orders"
      });
    }
  }
);

/* =========================================
   ADMIN STATS
========================================= */

app.get(
  "/api/admin/stats",
  async (req, res) => {

    if (!checkAdmin(req, res)) return;

    try {

      const usersResult =
        await pool.query(`
          SELECT
            COUNT(*)::INTEGER AS count
          FROM customers
        `);

      const ordersResult =
        await pool.query(`
          SELECT
            COUNT(*)::INTEGER AS count
          FROM orders
          WHERE status = 'completed'
        `);

      const salesResult =
        await pool.query(`
          SELECT
            COALESCE(
              SUM(amount),
              0
            ) AS total

          FROM orders

          WHERE status =
            'completed'
        `);

      const pendingResult =
        await pool.query(`
          SELECT
            COUNT(*)::INTEGER AS count

          FROM wallet_requests

          WHERE status =
            'pending'
        `);

      res.json({

        ok: true,

        users:
          usersResult.rows[0].count,

        orders:
          ordersResult.rows[0].count,

        sales:
          Number(
            salesResult.rows[0].total ||
            0
          ),

        pendingPayments:
          pendingResult.rows[0].count
      });

    } catch (error) {

      console.error(
        "ADMIN STATS ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Failed to load stats"
      });
    }
  }
);

/* =========================================
   LEGACY WALLET
========================================= */

app.get(
  "/api/wallet",
  async (req, res) => {

    res.json({
      ok: false,
      message:
        "Use /api/wallet/:customerId"
    });
  }
);

/* =========================================
   LEGACY ORDERS
========================================= */

app.get(
  "/api/orders",
  async (req, res) => {

    res.json({
      ok: false,
      message:
        "Use /api/orders/:customerId"
    });
  }
);

/* =========================================
   404
========================================= */

app.use(
  (req, res) => {

    res.status(404).json({
      ok: false,
      message:
        "Route not found"
    });
  }
);

/* =========================================
   GLOBAL ERROR
========================================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "GLOBAL ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      message:
        "Internal server error"
    });
  }
);

/* =========================================
   START SERVER
========================================= */

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {

    console.log(`
=========================================
 NEXUS STORE BACKEND
 PORT: ${PORT}
=========================================
`);
  }
);
