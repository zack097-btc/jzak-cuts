/* 10.7.1 — the stall fix. Before this, one traced path was emitted as a single
   PD command up to 16,902 bytes long, which overruns the parse buffer of every
   HPGL cutter: it stops reading, our write blocks, and the job dies at the same
   point every run. Neither flow control nor send pacing can help, because the
   limit is per command. This proves commands are now short AND that splitting
   them changed no geometry. Also pins the node-editing zoom ceiling. */
const { chromium } = require('playwright');
(async()=>{
const b=await chromium.launch(); const p=await b.newPage();
p.on('dialog', d=>d.accept());
const errors=[]; p.on('pageerror',e=>errors.push('PAGEERR: '+e.message));
await p.goto('file://'+process.cwd()+'/index.html',{waitUntil:'load'}); await p.waitForTimeout(400);
const cases={};
for(const n of [3,8,50,100,500,2000]){
  const r=await p.evaluate((n)=>{
    const ring=k=>{const a=[];for(let i=0;i<=k;i++){const t=i/k*Math.PI*2;a.push([500+400*Math.cos(t),500+400*Math.sin(t)]);}return a;};
    const oldWay=(line,map)=>{const[sx,sy]=map(line[0][0],line[0][1]);
      return `PU${sx},${sy};PD`+line.slice(1).map(([x,y])=>{const[X,Y]=map(x,y);return X+","+Y;}).join(",")+";";};
    state.objects=[];state.selId=null;
    addObject([ring(n)],'r'+n,1);
    const o=selected();o.posX=1;o.posY=1;o.height=6;
    document.getElementById('weed').checked=false;
    document.getElementById('regMarks').checked=false;
    const bb=unionBBox(),map=hpglMap(bb),line=allLines()[0];
    const now=polyToHPGL(line,map),before=oldWay(line,map);
    const cmds=now.split(';').filter(Boolean);
    const nums=s=>s.replace(/P[UD]/g,',').replace(/;/g,',').split(',').filter(x=>x!=='').join(',');
    let longest=0; for(const c of cmds) if(c.length+1>longest) longest=c.length+1;
    return {commands:cmds.length,longestCmd:longest,limit:HPGL_MAX_CMD,
      withinLimit:longest<=HPGL_MAX_CMD,
      onePenUp:(now.match(/PU/g)||[]).length===1,
      everyChunkIsPD:cmds.slice(1).every(c=>c.startsWith('PD')),
      geometryIdentical:nums(now)===nums(before)};
  },n);
  cases['pts_'+n]=r;
}
const zoom=await p.evaluate(()=>{
  view.zoom=1; ACT.zin(); const oneStep=view.zoom;
  for(let i=0;i<60;i++)ACT.zin();
  const cap=view.zoom;
  view.zoom=1; for(let i=0;i<60;i++)ACT.zout();
  return {ceiling:cap,ZOOM_MAX,floor:view.zoom,zinWorks:oneStep>1};
});
const out={cases,zoom,errors};
console.log(JSON.stringify(out,null,1));
const bad=Object.entries(cases).filter(([k,v])=>!(v.withinLimit&&v.geometryIdentical&&v.onePenUp&&v.everyChunkIsPD));
const zbad=!(zoom.ceiling===400&&zoom.ZOOM_MAX===400&&zoom.zinWorks);
console.log((bad.length||zbad||errors.length)?('FAIL '+bad.map(x=>x[0]).join(',')+(zbad?' zoom':'')):'ALL COMMAND-LENGTH AND ZOOM CHECKS PASSED');
await b.close(); process.exit((bad.length||zbad||errors.length)?1:0);
})();
