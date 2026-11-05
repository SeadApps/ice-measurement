"use strict";
/* ice-rink.js: the Rink view: drawing the map, the live canvas, the legend and round selector, the readout, Compare, and the exports (CSV, image, print).
   Moved out of ice.html unchanged, in the order it had there. A classic script: the names it declares are the
   page's globals, shared with ice-core.js and the other modules. */
/* ---------- rendering ---------- */
function roundRink(ctx,ox,oy,s){const r=CORNER*s,x=ox,y=oy,w=L*s,h=W*s;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
const FX=(ox,s,fx)=>ox+fx*s,FY=(oy,s,fy)=>oy+(W-fy)*s;
const heatCanvas=document.createElement("canvas");
function bandImageFrom(fld,colorFn){heatCanvas.width=NX;heatCanvas.height=NY;const hctx=heatCanvas.getContext("2d"),img=hctx.createImageData(NX,NY);
  for(let j=0;j<NY;j++)for(let i=0;i<NX;i++){const v=fld[i+j*NX],[r,g,b]=colorFn(v),di=((NY-1-j)*NX+i)*4;img.data[di]=r;img.data[di+1]=g;img.data[di+2]=b;img.data[di+3]=255;}hctx.putImageData(img,0,0);}
const bandColor=v=>{let bi=BANDS.length-1;for(let b=0;b<BANDS.length;b++){if(v<BANDS[b].lt){bi=b;break;}}return BAND_RGB[bi];};
function divColor(d){const m=Math.max(-0.5,Math.min(0.5,d))/0.5,LP=(a,b,t)=>a+(b-a)*t;if(m<0){const t=-m;return[LP(223,214,t),LP(229,69,t),LP(232,63,t)];}const t=m;return[LP(223,44,t),LP(229,106,t),LP(232,163,t)];}
const CONTOUR_STEPS=[0.5,0.375,0.25,0.1875,0.125,0.0625]; // left(fewer) -> right(more)
function contourLevels(){const step=CONTOUR_STEPS[state.contourIdx??2];let lo=Infinity,hi=-Infinity;
  for(let i=0;i<field.length;i++){const v=field[i];if(v<lo)lo=v;if(v>hi)hi=v;}
  if(!(hi-lo>1e-3))return [];const out=[],start=Math.ceil((lo+1e-4)/step)*step;
  for(let t=start;t<hi-1e-4&&out.length<48;t+=step)out.push(+t.toFixed(4));return out;}
function drawContours(ctx,ox,oy,s){if(!(state.contoursOn??true))return;const thr=contourLevels();ctx.save();ctx.lineWidth=1;ctx.strokeStyle="rgba(12,20,28,.55)";
  const gx=i=>FX(ox,s,(i+0.5)/NX*L),gy=j=>FY(oy,s,(j+0.5)/NY*W);
  for(const t of thr){ctx.beginPath();for(let j=0;j<NY-1;j++)for(let i=0;i<NX-1;i++){const a=field[i+j*NX],b=field[i+1+j*NX],c=field[i+1+(j+1)*NX],d=field[i+(j+1)*NX];
    let idx=(a>t?1:0)|(b>t?2:0)|(c>t?4:0)|(d>t?8:0);if(idx===0||idx===15)continue;const x0=gx(i),x1=gx(i+1),y0=gy(j),y1=gy(j+1);
    const LP=(va,vb,p0,p1)=>{const u=(t-va)/(vb-va||1e-9);return p0+u*(p1-p0);};const top=[LP(a,b,x0,x1),y0],rgt=[x1,LP(b,c,y0,y1)],bot=[LP(d,c,x0,x1),y1],lft=[x0,LP(a,d,y0,y1)];
    const seg=(p,q)=>{ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);};
    switch(idx){case 1:case 14:seg(lft,top);break;case 2:case 13:seg(top,rgt);break;case 3:case 12:seg(lft,rgt);break;case 4:case 11:seg(rgt,bot);break;case 6:case 9:seg(top,bot);break;case 7:case 8:seg(lft,bot);break;case 5:seg(lft,top);seg(rgt,bot);break;case 10:seg(top,rgt);seg(lft,bot);break;}}ctx.stroke();}ctx.restore();}
function drawOrientation(ctx,ox,oy,s){ctx.save();
  const ink="rgba(13,22,32,.34)";ctx.fillStyle=ink;
  ctx.font=`700 ${Math.max(9,3.2*s)}px system-ui,sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";
  // top of map = player benches (Home left, Away right)
  ctx.fillText("HOME BENCH",FX(ox,s,L*0.30),FY(oy,s,W-3.4));
  ctx.fillText("AWAY BENCH",FX(ox,s,L*0.70),FY(oy,s,W-3.4));
  // bottom of map = spectator bleachers
  ctx.fillText("BLEACHERS",FX(ox,s,L/2),FY(oy,s,3.4));
  // left = zamboni room (rotated to read along the boards)
  ctx.save();ctx.translate(FX(ox,s,3.4),FY(oy,s,W/2));ctx.rotate(-Math.PI/2);ctx.fillText("ZAMBONI ROOM",0,0);ctx.restore();
  // right = lobby
  ctx.save();ctx.translate(FX(ox,s,L-3.4),FY(oy,s,W/2));ctx.rotate(Math.PI/2);ctx.fillText("LOBBY",0,0);ctx.restore();
  // zamboni door segment on the left boards, behind the goal crease
  ctx.strokeStyle="rgba(13,22,32,.55)";ctx.lineWidth=Math.max(2.5,1.2*s);
  ctx.beginPath();ctx.moveTo(FX(ox,s,0.7),FY(oy,s,CY-5));ctx.lineTo(FX(ox,s,0.7),FY(oy,s,CY+5));ctx.stroke();
  ctx.restore();}
function drawMarkings(ctx,ox,oy,s){const line=(x1,y1,x2,y2,c,w)=>{ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(FX(ox,s,x1),FY(oy,s,y1));ctx.lineTo(FX(ox,s,x2),FY(oy,s,y2));ctx.stroke();};
  const circ=(x,y,r,c,w,fill)=>{ctx.beginPath();ctx.arc(FX(ox,s,x),FY(oy,s,y),r*s,0,7);if(fill){ctx.fillStyle=c;ctx.fill();}else{ctx.strokeStyle=c;ctx.lineWidth=w;ctx.stroke();}};
  const RED="rgba(213,52,58,.85)",BLUE="rgba(47,134,197,.9)";
  line(GOAL1,0,GOAL1,W,RED,1.6);line(GOAL2,0,GOAL2,W,RED,1.6);line(CX,0,CX,W,"rgba(213,52,58,.7)",1.6);line(BLUE1,0,BLUE1,W,BLUE,2.4);line(BLUE2,0,BLUE2,W,BLUE,2.4);circ(CX,CY,15,BLUE,1.6);
  for(const[x,y]of[[FO_L,FO_B],[FO_L,FO_T],[FO_R,FO_B],[FO_R,FO_T]]){circ(x,y,15,RED,1.6);circ(x,y,2,"rgba(213,52,58,.9)",0,true);}circ(CX,CY,1.6,"rgba(213,52,58,.9)",0,true);
  ctx.strokeStyle=BLUE;ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(FX(ox,s,GOAL1),FY(oy,s,CY),6*s,-Math.PI/2,Math.PI/2);ctx.stroke();ctx.beginPath();ctx.arc(FX(ox,s,GOAL2),FY(oy,s,CY),6*s,Math.PI/2,3*Math.PI/2);ctx.stroke();}
function drawDots(ctx,ox,oy,s,opt){const d=data(),nt=notes(),base=opt.trend?baselineSession():null,sc=(!opt.trend&&mapMode()==="lowest")?mapScale():null;
  for(let k=0;k<POINTS.length;k++){const p=POINTS[k],px=FX(ox,s,p.x),py=FY(oy,s,p.y),lab=d[keyOf(p)],set=lab!=null;
    ctx.beginPath();ctx.arc(px,py,set?5.4:4.2,0,7);if(set){ctx.fillStyle=sc?rgbCss(sc.color(decOf.get(lab))):bandOf(decOf.get(lab)).color;ctx.fill();ctx.lineWidth=1.4;ctx.strokeStyle="rgba(10,16,22,.9)";ctx.stroke();
      if(sc&&(decOf.get(lab)===sc.min||decOf.get(lab)===sc.max)){ctx.beginPath();ctx.arc(px,py,8.6,0,7);ctx.lineWidth=2;ctx.strokeStyle="#0a1016";ctx.stroke();}}else{ctx.fillStyle="rgba(15,24,32,.85)";ctx.fill();ctx.lineWidth=1.4;ctx.strokeStyle="rgba(144,168,184,.8)";ctx.stroke();}
    if(opt.labels&&nt[keyOf(p)]){ctx.beginPath();ctx.arc(px+6,py-6,2.6,0,7);ctx.fillStyle=themeInk("--frost","#6fd6ec");ctx.fill();}
    if(opt.labels&&set){let txt;if(opt.trend){if(base&&base.data[keyOf(p)]!=null){const dd=decOf.get(lab)-decOf.get(base.data[keyOf(p)]);txt=isMM()?(dd>0?'+':dd<0?'−':'±')+Math.abs(mmOf(dd)).toFixed(1):(dd>0?'+':dd<0?'−':'±')+Math.abs(dd).toFixed(2);}else txt="new";}else txt=fmtLabelShort(lab);
      ctx.font="600 11px ui-monospace,Menlo,monospace";ctx.textAlign="center";ctx.textBaseline="bottom";const tw=ctx.measureText(txt).width;ctx.fillStyle="rgba(8,13,18,.78)";ctx.fillRect(px-tw/2-3,py-9-13,tw+6,13);ctx.fillStyle="#eaf3f8";ctx.fillText(txt,px,py-9);}}
  if(opt.sel){const p=POINTS[selIdx],px=FX(ox,s,p.x),py=FY(oy,s,p.y);ctx.beginPath();ctx.arc(px,py,9,0,7);ctx.lineWidth=2.4;ctx.strokeStyle=themeInk("--frost","#6fd6ec");ctx.stroke();ctx.beginPath();ctx.arc(px,py,12.5,0,7);ctx.lineWidth=1;ctx.globalAlpha=.4;ctx.stroke();ctx.globalAlpha=1;}}
/* Which map colours are in use, and the scale behind them. The mode is a device preference. */
const mapMode=()=>state&&state.mapMode==="lowest"?"lowest":"color";
const mapScale=()=>lowestScale(Object.values(data()).map(l=>decOf.get(l)),EF().target);
const rgbCss=c=>"rgb("+Math.round(c[0])+","+Math.round(c[1])+","+Math.round(c[2])+")";
function mapColorFn(){const sc=mapMode()==="lowest"?mapScale():null;return sc?sc.color:colorFor;}
const spots=n=>n+" spot"+(n===1?"":"s");
function renderScene(ctx,ox,oy,w,opt){const s=w/L,h=W*s;ctx.save();roundRink(ctx,ox,oy,s);ctx.save();ctx.clip();ctx.fillStyle="#e9eef0";ctx.fillRect(ox,oy,w,h);
  if(opt.trend){if(deltaField){bandImageFrom(deltaField,divColor);ctx.imageSmoothingEnabled=true;ctx.globalAlpha=.92;ctx.drawImage(heatCanvas,ox,oy,w,h);ctx.globalAlpha=1;}}
  else{bandImageFrom(field,mapColorFn());ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.globalAlpha=.9;ctx.drawImage(heatCanvas,ox,oy,w,h);ctx.globalAlpha=1;if(opt.contours)drawContours(ctx,ox,oy,s);}
  drawMarkings(ctx,ox,oy,s);drawOrientation(ctx,ox,oy,s);ctx.restore();roundRink(ctx,ox,oy,s);ctx.lineWidth=2.4;ctx.strokeStyle="rgba(150,176,192,.55)";ctx.stroke();drawDots(ctx,ox,oy,s,opt);ctx.restore();}

/* ---------- live canvas ---------- */
const cv=document.getElementById("rink"),ctx=cv.getContext("2d");
let liveS=1,viewMode="map",selIdx=0,entryMode="free",guidedPos=0;
function sizeLive(){const wrap=cv.parentElement,cssW=wrap.clientWidth;if(!cssW)return;const cssH=cssW*W/L,dpr=Math.min(window.devicePixelRatio||1,2.5);
  cv.style.height=cssH+"px";cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);liveS=cssW/L;drawLive();}
function drawLive(){if(!cv.clientWidth)return;ctx.clearRect(0,0,cv.clientWidth,W*liveS+2);renderScene(ctx,0,0,cv.clientWidth,{labels:true,sel:!hideSel,contours:true,trend:viewMode==="trend"});}
function pickPoint(cxp,cyp){const r=cv.getBoundingClientRect();const fx=(cxp-r.left)/r.width*L,fy=W-(cyp-r.top)/r.height*W;let best=-1,bd=1e9;
  for(let k=0;k<POINTS.length;k++){const dx=fx-POINTS[k].x,dy=fy-POINTS[k].y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=k;}}const tolFt=Math.max(7,28/(r.width/L));return Math.sqrt(bd)<=tolFt?best:-1;}
cv.addEventListener("pointerdown",e=>{const k=pickPoint(e.clientX,e.clientY);if(k>=0)selectPoint(k);});
function selectPoint(k){hideSel=false;selIdx=k;if(entryMode==="guided"){const gp=guidedOrder.indexOf(k);if(gp>=0)guidedPos=gp;}refresh();}


function buildLegend(){const el=$("legend");if(viewMode==="trend"){el.className="legend trend";el.innerHTML=`<span class="lbl">−½″ thinner</span><span class="bar"></span><span class="lbl">+½″ thicker</span>`;return;}
  if(mapMode()==="lowest"){el.className="legend";el.innerHTML="";const sc=mapScale();
    if(!sc){el.innerHTML='<div class="key" data-k="none"><div><div class="lab">Lowest point</div><div class="rng">No readings yet</div></div></div>';return;}
    [["low",LP_COLORS.red,"Lowest",fmtSet(sc.min)+" · "+spots(sc.nMin)],["ideal",LP_COLORS.green,"Ideal",fmtSet(EF().target)],["high",LP_COLORS.dblue,"Highest",fmtSet(sc.max)+" · "+spots(sc.nMax)]].forEach(([k,c,lab,rng])=>{
      const d=document.createElement("div");d.className="key";d.dataset.k=k;d.innerHTML=`<span class="sw" style="background:${rgbCss(c)}"></span><div><div class="lab">${lab}</div><div class="rng">${rng}</div></div>`;el.appendChild(d);});return;}
  el.className="legend";el.innerHTML="";for(const b of BANDS){const d=document.createElement("div");d.className="key";d.innerHTML=`<span class="sw" style="background:${b.color}"></span><div><div class="lab">${b.label}</div><div class="rng">${b.rng}</div></div>`;el.appendChild(d);}}
function buildSessSel(){const sh=sheet(),es=$("sessSel");es.innerHTML="";[...sh.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(s=>{const o=document.createElement("option");o.value=s.id;o.textContent=fmtDate(s.date)+(s.label?` · ${s.label}`:"")+` (${Object.keys(s.data).length})`;if(s.id===state.activeSession)o.selected=true;es.appendChild(o);});
  const cs=$("cmpSel");cs.innerHTML="";const others=sh.sessions.filter(s=>s.id!==state.activeSession).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const off=document.createElement("option");off.value="off";off.textContent="Nothing";if(viewMode==="map")off.selected=true;cs.appendChild(off);
  const a=document.createElement("option");a.value="";a.textContent="Previous round";if(viewMode==="trend"&&!compareId)a.selected=true;cs.appendChild(a);
  others.forEach(s=>{const o=document.createElement("option");o.value=s.id;o.textContent=fmtDate(s.date)+(s.label?` · ${s.label}`:"");if(viewMode==="trend"&&s.id===compareId)o.selected=true;cs.appendChild(o);});
  $("wsName").textContent=sheet().name;$("wsFac").textContent=facility().name;$("modeSel").value=session().mode||"moderate";}
/* ---------- refresh ---------- */
function refresh(){if(selIdx>=POINTS.length)selIdx=0;if(guidedPos>=guidedOrder.length)guidedPos=0;drawLive();const p=POINTS[selIdx],lab=data()[keyOf(p)];
  $("selZone").textContent=zoneOf(p);$("selVal").textContent=lab?fmtLabel(lab):"not set";$("noteInput").value=notes()[keyOf(p)]||"";
  const cnt=Object.keys(data()).length,tot=POINTS.length;$("countNum").textContent=cnt;$("countTot").textContent=tot;$("countPill").classList.toggle("done",cnt>=tot&&tot>0);$("hint").style.display=cnt?"none":"grid";
  document.querySelectorAll(".chip[data-opt]").forEach(c=>c.classList.toggle("is-set",c.dataset.opt===lab));
  const gp=$("gprog");gp.classList.toggle("on",entryMode==="guided");
  if(entryMode==="guided"){$("gposLab").textContent=`Point ${guidedPos+1} of ${tot} · ${zoneOf(POINTS[guidedOrder[guidedPos]])}`;$("gleftLab").textContent=`${cnt}/${tot} done`;$("gfill").style.width=(cnt/tot*100)+"%";}
  renderStats();if(viewMode==="map"&&mapMode()==="lowest")buildLegend();updateContourReadout();}
function renderStats(){const d=data(),rows=[];for(const k in d){const[x,y]=k.split(",").map(Number);rows.push({x,y,zone:zoneOf({x,y}),lab:d[k],v:decOf.get(d[k])});}
  $("targetNote").textContent="target "+fmtSet(EF().target);
  if(!rows.length){$("stAvg").textContent="—";$("stIdeal").textContent="—";$("zL").textContent=$("zN").textContent=$("zR").textContent="—";
    setTag($("stMinTag"),null);$("stMinZone").textContent="";setTag($("stMaxTag"),null);$("stMaxZone").textContent="";$("plan").textContent="No readings yet — tap a point to start.";$("trendline").classList.remove("on");$("todo").innerHTML='<li class="empty">No readings yet.</li>';return;}
  const avg=rows.reduce((s,r)=>s+r.v,0)/rows.length;$("stAvg").innerHTML=fmtNumHTML(avg);
  const ideal=rows.filter(r=>bandOf(r.v).key==="ideal").length;$("stIdeal").innerHTML=ideal+'<small> / '+rows.length+'</small>';
  const za=[[],[],[]];rows.forEach(r=>za[thirdOf(r.x)].push(r.v));const zt=a=>a.length?fmtNum(a.reduce((x,y)=>x+y,0)/a.length):'—';
  $("zL").textContent=zt(za[0]);$("zN").textContent=zt(za[1]);$("zR").textContent=zt(za[2]);
  const mn=rows.reduce((a,b)=>b.v<a.v?b:a),mx=rows.reduce((a,b)=>b.v>a.v?b:a);setTag($("stMinTag"),mn);$("stMinZone").textContent=mn.zone;setTag($("stMaxTag"),mx);$("stMaxZone").textContent=mx.zone;
  const fb=attFlood(),sa=attShave(),flood=rows.filter(r=>r.v<fb),shave=rows.filter(r=>r.v>=sa),deepest=flood.length?Math.max(...flood.map(r=>EF().target-r.v)):0;
  $("plan").innerHTML=`<b class="flood">Flood ${flood.length}</b>${flood.length?` · deepest −${fmtNum(deepest)}`:""} &nbsp;·&nbsp; <b class="shave">Shave ${shave.length}</b>`;
  const base=baselineSession(),tl=$("trendline");
  if(base){let thinner=0,thicker=0,sumd=0,nd=0;for(const r of rows){const bv=base.data[keyOf({x:r.x,y:r.y})];if(bv!=null){const dd=r.v-decOf.get(bv);sumd+=dd;nd++;if(dd<-1e-9)thinner++;else if(dd>1e-9)thicker++;}}
    if(nd){tl.classList.add("on");tl.innerHTML=`vs ${fmtDate(base.date)}: avg <b>${fmtDelta(sumd/nd)}</b> · ${thinner} thinner, ${thicker} thicker`;}else tl.classList.remove("on");}else tl.classList.remove("on");
  let html="";flood.sort((a,b)=>a.v-b.v).forEach(r=>{html+=`<li><span class="pip" style="background:${bandOf(r.v).color}"></span><span class="z">${r.zone}</span><span class="t">flood · ${fmtLabel(r.lab)}</span></li>`;});
  shave.sort((a,b)=>b.v-a.v).forEach(r=>{html+=`<li><span class="pip" style="background:${bandOf(r.v).color}"></span><span class="z">${r.zone}</span><span class="t">shave · ${fmtLabel(r.lab)}</span></li>`;});
  $("todo").innerHTML=html||'<li class="empty">All logged points are in range. Nice sheet.</li>';}
const attFlood=()=>EF().tieAttention?EF().edges[1]:EF().floodBelow, attShave=()=>EF().tieAttention?EF().edges[2]:EF().shaveAbove;
function setTag(el,r){if(!r){el.textContent="—";el.style.background="transparent";el.style.color="";return;}const b=bandOf(r.v);el.textContent=fmtLabel(r.lab);el.style.background=b.color;el.style.color=(b.key==="ideal"||b.key==="low")?"#0d1620":"#fff";}

/* ---------- views ---------- */
function setView(v){if(v!=="map"&&v!=="trend")v="map";   // a saved 3D view, which no longer exists, opens on the map
  viewMode=v;if(state){state.lastView=v;persist();}$("mapModeRow").style.display=v==="map"?"flex":"none";syncMapMode();
  $("contourBar").style.display=v==="map"?"flex":"none";$("smoothBar").style.display=v==="map"?"flex":"none";buildLegend();buildSessSel();
  drawLive();renderStats();updateContourReadout();updateSmoothReadout();}

function syncMapMode(){const lo=mapMode()==="lowest";$("mmColor").setAttribute("aria-pressed",String(!lo));$("mmLowest").setAttribute("aria-pressed",String(lo));}
function setMapMode(m){state.mapMode=m;persist();syncMapMode();buildLegend();drawLive();}
$("mmColor").addEventListener("click",()=>setMapMode("color"));$("mmLowest").addEventListener("click",()=>setMapMode("lowest"));
function updateContourReadout(){const on=state.contoursOn??true;if(!on){$("contourCount").textContent="off";return;}const step=CONTOUR_STEPS[state.contourIdx??2],n=contourLevels().length;$("contourCount").textContent="every "+fmtSet(step)+(n?` · ${n} lines`:" · flat");}
$("contourSlider").addEventListener("input",e=>{state.contourIdx=+e.target.value;persist();if(viewMode==="map")drawLive();updateContourReadout();});
$("contourOn").addEventListener("change",e=>{state.contoursOn=e.target.checked;$("contourBar").classList.toggle("off",!e.target.checked);$("contourSlider").disabled=!e.target.checked;persist();if(viewMode==="map")drawLive();updateContourReadout();});
function updateSmoothReadout(){$("smoothCount").textContent=SMOOTH_LABELS[(state.smoothIdx!=null)?state.smoothIdx:2];}
$("smoothSlider").addEventListener("input",e=>{state.smoothIdx=+e.target.value;persist();computeField();computeDelta();drawLive();updateSmoothReadout();updateContourReadout();});

/* ---------- round controls ---------- */
$("sessSel").addEventListener("change",e=>{state.activeSession=e.target.value;compareId=null;clearUndo();selIdx=0;hideSel=false;applyGeometry(Records.sizeOf(sheet()),session().mode);computeField();computeDelta();buildSessSel();refresh();persist();});
/* Compare to is a choice on the Rink view: Nothing is the colour map, anything else draws each spot
   as the change since that round (the old Trend view, now an option rather than a separate mode). */
$("cmpSel").addEventListener("change",e=>{const v=e.target.value;if(v==="off"){compareId=null;setView("map");return;}
  compareId=v||null;computeDelta();setView("trend");});
$("expCsv").addEventListener("click",async()=>{const d=data(),nt=notes(),unitCol=isMM()?"thickness_mm":"thickness_in";let csv=`x_ft,y_ft,${unitCol},zone,note\n`;
  for(const k in d){const[x,y]=k.split(",");const dec=decOf.get(d[k]),val=isMM()?mmOf(dec).toFixed(2):dec;csv+=`${x},${y},${val},"${zoneOf({x:+x,y:+y})}","${(nt[k]||"").replace(/"/g,'""')}"\n`;}
  await exportFile(csv,"text/csv",fileStem()+".csv");});
/* content: string or Blob. Tries the native share sheet (so the file can go straight to
   email/AirDrop/Slack/etc) and falls back to a normal download if sharing isn't available,
   isn't supported for this file type, or the user backs out of a real share attempt. */
async function exportFile(content,mime,name){
  const blob=content instanceof Blob?content:new Blob([content],{type:mime});
  if(navigator.share&&navigator.canShare){
    const file=new File([blob],name,{type:mime});
    if(navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file],title:name});flashNote("shared");return"shared";}
      catch(err){if(err&&err.name==="AbortError"){flashNote("share canceled");return"cancelled";}}
    }
  }
  const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);
  flashNote("saved");return"downloaded";
}
const fileStem=()=>(facility().name+"_"+sheet().name+"_"+new Date(session().date).toISOString().slice(0,10)).replace(/\s+/g,"_");
function flashNote(m){const n=$("savedNote");n.textContent=m;setTimeout(()=>n.textContent="auto-saved",1800);}

/* ---------- PNG ---------- */
const renderToImage=W2=>{const c=document.createElement("canvas");c.width=W2;c.height=Math.round(W*(W2/L));renderScene(c.getContext("2d"),0,0,W2,{labels:true,sel:false,contours:true,trend:viewMode==="trend"});return c;};
$("expPng").addEventListener("click",()=>{const Wd=1760,Hd=980,pad=56,c=document.createElement("canvas");c.width=Wd;c.height=Hd;const x=c.getContext("2d");
  x.fillStyle="#0d1620";x.fillRect(0,0,Wd,Hd);x.fillStyle="#eaf3f8";x.font="800 30px system-ui,sans-serif";x.textAlign="left";x.textBaseline="alphabetic";
  x.fillText(facility().name+" — "+sheet().name+(viewMode==="trend"?" · TREND":""),pad,pad+18);x.fillStyle="#90a8b8";x.font="14px ui-monospace,Menlo,monospace";x.fillText(fmtDate(session().date),pad,pad+42);
  x.fillStyle="#6fd6ec";x.textAlign="right";x.fillText(Object.keys(data()).length+" / "+POINTS.length+" · target "+fmtSet(EF().target),Wd-pad,pad+42);x.textAlign="left";
  const rw=Wd-pad*2,ry=pad+78;renderScene(x,pad,ry,rw,{labels:true,sel:false,contours:true,trend:viewMode==="trend"});const rh=W*(rw/L);let lx=pad,ly=ry+rh+44;x.font="600 14px ui-monospace,Menlo,monospace";x.textBaseline="middle";
  if(viewMode==="trend"){x.fillStyle="#eaf3f8";x.fillText("Change vs "+(baselineSession()?fmtDate(baselineSession().date):"previous"),pad,ly);}else if(mapMode()==="lowest"){const sc=mapScale();if(sc)for(const[c,lab,rng]of[[LP_COLORS.red,"Lowest",fmtSet(sc.min)+" · "+spots(sc.nMin)],[LP_COLORS.green,"Ideal",fmtSet(EF().target)],[LP_COLORS.dblue,"Highest",fmtSet(sc.max)+" · "+spots(sc.nMax)]]){x.fillStyle=rgbCss(c);x.fillRect(lx,ly-9,18,18);x.strokeStyle="#ffffff22";x.strokeRect(lx,ly-9,18,18);x.fillStyle="#eaf3f8";x.fillText(lab,lx+26,ly-1);x.fillStyle="#90a8b8";x.fillText(rng,lx+26,ly+15);lx+=240;}}
  else for(const b of BANDS){x.fillStyle=b.color;x.fillRect(lx,ly-9,18,18);x.strokeStyle="#ffffff22";x.strokeRect(lx,ly-9,18,18);x.fillStyle="#eaf3f8";x.fillText(b.label,lx+26,ly-1);x.fillStyle="#90a8b8";x.fillText(b.rng,lx+26,ly+15);lx+=Math.max(180,x.measureText(b.label).width+96);}
  c.toBlob(blob=>{exportFile(blob,"image/png",fileStem()+".png");},"image/png");});

/* ---------- print ---------- */
$("expPdf").addEventListener("click",()=>{const img=renderToImage(2000).toDataURL("image/png"),d=data(),nt=notes(),rows=[];for(const k in d){const[x,y]=k.split(",").map(Number);rows.push({x,y,v:decOf.get(d[k])});}
  const avg=rows.length?fmtNum(rows.reduce((s,r)=>s+r.v,0)/rows.length):"—",fb=attFlood(),sa=attShave(),flood=rows.filter(r=>r.v<fb).length,shave=rows.filter(r=>r.v>=sa).length;
  const za=[[],[],[]];rows.forEach(r=>za[thirdOf(r.x)].push(r.v));const zt=a=>a.length?fmtNum(a.reduce((x,y)=>x+y,0)/a.length):'—';
  const pts=guidedOrder.map(gi=>{const p=POINTS[gi],k=keyOf(p),lab=d[k],v=lab!=null?decOf.get(lab):null,b=v!=null?bandOf(v):null,bold=!!b&&(b.key==="thin"||b.key==="thick");return{loc:zoneOf(p),reading:lab?fmtLabel(lab):"—",note:(nt[k]||""),bold};});
  const ncol=pts.length>26?3:2,per=Math.ceil(pts.length/ncol),tables=[];
  for(let c=0;c<ncol;c++){const chunk=pts.slice(c*per,(c+1)*per);if(!chunk.length)continue;
    tables.push(`<table><thead><tr><th>Location</th><th>Reading</th><th>Note</th></tr></thead><tbody>`+
      chunk.map(r=>`<tr><td>${r.loc}</td><td>${r.bold?`<strong>${r.reading}</strong>`:r.reading}</td><td>${r.note}</td></tr>`).join("")+`</tbody></table>`);}
  $("printRoot").innerHTML=`<h1>${facility().name} — Ice Thickness Report</h1>`+
    `<div class="pmeta">${sheet().name} · ${fmtDate(session().date)} · target ${fmtSet(EF().target)} · ${rows.length}/${POINTS.length} logged</div>`+
    `<img src="${img}" class="pmap" alt="thickness map">`+
    `<div class="pstat"><strong>Average</strong> ${avg} &nbsp;·&nbsp; <strong>Zones</strong> L ${zt(za[0])} / N ${zt(za[1])} / R ${zt(za[2])} &nbsp;·&nbsp; <strong>Flood</strong> ${flood} below ${fmtSet(fb)} &nbsp;·&nbsp; <strong>Shave</strong> ${shave} at/above ${fmtSet(sa)}</div>`+
    `<div class="ptables">${tables.join("")}</div>`;
  setTimeout(()=>window.print(),60);});

