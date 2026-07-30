/* Regression test for SVG import in physical units.
 *
 * getTotalLength() reports arc length in the SVG's own USER UNITS. A fixed
 * sampling step of "0.4" is four tenths of a pixel in a 96-unit-per-inch file
 * and four tenths of an INCH in a file authored in inches — and at that step a
 * small path yields one sample and gets discarded for having fewer than two
 * points. Inch- and millimetre-authored SVGs are exactly what Illustrator,
 * Inkscape and our own multi-colour templates produce, so this pins it down:
 * the same drawing must import with the same path count and the same physical
 * size whether it is written in inches, millimetres, or pixels.
 */
const { chromium } = require('playwright');

/* one 2in square plus two 0.05in specks, expressed three ways. Every version
   is 4in x 4in overall with the square at 1,1 and the specks near 3.5,3.5. */
function svgIn(){ return `<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="4in" viewBox="0 0 4 4">
<path d="M1 1H3V3H1Z"/><path d="M3.4 3.4h0.05v0.05h-0.05Z"/><path d="M3.6 3.6h0.05v0.05h-0.05Z"/></svg>`; }
function svgMm(){ const k=25.4; const f=v=>+(v*k).toFixed(4);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="101.6mm" height="101.6mm" viewBox="0 0 ${f(4)} ${f(4)}">
<path d="M${f(1)} ${f(1)}H${f(3)}V${f(3)}H${f(1)}Z"/><path d="M${f(3.4)} ${f(3.4)}h${f(.05)}v${f(.05)}h-${f(.05)}Z"/><path d="M${f(3.6)} ${f(3.6)}h${f(.05)}v${f(.05)}h-${f(.05)}Z"/></svg>`; }
function svgPx(){ const k=96; const f=v=>+(v*k).toFixed(4);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="4in" viewBox="0 0 ${f(4)} ${f(4)}">
<path d="M${f(1)} ${f(1)}H${f(3)}V${f(3)}H${f(1)}Z"/><path d="M${f(3.4)} ${f(3.4)}h${f(.05)}v${f(.05)}h-${f(.05)}Z"/><path d="M${f(3.6)} ${f(3.6)}h${f(.05)}v${f(.05)}h-${f(.05)}Z"/></svg>`; }

const CASES = [['inches', svgIn()], ['millimetres', svgMm()], ['pixels', svgPx()]];
const EXPECT_SUBPATHS = 3;           /* the two specks are artwork, not noise */
const EXPECT_W = 2.65, EXPECT_H = 2.65;   /* 1.0 .. 3.65 inches */

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [], dialogs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const got = {};
  for(const [label, text] of CASES){
    await page.evaluate(t => onVecFile(new File([t], 'u.svg', {type:'image/svg+xml'})), text);
    await page.waitForTimeout(900);
    got[label] = await page.evaluate(() => {
      const o = state.objects[state.objects.length - 1];
      return { subpaths:o.subpaths.length, w:+o.width.toFixed(2), h:+o.height.toFixed(2) };
    });
  }
  await browser.close();

  const fails = [];
  for(const [label] of CASES){
    const g = got[label];
    if(g.subpaths !== EXPECT_SUBPATHS)
      fails.push(label + ': ' + g.subpaths + ' subpaths, want ' + EXPECT_SUBPATHS + ' (small paths dropped)');
    if(Math.abs(g.w - EXPECT_W) > 0.03 || Math.abs(g.h - EXPECT_H) > 0.03)
      fails.push(label + ': size ' + g.w + 'x' + g.h + ' in, want ' + EXPECT_W + 'x' + EXPECT_H);
  }
  if(errs.length) fails.push('page errors: ' + errs.join(' | '));
  if(dialogs.length) fails.push('unexpected dialogs: ' + dialogs.join(' | '));

  console.log(JSON.stringify(got, null, 1));
  if(fails.length){ console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('ALL SVG-UNIT CHECKS PASSED');
})();
