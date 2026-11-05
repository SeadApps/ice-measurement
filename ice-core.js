"use strict";
/* ice-core.js: the model of an Ice page, with no page in it.

   The rink's geometry and the spots on it, the sixteen thickness labels and how they are
   written (inches or millimetres), the state and the accessors for the facility, sheet and
   round being looked at, the bands, how a change is saved, and the interpolation behind the
   map. Nothing here draws a page or reads an element, so every page of Ice (the Rink view,
   Trends, the Measurement builder, Preferences) can stand on it.

   It is moved out of ice.html unchanged, as D3's first step: a classic script, so the names
   it declares are the same globals the page's own script (and the tests) already use.
   Functions that DO touch the page stay in ice.html: undo, the theme and unit listeners,
   everything that draws. */

/* ---------- geometry (per-sheet rink size) ---------- */
const { RINK_SIZES, NHL_SIZE } = Records;
const MODES={full:{label:"Full",n:65},detailed:{label:"Detailed",n:39},moderate:{label:"Moderate",n:33},quick:{label:"Quick",n:19}};
let L=200,W=85,CORNER=28;
let GOAL1,GOAL2,FO_L,FO_R,BLUE1,BLUE2,CX,FO_T,FO_B,CY,LG_FO,L_FO_BL,R_BL_FO,R_FO_G,BC_L,BC_R,EDGE_B,EDGE_T;
let XS=[],YS=[],POINTS=[],idxByKey=new Map(),guidedOrder=[],xName=new Map(),yName=new Map();
const keyOf=p=>p.x+","+p.y;
const zoneOf=p=>`${xName.get(p.x)} · ${yName.get(p.y)}`;
const thirdOf=x=>x<BLUE1?0:x>BLUE2?2:1;
function pointsForMode(mode){const rows=[FO_B,CY,FO_T],raw=[];
  if(mode==="quick"){for(const x of [GOAL1,BLUE1,CX,BLUE2,GOAL2])for(const y of rows)raw.push({x,y});
    for(const x of [FO_L,FO_R])for(const y of [FO_B,FO_T])raw.push({x,y});}
  else{const cols=(mode==="detailed"||mode==="full")?[GOAL1,LG_FO,FO_L,L_FO_BL,BLUE1,BC_L,CX,BC_R,BLUE2,R_BL_FO,FO_R,R_FO_G,GOAL2]
    :[GOAL1,LG_FO,FO_L,L_FO_BL,BLUE1,CX,BLUE2,R_BL_FO,FO_R,R_FO_G,GOAL2];
    const useRows=mode==="full"?[EDGE_B,FO_B,CY,FO_T,EDGE_T]:rows;
    for(const x of cols)for(const y of useRows)raw.push({x,y});}
  // Snake order: columns left→right; even columns top→bottom, odd columns bottom→top.
  // Every advance lands on the physically adjacent spot, so the operator never
  // backtracks or crosses the sheet — faceoff columns are visited in sequence too.
  const xs=[...new Set(raw.map(p=>p.x))].sort((a,b)=>a-b),out=[];
  xs.forEach((x,ci)=>{const col=raw.filter(p=>p.x===x).sort((a,b)=>b.y-a.y);if(ci%2===1)col.reverse();out.push(...col);});
  return out;}
function applyGeometry(size,mode){
  size=size||NHL_SIZE();mode=mode||"moderate";const sx=size.L/200, sy=size.W/85;
  L=size.L; W=size.W; CORNER=size.corner;
  GOAL1=11*sx; GOAL2=size.L-11*sx; BLUE1=75*sx; BLUE2=size.L-75*sx; CX=size.L/2;
  FO_L=40*sx; FO_R=size.L-40*sx; FO_B=22*sy; FO_T=size.W-22*sy; CY=size.W/2;
  EDGE_B=Math.max(4,FO_B-15); EDGE_T=Math.min(size.W-4,FO_T+15); // rows tangent to top/bottom of the 15ft faceoff circles
  LG_FO=(GOAL1+FO_L)/2;L_FO_BL=(FO_L+BLUE1)/2;R_BL_FO=(BLUE2+FO_R)/2;R_FO_G=(FO_R+GOAL2)/2;BC_L=(BLUE1+CX)/2;BC_R=(CX+BLUE2)/2;
  XS=[GOAL1,LG_FO,FO_L,L_FO_BL,BLUE1,CX,BLUE2,R_BL_FO,FO_R,R_FO_G,GOAL2];YS=[FO_B,CY,FO_T];
  POINTS=pointsForMode(mode);
  idxByKey=new Map(POINTS.map((p,i)=>[keyOf(p),i]));
  xName=new Map([[GOAL1,"L goal line"],[LG_FO,"L goal–FO"],[FO_L,"L faceoff"],[L_FO_BL,"L FO–blue"],[BLUE1,"L blue line"],[BC_L,"L blue–center"],[CX,"Center"],[BC_R,"center–R blue"],[BLUE2,"R blue line"],[R_BL_FO,"R blue–FO"],[FO_R,"R faceoff"],[R_FO_G,"R FO–goal"],[GOAL2,"R goal line"]]);
  yName=new Map([[EDGE_B,"bottom edge"],[FO_B,"bottom"],[CY,"mid"],[FO_T,"top"],[EDGE_T,"top edge"]]);
  guidedOrder=POINTS.map((_,i)=>i); // POINTS is built in snake order, so guided = free = prev/next all follow the same path
}
applyGeometry();

/* ---------- thickness ---------- */
/* Every label a stored reading can carry. The 21 KEYS are what the builder offers (1/2" to 3" in
   eighths: a complete 3x7 or 7x3 grid). The rest are older readings that still display, colour the
   map and feed the field, but have no key of their own: 1/4", 3/8" and "2+" (counted as 2.1). */
const KEYS=['1/2"','5/8"','3/4"','7/8"','1"','1 1/8"','1 1/4"','1 3/8"','1 1/2"','1 5/8"','1 3/4"','1 7/8"','2"','2 1/8"','2 1/4"','2 3/8"','2 1/2"','2 5/8"','2 3/4"','2 7/8"','3"'];
const OPTIONS=['1/4"','3/8"'].concat(KEYS,['2+"']);
function parseFrac(f){f=f.replace(/"/g,'').trim();if(f==="2+")return 2.1;
  if(f.includes(" ")){const[w,fr]=f.split(" ");const[n,d]=fr.split("/");return +w+(+n)/(+d);}
  if(f.includes("/")){const[n,d]=f.split("/");return (+n)/(+d);}return +f;}
const decOf=new Map(OPTIONS.map(o=>[o,parseFrac(o)]));
function labelOf(v){let best=OPTIONS[0],bd=1e9;for(const o of OPTIONS){const d=Math.abs(decOf.get(o)-v);if(d<bd){bd=d;best=o;}}return best;}
function fr(v){const n=Math.round(v*16),whole=Math.floor(n/16);let rem=n-whole*16;if(rem===0)return whole+'″';
  let num=rem,den=16;while(num%2===0&&den%2===0){num/=2;den/=2;}return (whole?whole+' ':'')+num+'/'+den+'″';}
const frClean=s=>String(s).replace(/"/g,'″');   // a reading is a label; String() so an odd record cannot throw while drawing
const deltaStr=d=>(d>0?'+':d<0?'−':'±')+Math.abs(d).toFixed(2)+'″';

/* ---------- unit display (storage stays decimal inches; these format for display only) ---------- */
const mmOf=v=>v*25.4;
const isMM=()=>state&&state.unit==="mm";
function fmtSet(v){return isMM()?mmOf(v).toFixed(1)+" mm":fr(v);} // exact set-points: target, edges, contour steps
function fmtNum(v){return isMM()?mmOf(v).toFixed(1)+" mm":v.toFixed(2)+'″';} // computed stats: averages, deltas magnitude
function fmtNumHTML(v){return isMM()?mmOf(v).toFixed(1)+'<small> mm</small>':v.toFixed(2)+'<small>″</small>';}
function fmtLabel(lab){return isMM()?mmOf(decOf.get(lab)).toFixed(1)+" mm":frClean(lab);} // stored per-point reading
function fmtLabelShort(lab){return fmtLabel(lab).replace(/\s*(″|mm)$/,'');} // compact, for canvas dot labels
function fmtDelta(d){if(isMM()){const m=mmOf(d);return (m>0?'+':m<0?'−':'±')+Math.abs(m).toFixed(1)+" mm";}return deltaStr(d);}

/* ---------- state ---------- */
const KEY="ice_sheet_v3",V2="ice_sheet_v2",V1="ice_sheet_v1";
const { DEFAULT_EDGES } = Records;
let state=null,compareId=null;
const css=getComputedStyle(document.documentElement);
const BAND_META=[{key:"thin",c:"#d6453f",label:"Too thin"},{key:"low",c:"#e8b54a",label:"Thin"},{key:"ideal",c:"#eef4f6",label:"Ideal"},{key:"high",c:"#6aa9d6",label:"Thick"},{key:"thick",c:"#2c6aa3",label:"Too thick"}];
let BANDS=[],BAND_RGB=[];
const rgbOf=h=>{h=h.replace("#","");return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];};
function buildBands(){const e=EF().edges,lts=[e[0],e[1],e[2],e[3],Infinity];
  const rngs=["< "+fmtSet(e[0]),fmtSet(e[0])+"–"+fmtSet(e[1]),"≈ "+fmtSet(EF().target),fmtSet(e[2])+"–"+fmtSet(e[3]),fmtSet(e[3])+" +"];
  BANDS=BAND_META.map((m,i)=>({...m,lt:lts[i],color:m.c,rng:rngs[i]}));BAND_RGB=BANDS.map(b=>rgbOf(b.color));}
const bandOf=v=>{for(const b of BANDS)if(v<b.lt)return b;return BANDS[BANDS.length-1];};

/* Shapes come from the store, so a rink added on the launcher is
   indistinguishable from one added here. */
const { uid, newSession, newSheet, defaultSettings, newFacility } = Records;
function freshState(){const f=newFacility();return{theme:"dark",unit:"in",lastBackup:null,contourIdx:2,contoursOn:true,smoothIdx:2,overdueDays:7,facilities:[f],activeFacility:f.id,activeSheet:f.sheets[0].id,activeSession:f.sheets[0].sessions[0].id};}

const facility=()=>state.facilities.find(f=>f.id===state.activeFacility)||state.facilities[0];
const S=()=>facility().settings;
/* What the settings mean once migrated, read-only. Every page reads through this, so a device that
   has not migrated a facility (Staff may not write one) classifies exactly like one that has. */
const EF=()=>Records.settingsOf(S(),state);
/* A stepper never writes one new number beside three old ones: the first real edit of a facility
   that has not been migrated brings all its settings across, then applies the change. */
const editSettings=()=>{Records.upgradeSettings(S(),state);return S();};
const sheet=()=>{const f=facility();return f.sheets.find(s=>s.id===state.activeSheet)||f.sheets[0];};
const session=()=>{const sh=sheet();return sh.sessions.find(s=>s.id===state.activeSession)||sh.sessions[0];};
const data=()=>session().data, notes=()=>session().notes;
function baselineSession(){const sh=sheet();if(compareId){const s=sh.sessions.find(s=>s.id===compareId);if(s)return s;}
  const ord=[...sh.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date));const ai=ord.findIndex(s=>s.id===session().id);return ord[ai+1]||null;}

/* ---------- persistence ----------
   The record store moved to records.js, which the launcher shares. What that
   buys is one copy of the merge rule and one copy of "overdue", instead of
   this file's and a second in the launcher that only a comment kept in step.
   ARCHITECTURE.md still explains the model; `state` here is unchanged. */
const { Store, Repo, decompose, nowISO } = Records;

const SYNC=(typeof Sync!=="undefined")?Sync:null;   // absent if sync.js failed to load; the app still works locally
let saveTimer=null;const persist=()=>{clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{Repo.save(state);if(SYNC)SYNC.nudge();if(typeof Shell!=="undefined"&&state.facilities&&state.facilities.length)Shell.setAddress(facility().id,sheet().id);},180);};

/* ---------- interpolation ---------- */
const NX=150,NY=64;const SMOOTH_STEPS=[1.6,2.0,2.4,3.0,3.8,5.0],SMOOTH_LABELS=["very soft","soft","balanced","crisp","sharp","hard edges"];const POW=()=>SMOOTH_STEPS[(state&&state.smoothIdx!=null)?state.smoothIdx:2];let field=null,deltaField=null;
function anchors(v){const a=[],s=8;for(let x=0;x<=L;x+=s){a.push({x,y:0,v});a.push({x,y:W,v});}for(let y=s;y<W;y+=s){a.push({x:0,y,v});a.push({x:L,y,v});}return a;}
function idw(samples,fallback){const out=new Float32Array(NX*NY),pw=POW();
  for(let j=0;j<NY;j++){const fy=(j+0.5)/NY*W;for(let i=0;i<NX;i++){const fx=(i+0.5)/NX*L;let num=0,den=0,hit=null;
    for(let p=0;p<samples.length;p++){const dx=fx-samples[p].x,dy=fy-samples[p].y,d2=dx*dx+dy*dy;if(d2<0.25){hit=samples[p].v;break;}const w=1/Math.pow(d2,pw/2);num+=w*samples[p].v;den+=w;}
    out[i+j*NX]=hit!=null?hit:(den?num/den:fallback);}}return out;}
function computeField(){const pts=[],d=data();for(const k in d){const[x,y]=k.split(",").map(Number);pts.push({x,y,v:decOf.get(d[k])});}field=idw(pts.concat(anchors(EF().target)),EF().target);}
function computeDelta(){const base=baselineSession();if(!base){deltaField=null;return;}const cur=data(),bd=base.data,pts=[];
  for(const k in cur){if(bd[k]!=null){const[x,y]=k.split(",").map(Number);pts.push({x,y,v:decOf.get(cur[k])-decOf.get(bd[k])});}}deltaField=pts.length?idw(pts.concat(anchors(0)),0):null;}


/* ---------- map colours ----------
   Two ways to colour the map, chosen on the Rink view.

   COLOR MAP, the default: the same colours and ranges as ever, with the colour blending into the
   next band over the last MAP_BLEND inches of thickness below each edge, so it no longer jumps at
   an edge. A reading sits on its band, not in a blend (the sixteen labels are eighths and the span is
   a sixteenth), so every reading is still exactly its band's colour. A span of zero is the old hard
   edges, pixel for pixel, which is how the change is tested.

   LOWEST POINT: the scale comes from the round being viewed. The lowest recorded reading is red
   and the highest dark blue; between them yellow halfway up to ideal (the facility's target), green
   at ideal, light blue halfway from ideal to the highest. Only recorded readings count, not the
   interpolated field. With nothing below ideal there is nothing to colour red or yellow, so the scale
   starts at green at the lowest reading, and the same on the other side. */
let MAP_BLEND=1/16;
const mixRGB=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
function colorFor(v){let bi=BANDS.length-1;for(let b=0;b<BANDS.length;b++){if(v<BANDS[b].lt){bi=b;break;}}
  const next=bi+1<BANDS.length?BAND_RGB[bi+1]:null,e=BANDS[bi].lt;
  if(MAP_BLEND>0&&next&&isFinite(e)&&v>=e-MAP_BLEND)return mixRGB(BAND_RGB[bi],next,(v-(e-MAP_BLEND))/MAP_BLEND);
  return BAND_RGB[bi];}
const LP_COLORS={red:[214,69,63],yellow:[232,181,74],green:[74,176,112],lblue:[106,169,214],dblue:[44,106,163]};
function lowestScale(vals,target){
  vals=vals.filter(v=>isFinite(v));if(!vals.length)return null;
  let min=Infinity,max=-Infinity,nMin=0,nMax=0;
  for(const v of vals){if(v<min)min=v;if(v>max)max=v;}
  for(const v of vals){if(v===min)nMin++;if(v===max)nMax++;}
  const C=LP_COLORS;let stops;
  if(max-min<1e-9)stops=[[min,min<target-1e-9?C.red:min>target+1e-9?C.dblue:C.green]];            // every reading the same
  else if(min>=target-1e-9)stops=[[min,C.green],[(min+max)/2,C.lblue],[max,C.dblue]];             // nothing below ideal
  else if(max<=target+1e-9)stops=[[min,C.red],[(min+max)/2,C.yellow],[max,C.green]];              // nothing above ideal
  else stops=[[min,C.red],[(min+target)/2,C.yellow],[target,C.green],[(target+max)/2,C.lblue],[max,C.dblue]];
  const last=stops[stops.length-1];
  const color=v=>{if(v<=stops[0][0])return stops[0][1];if(v>=last[0])return last[1];
    for(let i=1;i<stops.length;i++){const a=stops[i-1],b=stops[i];if(v<=b[0])return mixRGB(a[1],b[1],(v-a[0])/(b[0]-a[0]));}return last[1];};
  return {min,max,nMin,nMax,target,stops,color};}

/* ---------- Trends series ---------- */
/* The average thickness, round by round, for the whole sheet, one third of it (left end,
   neutral, right end) or one spot. Pure: it reads the rounds it is given and nothing else.
   sel is {kind:"sheet"}, {kind:"zone",third:0|1|2} or {kind:"spot",key:"x,y"}. A round with no
   reading in the selection is left out, and rounds come back oldest first. */
const ZONE_NAMES=["Left end","Neutral","Right end"];
function seriesOf(sessions,sel){
  sel=sel||{kind:"sheet"};
  const take=k=>{if(sel.kind==="spot")return k===sel.key;if(sel.kind==="zone")return thirdOf(+k.split(",")[0])===sel.third;return true;};
  return (sessions||[]).map(s=>{const v=[];for(const k in s.data){if(take(k)){const d=decOf.get(s.data[k]);if(d!==undefined)v.push(d);}}
      return v.length?{s,st:{avg:v.reduce((a,b)=>a+b,0)/v.length,n:v.length}}:null;})
    .filter(Boolean).sort((a,b)=>new Date(a.s.date)-new Date(b.s.date));}
