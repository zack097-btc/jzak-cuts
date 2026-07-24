const { chromium } = require('playwright');
(async()=>{
const b=await chromium.launch(); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+process.cwd()+'/index.html',{waitUntil:'load'}); await p.waitForTimeout(400);
const res=await p.evaluate(()=>{
  const out={};
  // fresh square object 100x100 units
  state.objects=[];state.selId=null;
  addObject([[[0,0],[100,0],[100,100],[0,100],[0,0]]],'sq',4); // height 4 -> width 4 (square)
  let o=selected();
  out.initW=objWidth(o).toFixed(2); out.initH=o.height.toFixed(2);
  // widthIn should be editable (not readonly)
  out.widthEditable=!document.getElementById('widthIn').readOnly;
  out.hasLock=!!document.getElementById('lockAspect');
  // UNLOCK aspect, set width=8, height stays 4 -> independent
  document.getElementById('lockAspect').checked=false;
  document.getElementById('widthIn').value="8"; document.getElementById('widthIn').oninput();
  o=selected();
  out.afterW=objWidth(o).toFixed(2); out.afterH=o.height.toFixed(2);
  // measure actual cut polyline bbox to confirm physical width=8, height=4
  const pl=objPolylines(o); let a=1e9,c=-1e9,bb2=1e9,d=-1e9;
  pl.forEach(l=>l.forEach(([x,y])=>{if(x<a)a=x;if(x>c)c=x;if(y<bb2)bb2=y;if(y>d)d=y;}));
  out.cutW=(c-a).toFixed(2); out.cutH=(d-bb2).toFixed(2);
  // now with LOCK on, set width=2 -> height should scale to 1 (keep 2:1? currently 8x4 =2:1 ratio) -> width2 => height1
  document.getElementById('lockAspect').checked=true;
  document.getElementById('widthIn').value="2"; document.getElementById('widthIn').oninput();
  o=selected();
  out.lockW=objWidth(o).toFixed(2); out.lockH=o.height.toFixed(2);
  // HPGL still generates
  document.getElementById('weed').checked=false;document.getElementById('regMarks').checked=false;
  out.hpgl=(generateHPGL().match(/PD/g)||[]).length>0;
  return out;
});
console.log(JSON.stringify(res,null,1));
console.log('errors:',JSON.stringify(errs.slice(0,3)));
const a=[];
if(!res.widthEditable)a.push('width still readonly');
if(!res.hasLock)a.push('no lock toggle');
if(res.afterW!=="8.00"||res.afterH!=="4.00")a.push('independent set failed W='+res.afterW+' H='+res.afterH);
if(res.cutW!=="8.00"||res.cutH!=="4.00")a.push('cut geometry wrong W='+res.cutW+' H='+res.cutH);
if(res.lockW!=="2.00"||res.lockH!=="1.00")a.push('locked aspect failed W='+res.lockW+' H='+res.lockH);
if(!res.hpgl)a.push('no HPGL');
if(errs.length)a.push('errors');
console.log(a.length?'FAIL: '+a.join(' | '):'ALL WIDTH CHECKS PASSED');
await b.close();})();
