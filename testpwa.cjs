const { chromium } = require('playwright');
(async()=>{
const b=await chromium.launch(); const ctx=await b.newContext(); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8099/index.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
const res=await p.evaluate(async()=>{
  const out={};
  // manifest
  const ml=document.querySelector('link[rel=manifest]');
  out.manifestLinked=!!ml;
  const mr=await fetch('manifest.webmanifest').then(r=>r.json());
  out.manifestName=mr.name; out.display=mr.display; out.icons=mr.icons.length; out.startUrl=mr.start_url;
  // service worker
  out.swSupported='serviceWorker' in navigator;
  const reg=await navigator.serviceWorker.getRegistration();
  out.swRegistered=!!reg;
  // wait for SW active
  let tries=0; while(!(navigator.serviceWorker.controller)&&tries<20){await new Promise(r=>setTimeout(r,150));tries++;}
  out.swControlling=!!navigator.serviceWorker.controller;
  // keyboard features
  state.objects=[];state.selId=null;
  addObject([[[0,0],[100,0],[100,100],[0,100],[0,0]]],'sq',4);
  const o=selected();const x0=o.posX;
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));
  out.nudged=(selected().posX>x0);
  // copy/paste
  const n0=state.objects.length;
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true}));
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'v',ctrlKey:true}));
  out.pasted=(state.objects.length===n0+1);
  // duplicate
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'d',ctrlKey:true}));
  out.duplicated=(state.objects.length===n0+2);
  // delete
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete'}));
  out.deleted=(state.objects.length===n0+1);
  return out;
});
console.log(JSON.stringify(res,null,1));
console.log('errors:',JSON.stringify(errs.slice(0,3)));
// offline test: reload with network blocked, should still load from SW cache
await ctx.setOffline(true);
let offlineOk=false;
try{await p.goto('http://localhost:8099/index.html',{waitUntil:'load',timeout:8000}); offlineOk=await p.evaluate(()=>typeof generateHPGL==='function');}catch(e){offlineOk='ERR:'+e.message;}
console.log('offline load works:',offlineOk);
await ctx.setOffline(false);
const pass=(res.manifestLinked&&res.manifestName&&res.display==='standalone'&&res.icons===3&&res.swRegistered&&res.nudged&&res.pasted&&res.duplicated&&res.deleted&&offlineOk===true&&errs.length===0);
console.log(pass?'ALL PWA + EDIT CHECKS PASSED':'CHECK FAILED');
await b.close();})();
