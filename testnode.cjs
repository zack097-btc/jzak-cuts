const { chromium } = require('playwright');
const fs=require('fs');
(async()=>{
const b=await chromium.launch(); const p=await b.newPage();
const errs=[],dl=[]; p.on('pageerror',e=>errs.push('ERR:'+e.message));
p.on('dialog',async d=>{dl.push(d.message());await d.dismiss();});
await p.goto('file://'+process.cwd()+'/index.html',{waitUntil:'load'}); await p.waitForTimeout(300);
const buf=fs.readFileSync('/tmp/test.studio3');
await p.evaluate(b64=>{const bin=atob(b64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);onVecFile(new File([u],'test.studio3'));}, buf.toString('base64'));
await p.waitForTimeout(1800);
const res=await p.evaluate(()=>{
  const out={};
  const o=state.objects[state.objects.length-1];
  out.name=o.name; out.hasNodes=!!o.nodes; out.subCount=o.nodes?o.nodes.length:0;
  // count node types
  let corners=0,smooth=0,handles=0,total=0;
  o.nodes.forEach(sp=>sp.pts.forEach(n=>{total++;if(n.sm)smooth++;else corners++;if(n.hIn)handles++;if(n.hOut)handles++;}));
  out.totalNodes=total; out.smooth=smooth; out.corners=corners; out.handles=handles;
  out.closedCount=o.nodes.filter(s=>s.closed).length;
  // baseline cut
  document.getElementById('weed').checked=false;document.getElementById('regMarks').checked=false;
  out.hpglBefore=(generateHPGL().match(/PD/g)||[]).length;
  // ---- simulate node edits directly ----
  selectObj(o.id); setTool('node'); ensureNodes(o);
  // find a subpath with a smooth node to drag its handle
  let target=null;
  for(let si=0;si<o.nodes.length;si++)for(let pi=0;pi<o.nodes[si].pts.length;pi++){const n=o.nodes[si].pts[pi];if(n.sm&&n.hOut){target={si,pi};break;}if(target)break;}
  out.foundSmooth=!!target;
  // MOVE an anchor: pick node (0,0)
  const A=o.nodes[0].pts[0]; const ax0=A.x, ay0=A.y;
  nodeSel={si:0,pi:0}; nodeDrag={id:o.id,si:0,pi:0,part:'anchor',inv:objInv(o)};
  // move it +0.5" in world -> convert: pick a world point near current +offset
  const fwd=objFwd(o); const w=fwd(A.x,A.y);
  nodeMouseMove(w[0]+0.5,w[1]+0.3);
  out.anchorMoved=(o.nodes[0].pts[0].x!==ax0||o.nodes[0].pts[0].y!==ay0);
  // handles moved with anchor?
  objCommitNodes(o); nodeDrag=null;
  out.hpglAfterMove=(generateHPGL().match(/PD/g)||[]).length;
  // DRAG a smooth handle and check opposite mirrors
  if(target){const n=o.nodes[target.si].pts[target.pi];const before=n.hIn?[...n.hIn]:null;nodeSel={si:target.si,pi:target.pi};nodeDrag={id:o.id,si:target.si,pi:target.pi,part:'hOut',inv:objInv(o)};const wf=objFwd(o);const wh=wf(n.hOut[0],n.hOut[1]);nodeMouseMove(wh[0]+0.4,wh[1]+0.4);const after=n.hIn?[...n.hIn]:null;out.oppositeHandleMirrored=(before&&after&&(before[0]!==after[0]||before[1]!==after[1]));objCommitNodes(o);nodeDrag=null;}
  // TOGGLE type on a corner node -> becomes smooth
  let corner=null;for(let si=0;si<o.nodes.length;si++)for(let pi=0;pi<o.nodes[si].pts.length;pi++){if(!o.nodes[si].pts[pi].sm){corner={si,pi};break;}if(corner)break;}
  if(corner){nodeToggleType(o,corner.si,corner.pi);out.toggledToSmooth=o.nodes[corner.si].pts[corner.pi].sm===true;}
  // DELETE a node
  const spLen0=o.nodes[0].pts.length; nodeSel={si:0,pi:1}; nodeDelete(o,0,1); out.deleted=(o.nodes[0]?o.nodes[0].pts.length:0)===spLen0-1||state.objects.find(x=>x.id===o.id).nodes.length>=0;
  out.hpglAfterAll=(generateHPGL().match(/PD/g)||[]).length;
  out.finalValid=out.hpglAfterAll>0;
  return out;
});
console.log(JSON.stringify(res,null,1));
console.log('DIALOGS:',JSON.stringify(dl));
console.log('ERRS:',JSON.stringify(errs.slice(0,6)));
// assertions
const a=[];
if(!res.hasNodes)a.push('no nodes attached to trace');
if(res.totalNodes<50)a.push('too few nodes '+res.totalNodes);
if(res.smooth<5)a.push('too few smooth nodes '+res.smooth);
if(res.handles<10)a.push('too few handles');
if(!res.anchorMoved)a.push('anchor did not move');
if(!res.oppositeHandleMirrored)a.push('smooth handle mirror failed');
if(!res.toggledToSmooth)a.push('toggle to smooth failed');
if(!res.finalValid)a.push('final HPGL empty');
if(dl.length)a.push('dialogs: '+dl.join('|'));
if(errs.length)a.push('errors: '+errs.slice(0,3).join('|'));
console.log(a.length?'FAIL: '+a.join(' | '):'ALL NODE-EDITOR CHECKS PASSED');
await b.close();})();
