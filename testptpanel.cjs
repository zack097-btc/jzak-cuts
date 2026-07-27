/* The Point Editor dock panel. The node engine was already proven by
   testnode.cjs; this drives the CONTROLS the user actually has to click, and
   checks the hard one: Simplify must throw away points without turning a
   traced curve into a polygon or bending a straight edge. */
const {chromium} = require('playwright');
(async () => {
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1500,height:950}});
const errs=[]; p.on('pageerror', e=>errs.push(String(e)));
const dialogs=[]; p.on('dialog', d=>{dialogs.push(d.message()); d.accept();});
await p.goto('file:///home/claude/jzak-cuts/index.html');
await p.waitForTimeout(500);

const R = await p.evaluate(async () => {
  localStorage.clear(); state.objects=[]; state.selIds=[];
  const out={}, wait=ms=>new Promise(r=>setTimeout(r,ms));

  /* a circle sampled densely: 220 points describing a shape a good editor
     should be able to hold in a couple dozen */
  const N=220,ring=[];
  for(let i=0;i<=N;i++){const a=i/N*Math.PI*2;ring.push([2+Math.cos(a),2+Math.sin(a)]);}
  const o=addObject([ring],"circle",2);
  setTool("node"); await wait(60);

  /* 1. the panel is on screen and a point is pre-selected */
  out.panelShown=getComputedStyle($("panelNode")).display!=="none";
  out.autoSel=!!nodeSel;
  out.who=$("ndWho").textContent;
  out.stats=$("ndStats").textContent;

  /* 2. stepping wraps and the coordinate boxes follow */
  const y0=$("ndY").value;
  $("ndNext").click(); draw();
  out.stepped = ndIndex()===2 && $("ndWho").textContent==="point 2 of 220" && $("ndY").value!==y0;
  $("ndPrev").click(); draw();
  out.steppedBack = ndIndex()===1 && $("ndY").value===y0;
  /* stepping back off the first point wraps to the last, not off the end */
  $("ndPrev").click(); draw(); out.wrapped=ndIndex()===220;
  $("ndNext").click(); draw();

  /* 3. typing a coordinate moves that point, in inches on the mat */
  const f=objFwd(o), before=f(o.nodes[0].pts[0].x,o.nodes[0].pts[0].y);
  $("ndX").value=(before[0]+0.5).toFixed(3); $("ndX").onchange();
  const after=objFwd(selected())(selected().nodes[0].pts[0].x,selected().nodes[0].pts[0].y);
  out.movedBy=+(after[0]-before[0]).toFixed(3);

  /* 4. corner <-> smooth from the panel */
  $("ndSmooth").click(); out.nowSmooth=!!ndPt().sm && !!ndPt().hIn && !!ndPt().hOut;
  $("ndCorner").click(); out.nowCorner=!ndPt().sm;

  /* 5. add / delete */
  const n0=ndTotal(); $("ndAdd").click(); const n1=ndTotal(); $("ndDel").click();
  out.added=n1-n0; out.deleted=n1-ndTotal();

  /* 6. break / close / reverse */
  out.wasClosed=ndSub().closed;
  $("ndBreak").click(); out.openedByBreak=!ndSub().closed;
  $("ndClose").click(); out.reclosed=ndSub().closed;
  const firstX=ndSub().pts[0].x; $("ndReverse").click();
  out.reversed=ndSub().pts[ndSub().pts.length-1].x===firstX;
  $("ndReverse").click();

  /* 7. whole-path smoothing */
  $("ndSmoothAll").click();
  out.allSmooth=ndSub().pts.every(q=>q.hIn&&q.hOut);
  $("ndCornerAll").click();
  out.allCorner=ndSub().pts.every(q=>!q.hIn&&!q.hOut);

  /* ---- 8. SIMPLIFY on a real circle: far fewer points, still round ---- */
  state.objects=[]; state.selIds=[];
  const ring2=[];for(let i=0;i<=N;i++){const a=i/N*Math.PI*2;ring2.push([2+Math.cos(a),2+Math.sin(a)]);}
  const c=addObject([ring2],"circle2",2); setTool("node"); await wait(30);
  const cBefore=ndTotal();
  $("ndTol").value="12"; ndTolIn();
  $("ndSimpAll").click();
  const cAfter=ndTotal();
  out.circleBefore=cBefore; out.circleAfter=cAfter;
  /* measure the FLATTENED result against the true circle, in object units */
  const dev=poly=>{let mx=0;for(const [x,y] of poly){const d=Math.abs(Math.hypot(x-2,y-2)-1);if(d>mx)mx=d;}return mx;};
  out.circleMaxDev=+dev(selected().subpaths[0]).toFixed(4);
  out.circleCurved=selected().nodes[0].pts.filter(q=>q.hOut).length;

  /* ---- 9. SIMPLIFY on a rectangle: corners stay sharp, edges stay dead straight ---- */
  state.objects=[]; state.selIds=[];
  const rect=[];
  const push=(ax,ay,bx,by)=>{for(let i=0;i<40;i++)rect.push([ax+(bx-ax)*i/40,ay+(by-ay)*i/40]);};
  push(0,0,4,0);push(4,0,4,3);push(4,3,0,3);push(0,3,0,0);rect.push([0,0]);
  addObject([rect],"rect",3); setTool("node"); await wait(30);
  const rBefore=ndTotal();
  $("ndTol").value="20"; ndTolIn();
  $("ndSimpAll").click();
  out.rectBefore=rBefore; out.rectAfter=ndTotal();
  /* every flattened point must sit on one of the four true edges */
  const E=[[[0,0],[4,0]],[[4,0],[4,3]],[[4,3],[0,3]],[[0,3],[0,0]]];
  const sd=(q,a,d)=>{const vx=d[0]-a[0],vy=d[1]-a[1],wx=q[0]-a[0],wy=q[1]-a[1],L2=vx*vx+vy*vy;
    let t=L2?(wx*vx+wy*vy)/L2:0;t=Math.max(0,Math.min(1,t));
    return Math.hypot(q[0]-(a[0]+vx*t),q[1]-(a[1]+vy*t));};
  let mx=0;for(const q of selected().subpaths[0]){const d=Math.min(...E.map(e=>sd(q,e[0],e[1])));if(d>mx)mx=d;}
  out.rectMaxDev=+mx.toFixed(4);
  out.rectStraight=selected().nodes[0].pts.filter(q=>q.hOut).length;  /* want 0 handles */

  /* 10. simplify is a single undo step */
  const n=ndTotal(); undo(); setTool("node"); out.undoRestored=ndTotal()>n;
  return out;
});
console.log(JSON.stringify(R,null,1));
console.log('dialogs:',dialogs);
console.log('errors:',errs);
const ok = R.panelShown && R.autoSel && /point 1 of/.test(R.who) && /points/.test(R.stats) &&
           R.stepped && R.steppedBack && R.wrapped && Math.abs(R.movedBy-0.5)<0.01 &&
           R.nowSmooth && R.nowCorner && R.added===1 && R.deleted===1 &&
           R.wasClosed && R.openedByBreak && R.reclosed && R.reversed &&
           R.allSmooth && R.allCorner &&
           R.circleAfter<=32 && R.circleAfter<R.circleBefore/4 && R.circleMaxDev<0.02 && R.circleCurved>=4 &&
           R.rectAfter<=8 && R.rectMaxDev<0.01 && R.rectStraight===0 &&
           R.undoRestored && !dialogs.length && !errs.length;
console.log(ok?'POINT EDITOR PANEL CHECKS PASSED':'FAILED');
await b.close(); process.exit(ok?0:1);
})();
