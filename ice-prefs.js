"use strict";
/* ice-prefs.js: the Preferences window: steppers, bands, rounds list, backup and restore.
   Moved out of ice.html unchanged, in the order it had there. A classic script: the names it declares are the
   page's globals, shared with ice-core.js and the other modules. */
/* ---------- preferences ---------- */
function openSettings(){buildSettings();$("scrim").classList.add("on");}
const closeSettings=()=>$("scrim").classList.remove("on");
$("gear").addEventListener("click",openSettings);$("gearHome").addEventListener("click",openSettings);
$("settingsDone").addEventListener("click",closeSettings);$("scrim").addEventListener("click",e=>{if(e.target===$("scrim"))closeSettings();});
/* A stepper around a number box: the buttons move it one step and fire the same input event typing does. */
function stepper(inp,step,min,max){if(inp.parentNode.classList.contains("stp"))return;
  const w=document.createElement("span");w.className="stp";inp.parentNode.insertBefore(w,inp);
  const mk=(t,d,lab)=>{const b=document.createElement("button");b.type="button";b.textContent=t;b.setAttribute("aria-label",lab);
    b.addEventListener("click",()=>{const cur=parseFloat(inp.value);const v=Math.max(min,Math.min(max,Math.round(((isNaN(cur)?min:cur)+d*step)/step)*step));inp.value=v;inp.dispatchEvent(new Event("input",{bubbles:true}));});return b;};
  w.appendChild(mk("−",-1,"Less"));w.appendChild(inp);w.appendChild(mk("+",1,"More"));}
/* Staff see the window, but only Management changes what is in it. */
function applyPrefsRole(){const ro=typeof Shell!=="undefined"&&!Shell.canManage();$("prefRo").hidden=!ro;
  document.querySelectorAll("#scrim .modal input:not([type=file]),#scrim .modal .stp button,#resetBands,#roundManage .del").forEach(e=>{if(ro)e.disabled=true;else if(e.dataset.roLocked!=="1")e.disabled=false;});}
function buildSettings(){applyTheme();applyUnitButtons();
  $("prefFac").textContent=facility().name;$("prefSheet").textContent=sheet().name;
  const ef=EF();
  $("overdueIn").value=ef.overdueDays;
  $("targetIn").value=ef.target;$("targetFrac").textContent=fmtSet(ef.target);
  const names=["Too thin below","Thin below","Ideal below","Thick below"],ed=$("edges");ed.innerHTML="";
  ef.edges.forEach((v,i)=>{const row=document.createElement("div");row.className="edge";
    row.innerHTML=`<span class="sw" style="background:${BAND_META[i].c}"></span><span class="nm">${names[i]}</span><input type="number" step="0.125" min="0.5" max="3" value="${v}"><span class="frac">${fmtSet(v)}</span>`;
    const inp=row.querySelector("input"),frc=row.querySelector(".frac");stepper(inp,0.125,0.5,3);inp.addEventListener("input",()=>{let nv=parseFloat(inp.value);if(isNaN(nv))return;nv=Records.eighthNear(nv);editSettings().edges[i]=nv;frc.textContent=fmtSet(nv);applySettings();});ed.appendChild(row);});
  $("tieChk").checked=ef.tieAttention;$("manualAtt").classList.toggle("on",!ef.tieAttention);
  $("floodIn").value=ef.floodBelow;$("floodFrac").textContent=fmtSet(ef.floodBelow);$("shaveIn").value=ef.shaveAbove;$("shaveFrac").textContent=fmtSet(ef.shaveAbove);
  [["overdueIn",1,1,90],["targetIn",.125,.5,3],["floodIn",.125,.5,3],["shaveIn",.125,.5,3]].forEach(a=>stepper($(a[0]),a[1],a[2],a[3]));
  buildRoundManage();updateBackupStatus();applyPrefsRole();}
$("targetIn").addEventListener("input",e=>{let v=parseFloat(e.target.value);if(isNaN(v))return;v=Records.eighthNear(v);editSettings().target=v;$("targetFrac").textContent=fmtSet(v);applySettings();});
$("tieChk").addEventListener("change",e=>{editSettings().tieAttention=e.target.checked;$("manualAtt").classList.toggle("on",!e.target.checked);applySettings();});
$("floodIn").addEventListener("input",e=>{let v=parseFloat(e.target.value);if(isNaN(v))return;v=Records.eighthNear(v);editSettings().floodBelow=v;$("floodFrac").textContent=fmtSet(v);applySettings();});
$("shaveIn").addEventListener("input",e=>{let v=parseFloat(e.target.value);if(isNaN(v))return;v=Records.eighthNear(v);editSettings().shaveAbove=v;$("shaveFrac").textContent=fmtSet(v);applySettings();});
$("resetBands").addEventListener("click",()=>{editSettings().edges=[...DEFAULT_EDGES];applySettings();buildSettings();});
$("overdueIn").addEventListener("input",e=>{let v=parseInt(e.target.value,10);if(isNaN(v))return;editSettings().overdueDays=Math.max(1,Math.min(90,v));persist();});
async function doBackupExport(){await Repo.save(state);
  const res=await exportFile(JSON.stringify(await Repo.exportAll({only:SYNC?SYNC.canSee:null})),"application/json","ice_sheet_backup_"+todayISO()+".json");
  if(res!=="cancelled"){state.lastBackup=new Date().toISOString();persist();updateBackupStatus();updateBackupBanner();}}
$("backupExport").addEventListener("click",doBackupExport);
$("backupImport").addEventListener("click",()=>{if(SYNC&&!SYNC.canRestore()){flashNote(SYNC.restoreMessage);return;}$("backupFile").click();});
$("backupFile").addEventListener("change",e=>{const f=e.target.files[0];if(!f)return;if(SYNC&&!SYNC.canRestore()){$("backupFile").value="";flashNote(SYNC.restoreMessage);return;}const rd=new FileReader();rd.onload=()=>{
  try{
    const obj=JSON.parse(rd.result);
    const pv=Repo.previewImport(obj);                                  // the record format, or the older whole-state one
    if(!pv.ok)throw 0;
    const inc=pv.inc,count=pv.rounds;
    ask({title:"Merge this backup into your data?",text:count+" round"+(count===1?"":"s")+" in the file. Nothing is deleted — where both copies changed the same round, the newer edit wins and readings from each are kept.",ok:"Merge"},()=>{
    const res=Repo.merge(inc);
    state.facilities=res.facilities;
    state.facilities.forEach(fa=>{if(!fa.settings)fa.settings=defaultSettings();if(!fa.settings.edges)fa.settings.edges=[...DEFAULT_EDGES];(fa.sheets||[]).forEach(sh=>{if(!sh.size)sh.size=NHL_SIZE();(sh.sessions||[]).forEach(se=>{if(!se.mode)se.mode="moderate";});});});
    if(!facility())state.activeFacility=state.facilities[0].id;
    if(!sheet())state.activeSheet=facility().sheets[0].id;
    if(!session())state.activeSession=sheet().sessions[0].id;
    compareId=null;clearUndo();
    applyGeometry(Records.sizeOf(sheet()),session().mode);buildBands();buildChips();persist();closeSettings();showPage(page);
    flashNote(res.taken?("merged "+res.taken+" change"+(res.taken===1?"":"s")):"already up to date");
    });
  }catch(err){ask({title:"Not a backup file",text:"That doesn't look like a valid Ice Sheet backup file.",cancel:null});}
  $("backupFile").value="";};rd.readAsText(f);});
function applySettings(){buildBands();buildChips();buildLegend();computeField();if(state.screen==="work"){drawLive();renderStats();}else buildHome();persist();}

/* ---------- rounds management (preferences) ---------- */
function buildRoundManage(){const el=$("roundManage");if(!el)return;el.innerHTML="";const sh=sheet();
  [...sh.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(s=>{const row=document.createElement("div");row.className="mrow";
    const dt=document.createElement("input");dt.type="date";dt.value=inputFromIso(s.date);dt.style.flex="0 0 150px";
    dt.addEventListener("change",()=>{s.date=isoFromInput(dt.value);persist();buildSessSel();if(state.screen!=="work")buildHome();});
    const cnt=document.createElement("span");cnt.style.cssText="flex:1;font-family:var(--mono);font-size:12px;color:var(--ink-dim)";
    cnt.textContent=Object.keys(s.data).length+" readings"+(s.label?" · "+s.label:"");
    const del=document.createElement("button");del.className="del";del.textContent="✕";del.title="Delete round";
    del.addEventListener("click",()=>askDeleteRound(sh,s,()=>{buildRoundManage();if(state.screen==="work"){computeField();computeDelta();buildSessSel();refresh();}else buildHome();}));
    row.appendChild(dt);row.appendChild(cnt);row.appendChild(del);el.appendChild(row);});}

