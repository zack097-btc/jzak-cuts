const { chromium } = require('playwright');
(async()=>{
const b=await chromium.launch(); const p=await b.newPage();
const errors=[]; p.on('pageerror',e=>errors.push('PAGEERR: '+e.message));
await p.goto('file://'+process.cwd()+'/index.html',{waitUntil:'load'}); await p.waitForTimeout(400);
const res=await p.evaluate(()=>{
  const out={};
  // embedded fonts present in dropdown
  out.embFontCount=Object.keys(window.EMBEDDED_FONTS||{}).length;
  out.fontOptions=[...document.getElementById('fontSelect').options].map(o=>o.value).slice(0,6);
  // font b64 decodes to a TTF (starts with 0x00 0x01 0x00 0x00 or 'OTTO'/'true')
  const buf=b64ToBuf(window.EMBEDDED_FONTS['Bebas Neue']); const dv=new Uint8Array(buf).slice(0,4);
  out.ttfMagic=Array.from(dv);

  // asset library round-trip
  state.objects=[]; state.selId=null;
  addObject([[[0,0],[10,0],[10,10],[0,10],[0,0]]],'unit',1);
  document.getElementById('assetName').value='UnitAsset'; saveAsset();
  state.objects=[]; state.selId=null;
  document.getElementById('assetSelect').value='UnitAsset'; addAsset();
  out.assetRoundTrip=state.objects.length===1;

  // job library round-trip
  document.getElementById('jobName').value='UnitJob'; saveJob();
  state.objects=[]; document.getElementById('jobSelect').value='UnitJob'; loadJob();
  out.jobRoundTrip=state.objects.length>=1;

  // multi-object HPGL (2 squares)
  state.objects=[]; state.selId=null;
  addObject([[[0,0],[100,0],[100,100],[0,100],[0,0]]],'a',1); selected().posX=1; selected().posY=1;
  addObject([[[0,0],[100,0],[100,100],[0,100],[0,0]]],'b',1); selected().posX=5; selected().posY=1;
  document.getElementById('weed').checked=false; document.getElementById('regMarks').checked=false;
  out.multiPU=(generateHPGL().match(/PU/g)||[]).length; // 2 + final = 3

  /* image trace through the real engine: a black square on white. The white
     ground is not a shape and must not come back as a second loop. */
  const TW=64,TH=64,td=new Uint8ClampedArray(TW*TH*4).fill(255);
  for(let y=0;y<TH;y++)for(let x=0;x<TW;x++){
    if(x>=16&&x<48&&y>=16&&y<48){const i=(y*TW+x)*4;td[i]=td[i+1]=td[i+2]=0;}
  }
  traceData=new ImageData(td,TW,TH);
  const before=state.objects.length; traceRun(false);
  out.traceAdded=state.objects.length===before+1;
  const traced=state.objects[state.objects.length-1];
  out.tracedSubpaths=traced.subpaths.length;
  /* a square traced at 3" tall is 3" wide, and it should not cost many nodes */
  out.tracedWidth=+objWidth(traced).toFixed(2);
  /* traced.nodes is a list of {closed,pts} loops, one per subpath */
  out.tracedNodes=traced.nodes&&traced.nodes[0]?traced.nodes[0].pts.length:0;
  out.tracedClosed=!!(traced.nodes&&traced.nodes[0]&&traced.nodes[0].closed);
  return out;
});
console.log(JSON.stringify(res,null,1));
const a=[];
if(res.embFontCount<15) a.push('embedded font count '+res.embFontCount);
if(!res.fontOptions.some(v=>v==='emb:Bebas Neue')) a.push('Bebas not in dropdown');
if(!(res.ttfMagic[0]===0&&res.ttfMagic[1]===1&&res.ttfMagic[2]===0&&res.ttfMagic[3]===0)) a.push('TTF magic wrong '+res.ttfMagic);
if(!res.assetRoundTrip) a.push('asset round-trip failed');
if(!res.jobRoundTrip) a.push('job round-trip failed');
if(res.multiPU!==3) a.push('multi PU '+res.multiPU);
if(!res.traceAdded) a.push('trace did not add object');
if(res.tracedSubpaths!==1) a.push('trace kept '+res.tracedSubpaths+' subpaths (want 1 dark)');
if(Math.abs(res.tracedWidth-3)>0.05) a.push('traced square not square: '+res.tracedWidth+'in wide at 3in tall');
if(!(res.tracedNodes>=4&&res.tracedNodes<=12)) a.push('traced square node count '+res.tracedNodes+' (want 4-12)');
if(!res.tracedClosed) a.push('traced loop not closed');
console.log(a.length?'FAIL: '+a.join(' | '):'ALL V4 CHECKS PASSED');
console.log('JS errors:', errors.length?errors.join(' | '):'none');
await b.close();
})();
