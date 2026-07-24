/* End-to-end: drop a bitmap into the real app, trace it with JZTrace, and
   check the result is a real cuttable object — holes and all — that the node
   editor and the cutter output both accept. */
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
const b = await chromium.launch();
const p = await b.newPage();
const errs = [], dialogs = [];
p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
p.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
await p.waitForTimeout(500);

/* the word most likely to be cut on day one: letters with holes and thin
   strokes, rendered as a plain black-on-white bitmap */
const png = await p.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 300;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 300);
  x.fillStyle = '#000';
  x.font = 'bold 190px sans-serif';
  x.textBaseline = 'middle';
  x.fillText('JZAC 8', 40, 155);
  return c.toDataURL('image/png').split(',')[1];
});
fs.writeFileSync('/tmp/tracetest.png', Buffer.from(png, 'base64'));

await p.evaluate(b64 => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  onVecFile(new File([u], 'word.png', { type: 'image/png' }));
}, png);
await p.waitForTimeout(2500);

const R = await p.evaluate(() => {
  const out = {};
  out.engine = typeof JZTrace !== 'undefined' && JZTrace.version;
  out.potraceGone = typeof Potrace === 'undefined';
  const o = state.objects[state.objects.length - 1];
  if (!o) return Object.assign(out, { traced: false });
  out.traced = true;
  out.subpaths = o.subpaths.length;
  out.nodes = o.nodes ? o.nodes.length : 0;
  let pts = 0; o.subpaths.forEach(s => pts += s.length);
  out.points = pts;
  out.bbox = { w: +o.bbox.w.toFixed(2), h: +o.bbox.h.toFixed(2) };

  /* letters "JZAC 8" — A has one hole, C none, 8 has two: at least 8 rings */
  out.enoughRings = o.subpaths.length >= 8;

  /* holes must wind opposite the outline they sit in, or weld/offset break */
  const area = s => { let a = 0; for (let i = 0; i < s.length; i++) {
      const q = s[i], r = s[(i + 1) % s.length]; a += q[0] * r[1] - r[0] * q[1]; }
    return a / 2; };
  const signs = o.subpaths.map(s => Math.sign(area(s)));
  out.bothWindings = signs.indexOf(1) >= 0 && signs.indexOf(-1) >= 0;

  /* every ring must be a closed loop with real length */
  out.allClosed = o.subpaths.every(s => s.length > 8);

  /* the curve fit must actually be curves, not a polygon dump */
  out.avgPtsPerRing = Math.round(pts / o.subpaths.length);
  /* o.nodes is one entry per ring; the anchors live inside .pts */
  out.anchors = o.nodes ? o.nodes.reduce((a, s) => a + s.pts.length, 0) : 0;
  out.curvedAnchors = o.nodes ? o.nodes.reduce((a, s) =>
      a + s.pts.filter(q => q.hIn || q.hOut).length, 0) : 0;
  /* a real curve fit: enough anchors to hold the letters, few enough to edit,
     and most of them actually carrying handles rather than being a polygon */
  out.nodesReasonable = out.anchors > 40 && out.anchors < 900 &&
                        out.curvedAnchors > out.anchors * 0.5;

  /* retrace at a different smoothing must not throw or empty the object */
  document.getElementById('smooth').value = '6';
  traceRun(true);
  const o2 = state.objects.find(x => x.id === lastTraceId);
  out.retraced = !!(o2 && o2.subpaths.length >= 8);

  /* it has to come out of the cutter */
  const g = generateHPGL();
  out.hpglPens = g ? (g.match(/PD/g) || []).length : 0;
  out.hpglCoords = g ? (g.match(/\d+,\d+/g) || []).length : 0;
  out.hpglOk = out.hpglPens >= 8 && out.hpglCoords > 400;

  /* and it has to be editable like anything else */
  state.selected = [o2.id]; state.tool = 'node';
  out.nodeEditable = !!(o2.nodes && o2.nodes.length);
  return out;
});

console.log(JSON.stringify(R, null, 1));
console.log('dialogs:', dialogs);
console.log('errors:', errs);

/* picture of what came out, so the shape can be eyeballed too */
const shot = await p.evaluate(() => {
  const o = state.objects[state.objects.length - 1];
  if (!o) return null;
  const bb = o.bbox, W = 1000, pad = 24, sc = (W - 2 * pad) / bb.w;
  const bx = bb.minX, by = bb.minY;
  const c = document.createElement('canvas');
  c.width = W; c.height = Math.round(bb.h * sc + 2 * pad);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#c00'; x.lineWidth = 1.2; x.lineJoin = 'round';
  o.subpaths.forEach(s => { x.beginPath();
    s.forEach((q, i) => { const px = pad + (q[0] - bx) * sc, py = pad + (q[1] - by) * sc;
      i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.closePath(); x.stroke(); });
  return c.toDataURL('image/png').split(',')[1];
});
if (shot) { fs.writeFileSync('trace_word.png', Buffer.from(shot, 'base64')); console.log('wrote trace_word.png'); }

const keys = ['potraceGone','traced','enoughRings','bothWindings','allClosed','nodesReasonable','retraced','hpglOk','nodeEditable'];
const bad = keys.filter(k => !R[k]);
console.log(bad.length ? 'FAILED: ' + bad.join(', ') : 'ALL TRACE CHECKS PASSED');
await b.close();
})();
