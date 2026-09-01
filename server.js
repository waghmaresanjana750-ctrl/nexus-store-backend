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

    console.error("DB TEST ERROR:", error);

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
    
    /* PRODUCTS */

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price NUMERIC DEFAULT 0,
      duration TEXT DEFAULT '',
      prices JSONB DEFAULT '{}'::jsonb,
      video TEXT DEFAULT '',
      pid TEXT DEFAULT '',
      category TEXT DEFAULT 'ALL',
      maintenance BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );


    /* CUSTOMERS */

    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT DEFAULT '',
      email TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );


    /* WALLETS */

    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER UNIQUE
        REFERENCES customers(id)
        ON DELETE CASCADE,

      balance NUMERIC(12,2)
        DEFAULT 0
        CHECK (balance >= 0),

      updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );


    /* ORDERS */

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,

      customer_id INTEGER
        REFERENCES customers(id)
        ON DELETE SET NULL,

      product_id INTEGER
        REFERENCES products(id)
        ON DELETE SET NULL,

      product_name TEXT DEFAULT '',

      pid TEXT DEFAULT '',

      duration TEXT DEFAULT '',

      amount NUMERIC(12,2)
        DEFAULT 0,

      status TEXT
        DEFAULT 'completed',

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );


    /* PRODUCT COLUMNS FOR OLD DATABASE */

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
      ADD COLUMN IF NOT EXISTS category TEXT
      DEFAULT 'ALL';

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


/* =========================================
   START DATABASE SETUP
========================================= */

setupDatabase().catch(error => {

  console.error(
    "DATABASE SETUP ERROR:",
    error
  );

});


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
   GET PRODUCTS
========================================= */

app.get("/api/products", async (req, res) => {

  try {

    const result =
      await pool.query(`
        SELECT
          id,
          name,
          description,
          price,
          duration,
          prices,
          video,
          pid,
          category,
          maintenance,
          status,
          created_at

        FROM products

        ORDER BY id DESC
      `);


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
      category,
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


    const productPrices =
      prices &&
      typeof prices === "object"
        ? prices
        : {};


    let mainPrice =
      Number(price) || 0;


    if (
      !mainPrice &&
      productPrices["1 Day"] !== undefined
    ) {

      mainPrice =
        Number(
          productPrices["1 Day"]
        ) || 0;

    }


    const result =
      await pool.query(
        `
        INSERT INTO products
        (
          name,
          pid,
          category,
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
          $7,
          $8::jsonb,
          FALSE,
          'active'
        )

        RETURNING *
        `,
        [
          name,
          pid || "",
          category || "ALL",
          description || "",
          video || "",
          mainPrice,
          duration || "",
          JSON.stringify(productPrices)
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
          `
          UPDATE products

          SET
            maintenance = $1,
            status = $2

          WHERE id = $3

          RETURNING *
          `,
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
        category,
        description,
        video,
        price,
        duration,
        prices
      } = req.body;


      const result =
        await pool.query(
          `
          UPDATE products

          SET

            name =
              COALESCE($1, name),

            pid =
              COALESCE($2, pid),

            category =
              COALESCE($3, category),

            description =
              COALESCE($4, description),

            video =
              COALESCE($5, video),

            price =
              COALESCE($6, price),

            duration =
              COALESCE($7, duration),

            prices =
              COALESCE(
                $8::jsonb,
                prices
              )

          WHERE id = $9

          RETURNING *
          `,
          [

            name ?? null,

            pid ?? null,

            category ?? null,

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
          `
          DELETE FROM products

          WHERE id = $1

          RETURNING *
          `,
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
   CREATE / GET CUSTOMER
========================================= */

app.post(
  "/api/customers",
  async (req, res) => {

    try {

      const {
        name,
        email
      } = req.body;


      if (!email) {

        return res.status(400).json({
          ok: false,
          message:
            "Email is required"
        });

      }


      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();


      const cleanName =
        String(name || "")
          .trim();


      /*
        Create customer if not exists.
        Otherwise update name.
      */

      const customerResult =
        await pool.query(
          `
          INSERT INTO customers
          (
            name,
            email
          )

          VALUES
          (
            $1,
            $2
          )

          ON CONFLICT(email)

          DO UPDATE SET
            name = EXCLUDED.name

          RETURNING *
          `,
          [
            cleanName,
            cleanEmail
          ]
        );


      const customer =
        customerResult.rows[0];


      /*
        Create wallet automatically.
      */

      const walletResult =
        await pool.query(
          `
          INSERT INTO wallets
          (
            customer_id,
            balance
          )

          VALUES
          (
            $1,
            0
          )

          ON CONFLICT(customer_id)
          DO NOTHING

          RETURNING *
          `,
          [
            customer.id
          ]
        );


      let wallet;


      if(walletResult.rows.length){

        wallet =
          walletResult.rows[0];

      }else{

        const existingWallet =
          await pool.query(
            `
            SELECT *
            FROM wallets
            WHERE customer_id = $1
            `,
            [
              customer.id
            ]
          );

        wallet =
          existingWallet.rows[0];

      }


      res.json({
        ok: true,

        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email
        },

        wallet: {
          balance:
            Number(wallet.balance)
        }
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
   GET CUSTOMER
========================================= */

app.get(
  "/api/customers/:id",
  async (req, res) => {

    try {

      const customerId =
        Number(req.params.id);


      if(!Number.isInteger(customerId)){

        return res.status(400).json({
          ok: false,
          message:
            "Invalid customer ID"
        });

      }


      const result =
        await pool.query(
          `
          SELECT
            c.id,
            c.name,
            c.email,
            c.created_at,

            COALESCE(
              w.balance,
              0
            ) AS balance

          FROM customers c

          LEFT JOIN wallets w
            ON w.customer_id = c.id

          WHERE c.id = $1
          `,
          [
            customerId
          ]
        );


      if(!result.rows.length){

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


    } catch(error){

      console.error(
        "GET CUSTOMER ERROR:",
        error
      );


      res.status(500).json({
        ok: false,
        message:
          "Failed to get customer"
      });

    }

  }
);


/* =========================================
   WALLET BALANCE
========================================= */

app.get(
  "/api/wallet/:customerId",
  async (req, res) => {

    try {

      const customerId =
        Number(
          req.params.customerId
        );


      if(!Number.isInteger(customerId)){

        return res.status(400).json({
          ok: false,
          message:
            "Invalid customer ID"
        });

      }


      const result =
        await pool.query(
          `
          SELECT
            c.id AS customer_id,

            COALESCE(
              w.balance,
              0
            ) AS balance

          FROM customers c

          LEFT JOIN wallets w
            ON w.customer_id = c.id

          WHERE c.id = $1
          `,
          [
            customerId
          ]
        );


      if(!result.rows.length){

        return res.status(404).json({
          ok: false,
          message:
            "Customer not found"
        });

      }


      res.json({
        ok: true,

        customer_id:
          result.rows[0].customer_id,

        balance:
          Number(
            result.rows[0].balance
          )
      });


    } catch(error){

      console.error(
        "GET WALLET ERROR:",
        error
      );


      res.status(500).json({
        ok: false,
        message:
          "Failed to get wallet"
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

    try {

      if (!checkAdmin(req, res))
        return;


      const customerId =
        Number(
          req.params.customerId
        );


      const amount =
        Number(
          req.body.amount
        );


      if(
        !Number.isInteger(customerId) ||
        !isFinite(amount) ||
        amount <= 0
      ){

        return res.status(400).json({
          ok: false,
          message:
            "Invalid customer ID or amount"
        });

      }


      await pool.query(
        `
        INSERT INTO wallets
        (
          customer_id,
          balance
        )

        VALUES
        (
          $1,
          $2
        )

        ON CONFLICT(customer_id)

        DO UPDATE SET

          balance =
            wallets.balance +
            EXCLUDED.balance,

          updated_at =
            CURRENT_TIMESTAMP
        `,
        [
          customerId,
          amount
        ]
      );


      const result =
        await pool.query(
          `
          SELECT balance
          FROM wallets
          WHERE customer_id = $1
          `,
          [
            customerId
          ]
        );


      res.json({
        ok: true,

        message:
          "Wallet balance added",

        balance:
          Number(
            result.rows[0].balance
          )
      });


    } catch(error){

      console.error(
        "ADD WALLET ERROR:",
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
   BUY PRODUCT
========================================= */

app.post(
  "/api/purchase",
  async (req, res) => {

    const client =
      await pool.connect();


    try {

      const {
        customerId,
        productId,
        duration
      } = req.body;


      const customerID =
        Number(customerId);

      const productID =
        Number(productId);


      if(
        !Number.isInteger(customerID) ||
        !Number.isInteger(productID) ||
        !duration
      ){

        return res.status(400).json({
          ok: false,
          message:
            "customerId, productId and duration are required"
        });

      }


      await client.query(
        "BEGIN"
      );


      /*
        Check customer.
      */

      const customerResult =
        await client.query(
          `
          SELECT id
          FROM customers
          WHERE id = $1
          `,
          [
            customerID
          ]
        );


      if(!customerResult.rows.length){

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          ok: false,
          message:
            "Customer not found"
        });

      }


      /*
        Lock product row.
        This prevents buying while its
        maintenance state is being changed.
      */

      const productResult =
        await client.query(
          `
          SELECT *
          FROM products
          WHERE id = $1
          FOR UPDATE
          `,
          [
            productID
          ]
        );


      if(!productResult.rows.length){

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


      /*
        Maintenance protection.
      */

      if(
        product.maintenance === true ||
        String(product.status || "")
          .toLowerCase()
          .includes("maintenance")
      ){

        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          ok: false,
          message:
            "Product is currently under maintenance"
        });

      }


      /*
        Read selected duration price.
      */

      let prices =
        product.prices;


      if(
        !prices ||
        typeof prices !== "object"
      ){

        prices = {};

      }


      let amount;


      if(
        Object.prototype.hasOwnProperty.call(
          prices,
          duration
        )
      ){

        amount =
          Number(
            prices[duration]
          );

      }else{

        /*
          Backward compatibility:
          old products may only have
          price + duration.
        */

        if(
          String(product.duration || "") ===
          String(duration)
        ){

          amount =
            Number(
              product.price || 0
            );

        }else{

          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            ok: false,
            message:
              "Selected duration is not available"
          });

        }

      }


      if(
        !isFinite(amount) ||
        amount <= 0
      ){

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Invalid product price"
        });

      }


      /*
        Lock wallet.
      */

      const walletResult =
        await client.query(
          `
          SELECT *
          FROM wallets

          WHERE customer_id = $1

          FOR UPDATE
          `,
          [
            customerID
          ]
        );


      if(!walletResult.rows.length){

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Wallet not found"
        });

      }


      const currentBalance =
        Number(
          walletResult.rows[0].balance
        );


      /*
        Insufficient balance.
      */

      if(currentBalance < amount){

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,

          message:
            "Insufficient wallet balance",

          balance:
            currentBalance,

          required:
            amount
        });

      }


      /*
        Deduct balance.
      */

      const newBalance =
        currentBalance - amount;


      await client.query(
        `
        UPDATE wallets

        SET
          balance = $1,
          updated_at = CURRENT_TIMESTAMP

        WHERE customer_id = $2
        `,
        [
          newBalance,
          customerID
        ]
      );


      /*
        Create order.
      */

      const orderResult =
        await client.query(
          `
          INSERT INTO orders
          (
            customer_id,
            product_id,
            product_name,
            pid,
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
            $6,
            'completed'
          )

          RETURNING *
          `,
          [
            customerID,
            productID,
            product.name,
            product.pid || "",
            duration,
            amount
          ]
        );


      /*
        Everything succeeded.
      */

      await client.query(
        "COMMIT"
      );


      res.json({
        ok: true,

        message:
          "Purchase successful",

        balance:
          Number(
            newBalance.toFixed(2)
          ),

        order:
          orderResult.rows[0]
      });


    } catch(error){

      try {

        await client.query(
          "ROLLBACK"
        );

      } catch(rollbackError) {

        console.error(
          "ROLLBACK ERROR:",
          rollbackError
        );

      }


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
   GET CUSTOMER ORDERS
========================================= */

app.get(
  "/api/orders/:customerId",
  async (req, res) => {

    try {

      const customerId =
        Number(
          req.params.customerId
        );


      if(!Number.isInteger(customerId)){

        return res.status(400).json({
          ok: false,
          message:
            "Invalid customer ID"
        });

      }


      const result =
        await pool.query(
          `
          SELECT
            id,
            customer_id,
            product_id,
            product_name,
            pid,
            duration,
            amount,
            status,
            created_at

          FROM orders

          WHERE customer_id = $1

          ORDER BY id DESC
          `,
          [
            customerId
          ]
        );


      res.json({
        ok: true,
        orders:
          result.rows
      });


    } catch(error){

      console.error(
        "GET ORDERS ERROR:",
        error
      );


      res.status(500).json({
        ok: false,
        message:
          "Failed to get orders"
      });

    }

  }
);


/* =========================================
   ADMIN - ALL CUSTOMERS
========================================= */

app.get(
  "/api/admin/customers",
  async (req, res) => {

    try {

      if (!checkAdmin(req, res))
        return;


      const result =
        await pool.query(
          `
          SELECT

            c.id,
            c.name,
            c.email,
            c.created_at,

            COALESCE(
              w.balance,
              0
            ) AS balance,

            COUNT(o.id)
              AS total_orders,

            COALESCE(
              SUM(o.amount),
              0
            ) AS total_spent

          FROM customers c

          LEFT JOIN wallets w
            ON w.customer_id = c.id

          LEFT JOIN orders o
            ON o.customer_id = c.id

          GROUP BY
            c.id,
            w.balance

          ORDER BY c.id DESC
          `
        );


      res.json({
        ok: true,
        customers:
          result.rows
      });


    } catch(error){

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
   ADMIN - ALL ORDERS
========================================= */

app.get(
  "/api/admin/orders",
  async (req, res) => {

    try {

      if (!checkAdmin(req, res))
        return;


      const result =
        await pool.query(
          `
          SELECT

            o.*,

            c.name AS customer_name,
            c.email AS customer_email

          FROM orders o

          LEFT JOIN customers c
            ON c.id = o.customer_id

          ORDER BY o.id DESC
          `
        );


      res.json({
        ok: true,
        orders:
          result.rows
      });


    } catch(error){

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
   OLD WALLET API
========================================= */

app.get(
  "/api/wallet",
  (req, res) => {

    res.json({
      ok: true,
      balance: 0,

      message:
        "Use /api/wallet/:customerId"
    });

  }
);


/* =========================================
   OLD ORDERS API
========================================= */

app.get(
  "/api/orders",
  (req, res) => {

    res.json({
      ok: true,
      orders: [],

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
      message: "API route not found"
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
