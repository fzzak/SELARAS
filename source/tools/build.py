"""Assemble the app into one self-contained index.html.

  python3 tools/build.py                          -> dist/index.html with every folder in datasets/ built in
  python3 tools/build.py --site OUT --only a,b    -> OUT/index.html for a normal website, with only the named
                                                    dataset folders built in and the example-folder download on

Never build restricted survey data into a site that other people can open: leave it out with --only and load
it in the app from your own computer instead.
"""
import argparse, json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
ap = argparse.ArgumentParser(); ap.add_argument('--site'); ap.add_argument('--only'); args = ap.parse_args()
names = sorted(d for d in os.listdir(os.path.join(root, 'datasets')) if os.path.isdir(os.path.join(root, 'datasets', d)))
names.sort(key=lambda n: n == 'null_island_test')           # the synthetic test set goes last when real data is present
if args.only: names = [n for n in names if n in args.only.split(',')]
assert names, 'no dataset folders to build in'
builtin = {}
for name in names:
    d = os.path.join(root, 'datasets', name)
    builtin[name] = {f: open(os.path.join(d, f), encoding='utf-8').read() for f in sorted(os.listdir(d))}
data = json.dumps(builtin, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/').replace('<!--', '<\\!--')
js = '\n'.join(rd('src/' + f) for f in ['core.js', 'gl.js', 'scene.js', 'panels.js'])
assert '</script' not in js
html = (rd('src/index.template.html').replace('/*CSS*/', rd('src/style.css')).replace('/*DATA*/', data)
        .replace('/*SITE*/false', 'true' if args.site else 'false').replace('/*JS*/', js)
        .replace('/*LOCKUP*/', rd('brand/dimidiatus_lockup.b64').strip()).replace('/*FAVICON*/', rd('brand/fish_icon.b64').strip()))
out = args.site or os.path.join(root, 'dist'); os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(html)
print(os.path.join(out, 'index.html'), round(len(html.encode()) / 1024), 'KB | built in:', ', '.join(names))
