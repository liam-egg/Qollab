"""Precompute traces for every preset into data/traces/<id>.json.

Run from the project root:  python scripts/build_traces.py
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lens.presets import PRESETS  # noqa: E402
from lens.trace import trace_bundle  # noqa: E402


def main() -> None:
    out_dir = ROOT / "data" / "traces"
    out_dir.mkdir(parents=True, exist_ok=True)
    index = []
    for pid, meta in PRESETS.items():
        circuit = meta["build"]()
        bundle = trace_bundle(circuit, {"id": pid, **{k: meta[k] for k in ("title", "blurb")}})
        if bundle["errors"]:
            raise SystemExit(f"{pid}: {bundle['errors']}")
        path = out_dir / f"{pid}.json"
        path.write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
        line = ", ".join(
            f"{t}: depth {tr['summary']['initial']['depth']}->{tr['summary']['final']['depth']}"
            f" 2q {tr['summary']['initial']['twoq']}->{tr['summary']['final']['twoq']}"
            f" swaps {tr['summary']['swaps_inserted']}"
            for t, tr in bundle["traces"].items()
        )
        print(f"{pid:10s} {path.stat().st_size / 1024:6.1f} KB  {line}")
        index.append({"id": pid, "title": meta["title"], "blurb": meta["blurb"],
                      "num_qubits": circuit.num_qubits})
    (out_dir / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
