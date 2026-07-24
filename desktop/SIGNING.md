# Code signing

Right now the installer is unsigned. It works perfectly — it just makes Windows
put up a blue **"Windows protected your PC"** panel the first time somebody runs
it, and they have to click *More info ▸ Run anyway* to get past it. That is fine
for your own shop machine. It is not fine on a paid product, because a fair
number of buyers will read that panel as "this is a virus" and ask for a refund
instead of clicking through.

Signing removes the panel. It is the one part of this build that cannot be done
from here, because it needs a certificate issued to you, in your legal name, by
a certificate authority that verifies who you are.

## What to buy

Two kinds exist, and the difference matters more than the price:

**OV (Organization Validation)** — around $200–400 a year. The blue panel goes
away, but a brand-new certificate has no reputation with Microsoft SmartScreen
yet, so for the first few weeks — until enough copies have been downloaded and
run without incident — some users may still see a warning. It clears up on its
own.

**EV (Extended Validation)** — around $350–700 a year, and it ships on a
hardware token or lives in a cloud HSM. SmartScreen trusts an EV certificate
from the first download, so there is no warm-up period at all. If you are
selling this, EV is the one worth paying for.

Either way you will be asked to prove the business exists: a registered business
name, a verifiable phone listing, and usually a D-U-N-S number. Allow one to
three weeks for that, longer for EV. Start it before you plan to sell, not after.

Sellers that other small software shops use include DigiCert, Sectigo, SSL.com,
and Certera; resellers such as SignMyCode and CodeSignCert list the same
certificates cheaper. Prices move around, so check current ones before buying.

## Signing a build once you have the certificate

Tauri signs the installer for you during the build, using Windows' own
`signtool`, as soon as it knows which certificate to use.

**1. Get the certificate's thumbprint.** In PowerShell, with the certificate
installed in your certificate store:

```powershell
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Select-Object Subject, Thumbprint
```

**2. Tell the build about it.** In `desktop/src-tauri/tauri.conf.json`, inside
`bundle.windows`, add:

```json
"certificateThumbprint": "PASTE_THE_THUMBPRINT_HERE",
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.digicert.com"
```

The timestamp URL matters: it is what keeps installers you shipped this year
still trusted after the certificate itself expires. Do not leave it out.

**3. Build.** `cargo tauri build` from `desktop/`, on a machine where the
certificate is installed (and, for EV, with the hardware token plugged in).

## Signing in the automated build instead

An EV certificate on a physical USB token cannot be used by GitHub's build
machines — there is nothing to plug the token into. Two ways around that:

- **Build on your own PC** for releases, and let GitHub Actions keep doing the
  unsigned test builds. Simplest, and it costs nothing.
- **Use a cloud-signing service** — Azure Trusted Signing, DigiCert KeyLocker,
  SSL.com eSigner. The key stays in their HSM and the build calls out to it.
  These plug into the workflow as an extra step after the bundle is produced,
  and they run about $10–40 a month on top of the certificate.

The workflow file already reads two secrets, `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Those are for Tauri's *updater* signature,
which is a separate thing from Windows code signing — it is what lets the app
verify that an update really came from you. Generate that pair with
`cargo tauri signer generate`, put the private key and its password into the
repository's Settings ▸ Secrets ▸ Actions, and keep the public key. Nothing
breaks while they are empty; the app simply has no auto-update yet.

## What signing does not do

It does not vouch for the program, only for who published it. It also does not
stop antivirus false positives outright, though it makes them far rarer. If one
ever comes up, submit the installer to the vendor's false-positive form — they
generally clear a signed binary within a day or two.
