const { chromium } = require('playwright');
(async()=>{
const b = await chromium.launch();
const p = await b.newPage();
const errors=[];
p.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
p.on('pageerror', e=>errors.push('PAGEERR: '+e.message));
await p.goto('file://'+process.cwd()+'/index.html', {waitUntil:'load'});
await p.waitForTimeout(600);
const res = await p.evaluate(()=>{
  state.objects=[]; state.selId=null; state.selIds=[];
  addObject([[[0,0],[200,0],[200,100],[0,100],[0,0]]],'test',1);
  document.getElementById('heightIn').value = '1';
  document.getElementById('posX').value='1';
  document.getElementById('posY').value='1';
  document.getElementById('matWidth').value='24';
  document.getElementById('stepsPerIn').value='1016';
  document.getElementById('weed').checked=false;
  document.getElementById('flipY').checked=true;
  document.getElementById('sendVSFS').checked=true;
  document.getElementById('speed').value='40';
  document.getElementById('force').value='80';
  syncInputs(); draw();
  const o=selected();
  return { widthIn: document.getElementById('widthIn').value,
           bb: {x:o.posX, y:o.posY, w:objWidth(o), h:o.height},
           hpgl: generateHPGL(), test: testCutHPGL() };
});
console.log('computed width (want 2.00):', res.widthIn);
console.log('transformed bbox:', JSON.stringify(res.bb));
console.log('HPGL:', res.hpgl);
console.log('TEST HPGL:', res.test);
const a=[];
if(Math.abs(parseFloat(res.widthIn)-2)>0.01) a.push('width scale wrong');
if(!/^IN;SP1;/.test(res.hpgl)) a.push('missing init');
if(!/VS40;FS80;/.test(res.hpgl)) a.push('missing VS/FS');
if(!/PU\d+,\d+;PD/.test(res.hpgl)) a.push('missing PU/PD');
if(!/SP0;$/.test(res.hpgl)) a.push('missing end');
console.log(a.length? 'FAIL: '+a.join(', ') : 'ALL CORE CHECKS PASSED');
console.log('JS errors:', errors.length? errors.join(' | ') : 'none');
await b.close();
})();
