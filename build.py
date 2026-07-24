# Builds index.html — the whole studio in one file — out of the editable source
# beside this script plus the three libraries and the font payload. Everything it
# reads lives in this repository, so a fresh clone rebuilds byte-for-byte.
#
#   python build.py        (run from the repository root)

import re
src=open('index.src.html',encoding='utf-8').read()
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
