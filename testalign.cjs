/* Stage 4 — multi-select, align, distribute, arrange.
   Real mouse drags for every gesture so hit-testing, group math and the
   undo integration are exercised the way a user exercises them. */
const {chromium}=require('playwright');
const near=(a,b,t)=>Math.abs(a-b)<=(t===undefined?0.02:t);

(async()=>{
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1500,height:950}});
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('file:///home/claude/jzak-cuts/index.html');
await p.waitForTimeout(2600);

await p.evaluate(()=>{
  window.W2C=(wx,wy)=>{const L=layout(),ppi=L.base*view.zoom,ox=RL+MG+view.panx,oy=RT+MG+view.pany,
    r=document.getElementById('cv').getBoundingClientRect();
    return {x:r.left+ox+wx*ppi, y:r.top+oy+wy*ppi};};
  /* build a clean mat of plain rectangles: [w,h,x,y,rot] */
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
  window.aabbs=()=>state.objects.map(o=>{const a=objAABB(o);
    return {n:o.name,x:+a.minX.toFixed(3),y:+a.minY.toFixed(3),X:+a.maxX.toFixed(3),Y:+a.maxY.toFixed(3),
            cx:+a.cx.toFixed(3),cy:+a.cy.toFixed(3),w:+a.w.toFixed(3),h:+a.h.toFixed(3)};});
  window.order=()=>state.objects.map(o=>o.name).join(",");
});

const R={};
const scene=specs=>p.evaluate(s=>scene(s),specs);
const aabbs=()=>p.evaluate(()=>aabbs());
const drag=async(from,to,steps)=>{
  const a=await p.evaluate(([x,y])=>W2C(x,y),from);
  const c=await p.evaluate(([x,y])=>W2C(x,y),to);
  await p.mouse.move(a.x,a.y);await p.mouse.down();
  const n=steps||8;for(let i=1;i<=n;i++)await p.mouse.move(a.x+(c.x-a.x)*i/n,a.y+(c.y-a.y)*i/n);
  await p.mouse.up();await p.waitForTimeout(40);
};

/* ---------- 1. objAABB / selBBox geometry ---------- */
R.aabb0 = await p.evaluate(()=>{
  scene([[4,2,3,5,0]]);const a=objAABB(state.objects[0]);
  return Math.abs(a.minX-3)<1e-9&&Math.abs(a.minY-5)<1e-9&&Math.abs(a.maxX-7)<1e-9&&Math.abs(a.maxY-7)<1e-9;
});
R.aabb90 = await p.evaluate(()=>{
  /* a 4x2 turned 90 deg occupies a 2x4 footprint centred on the same point */
  scene([[4,2,3,5,90]]);const a=objAABB(state.objects[0]);
  return Math.abs(a.w-2)<1e-6&&Math.abs(a.h-4)<1e-6&&Math.abs(a.cx-5)<1e-6&&Math.abs(a.cy-6)<1e-6;
});
R.selBBoxUnion = await p.evaluate(()=>{
  const ids=scene([[2,1,1,1,0],[3,2,6,4,0]]);setSel(ids);const g=selBBox();
  return Math.abs(g.minX-1)<1e-9&&Math.abs(g.minY-1)<1e-9&&Math.abs(g.maxX-9)<1e-9&&Math.abs(g.maxY-6)<1e-9;
});
R.selBBoxNullWhenEmpty = await p.evaluate(()=>{scene([[2,1,1,1,0]]);setSel([]);return selBBox()===null;});

/* ---------- 2. align, several pieces to each other ---------- */
const AL=async mode=>{
  await p.evaluate(m=>{const ids=scene([[2,1,1,1,0],[3,2,6,4,0],[1,4,11,2,0]]);setSel(ids);alignSel(m);},mode);
  return await aabbs();
};
{
  const a=await AL('left');   R.alignLeft   = a.every(o=>near(o.x,1));
  const b2=await AL('right'); R.alignRight  = b2.every(o=>near(o.X,12));
  const c=await AL('hcenter');R.alignHCenter= c.every(o=>near(o.cx,c[0].cx));
  const d=await AL('top');    R.alignTop    = d.every(o=>near(o.y,1));
  const e=await AL('bottom'); R.alignBottom = e.every(o=>near(o.Y,6));
  const f=await AL('vcenter');R.alignVCenter= f.every(o=>near(o.cy,f[0].cy));
  /* aligning must never resize anything */
  R.alignKeepsSize = (await AL('left')).map(o=>o.w+'x'+o.h).join('|')==='2x1|3x2|1x4';
}

/* ---------- 3. a rotated piece aligns by the edge you can SEE ---------- */
R.alignRotated = await p.evaluate(()=>{
  const ids=scene([[4,2,1,1,0],[4,2,6,6,90]]);setSel(ids);alignSel("left");
  const a=objAABB(state.objects[1]);
  return Math.abs(a.minX-1)<0.001&&Math.abs(a.w-2)<0.001;   /* its 2" visual width, not its 4" design width */
});

/* ---------- 4. one piece selected aligns to the MAT ---------- */
R.alignToMat = await p.evaluate(()=>{
  scene([[4,2,7,9,0]]);setSel([state.objects[0].id]);
  alignSel("left");const l=objAABB(state.objects[0]).minX;
  alignSel("top");const t=objAABB(state.objects[0]).minY;
  alignSel("vcenter");const c=objAABB(state.objects[0]).cy,mid=layout().matW/2;
  return Math.abs(l)<1e-6&&Math.abs(t)<1e-6&&Math.abs(c-mid)<1e-6;
});

/* ---------- 5. distribute: even GAPS, outer two never move ---------- */
R.distributeH = await p.evaluate(()=>{
  const ids=scene([[2,1,0,1,0],[1,1,3,1,0],[3,1,5,1,0],[1,1,14,1,0]]);setSel(ids);distributeSel("h");
  const a=state.objects.map(o=>objAABB(o)).sort((x,y)=>x.minX-y.minX);
  const gaps=[];for(let i=1;i<a.length;i++)gaps.push(+(a[i].minX-a[i-1].maxX).toFixed(6));
  const even=gaps.every(g=>Math.abs(g-gaps[0])<1e-6);
  return {even,gaps,firstFixed:Math.abs(a[0].minX-0)<1e-6,lastFixed:Math.abs(a[a.length-1].maxX-15)<1e-6};
});
R.distributeV = await p.evaluate(()=>{
  const ids=scene([[1,2,1,0,0],[1,1,1,4,0],[1,3,1,9,0]]);setSel(ids);distributeSel("v");
  const a=state.objects.map(o=>objAABB(o)).sort((x,y)=>x.minY-y.minY);
  const g1=a[1].minY-a[0].maxY,g2=a[2].minY-a[1].maxY;
  return Math.abs(g1-g2)<1e-6&&Math.abs(a[0].minY)<1e-6&&Math.abs(a[2].maxY-12)<1e-6;
});
R.distributeNeeds3 = await p.evaluate(()=>{
  const ids=scene([[1,1,1,1,0],[1,1,9,1,0]]);setSel(ids);
  const b4=JSON.stringify(aabbs());distributeSel("h");return b4===JSON.stringify(aabbs());
});

/* ---------- 6. arrange / z-order ---------- */
R.arrange = await p.evaluate(()=>{
  const out={};
  const fresh=()=>scene([[1,1,1,1,0],[1,1,3,1,0],[1,1,5,1,0],[1,1,7,1,0]]);
  let ids=fresh();setSel([ids[0]]);arrangeSel("front");out.front=order()==="r1,r2,r3,r0";
  ids=fresh();setSel([ids[3]]);arrangeSel("back");out.back=order()==="r3,r0,r1,r2";
  ids=fresh();setSel([ids[1]]);arrangeSel("forward");out.forward=order()==="r0,r2,r1,r3";
  ids=fresh();setSel([ids[2]]);arrangeSel("backward");out.backward=order()==="r0,r2,r1,r3";
  ids=fresh();setSel([ids[0],ids[1]]);arrangeSel("front");out.multiFront=order()==="r2,r3,r0,r1";
  ids=fresh();setSel([ids[0],ids[1]]);arrangeSel("backward");out.clampAtEdge=order()==="r0,r1,r2,r3";
  ids=fresh();setSel([ids[3]]);arrangeSel("forward");out.frontStaysFront=order()==="r0,r1,r2,r3";
  return out;
});
/* the cut order follows the object order, so arrange really does change the output */
R.arrangeChangesCutOrder = await p.evaluate(()=>{
  const ids=scene([[1,1,1,1,0],[1,1,6,1,0]]);setSel([ids[0]]);
  const a=generateHPGL();arrangeSel("front");const b=generateHPGL();
  return a.length>10&&b.length>10&&a!==b;
});

/* ---------- 7. selection UI ---------- */
R.selUI = await p.evaluate(()=>{
  const ids=scene([[1,1,1,1,0],[1,1,4,1,0],[1,1,7,1,0]]);
  const dis=sel=>Array.from(document.querySelectorAll(sel)).every(b=>b.disabled);
  const en=sel=>Array.from(document.querySelectorAll(sel)).every(b=>!b.disabled);
  setSel([]);const o0=$("selCount").textContent, a0=dis("#alignGrid button");
  setSel([ids[0]]);const o1=$("selCount").textContent, a1=en("#alignGrid button"), d1=dis("#distGrid button");
  setSel(ids);const o3=$("selCount").textContent, d3=en("#distGrid button"), r3=en("#arrGrid button");
  return {empty:/Nothing/.test(o0)&&a0, one:/1 piece/.test(o1)&&a1&&d1, three:/3 pieces/.test(o3)&&d3&&r3};
});

/* ---------- 8. Ctrl+A / shift-click / clicking a member of a group ---------- */
await p.evaluate(()=>scene([[2,2,1,1,0],[2,2,5,1,0],[2,2,9,1,0]]));
await p.click('#cv');                                   /* focus, empty click clears */
await p.keyboard.press('Control+a');
R.ctrlA = await p.evaluate(()=>selIds().length===3);

await p.evaluate(()=>setSel([]));
{ const a=await p.evaluate(()=>W2C(2,2)); await p.mouse.click(a.x,a.y); }
R.clickSelectsOne = await p.evaluate(()=>selIds().length===1&&multiSel()===false);
{ const a=await p.evaluate(()=>W2C(6,2)); await p.keyboard.down('Shift'); await p.mouse.click(a.x,a.y); await p.keyboard.up('Shift'); }
R.shiftClickAdds = await p.evaluate(()=>selIds().length===2&&multiSel()===true);
{ const a=await p.evaluate(()=>W2C(6,2)); await p.keyboard.down('Shift'); await p.mouse.click(a.x,a.y); await p.keyboard.up('Shift'); }
R.shiftClickRemoves = await p.evaluate(()=>selIds().length===1);

/* ---------- 9. marquee ---------- */
await p.evaluate(()=>{scene([[2,2,1,1,0],[2,2,5,1,0],[2,2,9,1,0]]);setSel([]);});
await drag([0.2,0.2],[7.5,3.5]);
R.marqueeSelects = await p.evaluate(()=>selIds().length===2);
R.marqueeNoUndoStep = await p.evaluate(()=>histUndo.length===0);
await p.keyboard.down('Shift');await drag([8.5,0.2],[11.5,3.5]);await p.keyboard.up('Shift');
R.marqueeShiftAdds = await p.evaluate(()=>selIds().length===3);
await drag([13,8],[14,9]);
R.marqueeEmptyClears = await p.evaluate(()=>selIds().length===0);

/* ---------- 10. group move by dragging a member ---------- */
await p.evaluate(()=>{const ids=scene([[2,2,1,1,0],[2,2,5,1,0]]);setSel(ids);histReset();});
const beforeMove=await aabbs();
await drag([2,2],[5,4]);
const afterMove=await aabbs();
R.groupMove = afterMove.every((o,i)=>near(o.x,beforeMove[i].x+3)&&near(o.y,beforeMove[i].y+2));
R.groupMoveOneUndo = await p.evaluate(()=>histUndo.length===1);
await p.keyboard.press('Control+z');await p.waitForTimeout(80);
R.groupMoveUndo = JSON.stringify(await aabbs())===JSON.stringify(beforeMove);
R.groupStaysSelectedAfterUndo = await p.evaluate(()=>selIds().length===2);

/* ---------- 11. group scale from a corner handle ---------- */
R.groupScale = await (async()=>{
  await p.evaluate(()=>{const ids=scene([[2,2,2,2,0],[2,2,6,6,0]]);setSel(ids);histReset();});
  /* group box is (2,2)-(8,8). drag the BR corner out to double it -> anchor is TL (2,2) */
  await drag([8,8],[14,14]);
  return await p.evaluate(()=>{
    const g=selBBox(),a=objAABB(state.objects[0]),b=objAABB(state.objects[1]);
    return {anchorPinned:Math.abs(g.minX-2)<0.05&&Math.abs(g.minY-2)<0.05,
            doubled:Math.abs(g.w-12)<0.15&&Math.abs(g.h-12)<0.15,
            proportional:Math.abs(g.w-g.h)<0.02,
            eachDoubled:Math.abs(a.w-4)<0.06&&Math.abs(b.w-4)<0.06,
            spacingScaled:Math.abs((b.minX-a.minX)-8)<0.12,
            oneUndo:histUndo.length===1};
  });
})();
await p.keyboard.press('Control+z');await p.waitForTimeout(80);
R.groupScaleUndo = await p.evaluate(()=>{const g=selBBox();return Math.abs(g.w-6)<1e-6&&Math.abs(g.h-6)<1e-6;});

/* ---------- 12. group rotate from the knob ---------- */
R.groupRotate = await (async()=>{
  await p.evaluate(()=>{const ids=scene([[2,1,2,2,0],[2,1,6,2,0]]);setSel(ids);histReset();});
  const g0=await p.evaluate(()=>{const g=selBBox();return [g.cx,g.cy];});
  const knob=await p.evaluate(()=>{const L=layout(),ppi=L.base*view.zoom,g=selBBox();return groupRotHandle(g,ppi);});
  /* swing the knob from straight-up to straight-right => +90 deg */
  await drag(knob,[g0[0]+4,g0[1]]);
  return await p.evaluate(([cx,cy])=>{
    const r=state.objects.map(o=>+normDeg(o.rotation).toFixed(1)),g=selBBox();
    return {each90:r.every(v=>Math.abs(v-90)<1.5),
            centreHeld:Math.abs(g.cx-cx)<0.05&&Math.abs(g.cy-cy)<0.05,
            /* two 2x1 pieces side by side (6x1) stood on end become 1x6.
               the knob grabs at a whole pixel so the angle lands within ~1 deg,
               which widens the footprint a hair — hence the 0.15" window. */
            footprintSwapped:Math.abs(g.w-1)<0.15&&Math.abs(g.h-6)<0.15,
            oneUndo:histUndo.length===1,rot:r};
  },g0);
})();
R.groupRotateShiftSnap = await (async()=>{
  await p.evaluate(()=>{const ids=scene([[2,1,2,2,0],[2,1,6,2,0]]);setSel(ids);histReset();});
  const g0=await p.evaluate(()=>{const g=selBBox();return [g.cx,g.cy];});
  const knob=await p.evaluate(()=>{const L=layout(),ppi=L.base*view.zoom,g=selBBox();return groupRotHandle(g,ppi);});
  await p.keyboard.down('Shift');
  await drag(knob,[g0[0]+3.9,g0[1]-3.6]);      /* ~+47 deg -> must snap to 45 */
  await p.keyboard.up('Shift');
  return await p.evaluate(()=>state.objects.every(o=>Math.abs(normDeg(o.rotation)-45)<0.001));
})();
await p.keyboard.press('Control+z');await p.waitForTimeout(80);
R.groupRotateUndo = await p.evaluate(()=>state.objects.every(o=>Math.abs(o.rotation)<1e-9));

/* ---------- 13. keyboard on a whole selection ---------- */
await p.evaluate(()=>{const ids=scene([[2,2,1,1,0],[2,2,5,1,0],[2,2,9,1,0]]);setSel([ids[0],ids[1]]);histReset();});
await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowRight');
R.nudgeGroup = await p.evaluate(()=>{const a=aabbs();return Math.abs(a[0].x-1.1)<1e-6&&Math.abs(a[1].x-5.1)<1e-6&&Math.abs(a[2].x-9)<1e-6;});
R.nudgeCoalesced = await p.evaluate(()=>histUndo.length===1);
await p.keyboard.down('Shift');await p.keyboard.press('ArrowDown');await p.keyboard.up('Shift');
R.nudgeShiftBig = await p.evaluate(()=>Math.abs(aabbs()[0].y-1.5)<1e-6);

await p.evaluate(()=>{const ids=scene([[2,2,1,1,0],[2,2,5,1,0],[2,2,9,1,0]]);setSel([ids[0],ids[1]]);histReset();});
await p.keyboard.press('Control+d');
R.ctrlDMulti = await p.evaluate(()=>state.objects.length===5&&selIds().length===2);
await p.keyboard.press('Control+z');await p.waitForTimeout(60);
R.ctrlDUndo = await p.evaluate(()=>state.objects.length===3);

await p.evaluate(()=>{const ids=scene([[2,2,1,1,0],[2,2,5,1,0],[2,2,9,1,0]]);setSel([ids[0],ids[1]]);histReset();});
await p.keyboard.press('Control+c');await p.keyboard.press('Control+v');
R.copyPasteMulti = await p.evaluate(()=>state.objects.length===5&&selIds().length===2);

await p.evaluate(()=>{const ids=scene([[2,2,1,1,0],[2,2,5,1,0],[2,2,9,1,0]]);setSel([ids[0],ids[1]]);histReset();});
await p.keyboard.press('Delete');
R.deleteMulti = await p.evaluate(()=>state.objects.length===1&&state.objects[0].name==="r2");
await p.keyboard.press('Control+z');await p.waitForTimeout(60);
R.deleteMultiUndo = await p.evaluate(()=>state.objects.length===3);

await p.evaluate(()=>{const ids=scene([[1,1,1,1,0],[1,1,4,1,0],[1,1,7,1,0]]);setSel([ids[0]]);histReset();});
await p.keyboard.press('Control+]');
R.ctrlBracketForward = await p.evaluate(()=>order()==="r1,r0,r2");
await p.keyboard.press('Control+Shift+]');
R.ctrlShiftBracketFront = await p.evaluate(()=>order()==="r1,r2,r0");
await p.keyboard.press('Control+Shift+[');
R.ctrlShiftBracketBack = await p.evaluate(()=>order()==="r0,r1,r2");
await p.keyboard.press('Control+z');await p.waitForTimeout(60);
R.arrangeUndo = await p.evaluate(()=>order()==="r1,r2,r0");

/* ---------- 14. the sidebar buttons are really wired ---------- */
await p.evaluate(()=>{const ids=scene([[2,1,1,1,0],[3,2,6,4,0],[1,4,11,2,0]]);setSel(ids);histReset();});
await p.click('#alignGrid button[data-align="top"]');
R.alignButton = await p.evaluate(()=>aabbs().every(o=>Math.abs(o.y-1)<1e-6));
await p.click('#distGrid button[data-dist="h"]');
R.distButton = await p.evaluate(()=>{const a=aabbs().sort((x,y)=>x.x-y.x),g1=a[1].x-a[0].X,g2=a[2].x-a[1].X;return Math.abs(g1-g2)<1e-6;});
/* arrange only means something when part of the mat is selected —
   with everything selected there is nothing to move behind, and the app
   correctly treats that as a no-op that costs no undo step. */
R.arrangeAllSelectedIsNoop = await p.evaluate(()=>{const d=histUndo.length;arrangeSel("back");return histUndo.length===d;});
await p.evaluate(()=>setSel([state.objects[2].id]));
await p.click('#arrGrid button[data-arr="back"]');
R.arrButton = await p.evaluate(()=>state.objects.length===3&&order()==="r2,r0,r1");
R.alignOneUndoEach = await p.evaluate(()=>histUndo.length===3);
await p.click('#undoBtn');await p.waitForTimeout(60);
await p.click('#undoBtn');await p.waitForTimeout(60);
R.alignUndoRestores = await p.evaluate(()=>{const a=aabbs();return Math.abs(a[0].y-1)<1e-6&&Math.abs(a[1].y-1)<1e-6;});

/* an align that changes nothing must not cost an undo step */
await p.evaluate(()=>{const ids=scene([[2,1,1,1,0],[2,1,5,1,0]]);setSel(ids);histReset();alignSel("top");});
R.noopAlignFree = await p.evaluate(()=>histUndo.length===0);

/* ---------- 15. single-object behaviour is untouched ---------- */
R.singleStillHasHandles = await p.evaluate(()=>{
  scene([[4,2,3,5,0]]);setSel([state.objects[0].id]);
  const o=selected(),b=objBox(o),L=layout(),ppi=L.base*view.zoom,ox=RL+MG+view.panx,oy=RT+MG+view.pany;
  const h=handleHit(o,ox+b.edges[3][0]*ppi,oy+b.edges[3][1]*ppi);
  return !multiSel()&&h&&h.key==="e3";
});
R.groupHandlesOnlyWhenMulti = await p.evaluate(()=>{
  const ids=scene([[2,2,1,1,0],[2,2,5,1,0]]);
  setSel([ids[0]]);const one=groupHit(0,0);
  setSel(ids);const g=selBBox(),L=layout(),ppi=L.base*view.zoom,ox=RL+MG+view.panx,oy=RT+MG+view.pany;
  const hit=groupHit(ox+g.minX*ppi,oy+g.minY*ppi);
  return one===null&&!!hit&&hit.key==="c0";
});

/* ---------- 16. persistence of the selection through history ---------- */
R.historyKeepsSelection = await p.evaluate(()=>{
  const ids=scene([[2,2,1,1,0],[2,2,5,1,0],[2,2,9,1,0]]);setSel([ids[0],ids[2]]);histReset();
  histPush();state.objects[0].posX+=1;draw();
  const n=selIds().length;undo();
  return n===2&&selIds().length===2&&state.selIds.indexOf(ids[2])>=0;
});

/* ---------- 17. still draws, still cuts ---------- */
R.overlayPaints = await (async()=>{
  await p.evaluate(()=>{const ids=scene([[3,2,2,2,0],[3,2,8,5,0]]);setSel(ids);draw();});
  const n=await p.evaluate(()=>{const c=document.getElementById('cv'),g=c.getContext('2d'),
    d=g.getImageData(0,0,c.width,c.height).data;let k=0;
    for(let i=0;i<d.length;i+=4)if(d[i]<90&&d[i+1]>90&&d[i+1]<150&&d[i+2]>190)k++;
    return k;});
  return n>200;
})();
R.hpglStillWorks = await p.evaluate(()=>{const h=generateHPGL();return h.indexOf("PU")>=0&&h.indexOf("PD")>=0;});
R.gridSelectsCopies = await p.evaluate(()=>{
  scene([[2,1,1,1,0]]);setSel([state.objects[0].id]);
  $("copyN").value=4;$("copyGap").value=0.5;makeGrid();
  return state.objects.length===4&&selIds().length===4;
});

R.errors=errs;
console.log(JSON.stringify(R,null,1));
const flat=[];
const walk=(o,pre)=>{for(const [k,v] of Object.entries(o)){if(v===false)flat.push(pre+k);else if(v&&typeof v==='object'&&!Array.isArray(v))walk(v,pre+k+'.');}};
walk(R,'');
if(errs.length)flat.push('JS ERRORS');
console.log(flat.length?'*** FAILED: '+flat.join(', '):'ALL ALIGN / MULTI-SELECT CHECKS PASSED');
await b.close();
process.exit(flat.length?1:0);
})();
