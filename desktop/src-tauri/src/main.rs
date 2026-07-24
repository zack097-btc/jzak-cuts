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
struct Cutter(Mutex<Option<Box<dyn serialport::SerialPort>>>);

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
fn open_port(state: tauri::State<Cutter>, name: String, baud: u32) -> Result<(), String> {
    open_on(&state, &name, baud)
}

#[tauri::command]
fn write_port(state: tauri::State<Cutter>, data: String) -> Result<(), String> {
    write_on(&state, &data)
}

#[tauri::command]
fn close_port(state: tauri::State<Cutter>) -> Result<(), String> {
    close_on(&state)
}

fn open_on(cutter: &Cutter, name: &str, baud: u32) -> Result<(), String> {
    // Hardware handshaking is what the cutter expects, and it is what keeps a
    // long path from overrunning the machine's buffer. Some cheap USB adapters
    // are wired without the handshake lines, though, and on those a hardware
    // open leaves every write hanging — so if it will not take, fall back and
    // let the cutter's own buffer cope.
    let build = |flow: serialport::FlowControl| {
        serialport::new(name, baud)
            .data_bits(serialport::DataBits::Eight)
            .stop_bits(serialport::StopBits::One)
            .parity(serialport::Parity::None)
            .flow_control(flow)
            .timeout(Duration::from_secs(10))
            .open()
    };
    let port = match build(serialport::FlowControl::Hardware) {
        Ok(p) => p,
        Err(first) => build(serialport::FlowControl::None)
            .map_err(|second| format!("{} (also tried without handshaking: {})", first, second))?,
    };

    let mut slot = cutter.0.lock().map_err(|_| "serial port is wedged".to_string())?;
    *slot = Some(port);
    Ok(())
}

fn write_on(cutter: &Cutter, data: &str) -> Result<(), String> {
    let mut slot = cutter.0.lock().map_err(|_| "serial port is wedged".to_string())?;
    let port = slot
        .as_mut()
        .ok_or_else(|| "The cutter is not connected.".to_string())?;

    // Sent in small pieces, same as the browser build: a cutter with a modest
    // buffer would otherwise be handed more than it can hold at once.
    for chunk in data.as_bytes().chunks(256) {
        port.write_all(chunk).map_err(|e| e.to_string())?;
    }
    port.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn close_on(cutter: &Cutter) -> Result<(), String> {
    let mut slot = cutter.0.lock().map_err(|_| "serial port is wedged".to_string())?;
    *slot = None; // dropping the handle closes it
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

    #[test]
    fn a_port_that_is_not_there_reports_both_attempts() {
        let c = Cutter::default();
        let err = open_on(&c, "/dev/there-is-no-cutter-here", 9600).unwrap_err();
        assert!(
            err.contains("also tried without handshaking"),
            "the fallback attempt was not reported: {err}"
        );
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
        open_on(&c, &name, 9600).expect("opening the pty failed");

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
        open_on(&c, &name, 9600).unwrap();

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
            close_port
        ])
        .run(tauri::generate_context!())
        .expect("JZAK Cuts failed to start");
}
