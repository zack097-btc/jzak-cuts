/* Detachable tool panels. The panels are MOVED to a second window, not copied,
   so the things to prove are: the node really leaves the dock and arrives next
   door, $() still finds it, the listeners wired at startup still fire from over
   there, and closing the window brings everything home instead of losing it. */
const {chromium} = require('playwright');
(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({viewport:{width:1500,height:950}});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror', e=>errs.push('main: '+e));
const dialogs=[]; p.on('dialog', d=>{dialogs.push(d.message()); d.accept();});
await p.goto('file:///home/claude/jzak-cuts/index.html');
await p.waitForTimeout(500);

const out={};
await p.evaluate(()=>{localStorage.clear();state.objects=[];state.selIds=[];});

/* detach the Material panel — a real second window must appear */
const [pop] = await Promise.all([
  ctx.waitForEvent('page'),
  p.evaluate(()=>popDetach("panelMaterial"))
]);
pop.on('pageerror', e=>errs.push('popup: '+e));
await p.waitForTimeout(300);

out.popupOpened = !!pop;
out.movedOut = await p.evaluate(()=>!document.querySelector("#dock > #panelMaterial"));
out.placeholder = await p.evaluate(()=>!!document.getElementById("popHole_panelMaterial"));
out.arrived = await pop.evaluate(()=>!!document.querySelector("#popHost > #panelMaterial"));
out.noteHidden = await pop.evaluate(()=>document.getElementById("popNote").style.display==="none");
/* $() must reach across, and the styles must have come with it */
out.dollarFinds = await p.evaluate(()=>!!$("matWidth") && $("matWidth").ownerDocument!==document);
out.styled = await pop.evaluate(()=>{
  const h=document.querySelector("#panelMaterial h3");
  return h && getComputedStyle(h).fontSize!=="" && getComputedStyle(document.body).margin==="0px";});
out.saved = await p.evaluate(()=>JSON.parse(localStorage.getItem("jzakcuts.pop")||"[]").includes("panelMaterial"));

/* a control that lives over there must still drive the app over here */
await pop.evaluate(()=>{const e=document.getElementById("matWidth");e.value="13";
  e.dispatchEvent(new Event("input",{bubbles:true}));});
await p.waitForTimeout(120);
out.remoteControlWorks = await p.evaluate(()=>parseFloat($("matWidth").value)===13);

/* a second panel joins the same window rather than opening another */
const before = ctx.pages().length;
await p.evaluate(()=>popDetach("panelJobs"));
await p.waitForTimeout(250);
out.oneWindowOnly = ctx.pages().length===before;
out.bothThere = await pop.evaluate(()=>document.querySelectorAll("#popHost > .grp").length===2);

/* Bring back one from the dock's placeholder button */
await p.evaluate(()=>document.querySelector("#popHole_panelJobs button").click());
await p.waitForTimeout(200);
out.broughtBack = await p.evaluate(()=>!!document.querySelector("#dock > #panelJobs") && !document.getElementById("popHole_panelJobs"));

/* closing the window must send the rest home, not destroy them */
await pop.close();
await p.waitForTimeout(1400);
out.homeAfterClose = await p.evaluate(()=>!!document.querySelector("#dock > #panelMaterial"));
out.noHolesLeft = await p.evaluate(()=>document.querySelectorAll(".popEmpty").length===0);
out.stateCleared = await p.evaluate(()=>{const r=JSON.parse(localStorage.getItem("jzakcuts.pop")||"[]");return r.length===0;});
out.stillWorks = await p.evaluate(()=>{$("matWidth").value="24";
  $("matWidth").dispatchEvent(new Event("input",{bubbles:true}));draw();return state.tool==="select";});
out.buttonReset = await p.evaluate(()=>{
  const btn=document.querySelector("#panelMaterial h3 .popbtn");return !!btn && !btn.classList.contains("out");});

console.log(JSON.stringify(out,null,1));
console.log('dialogs:',dialogs);
console.log('errors:',errs);
const ok = Object.keys(out).every(k=>out[k]===true) && !dialogs.length && !errs.length;
console.log(ok?'DETACH CHECKS PASSED':'FAILED: '+Object.keys(out).filter(k=>out[k]!==true).join(', '));
await b.close(); process.exit(ok?0:1);
})();
