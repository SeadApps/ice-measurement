"use strict";
/* ice-build.js: the Measurement builder: entering readings, undo, notes, round completion, import and clear, the new-round dialog and deleting a round, and the in-page confirmation.
   Moved out of ice.html unchanged, in the order it had there. A classic script: the names it declares are the
   page's globals, shared with ice-core.js and the other modules. */
/* ---------- undo ---------- */
let undoStack=[];const snap=()=>JSON.stringify({data:data(),notes:notes()});
function pushUndo(){undoStack.push(snap());if(undoStack.length>40)undoStack.shift();$("undoBtn").disabled=false;}
function doUndo(){if(!undoStack.length)return;const s=session(),p=JSON.parse(undoStack.pop());s.data=p.data;s.notes=p.notes;$("undoBtn").disabled=!undoStack.length;afterChange();}
const clearUndo=()=>{undoStack=[];const u=$("undoBtn");if(u)u.disabled=true;};

/* ---------- mutations ---------- */
function assign(opt){pushUndo();const wasSet=data()[keyOf(POINTS[selIdx])]!=null;data()[keyOf(POINTS[selIdx])]=opt;
  if(!wasSet&&isComplete()){hideSel=true;afterChange();showComplete();return;} // final spot: no advance, clean map, summary
  if(entryMode==="guided"){guidedPos=Math.min(guidedOrder.length-1,guidedPos+1);selIdx=guidedOrder[guidedPos];}
  else{let n=selIdx;for(let i=1;i<=POINTS.length;i++){const c=(selIdx+i)%POINTS.length;if(data()[keyOf(POINTS[c])]==null){n=c;break;}n=(selIdx+1)%POINTS.length;}selIdx=n;}afterChange();}
function clearPoint(){if(data()[keyOf(POINTS[selIdx])]==null)return;pushUndo();delete data()[keyOf(POINTS[selIdx])];afterChange();}
function setNote(txt){const k=keyOf(POINTS[selIdx]),cur=notes()[k]||"";if(txt===cur)return;pushUndo();if(txt.trim())notes()[k]=txt;else delete notes()[k];persist();drawLive();}
function afterChange(){computeField();computeDelta();persist();refresh();}

/* ---------- round completion ---------- */
let hideSel=false; // hides the selection ring so a finished round renders clean
function isComplete(){return POINTS.length>0&&Object.keys(data()).length>=POINTS.length;}
function showComplete(){const d=data(),rows=[];for(const k in d){const[x,y]=k.split(",").map(Number);rows.push({x,y,zone:zoneOf({x,y}),lab:d[k],v:decOf.get(d[k])});}
  if(!rows.length)return;
  const avg=rows.reduce((s,r)=>s+r.v,0)/rows.length,ideal=rows.filter(r=>bandOf(r.v).key==="ideal").length;
  const mn=rows.reduce((a,b)=>b.v<a.v?b:a),mx=rows.reduce((a,b)=>b.v>a.v?b:a);
  const fb=attFlood(),sa=attShave(),flood=rows.filter(r=>r.v<fb).length,shave=rows.filter(r=>r.v>=sa).length;
  $("doneMeta").textContent=sheet().name+" · "+fmtDate(session().date)+(session().label?" · "+session().label:"")+" · "+rows.length+"/"+POINTS.length+" spots";
  $("doneAvg").innerHTML=fmtNumHTML(avg);
  $("doneIdeal").innerHTML=ideal+'<small> / '+rows.length+'</small>';
  $("doneMin").textContent=fmtLabel(mn.lab);$("doneMinZone").textContent=mn.zone;
  $("doneMax").textContent=fmtLabel(mx.lab);$("doneMaxZone").textContent=mx.zone;
  $("donePlan").innerHTML=`<b class="flood">Flood ${flood}</b> &nbsp;·&nbsp; <b class="shave">Shave ${shave}</b> &nbsp;·&nbsp; avg ${fmtDelta(avg-EF().target)} vs target`;
  const base=baselineSession(),tr=$("doneTrend");
  if(base){let sumd=0,nd=0,thinner=0,thicker=0;for(const r of rows){const bv=base.data[r.x+","+r.y];if(bv!=null){const dd=r.v-decOf.get(bv);sumd+=dd;nd++;if(dd<-1e-9)thinner++;else if(dd>1e-9)thicker++;}}
    if(nd){tr.style.display="block";tr.innerHTML=`vs ${fmtDate(base.date)}: avg <b>${fmtDelta(sumd/nd)}</b> · ${thinner} thinner, ${thicker} thicker`;}else tr.style.display="none";}
  else tr.style.display="none";
  $("doneScrim").classList.add("on");}
$("doneClose").addEventListener("click",()=>$("doneScrim").classList.remove("on"));
$("doneScrim").addEventListener("click",e=>{if(e.target===$("doneScrim"))$("doneScrim").classList.remove("on");});
$("doneExport").addEventListener("click",()=>$("expPng").click());
$("donePrint").addEventListener("click",()=>{$("doneScrim").classList.remove("on");$("expPdf").click();});

/* ---------- UI build ---------- */
function buildChips(){const el=$("chips");el.innerHTML="";for(const o of KEYS){const b=bandOf(decOf.get(o)),btn=document.createElement("button");btn.className="chip";btn.dataset.opt=o;
  btn.innerHTML=`<span class="dot" style="background:${b.color}"></span><span class="f">${fmtLabel(o)}</span><span class="w">${b.word||b.label}</span>`;btn.addEventListener("click",()=>assign(o));el.appendChild(btn);}
  const clr=document.createElement("button");clr.className="chip clear";clr.textContent="Clear this point";clr.addEventListener("click",clearPoint);el.appendChild(clr);}
/* ---------- nav / modes ---------- */
$("prev").addEventListener("click",()=>{hideSel=false;if(entryMode==="guided"){guidedPos=(guidedPos-1+guidedOrder.length)%guidedOrder.length;selIdx=guidedOrder[guidedPos];}else selIdx=(selIdx-1+POINTS.length)%POINTS.length;refresh();});
$("next").addEventListener("click",()=>{hideSel=false;if(entryMode==="guided"){guidedPos=(guidedPos+1)%guidedOrder.length;selIdx=guidedOrder[guidedPos];}else selIdx=(selIdx+1)%POINTS.length;refresh();});
window.addEventListener("keydown",e=>{if(state&&state.screen!=="work")return;if(e.target.tagName==="INPUT")return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();doUndo();return;}
  if(e.key==="ArrowLeft")$("prev").click();else if(e.key==="ArrowRight")$("next").click();});
$("undoBtn").addEventListener("click",doUndo);
$("modeFree").addEventListener("click",()=>setEntry("free"));$("modeGuided").addEventListener("click",()=>setEntry("guided"));
function setEntry(m){entryMode=m;$("modeFree").setAttribute("aria-pressed",String(m==="free"));$("modeGuided").setAttribute("aria-pressed",String(m==="guided"));$("chips").classList.toggle("guided",m==="guided");if(m==="guided"){guidedPos=0;selIdx=guidedOrder[0];}refresh();}
$("noteInput").addEventListener("input",e=>setNote(e.target.value));

/* In-page replacement for confirm()/alert(). ask({title,text,ok,cancel}, onYes, onNo): with cancel:null it is a notice with one button. */
function ask(o,yes,no){const sc=$("sureScrim");$("sureTitle").textContent=o.title||"Are you sure?";$("sureText").textContent=o.text||"";
  $("sureYes").textContent=o.ok||"OK";$("sureNo").textContent=o.cancel||"Cancel";$("sureNo").style.display=o.cancel===null?"none":"";
  const done=fn=>{sc.classList.remove("on");$("sureYes").onclick=$("sureNo").onclick=sc.onclick=null;if(fn)fn();};
  $("sureYes").onclick=()=>done(yes);$("sureNo").onclick=()=>done(no);sc.onclick=e=>{if(e.target===sc)done(no);};
  sc.classList.add("on");$("sureNo").style.display==="none"?$("sureYes").focus():$("sureNo").focus();}
function askDeleteRound(sh,s,after){   /* the sheet is looked up again on OK: a pull can replace the objects while the question is open */
  const sid=s.id,shId=sh.id;
  if(sh.sessions.length<=1){ask({title:"Keep at least one round",text:"This is the only round on this sheet, so it can't be deleted.",cancel:null});return;}
  ask({title:`Delete the ${fmtDay(s.date)} round?`,text:"This can't be undone.",ok:"Delete round"},()=>{const cur=(facility().sheets||[]).find(x=>x.id===shId)||sheet();if(deleteRound(cur,sid))after();});}
function changeMode(mode){const s=session();if(mode===(s.mode||"moderate"))return;
  const valid=new Set(pointsForMode(mode).map(keyOf)),cur=s.data,orphan=Object.keys(cur).filter(k=>!valid.has(k));
  if(orphan.length&&!changeMode.ok){ask({title:`Switch to ${MODES[mode].label} (${MODES[mode].n} spots)?`,text:`${orphan.length} existing reading(s) fall outside that grid and will be removed.`,ok:"Switch"},()=>{changeMode.ok=1;changeMode(mode);changeMode.ok=0;},()=>{$("modeSel").value=s.mode||"moderate";});return;}
  if(orphan.length){pushUndo();orphan.forEach(k=>{delete cur[k];delete s.notes[k];});}
  s.mode=mode;selIdx=0;guidedPos=0;applyGeometry(Records.sizeOf(sheet()),mode);computeField();computeDelta();buildSessSel();refresh();persist();flashNote(MODES[mode].label+" · "+MODES[mode].n+" spots");}
$("modeSel").addEventListener("change",e=>changeMode(e.target.value));
$("newRound").addEventListener("click",()=>openNewRound(s=>{compareId=null;clearUndo();selIdx=0;guidedPos=0;applyGeometry(Records.sizeOf(sheet()),s.mode);computeField();computeDelta();buildSessSel();refresh();persist();flashNote("round added "+fmtDay(s.date));}));

$("impBtn").addEventListener("click",()=>$("impFile").click());
$("impFile").addEventListener("change",e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const lines=rd.result.split(/\r?\n/).filter(l=>l.trim()),hdrLine=lines[0].toLowerCase(),hdr=hdrLine.includes("x_ft"),mmFile=hdrLine.includes("thickness_mm");pushUndo();const d=data(),nt=notes();for(const k in d)delete d[k];for(const k in nt)delete nt[k];
  for(let i=hdr?1:0;i<lines.length;i++){const c=parseCsvLine(lines[i]);if(c.length<3)continue;const fx=+c[0],fy=+c[1];let t=+c[2];if(isNaN(fx)||isNaN(t))continue;if(mmFile)t=t/25.4;let best=null,bd=1e9;for(const p of POINTS){const dd=(p.x-fx)**2+(p.y-fy)**2;if(dd<bd){bd=dd;best=p;}}if(best&&bd<25){d[keyOf(best)]=labelOf(t);if(c[4]&&c[4].trim())nt[keyOf(best)]=c[4];}}
  selIdx=0;afterChange();flashNote("imported "+Object.keys(d).length+" readings");}catch(err){flashNote("couldn’t read that file");}$("impFile").value="";};rd.readAsText(f);});
function parseCsvLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(q){if(c==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}else{if(c===','){out.push(cur);cur="";}else if(c==='"')q=true;else cur+=c;}}out.push(cur);return out;}
$("clearBtn").addEventListener("click",()=>{const d=data();if(!Object.keys(d).length)return;ask({title:"Clear all readings in this round?",text:"The readings and notes go. Undo brings them back.",ok:"Clear round"},()=>{pushUndo();for(const k in d)delete d[k];const nt=notes();for(const k in nt)delete nt[k];selIdx=0;afterChange();flashNote("round cleared");});});
/* ---------- new-round dialog ---------- */
let roundAfter=null;
function todayISO(){const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());}
function isoFromInput(v){return v?new Date(v+"T12:00:00").toISOString():new Date().toISOString();}
function inputFromIso(iso){const d=new Date(iso),p=n=>String(n).padStart(2,'0');return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());}
function openNewRound(after){roundAfter=after||null;$("roundDate").value=todayISO();$("roundLabel").value="";$("roundMode").value=session().mode||"moderate";$("roundScrim").classList.add("on");}
const closeNewRound=()=>$("roundScrim").classList.remove("on");
$("roundCancel").addEventListener("click",closeNewRound);
$("roundScrim").addEventListener("click",e=>{if(e.target===$("roundScrim"))closeNewRound();});
$("roundCreate").addEventListener("click",()=>{const sh=sheet(),s=newSession();s.date=isoFromInput($("roundDate").value);s.label=$("roundLabel").value.trim();s.mode=$("roundMode").value;sh.sessions.push(s);state.activeSession=s.id;closeNewRound();persist();const cb=roundAfter;roundAfter=null;if(cb)cb(s);});

/* ---------- delete a round ---------- */
function deleteRound(sh,sid){if(sh.sessions.length<=1){flashNote("keep at least one round");return false;}
  sh.sessions=sh.sessions.filter(s=>s.id!==sid);if(compareId===sid)compareId=null;
  if(sh.id===state.activeSheet&&state.activeSession===sid){state.activeSession=[...sh.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date))[0].id;selIdx=0;clearUndo();}
  persist();return true;}

