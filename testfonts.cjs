const { chromium } = require('playwright');
(async()=>{
const b=await chromium.launch(); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+process.cwd()+'/index.html',{waitUntil:'load'}); await p.waitForTimeout(400);
const res=await p.evaluate(async()=>{
  const out={count:Object.keys(window.EMBEDDED_FONTS||{}).length, options:[], built:[], failed:[]};
  const sel=document.getElementById('fontSelect');
  out.options=[...sel.options].map(o=>o.value);
  for(const id of out.options){
    if(!id.startsWith('emb:'))continue;
    try{const f=await getFont(id);const path=f.getPath("JZD ABC 123",0,0,100);out.built.push(id.slice(4)+':'+(path.commands.length>0));}
    catch(e){out.failed.push(id.slice(4)+':'+e.message);}
  }
  // ensure no cdn options remain
  out.cdnOptions=out.options.filter(o=>o.startsWith('cdn:'));
  return out;
});
console.log('embedded count:',res.count);
console.log('built ok:',res.built.length,'-',res.built.join(', '));
console.log('failed:',JSON.stringify(res.failed));
console.log('cdn options remaining:',JSON.stringify(res.cdnOptions));
console.log('errors:',JSON.stringify(errs.slice(0,3)));
/* This used to demand EXACTLY fifteen faces, which was true the day it was
   written and wrong from the first font pack onwards — it has been failing on
   a correct product ever since. The real requirements are: the shelf is not
   empty, every face on it actually builds, none fails, and nothing is still
   being fetched from a CDN (a font the shop cannot cut offline is not a font
   the shop has). testfonts2.cjs checks the shelf's CONTENTS; this checks that
   every one of them works. */
const ok = res.count >= 15
        && res.built.length === res.count
        && res.failed.length === 0
        && res.cdnOptions.length === 0
        && errs.length === 0;
console.log(ok ? 'ALL FONTS PASS' : 'CHECK FAILED');
await b.close();})();
