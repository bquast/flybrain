#!/usr/bin/env python3
"""Build a static browser dataset from the official MaleCNS v1.0 release.

Requires numpy, pandas and pyarrow. Raw downloads stay outside the published
dataset. Keeps all superclass-annotated neurons and every edge between them.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import struct
import tempfile
import urllib.request

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.feather as feather

from build_connectome import (GROUPS, GROUP_NAME_TO_ID, REGION_NAME_TO_TYPE,
                              determine_group, region_from_group, write_meta)

DATASET = "male-cns-v1.0"
BASE = "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/"
FILES = {
    "annotations": "body-annotations-male-cns-v1.0-minconf-0.5.feather",
    "neurotransmitters": "body-neurotransmitters-male-cns-v1.0.feather",
    "connections": "connectome-weights-male-cns-v1.0-minconf-0.5.feather",
}
SOURCE_SHA256 = {
    "annotations": "2177e246113e4cfbf1e7772ec37c6da1955ff22e8063d0b1f833101f99a9a3b2",
    "neurotransmitters": "95c9289220663abeb3409f3ad9e5a7f8a53f8093f5139d15502cd08da8879621",
    "connections": "e35da783d1c686b2b58b3b87cd6a403ae43bfcfba8bff28e08ef752c1a56afc1",
}
PROBES = ("LPLC2", "LC4", "LC11", "GF", "descending", "photoreceptors", "T4", "T5", "vnc", "motor")


def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def json_bytes(value):
    return (json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n").encode()


def gzip_file(source, target):
    with source.open("rb") as src, target.open("wb") as dst:
        with gzip.GzipFile(filename="", fileobj=dst, mode="wb", mtime=0, compresslevel=6) as out:
            shutil.copyfileobj(src, out)


def side_of(row):
    # Sensory cells may have no soma in this volume. Never infer side from IDs.
    return {"L": "left", "R": "right"}.get(row.somaSide or row.rootSide, "center")


def display_group(row):
    """Compatibility groups for the original enclosure; not new cell types."""
    sc, typ, sub = row.superclass, row.type or "", row.subclass or ""
    side = {"left": "L", "right": "R"}.get(side_of(row))
    if sc == "vnc_motor":
        if side and sub in ("fl", "ml", "hl"):
            return "MN_LEG_" + side + {"fl": "1", "ml": "2", "hl": "3"}[sub]
        if side and sub == "wm":
            return "MN_WING_" + side
        if sub == "ad":
            return "MN_ABDOMEN"
        if sub == "nm":
            return "MN_HEAD"
        return "GENERIC_MOTOR"
    if sc == "cb_motor":
        return "MN_PROBOSCIS" if sub == "pm" else "MN_HEAD"
    if "descending" in sc:
        return "DN_STARTLE" if typ == "DNp01" else "GNG_DESC"
    if typ == "R1-R6":
        return "VIS_R1R6"
    if typ in ("R7", "R8", "R7p", "R7y", "R8p", "R8y"):
        return "VIS_R7R8"
    if typ.startswith(("LC", "LPLC")) and "visual" in sc:
        return "VIS_LC"
    if sc == "ol_intrinsic":
        return "VIS_ME"
    if sc.startswith("vnc"):
        return "GENERIC_SENSORY" if "sensory" in sc else "GENERIC_CENTRAL"
    flow = "afferent" if "sensory" in sc else "intrinsic"
    return determine_group(flow, sc, (row["class"] or "").lower(), sub.lower(), "central", side_of(row))


def build(raw_dir, output, manifest_path):
    sources = {}
    for key, filename in FILES.items():
        path = raw_dir / filename
        if not path.exists():
            print("Downloading " + filename, flush=True)
            temp = path.with_suffix(".part")
            urllib.request.urlretrieve(BASE + filename, temp)
            temp.replace(path)
        sources[key] = {"url": BASE + filename, "sha256": digest(path)}
        if sources[key]["sha256"] != SOURCE_SHA256[key]:
            raise ValueError("Source checksum changed: " + filename)

    annotations = feather.read_table(raw_dir / FILES["annotations"]).to_pandas()
    required = {"bodyId", "superclass", "type", "somaSide", "rootSide", "class", "subclass"}
    if not required.issubset(annotations.columns):
        raise ValueError("Unexpected MaleCNS annotation schema")
    neurons = annotations[annotations.superclass.notna()].sort_values("bodyId").copy()
    if neurons.bodyId.duplicated().any():
        raise ValueError("Duplicate MaleCNS body IDs")
    n = len(neurons)
    ids = pd.Index(neurons.bodyId)
    nt = feather.read_table(raw_dir / FILES["neurotransmitters"], columns=["body", "consensus_nt"]).to_pandas()
    if nt.body.duplicated().any():
        raise ValueError("Duplicate neurotransmitter annotation")
    nt = nt.set_index("body").reindex(ids).consensus_nt.fillna("unknown")
    # Preserve the prototype's sign convention for this dataset migration.
    # These are model assumptions: transmitter identity alone is not a receptor model.
    signs = np.where(nt.to_numpy() == "gaba", -1, 1).astype(np.float32)
    groups = {g: {s: [] for s in ("left", "right", "center")} for g in PROBES}
    labels, regions, display_ids = [], [], []
    for i, (_, row) in enumerate(neurons.iterrows()):
        typ, sc, side = row.type or "", row.superclass, side_of(row)
        names = set()
        for col in ("type", "flywireType", "hemibrainType", "mancType"):
            if row[col]:
                names.add(row[col])
        selected = [g for g in ("LPLC2", "LC4", "LC11") if g in names]
        if "DNp01" in names or "Giant Fiber" in names:
            selected.append("GF")
        if sc == "descending_neuron":
            selected.append("descending")
        if sc == "ol_sensory" and typ.startswith("R"):
            selected.append("photoreceptors")
        for g in ("T4", "T5"):
            if typ in (g, g + "a", g + "b", g + "c", g + "d"):
                selected.append(g)
        if sc.startswith("vnc_"):
            selected.append("vnc")
        if sc in ("cb_motor", "vnc_motor"):
            selected.append("motor")
        for g in selected:
            groups[g][side].append(i)
        labels.append([i, str(row.bodyId), typ, row.hemibrainType or "", side,
                       sc, row.subclass or "", str(nt.iloc[i]), row.somaSide or "", row.rootSide or ""])
        g = display_group(row)
        display_ids.append(GROUP_NAME_TO_ID[g])
        regions.append(REGION_NAME_TO_TYPE[region_from_group(g)])
    for g in ("LPLC2", "LC4", "LC11", "GF", "descending", "motor", "vnc"):
        for side in ("left", "right"):
            if not groups[g][side]:
                raise ValueError(f"Missing {g} {side} neurons")

    output.mkdir(parents=True, exist_ok=True)
    edge_count = synapses = all_edges = 0
    # Arrow record batches avoid materializing the full 1 GB fragment graph.
    edge_type = np.dtype([("pre", "<u4"), ("post", "<u4"), ("weight", "<f4")])
    with tempfile.TemporaryDirectory() as temporary:
        raw_binary = Path(temporary) / "connectome.bin"
        with raw_binary.open("wb") as stream, pa.memory_map(str(raw_dir / FILES["connections"])) as mapped:
            stream.write(struct.pack("<II", n, 0))
            reader = pa.ipc.open_file(mapped)
            if reader.schema.names != ["body_pre", "body_post", "weight"]:
                raise ValueError("Unexpected connection schema")
            for k in range(reader.num_record_batches):
                batch = reader.get_batch(k)
                a = ids.get_indexer(batch.column(0).to_numpy())
                b = ids.get_indexer(batch.column(1).to_numpy())
                w = batch.column(2).to_numpy()
                keep = (a >= 0) & (b >= 0)
                a, b, w = a[keep], b[keep], w[keep]
                if np.any(w <= 0) or np.any(w > 2**24):
                    raise ValueError("Invalid or inexact float32 synapse count")
                record = np.empty(len(a), dtype=edge_type)
                record["pre"], record["post"], record["weight"] = a, b, w * signs[a]
                stream.write(record.tobytes())
                edge_count += len(a)
                synapses += int(w.sum())
                all_edges += len(batch)
            metadata = np.empty(n, dtype=[("region", "u1"), ("group", "<u2")])
            metadata["region"], metadata["group"] = regions, display_ids
            stream.write(metadata.tobytes())
            stream.seek(0)
            stream.write(struct.pack("<II", n, edge_count))
        if raw_binary.stat().st_size != 8 + 12 * edge_count + 3 * n:
            raise ValueError("Binary length mismatch")
        # Canonical source/target ordering also compresses much better than the
        # release table's global weight ordering, without dropping any edges.
        records = np.memmap(raw_binary, dtype=edge_type, mode="r+", offset=8, shape=(edge_count,))
        order = np.lexsort((records["post"], records["pre"]))
        records[:] = records[order]
        records.flush()
        del records, order
        print(f"Packing {n:,} neurons, {edge_count:,} edges ({synapses:,} synapses)", flush=True)
        gzip_file(raw_binary, output / "connectome.bin.gz")

    index = {
        "version": 2, "dataset": DATASET, "neuron_count": n, "edge_count": edge_count,
        "annotated_count": n, "source": sources,
        "index_order": "Ascending MaleCNS bodyId, stored as decimal strings; not FlyWire root IDs",
        "side_definition": "somaSide, falling back to rootSide; unknown/midline becomes center; not receptive-field laterality",
        "label_columns": ["index", "body_id", "cell_type", "hemibrain_type", "side", "superclass", "subclass", "consensus_nt", "soma_side", "root_side"],
        "labels": labels, "groups": groups,
    }
    (output / "index.json.gz").write_bytes(gzip.compress(json_bytes(index), compresslevel=6, mtime=0))
    write_meta(output / "neuron_meta.json", n, edge_count, regions, display_ids)
    meta = json.loads((output / "neuron_meta.json").read_text())
    meta.update(dataset=DATASET, label="MaleCNS v1.0", has_vnc=True)
    (output / "neuron_meta.json").write_bytes(json_bytes(meta))
    artifacts = {}
    for key, filename in {"connectome": "connectome.bin.gz", "index": "index.json.gz", "meta": "neuron_meta.json"}.items():
        p = output / filename
        artifacts[key] = {"path": str(p.relative_to(manifest_path.parent)), "bytes": p.stat().st_size, "sha256": digest(p)}
    manifest = {
        "schema_version": 1, "id": DATASET, "label": "MaleCNS v1.0", "sex": "male",
        "has_vnc": True, "neuron_count": n, "edge_count": edge_count, "synapse_count": synapses,
        "selection": "All 166700 rows with a non-null superclass in the pinned v1.0 annotation file. Every connection between these neurons is retained, including weight-1 edges and self-edges. Unclassified segments/fragments and glia are excluded.",
        "excluded_edge_rows": all_edges - edge_count,
        "nt_sign_policy": "consensus_nt: GABA=-1; all other/unknown transmitters=+1 (prototype convention, not fitted receptor physiology)",
        "nt_counts": {str(k): int(v) for k, v in nt.value_counts().items()},
        "sources": sources, "files": artifacts,
        "attribution": "FlyEM / HHMI Janelia, University of Cambridge, MRC LMB, and Google Research; Berg et al., Cell (2026)",
        "source_url": "https://male-cns.janelia.org/download/", "license": "CC-BY-4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"neurons": n, "edges": edge_count, "files": artifacts,
                      "probes": {g: {s: len(v) for s, v in sides.items()} for g, sides in groups.items()}}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=Path(".cache/malecns-v1.0"))
    parser.add_argument("--output", type=Path, default=Path("data/male-cns-v1.0"))
    parser.add_argument("--manifest", type=Path, default=Path("data/dataset.json"))
    args = parser.parse_args()
    args.raw_dir.mkdir(parents=True, exist_ok=True)
    build(args.raw_dir, args.output, args.manifest)
