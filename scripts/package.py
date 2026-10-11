"""Bundle the files Qollab needs into dist/transpile-lens-qollab.zip.

Qollab runs the project from top-level index.html + main.js, so the zip holds
the page, the ui/ modules, the lens/ Python package, the precomputed traces
and requirements.txt. README.md becomes the project card on creation. Tests,
scripts and the dev server stay in the repository.
"""

from __future__ import annotations

import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["index.html", "main.js", "main.css", "requirements.txt", "README.md", "LICENSE"]
FOLDERS = {"ui": "*.js", "lens": "*.py", "data/traces": "*.json"}
MAX_BYTES = 2 * 1024 * 1024  # Qollab's per-file limit


def main() -> None:
    paths = [ROOT / f for f in FILES]
    for folder, pattern in FOLDERS.items():
        paths += sorted((ROOT / folder).glob(pattern))
    out = ROOT / "dist" / "transpile-lens-qollab.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in paths:
            size = path.stat().st_size
            if size > MAX_BYTES:
                raise SystemExit(f"{path.name} is {size} bytes, over Qollab's 2 MB limit")
            zf.write(path, path.relative_to(ROOT).as_posix())
    print(f"{out.relative_to(ROOT)}: {len(paths)} files (limit 100)")


if __name__ == "__main__":
    main()
