/* Real-artwork check for the 10.5.1 .studio3 decoder.
 *
 * donkeymudd.studio3 is the customer file that exposed the bug: it holds 239
 * paths and the old byte-scan decoder returned 106 of them plus two straight
 * seams slashed across the drawing. This imports the actual file through the
 * real app and reports what comes back, so the claim in the fix package is
 * checked against artwork rather than against a synthesised fixture.
 *
 * A "seam" here is a single straight segment long enough to cross a meaningful
 * slice of the design — the visual signature of a phantom record joining two
 * unrelated parts of the artwork.
 */
const { chromium } = require('playwright');
const fs = require('fs');

const FILE = process.argv[2] || 'donkeymudd.studio3';

(async () => {
  const bytes = Array.from(fs.readFileSync(FILE));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [], dialogs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const before = await page.evaluate(() => state.objects.length);

  await page.evaluate(({ b, name }) => {
    const u8 = new Uint8Array(b);
    window.__lastStudioBuf = u8.buffer;   /* so the record count can be re-read */
    onVecFile(new File([u8], name, { type: 'application/octet-stream' }));
  }, { b: bytes, name: FILE });

  /* a half-megabyte file with hundreds of paths needs room to land */
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() => state.objects.length);
    if (n > before) break;
    await page.waitForTimeout(500);
  }

  const res = await page.evaluate(() => {
    const o = state.objects[state.objects.length - 1];
    if (!o) return null;
    /* Two counts, and they are allowed to differ. studioRecords reports what
       the file actually contains; state.objects reports what survived as
       cuttable geometry. This file holds two specks whose whole bounding box
       is under a thousandth of an inch — smaller than the blade kerf — and the
       object builder drops them. That is correct, so the record count is the
       one that proves the decoder, and the subpath count is checked separately
       against it with that tiny allowance. */
    /* longest straight run in each subpath, in inches, and the overall size */
    let worst = 0, worstAt = null;
    for (const sp of o.subpaths) {
      for (let i = 1; i < sp.length; i++) {
        const dx = sp[i][0] - sp[i - 1][0], dy = sp[i][1] - sp[i - 1][1];
        const d = Math.hypot(dx, dy);
        if (d > worst) { worst = d; worstAt = [sp[i - 1], sp[i]]; }
      }
    }
    let records = -1, uncuttable = -1;
    try {
      const recs = studioRecords(window.__lastStudioBuf);
      records = recs.length;
      uncuttable = recs.filter(pts => {
        let a = 1e9, c = -1e9, b = 1e9, d = -1e9;
        for (const q of pts) { if (q.x < a) a = q.x; if (q.x > c) c = q.x; if (q.y < b) b = q.y; if (q.y > d) d = q.y; }
        return ((c - a) + (d - b)) / 25.4 < 0.001;
      }).length;
    } catch (e) {}
    return {
      records, uncuttable,
      subpaths: o.subpaths.length,
      points: o.subpaths.reduce((a, s) => a + s.length, 0),
      w: +o.width.toFixed(3), h: +o.height.toFixed(3),
      longestStraight: +worst.toFixed(3), worstAt
    };
  });

  await browser.close();

  if (!res) { console.log('FAILED: nothing imported'); process.exit(1); }
  console.log(JSON.stringify(res, null, 1));
  if (errs.length) console.log('page errors: ' + errs.join(' | '));
  if (dialogs.length) console.log('dialogs: ' + dialogs.join(' | '));

  const fails = [];
  if (res.records !== 239)
    fails.push('decoder found ' + res.records + ' records, want 239');
  if (res.subpaths !== res.records - res.uncuttable)
    fails.push(res.subpaths + ' cuttable subpaths but ' + res.records + ' records minus '
      + res.uncuttable + ' sub-thousandth specks = ' + (res.records - res.uncuttable));
  /* the seams were roughly the width of the whole drawing; anything over a
     third of the design span is not a real edge in this artwork */
  const span = Math.max(res.w, res.h);
  if (res.longestStraight > span / 3)
    fails.push('straight run of ' + res.longestStraight + ' in across a ' + span + ' in design — seam still present');
  if (errs.length) fails.push('page errors');

  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('DONKEY FILE OK — ' + res.subpaths + ' paths, no seams');
})();
