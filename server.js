/*
  Among Us Multiplayer — Authoritative Server
  node server.js [port]   default: 3000
  Serves game client at /  + WebSocket game engine.
*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = parseInt(process.env.PORT || process.argv[2]) || 3000;

// ── Shared constants (must match client) ──
const COLORS = [
  { name:"Red",    c:"#c51111" },{ name:"Blue",   c:"#132ed1" },
  { name:"Green",  c:"#117f2d" },{ name:"Pink",   c:"#ed54ba" },
  { name:"Orange", c:"#ef7d0d" },{ name:"Cyan",   c:"#39fed4" },
  { name:"Yellow", c:"#f5f557" },{ name:"White",  c:"#d5e0f0" },
];
const MAX = 8, SPEED = 220, HZ = 15, DT = 1 / HZ;

const ROOMS = [
  { n:"Cafeteria",    x:600, y:380, w:400, h:280 },{ n:"Upper Engine", x:120, y:120, w:300, h:220 },
  { n:"Reactor",      x:120, y:560, w:300, h:300 },{ n:"Medbay",       x:560, y:120, w:240, h:180 },
  { n:"Storage",      x:660, y:700, w:300, h:220 },{ n:"Navigation",   x:1180,y:200, w:280, h:200 },
  { n:"Shields",      x:1180,y:560, w:280, h:220 },{ n:"Admin",        x:900, y:700, w:240, h:180 },
];
const HALLS = [
  {x:420,y:200,w:200,h:80},{x:240,y:340,w:80,h:240},{x:420,y:620,w:260,h:80},
  {x:1000,y:260,w:200,h:80},{x:1000,y:480,w:200,h:80},{x:1300,y:400,w:80,h:180},
  {x:960,y:620,w:240,h:120},{x:780,y:300,w:80,h:100},{x:900,y:560,w:80,h:160},
];
const VENTS = [
  {id:0,r:"Upper Engine",x:200,y:180},{id:1,r:"Reactor",x:200,y:820},
  {id:2,r:"Cafeteria",x:940,y:600},{id:3,r:"Navigation",x:1420,y:250},
  {id:4,r:"Shields",x:1420,y:760},{id:5,r:"Admin",x:960,y:760},
];
const TASKS = [
  {id:"wires",nm:"Fix Wiring",rm:"Upper Engine",tp:"wires"},
  {id:"reactor",nm:"Start Reactor",rm:"Reactor",tp:"sequence"},
  {id:"scan",nm:"Submit Scan",rm:"Medbay",tp:"hold"},
  {id:"fuel",nm:"Fuel Engines",rm:"Storage",tp:"hold"},
  {id:"chart",nm:"Chart Course",rm:"Navigation",tp:"sequence"},
  {id:"shields",nm:"Prime Shields",rm:"Shields",tp:"wires"},
  {id:"swipe",nm:"Swipe Card",rm:"Admin",tp:"hold"},
  {id:"download",nm:"Download Data",rm:"Cafeteria",tp:"hold"},
];

// helpers
function rc(n){const r=ROOMS.find(r=>r.n===n);return r?{x:r.x+r.w/2,y:r.y+r.h/2}:{x:800,y:500};}
function rh(r,x,y,p){return x>r.x-p&&x<r.x+r.w+p&&y>r.y-p&&y<r.y+r.h+p;}
function walkable(x,y){for(const r of ROOMS)if(rh(r,x,y,0))return true;for(const r of HALLS)if(rh(r,x,y,0))return true;return false;}
function rcd(){const s="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let o="";for(let i=0;i<4;i++)o+=s[Math.floor(Math.random()*s.length)];return o;}

// ── Room class ──
class Room {
  constructor(code) {
    this.code = code; this.pl = new Map(); this.hid = null; this.ph = "lobby"; this.nid = 0;
    this.tmr = null; this.btmr = null; this.tpc = 3; this.ttl = 0; this.cp = 0;
    this.bds = []; this.sab = null; this.kcd = {}; this.eu = 0; this.scd = 0;
    this.vts = {}; this.mtmr = null;
  }
  all(m){const d=JSON.stringify(m);for(const{ws}of this.pl.values())if(ws.readyState===1)try{ws.send(d)}catch(e){}}
  one(pid,m){const e=this.pl.get(pid);if(e&&e.ws.readyState===1)try{e.ws.send(JSON.stringify(m))}catch(e){}}

  join(ws) {
    if(this.ph!=="lobby"){ws.send(JSON.stringify({type:"error",message:"Game in progress."}));return;}
    if(this.pl.size>=MAX){ws.send(JSON.stringify({type:"error",message:"Room full."}));return;}
    const id=this.nid++;const c=COLORS[id%COLORS.length];const caf=rc("Cafeteria");
    const p={id,color:c,x:caf.x+(Math.random()-.5)*160,y:caf.y+(Math.random()-.5)*100,alive:true,isImp:false,vented:false,fl:false,st:0,name:c.name,tasks:[],td:0,keys:{}};
    this.pl.set(id,{ws,player:p});if(this.hid===null)this.hid=id;
    this.one(id,{type:"joined",playerId:id,roomCode:this.code,color:c,host:id===this.hid});this._lb();
    console.log(`[${this.code}] ${c.name} joined — ${this.pl.size}/${MAX}`);
  }
  leave(pid){
    const e=this.pl.get(pid);this.pl.delete(pid);
    if(this.pl.size===0){this.destroy();return;}if(this.hid===pid)this.hid=this.pl.keys().next().value;this._lb();
    if(this.ph==="play"&&e&&e.player.alive){e.player.alive=false;this.bds.push({x:e.player.x,y:e.player.y,color:e.player.color.c});this.cw();}
  }
  _lb(){const ps=[];for(const{player:p}of this.pl.values())ps.push({id:p.id,color:p.color,name:p.name,host:p.id===this.hid});this.all({type:"lobby",players:ps,hostId:this.hid});}

  handle(pid,msg){
    switch(msg.type){
      case"start":this._start(pid);break;case"input":this._inp(pid,msg.keys);break;
      case"action":this._act(pid,msg.action,msg.data);break;case"vote":this._vt(pid,msg.targetId);break;
      case"taskDone":this._td(pid,msg.taskId);break;
      case"chat":{const p=this.pl.get(pid)?.player;this.all({type:"chat",playerId:pid,name:p?.color?.name||"?",text:(msg.text||"").substring(0,120)});break;}
    }
  }

  _inp(pid,keys){if(this.ph==="play"){const e=this.pl.get(pid);if(e&&e.player.alive)e.player.keys=keys||{};}}
  _td(pid,tid){if(this.ph!=="play")return;const e=this.pl.get(pid);if(!e||e.player.isImp)return;const t=e.player.tasks.find(t=>t.id===tid&&!t.done);if(!t)return;const c=rc(t.rm);if(Math.hypot(c.x-e.player.x,c.y-e.player.y)>90)return;t.done=true;e.player.td++;this.cp=Math.min(this.ttl,this.cp+1);this.all({type:"notification",message:e.player.color.name+" completed: "+t.nm});this.cw();}

  _act(pid,act,data){
    if(this.ph!=="play")return;const e=this.pl.get(pid);if(!e)return;const p=e.player;if(!p.alive)return;
    switch(act){
      case"use":{
        if(p.vented){p.vented=false;return;}
        if(this.sab&&!p.isImp)for(const f of this.sab.fixes){if(!f.done&&Math.hypot(f.x-p.x,f.y-p.y)<70){f.done=true;this.all({type:"notification",message:p.color.name+" fixed a panel."});if(this.sab.fixes.every(x=>x.done)){this.all({type:"notification",message:"✅ "+this.sab.label+" resolved!"});this.sab=null;}return;}}
        break;
      }
      case"kill":{
        if(!p.isImp||p.vented)break;const cd=this.kcd[pid]||0;
        if(cd>0){this.one(pid,{type:"notification",message:"Cooldown: "+cd.toFixed(1)+"s"});break;}
        let tgt=null,bd=80;
        for(const[,o]of this.pl){const q=o.player;if(q===p||!q.alive||q.isImp)continue;const d=Math.hypot(q.x-p.x,q.y-p.y);if(d<bd){bd=d;tgt=q;}}
        if(tgt){tgt.alive=false;this.bds.push({x:tgt.x,y:tgt.y,color:tgt.color.c});p.x=tgt.x;p.y=tgt.y;this.kcd[pid]=15;this.all({type:"kill",victimId:tgt.id,x:tgt.x,y:tgt.y,color:tgt.color.c});this.cw();}
        else this.one(pid,{type:"notification",message:"No one close enough."});break;
      }
      case"vent":{
        if(!p.isImp)break;
        if(p.vented){const o=VENTS.filter(v=>v.id!==p._cv);if(o.length){const nv=o[(p._vp=((p._vp||0)+1)%o.length)];p.x=nv.x;p.y=nv.y;p._cv=nv.id;}}
        else{let nr=null,bd=70;for(const v of VENTS){const d=Math.hypot(v.x-p.x,v.y-p.y);if(d<bd){bd=d;nr=v;}}if(nr){p.vented=true;p._cv=nr.id;p._vp=0;p.x=nr.x;p.y=nr.y;}}break;
      }
      case"report":{if(p.vented){p.vented=false;return;}for(const b of this.bds){if(Math.hypot(b.x-p.x,b.y-p.y)<80){this._mt(pid,b);return;}}break;}
      case"meeting":{if(this.eu>=2||(this.sab&&this.sab.type==="reactor"))break;const caf=rc("Cafeteria");if(Math.hypot(caf.x-p.x,caf.y-p.y)>200)break;this.eu++;this._mt(pid,null);break;}
      case"sabotage":{if(!p.isImp||this.sab||this.scd>0)break;const t=(data&&data.type)||(Math.random()<.5?"reactor":"lights");this._sab(t);break;}
    }
  }

  _start(pid){
    if(pid!==this.hid)return;if(this.pl.size<3){this.one(pid,{type:"notification",message:"Need at least 3 players."});return;}
    this.ph="play";const arr=[...this.pl.values()].map(e=>e.player);const ic=Math.min(2,Math.ceil(arr.length/3));
    [...arr].sort(()=>Math.random()-.5).slice(0,ic).forEach(p=>p.isImp=true);
    const crew=arr.filter(p=>!p.isImp);this.ttl=crew.length*this.tpc;this.cp=0;this.bds=[];this.sab=null;this.kcd={};this.eu=0;this.scd=0;this.vts={};
    for(const p of arr){p.alive=true;p.vented=false;p.td=0;p.tasks=[...TASKS].sort(()=>Math.random()-.5).slice(0,this.tpc).map(t=>({...t,done:false}));const cc=rc("Cafeteria");p.x=cc.x+(Math.random()-.5)*160;p.y=cc.y+(Math.random()-.5)*100;p.keys={};}
    const impIds=arr.filter(p=>p.isImp).map(p=>p.id);
    for(const[pid,{player:pl}]of this.pl){const mates=pl.isImp?arr.filter(p=>p.isImp&&p.id!==pid).map(p=>p.color.name):[];this.one(pid,{type:"roleReveal",isImpostor:pl.isImp,tasks:pl.tasks.map(t=>({id:t.id,name:t.nm,room:t.rm,type:t.tp,done:false})),teammates:mates,impIds});}
    this.tmr=setInterval(()=>this.tick(),Math.round(1000/HZ));this.btmr=setInterval(()=>this._bcast(),Math.round(1000/HZ));
    console.log(`[${this.code}] ▶ ${arr.length}P / ${ic}imp`);
  }

  tick(){
    if(this.ph!=="play")return;
    for(const[,{player:p}]of this.pl){
      if(!p.alive||p.vented)continue;let dx=0,dy=0;
      if(p.keys["w"]||p.keys["arrowup"])dy-=1;if(p.keys["s"]||p.keys["arrowdown"])dy+=1;if(p.keys["a"]||p.keys["arrowleft"])dx-=1;if(p.keys["d"]||p.keys["arrowright"])dx+=1;
      if(dx===0&&dy===0)continue;const l=Math.hypot(dx,dy);dx/=l;dy/=l;const nx=p.x+dx*SPEED*DT,ny=p.y+dy*SPEED*DT;
      if(walkable(nx,p.y))p.x=nx;if(walkable(p.x,ny))p.y=ny;p.fl=dx<0?true:(dx>0?false:p.fl);p.st+=DT*10;
    }
    for(const k of Object.keys(this.kcd))if(this.kcd[k]>0)this.kcd[k]-=DT;if(this.scd>0)this.scd-=DT;
    if(this.sab){this.sab.timer-=DT;if(this.sab.timer<=0&&this.sab.type==="reactor"){this._end("impostor","Reactor meltdown!");return;}}
  }

  _bcast(){
    if(this.ph!=="play")return;
    this.all({type:"state",
      players:[...this.pl.values()].map(e=>({id:e.player.id,color:e.player.color,x:Math.round(e.player.x),y:Math.round(e.player.y),alive:e.player.alive,vented:e.player.vented,fl:e.player.fl,st:e.player.st,isImp:e.player.isImp,td:e.player.td})),
      bodies:this.bds,sabotage:this.sab,cp:this.cp,ttl:this.ttl,kcd:this.kcd,eu:this.eu});
  }

  _sab(type){
    if(type==="reactor"){const c1=rc("Reactor"),c2=rc("Upper Engine");this.sab={type:"reactor",label:"reactor",timer:30,fixes:[{x:c1.x-40,y:c1.y,room:"Reactor",done:false},{x:c2.x+40,y:c2.y,room:"Upper Engine",done:false}]};}
    else{const c=rc("Storage");this.sab={type:"lights",label:"lights",timer:9999,fixes:[{x:c.x,y:c.y,room:"Storage",done:false}]};}
    this.scd=20;this.all({type:"notification",message:"⚠ "+(type==="reactor"?"REACTOR MELTDOWN!":"LIGHTS OUT!")});
  }

  _mt(cid,bd){
    this.ph="meeting";this.bds=[];if(this.sab&&this.sab.type==="lights")this.sab=null;this.vts={};const c=this.pl.get(cid)?.player;
    this.all({type:"meetingStart",callerId:cid,callerName:c?c.color.name:"?",body:bd?{x:bd.x,y:bd.y,color:bd.color}:null,
      players:[...this.pl.values()].map(e=>({id:e.player.id,color:e.player.color,alive:e.player.alive}))});
    if(this.mtmr)clearTimeout(this.mtmr);this.mtmr=setTimeout(()=>this._rm(),60000);
  }

  _vt(pid,tid){if(this.ph!=="meeting")return;this.vts[pid]=tid;this.all({type:"voted",playerId:pid});const alive=[...this.pl.values()].filter(e=>e.player.alive);if(Object.keys(this.vts).length>=alive.length)this._rm();}

  _rm(){
    if(this.mtmr){clearTimeout(this.mtmr);this.mtmr=null;}this.ph="play";const tally={};let skips=0;
    for(const v of Object.values(this.vts)){if(v===null||v===undefined)skips++;else tally[v]=(tally[v]||0)+1;}
    let mx=-1,eid=null,tie=false;for(const[id,n]of Object.entries(tally)){if(n>mx){mx=n;eid=+id;tie=false;}else if(n===mx)tie=true;}
    let en=null,wi=false,msg="";if(tie||mx<=0||skips>=mx){msg="No one was ejected (tie or skip).";}
    else{const v=this.pl.get(eid)?.player;if(v){v.alive=false;wi=v.isImp;en=v.color.name;msg=en+" was ejected. "+(wi?"They were an Impostor!":"They were not an Impostor.");}}
    this.all({type:"meetingResult",ejectedId:eid,ejectedName:en,wasImpostor:wi,message:msg,votes:this.vts});this.vts={};
    const caf=rc("Cafeteria");for(const{player:pl}of this.pl.values()){if(pl.alive){pl.x=caf.x+(Math.random()-.5)*160;pl.y=caf.y+(Math.random()-.5)*100;pl.vented=false;}}this.cw();
  }

  cw(){const ca=[...this.pl.values()].filter(e=>e.player.alive&&!e.player.isImp).length;const ia=[...this.pl.values()].filter(e=>e.player.alive&&e.player.isImp).length;if(this.cp>=this.ttl)this._end("crew","All tasks completed!");else if(ia>0&&ca<=ia)this._end("impostor","Impostors reached parity!");else if(ia===0)this._end("crew","All Impostors ejected!");}

  _end(w,r){if(this.ph==="ended")return;this.ph="ended";clearInterval(this.tmr);clearInterval(this.btmr);this.tmr=null;this.btmr=null;this.all({type:"gameEnd",winner:w,reason:r});console.log(`[${this.code}] over — ${w} wins: ${r}`);setTimeout(()=>this.destroy(),30000);}

  destroy(){clearInterval(this.tmr);clearInterval(this.btmr);if(this.mtmr)clearTimeout(this.mtmr);this.ph="ended";for(const{ws}of this.pl.values())try{ws.close()}catch(e){}this.pl.clear();allR.delete(this.code);}
}

// ── Server ──
const allR = new Map();
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    try { const h = fs.readFileSync(path.join(__dirname, "among-us.html"), "utf8"); res.writeHead(200, { "Content-Type": "text/html" }); res.end(h); } catch (e) { res.writeHead(404); res.end("Client not found"); }
  } else if (req.url === "/health") { res.writeHead(200); res.end("OK"); }
  else { res.writeHead(200, { "Content-Type": "text/html" }); res.end(`<meta charset=utf8><body style="font-family:Arial;padding:40px;text-align:center"><h1>Among Us Server</h1><p>Port ${PORT} · Rooms: ${allR.size}</p><a href="/">Play</a></body>`); }
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  let code = null, pid = null;
  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    switch (msg.type) {
      case "create": { let c; do { c = rcd(); } while (allR.has(c)); const r = new Room(c); allR.set(c, r); code = c; r.join(ws); for (const [id, e] of r.pl) { if (e.ws === ws) { pid = id; break; } } break; }
      case "join": { const c = (msg.roomCode || "").toUpperCase().trim(); const r = allR.get(c); if (!r) { ws.send(JSON.stringify({ type: "error", message: "Room not found: " + c })); return; } code = c; r.join(ws); for (const [id, e] of r.pl) { if (e.ws === ws) { pid = id; break; } } break; }
      default: { if (typeof code === "string" && pid !== null) { const r = allR.get(code); if (r) r.handle(pid, msg); } }
    }
  });
  ws.on("close", () => { if (typeof code === "string" && pid !== null) { const r = allR.get(code); if (r) r.leave(pid); } });
  ws.on("error", () => {});
});

setInterval(() => { for (const [c, r] of allR) { if (r.pl.size === 0) r.destroy(); } }, 60000);

server.listen(PORT, () => { console.log(`\n🛸 Among Us Server — http://localhost:${PORT}\n`); });
