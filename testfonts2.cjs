/* 10.7.2 — the font shelf. Every embedded face must load, render real outlines,
   carry the characters a sign shop types, and sit in exactly one group. Script
   faces must WELD (overlaps merged) while block faces must not lose rings. */
const { chromium } = require('playwright');
(async()=>{
const b=await chromium.launch(); const p=await b.newPage();
p.on('dialog',d=>d.accept());
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await p.goto('file://'+process.cwd()+'/index.html',{waitUntil:'load'});
await p.waitForTimeout(700);
const r=await p.evaluate(async ()=>{
  const out={errors:[]};
  const SAMPLE="ABC abc 123 USDOT WA-1234-AB &-.,'";
  const names=Object.keys(EMBEDDED);
  out.embedded=names.length;
  // every face renders
  const bad=[];
  for(const n of names){
    try{
      const f=await getFont("emb:"+n);
      const subs=flattenOpentype(f.getPath(SAMPLE,0,0,1000,{kerning:true}));
      const pts=subs.reduce((a,s)=>a+s.length,0);
      let miss=[];
      for(const ch of SAMPLE){const g=f.charToGlyph(ch);if(!g||g.name===".notdef")miss.push(ch);}
      if(pts<50) bad.push(n+":no outlines");
      else if(miss.length) bad.push(n+":missing "+miss.join(""));
    }catch(e){bad.push(n+":"+String(e).slice(0,40));}
  }
  out.renderFailures=bad;
  // dropdown: every face present exactly once, groups labelled
  populateFonts();
  const sel=document.getElementById("fontSelect");
  const opts=[...sel.querySelectorAll("option")].filter(o=>o.value.startsWith("emb:"));
  const ids=opts.map(o=>o.value.slice(4));
  out.inDropdown=ids.length;
  out.duplicates=ids.filter((x,i)=>ids.indexOf(x)!==i);
  out.missingFromDropdown=names.filter(n=>ids.indexOf(n)<0);
  out.groups=[...sel.querySelectorAll("optgroup")].map(g=>g.label+" ("+g.children.length+")");
  // the Coast Guard mark must be on block faces and never on a script one
  const uscgOn=n=>{sel.value="emb:"+n;fontNote();return document.getElementById("fontUse").innerHTML;};
  out.blockSaysOK   = /33 CFR 173\.27/.test(uscgOn("Bebas Neue")) && /3 in/.test(uscgOn("Bebas Neue"));
  out.scriptSaysNo  = /Not for boat registration/.test(uscgOn("Pacifico Script"));
  out.stencilSaysNo = /Not for boat registration/.test(uscgOn("Saira Stencil One"));
  out.serifSaysNo   = /Not for boat registration/.test(uscgOn("Merriweather Bold"));
  out.noFakeDOTbadge = !/DOT (compliant|approved)/i.test(sel.innerHTML+document.getElementById("fontUse").innerHTML);
  // the proof-sheet group: present, first, in the customer's order, labelled
  const g0 = sel.querySelector("optgroup");
  out.firstGroup = g0 ? g0.label : null;
  out.boatOrder = g0 ? [...g0.children].map(o=>o.value.slice(4)) : [];
  out.boatLabelled = g0 ? [...g0.children].every(o=>/ — /.test(o.textContent)) : false;
  // every face on the sheet must also count as Coast Guard block
  out.boatAllUSCG = out.boatOrder.every(n=>fontIsUSCG("emb:"+n));
  // and none of the proprietary names may be shipped as a font
  out.noProprietaryFonts = ["Helvetica","Arial","Franklin Gothic","Futura","Eurostile","Impact","DIN"]
    .every(bad => !Object.keys(EMBEDDED).some(n => n.toLowerCase() === bad.toLowerCase()));
  // welding: script overlaps collapse, block faces keep their rings
  const ringcount=async(n)=>{const f=await getFont("emb:"+n);
    const raw=flattenOpentype(f.getPath("Marine Repair",0,0,1000,{kerning:true}));
    return [raw.length, weldGlyphs(raw).length];};
  const [pr,pw]=await ringcount("Pacifico Script");
  const [br,bw]=await ringcount("Bebas Neue");
  const [gr,gw]=await ringcount("Great Vibes Script");
  out.pacifico={raw:pr,welded:pw,merged:pw<pr};
  out.greatvibes={raw:gr,welded:gw,merged:gw<gr};
  out.bebas={raw:br,welded:bw,unchanged:bw===br};
  // the DOT height check reports on the real object height, both ways
  state.objects=[];state.selId=null;
  addObject([[[0,0],[100,0],[100,100],[0,100],[0,0]]],'x',1);
  const o=selected(); o.height=1.5; syncInputs();
  out.dotShort=/only 1\.50 in/.test(document.getElementById("dotUse").innerHTML);
  o.height=3; syncInputs();
  out.dotOK=/3\.00 in tall\. 49 CFR 390\.21/.test(document.getElementById("dotUse").innerHTML);
  return out;
});
r.pageErrors=errs;
console.log(JSON.stringify(r,null,1));
const EXPECT_BOAT = ["Anton","Arimo Bold","Libre Franklin Bold","Barlow Condensed Bold","Jost Bold","Chakra Petch Bold"];
const pass = r.renderFailures.length===0 && r.duplicates.length===0 &&
  r.firstGroup==="Boat lettering — the proof sheet" &&
  JSON.stringify(r.boatOrder)===JSON.stringify(EXPECT_BOAT) &&
  r.boatLabelled && r.boatAllUSCG && r.noProprietaryFonts &&
  r.missingFromDropdown.length===0 && r.inDropdown===r.embedded &&
  r.blockSaysOK && r.scriptSaysNo && r.stencilSaysNo && r.serifSaysNo &&
  r.noFakeDOTbadge && r.pacifico.merged && r.greatvibes.merged &&
  r.bebas.unchanged && r.dotShort && r.dotOK && errs.length===0;
console.log(pass?"ALL FONT SHELF CHECKS PASSED":"FAIL");
await b.close(); process.exit(pass?0:1);
})();
