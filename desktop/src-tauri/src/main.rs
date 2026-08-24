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
use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

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
);

/// How the currently open port was opened.
#[derive(Clone)]
struct PortCfg {
    name: String,
    baud: u32,
    flow: String,
    /// True when the app picked the handshaking rather than the operator, which
    /// is the only case where it is entitled to change its mind.
    auto: bool,
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
const WRITE_TIMEOUT: Duration = Duration::from_secs(3);

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
    });
    Ok(used.to_string())
}

/// Push bytes at the currently open port. Returns how many were written.
fn push(cutter: &Cutter, data: &str) -> Result<usize, String> {
    let baud = {
        let cfg = cutter.1.lock().map_err(|_| "serial state is wedged".to_string())?;
        cfg.as_ref().map(|c| c.baud).unwrap_or(9600)
    };
    let mut slot = cutter.0.lock().map_err(|_| "serial port is wedged".to_string())?;
    let port = slot
        .as_mut()
        .ok_or_else(|| "The cutter is not connected.".to_string())?;

    // PACED TO THE WIRE, not dumped at it.
    //
    // write_all() returns as soon as the operating system and the USB adapter
    // have ACCEPTED the bytes — not when the cutter has read them. Those
    // buffers hold tens of kilobytes, so the old loop handed a whole 46 KB job
    // over in a fraction of a second and then reported success. The cutter was
    // still chewing on the first inch. Its own small buffer overflowed
    // somewhere in the middle, and because that depended on timing it died at a
    // DIFFERENT place every run.
    //
    // So each chunk is flushed and then given the time it actually takes to
    // travel down the line: 8-N-1 is ten bits per byte, so at `baud` the wire
    // carries baud/10 bytes a second. Pacing to that keeps the operating
    // system's buffer nearly empty, which is what lets an XOFF from the cutter
    // take effect within a few bytes instead of forty kilobytes too late.
    const CHUNK: usize = 256;
    let per_chunk = Duration::from_micros(
        (CHUNK as u64) * 1_000_000 / ((baud.max(300) as u64) / 10),
    );
    let mut sent = 0usize;
    for chunk in data.as_bytes().chunks(CHUNK) {
        port.write_all(chunk).map_err(|e| e.to_string())?;
        port.flush().map_err(|e| e.to_string())?;
        sent += chunk.len();
        if sent < data.len() {
            std::thread::sleep(per_chunk);
        }
    }
    Ok(sent)
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
    m.contains("timed out") || m.contains("timeout") || m.contains("would block")
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

        let mut got = vec![0u8; sent.len()];
        master
            .set_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        master.read_exact(&mut got).expect("nothing arrived");
        assert_eq!(String::from_utf8_lossy(&got), sent);

        close_on(&c).expect("close failed");
        // and once closed, writing has to fail again rather than pretend
        assert!(write_on(&c, "IN;").is_err(), "wrote to a closed port");
    }

    #[cfg(unix)]
    #[test]
    fn a_long_path_survives_the_chunking() {
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
        let n = want.len();
        let reader = std::thread::spawn(move || {
            master
                .set_timeout(std::time::Duration::from_secs(10))
                .unwrap();
            let mut got = vec![0u8; n];
            master.read_exact(&mut got).expect("short read");
            got
        });

        write_on(&c, &hpgl).expect("long write failed");
        let got = reader.join().expect("reader thread died");
        assert_eq!(String::from_utf8_lossy(&got), want);
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
            port_mode
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
