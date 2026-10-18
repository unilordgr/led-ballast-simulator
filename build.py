"""Build index.html (one self-contained file) from src/.

    python3 build.py

The page needs no server and no install: open index.html in a browser, or host it as a static file (GitHub Pages works).
"""
import os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
read = lambda n: open(os.path.join(ROOT, "src", n), encoding="utf-8").read()

model = read("model.js")
parts = ["util.js", "scene.js", "rig.js", "front.js", "views.js", "app.js"]
js = model + "\n(function () {\n'use strict';\n" + "\n".join(read(n) for n in parts) + "\n})();\n"

node = shutil.which("node")                      # optional syntax check
if node:
    tmp = os.path.join(ROOT, "build"); os.makedirs(tmp, exist_ok=True)
    bundle = os.path.join(tmp, "app.bundle.js"); open(bundle, "w", encoding="utf-8").write(js)
    r = subprocess.run([node, "--check", bundle], capture_output=True, text=True)
    if r.returncode:
        print("SYNTAX ERROR\n" + r.stderr); sys.exit(1)

fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700'
         '&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n')
css = read("style.css") + "\n[hidden]{display:none!important}\n"
head = ('<title>LED Wall Ballast Simulator</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
        '<meta name="description" content="Tip-over, bending, strap and stage checks for stacked LED screens.">\n'
        + fonts + "<style>\n" + css + "</style>\n")
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0;font:14px system-ui,sans-serif}</style>\n' + head + '</head>\n<body>\n' + read("body.html")
        + "\n<script>\n" + js + "</script>\n</body>\n</html>\n")
out = os.path.join(ROOT, "index.html")
open(out, "w", encoding="utf-8").write(page)
print("built", len(page), "bytes ->", out)
