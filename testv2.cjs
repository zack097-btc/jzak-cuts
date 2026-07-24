const { chromium } = require('playwright');
(async()=>{
const b = await chromium.launch();
const p = await b.newPage();
const errors=[];
p.on('pageerror', e=>errors.push('PAGEERR: '+e.message));
await p.goto('file://'+process.cwd()+'/index.html', {waitUntil:'load'});
await p.waitForTimeout(500);

const res = await p.evaluate(()=>{
  const out={};
  // --- DXF parse: a LINE + a closed LWPOLYLINE square (2 units) ---
  const dxf = ["0","SECTION","2","ENTITIES",
    "0","LINE","10","0","20","0","11","3","21","0",
    "0","LWPOLYLINE","90","4","70","1","10","0","20","0","10","2","20","0","10","2","20","2","10","0","20","2",
    "0","CIRCLE","10","5","20","5","40","1",
    "0","ENDSEC","0","EOF"].join("\n");
  const subs = parseDXF(dxf);
  out.dxfSubCount = subs.length;                 // expect 3 (line, polyline, circle)
  out.polyPts = subs[1] ? subs[1].length : 0;    // closed square -> 5 pts (4 + closing)

  // --- overcut: closed square design, blade comp on ---
  state.objects=[]; state.selId=null; state.selIds=[];
  addObject([[[0,0],[100,0],[100,100],[0,100],[0,0]]],'sq',1);
  document.getElementById('heightIn').value='1'; syncInputs();
  document.getElementById('bladeComp').checked=true;
  document.getElementById('bladeOff').value='0.25';
  document.getElementById('weed').checked=false;
  const hplOn = generateHPGL();
  document.getElementById('bladeComp').checked=false;
  const hplOff = generateHPGL();
  out.overcutAddsCoords = hplOn.length > hplOff.length;   // overcut appends a point
  out.hplOnSample = hplOn;

  // --- presets ---
  applyPreset('htv');
  out.htvMirror = document.getElementById('mirror').checked;   // true
  out.htvForce = document.getElementById('force').value;       // 60
  /* HTV is cut with the ordinary 45-degree blade, so it carries the same 0.25
     offset as vinyl; only the thick stuff (reflective, sandblast) needs 0.30. */
  out.htvOff = document.getElementById('bladeOff').value;      // 0.25

  // --- zoom ---
  view.zoom=1; document.querySelector('[data-act="zin"]').click();
  out.zoomAfterIn = view.zoom;                                 // 1.25
  document.querySelector('[data-act="fit"]').click();
  out.zoomAfterFit = view.zoom;                                // 1
  out.zoomLabel = document.getElementById('zoomLabel').textContent;
  return out;
});
console.log(JSON.stringify(res,null,1));
const a=[];
if(res.dxfSubCount!==3) a.push('DXF entity count wrong: '+res.dxfSubCount);
if(res.polyPts!==5) a.push('DXF closed polyline pts wrong: '+res.polyPts);
if(!res.overcutAddsCoords) a.push('overcut did not extend path');
if(res.htvMirror!==true) a.push('HTV preset mirror not set');
if(String(res.htvForce)!=='60') a.push('HTV force wrong');
if(Math.abs(parseFloat(res.htvOff)-0.25)>0.001) a.push('HTV blade offset wrong: '+res.htvOff);
if(Math.abs(res.zoomAfterIn-1.25)>0.001) a.push('zoom in wrong');
if(Math.abs(res.zoomAfterFit-1)>0.001) a.push('zoom fit wrong');
console.log(a.length?'FAIL: '+a.join(' | '):'ALL V2 CHECKS PASSED');
console.log('JS errors:', errors.length?errors.join(' | '):'none');
await b.close();
})();
