/* Stage 5 — weld / shape algebra / offset contours.
   Every check is measured against the analytic answer (real areas, real
   bounding boxes) rather than "it didn't crash", because these paths become
   blade paths on real vinyl. */
const {chromium}=require('playwright');

(async()=>{
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1500,height:950}});
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
let lastDialog=null;
p.on('dialog',async d=>{lastDialog=d.message();await d.dismiss();});
await p.goto('file:///home/claude/jzak-cuts/index.html');
await p.waitForTimeout(2600);

await p.evaluate(()=>{
  /* a clean mat of plain rectangles: [w,h,x,y,rot] */
  window.scene=(specs)=>{
    state.objects=[];state.selIds=[];state.selId=null;
    for(const [w,h,x,y,rot] of specs){
      const o=addObject([[[0,0],[w,0],[w,h],[0,h],[0,0]]],"r"+state.objects.length,h);
      o.width=w;o.height=h;o.posX=x;o.posY=y;o.rotation=rot||0;o.mirror=false;
    }
    setTool("select");view.zoom=1;view.panx=0;view.pany=0;updZoom();
    setSel([]);histReset();draw();
    return state.objects.map(o=>o.id);
  };
  /* net enclosed area of a piece as it sits on the mat: outer rings add,
     holes (opposite winding) subtract — exactly what the blade encloses. */
  window.netArea=(o)=>{let t=0;
    for(const L of objPolylines(o)){let a=0;
      for(let i=0;i<L.length-1;i++)a+=L[i][0]*L[i+1][1]-L[i+1][0]*L[i][1];
      t+=a/2;}
    return Math.abs(t);};
  window.ringCount=(o)=>o.subpaths.length;
  window.wb=(o)=>{const a=objAABB(o);return [+a.minX.toFixed(4),+a.minY.toFixed(4),+a.maxX.toFixed(4),+a.maxY.toFixed(4)];};
});

const R={};
const ev=(fn,arg)=>p.evaluate(fn,arg);
const near=(a,b,t)=>Math.abs(a-b)<=(t===undefined?1e-4:t);

/* ---------- 1. weld two overlapping squares ---------- */
R.weldTwo = await ev(()=>{
  const ids=scene([[2,2,1,1,0],[2,2,2,2,0]]);setSel(ids);
  boolSel("union");
  const o=state.objects[0];
  /* two 2x2 squares overlapping on a 1x1 corner => 8 - 1 = 7 sq in */
  return {one:state.objects.length===1, area:Math.abs(netArea(o)-7)<1e-4,
          rings:ringCount(o)===1, box:JSON.stringify(wb(o))==="[1,1,4,4]",
          named:/welded/.test(o.name), selected:state.selIds.length===1&&state.selIds[0]===o.id};
});

/* ---------- 2. weld ONE object whose own subpaths overlap ----------
   this is the case that matters: script lettering arrives as a single object
   with overlapping letters. */
R.weldSelfOverlap = await ev(()=>{
  state.objects=[];const o=addObject([
    [[0,0],[2,0],[2,2],[0,2],[0,0]],
    [[1,1],[3,1],[3,3],[1,3],[1,1]]],"script",2);
  o.posX=1;o.posY=1;o.width=3;o.height=3;setSel([o.id]);histReset();
  boolSel("union");
  const r=state.objects[0];
  return {one:state.objects.length===1, rings:ringCount(r)===1, area:Math.abs(netArea(r)-7)<1e-3};
});

/* ---------- 3. weld pieces that do not touch keeps both outlines ---------- */
R.weldApart = await ev(()=>{
  const ids=scene([[1,1,1,1,0],[1,1,5,1,0]]);setSel(ids);boolSel("union");
  const o=state.objects[0];
  return state.objects.length===1 && ringCount(o)===2 && Math.abs(netArea(o)-2)<1e-4;
});

/* ---------- 4. subtract punches a real hole ---------- */
R.subtract = await ev(()=>{
  const ids=scene([[4,4,1,1,0],[2,2,2,2,0]]);setSel(ids);boolSel("subtract");
  const o=state.objects[0];
  /* 16 - 4 = 12, and the result must be two rings: outer + hole */
  return {one:state.objects.length===1, rings:ringCount(o)===2,
          area:Math.abs(netArea(o)-12)<1e-4, box:JSON.stringify(wb(o))==="[1,1,5,5]"};
});
/* subtract takes the BOTTOM piece and removes what is above it */
R.subtractUsesStackOrder = await ev(()=>{
  const ids=scene([[4,4,1,1,0],[2,2,2,2,0]]);setSel([ids[1],ids[0]]); /* selected front-first */
  boolSel("subtract");
  return Math.abs(netArea(state.objects[0])-12)<1e-4;
});

/* ---------- 5. intersect / exclude ---------- */
R.intersect = await ev(()=>{
  const ids=scene([[2,2,1,1,0],[2,2,2,2,0]]);setSel(ids);boolSel("intersect");
  const o=state.objects[0];
  return state.objects.length===1 && Math.abs(netArea(o)-1)<1e-4 && JSON.stringify(wb(o))==="[2,2,3,3]";
});
R.exclude = await ev(()=>{
  const ids=scene([[2,2,1,1,0],[2,2,2,2,0]]);setSel(ids);boolSel("exclude");
  const o=state.objects[0];
  /* union 7 minus the shared 1 = 6 */
  return state.objects.length===1 && Math.abs(netArea(o)-6)<1e-4;
});

/* ---------- 6. an impossible boolean changes nothing ---------- */
lastDialog=null;
R.intersectApart = await ev(()=>{
  const ids=scene([[1,1,1,1,0],[1,1,6,1,0]]);setSel(ids);
  const before=histUndo.length;
  boolSel("intersect");
  return state.objects.length===2 && histUndo.length===before;
});
await p.waitForTimeout(60);
R.intersectApartWarns = !!lastDialog && /overlap/i.test(lastDialog||"");

/* ---------- 7. undo puts the originals back ---------- */
R.weldUndo = await (async()=>{
  await ev(()=>{const ids=scene([[2,2,1,1,0],[2,2,2,2,0]]);setSel(ids);histReset();boolSel("union");});
  const one=await ev(()=>state.objects.length===1&&histUndo.length===1);
  await p.keyboard.press('Control+z');await p.waitForTimeout(80);
  const back=await ev(()=>state.objects.length===2&&Math.abs(netArea(state.objects[0])-4)<1e-6);
  return one&&back;
})();

/* ---------- 8. rotated input is welded by what is actually on the mat ---------- */
R.weldRotated = await ev(()=>{
  /* a 2x2 square turned 90 deg is still a 2x2 square in the same place */
  const ids=scene([[2,2,1,1,0],[2,2,2,2,90]]);setSel(ids);boolSel("union");
  const o=state.objects[0];
  return Math.abs(netArea(o)-7)<1e-3 && JSON.stringify(wb(o))==="[1,1,4,4]";
});

/* ---------- 9. outward offset — the sticker border ---------- */
R.offsetOut = await ev(()=>{
  const ids=scene([[2,2,2,2,0]]);setSel(ids);
  document.getElementById('offDist').value="0.25";
  document.getElementById('offJoin').value="round";
  offsetSel(1);
  const c=state.objects.find(o=>/contour/.test(o.name)),bx=wb(c);
  return {made:state.objects.length===2, box:JSON.stringify(bx)==="[1.75,1.75,4.25,4.25]",
          behind:state.objects.indexOf(c)===0,
          /* 2x2 grown by .25 all round with rounded corners:
             4 + perimeter*.25 + pi*.25^2 = 4 + 2 + 0.19635 */
          area:Math.abs(netArea(c)-(4+2+Math.PI*0.0625))<0.002,
          selected:state.selIds.length===1&&state.selIds[0]===c.id,
          originalIntact:Math.abs(netArea(state.objects[1])-4)<1e-9};
});

/* ---------- 10. sharp corners really are sharp ---------- */
R.offsetMiterSharp = await ev(()=>{
  const ids=scene([[2,2,2,2,0]]);setSel(ids);
  document.getElementById('offDist').value="0.25";
  document.getElementById('offJoin').value="miter";
  offsetSel(1);
  const c=state.objects.find(o=>/contour/.test(o.name));
  const hit=objPolylines(c)[0].some(([x,y])=>Math.abs(x-1.75)<1e-3&&Math.abs(y-1.75)<1e-3);
  /* a mitred 2x2 offset by .25 is an exact 2.5x2.5 square */
  return hit && Math.abs(netArea(c)-6.25)<1e-4;
});
R.offsetRoundIsRounded = await ev(()=>{
  const ids=scene([[2,2,2,2,0]]);setSel(ids);
  document.getElementById('offDist').value="0.25";
  document.getElementById('offJoin').value="round";
  offsetSel(1);
  const c=state.objects.find(o=>/contour/.test(o.name));
  /* no point may sit on the square corner, and the arc must be finely stepped */
  const pts=objPolylines(c)[0];
  const corner=pts.some(([x,y])=>Math.abs(x-1.75)<1e-3&&Math.abs(y-1.75)<1e-3);
  return !corner && pts.length>40;
});

/* ---------- 11. inward offset ---------- */
R.offsetIn = await ev(()=>{
  const ids=scene([[2,2,2,2,0]]);setSel(ids);
  document.getElementById('offDist').value="0.25";
  document.getElementById('offJoin').value="miter";
  offsetSel(-1);
  const c=state.objects.find(o=>/inline/.test(o.name));
  return state.objects.length===2 && Math.abs(netArea(c)-2.25)<1e-4 && JSON.stringify(wb(c))==="[2.25,2.25,3.75,3.75]";
});
lastDialog=null;
R.offsetInTooFar = await ev(()=>{
  const ids=scene([[2,2,2,2,0]]);setSel(ids);
  document.getElementById('offDist').value="3";
  const before=histUndo.length;
  offsetSel(-1);
  return state.objects.length===1 && histUndo.length===before;
});
await p.waitForTimeout(60);
R.offsetInTooFarWarns = !!lastDialog;

/* ---------- 12. one outline around a whole selection ---------- */
R.offsetMergedOne = await ev(()=>{
  /* two squares 0.3" apart — a 0.25" border on each closes the gap,
     so the merged contour must come back as a single ring */
  const ids=scene([[2,2,1,1,0],[2,2,3.3,1,0]]);setSel(ids);
  document.getElementById('offDist').value="0.25";
  document.getElementById('offJoin').value="miter";
  document.getElementById('offMerge').checked=true;
  offsetSel(1);
  const c=state.objects[0];
  return state.objects.length===3 && ringCount(c)===1 && JSON.stringify(wb(c))==="[0.75,0.75,5.55,3.25]";
});
R.offsetSeparate = await ev(()=>{
  const ids=scene([[2,2,1,1,0],[2,2,3.3,1,0]]);setSel(ids);
  document.getElementById('offDist').value="0.25";
  document.getElementById('offMerge').checked=false;
  offsetSel(1);
  return state.objects.length===4 && state.selIds.length===2;
});
R.offsetUndo = await (async()=>{
  await ev(()=>{const ids=scene([[2,2,1,1,0]]);setSel(ids);
    document.getElementById('offMerge').checked=true;
    document.getElementById('offDist').value="0.25";histReset();offsetSel(1);});
  const two=await ev(()=>state.objects.length===2&&histUndo.length===1);
  await p.keyboard.press('Control+z');await p.waitForTimeout(80);
  return two && await ev(()=>state.objects.length===1);
})();

/* ---------- 13. a hole survives an outward offset (it shrinks) ---------- */
R.offsetKeepsHole = await ev(()=>{
  state.objects=[];
  const o=addObject([[[0,0],[4,0],[4,4],[0,4],[0,0]],
                     [[1,1],[1,3],[3,3],[3,1],[1,1]]],"washer",4);
  o.posX=1;o.posY=1;o.width=4;o.height=4;setSel([o.id]);histReset();
  document.getElementById('offDist').value="0.25";
  document.getElementById('offJoin').value="miter";
  document.getElementById('offMerge').checked=true;
  offsetSel(1);
  const c=state.objects[0];
  /* outer 4x4 -> 4.5x4.5 = 20.25, inner 2x2 hole -> 1.5x1.5 = 2.25 */
  return ringCount(c)===2 && Math.abs(netArea(c)-18)<1e-3;
});

/* ---------- 14. buttons, menu actions and enable states ---------- */
R.buttonsWired = await (async()=>{
  await ev(()=>{const ids=scene([[2,2,1,1,0],[2,2,2,2,0]]);setSel(ids);histReset();});
  await p.click('#boolGrid button[data-bool="union"]');
  const welded=await ev(()=>state.objects.length===1);
  await ev(()=>{document.getElementById('offDist').value="0.1";document.getElementById('offJoin').value="miter";});
  await p.click('#offGrid button[data-off="out"]');
  const off=await ev(()=>state.objects.length===2);
  return welded&&off;
})();
R.enableStates = await ev(()=>{
  const ids=scene([[1,1,1,1,0],[1,1,4,1,0]]);
  setSel([ids[0]]);
  const u1=!document.querySelector('#boolGrid button[data-bool="union"]').disabled,
        s1=document.querySelector('#boolGrid button[data-bool="subtract"]').disabled,
        o1=!document.querySelector('#offGrid button[data-off="out"]').disabled;
  setSel(ids);
  const s2=!document.querySelector('#boolGrid button[data-bool="subtract"]').disabled;
  setSel([]);
  const u0=document.querySelector('#boolGrid button[data-bool="union"]').disabled,
        o0=document.querySelector('#offGrid button[data-off="out"]').disabled;
  return u1&&s1&&o1&&s2&&u0&&o0;
});
R.menuActs = await ev(()=>["weld","subtract","intersect","exclude","offsetout","offsetin"]
  .every(k=>typeof ACT[k]==="function" && document.querySelector('[data-act="'+k+'"]')));

/* ---------- 15. the result is still a cuttable, editable piece ---------- */
R.stillCuts = await ev(()=>{
  const ids=scene([[2,2,1,1,0],[2,2,2,2,0]]);setSel(ids);boolSel("union");
  const h=generateHPGL();
  return /PU/.test(h)&&/PD/.test(h)&&h.length>40;
});
R.resultNodeEditable = await ev(()=>{
  const o=state.objects[0];ensureNodes(o);
  const ok=!!o.nodes&&o.nodes.length===1&&o.nodes[0].closed===true&&o.nodes[0].pts.length>3;
  o.nodes=null;return ok;});
R.resultResizes = await ev(()=>{
  const o=state.objects[0];o.width=objW(o)*2;o.height=o.height*2;
  const a=objAABB(o);return Math.abs(a.w-6)<1e-6&&Math.abs(a.h-6)<1e-6;});

/* ---------- 16. no offset distance typed ---------- */
lastDialog=null;
R.offsetNeedsDistance = await ev(()=>{
  const ids=scene([[2,2,1,1,0]]);setSel(ids);
  document.getElementById('offDist').value="0";
  const before=histUndo.length;offsetSel(1);
  return state.objects.length===1&&histUndo.length===before;
});
await p.waitForTimeout(60);
R.offsetNeedsDistanceWarns = !!lastDialog;

/* ---------- 17. precision: a 0.125" contour is 0.125" everywhere ---------- */
R.contourDistanceExact = await ev(()=>{
  const ids=scene([[3,1.5,2,2,0]]);setSel(ids);
  document.getElementById('offDist').value="0.125";
  document.getElementById('offJoin').value="round";
  document.getElementById('offMerge').checked=true;
  offsetSel(1);
  const c=state.objects.find(o=>/contour/.test(o.name)),pts=objPolylines(c)[0];
  /* every contour point must sit 0.125" from the source rectangle */
  const x0=2,y0=2,x1=5,y1=3.5;
  let worst=0;
  for(const [x,y] of pts){
    const dx=Math.max(x0-x,0,x-x1),dy=Math.max(y0-y,0,y-y1);
    worst=Math.max(worst,Math.abs(Math.hypot(dx,dy)-0.125));}
  return {worst:+worst.toFixed(5), ok:worst<0.0006};
});

R.errors = errs;
console.log(JSON.stringify(R,null,1));
const flat=[];
const walk=(o,pre)=>{for(const [k,v] of Object.entries(o)){
  if(v===false)flat.push(pre+k);
  else if(v&&typeof v==='object'&&!Array.isArray(v))walk(v,pre+k+'.');}};
walk(R,'');
if(errs.length)flat.push('JS ERRORS');
console.log(flat.length? '*** FAILED: '+flat.join(', ') : 'ALL WELD / SHAPE / OFFSET CHECKS PASSED');
await b.close();
process.exit(flat.length?1:0);
})();
