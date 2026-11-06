"""Build the public static site with consistent versioned asset URLs.

No private data is read. Versioned imports prevent an older installed worker
from mixing the new HTML with older JavaScript modules.
"""
from pathlib import Path
import hashlib
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'pages'
OUTPUT = ROOT / '.pages-dist'


def build():
    version = re.search(r"APP_VERSION='(\d+\.\d+\.\d+)'", (SOURCE / 'assets/core.mjs').read_text(encoding='utf-8')).group(1)
    # The only removable directory is this build output, directly in the repo.
    target = OUTPUT.resolve()
    if target.parent != ROOT or target.name != '.pages-dist' or OUTPUT.is_symlink() or OUTPUT.is_junction():
        raise RuntimeError('Invalid build output directory')
    if OUTPUT.exists():
        if any(p.is_symlink() or p.is_junction() for p in OUTPUT.rglob('*')):
            raise RuntimeError('Links are forbidden in build output')
        shutil.rmtree(OUTPUT)
    if any(p.is_symlink() or p.is_junction() for p in SOURCE.rglob('*')):
        raise RuntimeError('Links are forbidden in public sources')
    shutil.copytree(SOURCE, OUTPUT)

    def tagged(path):
        return path + ('&' if '?' in path else '?') + 'v=' + version

    page = OUTPUT / 'index.html'
    html = page.read_text(encoding='utf-8')
    html = re.sub(r'(<span class="version">)[^<]+(</span>)', lambda m: m.group(1) + version + m.group(2), html)
    html = re.sub(r'((?:src|href)=")(?P<path>\./(?:assets/[^"#]+|manifest\.webmanifest|GITHUB_PAGES\.md))(\")', lambda m: m.group(1) + tagged(m.group('path')) + m.group(3), html)
    page.write_bytes(html.encode('utf-8'))
    imports = re.compile(r'''(?P<prefix>\bfrom\s+|\bimport\s*\(\s*|\bnew\s+URL\s*\(\s*)(?P<q>['"])(?P<path>\./[^'"]+)(?P=q)''')
    for path in (OUTPUT / 'assets').glob('*.mjs'):
        text = path.read_text(encoding='utf-8')
        text = imports.sub(lambda m: m.group('prefix') + m.group('q') + tagged(m.group('path')) + m.group('q'), text)
        path.write_bytes(text.encode('utf-8'))
    worker = OUTPUT / 'sw.js'
    text = worker.read_text(encoding='utf-8')
    text = re.sub(r"const CACHE='[^']+';", "const CACHE='moneyscout-static-" + version + "';", text)
    text = re.sub(r"const ASSETS=\[(.*?)\];", lambda m: 'const ASSETS=[' + re.sub(r"'([^']+)'", lambda x: "'" + (tagged(x.group(1)) if x.group(1) not in ['./', 'index.html'] else x.group(1)) + "'", m.group(1)) + '];', text, flags=re.S)
    worker.write_bytes(text.encode('utf-8'))
    files = {p.relative_to(OUTPUT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUTPUT.rglob('*')) if p.is_file()}
    (OUTPUT / 'release.json').write_bytes((json.dumps({'version': version, 'files': files}, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'version': version, 'files': len(files), 'output': str(OUTPUT)}))


if __name__ == '__main__':
    build()
