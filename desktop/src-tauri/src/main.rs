// JZAK Cuts — desktop shell.
//
// The whole studio is one HTML file; this program's only jobs are to put it in
// a window and to own the serial port. That second job is the reason this shell
// exists at all: the web view Windows ships has no Web Serial API, so a browser
// build of the app could design but never cut. Here the port belongs to the
// program itself, which is steadier through a long job anyway — nothing can
// revoke it halfway through a cut.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// One serial port as the front end needs to see it.
#[derive(Serialize)]
struct PortInfo {
    name: String,
    /// True for USB adapters — the cutter is always one of these, so the app
    /// can skip straight past the motherboard's built-in COM ports.
    usb: bool,
    /// Something human to read in the chooser, e.g. "USB-SERIAL CH340".
    detail: String,
}

/// The open port, if there is one. A cutter is a single machine, so a single
/// slot is the honest model.
#[derive(Default)]
struct Cutter(
    Mutex<Option<Box<dyn serialport::SerialPort>>>,
    /// What the open port was opened WITH, so a hanging write can be retried
    /// on different handshaking without asking the shop floor to guess.
    Mutex<Option<PortCfg>>,
    /// Bytes handed to the cutter in the piece currently going out, and how
    /// many that piece holds. Plain atomics rather than anything held behind
    /// the port lock, so the window can read the count WHILE the send is still
    /// blocking on the port — which is the only time anybody wants it.
    Progress,
);

#[derive(Default)]
struct Progress {
    sent: AtomicUsize,
    total: AtomicUsize,
}

/// How the currently open port was opened.
#[derive(Clone)]
struct PortCfg {
    name: String,
    baud: u32,
    flow: String,
    /// True when the app picked the handshaking rather than the operator, which
    /// is the only case where it is entitled to change its mind.
    auto: bool,
    /// How this cutter turned out to want feeding. Discovered once, at connect,
    /// by asking it — see `Pace`.
    pace: Pace,
    /// Whether it answers `OA` at all.
    oa: bool,
}

// The four jobs below are written as ordinary functions taking a plain
// `&Cutter`, with the Tauri commands as one-line wrappers over them. That is
// what lets the tests at the bottom of this file drive the real serial code
// without standing up a whole application and a window to do it.

#[tauri::command]
fn list_ports() -> Result<Vec<PortInfo>, String> {
    let found = serialport::available_ports().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for p in found {
        let (usb, detail) = match &p.port_type {
            serialport::SerialPortType::UsbPort(info) => {
                let mut d = String::new();
                if let Some(m) = &info.manufacturer {
                    d.push_str(m);
                }
                if let Some(prod) = &info.product {
                    if !d.is_empty() {
                        d.push(' ');
                    }
                    d.push_str(prod);
                }
                if d.is_empty() {
                    d = format!("USB {:04x}:{:04x}", info.vid, info.pid);
                }
                (true, d)
            }
            serialport::SerialPortType::BluetoothPort => (false, "Bluetooth".into()),
            serialport::SerialPortType::PciPort => (false, "PCI serial".into()),
            serialport::SerialPortType::Unknown => (false, String::new()),
        };
        out.push(PortInfo {
            name: p.port_name,
            usb,
            detail,
        });
    }
    Ok(out)
}

#[tauri::command]
fn open_port(
    state: tauri::State<Cutter>,
    name: String,
    baud: u32,
    flow: Option<String>,
) -> Result<String, String> {
    open_on(&state, &name, baud, flow.as_deref().unwrap_or("auto"))
}

#[tauri::command]
fn write_port(state: tauri::State<Cutter>, data: String) -> Result<(), String> {
    write_on(&state, &data)
}

/// Which handshaking the open port is actually using. The front end shows this
/// in the status bar, because a silent fallback is how a cable fault gets
/// mistaken for a flaky cutter for weeks on end.
#[tauri::command]
fn port_mode(state: tauri::State<Cutter>) -> Result<Option<String>, String> {
    let cfg = state.1.lock().map_err(|_| "serial state is wedged".to_string())?;
    Ok(cfg.as_ref().map(|c| c.flow.clone()))
}

/// How this cutter turned out to want feeding — "credit", "barrier" or "wire".
/// Shown in the status bar beside the handshaking, because the difference
/// between a machine that answers and one that does not is the difference
/// between a sheet that finishes and a sheet that stops two thirds down.
#[tauri::command]
fn port_pace(state: tauri::State<Cutter>) -> Result<Option<String>, String> {
    let cfg = state.1.lock().map_err(|_| "serial state is wedged".to_string())?;
    Ok(cfg.as_ref().map(|c| c.pace.name().to_string()))
}

/// Bytes of the current piece handed over so far, and how many it holds.
///
/// Readable WHILE a send is blocking, which is the only moment it is any use:
/// it reads two atomics and never touches the port lock. If a cut ever does
/// stop again, this is the number that says exactly where.
#[tauri::command]
fn port_progress(state: tauri::State<Cutter>) -> Result<(usize, usize), String> {
    Ok((
        state.2.sent.load(Ordering::Relaxed),
        state.2.total.load(Ordering::Relaxed),
    ))
}

#[tauri::command]
fn close_port(state: tauri::State<Cutter>) -> Result<(), String> {
    close_on(&state)
}

/// How long one 256-byte chunk is allowed to take before we call it stuck.
///
/// This used to be ten seconds, which is the wrong shape of number: at 9600
/// baud a 256-byte chunk takes about a quarter of a second, so anything past a
/// couple of seconds is not slowness, it is a line that is never going to
/// clear. Ten seconds meant the app froze for ten seconds and THEN reported a
/// disconnect, which is exactly what a "random split-second dropout" feels like
/// from the outside.
/// How long one write syscall may block before it comes back empty-handed.
/// Short on purpose: an empty return is NOT a failure, it is the cutter holding
/// us off, and we simply try again.
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);

/// How long the cutter may accept NOTHING AT ALL before we call it dead.
///
/// This is the number that matters when handshaking is working. A cutter
/// chewing through a dense patch of a traced logo can hold XOFF for a long
/// time — it is a motor dragging a blade through vinyl, not a network card —
/// and every one of those seconds is the machine doing its job properly. Two
/// minutes of total silence is a cutter that has genuinely stopped; three
/// seconds is a cutter that is merely busy, and giving up there is what made
/// 10.7.3 report "failed to write whole buffer" on a sheet it was cutting
/// perfectly well.
const STALL_LIMIT: Duration = Duration::from_secs(120);

/// How the bytes are metered onto the wire.
///
/// This is the heart of the 10.7.6 fix. Every version up to 10.7.5 metered to
/// the WIRE — 9600 baud is 960 bytes a second, so a chunk was flushed and then
/// given the time those bytes take to travel. That keeps the PC's own buffers
/// empty, which is worth doing, but it is the wrong quantity entirely.
///
/// The cutter does not consume commands at wire speed. It consumes them at
/// BLADE speed: `PD` moves a motor, drags a knife through vinyl and waits for
/// the swivel to follow. Ten bytes of command can be a tenth of a second of
/// work. So on a full sheet the machine falls steadily further behind, its own
/// buffer fills at a perfectly repeatable byte count, and everything past that
/// count is thrown on the floor. A fixed byte count is why it dies at the SAME
/// SPOT every time, and why small jobs — which never reach the count — are
/// fine.
///
/// XON/XOFF is meant to prevent exactly this, and it only works if the cutter
/// sends the XOFF byte back. Plenty do not, or send it far too late.
///
/// So stop relying on it and ASK THE MACHINE.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Pace {
    /// The cutter answers `ESC.B` with the free space in its own buffer. Ask,
    /// send exactly that much less a margin, ask again. It cannot overflow,
    /// because we never once send more than it has just told us it can hold.
    /// Works down a three-wire lead, because the answer comes back on the same
    /// receive line as everything else.
    Credit,
    /// The cutter will not answer `ESC.B`, but it answers `OA` with its current
    /// pen position. `OA` is an ordinary buffered instruction, so the cutter
    /// cannot answer it until it has plotted everything queued ahead of it.
    /// That makes the reply a true acknowledgement: send a block, ask where the
    /// pen is, and the answer means the block is done and the buffer is clear.
    Barrier,
    /// The cutter answers nothing at all. Meter to the wire and warn the
    /// operator, which is exactly what 10.7.5 did for everyone.
    Wire,
}

impl Pace {
    fn name(self) -> &'static str {
        match self {
            Pace::Credit => "credit",
            Pace::Barrier => "barrier",
            Pace::Wire => "wire",
        }
    }
    /// What to fall back to when the cutter stops answering mid-job. Losing the
    /// conversation must never lose the CUT — the sheet is already half spoiled
    /// by then — so we drop a level and keep going.
    fn weaker(self) -> Option<Pace> {
        match self {
            Pace::Credit => Some(Pace::Barrier),
            Pace::Barrier => Some(Pace::Wire),
            Pace::Wire => None,
        }
    }
}

/// How long a probe waits for the cutter to find its voice. Generous: a cutter
/// that has just been switched on can take most of a second to answer.
const PROBE_WAIT: Duration = Duration::from_millis(900);

/// How long a mid-job free-space query waits. Shorter, because by now we know
/// the cutter talks.
const ASK_WAIT: Duration = Duration::from_millis(1500);

/// How long to wait for an OA acknowledgement before deciding the cutter has
/// gone quiet.
///
/// This one cannot be short. An acknowledgement is answered only AFTER the
/// block has been plotted, so on a dense block the honest answer really does
/// take tens of seconds — that is the cutter working, not the cutter failing.
/// Forty-five seconds is longer than a kilobyte of cutting takes on any machine
/// that will ever be plugged into this, and short enough that a cutter which
/// has genuinely stopped talking does not hold a job hostage for two minutes.
///
/// It is a variable rather than a constant for one reason: the tests need to
/// prove the give-up path, and they cannot spend forty-five seconds doing it.
static ACK_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(45_000);
fn ack_patience() -> Duration {
    Duration::from_millis(ACK_MS.load(Ordering::Relaxed))
}

/// Never fill the last scrap of the reported buffer. If the cutter's arithmetic
/// is off by a few bytes, this is what absorbs it.
const MARGIN: usize = 64;

/// The most we will ever have outstanding, whatever the cutter claims. A cutter
/// that reports the free space of its SERIAL buffer rather than its plot queue
/// would otherwise wave us through — this is the cap that keeps such a machine
/// honest.
const MOST: usize = 1024;

/// How often a credit-fed job forces a hard acknowledgement anyway. Belt and
/// braces: even if `ESC.B` is lying, no more than this much work can ever be
/// outstanding.
const CHECKPOINT: usize = 4096;

fn stall_msg(sent: usize, total: usize) -> String {
    format!(
        "The cutter stopped accepting data {} seconds ago, after {} of {} bytes. \
         Check it is switched on, not paused, and not out of vinyl.",
        STALL_LIMIT.as_secs(),
        sent,
        total
    )
}

/// Marker on an error that means "the cutter went quiet", as opposed to "the
/// cutter is broken". Caught by push(), which drops to a weaker pace and keeps
/// cutting rather than abandoning a half-finished sheet.
const QUIET: &str = "QUIET";

fn drain_input(port: &mut Box<dyn serialport::SerialPort>) {
    let _ = port.clear(serialport::ClearBuffer::Input);
}

/// Read until `end` arrives or the clock runs out.
fn read_reply(
    port: &mut Box<dyn serialport::SerialPort>,
    end: u8,
    wait: Duration,
) -> Option<String> {
    let until = Instant::now() + wait;
    let mut got = String::new();
    let mut b = [0u8; 1];
    let _ = port.set_timeout(Duration::from_millis(40));
    let out = loop {
        if Instant::now() >= until {
            break if got.is_empty() { None } else { Some(got) };
        }
        match port.read(&mut b) {
            Ok(1) => {
                if b[0] == end {
                    break Some(got);
                }
                if b[0] >= 32 {
                    got.push(b[0] as char);
                }
                if got.len() > 64 {
                    break Some(got);
                }
            }
            Ok(_) => {}
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break None,
        }
    };
    let _ = port.set_timeout(WRITE_TIMEOUT);
    out
}

/// `ESC.B` — how many bytes of the cutter's buffer are free right now.
fn ask_free(port: &mut Box<dyn serialport::SerialPort>, wait: Duration) -> Option<usize> {
    if port.write_all(b"\x1B.B").is_err() {
        return None;
    }
    let _ = port.flush();
    let reply = read_reply(port, b'\r', wait)?;
    let digits: String = reply.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.parse::<usize>().ok()
}

/// Put an `OA;` in the stream. It is answered only once everything queued ahead
/// of it has been plotted, which is the whole point of asking.
fn post_ask(port: &mut Box<dyn serialport::SerialPort>) -> bool {
    if port.write_all(b"OA;").is_err() {
        return false;
    }
    port.flush().is_ok()
}

/// Collect one answer to a posted `OA;`.
fn take_ack(port: &mut Box<dyn serialport::SerialPort>, wait: Duration) -> bool {
    read_reply(port, b'\r', wait).is_some()
}

/// Ask and wait, as one act. Used by the probe and by the credit checkpoint.
fn ask_arrived(port: &mut Box<dyn serialport::SerialPort>, wait: Duration) -> bool {
    post_ask(port) && take_ack(port, wait)
}

/// What the cutter turned out to be willing to tell us.
#[derive(Clone, Copy, Debug)]
struct Voice {
    pace: Pace,
    /// Whether `OA` is answered at all. Credit feeding uses this for its
    /// periodic hard checkpoint — and must NOT use it on a machine that has
    /// never answered an OA in its life, or every checkpoint would sit there
    /// waiting out the full patience for a reply that is never coming.
    oa: bool,
}

/// Ask the cutter, once, at connect time, how it would like to be fed.
fn probe_pace(port: &mut Box<dyn serialport::SerialPort>) -> Voice {
    drain_input(port);
    let free = ask_free(port, PROBE_WAIT).filter(|n| *n > 0).is_some();
    drain_input(port);
    let oa = ask_arrived(port, PROBE_WAIT);
    drain_input(port);
    let pace = if free {
        Pace::Credit
    } else if oa {
        Pace::Barrier
    } else {
        Pace::Wire
    };
    Voice { pace, oa }
}

/// Hand over exactly this many bytes, however many attempts that takes.
///
/// An empty return is the cutter saying "wait", not "I am broken", so the same
/// bytes are simply offered again. That distinction was the 10.7.4 fix and it
/// stands.
fn write_exact(
    port: &mut Box<dyn serialport::SerialPort>,
    buf: &[u8],
    already: usize,
    total: usize,
) -> Result<(), String> {
    let mut done = 0usize;
    let mut last = Instant::now();
    while done < buf.len() {
        let n = match port.write(&buf[done..]) {
            Ok(n) => n,
            Err(ref e)
                if e.kind() == std::io::ErrorKind::TimedOut
                    || e.kind() == std::io::ErrorKind::WouldBlock =>
            {
                0
            }
            Err(e) => return Err(e.to_string()),
        };
        if n > 0 {
            done += n;
            last = Instant::now();
        } else {
            if last.elapsed() > STALL_LIMIT {
                return Err(stall_msg(already + done, total));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    port.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Where a block is allowed to end: immediately after a `PU` command, so that
/// any pause waiting for an acknowledgement happens with the BLADE OFF THE
/// VINYL. A pause mid-curve is not the end of the world, but a pause between
/// shapes leaves no mark at all, and the cut is what the customer pays for.
///
/// Falls back to the hard ceiling when one continuous curve is longer than a
/// whole block, which a traced logo often is.
fn block_end(bytes: &[u8], from: usize, want: usize, ceiling: usize) -> usize {
    let limit = (from + ceiling).min(bytes.len());
    let soft = (from + want).min(bytes.len());
    if soft >= bytes.len() {
        return bytes.len();
    }
    let mut best = 0usize;
    let mut cmd = from;
    let mut i = from;
    while i < limit {
        if bytes[i] == b';' {
            let end = i + 1;
            if end <= soft
                && cmd + 1 < bytes.len()
                && bytes[cmd].eq_ignore_ascii_case(&b'P')
                && bytes[cmd + 1].eq_ignore_ascii_case(&b'U')
            {
                best = end;
            }
            cmd = end;
            if end >= soft && best > from {
                break;
            }
        }
        i += 1;
    }
    if best > from {
        best
    } else {
        limit
    }
}

/// Feed the cutter only what it has just said it can hold.
fn send_credit(
    port: &mut Box<dyn serialport::SerialPort>,
    bytes: &[u8],
    sent: &mut usize,
    oa: bool,
    mark: &AtomicUsize,
) -> Result<(), String> {
    let mut last = Instant::now();
    let mut since_check = 0usize;
    while *sent < bytes.len() {
        let free = match ask_free(port, ASK_WAIT) {
            Some(f) => f,
            None => return Err(format!("{}:{}", QUIET, sent)),
        };
        if free <= MARGIN {
            if last.elapsed() > STALL_LIMIT {
                return Err(stall_msg(*sent, bytes.len()));
            }
            std::thread::sleep(Duration::from_millis(40));
            continue;
        }
        let room = (free - MARGIN).min(MOST).min(bytes.len() - *sent);
        let end = block_end(bytes, *sent, room, room);
        write_exact(port, &bytes[*sent..end], *sent, bytes.len())?;
        since_check += end - *sent;
        *sent = end;
        mark.store(*sent, Ordering::Relaxed);
        last = Instant::now();

        // The cutter claims there is room. Every CHECKPOINT bytes, make it
        // PROVE it by answering a question it cannot answer until the work is
        // actually done.
        if oa && since_check >= CHECKPOINT && *sent < bytes.len() {
            since_check = 0;
            let _ = ask_arrived(port, ack_patience());
        }
    }
    Ok(())
}

/// The most a barrier-fed block may be.
///
/// In barrier feeding the cutter holds at most ONE block, because nothing more
/// is sent until it confirms that block is cut. So the block has to be smaller
/// than the smallest buffer we might be talking to — and we are in barrier mode
/// precisely BECAUSE this cutter will not tell us how big its buffer is.
///
/// The arithmetic that matters: barrier feeding keeps TWO blocks outstanding,
/// so the number to fit inside the cutter is 2 x BLOCK_CEILING, not BLOCK. One
/// kilobyte is the smallest buffer worth assuming, and 2 x 384 is 768 — which
/// leaves room, where 2 x 512 filled a 1 KB cutter to the last byte and then
/// overran it on whatever arrived next.
///
/// That was found by a test that failed one run in four rather than by a
/// spoiled sheet, which is the entire reason the fake cutter exists.
const BLOCK: usize = 256;
const BLOCK_CEILING: usize = 384;

/// Send a block, then wait for proof the cutter has plotted it — but keep ONE
/// block in hand so the blade never runs dry.
///
/// The naive version of this sends a block, waits for the acknowledgement, then
/// sends the next. It is safe, and it is also wrong: the cutter's buffer empties
/// completely at every block, so the head decelerates to a stop and accelerates
/// again several times a second. That shows up in the vinyl on curves.
///
/// Keeping one block outstanding costs nothing in safety — two blocks is still
/// under half a kilobyte, smaller than any HPGL buffer ever built — and means
/// there is always work queued for the machine to get on with while we wait.
fn send_barrier(
    port: &mut Box<dyn serialport::SerialPort>,
    bytes: &[u8],
    sent: &mut usize,
    mark: &AtomicUsize,
) -> Result<(), String> {
    let mut outstanding = 0usize;
    while *sent < bytes.len() {
        let end = block_end(bytes, *sent, BLOCK, BLOCK_CEILING);
        write_exact(port, &bytes[*sent..end], *sent, bytes.len())?;
        *sent = end;
        mark.store(*sent, Ordering::Relaxed);

        if !post_ask(port) {
            return Err(format!("{}:{}", QUIET, sent));
        }
        outstanding += 1;

        while outstanding >= 2 {
            if !take_ack(port, ack_patience()) {
                return Err(format!("{}:{}", QUIET, sent));
            }
            outstanding -= 1;
        }
    }

    // Collect what is still owed, so a stale reply cannot be mistaken for the
    // answer to the next job's first question.
    while outstanding > 0 {
        if !take_ack(port, ack_patience()) {
            break;
        }
        outstanding -= 1;
    }
    Ok(())
}

/// The old behaviour, kept for cutters that will not talk back: meter to the
/// wire so the operating system's buffers stay near empty, which at least gives
/// an XOFF somewhere to land.
fn send_wire(
    port: &mut Box<dyn serialport::SerialPort>,
    bytes: &[u8],
    sent: &mut usize,
    baud: u32,
    mark: &AtomicUsize,
) -> Result<(), String> {
    const CHUNK: usize = 256;
    let per_chunk =
        Duration::from_micros((CHUNK as u64) * 1_000_000 / ((baud.max(300) as u64) / 10));
    while *sent < bytes.len() {
        let end = (*sent + CHUNK).min(bytes.len());
        write_exact(port, &bytes[*sent..end], *sent, bytes.len())?;
        *sent = end;
        mark.store(*sent, Ordering::Relaxed);
        if *sent < bytes.len() {
            std::thread::sleep(per_chunk);
        }
    }
    Ok(())
}

fn flow_of(name: &str) -> serialport::FlowControl {
    match name {
        "hardware" => serialport::FlowControl::Hardware,
        "software" => serialport::FlowControl::Software,
        _ => serialport::FlowControl::None,
    }
}

fn open_on(cutter: &Cutter, name: &str, baud: u32, want: &str) -> Result<String, String> {
    // Handshaking is the whole ball game on a serial cutter.
    //
    // Hardware (RTS/CTS) is what a cutter wants: it can tell the computer to
    // wait while its buffer drains, which is what stops a long path being
    // overrun. But a lot of cheap USB-to-serial leads are wired with three
    // conductors and no handshake lines at all. On one of those the port OPENS
    // perfectly happily and then every write hangs waiting for a CTS that is
    // never coming.
    //
    // The old code tried to guard against that by falling back when the OPEN
    // failed — but the open does not fail, so the guard never fired. The real
    // test is whether a write completes, and that now happens in write_on.
    let build = |flow: serialport::FlowControl| {
        serialport::new(name, baud)
            .data_bits(serialport::DataBits::Eight)
            .stop_bits(serialport::StopBits::One)
            .parity(serialport::Parity::None)
            .flow_control(flow)
            .timeout(WRITE_TIMEOUT)
            .open()
    };

    // AUTOMATIC MEANS XON/XOFF FIRST, and that is a correction.
    //
    // It used to try RTS/CTS first and fall back to NO handshaking if the open
    // failed. But on a three-wire USB lead the hardware open SUCCEEDS — the
    // driver has no idea the wires are absent — so the shop was left with
    // handshaking the cable cannot physically carry, which behaves exactly like
    // none at all. One design fitted the cutter's buffer and finished; two
    // overran it and died at a different place each run.
    //
    // XON/XOFF travels on the same two wires as the data, so it works on every
    // lead including a three-wire one. That makes it the right default for a
    // cutter on a USB serial adapter, which is what a sign shop actually owns.
    let (port, used) = if want == "auto" {
        match build(serialport::FlowControl::Software) {
            Ok(p) => (p, "software"),
            Err(first) => match build(serialport::FlowControl::Hardware) {
                Ok(p) => (p, "hardware"),
                Err(second) => (
                    build(serialport::FlowControl::None).map_err(|third| {
                        format!("{} (then RTS/CTS: {}) (then no handshaking: {})",
                                first, second, third)
                    })?,
                    "none",
                ),
            },
        }
    } else {
        (build(flow_of(want)).map_err(|e| e.to_string())?, match want {
            "hardware" => "hardware",
            "software" => "software",
            _ => "none",
        })
    };

    let mut port = port;

    // ASK THE CUTTER HOW IT WANTS TO BE FED, once, here, while nothing is at
    // stake. Two harmless questions — neither moves the head — and the answers
    // decide whether a full sheet finishes or dies two thirds of the way down.
    let voice = probe_pace(&mut port);

    let mut slot = cutter.0.lock().map_err(|_| "serial port is wedged".to_string())?;
    *slot = Some(port);
    drop(slot);

    // Remember enough to reopen ourselves if a hardware write turns out to hang.
    let mut cfg = cutter.1.lock().map_err(|_| "serial state is wedged".to_string())?;
    *cfg = Some(PortCfg {
        name: name.to_string(),
        baud,
        flow: used.to_string(),
        auto: want == "auto",
        pace: voice.pace,
        oa: voice.oa,
    });
    Ok(used.to_string())
}

/// Push bytes at the currently open port. Returns how many were written.
///
/// All the real metering lives in send_credit / send_barrier / send_wire. This
/// picks which one, and — the part that matters on a half-cut sheet — DROPS TO
/// A WEAKER ONE INSTEAD OF GIVING UP if the cutter stops answering part way
/// through. A machine that goes quiet mid-job has not failed; abandoning the
/// job at that point is what actually costs the vinyl.
fn push(cutter: &Cutter, data: &str) -> Result<usize, String> {
    let (baud, start_pace, oa) = {
        let cfg = cutter.1.lock().map_err(|_| "serial state is wedged".to_string())?;
        match cfg.as_ref() {
            Some(c) => (c.baud, c.pace, c.oa),
            None => (9600, Pace::Wire, false),
        }
    };

    let bytes = data.as_bytes();
    cutter.2.total.store(bytes.len(), Ordering::Relaxed);
    cutter.2.sent.store(0, Ordering::Relaxed);

    let mut sent = 0usize;
    let mut pace = start_pace;
    let mut dropped_to: Option<Pace> = None;

    let outcome = {
        let mut slot = cutter.0.lock().map_err(|_| "serial port is wedged".to_string())?;
        let port = slot
            .as_mut()
            .ok_or_else(|| "The cutter is not connected.".to_string())?;
        loop {
            let r = match pace {
                Pace::Credit => send_credit(port, bytes, &mut sent, oa, &cutter.2.sent),
                Pace::Barrier => send_barrier(port, bytes, &mut sent, &cutter.2.sent),
                Pace::Wire => send_wire(port, bytes, &mut sent, baud, &cutter.2.sent),
            };
            match r {
                Ok(()) => break Ok(sent),
                Err(e) if e.starts_with(QUIET) => match pace.weaker() {
                    Some(next) => {
                        drain_input(port);
                        pace = next;
                        dropped_to = Some(next);
                        continue;
                    }
                    None => break Err(e),
                },
                Err(e) => break Err(e),
            }
        }
    };

    // Record the demotion so the status bar stops claiming a conversation that
    // is no longer happening.
    if let Some(next) = dropped_to {
        if let Ok(mut cfg) = cutter.1.lock() {
            if let Some(c) = cfg.as_mut() {
                c.pace = next;
            }
        }
    }
    outcome
}

fn write_on(cutter: &Cutter, data: &str) -> Result<(), String> {
    match push(cutter, data) {
        Ok(_) => Ok(()),
        Err(first) => {
            // THE FALLBACK THAT WAS MISSING.
            //
            // A write that times out on hardware handshaking almost always means
            // the lead has no CTS wire, not that the cutter has gone away. The
            // old code could only fall back when the OPEN failed, which never
            // happens on such a lead — so the shop saw a "disconnect" instead of
            // a cable that simply cannot do RTS/CTS.
            //
            // Only worth trying when we chose hardware ourselves, and only once:
            // if it fails again the cutter really is gone, and saying so is more
            // use than retrying forever.
            let retry = {
                let cfg = cutter.1.lock().map_err(|_| "serial state is wedged".to_string())?;
                match cfg.as_ref() {
                    Some(c) if c.auto && c.flow == "hardware" => Some(c.clone()),
                    _ => None,
                }
            };
            let Some(c) = retry else { return Err(first) };
            if !looks_stuck(&first) {
                return Err(first);
            }

            open_on(cutter, &c.name, c.baud, "none").map_err(|e| {
                format!("{} (handshaking retry also failed: {})", first, e)
            })?;
            push(cutter, data)
                .map(|_| ())
                .map_err(|second| format!("{} (and again without handshaking: {})", first, second))
        }
    }
}

/// A stuck line, as opposed to a cutter that has genuinely been unplugged.
fn looks_stuck(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    m.contains("timed out")
        || m.contains("timeout")
        || m.contains("would block")
        // Rust's own wording when a write returns having moved nothing. Under
        // working handshaking that means "the cutter told me to wait", which is
        // a busy machine, not a missing one.
        || m.contains("failed to write whole buffer")
        || m.contains("stopped accepting data")
}

fn close_on(cutter: &Cutter) -> Result<(), String> {
    let mut slot = cutter.0.lock().map_err(|_| "serial port is wedged".to_string())?;
    *slot = None; // dropping the handle closes it
    drop(slot);
    let mut cfg = cutter.1.lock().map_err(|_| "serial state is wedged".to_string())?;
    *cfg = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exactly what the connect-time probe puts on the wire, in order. The pty
    /// tests below read past it to get at the job.
    const PROBE: &str = "\u{1b}.BOA;";

    /// Tests must be able to prove the give-up path without spending
    /// three quarters of a minute on each one.
    fn patience(ms: u64) {
        ACK_MS.store(ms, Ordering::Relaxed);
    }

    /// The pty tests below simulate a machine with a clock in it: a cutter that
    /// consumes work at blade speed and answers within a deadline. Run several
    /// of those at once on a shared build box and they starve each other of CPU,
    /// the simulated cutter answers late, and the sender quite correctly decides
    /// the cutter has gone quiet — a real behaviour, provoked by the test
    /// harness rather than by the code under test.
    ///
    /// They also share one global patience setting, which parallel tests would
    /// trample. So they take a turn each. It costs wall-clock and buys a suite
    /// whose failures always mean something.
    static BENCH: Mutex<()> = Mutex::new(());
    fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
        BENCH.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn enumerating_ports_never_blows_up() {
        // A machine with nothing plugged in is the ordinary case, and it has to
        // come back as an empty list rather than an error — the app tells the
        // shop "plug the cutter in", which it can only do if this succeeds.
        let ports = list_ports().expect("listing ports failed");
        for p in &ports {
            assert!(!p.name.is_empty(), "a port came back with no name");
        }
    }

    #[test]
    fn writing_before_connecting_says_so_plainly() {
        let c = Cutter::default();
        let err = write_on(&c, "IN;").unwrap_err();
        assert!(
            err.contains("not connected"),
            "unhelpful message when nothing is open: {err}"
        );
    }

    /// Automatic tries XON/XOFF first, because that is the only handshaking a
    /// three-wire USB lead can actually carry, then RTS/CTS, then none. When a
    /// port is simply absent the message has to name all three so the shop can
    /// see it was not one unlucky attempt.
    #[test]
    fn a_port_that_is_not_there_reports_every_attempt() {
        let c = Cutter::default();
        let err = open_on(&c, "/dev/there-is-no-cutter-here", 9600, "auto").unwrap_err();
        for expected in ["then RTS/CTS", "then no handshaking"] {
            assert!(
                err.contains(expected),
                "attempt {expected:?} was not reported: {err}"
            );
        }
    }

    /// Being told to wait is not a failure. This pins the two numbers that
    /// decide the difference, because getting them the wrong way round is
    /// exactly what broke 10.7.3: one write syscall may come back empty after
    /// a couple of seconds, but the cutter is only declared dead after two
    /// solid minutes of accepting nothing. A cutter dragging a blade through a
    /// dense patch can hold XOFF far longer than a single syscall timeout.
    #[test]
    fn a_busy_cutter_is_given_far_longer_than_one_syscall() {
        assert!(
            STALL_LIMIT >= WRITE_TIMEOUT * 30,
            "a held-off cutter must get much longer than one write timeout: \
             timeout {WRITE_TIMEOUT:?}, stall limit {STALL_LIMIT:?}"
        );
        assert!(
            STALL_LIMIT >= std::time::Duration::from_secs(60),
            "under a minute is not enough for a cutter working through a dense area"
        );
    }

    /// A hold-off must read as stuck-but-alive, never as a vanished cutter.
    #[test]
    fn a_held_off_write_reads_as_busy_not_broken() {
        for msg in [
            "failed to write whole buffer",
            "Operation timed out",
            "the write would block",
            "The cutter stopped accepting data 120 seconds ago",
        ] {
            assert!(looks_stuck(msg), "should read as a busy line: {msg}");
        }
        assert!(
            !looks_stuck("No such device"),
            "an unplugged cutter must not be mistaken for a busy one"
        );
    }

    /// The pacing maths is the whole fix for a sheet of two or more designs, so
    /// it is pinned here. 8-N-1 is ten bits a byte, so 9600 baud carries 960
    /// bytes a second and a 256-byte chunk owns the line for about 267 ms.
    /// Getting this wrong in either direction is bad: too fast and the cutter
    /// overruns again, too slow and a job that took a minute takes ten.
    #[test]
    fn a_chunk_is_paced_to_how_long_the_wire_needs() {
        for (baud, expect_ms) in [(9600u32, 266u128), (19200, 133), (38400, 66)] {
            let per_chunk = std::time::Duration::from_micros(
                256u64 * 1_000_000 / ((baud.max(300) as u64) / 10),
            );
            let got = per_chunk.as_millis();
            assert!(
                got.abs_diff(expect_ms) <= 1,
                "at {baud} baud a 256-byte chunk should take about {expect_ms} ms, got {got}"
            );
        }
    }

    #[test]
    fn closing_when_nothing_is_open_is_harmless() {
        let c = Cutter::default();
        close_on(&c).expect("close of an unopened port errored");
    }

    #[cfg(unix)]
    #[test]
    fn bytes_written_come_out_the_other_end() {
        patience(6000);
        let _bench = one_at_a_time();
        use serialport::{SerialPort, TTYPort};
        use std::io::Read;

        // A pseudo-terminal pair stands in for the cutter: we open one end the
        // same way the app does and read what arrives at the other. It also
        // exercises the handshake fallback for real, because a pty has no
        // hardware handshake lines to offer.
        let (mut master, slave) = TTYPort::pair().expect("could not make a pty pair");
        let name = slave.name().expect("pty slave has no name");
        drop(slave); // let our own open() take it, exactly as it would a COM port

        let c = Cutter::default();
        open_on(&c, &name, 9600, "none").expect("opening the pty failed");

        let sent = "IN;SP1;PU0,0;PD1016,0;";
        write_on(&c, sent).expect("write failed");

        // The connect-time probe goes down the same wire first: two questions
        // the cutter is free to ignore. Skip past them and check the JOB.
        master
            .set_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let mut got = vec![0u8; PROBE.len() + sent.len()];
        master.read_exact(&mut got).expect("nothing arrived");
        std::thread::sleep(Duration::from_millis(200));
        let text = String::from_utf8_lossy(&got);
        assert_eq!(&text[..PROBE.len()], PROBE, "the probe is not what we thought");
        assert_eq!(&text[PROBE.len()..], sent);

        close_on(&c).expect("close failed");
        // and once closed, writing has to fail again rather than pretend
        assert!(write_on(&c, "IN;").is_err(), "wrote to a closed port");
    }

    #[cfg(unix)]
    #[test]
    fn a_long_path_survives_the_chunking() {
        patience(6000);
        let _bench = one_at_a_time();
        use serialport::{SerialPort, TTYPort};
        use std::io::Read;

        // Real jobs are far bigger than one 256-byte chunk; this proves the
        // loop hands over every byte, in order, with nothing dropped at a seam.
        let (mut master, slave) = TTYPort::pair().expect("could not make a pty pair");
        let name = slave.name().unwrap();
        drop(slave);

        let mut hpgl = String::from("IN;SP1;");
        for i in 0..400 {
            hpgl.push_str(&format!("PD{},{};", i * 7, i * 13));
        }
        assert!(hpgl.len() > 256 * 4, "test payload is too small to matter");

        let c = Cutter::default();
        open_on(&c, &name, 9600, "none").unwrap();

        let want = hpgl.clone();
        let n = want.len() + PROBE.len();
        let reader = std::thread::spawn(move || {
            master
                .set_timeout(std::time::Duration::from_secs(10))
                .unwrap();
            let mut got = vec![0u8; n];
            master.read_exact(&mut got).expect("short read");
            // Hold this end of the pipe open while the sender finishes its last
            // flush, or the TEST closes the pty and the sender gets the blame.
            std::thread::sleep(Duration::from_millis(300));
            got
        });

        write_on(&c, &hpgl).expect("long write failed");
        let got = reader.join().expect("reader thread died");
        assert_eq!(&String::from_utf8_lossy(&got)[PROBE.len()..], want);
    }

    #[test]
    fn a_block_ends_with_the_blade_off_the_vinyl() {
        // Three shapes. A block that could hold 60 bytes must stop at the end
        // of a PU command, not in the middle of a cut, so that any pause
        // waiting for the cutter leaves no mark.
        let hpgl = b"PU0,0;PD10,0;PD10,10;PD0,0;PU500,0;PD510,0;PD510,10;PU900,0;PD910,0;";
        let end = block_end(hpgl, 0, 40, 200);
        let block = std::str::from_utf8(&hpgl[..end]).unwrap();
        assert!(
            block.ends_with("PU500,0;"),
            "block ended mid-cut at {:?}",
            block
        );

        // And one continuous curve longer than a whole block still gets sent —
        // a traced logo is exactly this, and refusing to split it would hang.
        let mut curve = String::from("PU0,0;");
        for i in 0..200 {
            curve.push_str(&format!("PD{},{};", i, i));
        }
        let c = curve.as_bytes();
        let e = block_end(c, 6, 64, 128);
        assert!(e > 6 && e <= 6 + 128, "long curve was not split: {}", e);
    }

    #[test]
    fn a_block_that_reaches_the_end_takes_all_of_it() {
        let hpgl = b"PU0,0;PD10,0;";
        assert_eq!(block_end(hpgl, 0, 999, 999), hpgl.len());
    }

    // ---- the fake cutter ---------------------------------------------------
    //
    // This is the piece that was missing for three releases. Every previous
    // "fix" for the stall was reasoned about and shipped; none of them was ever
    // put in front of a machine that behaves like the machine on the bench —
    // one with a SMALL BUFFER that drains at BLADE SPEED, far slower than the
    // wire delivers. A cutter like that is overrun by any sender that meters to
    // the wire, and overrun at a repeatable byte count, which is precisely the
    // "stops at the same spot" the shop was living with.
    //
    // So: a cutter with a 512-byte buffer that plots 200 bytes a second, which
    // answers ESC.B immediately and OA only when it has caught up. It panics
    // the moment its buffer is overrun, so a sender that would spoil a sheet
    // fails the test instead.
    #[cfg(unix)]
    struct FakeCutter {
        overflowed: std::sync::Arc<std::sync::atomic::AtomicBool>,
        high_water: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        plotted: std::sync::Arc<Mutex<Vec<u8>>>,
    }

    #[cfg(unix)]
    fn run_fake_cutter(
        mut master: serialport::TTYPort,
        cap: usize,
        bytes_per_sec: usize,
        answers_free: bool,
        answers_pos: bool,
    ) -> FakeCutter {
        use serialport::SerialPort;
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering as O};
        use std::sync::Arc;

        let overflowed = Arc::new(AtomicBool::new(false));
        let high_water = Arc::new(AtomicUsize::new(0));
        let plotted = Arc::new(Mutex::new(Vec::new()));

        let (of, hw, pl) = (overflowed.clone(), high_water.clone(), plotted.clone());
        std::thread::spawn(move || {
            master.set_timeout(Duration::from_millis(5)).unwrap();

            // Bytes accepted but not yet cut. `true` marks a pending OA: the
            // cutter cannot answer it until everything queued ahead of it has
            // actually been plotted, which is the whole reason an OA is worth
            // asking.
            let mut queue: std::collections::VecDeque<(u8, bool)> =
                std::collections::VecDeque::new();

            // A small state machine rather than a sliding window over bytes
            // already queued. The window version quietly deleted real plot data
            // every time it recognised a query, which made the FAKE cutter drop
            // work and would have been read as the sender's fault.
            #[derive(PartialEq)]
            enum St {
                Norm,
                Esc,
                EscDot,
                O,
                OA,
            }
            let mut st = St::Norm;

            let mut last = Instant::now();
            let mut idle = Instant::now();
            let mut b = [0u8; 256];
            loop {
                let due = (last.elapsed().as_secs_f64() * bytes_per_sec as f64) as usize;
                if due > 0 {
                    last = Instant::now();
                    for _ in 0..due.min(queue.len()) {
                        match queue.pop_front() {
                            Some((_, true)) => {
                                let _ = master.write_all(b"0,0,0\r");
                                let _ = master.flush();
                            }
                            Some((byte, false)) => pl.lock().unwrap().push(byte),
                            None => break,
                        }
                    }
                }

                match master.read(&mut b) {
                    Ok(n) if n > 0 => {
                        idle = Instant::now();
                        for &byte in &b[..n] {
                            loop {
                                match st {
                                    St::Norm => match byte {
                                        0x1B => st = St::Esc,
                                        b'O' => st = St::O,
                                        _ => queue.push_back((byte, false)),
                                    },
                                    St::Esc => {
                                        st = if byte == b'.' { St::EscDot } else { St::Norm };
                                    }
                                    St::EscDot => {
                                        if byte == b'B' && answers_free {
                                            let free = cap.saturating_sub(queue.len());
                                            let _ =
                                                master.write_all(format!("{}\r", free).as_bytes());
                                            let _ = master.flush();
                                        }
                                        st = St::Norm;
                                    }
                                    St::O => {
                                        if byte == b'A' {
                                            st = St::OA;
                                        } else {
                                            queue.push_back((b'O', false));
                                            st = St::Norm;
                                            continue; // this byte is ordinary after all
                                        }
                                    }
                                    St::OA => {
                                        if byte == b';' {
                                            if answers_pos {
                                                queue.push_back((0, true));
                                            }
                                            st = St::Norm;
                                        } else {
                                            queue.push_back((b'O', false));
                                            queue.push_back((b'A', false));
                                            st = St::Norm;
                                            continue;
                                        }
                                    }
                                }
                                break;
                            }
                        }
                        let depth = queue.len();
                        hw.fetch_max(depth, O::Relaxed);
                        if depth > cap {
                            of.store(true, O::Relaxed);
                        }
                    }
                    _ => {
                        if queue.is_empty() && idle.elapsed() > Duration::from_secs(4) {
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            }
        });

        FakeCutter {
            overflowed,
            high_water,
            plotted,
        }
    }

    /// The rate the fake cutter turns commands into cut vinyl.
    ///
    /// THIS NUMBER IS THE WHOLE POINT and the first version of it was wrong.
    /// It was set to 4000 bytes a second, which is faster than 9600 baud can
    /// even deliver — so the fake cutter could never fall behind, could never
    /// overflow, and every "proof" built on it proved nothing. The falsification
    /// test caught that, which is exactly what it is for.
    ///
    /// A real cutter is limited by the BLADE, not the wire: it has to move a
    /// motor and let a swivel knife follow round every corner. Four hundred
    /// bytes a second against 9600 baud's 960 is the honest shape of the
    /// problem — the machine consuming work at well under half the rate the
    /// cable can deliver it, falling further behind on every shape until its
    /// buffer is full and the rest of the sheet goes on the floor.
    #[cfg(unix)]
    const BLADE_RATE: usize = 400;

    #[cfg(unix)]
    fn full_sheet() -> String {
        // A sheet filled with small pieces — the exact job the shop reported
        // dying two thirds of the way down. Comfortably larger than any cheap
        // cutter's buffer, and small enough that a test does not take a minute.
        let mut h = String::from("IN;SP1;");
        for shape in 0..12 {
            h.push_str(&format!("PU{},{};", shape * 300, 0));
            for i in 0..24 {
                h.push_str(&format!("PD{},{};", shape * 300 + i * 7, i * 11));
            }
        }
        h.push_str("PU0,0;");
        h
    }

    #[cfg(unix)]
    #[test]
    fn a_small_buffered_cutter_is_never_overrun() {
        let _bench = one_at_a_time();
        patience(6000);
        use serialport::{SerialPort, TTYPort};
        use std::sync::atomic::Ordering as O;

        let (master, slave) = TTYPort::pair().expect("no pty pair");
        let name = slave.name().unwrap();
        drop(slave);
        let fake = run_fake_cutter(master, 512, BLADE_RATE, true, true);

        let c = Cutter::default();
        open_on(&c, &name, 9600, "none").expect("open failed");
        {
            let cfg = c.1.lock().unwrap();
            assert_eq!(
                cfg.as_ref().unwrap().pace,
                Pace::Credit,
                "a cutter that answers ESC.B must be fed on credit"
            );
        }

        let job = full_sheet();
        write_on(&c, &job).expect("the sheet did not finish");

        assert!(
            !fake.overflowed.load(O::Relaxed),
            "the cutter's buffer was overrun — high water {} of 512",
            fake.high_water.load(O::Relaxed)
        );
        assert!(
            fake.high_water.load(O::Relaxed) > 0,
            "the fake cutter never received anything, so this proved nothing"
        );

        // and every byte arrived, in order.
        //
        // write_on returns when the last byte has been HANDED OVER; the cutter
        // is still cutting for a moment after that. Wait for it to go quiet
        // rather than guessing at a sleep, which is how this read short by
        // exactly one blade-second the first time.
        let mut got = Vec::new();
        for _ in 0..60 {
            std::thread::sleep(Duration::from_millis(100));
            let now = fake.plotted.lock().unwrap().clone();
            if now.len() == got.len() && !now.is_empty() {
                break;
            }
            got = now;
        }
        let want: Vec<u8> = job.bytes().collect();
        assert!(
            got.len() >= want.len() - 8,
            "only {} of {} bytes were ever plotted",
            got.len(),
            want.len()
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_old_wire_pacing_really_does_overrun_this_cutter() {
        let _bench = one_at_a_time();
        patience(6000);
        use serialport::{SerialPort, TTYPort};
        use std::sync::atomic::Ordering as O;

        // THE TEST WITH TEETH.
        //
        // Everything else here proves the new code behaves. This one proves the
        // old code did NOT — that the fake cutter is a fair model of the machine
        // on the bench, and not a straw man rigged to pass. Drive the identical
        // sheet at the identical cutter with 10.7.5's wire pacing and its buffer
        // must overflow, because that is the fault the shop has been living
        // with for four releases.
        //
        // If this test ever starts passing quietly, the fake has stopped
        // modelling a real cutter and every other proof here is worthless.
        let (master, slave) = TTYPort::pair().expect("no pty pair");
        let name = slave.name().unwrap();
        drop(slave);
        let fake = run_fake_cutter(master, 512, BLADE_RATE, false, false);

        let c = Cutter::default();
        open_on(&c, &name, 9600, "none").expect("open failed");
        {
            let cfg = c.1.lock().unwrap();
            assert_eq!(
                cfg.as_ref().unwrap().pace,
                Pace::Wire,
                "a silent cutter should leave us on wire pacing"
            );
        }

        let _ = write_on(&c, &full_sheet());
        assert!(
            fake.overflowed.load(O::Relaxed),
            "wire pacing did NOT overrun a 512-byte buffer (high water {}), so this \
             fake cutter is not modelling the real fault and the other tests prove nothing",
            fake.high_water.load(O::Relaxed)
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_cutter_that_only_answers_oa_still_finishes() {
        let _bench = one_at_a_time();
        patience(6000);
        use serialport::{SerialPort, TTYPort};
        use std::sync::atomic::Ordering as O;

        let (master, slave) = TTYPort::pair().expect("no pty pair");
        let name = slave.name().unwrap();
        drop(slave);
        // answers_free = false: this machine has no ESC.B at all.
        let fake = run_fake_cutter(master, 1024, BLADE_RATE, false, true);

        let c = Cutter::default();
        open_on(&c, &name, 9600, "none").expect("open failed");
        {
            let cfg = c.1.lock().unwrap();
            assert_eq!(
                cfg.as_ref().unwrap().pace,
                Pace::Barrier,
                "a cutter that answers only OA must be fed on barriers"
            );
        }

        write_on(&c, &full_sheet()).expect("the sheet did not finish");
        let ended_on = c.1.lock().unwrap().as_ref().unwrap().pace;
        assert!(
            !fake.overflowed.load(O::Relaxed),
            "buffer overrun at {} of 1024 (finished on {:?} pacing)",
            fake.high_water.load(O::Relaxed),
            ended_on
        );
        assert_eq!(
            ended_on,
            Pace::Barrier,
            "dropped out of barrier feeding on a cutter that was answering"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_cutter_that_goes_quiet_mid_job_still_gets_the_rest() {
        let _bench = one_at_a_time();
        patience(700);
        use serialport::{SerialPort, TTYPort};

        // The nightmare: the cutter talks at connect, then stops answering half
        // way down the sheet. Abandoning the job there is the one outcome that
        // definitely wastes the vinyl, so the sender must drop to a weaker pace
        // and push the rest out.
        let (mut master, slave) = TTYPort::pair().expect("no pty pair");
        let name = slave.name().unwrap();
        drop(slave);

        std::thread::spawn(move || {
            master.set_timeout(Duration::from_millis(5)).unwrap();
            let mut tail = Vec::new();
            let mut answers = 0;
            let mut b = [0u8; 256];
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(25) {
                if let Ok(n) = master.read(&mut b) {
                    for &byte in &b[..n] {
                        tail.push(byte);
                        if tail.len() > 3 {
                            tail.remove(0);
                        }
                        if tail.ends_with(b"\x1B.B") && answers < 3 {
                            answers += 1;
                            let _ = master.write_all(b"1024\r");
                            let _ = master.flush();
                        }
                    }
                }
            }
        });

        let c = Cutter::default();
        open_on(&c, &name, 9600, "none").expect("open failed");
        write_on(&c, &full_sheet()).expect("a cutter going quiet lost the rest of the sheet");
    }

    #[cfg(unix)]
    #[test]
    fn a_cutter_that_says_nothing_is_still_driven() {
        let _bench = one_at_a_time();
        patience(6000);
        use serialport::{SerialPort, TTYPort};
        use std::io::Read as _;

        // A pty answers nothing, which is exactly a cutter with no output
        // channel wired. It must still be fed — on the wire pacing every
        // version up to 10.7.5 used — rather than refused at connect.
        let (mut master, slave) = TTYPort::pair().expect("no pty pair");
        let name = slave.name().unwrap();
        drop(slave);

        let c = Cutter::default();
        open_on(&c, &name, 9600, "none").expect("open failed");
        {
            let cfg = c.1.lock().unwrap();
            assert_eq!(cfg.as_ref().unwrap().pace, Pace::Wire);
        }

        let job = "IN;SP1;PU0,0;PD1016,0;PD1016,1016;PU0,0;";
        let want = job.to_string();
        let reader = std::thread::spawn(move || {
            master.set_timeout(Duration::from_secs(8)).unwrap();
            let mut got = Vec::new();
            let mut b = [0u8; 64];
            let until = Instant::now() + Duration::from_secs(8);
            while Instant::now() < until && got.len() < want.len() + PROBE.len() {
                if let Ok(n) = master.read(&mut b) {
                    got.extend_from_slice(&b[..n]);
                }
            }
            // Hold the pty open a moment longer. Returning the instant the last
            // byte lands drops this end of the pipe while the sender is still
            // inside its final flush, and the test then blames the sender for a
            // pipe the TEST closed.
            std::thread::sleep(Duration::from_millis(300));
            got
        });
        write_on(&c, job).expect("write failed");
        let got = reader.join().unwrap();
        let text = String::from_utf8_lossy(&got);
        assert!(
            text.contains("PD1016,1016;"),
            "the job did not arrive: {:?}",
            text
        );
    }

}

fn main() {
    tauri::Builder::default()
        .manage(Cutter::default())
        .invoke_handler(tauri::generate_handler![
            list_ports,
            open_port,
            write_port,
            close_port,
            port_mode,
            port_pace,
            port_progress
        ])
        // The studio window is built here rather than declared in tauri.conf.json
        // for one reason: a window that comes from the config gets no new-window
        // handler, and without one the web view refuses every window.open outright.
        // That refusal is what would stop the shop from dragging the tool panels
        // onto a second monitor, so the window has to be built in code where the
        // handler can be attached to it.
        .setup(|app| {
            tauri::webview::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("JZAK Cuts — Vinyl Cutting Studio")
            .inner_size(1440.0, 900.0)
            .min_inner_size(1100.0, 720.0)
            .resizable(true)
            .maximizable(true)
            .center()
            .decorations(true)
            // dropping a file on the canvas is handled by the page itself, so the
            // shell must keep its hands off the drag events
            .disable_drag_drop_handler()
            // Let the tool-panel window through. It is our own page asking for a
            // second view of itself; the default implementation gives back a real
            // window in the same context, which is what lets a panel be moved into
            // it and keep every listener it was wired with.
            .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Allow)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("JZAK Cuts failed to start");
}
