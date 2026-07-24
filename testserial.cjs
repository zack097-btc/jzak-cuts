/* The cutter can be reached two ways — Web Serial in a browser, a real COM
   port in the installed desktop app. Both have to behave identically from the
   app's side, so both are exercised here. The desktop side is checked by
   standing in a fake bridge before the page loads, exactly where Tauri puts
   the real one. */
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const fails = [];
  const note = (c, m) => { if (!c) fails.push(m); };

  /* ---- 1. browser: Web Serial branch ---------------------------------- */
  {
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
    await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({
      desktop: DESKTOP,
      label: CutterIO.label,
      supported: CutterIO.supported(),
      hasSerial: 'serial' in navigator,
      warnShown: document.getElementById('serialWarn').classList.contains('show'),
      connectDisabled: document.getElementById('connectBtn').disabled
    }));
    console.log('browser:', JSON.stringify(r));
    note(r.desktop === false, 'browser branch thinks it is the desktop app');
    note(r.label === 'Web Serial', 'browser transport label is ' + r.label);
    note(r.supported === r.hasSerial, 'supported() disagrees with navigator.serial');
    /* headless Chromium has no Web Serial, so the warning must be up and the
       Connect button must be off — that is the graceful-degradation path */
    note(r.warnShown === !r.hasSerial, 'serial warning shown when it should not be');
    note(r.connectDisabled === !r.hasSerial, 'Connect button state wrong');
    note(errs.length === 0, 'browser JS errors: ' + errs.join(' | '));
    await p.close();
  }

  /* ---- 2. desktop: native COM-port branch, one port present ------------ */
  {
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
    await p.addInitScript(() => {
      window.__NATIVE_CALLS__ = [];
      window.__TAURI__ = { core: { invoke: (cmd, args) => {
        window.__NATIVE_CALLS__.push([cmd, args]);
        if (cmd === 'list_ports') return Promise.resolve([{ name: 'COM4', usb: true, detail: 'USB-SERIAL CH340' }]);
        return Promise.resolve(null);
      } } };
    });
    await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    const r = await p.evaluate(async () => {
      const before = {
        desktop: DESKTOP, label: CutterIO.label, supported: CutterIO.supported(),
        warnShown: document.getElementById('serialWarn').classList.contains('show'),
        connectDisabled: document.getElementById('connectBtn').disabled
      };
      await connect();
      const after = {
        connected: state.connected,
        status: document.getElementById('statusText').textContent,
        dotOn: document.getElementById('dot').classList.contains('on'),
        sendEnabled: !document.getElementById('sendBtn').disabled
      };
      await writeToCutter('IN;SP1;');
      return { before, after, calls: window.__NATIVE_CALLS__ };
    });
    console.log('desktop:', JSON.stringify(r));
    note(r.before.desktop === true, 'desktop branch not taken with the bridge present');
    note(r.before.label === 'USB serial', 'desktop transport label is ' + r.before.label);
    note(r.before.supported === true, 'desktop transport reports unsupported');
    note(r.before.warnShown === false, 'desktop app shows the browser-only warning');
    note(r.before.connectDisabled === false, 'desktop app disables Connect');
    note(r.after.connected === true, 'desktop connect did not take');
    note(/COM4/.test(r.after.status), 'status line does not name the port: ' + r.after.status);
    note(r.after.dotOn && r.after.sendEnabled, 'connected UI did not light up');
    const names = r.calls.map(c => c[0]);
    note(JSON.stringify(names) === JSON.stringify(['list_ports', 'open_port', 'write_port']),
         'native call order wrong: ' + names.join(','));
    const open = r.calls.find(c => c[0] === 'open_port');
    note(open && open[1].name === 'COM4' && open[1].baud === 9600,
         'open_port args wrong: ' + JSON.stringify(open && open[1]));
    const wr = r.calls.find(c => c[0] === 'write_port');
    note(wr && wr[1].data === 'IN;SP1;', 'write_port payload wrong: ' + JSON.stringify(wr && wr[1]));
    note(errs.length === 0, 'desktop JS errors: ' + errs.join(' | '));
    await p.close();
  }

  /* ---- 3. desktop with no ports: must fail loudly, not silently -------- */
  {
    const p = await b.newPage();
    await p.addInitScript(() => {
      window.__ALERTS__ = [];
      window.__TAURI__ = { core: { invoke: (cmd) =>
        cmd === 'list_ports' ? Promise.resolve([]) : Promise.resolve(null) } };
    });
    await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(300);
    const r = await p.evaluate(async () => {
      const said = []; window.alert = m => said.push(m);
      await connect();
      return { said, connected: state.connected };
    });
    console.log('no-ports:', JSON.stringify(r));
    note(r.connected === false, 'claimed connected with no ports present');
    note(r.said.length === 1 && /no serial ports/i.test(r.said[0]),
         'unhelpful message with no ports: ' + JSON.stringify(r.said));
    await p.close();
  }

  /* ---- 4. desktop, several ports: the chooser has to appear ------------ */
  {
    const p = await b.newPage();
    await p.addInitScript(() => {
      window.__TAURI__ = { core: { invoke: (cmd) =>
        cmd === 'list_ports' ? Promise.resolve([
          { name: 'COM3', usb: true, detail: 'USB-SERIAL CH340' },
          { name: 'COM7', usb: true, detail: 'FTDI FT232R' }
        ]) : Promise.resolve(null) } };
    });
    await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(300);
    await p.evaluate(() => { connect(); });          /* deliberately not awaited */
    await p.waitForTimeout(200);
    const btns = await p.evaluate(() =>
      [...document.querySelectorAll('#portPick button')].map(b => b.textContent));
    console.log('chooser:', JSON.stringify(btns));
    note(btns.length === 3, 'chooser did not offer both ports plus Cancel: ' + btns.length);
    note(/COM3/.test(btns[0] || '') && /COM7/.test(btns[1] || ''), 'chooser labels wrong');
    /* pick the second one and check it is what gets opened */
    const chosen = await p.evaluate(async () => {
      const calls = [];
      const inv = window.__TAURI__.core.invoke;
      window.__TAURI__.core.invoke = (c, a) => { calls.push([c, a]); return inv(c, a); };
      [...document.querySelectorAll('#portPick button')][1].click();
      await new Promise(r => setTimeout(r, 150));
      return { calls, gone: !document.querySelector('#portPick'), connected: state.connected };
    });
    console.log('chosen:', JSON.stringify(chosen));
    note(chosen.gone, 'chooser stayed on screen after picking');
    const op = chosen.calls.find(c => c[0] === 'open_port');
    note(op && op[1].name === 'COM7', 'picked port not the one opened: ' + JSON.stringify(op && op[1]));
    await p.close();
  }

  console.log(fails.length ? 'FAIL: ' + fails.join(' | ') : 'ALL CUTTER-TRANSPORT CHECKS PASSED');
  await b.close();
})();
