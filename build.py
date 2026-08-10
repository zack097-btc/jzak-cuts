# Builds index.html — the whole studio in one file — out of the editable source
# beside this script plus the three libraries and the font payload. Everything it
# reads lives in this repository, so a fresh clone rebuilds byte-for-byte.
#
#   python build.py        (run from the repository root)

import re, json
src=open('index.src.html',encoding='utf-8').read()

# The version now appears on screen, so it has to be TRUE. Three files carry it
# — the studio, the Tauri manifest and the crate — and if they disagree the
# installer says one thing while the app says another. That is worse than no
# version at all, so the build refuses rather than shipping the contradiction.
_v = re.search(r'const JZAK_VERSION="([^"]+)"', src)
assert _v, 'no JZAK_VERSION in index.src.html'
UIV = _v.group(1)
_conf = json.load(open('desktop/src-tauri/tauri.conf.json', encoding='utf-8'))
CONFV = _conf.get('version') or _conf.get('package', {}).get('version')
CARGOV = re.search(r'^version\s*=\s*"([^"]+)"',
                   open('desktop/src-tauri/Cargo.toml', encoding='utf-8').read(),
                   re.M).group(1)
assert UIV == CONFV == CARGOV, (
    'version drift: index.src.html=%s tauri.conf.json=%s Cargo.toml=%s' % (UIV, CONFV, CARGOV))
print('version', UIV, '(studio / tauri.conf / Cargo.toml agree)')
# Every bundled font, SIL Open Font Licence, base64'd. Kept as its own file
# rather than pasted into the source so the source stays readable.
fonts=open('fonts.json',encoding='utf-8').read()
ot=open('libs/opentype.min.js',encoding='utf-8').read()
jt=open('libs/jzaktrace.js',encoding='utf-8').read()
cl=open('libs/clipper.js',encoding='utf-8').read()
assert '</script>' not in ot and '</script>' not in jt and '</script>' not in cl, "literal close tag in libs!"
out=src.replace('__EMBEDDED_FONTS_JSON__', fonts)
out=out.replace('<!--OPENTYPE_JS-->', '<script>'+ot+'</script>')
out=out.replace('<!--JZTRACE_JS-->', '<script>'+jt+'</script>')
out=out.replace('<!--CLIPPER_JS-->', '<script>'+cl+'</script>')
assert '__EMBEDDED_FONTS_JSON__' not in out
assert '<!--OPENTYPE_JS-->' not in out and '<!--JZTRACE_JS-->' not in out and '<!--CLIPPER_JS-->' not in out
open('index.html','w',encoding='utf-8').write(out)
print('built index.html', len(out), 'bytes')

# The desktop shell serves the very same file, so it is copied rather than
# rebuilt — one build, two ways to run it, and no chance of the installed app
# quietly falling a version behind the website.
import os, shutil
dist = os.path.join('desktop', 'dist')
os.makedirs(dist, exist_ok=True)
shutil.copyfile('index.html', os.path.join(dist, 'index.html'))
for f in ('icon-192.png', 'icon-512.png', 'manifest.webmanifest'):
    if os.path.exists(f):
        shutil.copyfile(f, os.path.join(dist, f))
print('staged', dist)
