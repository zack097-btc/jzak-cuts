/* 10.7.7: a send now WAITS for the cutter, so a real job holds the app for
   minutes. 10.7.6 shipped that without giving the operator anything to look at
   or any way out, and Windows greyed the window out and called it "not
   responding" — which is how a working cut looks like a crashed program.

   Three things have to be true, and this proves all three against the real
   page rather than by reading the code:
     1. CUT turns into STOP while a job is going out.
     2. Pressing STOP actually reaches the shell.
     3. When it is over — finished OR stopped — the button goes back to CUT,
        because a button stuck on STOP is worse than no button. */
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const fails = [];
  const note = (c, m) => { if (!c) fails.push(m); };
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  p.on('dialog', d => d.accept());

  await p.addInitScript(() => {
    window.__CALLS__ = [];
    let sent = 0, total = 0, stopped = false, release = null;
    window.__finishSend__ = () => { if (release) release(); };
    window.__TAURI__ = { core: { invoke: (cmd, args) => {
      window.__CALLS__.push(cmd);
      if (cmd === 'list_ports') return Promise.resolve([{ name: 'COM5', usb: true, detail: 'CH340' }]);
      if (cmd === 'open_port') return Promise.resolve('software');
      if (cmd === 'port_pace') return Promise.resolve('credit');
      if (cmd === 'port_progress') return Promise.resolve([sent, total]);
      if (cmd === 'stop_send') { stopped = true; if (release) release(); return Promise.resolve(null); }
      if (cmd === 'write_port') {
        /* stand in for a cutter chewing through a slice: do NOT resolve until
           the test says so, which is exactly how a real send behaves */
        total = args.data.length; sent = Math.floor(total / 3);
        return new Promise(res => { release = () => { release = null; res(stopped ? Promise.reject(new Error('Stopped by you after ' + sent + ' of ' + total + ' bytes.')) : null); }; })
          .then(v => v);
      }
      return Promise.resolve(null);
    } } };
  });

  await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(350);

  const btn = () => p.evaluate(() => {
    const b = document.getElementById('sendBtn');
    return { text: b.textContent.trim(), act: b.dataset.act, disabled: b.disabled };
  });

  await p.evaluate(async () => { await connect(); });
  const idle = await btn();
  note(idle.text === '✂ CUT' && idle.act === 'send', 'button does not start as CUT: ' + JSON.stringify(idle));

  /* a job big enough to count as a real send (>4096 bytes) */
  const job = await p.evaluate(() => {
    let h = 'IN;SP1;';
    for (let i = 0; i < 600; i++) h += 'PD' + (i * 7) + ',' + (i * 11) + ';';
    window.__pending__ = writeToCutter(h);   // deliberately not awaited
    return h.length;
  });
  note(job > 4096, 'the test job is too small to trigger the sending UI: ' + job);

  await p.waitForTimeout(300);
  const during = await btn();
  note(during.text === '■ STOP' && during.act === 'stopSend' && !during.disabled,
       'CUT did not become STOP while sending: ' + JSON.stringify(during));

  /* The holding line has to be up IMMEDIATELY - before any byte count exists -
     because that is the moment the operator is looking at the screen wondering
     whether the button did anything. */
  const statusDuring = await p.evaluate(() => document.getElementById('statusText').textContent);
  note(/Cutting…/.test(statusDuring), 'nothing said while sending: ' + statusDuring);
  note(/STOP to abandon/.test(statusDuring),
       'the status does not tell the operator they can stop: ' + statusDuring);

  /* and once the shell has real numbers, they have to replace it - a holding
     line that never turns into progress is just a nicer looking hang. */
  await p.waitForTimeout(900);
  const statusLive = await p.evaluate(() => document.getElementById('statusText').textContent);
  note(/bytes handed to the cutter/.test(statusLive),
       'the holding line never became a real byte count: ' + statusLive);
  note(/\d+%/.test(statusLive), 'no percentage in the live readout: ' + statusLive);

  /* press it, the way an operator would */
  await p.click('#sendBtn');
  await p.waitForTimeout(600);
  const calls = await p.evaluate(() => window.__CALLS__);
  note(calls.includes('stop_send'), 'STOP did not reach the shell: ' + calls.join(','));
  note(calls.includes('port_progress'), 'progress was never polled: ' + calls.join(','));

  await p.evaluate(() => window.__pending__).catch(() => {});
  await p.waitForTimeout(400);
  const after = await btn();
  note(after.text === '✂ CUT' && after.act === 'send',
       'the button stayed on STOP after the job ended: ' + JSON.stringify(after));

  const statusAfter = await p.evaluate(() => document.getElementById('statusText').textContent);
  note(/Cutter connected/.test(statusAfter),
       'the status bar never went back to normal: ' + statusAfter);
  note(errs.length === 0, 'JS errors: ' + errs.join(' | '));

  console.log('idle  :', JSON.stringify(idle));
  console.log('during:', JSON.stringify(during), '|', statusDuring);
  console.log('live  :', statusLive);
  console.log('after :', JSON.stringify(after), '|', statusAfter);
  console.log(fails.length ? 'FAIL: ' + fails.join(' | ') : 'ALL STOP-BUTTON CHECKS PASSED');
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
