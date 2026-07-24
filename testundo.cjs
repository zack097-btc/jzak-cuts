const {chromium}=require('playwright');
(async()=>{
const b=await chromium.launch();const p=await b.newPage();
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('file:///home/claude/jzak-cuts/index.html');
await p.waitForTimeout(2500);

const R=await p.evaluate(async()=>{
  const out={};
  const st=()=>state;
  const snap=()=>JSON.stringify(st().objects.map(o=>[o.name,+o.posX.toFixed(3),+o.posY.toFixed(3),+o.height.toFixed(3),+objWidth(o).toFixed(3),o.rotation,o.mirror]));

  out.startObjs=st().objects.length;
  out.histEmptyAtBoot = (typeof histUndo!=='undefined') && histUndo.length===0;

  // --- 1. move (nudge) undo/redo
  const o=selected();
  const p0=snap();
  o.posX+=2.0; // do it the way the app does: push then mutate
  o.posX-=2.0;
  histPush(); o.posX+=2.0; syncInputs(); draw();
  const p1=snap();
  undo();
  out.undoMove = snap()===p0;
  redo();
  out.redoMove = snap()===p1;

  // --- 2. delete undo
  const before=st().objects.length;
  deleteObj(st().selId);
  out.deleted = st().objects.length===before-1;
  undo();
  out.undoDelete = st().objects.length===before;

  // --- 3. duplicate undo
  const n0=st().objects.length;
  duplicateObj(st().selId);
  out.duped = st().objects.length===n0+1;
  undo();
  out.undoDupe = st().objects.length===n0;
  redo();
  out.redoDupe = st().objects.length===n0+1;
  undo();

  // --- 4. rotation / mirror undo
  const s0=snap();
  histPush(); selected().rotation=90; selected().mirror=true; syncInputs(); draw();
  const s1=snap();
  out.rotChanged = s0!==s1;
  undo();
  out.undoRot = snap()===s0;
  redo();
  out.redoRot = snap()===s1;
  undo();

  // --- 5. coalescing: rapid same-tag pushes = ONE undo step
  const depth0=histUndo.length;
  const c0=snap();
  for(let i=0;i<10;i++){ histPush("size"); selected().height+=0.1; }
  syncInputs(); draw();
  out.coalescedToOne = (histUndo.length-depth0)===1;
  undo();
  out.undoCoalesced = snap()===c0;

  // --- 6. a new action clears the redo stack
  histPush(); selected().posY+=1; draw();
  out.redoClearedByNewEdit = histRedo.length===0;

  // --- 7. no-op drop: pushing then changing nothing, then histDropIfSame
  const d0=histUndo.length;
  histPush(); histDropIfSame();
  out.noopDropped = histUndo.length===d0;

  // --- 8. depth cap
  for(let i=0;i<120;i++){ histBreak(); histPush(); selected().posX+=0.01; }
  out.capped = histUndo.length<=HIST_MAX;
  out.HIST_MAX = HIST_MAX;

  // --- 9. undo past the bottom is safe
  for(let i=0;i<200;i++) undo();
  out.survivedOverUndo = st().objects.length>=1;
  for(let i=0;i<200;i++) redo();
  out.survivedOverRedo = st().objects.length>=1;

  // --- 10. button enable/disable state
  histReset();
  out.btnsDisabledAfterReset = document.getElementById('undoBtn').classList.contains('dis') && document.getElementById('redoBtn').classList.contains('dis');
  histPush(); selected().posX+=0.5; draw();
  out.undoBtnEnabled = !document.getElementById('undoBtn').classList.contains('dis');
  undo();
  out.redoBtnEnabled = !document.getElementById('redoBtn').classList.contains('dis');

  // --- 11. node-edit undo (subpath geometry restored)
  setTool('node');
  const on=selected(); ensureNodes(on);
  const geo0=JSON.stringify(on.subpaths).length;
  const nodes0=JSON.stringify(on.nodes);
  histPush();
  on.nodes[0].pts[0].x+=0.5; objCommitNodes(on); draw();
  out.nodeMoved = JSON.stringify(on.nodes)!==nodes0;
  undo();
  out.undoNode = JSON.stringify(selected().nodes)===nodes0;
  setTool('select');

  // --- 12. tool buttons still work (selector was narrowed to [data-tool])
  out.toolBtnWorks = (function(){ document.querySelector('.tool[data-tool="pan"]').click(); const ok=st().tool==='pan'; document.querySelector('.tool[data-tool="select"]').click(); return ok && st().tool==='select'; })();
  out.undoBtnIsNotATool = document.getElementById('undoBtn').dataset.tool===undefined;

  return out;
});

// --- 13. real keyboard Ctrl+Z / Ctrl+Y through the DOM
await p.evaluate(()=>{ histReset(); histPush(); selected().posX=7.77; syncInputs(); draw(); });
await p.keyboard.press('Control+z');
await p.waitForTimeout(120);
const afterCtrlZ=await p.evaluate(()=>+selected().posX.toFixed(2));
await p.keyboard.press('Control+y');
await p.waitForTimeout(120);
const afterCtrlY=await p.evaluate(()=>+selected().posX.toFixed(2));
await p.keyboard.press('Control+z');
await p.waitForTimeout(120);
const afterCtrlZ2=await p.evaluate(()=>+selected().posX.toFixed(2));
await p.keyboard.press('Control+Shift+z');
await p.waitForTimeout(120);
const afterCtrlShiftZ=await p.evaluate(()=>+selected().posX.toFixed(2));

// --- 14. undo/redo buttons clickable
await p.evaluate(()=>{ histReset(); histPush(); selected().posY=9.5; syncInputs(); draw(); });
await p.click('#undoBtn');
await p.waitForTimeout(100);
const afterBtnUndo=await p.evaluate(()=>+selected().posY.toFixed(2));
await p.click('#redoBtn');
await p.waitForTimeout(100);
const afterBtnRedo=await p.evaluate(()=>+selected().posY.toFixed(2));

// --- 15. Ctrl+Z must work while in the point-edit tool too
await p.evaluate(()=>{ setTool('node'); histReset(); histPush(); selected().posX=3.33; syncInputs(); draw(); });
await p.keyboard.press('Control+z');
await p.waitForTimeout(120);
const nodeModeUndo=await p.evaluate(()=>{const v=+selected().posX.toFixed(2); setTool('select'); return v;});

R.ctrlZ = afterCtrlZ!==7.77;
R.ctrlY = afterCtrlY===7.77;
R.ctrlZ_again = afterCtrlZ2!==7.77;
R.ctrlShiftZ_redo = afterCtrlShiftZ===7.77;
R.undoBtnClick = afterBtnUndo!==9.5;
R.redoBtnClick = afterBtnRedo===9.5;
R.undoInNodeTool = nodeModeUndo!==3.33;
R.errors = errs;

console.log(JSON.stringify(R,null,1));
const fails=Object.entries(R).filter(([k,v])=>v===false).map(([k])=>k);
if(errs.length) fails.push('JS ERRORS');
console.log(fails.length? '*** FAILED: '+fails.join(', ') : 'ALL UNDO/REDO CHECKS PASSED');
await b.close();
process.exit(fails.length?1:0);
})();
