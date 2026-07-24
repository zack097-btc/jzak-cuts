# JZAK Cuts — the installed desktop version

The studio is one HTML file. This folder is the small native program that puts
that file in a real window and gives it a real serial port.

## Why it exists

A browser tab reaches the cutter through the Web Serial API. Chrome and Edge
have it; the web view Windows itself ships — the one an installed app runs on —
does not. Wrapping the app without addressing that would have produced something
that designs beautifully and cannot cut, which is worse than useless in a shop.

So the desktop build does not borrow the browser's serial port. It opens the COM
port itself, in Rust, and holds it. That is the better arrangement anyway: a port
the program owns outright cannot be revoked halfway through a forty-minute cut
by a browser deciding the tab lost focus.

The front end does not know or care which of the two it is talking to. Both sit
behind one small object, `CutterIO`, in `index.src.html`:

| | browser | installed app |
|---|---|---|
| how it connects | `navigator.serial.requestPort()` | `list_ports` ▸ pick ▸ `open_port` |
| who owns the port | the browser | this program |
| picking a port | Chrome's own dialog | our chooser, which labels each port |
| offline | service worker cache | every byte is inside the .exe |

Both paths are covered by `testserial.cjs` in the parent folder, which stands in
a fake bridge before the page loads and drives the desktop branch in a headless
browser — including the no-ports case and the two-ports chooser. The Rust half
has its own tests, run with `cargo test` from `src-tauri`; two of them push real
bytes down a real tty and read them back out the other end.

## What is in here

```
src-tauri/
  src/main.rs        the window, and the four serial commands
  Cargo.toml         dependencies — all MIT/Apache, nothing that limits resale
  tauri.conf.json    window size, installer settings, icons
  capabilities/      what the window is permitted to do: the core set, nothing more
  icons/             cut from icon-512.png at build time (not committed)
dist/                the studio, staged here at build time (not committed)
make_icons.py        the thing that cuts them
SIGNING.md           how to sign the installer once you have a certificate
```

Two folders here are built, not stored: `dist/` and `src-tauri/icons/`. That is
deliberate. There is one `index.html` and one logo in this project, and both the
website and the installer are made from those same two files, so neither can
quietly go stale.

### The four serial commands

| command | what it does |
|---|---|
| `list_ports` | every COM port, each flagged USB or not, with a readable name |
| `open_port` | opens one at 9600 8-N-1, hardware handshaking, falling back to none |
| `write_port` | sends HPGL in 256-byte pieces, then flushes |
| `close_port` | drops the handle, which closes it |

The handshake fallback is there because some cheap USB-to-serial adapters are
wired without the handshake lines. On those, a hardware open leaves every write
hanging forever. If the hardware open will not take, the second attempt goes
without it and lets the cutter's own buffer cope.

## Building it

**On Windows**, which is what you want for an installer:

```
cargo install tauri-cli --version "^2"
pip install pillow
python build.py                 # from the repository root — stages dist/
python desktop/make_icons.py    # cuts the icons from icon-512.png
cd desktop
cargo tauri build
```

The installers land in `src-tauri/target/release/bundle/` — an NSIS `.exe` and
an `.msi`. The `.exe` is the one to hand out: it installs for the current user,
so it never asks for administrator rights.

**Or let GitHub build it.** `.github/workflows/build-windows.yml` does the same
thing on a Windows machine in the cloud. Push a tag starting with `v` and it
builds, tests, and attaches both installers to a Release. Or run it by hand from
the repository's Actions tab whenever you want a fresh copy to try.

## Notes for later

- The version lives in two places that must agree: `Cargo.toml` and
  `tauri.conf.json`. Bump both, then tag the commit to match.
- `app.security.csp` is deliberately `null`. The studio is one enormous inline
  script; a content security policy would refuse to run it.
- There is no auto-update yet. Adding it means the Tauri updater plugin, a
  signing key pair, and somewhere to host the update manifest — worth doing
  before this goes to other people, not before it goes to your own bench.
- Nothing generated is committed. If a build ever produces something that has to
  be kept, it belongs in a release, not in the source.
