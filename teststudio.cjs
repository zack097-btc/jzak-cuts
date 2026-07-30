/* Regression test for the .studio3 record decoder.
 *
 * This decoder has now been wrong twice in ways that were invisible on screen —
 * once dropping the last anchor of every path, once losing more than half the
 * paths in a file to phantom records — so it gets a test that pins the byte
 * layout down instead of trusting the eye.
 *
 * The fixture is SYNTHESISED here rather than committed as a customer file, so
 * the repository carries no one's artwork and the expected numbers are exact by
 * construction.
 *
 *   record = [8 zero bytes][float32 junk]
 *            [02 00 00 00 00 01]      literal marker
 *            [uint32 A = B + 8]
 *            [00 00 00 00]
 *            [uint32 B = 4 + pointBytes + 5]
 *            [uint8 closed]
 *            [int32 field = anchorCount - 1]
 *            [anchors][5 byte trailer]
 *
 *   anchor = [float32 x][float32 y]
 *            [uint8 1][float32 dx][float32 dy]  in-handle,  or [uint8 0]
 *            [uint8 1][float32 dx][float32 dy]  out-handle, or [uint8 0]
 *
 * Coordinates are millimetres; the importer divides by 25.4, so every value
 * below is a whole number of inches on purpose.
 */
const { chromium } = require('playwright');

const MM = 25.4;
function buildStudio3(records){
  const parts = [Buffer.from('silhouette05;')];        // plausible file header
  for(const rec of records){
    const pts = [];
    for(const a of rec.anchors){
      const b = [Buffer.alloc(8)];
      b[0].writeFloatLE(a.x * MM, 0);
      b[0].writeFloatLE(a.y * MM, 4);
      for(const h of [a.hIn, a.hOut]){
        if(h){ const q = Buffer.alloc(9); q[0] = 1; q.writeFloatLE(h[0], 1); q.writeFloatLE(h[1], 5); b.push(q); }
        else { b.push(Buffer.from([0])); }
      }
      pts.push(Buffer.concat(b));
    }
    const body = Buffer.concat(pts);
    const B = 4 + body.length + 5;
    const head = Buffer.alloc(12 + 6 + 4 + 4 + 4 + 1 + 4);
    let o = 0;
    head.fill(0, 0, 8); o = 8;
    head.writeFloatLE(1.25, o); o += 4;                 // the per-path float
    Buffer.from([2,0,0,0,0,1]).copy(head, o); o += 6;    // marker
    head.writeUInt32LE(rec.badLength ? B + 8 + 3 : B + 8, o); o += 4;   // A
    head.writeUInt32LE(0, o); o += 4;
    head.writeUInt32LE(rec.badLength ? B + 3 : B, o); o += 4;           // B
    head.writeUInt8(rec.closed ? 1 : 0, o); o += 1;
    head.writeInt32LE(rec.anchors.length - 1, o);
    parts.push(head, body, Buffer.from([1, 0x2a, 0x87, 2, 0]));
  }
  return Buffer.concat(parts);
}

/* three paths: a plain closed square, an open two-segment stroke with handles,
   and a closed curve where every anchor carries both handles */
const RECORDS = [
  { closed:true, anchors:[
      {x:1,y:1},{x:2,y:1},{x:2,y:2},{x:1,y:2} ] },
  { closed:false, anchors:[
      {x:4,y:1,hOut:[3,0]},{x:5,y:1,hIn:[-3,0],hOut:[3,0]},{x:6,y:2,hIn:[0,-3]} ] },
  { closed:true, anchors:[
      {x:1,y:4,hIn:[-2,-2],hOut:[2,2]},{x:3,y:4,hIn:[-2,2],hOut:[2,-2]},
      {x:3,y:6,hIn:[2,-2],hOut:[-2,2]},{x:1,y:6,hIn:[2,2],hOut:[-2,-2]} ] },
];
const EXPECT_PATHS  = 3;
const EXPECT_ANCHORS = 4 + 3 + 4;   // 11 — the bug that dropped the last anchor of each would give 8

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [], dialogs = [];
  page.on('pageerror', e => errs.push('ERR:' + e.message));
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const good = buildStudio3(RECORDS);
  /* a fourth record whose length field does NOT reconcile — the decoder must
     refuse it rather than import a garbage path */
  const withDecoy = buildStudio3(RECORDS.concat([
    { closed:true, badLength:true, anchors:[{x:9,y:9},{x:10,y:9},{x:10,y:10}] } ]));

  async function importBuf(buf, name){
    return page.evaluate(([b64, nm]) => {
      const bin = atob(b64), u = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
      onVecFile(new File([u], nm));
      return null;
    }, [buf.toString('base64'), name]);
  }

  await importBuf(good, 'fixture.studio3');
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    const o = state.objects[state.objects.length - 1];
    const subs = o.nodes || [];
    let anchors = 0;
    subs.forEach(s => anchors += s.pts.length);
    let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
    subs.forEach(s => s.pts.forEach(p => {
      if(p.x<mnx)mnx=p.x; if(p.x>mxx)mxx=p.x; if(p.y<mny)mny=p.y; if(p.y>mxy)mxy=p.y; }));
    return { name:o.name, subs:subs.length, anchors,
             closed: subs.map(s => !!s.closed),
             sizeIn: [ +(mxx-mnx).toFixed(3), +(mxy-mny).toFixed(3) ],
             hpgl: (generateHPGL().match(/PD/g)||[]).length };
  });

  await importBuf(withDecoy, 'decoy.studio3');
  await page.waitForTimeout(1200);
  const r2 = await page.evaluate(() => {
    const o = state.objects[state.objects.length - 1];
    return { subs:(o.nodes||[]).length };
  });

  await browser.close();

  const fails = [];
  const eq = (label, got, want) => { if(JSON.stringify(got) !== JSON.stringify(want))
      fails.push(label + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); };

  eq('subpath count', r.subs, EXPECT_PATHS);
  eq('anchor count (last-anchor-per-path regression)', r.anchors, EXPECT_ANCHORS);
  eq('closed flags read from the header', r.closed, [true, false, true]);
  /* anchors span x 1..6 and y 1..6 -> 5 x 5 inches. Handles may bow outside the
     hull but anchors are what the node editor holds. */
  eq('anchor bounding size in inches', r.sizeIn, [5, 5]);
  if(!(r.hpgl > 0)) fails.push('cut output empty: PD count ' + r.hpgl);
  eq('decoy record with a non-reconciling length is refused', r2.subs, EXPECT_PATHS);
  if(errs.length) fails.push('page errors: ' + errs.join(' | '));
  if(dialogs.length) fails.push('unexpected dialogs: ' + dialogs.join(' | '));

  console.log(JSON.stringify({ ...r, decoySubs: r2.subs }, null, 1));
  if(fails.length){ console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('ALL .STUDIO3 RECORD-DECODE CHECKS PASSED');
})();
