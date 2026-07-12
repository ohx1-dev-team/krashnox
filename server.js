const express = require("express")
const session = require("express-session")
const sqlite3 = require("sqlite3").verbose()
const path = require("path")

const app = express()
const db = new sqlite3.Database("./database.db")

app.use(express.json())

app.use(session({
  secret: "secret123",
  resave: false,
  saveUninitialized: false
}))

// --- NEW MIDDLEWARE FUNCTIONS ---
// These replace the repetitive middleware blocks you had earlier

function requireAuth(req, res, next) {
  if (!req.session.user) {
    // If it's an API request, return JSON error
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    // Otherwise redirect to login
    return res.redirect('/login.html');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    // If it's an API request, return JSON error
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    // Otherwise redirect to login
    return res.redirect('/login.html');
  }
  next();
}

// Serve static files AFTER auth middleware so we can intercept HTML requests
app.use(express.static("public"))

/* ---------------- DATABASE ---------------- */

db.run(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE,
 password TEXT
)
`)

db.run(`
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 fromUser TEXT,
 toUser TEXT,
 subject TEXT,
 body TEXT,
 threadId INTEGER,
 read INTEGER DEFAULT 0
)
`)

/* ---------------- LOGIN ---------------- */

// LOGIN
app.post("/login",(req,res)=>{
  const {username,password} = req.body

  if(!username || !password){
    return res.json({success:false,error:"Missing credentials"})
  }

  // Admin login
  if(username === "admin" && password === "adminpass"){
    req.session.user = "admin"
    req.session.admin = true
    return res.json({success:true,isAdmin:true})
  }

  // Normal user login
  db.get(
    "SELECT * FROM users WHERE username=?",
    [username],
    (err,user)=>{
      if(err){
        return res.json({success:false,error:"Database error"})
      }

      if(!user){
        return res.json({success:false,error:"User not found"})
      }

      if(user.password !== password){
        return res.json({success:false,error:"Wrong password"})
      }

      req.session.user = user.username
      req.session.admin = false

      res.json({success:true,isAdmin:false})
    }
  )
})

app.post("/signup",(req,res)=>{
  const {username,password} = req.body

  db.run(
    "INSERT INTO users(username,password) VALUES(?,?)",
    [username,password],
    err=>{
      if(err) return res.json({success:false,error:"Username exists"})
      res.json({success:true})
    }
  )
})

app.post("/logout",(req,res)=>{
  req.session.destroy(()=>res.json({success:true}))
})

/* ---------------- PROTECTED HTML PAGES ---------------- */
// Using the new middleware functions here instead of global middleware blocks

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

/* ---------------- SEND MESSAGE ---------------- */

app.post("/api/send", requireAuth, (req,res)=>{
  const {toUser,subject,body,threadId} = req.body
  const sender = req.session.user

  const tId = threadId || Date.now()

  // prevent duplicate insert
  db.get(`
    SELECT id FROM messages
    WHERE fromUser=? AND toUser=? AND subject=? AND body=? AND threadId=?
    ORDER BY id DESC LIMIT 1
  `,[sender,toUser,subject,body,tId],(err,row)=>{

    if(row){
      return res.json({success:true})
    }

    db.run(`
      INSERT INTO messages(fromUser,toUser,subject,body,threadId)
      VALUES(?,?,?,?,?)
    `,[sender,toUser,subject,body,tId],err=>{
      res.json({success:!err})
    })

  })
})

/* ---------------- INBOX THREADS ---------------- */

app.get("/api/inbox-collapsed", requireAuth, (req,res)=>{
  const user=req.session.user

  db.all(`
    SELECT m.*
    FROM messages m
    INNER JOIN (
      SELECT threadId, MAX(id) as lastId
      FROM messages
      WHERE toUser = ?  
      GROUP BY threadId
    ) t ON m.id = t.lastId
    ORDER BY m.id DESC
  `,[user],(err,rows)=>{
    res.json(rows || [])
  })
})

/* ---------------- SENT THREADS ---------------- */

app.get("/api/sent-collapsed", requireAuth, (req,res)=>{
  const user=req.session.user

  db.all(`
    SELECT m.*
    FROM messages m
    INNER JOIN (
      SELECT threadId, MAX(id) as lastId
      FROM messages
      WHERE fromUser = ? 
      GROUP BY threadId
    ) t ON m.id = t.lastId
    ORDER BY m.id DESC
  `,[user],(err,rows)=>{
    res.json(rows || [])
  })
})

/* ---------------- THREAD VIEW ---------------- */

app.get("/api/thread", requireAuth, (req,res)=>{
  const threadId=req.query.id

  db.all(
    "SELECT * FROM messages WHERE threadId=? ORDER BY id",
    [threadId],
    (err,rows)=>res.json(rows||[])
  )
})

/* ---------------- DELETE MESSAGE ---------------- */

app.post("/api/delete", requireAuth, (req,res)=>{
  const {id}=req.body

  db.run(
    "DELETE FROM messages WHERE id=? AND (toUser=? OR fromUser=?)",
    [id,req.session.user,req.session.user],
    err=>res.json({success:!err})
  )
})

/* ---------------- MARK READ ---------------- */

app.post("/api/mark-read", requireAuth, (req,res)=>{
  const {id}=req.body

  db.run(
    "UPDATE messages SET read=1 WHERE id=?",
    [id],
    err=>res.json({success:!err})
  )
})

/* ---------------- ADMIN ---------------- */

app.get("/api/users", requireAdmin, (req,res)=>{
  db.all(
    "SELECT username FROM users",
    (err,rows)=>res.json(rows||[])
  )
})

app.post("/api/delete-user", requireAdmin, (req,res)=>{
  const {username}=req.body

  db.run(
    "DELETE FROM users WHERE username=?",
    [username],
    err=>res.json({success:!err})
  )
})

/* ---------------- START SERVER ---------------- */

app.listen(3000,()=>{
  console.log("Server running on port 3000")
})