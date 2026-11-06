"use strict";
/* ice-trends.js: the Trends page: the series, the chart and the rounds list.
   Moved out of ice.html unchanged, in the order it had there. A classic script: the names it declares are the
   page's globals, shared with ice-core.js and the other modules. */
/* ---------- HOME build ---------- */
function sessStats(s){const vals=Object.values(s.data).map(l=>decOf.get(l));if(!vals.length)return null;
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length,ideal=vals.filter(v=>bandOf(v).key==="ideal").length,flood=vals.filter(v=>v<attFlood()).length;return{avg,ideal,n:vals.length,flood};}
function sessStatsFor(s,f){const vals=Object.values(s.data).map(l=>decOf.get(l));if(!vals.length)return null;
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length,ef=Records.settingsOf(f.settings,state),e=ef.edges;
  const fb=ef.tieAttention?e[1]:ef.floodBelow;
  return{avg,flood:vals.filter(v=>v<fb).length,n:vals.length};}
/* The Trends page is what the old home screen was once the fleet, the facility list and the
   sheet grid had gone to the shell: the chart and the rounds of the sheet you are on. */
function buildHome(){buildBands();updateBackupBanner();$("trendsFac").textContent=facility().name+" · "+sheet().name;buildTrendPanel();}
let trendSel={kind:"sheet"};
function trendSpots(sh){const seen=new Set();sh.sessions.forEach(s=>{for(const k in s.data)seen.add(k);});
  return [...seen].map(k=>{const[x,y]=k.split(",").map(Number);return{key:k,x,y};}).sort((a,b)=>a.x-b.x||a.y-b.y);}
function buildTrendPick(sh){const sel=$("trendSel"),sp=$("trendSpot"),spots=trendSpots(sh);
  const cur=trendSel.kind==="zone"?"z"+trendSel.third:trendSel.kind;
  sel.innerHTML='<option value="sheet">Whole sheet</option>'+ZONE_NAMES.map((n,i)=>`<option value="z${i}">${n}</option>`).join("")+(spots.length?'<option value="spot">One spot…</option>':"");
  sel.value=[...sel.options].some(o=>o.value===cur)?cur:"sheet";
  sp.innerHTML=spots.map(o=>`<option value="${o.key}">${zoneOf(o)}</option>`).join("");
  if(trendSel.kind==="spot"&&spots.some(o=>o.key===trendSel.key))sp.value=trendSel.key;
  else if(spots.length&&trendSel.kind==="spot")trendSel={kind:"sheet"};
  $("trendSpotWrap").style.display=trendSel.kind==="spot"?"":"none";}
function onTrendPick(){const v=$("trendSel").value;
  trendSel=v==="sheet"?{kind:"sheet"}:v==="spot"?{kind:"spot",key:$("trendSpot").value}:{kind:"zone",third:+v.slice(1)};buildTrendPanel();}
$("trendSel").addEventListener("change",onTrendPick);$("trendSpot").addEventListener("change",onTrendPick);
function buildTrendPanel(){const sh=sheet();buildTrendPick(sh);
  const what=trendSel.kind==="zone"?" · "+ZONE_NAMES[trendSel.third]:trendSel.kind==="spot"?" · "+(trendSel.key?zoneOf({x:+trendSel.key.split(",")[0],y:+trendSel.key.split(",")[1]}):""):"";
  $("trendTitle").textContent=facility().name+" · "+sh.name+what;
  const withData=seriesOf(sh.sessions,trendSel);
  const mini=$("trendMini");
  if(withData.length>=2){const d=withData[withData.length-1].st.avg-withData[withData.length-2].st.avg;mini.textContent=`latest ${fmtNum(withData[withData.length-1].st.avg)} · ${fmtDelta(d)} vs prior`;}
  else if(withData.length===1)mini.textContent=`latest ${fmtNum(withData[0].st.avg)}`;else mini.textContent="";
  drawHistory(withData);
  // recent rounds list
  const rl=$("roundsList");rl.innerHTML="";const recent=[...sh.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
  recent.forEach(s=>{const st=sessStats(s),row=document.createElement("div");row.className="round";
    const col=st?bandOf(st.avg).color:"#5d7384";
    row.innerHTML=`<span class="dot" style="background:${col}"></span><span class="d">${fmtDate(s.date)}</span>${st?`<span class="a">${fmtNum(st.avg)}</span><span>·</span><span>${st.ideal}/${st.n} ideal</span>`:`<span class="empty">empty</span>`}<span class="x">${st?st.flood+" to flood":""}</span>`;
    row.addEventListener("click",()=>{state.activeSession=s.id;showPage("rink");});
    const delb=document.createElement("button");delb.className="rdel";delb.textContent="✕";delb.title="Delete round";
    delb.addEventListener("click",ev=>{ev.stopPropagation();askDeleteRound(sheet(),s,buildHome);});
    row.appendChild(delb);rl.appendChild(row);});
  if(!recent.length)rl.innerHTML='<div class="empty">No rounds yet.</div>';}
function drawHistory(withData){const c=$("histChart"),wrap=c.parentElement,cssW=wrap.clientWidth-32;const dpr=Math.min(window.devicePixelRatio||1,2),cssH=170;
  c.style.width="100%";c.width=Math.round(cssW*dpr);c.height=Math.round(cssH*dpr);const g=c.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,cssW,cssH);
  const padL=8,padR=8,padT=14,padB=22,w=cssW-padL-padR,h=cssH-padT-padB;
  const inkDim=css.getPropertyValue("--ink-faint").trim()||"#5d7384",line=css.getPropertyValue("--line").trim()||"#273d4f";
  if(!withData.length){g.fillStyle=inkDim;g.font="12px "+(css.getPropertyValue("--sans")||"sans-serif");g.textAlign="center";g.fillText("No logged rounds yet — start one below.",cssW/2,cssH/2);return;}
  const vals=withData.map(o=>o.st.avg),tgt=EF().target;let lo=Math.min(tgt,...vals)-0.15,hi=Math.max(tgt,...vals)+0.15;if(hi-lo<0.4){const m=(hi+lo)/2;lo=m-0.25;hi=m+0.25;}
  const X=i=>padL+(withData.length===1?w/2:i/(withData.length-1)*w),Y=v=>padT+(1-(v-lo)/(hi-lo))*h;
  // target line
  g.strokeStyle=line;g.setLineDash([4,4]);g.beginPath();g.moveTo(padL,Y(tgt));g.lineTo(padL+w,Y(tgt));g.stroke();g.setLineDash([]);
  g.fillStyle=inkDim;g.font="10px ui-monospace,monospace";g.textAlign="left";g.fillText("target "+fmtSet(tgt),padL+2,Y(tgt)-4);
  // line
  g.strokeStyle=themeInk("--frost","#6fd6ec");g.globalAlpha=.8;g.lineWidth=2;g.beginPath();withData.forEach((o,i)=>{const x=X(i),y=Y(o.st.avg);i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();g.globalAlpha=1;
  // points
  withData.forEach((o,i)=>{const x=X(i),y=Y(o.st.avg);g.beginPath();g.arc(x,y,4.5,0,7);g.fillStyle=bandOf(o.st.avg).color;g.fill();g.lineWidth=1.4;g.strokeStyle="rgba(0,0,0,.5)";g.stroke();});
  // date labels (first/last)
  g.fillStyle=inkDim;g.font="10px ui-monospace,monospace";g.textAlign="left";g.fillText(fmtDay(withData[0].s.date),padL,cssH-6);
  if(withData.length>1){g.textAlign="right";g.fillText(fmtDay(withData[withData.length-1].s.date),padL+w,cssH-6);}}

$("logNew").addEventListener("click",()=>openNewRound(()=>showPage("build")));



