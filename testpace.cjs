/* 10.7.6: the shell decides how to METER a job against the cutter — by asking
   how much buffer is free (credit), by making it confirm each block (barrier),
   or, on a machine that will not answer at all, by metering to the wire and
   hoping (wire).
   
   That last case is the one that has cost this shop whole afternoons, and the
   operator has no way to know which of the three they got unless the app says
   so. A silent fallback is how a machine that cannot finish a full sheet gets
   mistaken for a flaky cable for four releases running. So the status bar has
   to name it, and this proves it does — including that it says something plainly
   ALARMING when the cutter will not talk back. */
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const fails = [];
  const note = (c, m) => { if (!c) fails.push(m); };

  const connectWith = async (pace) => {
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
    await p.addInitScript((pace) => {
      window.__TAURI__ = { core: { invoke: (cmd) => {
        if (cmd === 'list_ports') return Promise.resolve([{ name: 'COM9', usb: true, detail: 'USB-SERIAL CH340' }]);
        if (cmd === 'open_port') return Promise.resolve('software');
        if (cmd === 'port_pace') return pace === null
          ? Promise.reject(new Error('older shell, no such command'))
          : Promise.resolve(pace);
        return Promise.resolve(null);
      } } };
    }, pace);
    await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(350);
    const status = await p.evaluate(async () => {
      await connect();
      return document.getElementById('statusText').textContent;
    });
    await p.close();
    return { status, errs };
  };

  const credit = await connectWith('credit');
  console.log('credit :', credit.status);
  note(/credit|buffer/i.test(credit.status) && /cannot overrun/i.test(credit.status),
       'credit metering is not named in the status bar: ' + credit.status);

  const barrier = await connectWith('barrier');
  console.log('barrier:', barrier.status);
  note(/confirms each block/i.test(barrier.status),
       'barrier metering is not named: ' + barrier.status);

  const wire = await connectWith('wire');
  console.log('wire   :', wire.status);
  note(/does not answer/i.test(wire.status),
       'a cutter that will not talk back is not flagged: ' + wire.status);
  note(/⚠/.test(wire.status),
       'the at-risk case reads like every other case — it must stand out: ' + wire.status);

  /* An older shell has no port_pace at all. The page must still connect and
     still name the handshaking, rather than throwing and leaving the operator
     looking at a dead status bar. */
  const old = await connectWith(null);
  console.log('older  :', old.status);
  note(/Cutter connected/.test(old.status) && /XON\/XOFF/.test(old.status),
       'an older shell breaks the status bar: ' + old.status);
  note(old.errs.length === 0, 'JS errors against an older shell: ' + old.errs.join(' | '));

  /* All four must still have named the port and the baud rate. */
  for (const [what, r] of [['credit', credit], ['barrier', barrier], ['wire', wire], ['older', old]]) {
    note(/COM9/.test(r.status), what + ' lost the port name: ' + r.status);
    note(/9600 baud/.test(r.status), what + ' lost the baud rate: ' + r.status);
    note(r.errs.length === 0, what + ' JS errors: ' + r.errs.join(' | '));
  }

  console.log(fails.length ? 'FAIL: ' + fails.join(' | ') : 'ALL METERING-STATUS CHECKS PASSED');
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
