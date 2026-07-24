/* Stage 3 — free rotate + side-handle stretch.
   Uses REAL mouse drags on the canvas wherever possible, so the handle
   hit-testing, the drag math and the undo integration are all exercised
   exactly the way a user exercises them. */
const {chromium}=require('playwright');
const near=(a,b,t)=>Math.abs(a-b)<=(t===undefined?0.02:t);

(async()=>{
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1500,height:950}});
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('file:///home/claude/jzak-cuts/index.html');
await p.waitForTimeout(2600);

/* helper installed on the page: world inches -> client px */
await p.evaluate(()=>{
  window.W2C=(wx,wy)=>{const L=layout(),ppi=L.base*view.zoom,ox=RL+MG+view.panx,oy=RT+MG+view.pany,
    r=document.getElementById('cv').getBoundingClientRect();
    return {x:r.left+ox+wx*ppi, y:r.top+oy+wy*ppi};};
  window.setup=(w,h,x,y,rot)=>{const o=selected();o.width=w;o.height=h;o.posX=x;o.posY=y;o.rotation=rot||0;o.mirror=false;
    setTool('select');state.selId=o.id;histReset();syncInputs();draw();return o.id;};
  window.dims=()=>{const o=selected();return {w:+objW(o).toFixed(4),h:+o.height.toFixed(4),x:+o.posX.toFixed(4),y:+o.posY.toFixed(4),r:+(o.rotation||0).toFixed(3)};};
});

const R={};

/* ---------- 1. objBox geometry at 0 deg ---------- */
R.box0 = await p.evaluate(()=>{
  setup(4,2,3,5,0);const o=selected(),b=objBox(o);
  const eq=(a,c)=>Math.abs(a[0]-c[0])<1e-9&&Math.abs(a[1]-c[1])<1e-9;
  return eq(b.corners[0],[3,5])&&eq(b.corners[1],[7,5])&&eq(b.corners[2],[3,7])&&eq(b.corners[3],[7,7])
      && eq(b.edges[0],[5,5])&&eq(b.edges[1],[5,7])&&eq(b.edges[2],[3,6])&&eq(b.edges[3],[7,6])
      && eq(b.center,[5,6]);
});

/* ---------- 2. objBox agrees with the real cut geometry at 37 deg ---------- */
R.box37 = await p.evaluate(()=>{
  setup(4,2,3,5,37);const o=selected(),b=objBox(o);
  /* independently rotate the local corners */
  const rot=37*Math.PI/180,cos=Math.cos(rot),sin=Math.sin(rot),W=4,H=2,cx=2,cy=1;
  const T=(nx,ny)=>{const dx=nx-cx,dy=ny-cy;return [dx*cos-dy*sin+cx+3, dx*sin+dy*cos+cy+5];};
  const want=[T(0,0),T(4,0),T(0,2),T(4,2)];
  const ok=want.every((w,i)=>Math.abs(w[0]-b.corners[i][0])<1e-9&&Math.abs(w[1]-b.corners[i][1])<1e-9);
  /* the actual polylines must sit inside that same rotated box */
  const pl=objPolylines(o).flat(),bb=bboxOf([pl]);
  const xs=b.corners.map(c=>c[0]),ys=b.corners.map(c=>c[1]);
  const inside = bb.minX>=Math.min(...xs)-1e-6 && bb.minX+bb.w<=Math.max(...xs)+1e-6
              && bb.minY>=Math.min(...ys)-1e-6 && bb.minY+bb.h<=Math.max(...ys)+1e-6;
  return ok&&inside;
});

/* ---------- 3. side handles never coincide with corners; rotate handle is outside ---------- */
R.handlesDistinct = await p.evaluate(()=>{
  setup(4,2,3,5,20);const o=selected(),b=objBox(o),L=layout(),ppi=L.base*view.zoom;
  const all=[...b.corners,...b.edges];
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)
    if(Math.hypot(all[i][0]-all[j][0],all[i][1]-all[j][1])<0.05)return false;
  const rh=objRotHandle(o,ppi);
  /* rotate knob must be OUTSIDE the box, beyond the north edge */
  const d=Math.hypot(rh[0]-b.edges[0][0],rh[1]-b.edges[0][1]);
  const dc=Math.hypot(rh[0]-b.center[0],rh[1]-b.center[1]);
  return d>0.05 && dc>Math.hypot(b.edges[0][0]-b.center[0],b.edges[0][1]-b.center[1]);
});

/* ---------- 4. handleHit resolves each handle by screen position ---------- */
R.handleHitAll = await p.evaluate(()=>{
  setup(4,2,3,5,25);const o=selected(),b=objBox(o),L=layout(),ppi=L.base*view.zoom,
    ox=RL+MG+view.panx,oy=RT+MG+view.pany;
  const S=pt=>[ox+pt[0]*ppi,oy+pt[1]*ppi];
  const want=['c0','c1','c2','c3','e0','e1','e2','e3'];
  const pts=[...b.corners,...b.edges];
  for(let i=0;i<8;i++){const s=S(pts[i]),h=handleHit(o,s[0],s[1]);if(!h||h.key!==want[i])return 'bad '+want[i]+' -> '+(h&&h.key);}
  const rs=S(objRotHandle(o,ppi)),hr=handleHit(o,rs[0],rs[1]);
  if(!hr||hr.key!=='rot')return 'bad rot';
  if(handleHit(o,ox+b.center[0]*ppi,oy+b.center[1]*ppi))return 'centre falsely hit';
  return true;
});

/* ---------- 5. hover cursors follow rotation ---------- */
R.cursors = await p.evaluate(()=>{
  setup(4,2,3,5,0);const o=selected();
  const at0 = handleCursor('e2',o)==='ew-resize' && handleCursor('e0',o)==='ns-resize' && handleCursor('rot',o)==='grab';
  o.rotation=90;
  const at90 = handleCursor('e2',o)==='ns-resize' && handleCursor('e0',o)==='ew-resize';
  o.rotation=45;
  const at45 = handleCursor('e2',o)==='nwse-resize';
  return at0&&at90&&at45;
});

/* ---------- 6. REAL DRAG: east side handle stretches width only, west edge pinned ---------- */
const sideE = await (async()=>{
  await p.evaluate(()=>{setup(4,2,3,5,0);document.getElementById('lockAspect').checked=false;});
  const s=await p.evaluate(()=>{const b=objBox(selected());return {h:W2C(b.edges[3][0],b.edges[3][1]),tgt:W2C(9,6)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:8});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.sideE_widthOnly = near(sideE.w,6) && near(sideE.h,2) && near(sideE.x,3) && near(sideE.y,5);

/* ---------- 7. REAL DRAG: west handle stretches left, east edge pinned ---------- */
const sideW = await (async()=>{
  await p.evaluate(()=>{setup(4,2,3,5,0);document.getElementById('lockAspect').checked=false;});
  const s=await p.evaluate(()=>{const b=objBox(selected());return {h:W2C(b.edges[2][0],b.edges[2][1]),tgt:W2C(1,6)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:8});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.sideW_pinsRight = near(sideW.w,6) && near(sideW.h,2) && near(sideW.x,1) && near(sideW.y,5);

/* ---------- 8. REAL DRAG: south handle stretches height only, top pinned ---------- */
const sideS = await (async()=>{
  await p.evaluate(()=>{setup(4,2,3,5,0);document.getElementById('lockAspect').checked=false;});
  const s=await p.evaluate(()=>{const b=objBox(selected());return {h:W2C(b.edges[1][0],b.edges[1][1]),tgt:W2C(5,10)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:8});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.sideS_heightOnly = near(sideS.h,5) && near(sideS.w,4) && near(sideS.x,3) && near(sideS.y,5);

/* ---------- 9. REAL DRAG: north handle, bottom edge pinned ---------- */
const sideN = await (async()=>{
  await p.evaluate(()=>{setup(4,2,3,5,0);document.getElementById('lockAspect').checked=false;});
  const s=await p.evaluate(()=>{const b=objBox(selected());return {h:W2C(b.edges[0][0],b.edges[0][1]),tgt:W2C(5,3)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:8});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.sideN_pinsBottom = near(sideN.h,4) && near(sideN.w,4) && near(sideN.y,3) && near(sideN.x,3);

/* ---------- 10. REAL DRAG: corner with aspect locked scales proportionally, opposite corner pinned ---------- */
const cornerLocked = await (async()=>{
  await p.evaluate(()=>{setup(4,2,3,5,0);document.getElementById('lockAspect').checked=true;});
  const s=await p.evaluate(()=>{const b=objBox(selected());return {h:W2C(b.corners[3][0],b.corners[3][1]),tgt:W2C(11,9)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:10});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.cornerKeepsAspect = near(cornerLocked.w/cornerLocked.h, 2, 0.01);
R.cornerPinsTL = near(cornerLocked.x,3) && near(cornerLocked.y,5);
R.cornerGrew = cornerLocked.w>4.5;

/* ---------- 11. REAL DRAG: corner with aspect UNlocked is free (non-uniform) ---------- */
const cornerFree = await (async()=>{
  await p.evaluate(()=>{setup(4,2,3,5,0);document.getElementById('lockAspect').checked=false;});
  const s=await p.evaluate(()=>{const b=objBox(selected());return {h:W2C(b.corners[3][0],b.corners[3][1]),tgt:W2C(10,12)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:10});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.cornerFreeNonUniform = near(cornerFree.w,7) && near(cornerFree.h,7) && near(cornerFree.x,3) && near(cornerFree.y,5);

/* ---------- 12. ROTATED object: dragging the east handle grows along the object's own axis,
                  and the west edge stays pinned in world space ---------- */
const rotStretch = await (async()=>{
  await p.evaluate(()=>{setup(4,2,4,6,90);document.getElementById('lockAspect').checked=false;});
  const before=await p.evaluate(()=>{const b=objBox(selected());return {anchor:b.edges[2].slice(),h:W2C(b.edges[3][0],b.edges[3][1]),u:b.u.slice(),c:b.center.slice()};});
  /* push 2" further along the object's +u axis from the handle */
  const tgt=await p.evaluate(a=>{const b=objBox(selected());const e=b.edges[3];return W2C(e[0]+a.u[0]*2,e[1]+a.u[1]*2);},before);
  await p.mouse.move(before.h.x,before.h.y);await p.mouse.down();
  await p.mouse.move(tgt.x,tgt.y,{steps:10});await p.mouse.up();
  const after=await p.evaluate(()=>{const o=selected(),b=objBox(o);return {d:dims(),anchor:b.edges[2].slice()};});
  return {before,after};
})();
R.rotStretch_axis = near(rotStretch.after.d.w,6,0.06) && near(rotStretch.after.d.h,2,0.02);
R.rotStretch_anchorPinned = near(rotStretch.after.anchor[0],rotStretch.before.anchor[0],0.02)
                         && near(rotStretch.after.anchor[1],rotStretch.before.anchor[1],0.02);
R.rotStretch_keptAngle = near(rotStretch.after.d.r,90,0.001);

/* ---------- 13. ROTATED corner drag keeps the opposite corner pinned in world space ---------- */
const rotCorner = await (async()=>{
  await p.evaluate(()=>{setup(4,2,4,6,33);document.getElementById('lockAspect').checked=true;});
  const before=await p.evaluate(()=>{const b=objBox(selected());return {tl:b.corners[0].slice(),h:W2C(b.corners[3][0],b.corners[3][1]),br:b.corners[3].slice(),u:b.u.slice(),v:b.v.slice()};});
  const tgt=await p.evaluate(a=>{const b=objBox(selected()),c=b.corners[3];return W2C(c[0]+a.u[0]*2+a.v[0]*1, c[1]+a.u[1]*2+a.v[1]*1);},before);
  await p.mouse.move(before.h.x,before.h.y);await p.mouse.down();
  await p.mouse.move(tgt.x,tgt.y,{steps:10});await p.mouse.up();
  const after=await p.evaluate(()=>{const b=objBox(selected());return {tl:b.corners[0].slice(),d:dims()};});
  return {before,after};
})();
R.rotCorner_pinsOpposite = near(rotCorner.after.tl[0],rotCorner.before.tl[0],0.02)
                        && near(rotCorner.after.tl[1],rotCorner.before.tl[1],0.02);
R.rotCorner_keepsAspect = near(rotCorner.after.d.w/rotCorner.after.d.h,2,0.02);
R.rotCorner_grew = rotCorner.after.d.w>4.2;

/* ---------- 14. REAL DRAG on the rotate knob ---------- */
const rotDrag = await (async()=>{
  await p.evaluate(()=>{setup(4,2,4,6,0);});
  const s=await p.evaluate(()=>{const o=selected(),L=layout(),ppi=L.base*view.zoom,b=objBox(o),rh=objRotHandle(o,ppi);
    /* drop the cursor due EAST of centre => 90 degrees from the north start */
    return {h:W2C(rh[0],rh[1]), tgt:W2C(b.center[0]+3,b.center[1])};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:12});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.rotDrag_90 = near(rotDrag.r,90,1.5);
R.rotDrag_noResize = near(rotDrag.w,4) && near(rotDrag.h,2);

/* ---------- 15. Shift snaps the rotate drag to 15 deg ---------- */
const rotSnap = await (async()=>{
  await p.evaluate(()=>{setup(4,2,4,6,0);});
  const s=await p.evaluate(()=>{const o=selected(),L=layout(),ppi=L.base*view.zoom,b=objBox(o),rh=objRotHandle(o,ppi),
    a=(-90+52)*Math.PI/180;   /* 52 deg clockwise from north */
    return {h:W2C(rh[0],rh[1]), tgt:W2C(b.center[0]+Math.cos(a)*3,b.center[1]+Math.sin(a)*3)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.keyboard.down('Shift');
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:12});
  const snapped=await p.evaluate(()=>dims());
  await p.mouse.up();await p.keyboard.up('Shift');
  return snapped;
})();
R.rotShiftSnap15 = Math.abs(rotSnap.r % 15) < 0.001 && near(rotSnap.r,45,0.001);

/* ---------- 16. free-angle numeric input + reset + seg-button sync ---------- */
R.numericAngle = await (async()=>{
  await p.evaluate(()=>{setup(4,2,4,6,0);});
  await p.fill('#rotDeg','137.5');
  await p.dispatchEvent('#rotDeg','input');
  await p.waitForTimeout(60);
  const a=await p.evaluate(()=>+selected().rotation.toFixed(2));
  await p.click('#rotReset');
  await p.waitForTimeout(60);
  const z=await p.evaluate(()=>({r:selected().rotation,field:document.getElementById('rotDeg').value,
     on:[...document.querySelectorAll('#rotSeg button')].filter(b=>b.classList.contains('on')).map(b=>b.dataset.rot)}));
  return a===137.5 && z.r===0 && String(z.field)==='0' && z.on.length===1 && z.on[0]==='0';
})();

/* ---------- 17. negative + >360 angles normalise ---------- */
R.normalise = await p.evaluate(()=>{
  const a=normDeg(-90)===270, b2=normDeg(450)===90, c=normDeg(0)===0, d=normDeg(360)===0;
  setup(4,2,4,6,0);
  const o=selected();o.rotation=normDeg(-45);
  return a&&b2&&c&&d&&o.rotation===315;
});

/* ---------- 18. a 90 deg seg-button press still agrees with the free field ---------- */
R.segSyncsField = await (async()=>{
  await p.evaluate(()=>{setup(4,2,4,6,0);});
  await p.click('#rotSeg button[data-rot="90"]');
  await p.waitForTimeout(60);
  return await p.evaluate(()=>selected().rotation===90 && String(document.getElementById('rotDeg').value)==='90');
})();

/* ---------- 19. every gesture is exactly ONE undo step, and undo restores fully ---------- */
const undoTests = await (async()=>{
  const out={};
  /* stretch */
  await p.evaluate(()=>{setup(4,2,3,5,0);document.getElementById('lockAspect').checked=false;histReset();});
  const s=await p.evaluate(()=>{const b=objBox(selected());return {h:W2C(b.edges[3][0],b.edges[3][1]),tgt:W2C(9,6)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:8});await p.mouse.up();
  out.stretchOneStep=await p.evaluate(()=>histUndo.length===1);
  await p.evaluate(()=>undo());
  out.stretchUndone=await p.evaluate(()=>{const d=dims();return d.w===4&&d.h===2&&d.x===3&&d.y===5;});
  await p.evaluate(()=>redo());
  out.stretchRedone=await p.evaluate(()=>Math.abs(dims().w-6)<0.02);

  /* rotate */
  await p.evaluate(()=>{setup(4,2,4,6,0);histReset();});
  const r=await p.evaluate(()=>{const o=selected(),L=layout(),ppi=L.base*view.zoom,b=objBox(o),rh=objRotHandle(o,ppi);
    return {h:W2C(rh[0],rh[1]),tgt:W2C(b.center[0]+3,b.center[1])};});
  await p.mouse.move(r.h.x,r.h.y);await p.mouse.down();
  await p.mouse.move(r.tgt.x,r.tgt.y,{steps:12});await p.mouse.up();
  out.rotOneStep=await p.evaluate(()=>histUndo.length===1);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(120);
  out.rotUndone=await p.evaluate(()=>selected().rotation===0);

  /* a click on a handle that never moves must not cost an undo step */
  await p.evaluate(()=>{setup(4,2,3,5,0);histReset();});
  const c=await p.evaluate(()=>{const b=objBox(selected());return W2C(b.corners[3][0],b.corners[3][1]);});
  await p.mouse.move(c.x,c.y);await p.mouse.down();await p.mouse.up();
  out.noopHandleClick=await p.evaluate(()=>histUndo.length===0);
  return out;
})();
Object.assign(R,undoTests);

/* ---------- 20. rotation + non-uniform scale still produce correct HPGL ---------- */
R.hpglRotated = await p.evaluate(()=>{
  setup(4,2,3,5,90);
  const pl=objPolylines(selected());
  /* a 90-degree rotation of a 4x2 box occupies a 2x4 footprint */
  const bb=bboxOf(pl);
  const okBox = Math.abs(bb.w-2)<0.02 && Math.abs(bb.h-4)<0.02;
  return okBox;
});
R.hpglEmits = await p.evaluate(()=>{
  setup(4,2,3,5,37);
  try{
    const s=generateHPGL();
    return typeof s==='string' && s.indexOf('PD')>=0 && s.indexOf('PU')>=0;
  }catch(e){return 'err:'+e.message;}
});

/* ---------- 21. the rotated selection overlay actually paints ---------- */
R.overlayDraws = await p.evaluate(()=>{
  setup(4,2,3,5,42);draw();
  const cvs=document.getElementById('cv'),g=cvs.getContext('2d');
  const d=g.getImageData(0,0,cvs.width,cvs.height).data;
  let blue=0;
  for(let i=0;i<d.length;i+=4){if(d[i]<80&&d[i+1]>90&&d[i+1]<150&&d[i+2]>190)blue++;}
  return blue>200;   /* dashed box + 8 handles + knob */
});

/* ---------- 22. mirror + rotation together still round-trip ---------- */
R.mirrorRot = await p.evaluate(()=>{
  setup(4,2,3,5,37);const o=selected();o.mirror=true;draw();
  const b=objBox(o),bb=bboxOf(objPolylines(o));
  const xs=b.corners.map(c=>c[0]),ys=b.corners.map(c=>c[1]);
  return bb.minX>=Math.min(...xs)-1e-6 && bb.minX+bb.w<=Math.max(...xs)+1e-6
      && bb.minY>=Math.min(...ys)-1e-6 && bb.minY+bb.h<=Math.max(...ys)+1e-6;
});

/* ---------- 23. tiny drags cannot collapse an object below the floor ---------- */
const floor = await (async()=>{
  await p.evaluate(()=>{setup(4,2,3,5,0);document.getElementById('lockAspect').checked=false;});
  const s=await p.evaluate(()=>{const b=objBox(selected());return {h:W2C(b.edges[3][0],b.edges[3][1]),tgt:W2C(-14,6)};});
  await p.mouse.move(s.h.x,s.h.y);await p.mouse.down();
  await p.mouse.move(s.tgt.x,s.tgt.y,{steps:8});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.sizeFloor = floor.w>=0.05 && floor.h>=0.05 && isFinite(floor.x) && isFinite(floor.y);

/* ---------- 24. moving the object by dragging its body still works ---------- */
const bodyMove = await (async()=>{
  await p.evaluate(()=>{setup(4,2,3,5,0);histReset();});
  const s=await p.evaluate(()=>({a:W2C(5,6),b:W2C(8,9)}));
  await p.mouse.move(s.a.x,s.a.y);await p.mouse.down();
  await p.mouse.move(s.b.x,s.b.y,{steps:8});await p.mouse.up();
  return await p.evaluate(()=>dims());
})();
R.bodyStillDraggable = near(bodyMove.x,6,0.15) && near(bodyMove.y,8,0.15) && near(bodyMove.w,4) && near(bodyMove.h,2);

/* ---------- 25. point-edit tool is unaffected by the new handles ---------- */
R.nodeToolUnaffected = await p.evaluate(()=>{
  setup(4,2,3,5,0);setTool('node');
  const o=selected();ensureNodes(o);
  const ok=o.nodes&&o.nodes.length>0;
  setTool('select');return ok;
});

R.errors=errs;
console.log(JSON.stringify(R,null,1));
const fails=Object.entries(R).filter(([k,v])=>v===false||(typeof v==='string'&&v!=='skip'&&v!=='true')).map(([k])=>k).filter(k=>k!=='errors');
if(errs.length)fails.push('JS ERRORS');
console.log(fails.length?'*** FAILED: '+fails.join(', '):'ALL ROTATE/STRETCH CHECKS PASSED');
await b.close();
process.exit(fails.length?1:0);
})();
