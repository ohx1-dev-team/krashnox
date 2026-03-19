// API helper
async function api(url, method="GET", data=null){
  const options={method,headers:{}}
  if(data){
    options.headers["Content-Type"]="application/json"
    options.body=JSON.stringify(data)
  }
  const res=await fetch(url,options)
  return res.json()
}

// LOGIN / SIGNUP
async function login(){
  const u=document.getElementById("username").value
  const p=document.getElementById("password").value
  const res=await api("/login","POST",{username:u,password:p})
  if(res.success) window.location.href=res.isAdmin?"admin.html":"inbox.html"
  else alert(res.error)
}

async function signup(){

  console.log("signup clicked") // debug

  const u = document.getElementById("username").value
  const p = document.getElementById("password").value

  if(!u || !p){
    return alert("Fill all fields")
  }

  try{
    const res = await fetch("/signup",{
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body: JSON.stringify({username:u,password:p})
    })

    const data = await res.json()

    console.log("server response:", data) // debug

    if(data.success){
      alert("Account created")
      window.location.href="login.html"
    }else{
      alert(data.error || "Signup failed")
    }

  }catch(err){
    console.error(err)
    alert("Network error")
  }
}

async function logout(){
  await api("/logout","POST")
  window.location.href="index.html"
}

// SEND / REPLY
async function sendMessage(){

  const subject=document.getElementById("subject").value
  const body=document.getElementById("body").value
  const threadId=sessionStorage.getItem("replyThread")

  let toUser=null

  if(threadId){

    const messages=await api("/api/thread?id="+threadId)

    if(messages.length>0){
      const first=messages[0]

      if(first.fromUser===sessionStorage.getItem("username"))
        toUser=first.toUser
      else
        toUser=first.fromUser
    }
  }

  if(!toUser){
    const toField=document.getElementById("to")
    if(toField) toUser=toField.value
    if(!toUser) return alert("Recipient required")
  }

  const res=await api("/api/send","POST",{toUser,subject,body,threadId})

  if(res.success){
    sessionStorage.removeItem("replyThread")
    window.location.href="inbox.html"
  }
}

// -------------------
// LOAD INBOX
// -------------------
async function loadInbox(){

  const mails = await api("/api/inbox-collapsed")
  const list = document.getElementById("mailList")
  if(!list) return

  list.innerHTML = ""

  const username = sessionStorage.getItem("username")

  for(const m of mails){

    const div = document.createElement("div")
    div.className = "mail-item"

    // unread = latest message is unread AND it's for me
    const unread = m.read === 0 && m.toUser === username

    div.innerHTML =
      `<span class="${unread ? "mailUnread" : ""}">
        <b>${m.fromUser}</b> - ${m.subject}
        ${unread ? '<span class="unreadDot"></span>' : ""}
      </span>`

    div.onclick = ()=>{
      sessionStorage.setItem("threadId", m.threadId)
      window.location.href = "view.html"
    }

    list.appendChild(div)
  }
}

// LOAD SENT
// -------------------
async function loadSent(){

  const mails = await api("/api/sent-collapsed")
  const list = document.getElementById("mailList")
  if(!list) return

  list.innerHTML = ""

  for(const m of mails){

    const div = document.createElement("div")
    div.className = "mail-item"

    div.innerHTML =
      `<span>
        To <b>${m.toUser}</b> - ${m.subject}
      </span>`

    div.onclick = ()=>{
      sessionStorage.setItem("threadId", m.threadId)
      window.location.href = "view.html"
    }

    list.appendChild(div)
  }
}


// LOAD THREAD
async function loadThread(){

  const threadId = sessionStorage.getItem("threadId")
  if(!threadId) return

  const convo = document.getElementById("conversation")
  if(!convo) return

  const messages = await api("/api/thread?id="+threadId)

  convo.innerHTML = ""

  for(const m of messages){

    const div = document.createElement("div")
    div.className = "message"

    // NO unread indicators here
    div.innerHTML =
      `<b>${m.fromUser}</b>
       <p>${m.body}</p>
       <hr>`

    convo.appendChild(div)

    // mark message read when thread opened
    if(!m.read && m.toUser === sessionStorage.getItem("username")){
      await api("/api/mark-read","POST",{id:m.id})
    }
  }
}

// DELETE THREAD
async function deleteThread(){

  const threadId=sessionStorage.getItem("threadId")
  if(!threadId) return alert("No thread selected")

  const messages=await api("/api/thread?id="+threadId)

  for(const m of messages){
    await api("/api/delete","POST",{id:m.id})
  }

  window.location.href="inbox.html"
}

// REPLY
function reply(){

  const threadId=sessionStorage.getItem("threadId")
  if(!threadId) return

  sessionStorage.setItem("replyThread",threadId)
  window.location.href="reply.html"
}

// ADMIN USERS
async function loadUsers(){

  const users=await api("/api/users")

  const list=document.getElementById("userList")
  if(!list) return

  list.innerHTML=""

  users.forEach(u=>{
    const div=document.createElement("div")
    div.innerHTML=u.username+' <button onclick="deleteUser(\''+u.username+'\')">Delete</button>'
    list.appendChild(div)
  })
}

async function deleteUser(username){
  await api("/api/delete-user","POST",{username})
  loadUsers()
}

// DOM READY
document.addEventListener("DOMContentLoaded",()=>{

  if(document.getElementById("conversation")) loadThread()

  if(document.getElementById("mailList")){

    const page=window.location.pathname.split("/").pop()

    if(page==="inbox.html") loadInbox()
    if(page==="sent.html") loadSent()
  }

})