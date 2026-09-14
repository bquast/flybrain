#!/usr/bin/env python3
"""Join public FlyWire v783 cell types to FlyBrain's ORIGINAL binary indices.
No root IDs are converted to floating point. No connectome edges are changed.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import struct
import urllib.request

ANNOTATION_COMMIT = "8587524c1748ce5ef2080822a2fc890fc03bf597"
ANNOTATION_URL = (
    "https://raw.githubusercontent.com/flyconnectome/flywire_annotations/"
    + ANNOTATION_COMMIT
    + "/supplemental_files/Supplemental_file1_neuron_annotations.tsv"
)
GROUPS = ("LPLC2", "LC4", "LC11", "GF", "descending", "photoreceptors", "T4", "T5")

def build(data_dir, annotation_bytes):
    with gzip.open(data_dir / "neurons.csv.gz", "rt", newline="") as f:
        roots = [row["root_id"] for row in csv.DictReader(f)]
    if len(set(roots)) != len(roots):
        raise ValueError("Duplicate root IDs in canonical neuron order")
    with gzip.open(data_dir / "connectome.bin.gz", "rb") as f:
        n, edges = struct.unpack("<II", f.read(8))
    if n != len(roots):
        raise ValueError("Canonical index does not match the connectome")
    indices = {rid: i for i, rid in enumerate(roots)}
    groups = {name: {"left": [], "right": [], "center": []} for name in GROUPS}
    labels = []
    rows = csv.DictReader(io.StringIO(annotation_bytes.decode("utf-8-sig")), delimiter="\t")
    required = {"root_id", "side", "cell_type", "hemibrain_type", "super_class"}
    if not required.issubset(rows.fieldnames or []):
        raise ValueError("Unexpected FlyWire annotation schema: " + repr(rows.fieldnames))
    seen = set()
    for row in rows:
        rid = row["root_id"]
        if rid not in indices:
            continue
        if rid in seen:
            raise ValueError("Duplicate annotation for " + rid)
        seen.add(rid)
        i = indices[rid]
        side = row["side"].strip().lower()
        side = side if side in ("left", "right") else "center"
        names = set()
        for field in ("cell_type", "hemibrain_type", "synonyms"):
            for value in row.get(field, "").replace(";", ",").split(","):
                value = value.strip()
                if value and value not in ("NA", "nan"):
                    names.add(value)
        selected = []
        for group in ("LPLC2", "LC4", "LC11"):
            if group in names:
                selected.append(group)
        if names.intersection({"GF", "DNp01", "giant_fiber", "Giant Fiber"}):
            selected.append("GF")
        if row["super_class"].strip().lower() == "descending":
            selected.append("descending")
        sub = row.get("cell_sub_class", "").lower()
        if sub == "photo_receptor":
            selected.append("photoreceptors")  # coarse superclass probe; see documentation
        if any(v == "T4" or v.startswith("T4") for v in names):
            selected.append("T4")
        if any(v == "T5" or v.startswith("T5") for v in names):
            selected.append("T5")
        for group in selected:
            groups[group][side].append(i)
        # Retain a complete root-ID / type / side map for future skill adapters.
        labels.append([i, rid, row["cell_type"], row["hemibrain_type"], side])
    for group in ("LPLC2", "LC4", "LC11"):
        for side in ("left", "right"):
            if not groups[group][side]:
                raise ValueError("No identified " + group + " neurons on " + side)
    return {
        "version": 1, "neuron_count": n, "edge_count": edges,
        "source": {"url": ANNOTATION_URL, "commit": ANNOTATION_COMMIT,
                   "sha256": hashlib.sha256(annotation_bytes).hexdigest(),
                   "materialization": 783},
        "index_order": "Rows of data/neurons.csv.gz; matches scripts/build_connectome.py",
        "side_definition": "Soma side (intrinsic) or nerve-entry side (sensory); not a receptive-field map",
        "label_columns": ["index", "root_id", "cell_type", "hemibrain_type", "side"],
        "annotated_count": len(seen), "labels": labels, "groups": groups,
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--annotations", type=Path, help="Optional already downloaded pinned TSV")
    parser.add_argument("--output", type=Path, default=Path("data/drone-index.json"))
    args = parser.parse_args()
    if args.annotations:
        content = args.annotations.read_bytes()
    else:
        print("Downloading pinned FlyWire annotations…", flush=True)
        with urllib.request.urlopen(ANNOTATION_URL, timeout=120) as response:
            content = response.read()
    index = build(args.data_dir, content)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(index, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"neurons": index["neuron_count"], "annotated": index["annotated_count"],
                      "groups": {g: {s: len(a) for s, a in sides.items()} for g, sides in index["groups"].items()}}, indent=2))
    print("Wrote", args.output)

if __name__ == "__main__":
    main()
