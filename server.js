const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config();

const app = express();

// --- DATABASE CONNECTION ---
// Uses the DATABASE_URL from Render's Environment Variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Render's SSL connection
});

app.use(express.json());

// --- SESSION CONFIGURATION ---
app.use(
  session({
    secret: "secret123", // Ideally move this to an env var in production
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production", // True on Render (HTTPS)
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: "lax",
    },
  })
);

// --- MIDDLEWARE FUNCTIONS ---

function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.xhr || req.headers.accept?.includes("application/json")) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    return res.redirect("/login.html");
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    if (req.xhr || req.headers.accept?.includes("application/json")) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    return res.redirect("/login.html");
  }
  next();
}

/* ---------------- DATABASE INITIALIZATION ---------------- */

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users(
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages(
        id SERIAL PRIMARY KEY,
        fromUser TEXT,
        toUser TEXT,
        subject TEXT,
        body TEXT,
        threadId INTEGER,
        read INTEGER DEFAULT 0
      )
    `);
    console.log("✅ Database tables initialized successfully.");
  } catch (err) {
    console.error("❌ Error initializing database:", err.message);
  } finally {
    client.release();
  }
}

// Initialize DB on startup
initDB().catch(console.error);

/* ---------------- AUTH ROUTES ---------------- */

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, error: "Missing credentials" });
  }

  // Hardcoded Admin Login
  if (username === "admin" && password === "adminpass") {
    req.session.user = "admin";
    req.session.admin = true;
    return res.json({ success: true, isAdmin: true });
  }

  // Regular User Login
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

    if (result.rows.length === 0) {
      return res.json({ success: false, error: "User not found" });
    }

    const user = result.rows[0];

    // WARNING: In production, use bcrypt to hash passwords!
    // Currently storing plain text as per your original code
    if (user.password !== password) {
      return res.json({ success: false, error: "Wrong password" });
    }

    req.session.user = user.username;
    req.session.admin = false;
    res.json({ success: true, isAdmin: false });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "Database error" });
  }
});

app.post("/signup", async (req, res) => {
  const { username, password } = req.body;

  try {
    await pool.query("INSERT INTO users(username, password) VALUES($1, $2)", [username, password]);
    res.json({ success: true });
  } catch (err) {
    if (err.code === "23505") {
      res.json({ success: false, error: "Username exists" });
    } else {
      console.error(err);
      res.json({ success: false, error: "Database error" });
    }
  }
});

// --- ROBUST LOGOUT HANDLER ---
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ success: false, error: "Could not log out" });
    }

    // Explicitly clear the session cookie
    // This is critical for Render/Production environments
    res.clearCookie("connect.sid", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    res.json({ success: true });
  });
});

/* ---------------- PROTECTED HTML PAGES ---------------- */

app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

app.get("/inbox.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/inbox.html"));
});

app.get("/sent.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/sent.html"));
});

app.get("/compose.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/compose.html"));
});

/* ---------------- API ROUTES ---------------- */

app.post("/api/send", requireAuth, async (req, res) => {
  const { toUser, subject, body, threadId } = req.body;
  const sender = req.session.user;
  const tId = threadId || Date.now();

  try {
    // Check for duplicate
    const check = await pool.query(
      `SELECT id FROM messages 
       WHERE fromUser=$1 AND toUser=$2 AND subject=$3 AND body=$4 AND threadId=$5 
       ORDER BY id DESC LIMIT 1`,
      [sender, toUser, subject, body, tId]
    );

    if (check.rows.length > 0) {
      return res.json({ success: true });
    }

    await pool.query(
      `INSERT INTO messages(fromUser, toUser, subject, body, threadId) 
       VALUES($1, $2, $3, $4, $5)`,
      [sender, toUser, subject, body, tId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "Failed to send message" });
  }
});

app.get("/api/inbox-collapsed", requireAuth, async (req, res) => {
  const user = req.session.user;
  try {
    const result = await pool.query(
      `SELECT m.* 
       FROM messages m 
       INNER JOIN (
         SELECT threadId, MAX(id) as lastId 
         FROM messages 
         WHERE toUser = $1 
         GROUP BY threadId
       ) t ON m.id = t.lastId 
       ORDER BY m.id DESC`,
      [user]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.get("/api/sent-collapsed", requireAuth, async (req, res) => {
  const user = req.session.user;
  try {
    const result = await pool.query(
      `SELECT m.* 
       FROM messages m 
       INNER JOIN (
         SELECT threadId, MAX(id) as lastId 
         FROM messages 
         WHERE fromUser = $1 
         GROUP BY threadId
       ) t ON m.id = t.lastId 
       ORDER BY m.id DESC`,
      [user]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.get("/api/thread", requireAuth, async (req, res) => {
  const threadId = req.query.id;
  try {
    const result = await pool.query("SELECT * FROM messages WHERE threadId = $1 ORDER BY id", [threadId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.post("/api/delete", requireAuth, async (req, res) => {
  const { id } = req.body;
  const user = req.session.user;
  try {
    await pool.query("DELETE FROM messages WHERE id = $1 AND (toUser = $2 OR fromUser = $2)", [id, user]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

app.post("/api/mark-read", requireAuth, async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query("UPDATE messages SET read = 1 WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

/* ---------------- ADMIN API ---------------- */

app.get("/api/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT username FROM users");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.post("/api/delete-user", requireAdmin, async (req, res) => {
  const { username } = req.body;
  try {
    await pool.query("DELETE FROM users WHERE username = $1", [username]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

/* ---------------- STATIC FILES ---------------- */
// Placed at the end to ensure auth routes are checked first
app.use(express.static("public"));

/* ---------------- START SERVER ---------------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});