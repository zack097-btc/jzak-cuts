const { chromium } = require('playwright');
(async()=>{
const b=await chromium.launch(); const p=await b.newPage();
const errors=[]; p.on('pageerror',e=>errors.push('PAGEERR: '+e.message));
await p.goto('file://'+process.cwd()+'/index.html',{waitUntil:'load'}); await p.waitForTimeout(400);
const res=await p.evaluate(()=>{
  const out={};
  // reset to empty
  state.objects=[]; state.selId=null;
  // --- single object regression: square 100x100 units -> 1" tall at X1,Y1 ---
  addObject([[[0,0],[100,0],[100,100],[0,100],[0,0]]],'sq',1);
  const o=selected(); o.posX=1;o.posY=1;o.height=1;
  document.getElementById('matWidth').value='24'; document.getElementById('stepsPerIn').value='1016';
  document.getElementById('weed').checked=false; document.getElementById('flipY').checked=true;
  document.getElementById('sendVSFS').checked=true; document.getElementById('speed').value='40'; document.getElementById('force').value='80';
  document.getElementById('bladeComp').checked=false; document.getElementById('regMarks').checked=false;
  out.singleHPGL=generateHPGL();
  // --- multi-object: add a second square, expect 2 PU/PD cut groups ---
  addObject([[[0,0],[100,0],[100,100],[0,100],[0,0]]],'sq2',1);
  const o2=selected(); o2.posX=4;o2.posY=1;o2.height=1;
  const multi=generateHPGL();
  out.multiPUcount=(multi.match(/PU/g)||[]).length;   // 2 cut groups + final PU0,0 = 3
  // --- grid copies: select first, make 4 ---
  selectObj(state.objects[0].id);
  document.getElementById('copyN').value='4'; document.getElementById('copyGap').value='0.5';
  makeGrid();
  out.gridCount=state.objects.length;                 // 4 (original replaced by 4 incl the other? grid only affects selected; other remains)
  // note: makeGrid removes only the selected original then adds 4 -> plus the untouched o2 = 5
  // --- reg marks add strokes ---
  document.getElementById('regMarks').checked=true;
  const withReg=generateHPGL(); document.getElementById('regMarks').checked=false;
  const noReg=generateHPGL();
  out.regAdds=withReg.length>noReg.length;
  // --- job save/load round-trip ---
  const beforeCount=state.objects.length;
  document.getElementById('jobName').value='UnitTest';
  saveJob();
  state.objects=[]; state.selId=null; draw();
  document.getElementById('jobSelect').value='UnitTest'; loadJob();
  out.jobRoundTrip=state.objects.length===beforeCount;
  // --- overcut still works on a loaded object ---
  document.getElementById('bladeComp').checked=true;
  out.overcutHPGL=generateHPGL().length>noReg.length; // just a sanity check it produces output
  // --- zoom ---
  view.zoom=1; document.querySelector('[data-act="zin"]').click(); out.zoomIn=view.zoom;
  document.querySelector('[data-act="fit"]').click(); out.zoomFit=view.zoom;
  return out;
});
console.log('singleHPGL:', res.singleHPGL);
console.log(JSON.stringify({multiPUcount:res.multiPUcount,gridCount:res.gridCount,regAdds:res.regAdds,jobRoundTrip:res.jobRoundTrip,zoomIn:res.zoomIn,zoomFit:res.zoomFit},null,1));
const a=[];
// regression: single square identical to verified v2 output
/* a 100x100 unit square set to 1" tall is 1" wide: 1016 steps per side */
const expected="IN;SP1;VS40;FS80;PU1016,23368;PD2032,23368,2032,22352,1016,22352,1016,23368;PU0,0;SP0;";
if(res.singleHPGL!==expected) a.push('single-object regression MISMATCH');
if(res.multiPUcount!==3) a.push('multi PU count '+res.multiPUcount+' (want 3)');
if(res.gridCount!==5) a.push('grid count '+res.gridCount+' (want 5)');
if(!res.regAdds) a.push('reg marks not added');
if(!res.jobRoundTrip) a.push('job round-trip failed');
if(Math.abs(res.zoomIn-1.25)>0.001) a.push('zoom in wrong');
if(Math.abs(res.zoomFit-1)>0.001) a.push('zoom fit wrong');
console.log(a.length?'FAIL: '+a.join(' | '):'ALL V3 CHECKS PASSED');
console.log('JS errors:', errors.length?errors.join(' | '):'none');
await b.close();
})();
