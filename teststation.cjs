/* The trace station: load a photo, and the panel must STAY on screen with a
   live preview you can drive with filters and despeckle, retracing in place.
   This is the bug the user hit — the panel used to vanish the instant the first
   automatic trace landed, so the filters were unreachable. */
const {chromium} = require('playwright');
(async () => {
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1500,height:950}});
const errs=[]; p.on('pageerror', e=>errs.push(String(e)));
const dialogs=[]; p.on('dialog', d=>{dialogs.push(d.message()); d.accept();});
await p.goto('file:///home/claude/jzak-cuts/index.html');
await p.waitForTimeout(500);

const R = await p.evaluate(async () => {
  localStorage.clear(); state.objects=[]; state.selIds=[];
  const out={}, wait=ms=>new Promise(r=>setTimeout(r,ms));

  /* a grubby photo: two colored blobs on a beige backdrop, with pepper noise
     so despeckle and denoise have something real to do */
  const W=520,H=380,c=document.createElement("canvas");c.width=W;c.height=H;
  const g=c.getContext("2d");
  g.fillStyle="#d8d2c4";g.fillRect(0,0,W,H);
  g.fillStyle="#c0281f";g.beginPath();g.arc(170,190,95,0,7);g.fill();
  g.fillStyle="#1f4f9c";g.fillRect(300,110,150,160);
  for(let i=0;i<900;i++){g.fillStyle=Math.random()<.5?"#000":"#fff";
    g.fillRect(Math.random()*W|0,Math.random()*H|0,1,1);}
  const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",0.7));
  onVecFile(new File([blob],"photo.jpg",{type:"image/jpeg"}));
  await wait(2200);

  /* 1. the station is visible and stayed visible after the auto-trace */
  out.toolAfterLoad=state.tool;
  out.panelVisible=getComputedStyle($("panelImport")).display!=="none";
  out.ctlVisible=getComputedStyle($("traceCtl")).display!=="none";
  out.tracedObjects=state.objects.length;

  /* 2. the live preview canvas actually drew something */
  const px=()=>{const cv=$("tracePrev"),d=cv.getContext("2d").getImageData(0,0,cv.width,cv.height).data;
    let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>8)n++;return n;};
  tracePreviewRender();
  out.prevInk=px();
  out.prevInfo=$("tracePrevInfo").textContent;

  /* 3. photo view differs from result view */
  $("tpvPhoto").click(); await wait(30);
  out.photoInk=px(); out.photoWhat=$("tracePrevWhat").textContent;
  $("tpvResult").click(); await wait(30);

  /* 4. filters are non-destructive: crank them, reset, get the original back */
  const sig=im=>{let s=0;for(let i=0;i<im.data.length;i+=997)s=(s*31+im.data[i])>>>0;return s;};
  const src0=sig(traceSource);
  $("tfBright").value="55";$("tfContrast").value="60";$("tfBlur").value="2";$("tfSharp").value="40";
  traceFilterLabels();
  const filt=traceFiltered(traceSource);
  out.filterChanged = sig(filt)!==src0;
  out.sourcePristine = sig(traceSource)===src0;      /* never written to */
  out.filterState=$("tfState").textContent.trim();
  traceFiltersReset(true);
  out.resetClean = !traceFiltersActive() && sig(traceFiltered(traceSource))===src0;

  /* 5. drop-the-background actually whitens the beige backdrop */
  $("tfKillBg").checked=true;$("tfBgTol").value="24";traceFilterLabels();
  const kb=traceFiltered(traceSource);
  out.cornerWhite = kb.data[0]===255 && kb.data[1]===255 && kb.data[2]===255;
  out.bgRowShown = getComputedStyle($("tfBgRow")).display!=="none";
  $("tfKillBg").checked=false;traceFilterLabels();

  /* 6. despeckle is honored — one big square plus twelve deliberate specks.
        Zero despeckle keeps all thirteen loops; a generous one keeps the square. */
  {
    const c2=document.createElement("canvas");c2.width=400;c2.height=300;
    const g2=c2.getContext("2d");g2.fillStyle="#fff";g2.fillRect(0,0,400,300);
    g2.fillStyle="#000";g2.fillRect(60,60,180,180);
    for(let i=0;i<12;i++)g2.fillRect(300,20+i*22,3,3);   /* 9 px specks */
    const spk=g2.getImageData(0,0,400,300);
    const mode=$("traceMode").value;$("traceMode").value="bw";
    const loops=r=>r&&r.layers?r.layers.reduce((s,L)=>s+((L.d||"").match(/M/g)||[]).length,0):-1;
    out.loopsNoDespeckle=loops(traceCompute(spk,0));
    out.loopsHeavyDespeckle=loops(traceCompute(spk,40));
    $("traceMode").value=mode;
    out.despeckleWorks = out.loopsNoDespeckle>=13 && out.loopsHeavyDespeckle===1;
  }

  /* 7. re-trace stays in the station; Place on Mat hands back to Select */
  const before=state.objects.length;
  $("retraceBtn").click(); await wait(600);
  out.afterRetraceTool=state.tool;
  out.afterRetracePanel=getComputedStyle($("panelImport")).display!=="none";
  out.noPileUp = state.objects.length<=before;      /* re-trace replaces, never stacks */
  $("tracePlaceBtn").click(); await wait(600);
  out.afterPlaceTool=state.tool;
  out.placedObjects=state.objects.length;

  /* 8. preview despeckle is scaled — a small copy exists and is smaller */
  out.prevSmaller = !!tracePrevSrc && tracePrevSrc.width<=900 && tracePrevSrc.width<traceSource.width+1;
  return out;
});
console.log(JSON.stringify(R,null,1));
console.log('dialogs:',dialogs);
console.log('errors:',errs);
const ok = R.toolAfterLoad==="import" && R.panelVisible && R.ctlVisible && R.tracedObjects>=1 &&
           R.prevInk>200 && /pts/.test(R.prevInfo) && R.photoInk>200 && R.photoWhat==="Filtered photo" &&
           R.filterChanged && R.sourcePristine && R.filterState==="— on" && R.resetClean &&
           R.cornerWhite && R.bgRowShown && R.despeckleWorks &&
           R.afterRetraceTool==="import" && R.afterRetracePanel && R.noPileUp &&
           R.afterPlaceTool==="select" && R.placedObjects>=1 && R.prevSmaller &&
           !dialogs.length && !errs.length;
console.log(ok?'TRACE STATION CHECKS PASSED':'FAILED');
await b.close(); process.exit(ok?0:1);
})();
