/* ============================================================ constants */
const AGENTS=["Astra","Breach","Brimstone","Chamber","Clove","Cypher","Deadlock","Fade","Gekko","Harbor","Iso","Jett","KAY/O","Killjoy","Neon","Omen","Phoenix","Raze","Reyna","Sage","Skye","Sova","Tejo","Viper","Vyse","Waylay","Yoru"];
const MAPS=["Abyss","Ascent","Bind","Breeze","Fracture","Haven","Icebox","Lotus","Pearl","Split","Sunset"];
const ROLES=["Duelist","Initiator","Controller","Sentinel","Flex","IGL"];
const STATUS=["Starter","Sub","Trial","Inactive"];
const VERDICTS=["Shortlist","Hold","Pass","Signed"];
const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const RANK_TIERS=["Iron","Bronze","Silver","Gold","Platinum","Diamond","Ascendant","Immortal","Radiant"];
const RATING_BASELINE=1.00; // R2.0: 1.00 ≈ an average player
const ROLE_RANK={player:1,igl:2,manager:3};

/* ============================================================ helpers */
const $=(s,r=document)=>r.querySelector(s);
const uid=()=>Math.random().toString(36).slice(2,9);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const iso=d=>d.toISOString().slice(0,10);
const parse=s=>{const d=new Date(s+"T00:00:00");return d;};
function mondayOf(d){const x=new Date(d);const g=(x.getDay()+6)%7;x.setDate(x.getDate()-g);x.setHours(0,0,0,0);return x;}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function fmtRange(mon){const end=addDays(mon,6);const o={month:"short",day:"numeric"};
  return mon.toLocaleDateString(undefined,o)+" – "+end.toLocaleDateString(undefined,o)+" "+end.getFullYear();}
function monthKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
function monthLabel(k){const[y,m]=k.split("-");return new Date(y,m-1,1).toLocaleDateString(undefined,{month:"long",year:"numeric"});}
const t2m=t=>{const[h,m]=t.split(":").map(Number);return h*60+m;};
const m2t=m=>String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
/* rank as a continuous scale: 3 units per tier (one per division), + RR/100 within a division */
function rankUnits(r){
  if(!r)return 0;
  if(r.tier==="Radiant")return 24+(r.rr||0)/100;
  return RANK_TIERS.indexOf(r.tier)*3+((r.div||1)-1)+(r.rr||0)/100;
}
function unitsToRank(u){
  u=clamp(u,0,24.999);
  if(u>=24)return {tier:"Radiant",div:1,rr:Math.round((u-24)*100)};
  const idx=Math.floor(u);
  return {tier:RANK_TIERS[Math.floor(idx/3)],div:idx%3+1,rr:Math.round((u-idx)*100)};
}
function rankStr(r){return !r?"—":r.tier==="Radiant"?"Radiant":`${r.tier} ${r.div}`;}
function rankShort(r){return rankStr(r).replace("Immortal","Imm").replace("Ascendant","Asc").replace("Diamond","Dia").replace("Platinum","Plat").replace("Radiant","Rad");}
function fmtRank(r){return !r?"—":rankStr(r)+((r.tier==="Radiant"&&!r.rr)?"":` · ${r.rr||0} RR`);}
function avgRank(ranks){const v=(ranks||[]).filter(Boolean);return v.length?unitsToRank(mean(v.map(rankUnits))):null;}
/* HenrikDev tier id (3=Iron 1 … 27=Radiant) -> app {tier,div,rr}.
   Immortal+ RR is cumulative in the API (0-300); the in-game number is rr % 100. */
function tierRank(id,rr){
  const i=Math.max(0,(id||0)-3);
  return {tier:RANK_TIERS[Math.min(RANK_TIERS.length-1,Math.floor(i/3))]||"Iron",div:i%3+1,rr:((rr||0)%100+100)%100};
}
/* absolute elo -> the same continuous scale as rankUnits() (100 elo per division) */
const eloUnits=e=>(e||0)/100;
const PLAYER_COLORS=["#ff4655","#3ad1bf","#e7a343","#7c9cff","#c479ff","#6ee787","#ff8bd1"];
const pColor=i=>PLAYER_COLORS[i%PLAYER_COLORS.length];

/* estimators for when a scrim row is missing ADR / KAST (manual entry without a tracker) */
const estADR=kpr=>Math.round(clamp(40+kpr*145,45,260));
const estKAST=(kpr,dpr)=>Math.round(clamp(100*(0.55+kpr*0.32-dpr*0.24),35,95));
/* HLTV Rating 2.0 — community-derived coefficients (kast 0-100, adr per round),
   recentred for Valorant's higher ADR scale so a league-average game ≈ 1.00. */
function rating20(k,d,a,rounds,adr,kast){
  if(!rounds)return null;
  const kpr=k/rounds,dpr=d/rounds,apr=a/rounds;
  if(adr==null)adr=estADR(kpr);
  if(kast==null)kast=estKAST(kpr,dpr);
  const impact=2.13*kpr+0.42*apr-0.41;
  const raw=0.0073*kast+0.3591*kpr-0.5329*dpr+0.2372*impact+0.0032*adr+0.1587;
  return raw-0.27;
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function agoShort(ts){if(!ts)return"";const s=(Date.now()-ts)/1000;
  if(s<90)return"just now";if(s<5400)return Math.round(s/60)+"m ago";
  if(s<172800)return Math.round(s/3600)+"h ago";return Math.round(s/86400)+"d ago";}

/* "Immortal 1" / "Radiant" / "Unrated" (+ RR) -> {tier,div,rr} | null */
function parseRankName(s,rr){
  if(!s||/unrated|unranked/i.test(s))return null;
  if(/radiant/i.test(s))return {tier:"Radiant",div:1,rr:rr||0};
  const m=String(s).match(/([A-Za-z]+)\s*([123])/);
  if(!m)return null;
  const tier=RANK_TIERS.find(t=>t.toLowerCase()===m[1].toLowerCase());
  return tier?{tier,div:+m[2],rr:rr||0}:null;
}

/* Rank sync runs on the server (POST /sync-ranks) — it holds the HenrikDev key
   in the team row and calls the API from the edge. */
async function syncRanks(only,opts){
  opts=opts||{};
  if(state.syncing)return;
  if(!canEdit())return;
  if(opts.rebuild&&!confirm(only?`Rebuild ${only.handle}'s rank history from scratch? Drops the stored rows and re-pulls a clean copy from HenrikDev.`:"Rebuild the whole team's rank history from scratch?"))return;
  state.syncing=true;state.rankSync=null;render();
  try{
    const r=await API.post(`/api/teams/${TID()}/sync-ranks`, {...(only?{only:only.id}:{}),...(opts.rebuild?{rebuild:true}:{})});
    state.rankHist=null;   // force a re-fetch of the history
    state.rankSync=r;      // keep the per-player result on screen until dismissed
    await reload();
    const bits=[`${r.done}/${r.total} live`];
    if(r.added)bits.push(`+${r.added} game${r.added===1?"":"s"}`);
    if(r.dropped)bits.push(`${r.dropped} bad row${r.dropped===1?"":"s"} dropped`);
    if(r.unrated)bits.push(`${r.unrated} unrated`);
    if(r.fail)bits.push(`${r.fail} failed`);
    toast("Rank sync: "+bits.join(" · "));
  }catch(e){
    toast(e.message||"Sync failed");
  }finally{
    state.syncing=false;render();
  }
}
function toast(msg){const el=document.createElement("div");el.className="toast";el.textContent=msg;
  $("#toast-root").appendChild(el);setTimeout(()=>el.remove(),2200);}
function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function cap(s){s=String(s||"");return s.charAt(0).toUpperCase()+s.slice(1);}
function roleStr(x){const r=(x&&x.roles&&x.roles.length?x.roles:(x&&x.role?[x.role]:[]));return r.join(" / ")||"—";}

/* ============================================================ data layer
   All state comes from the API. BUNDLE mirrors the old single-team object so the
   view code (team().roster, team().scrims, …) needs no changes. */
let ME=null;      // { user, teams:[{id,name,tag,role}] }
let BUNDLE=null;  // GET /api/teams/:id, with team.* fields hoisted onto it

const team=()=>BUNDLE;
const P=pid=>(BUNDLE&&BUNDLE.roster.find(p=>p.id===pid))||{handle:"?",icon:"•"};
/* display name/icon for a lineup entry — roster player, or a raw Riot ID for an unlinked import */
const pdisp=l=>l&&l.pid?P(l.pid):{icon:"•",handle:(l&&l.name)||"?"};
const TID=()=>BUNDLE&&BUNDLE.id;
const myRole=()=>(BUNDLE&&BUNDLE.myRole)||"player";
const canEdit=()=>ROLE_RANK[myRole()]>=ROLE_RANK.igl;      // manager or igl — both are admins
const canManage=()=>canEdit();                             // igl has full admin rights
const isOwner=()=>myRole()==="manager";                    // manager-only: delete team
const isMe=pid=>!!(BUNDLE&&pid&&pid===BUNDLE.myPlayerId);

async function loadTeam(id){
  BUNDLE=await API.get(`/api/teams/${id}`);
  BUNDLE.id=id; Object.assign(BUNDLE,BUNDLE.team);
  try{localStorage.setItem("sightline.team",id);}catch(e){}
}
async function reload(){
  const id=BUNDLE.id;
  BUNDLE=await API.get(`/api/teams/${id}`);
  BUNDLE.id=id; Object.assign(BUNDLE,BUNDLE.team);
}
/* run an API mutation, then refetch + re-render */
async function act(promise,okMsg){
  try{ await promise; await reload(); render(); if(okMsg)toast(okMsg); }
  catch(e){ toast(e.message||"Action failed"); }
}

/* ============================================================ ui state */
const MFILTER_DEF={map:"",opp:"",result:"",margin:"",player:"",agent:"",comp:[],since:""};
let state={view:"overview",week:mondayOf(new Date()),perfWindow:5,complabMap:"Ascent",tryoutSort:"score",syncing:false,
  mfilter:{...MFILTER_DEF,comp:[]},mfilterOpen:false,rankView:"team",rankHist:null,rankSync:null};

/* the whole navigation — one horizontal tab strip, no icons (they cost width
   the labels use better, and 10 tabs have to fit) */
const NAV=[
  ["overview","Overview"],
  ["roster","Roster"],
  ["schedule","Schedule"],
  ["activities","Activities"],
  ["ranks","Rank tracking"],
  ["scrims","Scrims"],
  ["officials","Officials"],
  ["performance","Performance"],
  ["complab","Comp lab"],
  ["tryouts","Tryouts"],
];
/* views whose content is scoped to state.week — only these get the week
   controls in the title block; everywhere else that row is just noise */
const WEEK_VIEWS=new Set(["overview","activities","scrims"]);
function icon(n){const p={
  grid:'<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M4 20c0-3 2-5 5-5s5 2 5 5"/><path d="M16 6a3 3 0 0 1 0 6M15 20c0-3 1-4 3-4"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  checks:'<path d="M4 6l2 2 3-3M4 13l2 2 3-3M4 20l2 2 3-3M12 6h8M12 13h8M12 20h8"/>',
  trend:'<path d="M4 17l6-6 4 4 6-8M16 7h4v4"/>',
  swords:'<path d="M4 4l9 9M14 14l6 6M20 4l-9 9M10 14l-6 6"/>',
  trophy:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/>',
  pulse:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  layers:'<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="M20 20l-5-5"/>',
  moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/>',
  auto:'<circle cx="12" cy="12" r="8"/><path d="M12 4v16" fill="currentColor"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  discord:'<path d="M18 5a16 16 0 0 0-4-1l-.3.6a12 12 0 0 1 3.5 1.8A13 13 0 0 0 6.8 6.4 12 12 0 0 1 10.3 4.6L10 4a16 16 0 0 0-4 1C3.5 9 3 13 3.2 17a16 16 0 0 0 5 2l.8-1.3a10 10 0 0 1-2-1l.5-.4a11 11 0 0 0 9 0l.5.4a10 10 0 0 1-2 1L15 19a16 16 0 0 0 5-2c.3-4.7-.6-8.6-2-12zM9.5 14.5c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7zm5 0c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7z"/>',
}[n];return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;}

/* ============================================================ analytics */
const matchKind=(s)=>s.kind||"scrim";
const matchesOf=(kind)=>team().scrims.filter(s=>matchKind(s)===(kind||"scrim"));
/* perfWindow: 5/10/15 = rolling N scrims, 0 = lifetime */
const PERF_WINDOWS=[5,10,15,0];
const perfN=()=>state.perfWindow||Infinity;
const perfWindowLabel=()=>state.perfWindow?`rolling ${state.perfWindow} scrims`:"lifetime";
function scrimsInWeek(mon){const a=iso(mon),b=iso(addDays(mon,7));return matchesOf("scrim").filter(s=>s.date>=a&&s.date<b);}
/* --- match list filtering (Scrims / Officials tabs) --- */
function mfCount(){const f=state.mfilter;return ["map","opp","result","margin","player","agent","since"].filter(k=>f[k]).length+(f.comp.length?1:0);}
function mfClear(){state.mfilter={...MFILTER_DEF,comp:[]};}
function applyMatchFilter(list){
  const f=state.mfilter;
  const days={"30":30,"90":90,"180":180,"365":365}[f.since];
  const cut=days?iso(addDays(new Date(),-days)):null;
  const lc=(f.opp||"").toLowerCase();
  return list.filter(s=>{
    if(f.map&&s.map!==f.map)return false;
    if(lc&&!String(s.opp||"").toLowerCase().includes(lc))return false;
    if(cut&&s.date<cut)return false;
    const m=(s.rw||0)-(s.rl||0),am=Math.abs(m);
    if(f.result==="win"&&m<=0)return false;
    if(f.result==="loss"&&m>=0)return false;
    if(f.result==="draw"&&m!==0)return false;
    if(f.margin==="close"&&am>3)return false;
    if(f.margin==="mid"&&(am<4||am>6))return false;
    if(f.margin==="big"&&am<7)return false;
    const ags=(s.lineup||[]).map(l=>l.agent);
    if(f.agent&&!ags.includes(f.agent))return false;
    if(f.comp.length&&!f.comp.every(a=>ags.includes(a)))return false;
    if(f.player&&!(s.lineup||[]).some(l=>l.pid===f.player&&l.present))return false;
    return true;
  });
}
function isTournamentWeek(mon){return (team().tournamentWeeks||[]).includes(iso(mon));}
function weekGoal(mon){const g=team().scrimGoal;return isTournamentWeek(mon)?g.tournament:g.base;}

function scrimRatings(scrim){
  const rounds=(scrim.rw||0)+(scrim.rl||0);
  return scrim.lineup.map(l=>{
    const kpr=rounds?l.k/rounds:0,dpr=rounds?l.d/rounds:0;
    const adr=l.adr??estADR(kpr), kast=l.kast??estKAST(kpr,dpr);
    return {...l,adr,kast,kd:l.k/Math.max(l.d,1),
      rating:rating20(l.k,l.d,l.a,rounds,adr,kast)};
  });
}
function playerRolling(pid,n,kind){
  const list=matchesOf(kind).slice().sort((a,b)=>a.date<b.date?1:-1);
  const lim=n||Infinity;
  const vals=[];
  for(const s of list){const row=scrimRatings(s).find(r=>r.pid===pid&&r.present);
    if(row&&row.rating!=null){vals.push({date:s.date,rating:row.rating,kd:row.kd,map:s.map});}
    if(vals.length>=lim)break;}
  return vals;
}
function performanceTable(n){
  const lifetime=!n;
  return team().roster.filter(p=>p.status==="Starter"||p.status==="Sub").map(p=>{
    const cur=playerRolling(p.id,n,"scrim");
    const prev=lifetime?[]:playerRolling(p.id,n*2,"scrim").slice(n,n*2);
    const off=playerRolling(p.id,0,"official");
    const a=mean(cur.map(v=>v.rating));
    const pv=mean(prev.map(v=>v.rating));
    const offA=mean(off.map(v=>v.rating));
    const kd=mean(cur.map(v=>v.kd));
    return {p,games:cur.length,rating:a,prevRating:pv,delta:(a!=null&&pv!=null)?a-pv:null,kd,
      offGames:off.length,offRating:offA,offDelta:(a!=null&&offA!=null)?offA-a:null,
      flag:a!=null&&a<RATING_BASELINE,trend:cur.map(v=>v.rating).reverse()};
  }).sort((x,y)=>(x.rating??9)-(y.rating??9));
}
/* team rank = average of the current roster's live ranks */
function teamRank(includeSubs){
  const ps=team().roster.filter(p=>p.status==="Starter"||(includeSubs&&p.status==="Sub"));
  return avgRank(ps.map(p=>p.rank));
}
function attendanceRate(pid,lastN){
  const list=matchesOf("scrim").slice().sort((a,b)=>a.date<b.date?1:-1).slice(0,lastN||99);
  let tot=0,pres=0;list.forEach(s=>{const l=s.lineup.find(x=>x.pid===pid);if(l){tot++;if(l.present)pres++;}});
  return tot?pres/tot:null;
}
function bestAgentsForMap(map){
  const rows=matchesOf("scrim").filter(s=>s.map===map).flatMap(s=>{
    const rt=scrimRatings(s);const win=s.rw>s.rl;
    return rt.filter(r=>r.present).map(r=>({pid:r.pid,agent:r.agent,win,rating:r.rating??RATING_BASELINE}));
  });
  const byPlayer={};
  rows.forEach(r=>{
    byPlayer[r.pid]=byPlayer[r.pid]||{};
    const a=byPlayer[r.pid][r.agent]=byPlayer[r.pid][r.agent]||{games:0,wins:0,rating:0};
    a.games++;a.wins+=r.win?1:0;a.rating+=r.rating;
  });
  return team().roster.filter(p=>p.status==="Starter").map(p=>{
    const m=byPlayer[p.id]||{};
    const opts=Object.entries(m).map(([agent,d])=>({agent,games:d.games,wr:d.wins/d.games,rating:d.rating/d.games}))
      .sort((a,b)=>(b.wr*.55+b.rating*.225)-(a.wr*.55+a.rating*.225));
    return {p,opts,best:opts[0]||null};
  });
}

/* ============================================================ free-time solver */
function freeSolve(){
  const s=team().schedule;
  const ws=t2m(s.winStart),we=t2m(s.winEnd);
  const active=team().roster.filter(p=>p.status==="Starter"||(s.includeSubs&&p.status==="Sub"));
  const step=30;
  const grid=[];// [day][slotIdx] = freeCount
  const windows=[];
  for(let day=0;day<7;day++){
    grid[day]=[];
    let runStart=null;
    for(let m=ws;m<we;m+=step){
      let free=0;
      active.forEach(p=>{
        const busy=s.blocks.some(b=>b.pid===p.id&&b.day===day&&t2m(b.start)<m+step&&t2m(b.end)>m);
        if(!busy)free++;
      });
      grid[day].push(free);
      const allFree=free===active.length&&active.length>0;
      if(allFree&&runStart==null)runStart=m;
      if((!allFree||m+step>=we)&&runStart!=null){
        const end=allFree?m+step:m;
        if(end-runStart>=90)windows.push({day,start:runStart,end,mins:end-runStart});
        runStart=null;
      }
    }
  }
  return {grid,windows,active,ws,we,step};
}

/* ============================================================ render */
const initials=n=>String(n||"?").trim().split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase()||"?";
const teamTag=t=>String((t&&(t.tag||t.name))||"?").replace(/\s+/g,"").slice(0,3).toUpperCase();

function render(){
  if(!BUNDLE)return;
  $("#app").hidden=false; $("#gate").hidden=true;
  $("#viewTitle").textContent=NAV.find(n=>n[0]===state.view)[1];

  // masthead
  const me=ME&&ME.user;
  $("#acctName").textContent=me?me.name:"";
  $("#acctInit").textContent=initials(me&&me.name);
  paintTheme();

  // title block — team, role, and only the controls this view actually uses
  $("#teamTag").textContent=teamTag(team());
  $("#teamName").textContent=team().name;
  const rb=$("#roleBadge"); rb.hidden=false; rb.textContent=myRole();
  rb.className="chip "+(canManage()?"accent":canEdit()?"":"warn");
  const weekly=WEEK_VIEWS.has(state.view);
  $("#topctl").hidden=!weekly;
  $("#wkLabel").textContent=fmtRange(state.week);
  $("#tourPill").hidden=!canEdit();
  $("#tourPill").classList.toggle("on",isTournamentWeek(state.week));

  $("#nav").innerHTML=NAV.map(n=>`<button data-v="${n[0]}" class="${n[0]===state.view?'on':''}">${esc(n[1])}</button>`).join("");
  keepTabVisible();
  VIEWS[state.view]();
}
/* on a phone the tab strip scrolls — keep the active tab on screen */
function keepTabVisible(){
  const nav=$("#nav"); if(!nav)return;
  if(!(nav.scrollWidth>nav.clientWidth))return;
  const on=nav.querySelector("button.on");
  if(on&&on.scrollIntoView)on.scrollIntoView({block:"nearest",inline:"center"});
}
const M=$("#main");

/* -------- overview -------- */
VIEWS_overview=()=>{
  const mon=state.week, goal=weekGoal(mon), done=scrimsInWeek(mon).length;
  const perf=performanceTable(state.perfWindow);
  const flagged=perf.filter(r=>r.flag);
  const starters=team().roster.filter(p=>p.status==="Starter");
  const tr=teamRank();
  const rDelta=teamRankDelta(14)||0;   // 14-day team rank movement (from synced rank history)
  const att=(()=>{const list=matchesOf("scrim").slice(-5);let tot=0,p=0;list.forEach(s=>s.lineup.forEach(l=>{tot++;if(l.present)p++;}));return tot?p/tot:null;})();
  const wk=team().activities.weeks[iso(mon)];
  let nextAct=null;
  if(wk)for(const d of DAYS){for(const it of (wk[d]||[])){nextAct=nextAct||{d,...it};}}
  const fs=freeSolve();
  const recent=matchesOf("scrim").slice().sort((a,b)=>a.date<b.date?1:-1).slice(0,5);

  M.innerHTML=`
  <div class="grid">
    <div class="p111">
      ${statCard("Scrims this week",`${done}<small>/${goal}</small>`,
        goal?bar(done/goal):"",isTournamentWeek(mon)?"Tournament cadence":"Standard cadence")}
      ${statCard("Team rank",tr?rankStr(tr):"—",
        tr?`<span class="d ${rDelta>0.15?'up':rDelta<-0.15?'down':'flat'}">${rDelta>0.15?'▲ ':rDelta<-0.15?'▼ ':''}${tr.rr} RR</span>`:"",
        "Avg of starters' live ranks")}
      ${statCard("Scrim attendance",att!=null?Math.round(att*100)+"%":"—","","Last 5 scrims, all players")}
    </div>
    <div class="p31">
      <div class="panel">
        <div class="panel-h"><h3>Focus list</h3><span class="hint">${perfWindowLabel()}</span></div>
        <div class="panel-b">
          ${flagged.length?flagged.map(r=>`
            <div class="rowline">
              <div style="display:flex;align-items:center;gap:9px">
                <span style="font-size:16px">${esc(r.p.icon)}</span>
                <div><div style="font-family:var(--disp);font-weight:600">${esc(r.p.handle)}</div>
                <div class="sub">${esc(roleStr(r.p))} · avg R2.0 ${r.rating.toFixed(2)}</div></div>
              </div>
              <span class="chip crit">Below ${RATING_BASELINE.toFixed(2)}</span>
            </div>`).join(""):
            `<div class="callout good">No starter is averaging below ${RATING_BASELINE.toFixed(2)} Rating 2.0 (${perfWindowLabel()}).</div>`}
          <div style="margin-top:12px"><button class="btn ghost sm" data-go="performance">Open performance →</button></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-h"><h3>Next up</h3></div>
        <div class="panel-b">
          ${nextAct?`<div class="eyebrow">${nextAct.d}</div>
            <div style="font-family:var(--serif);font-size:20px">${esc(nextAct.title)}</div>
            <div class="sub">${nextAct.time} · ${esc(nextAct.type)}</div>`:
            `<div class="sub">No activities planned this week.</div>`}
          <div style="margin-top:12px"><button class="btn ghost sm" data-go="activities">Plan week →</button></div>
        </div>
      </div>
    </div>
    <div class="p22">
      <div class="panel">
        <div class="panel-h"><h3>Unified free time</h3><span class="hint">${fs.windows.length} windows ≥ 90m</span></div>
        <div class="panel-b">
          ${fs.windows.length?fs.windows.slice(0,5).map(w=>`
            <div class="rowline"><span class="mono">${DAYS[w.day]} · ${m2t(w.start)}–${m2t(w.end)}</span>
            <span class="chip good">${Math.floor(w.mins/60)}h${w.mins%60?(w.mins%60)+'m':''}</span></div>`).join(""):
            `<div class="sub">No shared windows — adjust class blocks or the active window.</div>`}
          <div style="margin-top:12px"><button class="btn ghost sm" data-go="schedule">Open scheduler →</button></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-h"><h3>Recent scrims</h3></div>
        <div class="panel-b">
          ${recent.map(s=>`<div class="rowline">
            <span class="mono">${s.date.slice(5)} · ${esc(s.map)}</span>
            <span>vs ${esc(s.opp)} <span class="chip ${s.rw>s.rl?'good':'crit'}">${s.rw}–${s.rl}</span></span>
          </div>`).join("")}
          <div style="margin-top:12px"><button class="btn ghost sm" data-go="scrims">Log a scrim →</button></div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-h"><h3>Month focus · ${monthLabel(monthKey(mon))}</h3></div>
      <div class="panel-b">${monthBody(monthKey(mon))}</div>
    </div>
  </div>`;
  M.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{state.view=b.dataset.go;render();});
};
function statCard(k,v,extra,sub){return `<div class="panel pad"><div class="stat">
  <span class="k">${k}</span><span class="v">${v}</span>
  ${extra||""}
  ${sub?`<span class="d flat">${sub}</span>`:""}</div></div>`;}
function bar(f,good){return `<div class="bar"><i class="${good?'good':''}" style="width:${clamp(f*100,0,100)}%"></i></div>`;}
function monthBody(k){
  const m=team().activities.months[k];
  const ke=esc(k);
  if(!m)return `<div class="sub">No plan for this month.${canEdit()?` <button class="btn ghost sm" data-editmonth="${ke}">Add focus</button>`:''}</div>`;
  return `<div class="eyebrow">Theme</div><p style="margin:0 0 12px">${esc(m.theme)||'<span class="sub">—</span>'}</p>
    ${(m.goals||[]).map((g,i)=>`<div class="rowline"><label style="display:flex;gap:8px;align-items:center;${canEdit()?'cursor:pointer':''}">
      <input type="checkbox" ${g.done?'checked':''} ${canEdit()?`data-goaltoggle="${ke}|${i}"`:'disabled'}> <span style="${g.done?'text-decoration:line-through;color:var(--ink-3)':''}">${esc(g.text)}</span></label></div>`).join("")}
    ${canEdit()?`<div style="margin-top:12px"><button class="btn ghost sm" data-editmonth="${ke}">Edit month</button></div>`:''}`;
}
window.toggleMonthGoal=(k,i)=>{
  const m=team().activities.months[k];
  const goals=(m.goals||[]).map((g,j)=>j===i?{...g,done:!g.done}:g);
  act(API.put(`/api/teams/${TID()}/activities/months/${k}`,{theme:m.theme,goals}));
};
window.editMonth=(k)=>{
  if(!canEdit())return;
  const m=team().activities.months[k]||{theme:"",goals:[]};
  openForm({title:"Month focus · "+monthLabel(k),fields:[
    {name:"theme",label:"Theme",type:"textarea",value:m.theme},
    {name:"goals",label:"Goals (one per line)",type:"textarea",value:(m.goals||[]).map(g=>g.text).join("\n"),hint:"Checkboxes reset when you rename a goal"},
  ]},d=>{
    const old=m.goals||[];
    const goals=d.goals.split("\n").map(s=>s.trim()).filter(Boolean).map(text=>{
      const prev=old.find(g=>g.text===text);return {text,done:prev?prev.done:false};});
    act(API.put(`/api/teams/${TID()}/activities/months/${k}`,{theme:d.theme,goals}),"Month updated");
  });
};

/* -------- roster -------- */
VIEWS_roster=()=>{
  const r=team().roster;
  const groups=STATUS.map(st=>[st,r.filter(p=>p.status===st)]).filter(g=>g[1].length);
  const hasIds=r.some(p=>p.riotId&&p.riotId.name);
  M.innerHTML=`<div class="grid">
    ${canEdit()?`<div class="btn-row"><button class="btn" id="addP">${icon('users')} Add player</button>
    <button class="btn ghost" id="syncAll" ${state.syncing||!hasIds?'disabled':''}>${state.syncing?'Syncing ranks…':'⟳ Sync ranks'}</button>
    ${canManage()?`<button class="btn ghost" id="invite">${icon('users')} Invite member</button>
    <button class="btn ghost" id="members">Members</button>`:''}
    <button class="btn ghost" id="editTeam">Team settings</button></div>
    ${team().hasRankApiKey||!hasIds?'':`<div class="callout warn">Add a HenrikDev API key in <b>Team settings</b> to enable rank sync.</div>`}`:''}
    ${groups.map(([st,ps])=>`
      <div>
        <div class="eyebrow">${st} · ${ps.length}</div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
          ${ps.map(p=>`<div class="pcard">
            <div class="top">
              <div class="ico">${esc(p.icon||'•')}</div>
              <div style="flex:1"><div class="hd">${esc(p.handle)}</div><div class="rl">${esc(roleStr(p))}</div></div>
              ${canEdit()&&p.riotId&&p.riotId.name?`<button class="icar" data-sync="${p.id}" title="Sync rank from Riot ID" ${state.syncing?'disabled':''}>⟳</button>`:''}
              ${canEdit()||isMe(p.id)?`<button class="icar" data-edit="${p.id}" title="Edit">✎</button>`:''}
            </div>
            <div class="sub">${esc(p.name||'—')}${p.riotId&&p.riotId.name?` · <span class="mono">${esc(p.riotId.name+'#'+p.riotId.tag)}</span>`:''}</div>
            <div class="agents">${(p.agents||[]).map(a=>`<span class="chip">${esc(a)}</span>`).join("")||'<span class="sub">no agent pool</span>'}</div>
            ${p.note?`<div class="sub" style="border-top:1px solid var(--border);padding-top:8px">${esc(p.note)}</div>`:""}
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              <span class="chip accent">${fmtRank(p.rank)}</span>
              ${p.rankSyncedAt?`<span class="sub" style="font-size:10px" title="Rank from sync">⟳ ${agoShort(p.rankSyncedAt)}</span>`:''}
              <span class="chip">Att ${(()=>{const a=attendanceRate(p.id);return a!=null?Math.round(a*100)+'%':'—';})()}</span>
              <span class="chip">Since W${weeksSince(p.joined)}</span>
            </div>
          </div>`).join("")}
        </div>
      </div>`).join("")}
  </div>`;
  const ap=$("#addP");if(ap)ap.onclick=()=>editPlayer();
  const et=$("#editTeam");if(et)et.onclick=editTeamSettings;
  const sa=$("#syncAll");if(sa)sa.onclick=()=>syncRanks();
  const iv=$("#invite");if(iv)iv.onclick=inviteDialog;
  const mb=$("#members");if(mb)mb.onclick=membersDialog;
  M.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editPlayer(b.dataset.edit));
  M.querySelectorAll("[data-sync]").forEach(b=>b.onclick=()=>syncRanks(team().roster.find(p=>p.id===b.dataset.sync)));
};
function weeksSince(d){if(!d)return "?";return Math.max(0,Math.round((Date.now()-parse(d))/6048e5));}
function editPlayer(id){
  const admin=canEdit();
  const mine=isMe(id);
  if(id && !admin && !mine){ toast("You can only edit your own profile"); return; }
  const p=id?team().roster.find(x=>x.id===id):{handle:"",name:"",roles:["Duelist"],agents:[],status:"Trial",icon:"🎯",joined:iso(new Date()),rank:{tier:"Ascendant",div:1,rr:0},riotId:{name:"",tag:"",region:""},note:""};
  const curRoles=(p.roles&&p.roles.length?p.roles:(p.role?[p.role]:[]));
  const rk=p.rank||{tier:"Ascendant",div:1,rr:0};
  const ri=p.riotId||{name:"",tag:"",region:""};
  const fields=[];
  // identity + gameplay prefs: a player may edit their own; roster decisions (status, joined) are admin-only
  fields.push(
    {row:[{name:"handle",label:"Handle",type:"text",value:p.handle,required:true},
          {name:"icon",label:"Icon",type:"text",value:p.icon,hint:"emoji"}]},
    {name:"name",label:"Real name",type:"text",value:p.name},
    {name:"roles",label:"Roles (tick all that apply)",type:"multiselect",options:ROLES,value:curRoles},
  );
  if(admin){
    fields.push(
      {row:[{name:"status",label:"Status",type:"select",options:STATUS,value:p.status},
            {name:"joined",label:"Joined",type:"date",value:p.joined}]},
    );
  }
  fields.push(
    {row:[{name:"riotName",label:"Riot ID — name",type:"text",value:ri.name,hint:"before the #"},
          {name:"riotTag",label:"Riot ID — tag",type:"text",value:ri.tag,hint:"after the #"}]},
    {name:"riotRegion",label:"Account region",type:"select",options:[{v:"",t:"(use team's region)"},{v:"eu",t:"eu"},{v:"na",t:"na"},{v:"ap",t:"ap"},{v:"kr",t:"kr"},{v:"latam",t:"latam"},{v:"br",t:"br"}],value:ri.region||""},
    {row:[{name:"rtier",label:"Current rank",type:"select",options:RANK_TIERS,value:rk.tier},
          {name:"rdiv",label:"Division",type:"select",options:[1,2,3],value:rk.div}]},
    {name:"rrr",label:"RR in division",type:"number",value:rk.rr,min:0,max:100,hint:"Auto-filled by “Sync ranks” when a Riot ID + API key are set"},
  );
  fields.push(
    {name:"agents",label:"Agent pool",type:"multiselect",options:AGENTS,value:p.agents},
    {name:"note",label:admin?"Coach notes":"Notes",type:"textarea",value:p.note},
  );
  openForm({
    title:id?(admin?"Edit "+p.handle:"My profile"):"Add player",
    del:(id&&admin)?()=>act(API.del(`/api/teams/${TID()}/players/${id}`),"Player removed"):null,
    fields,
  },d=>{
    const rank={tier:d.rtier,div:+d.rdiv,rr:clamp(+d.rrr||0,0,100)};
    const riotId={name:(d.riotName||"").trim(),tag:(d.riotTag||"").replace(/^#/,"").trim(),region:d.riotRegion||""};
    ["rtier","rdiv","rrr","riotName","riotTag","riotRegion"].forEach(k=>delete d[k]);
    // server enforces which fields each role may write; send everything we collected
    act(id?API.put(`/api/teams/${TID()}/players/${id}`,{...d,rank,riotId}):API.post(`/api/teams/${TID()}/players`,{...d,rank,riotId}),
        id?"Saved":"Player added");
  });
}
function editTeamSettings(){
  if(!canEdit())return;
  const t=team();
  const fields=[
    {row:[{name:"name",label:"Team name",type:"text",value:t.name,required:true},
          {name:"tag",label:"Tag",type:"text",value:t.tag}]},
    {row:[{name:"server",label:"Region",type:"select",options:["EU","NA","APAC","BR","LATAM","KR"],value:t.server},
          {name:"gbase",label:"Scrim goal / week",type:"number",value:t.scrimGoal.base,min:0}]},
    {name:"gtour",label:"Scrim goal / tournament week",type:"number",value:t.scrimGoal.tournament,min:0},
  ];
  if(canManage()) fields.push({name:"rankApiKey",label:"Rank sync API key",type:"text",value:"",
    hint:`${t.hasRankApiKey?"A key is set. Leave blank to keep it; type a new one to replace it.":"HenrikDev Valorant API key (free — request in their Discord). Blank = ranks stay manual."}`});
  openForm({title:"Team settings",fields},async d=>{
    try{
      await API.put(`/api/teams/${TID()}`,{name:d.name,tag:d.tag,server:d.server,
        scrimGoal:{base:+d.gbase,tournament:+d.gtour},tournamentWeeks:team().tournamentWeeks||[]});
      if(canManage() && (d.rankApiKey||"").trim()) await API.put(`/api/teams/${TID()}/secrets`,{rankApiKey:d.rankApiKey.trim()});
      await reload();render();toast("Team saved");
    }catch(e){toast(e.message);}
  });
}

/* -------- schedule -------- */
const putSchedule=(next,msg)=>act(API.put(`/api/teams/${TID()}/schedule`,next),msg);
const putMyBlocks=(blocks,msg)=>act(API.put(`/api/teams/${TID()}/schedule/mine`,{blocks}),msg);
const myBlocks=()=>(team().schedule.blocks||[]).filter(x=>x.pid===BUNDLE.myPlayerId);
VIEWS_schedule=()=>{
  const s=team().schedule, fs=freeSolve();
  const canBlk=canEdit()||!!BUNDLE.myPlayerId;
  const rows=[];
  for(let m=fs.ws;m<fs.we;m+=fs.step)rows.push(m);
  M.innerHTML=`<div class="grid">
    <div class="btn-row">
      ${canBlk?`<button class="btn" id="addBlk">${icon('clock')} Add ${canEdit()?'class / busy block':'my availability block'}</button>`:''}
      ${canEdit()?`<button class="btn ghost" id="winBtn">Active window · ${s.winStart}–${s.winEnd}</button>
      <label class="chip" style="cursor:pointer"><input type="checkbox" id="subsChk" ${s.includeSubs?'checked':''} style="margin-right:6px">Include subs in overlap</label>`:
      `<span class="chip">Active window ${s.winStart}–${s.winEnd}</span>`}
    </div>
    <div class="p31">
      <div class="panel">
        <div class="panel-h"><h3>Unified availability</h3><span class="hint">green = whole roster free</span></div>
        <div class="panel-b">
          <div class="sgrid" style="grid-template-columns:56px repeat(7,1fr)">
            <div class="hcell"></div>${DAYS.map(d=>`<div class="hcell">${d}</div>`).join("")}
            ${rows.map((m,ri)=>`<div class="tcell">${m%60===0?m2t(m):''}</div>`+
              DAYS.map((d,di)=>{
                const free=fs.grid[di][ri];const active=fs.active.length;
                const ratio=active?free/active:0;
                const cls=ratio>=1?'f3':ratio>=.66?'f2':ratio>0?'f1':'';
                const inWin=fs.windows.some(w=>w.day===di&&m>=w.start&&m<w.end);
                return `<div class="cell ${cls} ${inWin?'win':''}" title="${DAYS[di]} ${m2t(m)} — ${free}/${active} free"></div>`;
              }).join("")
            ).join("")}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-h"><h3>Scrim slots</h3><span class="hint">≥ 90 min</span></div>
        <div class="panel-b">
          ${fs.windows.length?fs.windows.map(w=>`<div class="rowline">
            <span class="mono">${DAYS[w.day]} ${m2t(w.start)}–${m2t(w.end)}</span>
            <span class="chip good">${Math.floor(w.mins/60)}h${w.mins%60?(w.mins%60)+'m':''}</span></div>`).join(""):
            `<div class="sub">No windows. Loosen the active window or trim conflicts.</div>`}
          <div class="callout" style="margin-top:12px">Active players in overlap: <b>${esc(fs.active.map(p=>p.handle).join(", "))}</b></div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-h"><h3>Busy blocks</h3><span class="hint">class · work · commitments</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Player</th><th>Day</th><th>Start</th><th>End</th><th>Label</th><th></th></tr></thead>
        <tbody>${(s.blocks||[]).slice().sort((a,b)=>a.day-b.day||t2m(a.start)-t2m(b.start)).map(b=>{
          const own=b.pid===BUNDLE.myPlayerId;
          return `<tr><td>${P(b.pid).icon} ${esc(P(b.pid).handle)}</td><td>${DAYS[b.day]}</td>
          <td class="mono">${b.start}</td><td class="mono">${b.end}</td><td>${esc(b.label||'')}</td>
          <td style="text-align:right">${canEdit()||own?`<button class="icar" data-delblk="${b.id}">✕</button>`:''}</td></tr>`;
        }).join("")||
          `<tr><td colspan="6" class="empty">No blocks — everyone always free</td></tr>`}
        </tbody>
      </table></div>
    </div>
  </div>`;
  const ab=$("#addBlk");if(ab)ab.onclick=()=>editBlock();
  const sc=$("#subsChk");if(sc)sc.onchange=e=>putSchedule({...s,includeSubs:e.target.checked});
  const wb=$("#winBtn");if(wb)wb.onclick=()=>{
    openForm({title:"Active window",fields:[
      {row:[{name:"winStart",label:"Day starts",type:"text",value:s.winStart,hint:"HH:MM"},
            {name:"winEnd",label:"Day ends",type:"text",value:s.winEnd,hint:"HH:MM (24:00 ok)"}]}
    ]},d=>putSchedule({...s,winStart:d.winStart,winEnd:d.winEnd},"Window updated"));
  };
  M.querySelectorAll("[data-delblk]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.delblk;
    if(canEdit())putSchedule({...s,blocks:(s.blocks||[]).filter(x=>x.id!==id)});
    else putMyBlocks(myBlocks().filter(x=>x.id!==id));
  });
};
function editBlock(){
  const s=team().schedule;
  const admin=canEdit();
  const fields=[];
  if(admin) fields.push({name:"pid",label:"Player",type:"select",options:team().roster.map(p=>({v:p.id,t:p.handle})),value:team().roster[0]?.id});
  fields.push(
    {name:"day",label:"Day",type:"select",options:DAYS.map((d,i)=>({v:i,t:d})),value:0},
    {row:[{name:"start",label:"Start",type:"text",value:"13:00",hint:"HH:MM"},
          {name:"end",label:"End",type:"text",value:"15:00",hint:"HH:MM"}]},
    {name:"label",label:"Label",type:"text",value:"Class"},
  );
  openForm({title:admin?"Busy block":"My availability block",fields},d=>{
    const blk={id:uid(),day:+d.day,start:d.start,end:d.end,label:d.label};
    if(admin){blk.pid=d.pid;putSchedule({...s,blocks:[...(s.blocks||[]),blk]},"Block added");}
    else putMyBlocks([...myBlocks(),blk],"Block added");
  });
}

/* -------- activities -------- */
VIEWS_activities=()=>{
  const key=iso(state.week);
  const wk=team().activities.weeks[key]||Object.fromEntries(DAYS.map(d=>[d,[]]));
  const mk=monthKey(state.week);
  const ed=canEdit();
  const saveWeek=(next,msg)=>act(API.put(`/api/teams/${TID()}/activities/weeks/${key}`,{data:next}),msg);
  const months=team().activities.months;
  M.innerHTML=`<div class="grid">
    <div class="panel">
      <div class="panel-h"><h3>Week plan · ${fmtRange(state.week)}</h3><span class="hint">${isTournamentWeek(state.week)?'tournament week':'standard week'}</span></div>
      <div class="panel-b">
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
          ${DAYS.map(d=>`<div class="pcard" style="gap:8px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="rl">${d}</span>${ed?`<button class="icar" data-addact="${d}">+</button>`:''}</div>
            ${(wk[d]||[]).slice().sort((a,b)=>a.time<b.time?-1:1).map(it=>`
              <div style="border:1px solid var(--border);border-radius:2px;padding:7px;font-size:12px">
                <div class="mono" style="font-size:10px;color:var(--ink-3)">${esc(it.time)} · ${esc(it.type)}</div>
                <div>${esc(it.title)}</div>
                ${ed?`<button class="icar" style="width:20px;height:20px;font-size:10px;margin-top:4px" data-delact="${d}|${it.id}">✕</button>`:''}
              </div>`).join("")||`<div class="sub" style="font-size:11px">—</div>`}
          </div>`).join("")}
        </div>
      </div>
    </div>
    <div class="p22">
      <div class="panel">
        <div class="panel-h"><h3>${monthLabel(mk)}</h3>${ed?`<button class="icar" data-editmonth="${esc(mk)}">✎</button>`:''}</div>
        <div class="panel-b">${monthBody(mk)}</div>
      </div>
      <div class="panel">
        <div class="panel-h"><h3>Month grid</h3><span class="hint">expectations at a glance</span></div>
        <div class="panel-b">
          ${Object.keys(months).sort().map(k=>{
            const m=months[k];const g=m.goals||[];const done=g.filter(x=>x.done).length;
            return `<div class="rowline"><div><div style="font-family:var(--disp);font-weight:600">${monthLabel(k)}</div>
              <div class="sub">${esc(m.theme)}</div></div>
              <span class="chip ${done===g.length&&g.length?'good':'accent'}">${done}/${g.length}</span></div>`;
          }).join("")||'<div class="sub">No months planned</div>'}
          ${ed?`<div style="margin-top:12px"><button class="btn ghost sm" data-editmonth="${esc(monthKey(addDays(state.week,32)))}">Add next month →</button></div>`:''}
        </div>
      </div>
    </div>
  </div>`;
  M.querySelectorAll("[data-addact]").forEach(b=>b.onclick=()=>{
    const day=b.dataset.addact;
    openForm({title:"Activity · "+day,fields:[
      {row:[{name:"time",label:"Time",type:"text",value:"19:00"},
            {name:"type",label:"Type",type:"select",options:["Scrim","Review","Practice","Theory","Team","VOD","Tournament","Off"],value:"Scrim"}]},
      {name:"title",label:"What",type:"text",value:"",required:true},
    ]},d=>{
      const next={...wk};next[day]=[...(next[day]||[]),{id:uid(),...d}];
      saveWeek(next);
    });
  });
  M.querySelectorAll("[data-delact]").forEach(b=>b.onclick=()=>{
    const[day,id]=b.dataset.delact.split("|");
    const next={...wk};next[day]=(next[day]||[]).filter(x=>x.id!==id);
    saveWeek(next);
  });
};

/* -------- ranks -------- */
VIEWS_ranks=()=>{
  if(state.rankHist===null){
    M.innerHTML=`<div class="panel pad empty">Loading rank history…</div>`;
    API.get(`/api/teams/${TID()}/rank-history`)
      .then(r=>{state.rankHist=r.history||[];render();})
      .catch(e=>{state.rankHist=[];toast(e.message||"Couldn't load rank history");render();});
    return;
  }
  // guard against pre-existing glitch rows (below Iron 1 / no elo) that predate
  // the server-side despike — a "Rebuild history" clears them for good.
  const hist=(state.rankHist||[]).filter(e=>e.tierId>=3&&e.elo>0);
  const roster=team().roster.filter(p=>p.status!=="Inactive");
  const byPlayer={};roster.forEach(p=>byPlayer[p.id]=[]);
  hist.forEach(e=>{if(byPlayer[e.playerId])byPlayer[e.playerId].push(e);});
  Object.values(byPlayer).forEach(a=>a.sort((x,y)=>x.playedAt<y.playedAt?-1:1));
  const live=teamRank();
  const sel=state.rankView;
  const seg=`<span class="rkseg">
    <button class="${sel==='team'?'on':''}" data-rv="team">Team</button>
    ${roster.map(p=>`<button class="${sel===p.id?'on':''}" data-rv="${p.id}">${esc(p.handle)}${byPlayer[p.id].length?'':' <span class="sub">·0</span>'}</button>`).join("")}
  </span>`;
  let bodyHTML;
  if(!hist.length){
    bodyHTML=`<div class="panel pad empty">No rank history yet.<br>
      ${team().hasRankApiKey
        ? (canEdit()?'Hit <b>⟳ Sync rank history</b> above — it pulls every ranked game HenrikDev has stored for each roster player, then keeps only new games on later syncs.':'An admin needs to run a rank sync.')
        : 'Add a HenrikDev API key in <b>Team settings</b> first.'}</div>`;
  }else if(sel==='team'||!roster.some(p=>p.id===sel)){
    bodyHTML=rankTeamView(roster,byPlayer,live);
  }else{
    const p=roster.find(x=>x.id===sel);
    bodyHTML=rankPlayerView(p,byPlayer[p.id]||[]);
  }
  M.innerHTML=`<div class="grid">
    <div class="btn-row" style="flex-wrap:wrap;gap:8px">
      ${canEdit()?`<button class="btn" id="rkSync" ${state.syncing?'disabled':''}>${state.syncing?'Syncing…':'⟳ Sync rank history'}</button>`:''}
      ${canEdit()&&hist.length?`<button class="btn ghost" id="rkRebuild" ${state.syncing?'disabled':''}>Rebuild from scratch</button>`:''}
      <span class="chip">Team rank now · ${fmtRank(live)}</span>
    </div>
    ${rankSyncPanel()}
    ${seg}
    ${bodyHTML}
  </div>`;
  const sy=$("#rkSync");if(sy)sy.onclick=()=>syncRanks();
  const rb=$("#rkRebuild");if(rb)rb.onclick=()=>syncRanks(null,{rebuild:true});
  const dz=$("#rkSyncX");if(dz)dz.onclick=()=>{state.rankSync=null;render();};
  M.querySelectorAll("[data-rv]").forEach(b=>b.onclick=()=>{state.rankView=b.dataset.rv;render();});
  M.querySelectorAll("[data-drophist]").forEach(b=>b.onclick=async()=>{
    if(!confirm("Drop this ranked game from the history?"))return;
    try{ await API.del(`/api/teams/${TID()}/rank-history/${b.dataset.pid}/${encodeURIComponent(b.dataset.drophist)}`);
      state.rankHist=null; toast("Game dropped"); render(); }
    catch(e){ toast(e.message); }
  });
};
function rankSyncPanel(){
  const r=state.rankSync;if(!r||!r.players||!r.players.length)return "";
  const ico={ok:'<span class="chip good">✓</span>',unrated:'<span class="chip warn">unrated</span>',error:'<span class="chip crit">✕</span>'};
  return `<div class="panel">
    <div class="panel-h"><h3>Last sync result</h3>
      <button class="icar" id="rkSyncX" title="Dismiss">✕</button></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Player</th><th>Status</th><th>Rank</th><th class="num">+games</th><th class="num">dropped</th><th>Notes</th></tr></thead>
      <tbody>${r.players.map(p=>`<tr>
        <td>${esc(p.handle)}</td>
        <td>${ico[p.status]||p.status}</td>
        <td>${p.rank?esc(rankStr(p.rank)):'—'}</td>
        <td class="num">${p.added||0}</td>
        <td class="num ${p.dropped?'down':''}">${p.dropped||0}</td>
        <td class="sub">${esc(p.err||'')}</td>
      </tr>`).join("")}</tbody>
    </table></div>
  </div>`;
}
function downsample(arr,n){
  if(arr.length<=n)return arr;
  const out=[],step=(arr.length-1)/(n-1);
  for(let i=0;i<n;i++)out.push(arr[Math.round(i*step)]);
  return out;
}
/* 14-day team rank movement in rank-units, from synced history; null if unavailable */
function teamRankDelta(days){
  const h=state.rankHist;
  if(!h||!h.length)return null;
  const ids=new Set(team().roster.map(p=>p.id));
  const by={};
  h.forEach(e=>{if(ids.has(e.playerId))(by[e.playerId]=by[e.playerId]||[]).push(e);});
  const keys=Object.keys(by);if(!keys.length)return null;
  keys.forEach(k=>by[k].sort((a,b)=>a.playedAt<b.playedAt?-1:1));
  const cut=Date.now()-days*864e5;
  const eloAt=(arr)=>{let v=null;for(const e of arr){if(Date.parse(e.playedAt)<=cut)v=e.elo;else break;}return v;};
  const now=[],then=[];
  keys.forEach(k=>{now.push(by[k][by[k].length-1].elo);const t=eloAt(by[k]);if(t!=null)then.push(t);});
  if(!then.length)return null;
  return eloUnits(mean(now))-eloUnits(mean(then));
}
function teamEloSeries(byPlayer){
  const ids=Object.keys(byPlayer).filter(id=>byPlayer[id].length);
  if(!ids.length)return [];
  const stamps=[...new Set(ids.flatMap(id=>byPlayer[id].map(e=>e.playedAt)))].sort();
  const cursor={},latest={};ids.forEach(id=>cursor[id]=0);
  const out=[];
  for(const ts of stamps){
    ids.forEach(id=>{const a=byPlayer[id];while(cursor[id]<a.length&&a[cursor[id]].playedAt<=ts){latest[id]=a[cursor[id]].elo;cursor[id]++;}});
    const vals=ids.map(id=>latest[id]).filter(v=>v!=null);
    if(vals.length)out.push({t:Date.parse(ts),y:mean(vals)});
  }
  return out;
}
/* lines: [{label,color,pts:[{t,y:elo}]}] */
function mmrChart(lines){
  const w=640,h=230,padL=40,padR=14,padT=12,padB=22;
  const all=lines.flatMap(l=>l.pts);
  if(all.length<2)return `<div class="empty">Needs at least 2 ranked games to chart.</div>`;
  const xs=all.map(p=>p.t),ys=all.map(p=>eloUnits(p.y));
  const t0=Math.min(...xs),t1=Math.max(...xs);
  let lo=Math.min(...ys),hi=Math.max(...ys);const pu=Math.max(0.4,(hi-lo)*0.12);lo-=pu;hi+=pu;
  const X=t=>padL+(t1===t0?0.5:(t-t0)/(t1-t0))*(w-padL-padR);
  const Y=u=>h-padB-(u-lo)/((hi-lo)||1)*(h-padT-padB);
  const grid=[];for(let u=Math.ceil(lo);u<=hi;u++)grid.push(u);
  const df=t=>{const d=new Date(t);return (d.getMonth()+1)+'/'+d.getDate();};
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    ${grid.map(u=>`<line x1="${padL}" x2="${w-padR}" y1="${Y(u).toFixed(1)}" y2="${Y(u).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
      <text x="3" y="${(Y(u)+3).toFixed(1)}" font-size="9" fill="var(--ink-4)" font-family="'IBM Plex Sans',sans-serif">${rankShort(unitsToRank(u))}</text>`).join("")}
    <text x="${padL}" y="${h-5}" font-size="8" fill="var(--ink-3)" font-family="'IBM Plex Mono',monospace">${df(t0)}</text>
    <text x="${w-padR}" y="${h-5}" font-size="8" fill="var(--ink-3)" text-anchor="end" font-family="'IBM Plex Mono',monospace">${df(t1)}</text>
    ${lines.map(l=>{
      const pl=l.pts.slice().sort((a,b)=>a.t-b.t);
      const d=pl.map((p,i)=>`${i?'L':'M'}${X(p.t).toFixed(1)},${Y(eloUnits(p.y)).toFixed(1)}`).join(" ");
      const last=pl[pl.length-1];
      return `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round" opacity="${lines.length>1?0.9:1}"/>
        <circle cx="${X(last.t).toFixed(1)}" cy="${Y(eloUnits(last.y)).toFixed(1)}" r="3.2" fill="${l.color}"/>`;
    }).join("")}
  </svg>
  ${lines.length>1?`<div class="rklegend">${lines.map(l=>`<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join("")}</div>`:''}`;
}
function playerRankStats(a){
  const cur=a[a.length-1];
  const wins=a.filter(e=>e.lastChange>0).length,losses=a.filter(e=>e.lastChange<0).length;
  const net=a.reduce((s,e)=>s+(e.lastChange||0),0);
  const peak=a.reduce((m,e)=>e.elo>m.elo?e:m,a[0]);
  const wk=a.filter(e=>Date.parse(e.playedAt)>=Date.now()-7*864e5);
  const d7=wk.length?wk.reduce((s,e)=>s+(e.lastChange||0),0):null;
  let dir=Math.sign((cur&&cur.lastChange)||0),streak=0;
  for(let i=a.length-1;i>=0;i--){const s=Math.sign(a[i].lastChange||0);if(s===dir&&s!==0)streak++;else break;}
  return {cur,wins,losses,net,peak,d7,dir,streak};
}
function rankTeamView(roster,byPlayer,live){
  const tracked=roster.filter(p=>byPlayer[p.id].length);
  if(!tracked.length)return `<div class="panel pad empty">History synced, but no competitive games found for anyone on the roster yet.</div>`;
  const lines=[{label:"Team avg",color:"var(--accent)",pts:downsample(teamEloSeries(byPlayer),90)}];
  const rows=tracked.map(p=>({p,idx:roster.indexOf(p),a:byPlayer[p.id],...playerRankStats(byPlayer[p.id])}))
    .sort((x,y)=>(y.cur?y.cur.elo:0)-(x.cur?x.cur.elo:0));
  return `
    <div class="panel pad">
      <div class="eyebrow">Team rank trajectory · rolling average elo · ${tracked.length} tracked</div>
      ${mmrChart(lines)}
    </div>
    <div class="panel">
      <div class="panel-h"><h3>By player</h3><span class="hint">competitive queue · tap a row</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Player</th><th>Current</th><th class="num">RR</th><th class="num">7d Δ</th><th class="num">W–L</th><th class="num">Net RR</th><th>Peak</th><th class="num">Games</th></tr></thead>
        <tbody>${rows.map(r=>`<tr style="cursor:pointer" data-rv="${r.p.id}">
          <td><span style="color:${pColor(r.idx)}">●</span> ${esc(r.p.handle)}</td>
          <td>${r.cur?rankShort(tierRank(r.cur.tierId,r.cur.rr)):'—'}</td>
          <td class="num">${r.cur?tierRank(r.cur.tierId,r.cur.rr).rr:'—'}</td>
          <td class="num ${r.d7==null?'flat':r.d7>0?'up':r.d7<0?'down':'flat'}">${r.d7==null?'—':(r.d7>0?'+':'')+r.d7}</td>
          <td class="num">${r.wins}–${r.losses}</td>
          <td class="num ${r.net>0?'up':r.net<0?'down':'flat'}">${r.net>0?'+':''}${r.net}</td>
          <td>${rankShort(tierRank(r.peak.tierId,r.peak.rr))} ${tierRank(r.peak.tierId,r.peak.rr).rr}</td>
          <td class="num">${r.a.length}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;
}
function rankPlayerView(p,a){
  if(!a.length)return `<div class="panel pad empty">No ranked games tracked for ${esc(p.handle)} yet — ${p.riotId&&p.riotId.name?'run a sync':'add their Riot ID on the Roster tab first'}.</div>`;
  const s=playerRankStats(a);
  const first=a[0];
  const idx=Math.max(0,team().roster.findIndex(x=>x.id===p.id));
  const lines=[{label:p.handle,color:pColor(idx),pts:a.map(e=>({t:Date.parse(e.playedAt),y:e.elo}))}];
  const dstr=t=>new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  return `
    <div class="p111">
      ${statCard("Current",rankStr(tierRank(s.cur.tierId,s.cur.rr)),"",tierRank(s.cur.tierId,s.cur.rr).rr+" RR")}
      ${statCard("Tracked record",`${s.wins}<small>–${s.losses}</small>`,"",(s.net>0?'+':'')+s.net+" RR net")}
      ${statCard("Peak",rankStr(tierRank(s.peak.tierId,s.peak.rr)),"",dstr(s.peak.playedAt))}
    </div>
    <div class="panel pad">
      <div class="eyebrow">${esc(p.handle)} · elo per ranked game</div>
      ${mmrChart(lines)}
      <div class="hint" style="margin-top:6px">${a.length} games · ${s.dir>0?`W${s.streak} streak`:s.dir<0?`L${s.streak} streak`:'—'} · since ${dstr(first.playedAt)}</div>
    </div>
    <div class="panel">
      <div class="panel-h"><h3>Recent games</h3><span class="hint">latest 25${canEdit()?' · drop a wrong row with ✕':''}</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Date</th><th>Map</th><th>Rank</th><th class="num">RR</th><th class="num">Δ</th>${canEdit()?'<th></th>':''}</tr></thead>
        <tbody>${a.slice(-25).reverse().map(e=>`<tr>
          <td class="mono">${dstr(e.playedAt)}</td>
          <td>${esc(e.map||'—')}</td>
          <td>${rankShort(tierRank(e.tierId,e.rr))}</td>
          <td class="num">${tierRank(e.tierId,e.rr).rr}</td>
          <td class="num ${e.lastChange>0?'up':e.lastChange<0?'down':'flat'}">${e.lastChange>0?'+':''}${e.lastChange}</td>
          ${canEdit()?`<td><button class="icar" data-drophist="${esc(e.matchId)}" data-pid="${esc(p.id)}" title="Drop this game">✕</button></td>`:''}
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;
}

/* -------- scrims / officials (same view, filtered by kind) -------- */
VIEWS_scrims=()=>matchListView("scrim");
VIEWS_officials=()=>matchListView("official");
function vodLabel(u){
  try{const h=new URL(u).hostname.replace(/^www\./,"");return /youtu/.test(h)?"YouTube":/twitch/.test(h)?"Twitch":h;}
  catch(e){return "VOD";}
}
/* most common leading token across enemy names — a hint for naming an import */
function commonTag(names){
  const c={};
  (names||[]).forEach(n=>{const t=String(n||"").trim().split(/[\s#._-]+/)[0];
    if(t&&t.length>=2&&t.length<=6)c[t]=(c[t]||0)+1;});
  let best=null,bn=0;for(const[t,k]of Object.entries(c))if(k>bn){bn=k;best=t;}
  return bn>=3?best:null;
}
function enemyRows(e){
  return e.map(x=>`<tr><td>${esc(x.name||'—')}</td><td>${esc(x.agent||'—')}</td>
    <td class="num">${x.k??'—'}</td><td class="num">${x.d??'—'}</td><td class="num">${x.a??'—'}</td>
    <td class="num">${x.adr!=null?Math.round(x.adr):'—'}</td></tr>`).join("");
}
function enemyBoard(s){
  const e=(s.enemy||[]).filter(x=>x&&(x.name||x.agent));
  if(!e.length)return "";
  const unnamed=!s.opp||s.opp==="Imported scrim"||s.opp==="TBD";
  const tag=unnamed?commonTag(e.map(x=>x.name)):null;
  return `<details class="enemybd">
    <summary>Enemy scoreboard <span class="hint">${e.length} players${tag?` · likely <b>${esc(tag)}</b>`:''}</span></summary>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Enemy</th><th>Agent</th><th class="num">K</th><th class="num">D</th><th class="num">A</th><th class="num">ADR</th></tr></thead>
      <tbody>${enemyRows(e)}</tbody>
    </table></div></details>`;
}
function matchFilterPanel(kind){
  const f=state.mfilter,n=mfCount();
  const roster=team().roster;
  const sel=(id,cur,opts)=>`<select data-mf="${id}">${opts.map(o=>`<option value="${esc(o.v)}" ${String(o.v)===String(cur)?'selected':''}>${esc(o.t)}</option>`).join("")}</select>`;
  const maps=[{v:"",t:"Any map"},...MAPS.map(m=>({v:m,t:m}))];
  const ags=[{v:"",t:"Any agent"},...AGENTS.map(a=>({v:a,t:a}))];
  const players=[{v:"",t:"Any player"},...roster.map(p=>({v:p.id,t:p.handle}))];
  return `<details class="panel" id="mfPanel" ${state.mfilterOpen||n?'open':''}>
    <summary style="cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:8px;font-weight:600">
      Filters ${n?`<span class="chip accent">${n}</span>`:''}
      ${n?`<button class="btn ghost sm" id="mfClear" style="margin-left:auto">Clear</button>`:''}
    </summary>
    <div class="panel-b grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
      <div class="fld"><label>Map</label>${sel("map",f.map,maps)}</div>
      <div class="fld"><label>Opponent</label><input data-mf="opp" value="${esc(f.opp)}" placeholder="name contains…"></div>
      <div class="fld"><label>Result</label>${sel("result",f.result,[{v:"",t:"Any"},{v:"win",t:"Wins"},{v:"loss",t:"Losses"},{v:"draw",t:"Draws"}])}</div>
      <div class="fld"><label>Margin</label>${sel("margin",f.margin,[{v:"",t:"Any"},{v:"close",t:"Close (≤3)"},{v:"mid",t:"Clear (4–6)"},{v:"big",t:"Dominant (7+)"}])}</div>
      <div class="fld"><label>Player featured</label>${sel("player",f.player,players)}</div>
      <div class="fld"><label>We played agent</label>${sel("agent",f.agent,ags)}</div>
      <div class="fld"><label>Since</label>${sel("since",f.since,[{v:"",t:"All time"},{v:"30",t:"Last 30 days"},{v:"90",t:"Last 90 days"},{v:"180",t:"Last 6 months"},{v:"365",t:"Last year"}])}</div>
    </div>
    <div class="panel-b" style="border-top:1px solid var(--border)">
      <div class="fld"><label>Our comp includes</label>
        <div class="checks" id="mfComp">${AGENTS.map(a=>`<label class="${f.comp.includes(a)?'on':''}"><input type="checkbox" value="${a}" ${f.comp.includes(a)?'checked':''}>${a}</label>`).join("")}</div>
      </div>
    </div>
  </details>`;
}
function matchListView(kind){
  const off=kind==="official";
  const all=matchesOf(kind);
  const list=applyMatchFilter(all).slice().sort((a,b)=>a.date<b.date?1:-1);
  const n=mfCount();
  const w=state.week,goal=weekGoal(w),done=scrimsInWeek(w).length;
  const wins=list.filter(s=>s.rw>s.rl).length;
  M.innerHTML=`<div class="grid">
    <div class="p111">
      ${off
        ? statCard("Officials played",n?`${list.length}<small>/${all.length}</small>`:list.length,"",n?"matching filters":"tournament matches")
        : statCard("This week",`${done}<small>/${goal}</small>`,goal?bar(done/goal):"",
            done>=goal?"Goal met":`${goal-done} to go`)}
      ${statCard(n?"Filtered record":(off?"Official record":"Scrim record"),`${wins}<small>–${list.length-wins}</small>`,"",
        list.length?Math.round(wins/list.length*100)+"% win rate":"—")}
      ${statCard(n?"Matches shown":(off?"Logged officials":"Logged scrims"),n?`${list.length}<small>/${all.length}</small>`:list.length,"",n?"of all logged":"all time")}
    </div>
    ${(canEdit()||(!off&&window.sightlineDesktop&&window.sightlineDesktop.platform==="win32"))?`<div class="btn-row">
      ${canEdit()?`<button class="btn" id="addScrim">${icon(off?'trophy':'swords')} Log ${off?'official':'scrim'}</button>`:''}
      ${!off&&canManage()?`<button class="btn ghost" id="scrimImport">⬇ Scrim importer</button>`:''}
      ${!off&&window.sightlineDesktop&&window.sightlineDesktop.platform==="win32"?`<button class="btn ghost" id="runAgent">▶ Run scrim agent</button>`:''}
    </div>`:''}
    ${all.length?matchFilterPanel(kind):''}
    <div class="grid">
      ${list.map(s=>{
        const rt=scrimRatings(s);
        const vods=(s.vods||[]).filter(Boolean);
        return `<div class="panel">
          <div class="panel-h">
            <h3>${esc(s.map)} · vs ${esc(s.opp)}</h3>
            <span style="display:flex;gap:8px;align-items:center">
              ${s.source==='overwolf'?'<span class="chip" title="Auto-imported from a Valorant custom game">⬇ imported</span>':''}
              <span class="chip ${s.rw>s.rl?'good':'crit'}">${s.rw}–${s.rl}</span>
              <span class="hint">${s.date} · ${s.rw+s.rl} rds</span>
              ${canEdit()?`<button class="icar" data-editscrim="${s.id}">✎</button>`:''}
            </span>
          </div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Player</th><th>Agent</th><th class="num">K</th><th class="num">D</th><th class="num">A</th>
            <th class="num">ADR</th><th class="num">KAST</th><th class="num">R2.0</th><th>Att</th></tr></thead>
            <tbody>${rt.map(r=>`<tr>
              <td>${esc(pdisp(r).icon)} ${esc(pdisp(r).handle)}${r.pid?'':' <span class="chip warn" style="font-size:9px;padding:1px 5px">unlinked</span>'}</td><td>${esc(r.agent)}</td>
              <td class="num">${r.k}</td><td class="num">${r.d}</td><td class="num">${r.a}</td>
              <td class="num">${Math.round(r.adr)}</td><td class="num">${Math.round(r.kast)}%</td>
              <td class="num ${r.rating==null?'':r.rating>=1.10?'up':r.rating<RATING_BASELINE?'down':''}">${r.rating!=null?r.rating.toFixed(2):'—'}</td>
              <td>${r.present?'<span class="chip good">✓</span>':'<span class="chip crit">✕</span>'}</td>
            </tr>`).join("")}</tbody>
          </table></div>
          ${enemyBoard(s)}
          ${vods.length?`<div class="panel-b" style="display:flex;flex-wrap:wrap;gap:8px;border-top:1px solid var(--border)">
            ${vods.map((u,i)=>`<a class="btn ghost sm" href="${esc(u)}" target="_blank" rel="noopener">▶ ${esc(vodLabel(u))}${vods.length>1?' '+(i+1):''}</a>`).join("")}
          </div>`:''}
        </div>`;
      }).join("")||`<div class="empty panel pad">${all.length?`No ${off?'officials':'scrims'} match these filters`:`No ${off?'officials':'scrims'} logged yet`}</div>`}
    </div>
  </div>`;
  const asc=$("#addScrim");if(asc)asc.onclick=()=>editScrim(null,kind);
  const si=$("#scrimImport");if(si)si.onclick=importerDialog;
  const ra=$("#runAgent");if(ra)ra.onclick=agentDialog;
  M.querySelectorAll("[data-editscrim]").forEach(b=>b.onclick=()=>editScrim(b.dataset.editscrim));
  const panel=$("#mfPanel");
  if(panel){
    panel.addEventListener("toggle",()=>{state.mfilterOpen=panel.open;});
    const clr=$("#mfClear");if(clr)clr.onclick=(e)=>{e.preventDefault();e.stopPropagation();mfClear();render();};
    panel.querySelectorAll("[data-mf]").forEach(el=>{
      el.addEventListener("change",()=>{state.mfilter[el.dataset.mf]=el.value;render();});
    });
    panel.querySelectorAll("#mfComp input").forEach(cb=>cb.addEventListener("change",()=>{
      const set=new Set(state.mfilter.comp);
      cb.checked?set.add(cb.value):set.delete(cb.value);
      state.mfilter.comp=[...set];render();
    }));
  }
};
async function importerDialog(){
  if(!canManage())return;
  const base=location.origin;
  const has=team().hasIngestKey;
  const D=window.sightlineDesktop;
  const winDesktop=!!(D && D.platform==="win32");
  const body=document.createElement("div");body.className="modal-b";
  const t=team();
  body.innerHTML=`
    <p class="sub" style="margin:0">Auto-imports finished Valorant <b>custom games</b>. Run the <b>agent</b> on one machine (usually the IGL's) — it reads Valorant's local API and sends the scoreboard here at match end. Matches are de-duplicated by match ID.</p>
    <div class="fld"><label>Sightline URL (for the agent)</label>
      <div style="display:flex;gap:6px"><input readonly value="${esc(base)}" style="flex:1"><button class="btn ghost sm" id="cp_url">Copy</button></div></div>
    <div class="fld"><label>Ingest key</label>
      ${has
        ? `<div style="display:flex;gap:6px"><input readonly value="•••••••• (hidden — rotate to get a new one)" style="flex:1">
             <button class="btn ghost sm" id="ik_rot">Rotate</button>
             <button class="icar" id="ik_rev" title="Revoke" style="color:var(--crit);border-color:var(--crit)">✕</button></div>`
        : `<button class="btn" id="ik_gen">Generate ingest key</button>`}
    </div>
    <div class="fld" id="ik_new" hidden><label>New key — copy now, it is not shown again</label>
      <div style="display:flex;gap:6px"><input id="ik_newval" readonly style="flex:1"><button class="btn ghost sm" id="ik_copy">Copy</button></div></div>
    <hr style="border:0;border-top:1px solid var(--border);margin:2px 0">
    <div class="eyebrow">What counts as a scrim</div>
    <p class="sub" style="margin:0">Not every custom is a scrim. A custom is only imported when at least <b>N</b> players whose in-game name starts with your prefix are on one team (whichever side that is becomes "us").</p>
    <div class="fld row2">
      <div class="fld"><label>In-game name prefix</label><input id="imp_prefix" value="${esc(t.importPrefix||t.tag||'')}" placeholder="${esc(t.tag||'XPE')}"></div>
      <div class="fld"><label>Min players on a team</label><input id="imp_min" type="number" min="1" max="5" value="${t.importMin??3}"></div>
    </div>
    <button class="btn ghost sm" id="imp_save" style="align-self:flex-start">Save filter</button>
    ${winDesktop?`
      <hr style="border:0;border-top:1px solid var(--border);margin:2px 0">
      ${agentPanelHTML()}`:
      `<div class="callout"><b>The agent</b> is in the repo under <span class="mono">agent/</span> (standalone, needs Node + the ingest key above) — or use the <b>Sightline desktop app</b> (Windows/Linux) which runs it for you, signed in as you, with no key. See <span class="mono">agent/README.md</span> and <span class="mono">desktop/README.md</span>.</div>`}`;
  modalShell("Scrim importer",body,null,null,{noSave:true});
  body.querySelector("#cp_url").onclick=()=>copyText(base);
  if(winDesktop) wireDesktopAgent(body);
  body.querySelector("#imp_save").onclick=async()=>{
    try{
      await API.put(`/api/teams/${TID()}`,{importPrefix:body.querySelector("#imp_prefix").value.trim(),importMin:+body.querySelector("#imp_min").value});
      await reload(); toast("Import filter saved");
    }catch(e){toast(e.message);}
  };
  const reveal=(k)=>{ body.querySelector("#ik_new").hidden=false; body.querySelector("#ik_newval").value=k; copyText(k); };
  const gen=async(btn)=>{ btn.disabled=true; try{ const r=await API.post(`/api/teams/${TID()}/ingest-key`); reveal(r.key); reload(); toast("Ingest key ready — copied"); }catch(e){ toast(e.message); btn.disabled=false; } };
  const g=body.querySelector("#ik_gen"); if(g)g.onclick=()=>gen(g);
  const rot=body.querySelector("#ik_rot"); if(rot)rot.onclick=()=>gen(rot);
  const rev=body.querySelector("#ik_rev"); if(rev)rev.onclick=async()=>{
    if(!confirm("Revoke the ingest key? The companion app will stop importing until you generate a new one."))return;
    try{ await API.del(`/api/teams/${TID()}/ingest-key`); await reload(); closeModal(); render(); toast("Ingest key revoked"); }catch(e){toast(e.message);}
  };
  const cp=body.querySelector("#ik_copy"); if(cp)cp.onclick=()=>copyText(body.querySelector("#ik_newval").value);
}
/* Desktop scrim agent — runs under the signed-in session (no ingest key ever
   reaches the machine). Panel is available to any team member on Windows. */
function agentPanelHTML(){
  return `
    <div class="eyebrow">Run the scrim agent on this PC</div>
    <p class="sub" style="margin:0">Auto-imports finished Valorant customs while you scrim. It runs as <b>you</b> (your Sightline login) — nothing to paste, no key. Keep this window open.</p>
    <div class="fld"><div style="display:flex;gap:8px;align-items:center">
      <button class="btn" id="ag_toggle">Start</button>
      <span class="hint" id="ag_state">checking…</span>
    </div></div>
    <label style="display:flex;gap:7px;align-items:center;font-size:12px;color:var(--ink-2);cursor:pointer"><input type="checkbox" id="ag_auto" style="width:auto"> Start automatically when this app opens</label>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="eyebrow" style="margin:0">Agent log</span>
      <button class="btn ghost sm" id="ag_logclear">Clear</button>
    </div>
    <pre class="agentlog" id="ag_log"></pre>`;
}
function agentDialog(){
  const D=window.sightlineDesktop;
  if(!(D && D.platform==="win32")) return;
  const body=document.createElement("div");body.className="modal-b";
  body.innerHTML=agentPanelHTML();
  modalShell("Scrim agent",body,null,null,{noSave:true});
  wireDesktopAgent(body);
}
let _agentCleanup=[];
function wireDesktopAgent(body){
  _agentCleanup.forEach(fn=>{try{fn();}catch(e){}}); _agentCleanup=[];
  const D=window.sightlineDesktop;
  const tog=body.querySelector("#ag_toggle");
  const st=body.querySelector("#ag_state"), logEl=body.querySelector("#ag_log");
  const auto=body.querySelector("#ag_auto");
  let running=false;
  const paint=(s)=>{
    running=!!s.running;
    tog.textContent=running?"Stop":"Start";
    tog.classList.toggle("ghost",running);
    auto.checked=!!s.autostart;
    st.textContent=running
      ? "running — keep this app open during scrims"
      : (s.hasKey ? "stopped — uses the saved ingest key" : "stopped — press Start (imports as you)");
  };
  const append=({stream,line})=>{
    logEl.textContent=(logEl.textContent+line+"\n").split("\n").slice(-300).join("\n");
    logEl.scrollTop=logEl.scrollHeight;
  };
  D.agent.status().then(paint);
  D.agent.logHistory().then(h=>{ logEl.textContent=""; h.forEach(append); });
  _agentCleanup.push(D.agent.onStatus(paint));
  _agentCleanup.push(D.agent.onLog(append));
  tog.onclick=async()=>{
    if(running){ await D.agent.stop(); return; }
    const r=await D.agent.start({ teamId: TID() });
    if(r&&r.error) toast(r.error);
  };
  auto.onchange=()=>D.agent.setAutostart(auto.checked).then(paint);
  body.querySelector("#ag_logclear").onclick=()=>{ logEl.textContent=""; };
}
function editScrim(id,defKind){
  const ex=id?team().scrims.find(s=>s.id===id):null;
  const kind=ex?(ex.kind||"scrim"):(defKind||"scrim");
  const noun=kind==="official"?"official":"scrim";
  const starters=team().roster.filter(p=>p.status==="Starter"||p.status==="Sub");
  const lineup=ex?ex.lineup:starters.filter(p=>p.status==="Starter").map(p=>({pid:p.id,agent:p.agents[0]||AGENTS[0],k:0,d:0,a:0,adr:null,kast:null,present:true}));
  const vods=ex&&ex.vods&&ex.vods.length?ex.vods.slice():[""];
  const body=document.createElement("div");
  body.className="modal-b";
  body.innerHTML=`
    <div class="fld row2">
      <div class="fld"><label>Type</label><select id="sf_kind">
        <option value="scrim" ${kind==="scrim"?'selected':''}>Scrim</option>
        <option value="official" ${kind==="official"?'selected':''}>Official (tournament)</option>
      </select></div>
      <div class="fld"><label>Date</label><input type="date" id="sf_date" value="${ex?ex.date:iso(new Date())}"></div>
    </div>
    <div class="fld row2">
      <div class="fld"><label>Opponent</label><input id="sf_opp" value="${ex?esc(ex.opp):''}"></div>
      <div class="fld"><label>Map</label><select id="sf_map">${MAPS.map(m=>`<option ${ex&&ex.map===m?'selected':''}>${m}</option>`).join("")}</select></div>
    </div>
    ${ex&&(ex.enemy||[]).length?`<div class="fld"><label>Enemy scoreboard (from the import)</label>
      ${(()=>{const tg=commonTag(ex.enemy.map(x=>x.name));return tg?`<span class="hint">Common tag: <b>${esc(tg)}</b> — tap to use it as the opponent name</span> <button type="button" class="btn ghost sm" id="sf_usetag">Use "${esc(tg)}"</button>`:'<span class="hint">No shared clan tag detected</span>';})()}
      <div class="tbl-wrap" style="margin-top:6px"><table class="tbl">
        <thead><tr><th>Enemy</th><th>Agent</th><th class="num">K</th><th class="num">D</th><th class="num">A</th><th class="num">ADR</th></tr></thead>
        <tbody>${enemyRows(ex.enemy)}</tbody></table></div></div>`:''}
    <div class="fld">
      <label>Score (us – them)</label>
      <div style="display:flex;gap:6px"><input type="number" id="sf_rw" value="${ex?ex.rw:13}" style="width:80px">
      <input type="number" id="sf_rl" value="${ex?ex.rl:0}" style="width:80px"></div></div>
    <div class="fld"><label>VOD links</label>
      <span class="hint">YouTube / Twitch URLs — shown as buttons on the match card</span>
      <div id="sf_vods"></div>
      <button class="btn ghost sm" type="button" id="sf_vadd">+ VOD</button></div>
    <div class="fld"><label>Lineup</label>
      <span class="hint">ADR &amp; KAST optional — left blank, Rating 2.0 falls back to an estimate from kills &amp; deaths</span>
      <div class="luwrap">
        <div class="luhead"><span>Player</span><span>Agent</span><span>K</span><span>D</span><span>A</span><span>ADR</span><span>KAST</span><span title="Present">P</span><span></span></div>
        <div id="sf_lineup"></div>
      </div>
      <button class="btn ghost sm" type="button" id="sf_add">+ Row</button></div>`;
  const vodBox=body.querySelector("#sf_vods");
  const vodRow=(v)=>{const d=document.createElement("div");d.style.cssText="display:flex;gap:6px;margin-bottom:6px";
    d.innerHTML=`<input data-vod type="url" placeholder="https://youtu.be/…" value="${esc(v||'')}" style="flex:1">
      <button type="button" class="icar" data-vrm>✕</button>`;
    d.querySelector("[data-vrm]").onclick=()=>d.remove();
    return d;};
  vods.forEach(v=>vodBox.appendChild(vodRow(v)));
  body.querySelector("#sf_vadd").onclick=()=>vodBox.appendChild(vodRow(""));
  const useTag=body.querySelector("#sf_usetag");
  if(useTag)useTag.onclick=()=>{body.querySelector("#sf_opp").value=commonTag(ex.enemy.map(x=>x.name))||"";};
  const lu=body.querySelector("#sf_lineup");
  function rowHTML(l){
    const unlinked=!l.pid && l.name;
    return `<div class="lurow" data-row data-name="${esc(l.name||'')}">
      <select data-f="pid">${unlinked?`<option value="" selected>— ${esc(l.name)} —</option>`:''}${starters.map(p=>`<option value="${p.id}" ${p.id===l.pid?'selected':''}>${esc(p.handle)}</option>`).join("")}</select>
      <select data-f="agent">${AGENTS.map(a=>`<option ${a===l.agent?'selected':''}>${a}</option>`).join("")}</select>
      <input data-f="k" type="number" inputmode="numeric" value="${l.k}" title="Kills">
      <input data-f="d" type="number" inputmode="numeric" value="${l.d}" title="Deaths">
      <input data-f="a" type="number" inputmode="numeric" value="${l.a}" title="Assists">
      <input data-f="adr" type="number" inputmode="numeric" value="${l.adr??''}" placeholder="—" title="Avg damage / round">
      <input data-f="kast" type="number" inputmode="numeric" value="${l.kast??''}" placeholder="—" title="KAST %">
      <label class="lupres" title="Present"><input data-f="present" type="checkbox" ${l.present?'checked':''}></label>
      <button type="button" class="icar" data-rm title="Remove">✕</button>
    </div>`;
  }
  function draw(arr){lu.innerHTML=arr.map(rowHTML).join("");
    lu.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{b.closest("[data-row]").remove();});}
  draw(lineup);
  body.querySelector("#sf_add").onclick=()=>{const div=document.createElement("div");div.innerHTML=rowHTML({pid:starters[0].id,agent:AGENTS[0],k:0,d:0,a:0,adr:null,kast:null,present:true});
    const node=div.firstElementChild;node.querySelector("[data-rm]").onclick=()=>node.remove();lu.appendChild(node);};
  modalShell(id?`Edit ${noun}`:`Log ${noun}`,body,()=>{
    const gv=(r,f)=>{const v=r.querySelector('[data-f='+f+']').value;return v===''?null:+v;};
    const rows=[...lu.querySelectorAll("[data-row]")].map(r=>{
      const pid=r.querySelector('[data-f=pid]').value;
      return {
        pid: pid||null,
        name: pid?undefined:(r.dataset.name||undefined),
        agent:r.querySelector('[data-f=agent]').value,
        k:+r.querySelector('[data-f=k]').value,
        d:+r.querySelector('[data-f=d]').value,
        a:+r.querySelector('[data-f=a]').value,
        adr:gv(r,'adr'),
        kast:gv(r,'kast'),
        present:r.querySelector('[data-f=present]').checked,
      };
    });
    const vodList=[...body.querySelectorAll("[data-vod]")].map(i=>i.value.trim()).filter(Boolean);
    const rec={date:body.querySelector("#sf_date").value,opp:body.querySelector("#sf_opp").value||"TBD",
      map:body.querySelector("#sf_map").value,rw:+body.querySelector("#sf_rw").value,rl:+body.querySelector("#sf_rl").value,
      kind:body.querySelector("#sf_kind").value,vods:vodList,lineup:rows};
    act(id?API.put(`/api/teams/${TID()}/scrims/${id}`,rec):API.post(`/api/teams/${TID()}/scrims`,rec),
        id?`${cap(rec.kind)} updated`:`${cap(rec.kind)} logged`);
  },id?()=>act(API.del(`/api/teams/${TID()}/scrims/${id}`),`${cap(kind)} deleted`):null,{wide:true});
}

/* -------- performance -------- */
VIEWS_performance=()=>{
  const n=state.perfWindow;
  const wl=perfWindowLabel();
  const rows=performanceTable(n);
  const focus=rows.filter(r=>r.flag);
  const rated=rows.filter(r=>r.rating!=null);
  const rosterAvg=mean(rated.map(r=>r.rating));
  const offRated=rows.filter(r=>r.offRating!=null);
  const offAvg=mean(offRated.map(r=>r.offRating));
  const tr=teamRank();
  const dcell=(d)=>`<td class="num ${d==null?'flat':d>0?'up':d<0?'down':'flat'}">${d!=null?(d>0?'+':'')+d.toFixed(2):'—'}</td>`;
  M.innerHTML=`<div class="grid">
    <div class="p111">
      ${statCard("Team rank",tr?rankStr(tr):"—",tr?`<span class="d flat">${tr.rr} RR</span>`:"","Average of starters' live ranks")}
      ${statCard("Roster avg R2.0",rosterAvg!=null?rosterAvg.toFixed(2):"—","",cap(wl)+" · scrims")}
      ${statCard("Officials avg R2.0",offAvg!=null?offAvg.toFixed(2):"—",
        (offAvg!=null&&rosterAvg!=null)?`<span class="d ${offAvg-rosterAvg>0.02?'up':offAvg-rosterAvg<-0.02?'down':'flat'}">${(offAvg-rosterAvg>0?'+':'')+(offAvg-rosterAvg).toFixed(2)} vs scrims</span>`:"",
        "All tournament matches")}
    </div>
    <div class="btn-row">
      <span class="chip">Scrim window</span>
      ${PERF_WINDOWS.map(w=>`<button class="btn ${w===n?'':'ghost'} sm" data-win="${w}">${w?w+' scrims':'Lifetime'}</button>`).join("")}
    </div>
    ${focus.length?`<div class="callout warn">Below ${RATING_BASELINE.toFixed(2)} Rating 2.0 (${wl}): ${focus.map(r=>`${esc(r.p.handle)} (${r.rating.toFixed(2)}${r.delta!=null?', '+(r.delta>0?'+':'')+r.delta.toFixed(2)+' vs prior':''})`).join(" · ")}</div>`:
      `<div class="callout good">No player is below ${RATING_BASELINE.toFixed(2)} Rating 2.0 (${wl}).</div>`}
    <div class="panel">
      <div class="panel-h"><h3>Player form</h3><span class="hint">Rating 2.0 · scrims ${wl} vs officials</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Player</th><th>Role</th><th>Rank</th><th class="num">Scrims</th><th class="num">Avg KD</th>
        <th class="num">Scrim R2.0</th><th class="num">Δ vs prior</th><th class="num">Off. R2.0</th><th class="num">Off. Δ</th><th>Trend</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
          <td>${esc(r.p.icon)} ${esc(r.p.handle)}</td><td>${esc(roleStr(r.p))}</td>
          <td class="mono" style="font-size:11px">${fmtRank(r.p.rank)}</td>
          <td class="num">${r.games}</td>
          <td class="num">${r.kd!=null?r.kd.toFixed(2):'—'}</td>
          <td class="num ${r.rating==null?'':r.rating>=1.10?'up':r.rating<RATING_BASELINE?'down':''}">${r.rating!=null?r.rating.toFixed(2):'—'}</td>
          ${dcell(r.delta)}
          <td class="num ${r.offRating==null?'':r.offRating>=1.10?'up':r.offRating<RATING_BASELINE?'down':''}">${r.offRating!=null?r.offRating.toFixed(2):'—'}<span style="color:var(--ink-3);font-size:10px"> ${r.offGames||0}g</span></td>
          ${dcell(r.offDelta)}
          <td>${miniSpark(r.trend)}</td>
          <td>${r.flag?'<span class="chip crit">Focus</span>':r.rating>=1.10?'<span class="chip good">Above avg</span>':'<span class="chip">Around avg</span>'}</td>
          <td><button class="btn ghost sm" data-notes="${r.p.id}">${(r.p.perfNotes||[]).length?`${r.p.perfNotes.length} note${r.p.perfNotes.length>1?'s':''}`:(canEdit()||isMe(r.p.id)?'+ add':'—')}</button></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="panel-b hint" style="border-top:1px solid var(--border)">Off. Δ = officials R2.0 minus scrim R2.0 — positive means the player steps up in tournament matches.</div>
    </div>
    <div class="p31">
      <div class="panel">
        <div class="panel-h"><h3>Attendance</h3><span class="hint">last 8 scrims</span></div>
        <div class="panel-b">${team().roster.filter(p=>p.status!=="Inactive").map(p=>{
          const a=attendanceRate(p.id,8);return `<div class="rowline"><span>${p.icon} ${esc(p.handle)}</span>
          <span style="display:flex;align-items:center;gap:8px;width:160px">${bar((a||0),true)}
          <span class="mono" style="width:38px;text-align:right">${a!=null?Math.round(a*100)+'%':'—'}</span></span></div>`;
        }).join("")}</div>
      </div>
      <div class="panel">
        <div class="panel-h"><h3>Rating 2.0 formula</h3></div>
        <div class="panel-b sub" style="font-size:12px">
          <p class="mono" style="font-size:11px;color:var(--ink-2)">R = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587</p>
          <p class="mono" style="font-size:11px;color:var(--ink-2)">Impact = 2.13·KPR + 0.42·APR − 0.41</p>
          <p>Per-round rates from the match's total rounds (K/D/A ÷ rounds). Community-derived HLTV coefficients; <b>1.00 ≈ an average player</b>. Δ vs prior compares this scrim window to the ${n||'—'} scrims before it (n/a for lifetime).</p>
        </div>
      </div>
    </div>
  </div>`;
  M.querySelectorAll("[data-win]").forEach(b=>b.onclick=()=>{state.perfWindow=+b.dataset.win;render();});
  M.querySelectorAll("[data-notes]").forEach(b=>b.onclick=()=>notesDialog(b.dataset.notes));
};
function notesDialog(pid){
  const p=team().roster.find(x=>x.id===pid); if(!p)return;
  const canPost=canEdit()||isMe(pid);
  const notes=[]; (p.perfNotes||[]).forEach(n=>notes.push(n));
  const body=document.createElement("div");body.className="modal-b";
  const render1=()=>notes.length? notes.map(nn=>`<div class="rowline" style="align-items:flex-start;gap:10px">
      <div style="flex:1">
        <div class="sub" style="font-size:10px">${esc(nn.by||'—')} · ${new Date(nn.at).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</div>
        <div style="white-space:pre-wrap;font-size:13px">${esc(nn.text)}</div>
      </div>
      ${(canEdit()||nn.byId===ME.user.id)?`<button class="icar" data-delnote="${nn.id}" title="Delete">✕</button>`:''}
    </div>`).join("") : '<div class="sub">No performance notes yet.</div>';
  body.innerHTML=`
    <div class="eyebrow">${esc(p.handle)} — performance notes</div>
    <div id="nlist">${render1()}</div>
    ${canPost?`<div class="fld" style="margin-top:6px"><label>Add a note</label>
      <textarea id="ntext" placeholder="What to work on, what went well, VOD timestamps…"></textarea>
      <button class="btn" id="nadd" style="align-self:flex-start;margin-top:6px">Add note</button></div>`:
      `<p class="sub">Only ${esc(p.handle)} and the coaching staff can add notes here.</p>`}`;
  modalShell(`Notes · ${p.handle}`,body,null,null,{noSave:true});
  const refresh=async()=>{
    await reload(); render();
    const np=team().roster.find(x=>x.id===pid);
    notes.length=0; (np&&np.perfNotes||[]).forEach(n=>notes.push(n));
    body.querySelector("#nlist").innerHTML=render1(); wireDel();
  };
  const wireDel=()=>body.querySelectorAll("[data-delnote]").forEach(b=>b.onclick=async()=>{
    try{ await API.del(`/api/teams/${TID()}/players/${pid}/notes/${b.dataset.delnote}`); await refresh(); }
    catch(e){ toast(e.message); }
  });
  wireDel();
  const add=body.querySelector("#nadd");
  if(add)add.onclick=async()=>{
    const t=body.querySelector("#ntext").value.trim(); if(!t)return;
    try{ await API.post(`/api/teams/${TID()}/players/${pid}/notes`,{text:t}); body.querySelector("#ntext").value=""; await refresh(); }
    catch(e){ toast(e.message); }
  };
}
function miniSpark(vals){
  if(!vals||vals.length<2)return '<span class="sub">—</span>';
  const w=70,h=20,min=Math.min(...vals,0.8),max=Math.max(...vals,1.2);
  const x=i=>i*w/(vals.length-1),y=v=>h-(v-min)/(max-min)*h;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <line x1="0" x2="${w}" y1="${y(1)}" y2="${y(1)}" stroke="var(--border-2)" stroke-dasharray="2 2"/>
    <polyline points="${vals.map((v,i)=>x(i)+','+y(v)).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
    <circle cx="${x(vals.length-1)}" cy="${y(vals[vals.length-1])}" r="2.4" fill="var(--accent)"/>
  </svg>`;
}

/* -------- comp lab -------- */
VIEWS_complab=()=>{
  const map=state.complabMap;
  const data=bestAgentsForMap(map);
  const played=matchesOf("scrim").filter(s=>s.map===map);
  const mapWins=played.filter(s=>s.rw>s.rl).length;
  const expWr=data.filter(d=>d.best).reduce((s,d)=>s+d.best.wr,0)/(data.filter(d=>d.best).length||1);
  M.innerHTML=`<div class="grid">
    <div class="btn-row">${MAPS.map(m=>`<button class="btn ${m===map?'':'ghost'} sm" data-map="${m}">${m}</button>`).join("")}</div>
    <div class="p111">
      ${statCard(map+" scrims",played.length,"",played.length?`${mapWins}W ${played.length-mapWins}L`:"no history")}
      ${statCard("Historical win rate",played.length?Math.round(mapWins/played.length*100)+"%":"—","","on this map")}
      ${statCard("Best-agents win rate",data.some(d=>d.best)?Math.round(expWr*100)+"%":"—","","mean of each pick's past win rate")}
    </div>
    <div class="panel">
      <div class="panel-h"><h3>Best player + agent · ${esc(map)}</h3><span class="hint">ranked by past win rate + Rating 2.0 on this map</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Player</th><th>Best agent</th><th class="num">Games</th><th class="num">Win rate</th>
        <th class="num">Avg R2.0</th><th>Other agents played</th></tr></thead>
        <tbody>${data.map(d=>`<tr>
          <td>${d.p.icon} ${esc(d.p.handle)}</td>
          <td>${d.best?`<span class="chip accent">${esc(d.best.agent)}</span>`:`<span class="sub">no games — pool: ${esc(d.p.agents[0]||'?')}</span>`}</td>
          <td class="num">${d.best?d.best.games:0}</td>
          <td class="num ${d.best&&d.best.wr>=.5?'up':d.best?'down':''}">${d.best?Math.round(d.best.wr*100)+'%':'—'}</td>
          <td class="num">${d.best?d.best.rating.toFixed(2):'—'}</td>
          <td>${d.opts.slice(1).map(o=>`<span class="chip" title="${o.games}g · ${Math.round(o.wr*100)}% · R2.0 ${o.rating.toFixed(2)}">${esc(o.agent)}</span>`).join("")||'<span class="sub">—</span>'}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="panel-b" style="border-top:1px solid var(--border)">
        <div class="callout">
          <b>Sample:</b> ${played.length} scrim${played.length===1?'':'s'} logged on ${esc(map)}.
          ${data.some(d=>d.best)?`<br><b>Best agent per player:</b> ${data.filter(d=>d.best).map(d=>`${esc(d.p.handle)} → ${esc(d.best.agent)} (${d.best.games}g, ${Math.round(d.best.wr*100)}%)`).join(" · ")}`:""}
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-h"><h3>Map pool overview</h3></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Map</th><th class="num">Scrims</th><th class="num">Win rate</th><th>Sample</th></tr></thead>
        <tbody>${MAPS.map(m=>{const g=matchesOf("scrim").filter(s=>s.map===m);const wn=g.filter(s=>s.rw>s.rl).length;
          return `<tr><td>${m}</td><td class="num">${g.length}</td>
          <td class="num ${g.length&&wn/g.length>=.5?'up':g.length?'down':''}">${g.length?Math.round(wn/g.length*100)+'%':'—'}</td>
          <td><span class="chip ${g.length>=4?'good':g.length>=2?'warn':'crit'}">${g.length>=4?'4+ games':g.length>=2?'2–3 games':g.length===1?'1 game':'none'}</span></td></tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>
  </div>`;
  M.querySelectorAll("[data-map]").forEach(b=>b.onclick=()=>{state.complabMap=b.dataset.map;render();});
};

/* -------- tryouts -------- */
VIEWS_tryouts=()=>{
  const sortKey=state.tryoutSort;
  const scored=team().tryouts.map(t=>{
    const s=t.scores;
    const rs=rankUnits({tier:t.tier,div:t.div,rr:0})/24;
    const composite=(s.mech*.30+s.util*.24+s.comms*.22+s.att*.14+rs*10*.10);
    return {...t,composite};
  }).sort((a,b)=>sortKey==="score"?b.composite-a.composite:a.date<b.date?1:-1);
  const top=scored.filter(t=>t.verdict!=="Pass").slice(0,3);
  M.innerHTML=`<div class="grid">
    <div class="btn-row">
      ${canEdit()?`<button class="btn" id="addTry">${icon('search')} Log tryout</button>`:''}
      <button class="btn ${sortKey==='score'?'':'ghost'} sm" data-sort="score">By potential</button>
      <button class="btn ${sortKey==='date'?'':'ghost'} sm" data-sort="date">By date</button>
    </div>
    <div class="panel">
      <div class="panel-h"><h3>Best potentials</h3><span class="hint">excludes Pass</span></div>
      <div class="panel-b">
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">
        ${top.map((t,i)=>`<div class="pcard">
          <div class="top"><div class="ico">${['①','②','③'][i]}</div>
          <div style="flex:1"><div class="hd">${esc(t.handle)}</div><div class="rl">${esc(tryoutRoleStr(t))} · ${t.tier} ${t.div}</div></div></div>
          <div class="stat"><span class="k">Composite</span><span class="v">${t.composite.toFixed(1)}<small>/10</small></span></div>
          <div>${chipScore("Mech",t.scores.mech)}${chipScore("Util",t.scores.util)}${chipScore("Comms",t.scores.comms)}${chipScore("Att",t.scores.att)}</div>
          <span class="chip ${t.verdict==='Shortlist'?'good':t.verdict==='Signed'?'accent':'warn'}">${t.verdict}</span>
        </div>`).join("")||'<div class="sub">No tryouts logged</div>'}
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-h"><h3>Tryout archive</h3><span class="hint">${team().tryouts.length} logged</span></div>
      <div class="grid">
        ${scored.map(t=>`<div class="panel-b" style="border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div>
              <div style="font-family:var(--disp);font-weight:700;font-size:15px">${esc(t.handle)}
                <span class="sub" style="font-weight:400">· ${esc(tryoutRoleStr(t))} · ${t.tier} ${t.div} · ${t.date}</span></div>
              <div class="agents" style="margin:6px 0">${t.agents.map(a=>`<span class="chip">${esc(a)}</span>`).join("")}</div>
              <div>${chipScore("Mech",t.scores.mech)}${chipScore("Util",t.scores.util)}${chipScore("Comms",t.scores.comms)}${chipScore("Att",t.scores.att)}
              <span class="chip accent">Σ ${t.composite.toFixed(1)}</span></div>
              <p class="sub" style="margin:8px 0 0;max-width:60ch">${esc(t.notes)}</p>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <span class="chip ${t.verdict==='Shortlist'?'good':t.verdict==='Pass'?'crit':t.verdict==='Signed'?'accent':'warn'}">${t.verdict}</span>
              ${canEdit()?`<button class="icar" data-edittry="${t.id}">✎</button>`:''}
            </div>
          </div>
        </div>`).join("")||'<div class="empty">No tryouts yet</div>'}
      </div>
    </div>
  </div>`;
  const at=$("#addTry");if(at)at.onclick=()=>editTryout();
  M.querySelectorAll("[data-sort]").forEach(b=>b.onclick=()=>{state.tryoutSort=b.dataset.sort;render();});
  M.querySelectorAll("[data-edittry]").forEach(b=>b.onclick=()=>editTryout(b.dataset.edittry));
};
function chipScore(k,v){const c=v>=8?'good':v>=6?'':'crit';return `<span class="chip ${c}">${k} ${v}</span>`;}
function tryoutRoleStr(t){return roleStr(t);}
function editTryout(id){
  if(!canEdit())return;
  const t=id?team().tryouts.find(x=>x.id===id):{handle:"",roles:["Duelist"],tier:"Immortal",div:1,agents:[],date:iso(new Date()),
    scores:{mech:5,util:5,comms:5,att:5},verdict:"Hold",notes:""};
  const curRoles=(t.roles&&t.roles.length?t.roles:(t.role?[t.role]:[]));
  openForm({title:id?"Edit tryout · "+t.handle:"Log tryout",del:id?()=>act(API.del(`/api/teams/${TID()}/tryouts/${id}`),"Tryout removed"):null,fields:[
    {row:[{name:"handle",label:"Handle",type:"text",value:t.handle,required:true},
          {name:"date",label:"Date",type:"date",value:t.date}]},
    {name:"roles",label:"Roles tried (tick all that apply)",type:"multiselect",options:ROLES,value:curRoles},
    {row:[{name:"tier",label:"Peak tier",type:"select",options:RANK_TIERS,value:t.tier},
          {name:"div",label:"Division",type:"select",options:[1,2,3],value:t.div}]},
    {name:"agents",label:"Agents played",type:"multiselect",options:AGENTS,value:t.agents},
    {row:[{name:"mech",label:"Mechanics /10",type:"number",value:t.scores.mech,min:1,max:10},
          {name:"util",label:"Utility /10",type:"number",value:t.scores.util,min:1,max:10}]},
    {row:[{name:"comms",label:"Comms /10",type:"number",value:t.scores.comms,min:1,max:10},
          {name:"att",label:"Attitude /10",type:"number",value:t.scores.att,min:1,max:10}]},
    {name:"verdict",label:"Verdict",type:"select",options:VERDICTS,value:t.verdict},
    {name:"notes",label:"Commentary",type:"textarea",value:t.notes},
  ]},d=>{
    const rec={handle:d.handle,date:d.date,roles:d.roles,role:d.roles[0]||"Flex",tier:d.tier,div:+d.div,agents:d.agents,
      scores:{mech:+d.mech,util:+d.util,comms:+d.comms,att:+d.att},verdict:d.verdict,notes:d.notes};
    act(id?API.put(`/api/teams/${TID()}/tryouts/${id}`,rec):API.post(`/api/teams/${TID()}/tryouts`,rec),
        id?"Tryout updated":"Tryout logged");
  });
}

const VIEWS={overview:VIEWS_overview,roster:VIEWS_roster,schedule:VIEWS_schedule,activities:VIEWS_activities,
  ranks:VIEWS_ranks,scrims:VIEWS_scrims,officials:VIEWS_officials,performance:VIEWS_performance,complab:VIEWS_complab,tryouts:VIEWS_tryouts};

/* ============================================================ generic form modal */
let _closeModal=()=>{};
function closeModal(){_closeModal();}
function modalShell(title,bodyEl,onSubmit,onDel,opts={}){
  const root=$("#modal-root");
  root.innerHTML="";
  const wrap=document.createElement("div");wrap.className="scrim";
  const modal=document.createElement("div");modal.className="modal"+(opts.wide?" wide":"");
  const h=document.createElement("div");h.className="modal-h";
  h.innerHTML=`<h3>${esc(title)}</h3><button class="icar" data-x>✕</button>`;
  const f=document.createElement("div");f.className="modal-f";
  f.innerHTML=`${onDel?'<button class="btn ghost sm" data-del style="margin-right:auto;color:var(--crit);border-color:var(--crit)">Delete</button>':''}
    <button class="btn ghost" data-x>${opts.noSave?'Close':'Cancel'}</button>${opts.noSave?'':'<button class="btn" data-ok>Save</button>'}`;
  modal.append(h,bodyEl,f);wrap.append(modal);root.append(wrap);
  const close=()=>root.innerHTML="";
  _closeModal=close;
  wrap.addEventListener("click",e=>{if(e.target===wrap)close();});
  root.querySelectorAll("[data-x]").forEach(b=>b.onclick=close);
  const ok=f.querySelector("[data-ok]");
  if(ok)ok.onclick=()=>{onSubmit();close();};
  if(onDel)f.querySelector("[data-del]").onclick=()=>{if(confirm("Delete this?")){onDel();close();}};
  document.addEventListener("keydown",function esc2(e){if(e.key==="Escape"){close();document.removeEventListener("keydown",esc2);}});
}
function openForm({title,fields,del},onSubmit){
  const body=document.createElement("div");body.className="modal-b";
  const refs={};
  const mkField=(fd)=>{
    const wrap=document.createElement("div");wrap.className="fld";
    const id="ff_"+fd.name;
    let inner=`<label for="${id}">${esc(fd.label)}</label>`;
    if(fd.type==="textarea"){inner+=`<textarea id="${id}">${esc(fd.value||"")}</textarea>`;}
    else if(fd.type==="select"){
      const opts=fd.options.map(o=>typeof o==="object"?o:{v:o,t:o});
      inner+=`<select id="${id}">${opts.map(o=>`<option value="${esc(o.v)}" ${String(o.v)===String(fd.value)?'selected':''}>${esc(o.t)}</option>`).join("")}</select>`;
    }
    else if(fd.type==="multiselect"){
      inner+=`<div class="checks" id="${id}">${fd.options.map(o=>`<label class="${(fd.value||[]).includes(o)?'on':''}"><input type="checkbox" value="${esc(o)}" ${(fd.value||[]).includes(o)?'checked':''}>${esc(o)}</label>`).join("")}</div>`;
    }
    else{inner+=`<input id="${id}" type="${fd.type||'text'}" value="${esc(fd.value??"")}" ${fd.min!=null?`min="${fd.min}"`:''} ${fd.max!=null?`max="${fd.max}"`:''} ${fd.step?`step="${fd.step}"`:''}>`;}
    if(fd.hint)inner+=`<span class="hint">${esc(fd.hint)}</span>`;
    wrap.innerHTML=inner;
    refs[fd.name]=fd;
    return wrap;
  };
  fields.forEach(fd=>{
    if(fd.row){
      const r=document.createElement("div");r.className="fld row2";
      fd.row.forEach(sub=>r.append(mkField(sub)));
      body.append(r);
    }else body.append(mkField(fd));
  });
  body.querySelectorAll(".checks input[type=checkbox]").forEach(cb=>{
    const lbl=cb.closest("label");
    const sync=()=>lbl.classList.toggle("on",cb.checked);
    sync();
    cb.addEventListener("change",sync); // label click natively toggles the box -> change fires -> sync the chip
  });
  modalShell(title,body,()=>{
    const data={};
    Object.values(refs).forEach(fd=>{
      const el=body.querySelector("#ff_"+fd.name);
      if(fd.type==="multiselect")data[fd.name]=[...el.querySelectorAll("input:checked")].map(i=>i.value);
      else data[fd.name]=el.value;
    });
    onSubmit(data);
  },del);
}

/* ============================================================ wire shell */
$("#nav").addEventListener("click",e=>{const b=e.target.closest("button");if(b&&b.dataset.v){state.view=b.dataset.v;render();}});
/* delegated (survives M.innerHTML swaps) — replaces inline on* handlers for CSP */
M.addEventListener("click",e=>{const em=e.target.closest("[data-editmonth]");if(em)editMonth(em.dataset.editmonth);});
M.addEventListener("change",e=>{const gt=e.target.closest("[data-goaltoggle]");if(gt){const p=gt.dataset.goaltoggle.split("|");toggleMonthGoal(p[0],+p[1]);}});
$("#wkPrev").onclick=()=>{state.week=addDays(state.week,-7);render();};
$("#wkNext").onclick=()=>{state.week=addDays(state.week,7);render();};
$("#tourPill").onclick=()=>{
  if(!canEdit())return;
  const k=iso(state.week),tw=(team().tournamentWeeks||[]).slice(),i=tw.indexOf(k);
  if(i<0)tw.push(k);else tw.splice(i,1);
  act(API.put(`/api/teams/${TID()}`,{name:team().name,tag:team().tag,server:team().server,scrimGoal:team().scrimGoal,tournamentWeeks:tw}),
      i<0?"Marked tournament week":"Unmarked");
};
/* ---- team switcher (popover on desktop, bottom sheet on a phone) ---- */
const teamPopOpen=()=>!$("#teamPop").hidden;
function closeTeamPop(){
  $("#teamPop").hidden=true; $("#popScrim").hidden=true;
  $("#teamBtn").setAttribute("aria-expanded","false");
}
function openTeamPop(){
  const pop=$("#teamPop");
  const teams=(ME?ME.teams:[]);
  pop.innerHTML=`<div class="pophandle"></div>
    <div class="poptitle">SWITCH TEAM</div>
    ${teams.map(t=>`<button class="popitem ${t.id===TID()?'on':''}" data-team="${esc(t.id)}">
      <span class="ttag">${esc(teamTag(t))}</span>
      <span class="popname">${esc(t.name)}</span>
      <span class="poprole">${esc(t.role)}</span>
    </button>`).join("")}
    <div class="popdiv"></div>
    <button class="popitem" data-team="__new"><span class="popplus">${icon('plus')}</span><span class="popname">New team</span></button>`;
  pop.querySelectorAll("[data-team]").forEach(b=>b.onclick=()=>pickTeam(b.dataset.team));
  pop.hidden=false; $("#popScrim").hidden=false;
  $("#teamBtn").setAttribute("aria-expanded","true");
}
async function pickTeam(id){
  closeTeamPop();
  if(id==="__new")return newTeamDialog();
  if(id===TID())return;
  try{
    await loadTeam(id);
    // caches are per-team — drop them so the new team doesn't inherit them
    state.view="overview"; state.rankHist=null; state.rankSync=null; state.rankView="team"; mfClear();
    render();
  }catch(err){ toast(err.message); }
}
$("#teamBtn").onclick=()=>{ teamPopOpen()?closeTeamPop():openTeamPop(); };
$("#popScrim").onclick=closeTeamPop;
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeTeamPop();});

/* ---- theme: dark -> light -> follow the system ---- */
function themeMode(){return document.documentElement.getAttribute("data-theme")||"auto";}
function paintTheme(){
  const m=themeMode();
  const btn=$("#btnTheme");
  btn.innerHTML=icon(m==="dark"?"sun":m==="light"?"moon":"auto");
  btn.title=`Theme: ${m==="auto"?"follows your system":m}`;
}
$("#btnTheme").onclick=()=>{
  const next={auto:"dark",dark:"light",light:null}[themeMode()];
  if(next)document.documentElement.setAttribute("data-theme",next);
  else document.documentElement.removeAttribute("data-theme");
  try{localStorage.setItem("sightline.theme",next||"");}catch(e){}
  paintTheme();
};
$("#btnAccount").onclick=()=>{closeTeamPop();accountDialog();};
try{const th=localStorage.getItem("sightline.theme");if(th)document.documentElement.setAttribute("data-theme",th);}catch(e){}

/* team backup — lives in the Account dialog now that the rail is gone */
async function exportTeam(){
  try{
    const data=await API.get(`/api/teams/${TID()}`);
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
    a.download=`sightline-${(team().tag||'team')}-${iso(new Date())}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast("Exported team backup");
  }catch(e){toast(e.message);}
}

/* ============================================================ auth gate */
const GATE=$("#gate");
function showGate(html){
  $("#app").hidden=true; GATE.hidden=false;
  GATE.innerHTML=`<div class="gatewrap"><div class="gatecard">
    <div class="gatemark">SIGHTLINE</div>${html}</div></div>`;
}
let _booting=false;
function clearJoinHash(){ try{ history.replaceState(null,"","/"); }catch(e){ location.hash=""; } }
async function boot(){
  if(_booting)return; _booting=true;
  try{
    const hash=location.hash;
    if(hash.startsWith("#/join/")){ await renderJoin(decodeURIComponent(hash.slice(7))); return; }
    try{ ME=await API.get("/api/me"); }catch(e){ ME=null; }
    if(!ME){ await renderAuth(); return; }
    if(!ME.teams.length){ renderNoTeam(); return; }
    const want=(()=>{try{return localStorage.getItem("sightline.team");}catch(e){return null;}})();
    const pick=ME.teams.find(t=>t.id===want)||ME.teams[0];
    try{ await loadTeam(pick.id); render(); }
    catch(e){ toast(e.message); renderNoTeam(); }
  }finally{ _booting=false; }
}
window.addEventListener("hashchange",()=>{ if(location.hash.startsWith("#/join/"))boot(); });

function gateForm(fields,submitLabel,onSubmit,extra){
  return `<form id="gateform">
    ${fields.map(f=>`<label class="gatefield"><span>${esc(f.label)}</span>
      <input name="${f.name}" type="${f.type||'text'}" ${f.required?'required':''} ${f.autocomplete?`autocomplete="${f.autocomplete}"`:''} ${f.value?`value="${esc(f.value)}"`:''} ${f.readonly?'readonly':''}></label>`).join("")}
    <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:6px">${submitLabel}</button>
    <div class="gateerr" id="gateerr"></div>
    ${extra||""}
  </form>`;
}
function bindGateForm(onSubmit){
  const f=$("#gateform");
  f.onsubmit=async e=>{
    e.preventDefault();
    const btn=f.querySelector("button[type=submit]"); btn.disabled=true;
    const data=Object.fromEntries(new FormData(f).entries());
    try{ await onSubmit(data); }
    catch(err){ $("#gateerr").textContent=err.message||"Something went wrong"; btn.disabled=false; }
  };
}
async function renderAuth(){
  let needsBootstrap=false;
  try{ needsBootstrap=(await API.get("/api/auth/state")).needsBootstrap; }catch(e){}
  if(needsBootstrap){
    showGate(`<p class="gatelede">First run — create the owner account.</p>`+
      gateForm([{label:"Your name",name:"name",required:true},{label:"Email",name:"email",type:"email",required:true,autocomplete:"email"},
               {label:"Password (min 8)",name:"password",type:"password",required:true,autocomplete:"new-password"},
               {label:"Confirm password",name:"password2",type:"password",required:true,autocomplete:"new-password"}],"Create account",null));
    bindGateForm(async d=>{
      if(d.password!==d.password2) throw new Error("Passwords don't match");
      await API.post("/api/auth/bootstrap",d); await boot();
    });
  }else{
    showGate(`<p class="gatelede">Sign in to your team.</p>`+
      gateForm([{label:"Email",name:"email",type:"email",required:true,autocomplete:"email"},
               {label:"Password",name:"password",type:"password",required:true,autocomplete:"current-password"}],"Sign in",null)+
      `<div class="gatediv">Have an invite link or code?</div>
       <form id="codeform"><label class="gatefield"><span>Invite code</span>
         <input name="code" placeholder="paste the link or code" required></label>
         <button class="btn ghost" type="submit" style="width:100%;justify-content:center">Continue to sign up</button></form>
       <p class="gatehint">New here? You can only register with an invite from a team manager.</p>`);
    bindGateForm(async d=>{ await API.post("/api/auth/login",d); await boot(); });
    const cf=$("#codeform");
    cf.onsubmit=e=>{
      e.preventDefault();
      let raw=(new FormData(cf).get("code")||"").trim();
      if(raw.includes("/join/")) raw=raw.split("/join/").pop();
      raw=raw.replace(/[#/?].*$/,"").replace(/^#\/?/,"");
      if(raw) location.hash="#/join/"+encodeURIComponent(raw);
    };
  }
}
async function renderJoin(code){
  let iv;
  try{ iv=await API.get(`/api/invites/${encodeURIComponent(code)}`); }
  catch(e){ showGate(`<p class="gatelede">${esc(e.message[0].toUpperCase()+e.message.slice(1))}.</p><button class="btn ghost" id="gateBack" style="width:100%;justify-content:center">Back to sign in</button>`); $("#gateBack").onclick=()=>{clearJoinHash();boot();}; return; }
  // already signed in? offer one-click join
  try{ ME=await API.get("/api/me"); }catch(e){ ME=null; }
  if(ME){
    showGate(`<p class="gatelede">Join <b>${esc(iv.teamName)}</b> as <b>${esc(iv.role)}</b>?</p>
      <button class="btn" id="joinbtn" style="width:100%;justify-content:center">Join team</button>
      <div class="gateerr" id="gateerr"></div>`);
    $("#joinbtn").onclick=async()=>{
      try{ const r=await API.post("/api/teams/join",{code}); clearJoinHash(); ME=await API.get("/api/me"); await loadTeam(r.teamId); render(); }
      catch(e){ $("#gateerr").textContent=e.message; }
    };
    return;
  }
  const f=[{label:"Your name",name:"name",required:true}];
  if(!iv.email) f.push({label:"Email",name:"email",type:"email",required:true});
  else f.push({label:"Email",name:"email",type:"email",value:iv.email,readonly:true});
  f.push({label:"Password (min 8)",name:"password",type:"password",required:true,autocomplete:"new-password"});
  f.push({label:"Confirm password",name:"password2",type:"password",required:true,autocomplete:"new-password"});
  showGate(`<p class="gatelede">You've been invited to <b>${esc(iv.teamName)}</b> as <b>${esc(iv.role)}</b>.</p>`+
    gateForm(f,"Create account & join",null)+
    `<p class="gatehint">Already have a Sightline account? <a href="#" id="join_signin">Sign in to join instead</a>.</p>`);
  const goSignIn=()=>joinSignIn(code,iv,(new FormData($("#gateform")).get("email"))||iv.email||"");
  $("#join_signin").onclick=(e)=>{e.preventDefault();goSignIn();};
  bindGateForm(async d=>{
    if(d.password!==d.password2) throw new Error("Passwords don't match");
    try{
      await API.post(`/api/invites/${encodeURIComponent(code)}/accept`,d);
      clearJoinHash(); await boot();
    }catch(e){
      if(e.status===409){ joinSignIn(code,iv,d.email||iv.email||""); return; }
      throw e;
    }
  });
}
/* invitee already has an account -> sign in, then redeem the code */
function joinSignIn(code,iv,email){
  showGate(`<p class="gatelede">Sign in to join <b>${esc(iv.teamName)}</b> as <b>${esc(iv.role)}</b>.</p>`+
    gateForm([{label:"Email",name:"email",type:"email",required:true,value:email||"",autocomplete:"email"},
             {label:"Password",name:"password",type:"password",required:true,autocomplete:"current-password"}],"Sign in & join",null));
  bindGateForm(async d=>{
    await API.post("/api/auth/login",d);
    try{ await API.post("/api/teams/join",{code}); }
    catch(e){ if(!/already/i.test(e.message||"")) throw e; }
    clearJoinHash(); await boot();
  });
}
function renderNoTeam(){
  showGate(`<p class="gatelede">You're signed in as ${esc(ME.user.email)} but not on a team yet.</p>
    <button class="btn" id="mkTeam" style="width:100%;justify-content:center">Create a team</button>
    <div style="margin:14px 0 6px;text-align:center;color:var(--ink-3);font-size:11px;letter-spacing:.1em">OR REDEEM AN INVITE CODE</div>
    ${gateForm([{label:"Invite code",name:"code",required:true}],"Join with code",null)}
    <button class="btn ghost" id="gateSignout" style="width:100%;justify-content:center;margin-top:10px">Sign out</button>`);
  $("#gateSignout").onclick=async()=>{ await API.post('/api/auth/logout'); location.reload(); };
  $("#mkTeam").onclick=()=>{ $("#app").hidden=false; GATE.hidden=true; newTeamDialog(); };
  bindGateForm(async d=>{ const r=await API.post("/api/teams/join",{code:d.code.trim()}); ME=await API.get("/api/me"); await loadTeam(r.teamId); render(); });
}

/* ---- team / account / members dialogs ---- */
function newTeamDialog(){
  openForm({title:"New team",fields:[
    {row:[{name:"name",label:"Team name",type:"text",value:"",required:true},
          {name:"tag",label:"Tag",type:"text",value:""}]},
    {name:"server",label:"Region",type:"select",options:["EU","NA","APAC","BR","LATAM","KR"],value:"EU"},
    {name:"demo",label:"Contents",type:"select",options:[{v:"yes",t:"Start with a sample roster"},{v:"no",t:"Empty team"}],value:"yes"},
  ]},async d=>{
    try{
      const r=await API.post("/api/teams",{name:d.name,tag:d.tag,server:d.server,demo:d.demo==="yes"});
      ME=await API.get("/api/me"); await loadTeam(r.id); state.view="overview"; render(); toast("Team created");
    }catch(e){toast(e.message);}
  });
}
function accountDialog(){
  const body=document.createElement("div");body.className="modal-b";
  const hr=`<hr style="border:0;border-top:1px solid var(--border);margin:2px 0">`;
  body.innerHTML=`
    <div class="eyebrow">Profile</div>
    <div class="fld"><label>Display name</label><input id="acc_name" value="${esc(ME.user.name)}"></div>
    <div class="fld"><label>Email</label><input id="acc_email" type="email" value="${esc(ME.user.email)}" autocomplete="email"></div>
    <button class="btn" id="acc_saveprofile" style="align-self:flex-start">Save profile</button>
    ${hr}
    <div class="eyebrow">Change password</div>
    <div class="fld"><label>Current password</label><input id="acc_cur" type="password" autocomplete="current-password"></div>
    <div class="fld row2">
      <div class="fld"><label>New password</label><input id="acc_new" type="password" autocomplete="new-password"></div>
      <div class="fld"><label>Confirm new password</label><input id="acc_new2" type="password" autocomplete="new-password"></div>
    </div>
    <button class="btn ghost" id="acc_savepw" style="align-self:flex-start">Update password</button>
    ${hr}
    <div class="eyebrow" style="margin:0">Team · ${esc(team().name)}</div>
    <div class="fld"><label>Your role</label><div style="text-transform:capitalize">${esc(myRole())}</div></div>
    ${canEdit()?`<button class="btn ghost" id="acc_teamset">Team settings</button>`:''}
    ${canManage()?`<button class="btn ghost" id="acc_invite">Invite a member</button>`:''}
    ${canManage()?`<button class="btn ghost" id="acc_members">Manage members</button>`:''}
    ${canManage()?`<button class="btn ghost" id="acc_discord">${icon('discord')} Discord notifications${team().hasDiscord?' <span class="chip good" style="margin-left:6px">on</span>':''}</button>`:''}
    <button class="btn ghost" id="acc_export">Export team backup</button>
    ${isOwner()?`<button class="btn ghost" id="acc_delteam" style="color:var(--crit);border-color:var(--crit)">Delete team</button>`:''}
    ${hr}
    <button class="btn ghost" id="acc_logout">Sign out</button>`;
  modalShell("Account",body,null,null,{noSave:true});
  body.querySelector("#acc_saveprofile").onclick=async()=>{
    try{
      await API.put("/api/me",{name:body.querySelector("#acc_name").value.trim(),email:body.querySelector("#acc_email").value.trim()});
      ME=await API.get("/api/me");
      toast("Profile saved");
    }catch(e){toast(e.message);}
  };
  body.querySelector("#acc_savepw").onclick=async()=>{
    const nw=body.querySelector("#acc_new").value, nw2=body.querySelector("#acc_new2").value;
    if(nw!==nw2) return toast("New passwords don't match");
    if(nw.length<8) return toast("New password must be at least 8 characters");
    try{
      await API.post("/api/me/password",{currentPassword:body.querySelector("#acc_cur").value,newPassword:nw});
      body.querySelector("#acc_cur").value=body.querySelector("#acc_new").value=body.querySelector("#acc_new2").value="";
      toast("Password updated");
    }catch(e){toast(e.message);}
  };
  const ts=body.querySelector("#acc_teamset"); if(ts)ts.onclick=()=>{closeModal();editTeamSettings();};
  const ex=body.querySelector("#acc_export"); if(ex)ex.onclick=exportTeam;
  const iv=body.querySelector("#acc_invite"); if(iv)iv.onclick=()=>{closeModal();inviteDialog();};
  const m=body.querySelector("#acc_members"); if(m)m.onclick=()=>{closeModal();membersDialog();};
  const dc=body.querySelector("#acc_discord"); if(dc)dc.onclick=()=>{closeModal();discordDialog();};
  const dl=body.querySelector("#acc_delteam"); if(dl)dl.onclick=async()=>{
    if(!confirm(`Delete "${team().name}" and all its data? This cannot be undone.`))return;
    try{ await API.del(`/api/teams/${TID()}`); location.reload(); }catch(e){toast(e.message);}
  };
  body.querySelector("#acc_logout").onclick=async()=>{ await API.post("/api/auth/logout"); location.reload(); };
}
function discordDialog(){
  if(!canManage())return;
  const connected=team().hasDiscord;
  const roleId=team().discordRoleId||"";
  const body=document.createElement("div");body.className="modal-b";
  body.innerHTML=`
    <p class="sub" style="margin:0">Post team activity to a Discord channel — scrims &amp; officials logged or imported, new schedule activities, tournament weeks. Uses an <b>incoming webhook</b>: in Discord open <b>Channel → Edit → Integrations → Webhooks → New Webhook</b>, then <b>Copy Webhook URL</b>.</p>
    <div class="fld"><label>Webhook URL</label>
      <input id="dc_url" type="url" autocomplete="off" placeholder="${connected?'•••••••• saved — paste a new URL to replace':'https://discord.com/api/webhooks/…'}">
    </div>
    <div class="fld"><label>Ping this role (optional)</label>
      <input id="dc_role" inputmode="numeric" autocomplete="off" placeholder="role ID, e.g. 1234567890" value="${esc(roleId)}">
      <span class="hint">Enable <b>Settings → Advanced → Developer Mode</b> in Discord, then right-click the role (Server Settings → Roles) → <b>Copy Role ID</b>. Or type <span class="mono">\\@RoleName</span> in any channel and copy the digits. Leave blank for no ping.</span></div>
    <div class="btn-row">
      <button class="btn" id="dc_save">${connected?'Save':'Connect'}</button>
      ${connected?`<button class="btn ghost" id="dc_test">Send test message</button>`:''}
      ${connected?`<button class="btn ghost" id="dc_off" style="color:var(--crit);border-color:var(--crit)">Disconnect</button>`:''}
    </div>`;
  modalShell("Discord notifications",body,null,null,{noSave:true});
  const url=()=>body.querySelector("#dc_url").value.trim();
  const rid=()=>body.querySelector("#dc_role").value.replace(/\D/g,"");
  body.querySelector("#dc_save").onclick=async()=>{
    const payload={roleId:rid()};
    if(url()) payload.webhook=url();
    else if(!connected) return toast("Paste a webhook URL");
    try{ await API.put(`/api/teams/${TID()}/discord`,payload); await reload(); toast("Saved"); closeModal(); discordDialog(); }
    catch(e){ toast(e.message); }
  };
  const tb=body.querySelector("#dc_test"); if(tb)tb.onclick=async()=>{
    try{ await API.post(`/api/teams/${TID()}/discord/test`,{}); toast("Test message sent to Discord"); }
    catch(e){ toast(e.message); }
  };
  const ob=body.querySelector("#dc_off"); if(ob)ob.onclick=async()=>{
    if(!confirm("Disconnect Discord notifications?"))return;
    try{ await API.put(`/api/teams/${TID()}/discord`,{webhook:""}); await reload(); toast("Discord disconnected"); closeModal(); }
    catch(e){ toast(e.message); }
  };
}
function inviteLink(code){ return `${location.origin}/#/join/${code}`; }
function copyText(t,silent){
  const done=()=>{ if(!silent)toast("Link copied"); };
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done,()=>{ if(!silent)toast("Press Ctrl+C to copy"); });
    else if(!silent)toast("Select the link and copy it");
  }catch(e){ if(!silent)toast("Select the link and copy it"); }
}

/* focused invite dialog — the main way to add people */
async function inviteDialog(){
  let invites=[];
  try{ invites=await API.get(`/api/teams/${TID()}/invites`); }catch(e){ toast(e.message); }
  const roster=team().roster;
  const pOpts=`<option value="">— link to a roster player (optional) —</option>`+roster.map(p=>`<option value="${p.id}">${esc(p.handle)}</option>`).join("");
  const body=document.createElement("div");body.className="modal-b";
  body.innerHTML=`
    <p class="sub" style="margin:0">Create a link and send it to the person. They open it, pick a password, and join your team as the chosen role. Each link works once and expires in 14 days.</p>
    <div class="fld row2">
      <div class="fld"><label>Role</label><select id="inv_role">${["player","igl","manager"].map(r=>`<option>${r}</option>`).join("")}</select></div>
      <div class="fld"><label>Link to player</label><select id="inv_player">${pOpts}</select></div>
    </div>
    <button class="btn" id="inv_make" style="align-self:flex-start">Create invite link</button>
    <div class="fld" id="inv_result" hidden>
      <label>Invite link — send this to them</label>
      <div style="display:flex;gap:6px"><input id="inv_url" readonly style="flex:1"><button class="btn ghost sm" id="inv_copy">Copy</button></div>
    </div>
    <div class="fld"><label>Open invites</label><div id="inv_list"></div></div>`;
  modalShell("Invite a member",body,null,null,{noSave:true});
  const listEl=body.querySelector("#inv_list");
  const drawList=()=>{
    listEl.innerHTML = invites.length ? invites.map(i=>`<div class="rowline" data-code="${i.code}">
      <span class="mono" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(inviteLink(i.code))}</span>
      <span style="display:flex;gap:6px;align-items:center;flex:none">
        <span class="chip">${i.role}</span>
        <button class="btn ghost sm" data-copy>Copy</button>
        <button class="icar" data-del title="Revoke">✕</button>
      </span></div>`).join("") : '<div class="sub">No open invites</div>';
    listEl.querySelectorAll("[data-copy]").forEach(b=>b.onclick=()=>copyText(inviteLink(b.closest("[data-code]").dataset.code)));
    listEl.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
      const code=b.closest("[data-code]").dataset.code;
      try{ await API.del(`/api/teams/${TID()}/invites/${code}`); invites=invites.filter(x=>x.code!==code); drawList(); }
      catch(e){ toast(e.message); }
    });
  };
  drawList();
  body.querySelector("#inv_make").onclick=async()=>{
    const role=body.querySelector("#inv_role").value;
    try{
      const r=await API.post(`/api/teams/${TID()}/invites`,{role,playerId:body.querySelector("#inv_player").value||null});
      const url=inviteLink(r.code);
      body.querySelector("#inv_url").value=url;
      body.querySelector("#inv_result").hidden=false;
      copyText(url);
      invites=[{code:r.code,role,player_id:null}].concat(invites);
      drawList();
    }catch(e){ toast(e.message); }
  };
  body.querySelector("#inv_copy").onclick=()=>copyText(body.querySelector("#inv_url").value);
}

async function membersDialog(){
  let members=[];
  try{ members=(await API.get(`/api/teams/${TID()}`)).members; }catch(e){toast(e.message);return;}
  const roster=team().roster;
  const body=document.createElement("div");body.className="modal-b";
  const pOpts=(sel)=>`<option value="">— no linked player —</option>`+roster.map(p=>`<option value="${p.id}" ${p.id===sel?'selected':''}>${esc(p.handle)}</option>`).join("");
  body.innerHTML=`
    <div class="fld"><label>Members</label>
      ${members.map(mem=>`<div class="rowline" data-uid="${mem.userId}" style="flex-wrap:wrap;gap:8px">
        <div style="min-width:120px;flex:1"><div style="font-family:var(--disp);font-weight:600">${esc(mem.name)}</div><div class="sub">${esc(mem.email)}</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <select data-f="role">${["manager","igl","player"].map(r=>`<option ${r===mem.role?'selected':''}>${r}</option>`).join("")}</select>
          <select data-f="player">${pOpts(mem.playerId)}</select>
          <button class="icar" data-save title="Save">✓</button>
          <button class="icar" data-remove title="Remove">✕</button>
        </div>
      </div>`).join("")}
    </div>
    <button class="btn ghost" id="mem_invite">＋ Invite a new member</button>`;
  modalShell("Members",body,null,null,{noSave:true});
  body.querySelector("#mem_invite").onclick=()=>{ closeModal(); inviteDialog(); };
  body.querySelectorAll("[data-uid]").forEach(row=>{
    const uid=row.dataset.uid;
    row.querySelector("[data-save]").onclick=async()=>{
      try{ await API.put(`/api/teams/${TID()}/members/${uid}`,{role:row.querySelector("[data-f=role]").value,playerId:row.querySelector("[data-f=player]").value||null}); toast("Member updated"); }
      catch(e){toast(e.message);}
    };
    row.querySelector("[data-remove]").onclick=async()=>{
      if(!confirm("Remove this member from the team?"))return;
      try{ await API.del(`/api/teams/${TID()}/members/${uid}`); row.remove(); toast("Removed"); }catch(e){toast(e.message);}
    };
  });
}

boot();
