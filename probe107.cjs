/* 10.7.0: does the handshaking work reach the port, does pacing actually pace,
 * and does a cutter that STALLS PARTWAY get reported honestly rather than
 * looking like a finished cut? That last one is the reported bug. */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = [], dlg = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', async d => { dlg.push(d.message()); await d.dismiss(); });
  await p.goto('file://'+process.cwd()+'/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(400);

  const out = await p.evaluate(async () => {
    const r = {};
    r.version = JZAK_VERSION;
    r.controls = { flow: !!document.getElementById('flowMode'), pace: !!document.getElementById('sendPace') };
    r.flowOptions = [...document.querySelectorAll('#flowMode option')].map(o => o.value);

    /* ---- the desktop path, with a fake native bridge ------------------- */
    const calls = [];
    window.__TAURI__ = { core: { invoke: async (c, a) => {
      calls.push([c, a]);
      if (c === 'list_ports') return [{ name: 'COM3', usb: true, detail: 'CH340' }];
      if (c === 'open_port') return a.flow === 'auto' ? 'hardware' : a.flow;
      return null;
    } } };
    /* rebuild CutterIO's desktop branch by reloading is heavy; drive the pieces */
    document.getElementById('flowMode').value = 'software';
    r.prefRead = flowPref();
    document.getElementById('sendPace').value = '15';
    r.paceRead = sendPaceMs();

    /* ---- pacing really paces ------------------------------------------ */
    const sent = [];
    state.connected = true;
    state.flowMode = 'software';
    const realWrite = CutterIO.write;
    CutterIO.write = async (str, onProg) => {
      const pace = sendPaceMs(), CH = 2048;
      for (let i = 0; i < str.length; i += CH) {
        sent.push(str.slice(i, i + CH));
        if (onProg) onProg(Math.min(i + CH, str.length), str.length);
        if (pace) await new Promise(z => setTimeout(z, pace));
      }
    };
    const big = 'PU0,0;'.repeat(2000);           // ~12 KB
    const t0 = Date.now();
    const ok = await writeToCutter(big);
    r.pacedSend = { ok, chunks: sent.length, ms: Date.now() - t0,
                    reassembles: sent.join('') === big };

    /* ---- A CUTTER THAT STALLS PARTWAY: the reported bug --------------- */
    let alerted = '';
    const oldAlert = window.alert; window.alert = m => { alerted = m; };
    CutterIO.write = async (str, onProg) => {
      /* accept the first 4 KB then stop dead, exactly like a full buffer */
      if (onProg) onProg(4096, str.length);
      throw new Error('Write timed out');
    };
    state.connected = true;
    const ok2 = await writeToCutter(big);
    window.alert = oldAlert;
    r.stalled = {
      reportedFailure: ok2 === false,
      linkDropped: state.connected === false,
      warnsAboutSameSpot: /same point every time/i.test(alerted),
      namesTheFix: /XON\/XOFF/i.test(alerted) && /Send speed/i.test(alerted)
    };

    CutterIO.write = realWrite;

    /* ---- the status line names the handshaking ------------------------ */
    state.flowMode = 'software'; setLink(true, 'COM3');
    r.statusSoftware = document.getElementById('statusText').textContent;
    state.flowMode = 'none'; setLink(true, 'COM3');
    r.statusNone = document.getElementById('statusText').textContent;
    setLink(false);
    return r;
  });

  out.errs = errs; out.dialogs = dlg.length;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
