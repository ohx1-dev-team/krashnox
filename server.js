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

app.use((req,res,next)=>{
  if(req.path === "/admin.html"){
    if(!req.session.admin){
      return res.redirect("/login.html")
    }
  }
  next()
})

app.use((req,res,next)=>{
  if(req.path === "/inbox.html"){
    if(!req.session.admin){
      return res.redirect("/login.html")
    }
  }
  next()
})

app.use((req,res,next)=>{
  if(req.path === "/sent.html"){
    if(!req.session.admin){
      return res.redirect("/login.html")
    }
  }
  next()
})

app.use((req,res,next)=>{
  if(req.path === "/compose.html"){
    if(!req.session.admin){
      return res.redirect("/login.html")
    }
  }
  next()
})

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

/* ---------------- SEND MESSAGE ---------------- */

app.post("/api/send",(req,res)=>{
  if(!req.session.user) return res.json({success:false})

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

app.get("/api/inbox-collapsed",(req,res)=>{
  if(!req.session.user) return res.json([])

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

app.get("/api/sent-collapsed",(req,res)=>{
  if(!req.session.user) return res.json([])

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

app.get("/api/thread",(req,res)=>{
  const threadId=req.query.id

  db.all(
    "SELECT * FROM messages WHERE threadId=? ORDER BY id",
    [threadId],
    (err,rows)=>res.json(rows||[])
  )
})

/* ---------------- DELETE MESSAGE ---------------- */

app.post("/api/delete",(req,res)=>{
  const {id}=req.body

  db.run(
    "DELETE FROM messages WHERE id=? AND (toUser=? OR fromUser=?)",
    [id,req.session.user,req.session.user],
    err=>res.json({success:!err})
  )
})

/* ---------------- MARK READ ---------------- */

app.post("/api/mark-read",(req,res)=>{
  const {id}=req.body

  db.run(
    "UPDATE messages SET read=1 WHERE id=?",
    [id],
    err=>res.json({success:!err})
  )
})

/* ---------------- ADMIN ---------------- */

app.get("/api/users",(req,res)=>{
  if(!req.session.admin) return res.json([])

  db.all(
    "SELECT username FROM users",
    (err,rows)=>res.json(rows||[])
  )
})

app.post("/api/delete-user",(req,res)=>{
  if(!req.session.admin) return res.json({success:false})

  const {username}=req.body

  db.run(
    "DELETE FROM users WHERE username=?",
    [username],
    err=>res.json({success:!err})
  )
})

app.get("/admin.html",(req,res)=>{
  if(!req.session.admin) return res.redirect("/login.html")

  res.sendFile(path.join(__dirname,"public/admin.html"))
})

/* ---------------- START SERVER ---------------- */

app.listen(3000,()=>{
  console.log("Server running on port 3000")
})