# Connectome datasets

Both the enclosure and Drone Lab load `data/dataset.json`. This manifest selects
**MaleCNS v1.0**, with versioned files under `data/male-cns-v1.0/`. Dataset loading
is shared in `js/datasets.js`; drone stimuli, dynamics and readout remain in the
experiment. All runtime files are committed and work with Pages publishing from
`master` / root. No API account, server, or download-time Python job is required.

## What is included

The pinned release's 166,700 rows with a non-null `superclass` are retained. This
includes the central brain, optic lobes and VNC. The publication describes
166,691 neurons; the browser reports the actual count in this annotation export,
which differs by nine, rather than forcing a match to the paper's count.

Every connection between retained neurons is included: **25,582,938 directed
neuron-pair edges**, representing **124,177,617 synapses**, without a minimum
edge-weight cutoff. Self-edges are retained. Unclassified segments/fragments and
glia are excluded. The official full segment graph has many fragment edges;
the manifest records their exclusion count.

Indices are sorted by MaleCNS `bodyId`. These IDs are stored as strings and are
not interchangeable with FlyWire root IDs. The compressed annotation index keeps
cell type, superclass, subclass, neurotransmitter, original soma/nerve side, and
the resulting left/right/center group. Side uses `somaSide`, then `rootSide` if
the soma side is absent; unknown/midline cells stay in `center`. This is not a
retinotopic or visual receptive-field reconstruction.

The sign convention remains the prototype's: GABA negative; other and unknown
transmitters positive, using the release's `consensus_nt` field. This is an
explicit simulation assumption, including for glutamate and histamine. A realistic
model would need receptor-specific signs, neuromodulation, and fitted dynamics.
The graph migration does not establish biological fidelity or learned flight.

The enclosure retains its simplified behavior model and compatibility groups.
Motor groups use MaleCNS motor subclasses (fore/mid/hind leg, wing, neck,
abdomen and proboscis). Unassigned VNC interneurons remain generic central cells;
they are not all labeled CPGs. The old synthesized VNC layer is disabled when
the selected dataset includes a VNC.

The full graph downloads about **96 MB** including annotations; its in-memory
representation is larger. Slow machines run fewer simulation seconds per wall
second. Drone Lab displays this ratio and logs measured neural compute time.

## Rebuild

```sh
python -m pip install numpy==2.3.5 pandas==2.2.3 pyarrow==25.0.1
python scripts/build_malecns.py
node --test experiments/drone/tests/core.test.cjs experiments/drone/tests/real-data.test.cjs
```

The optional builder downloads about 1.1 GB of Feather tables to `.cache/`,
checks pinned SHA-256 hashes, processes connectivity in Arrow batches, and
writes deterministic gzip files. The published manifest records input and
output hashes, dimensions, sign policy and attribution. The drone loader checks
artifact hashes and rejects mismatched data instead of silently using FlyWire.

`scripts/build_connectome.py`, `scripts/build_drone_index.py`, and the original
FlyWire files remain available for reproducing the upstream baseline. They do
not determine the selected dataset and must not be paired with MaleCNS indices.

## Attribution and license

Derived from **MaleCNS v1.0**, by FlyEM / HHMI Janelia, the University of Cambridge,
MRC Laboratory of Molecular Biology, and Google Research. See Berg et al.,
*Sexual dimorphism in the complete connectome of the Drosophila male central
nervous system*, Cell (2026).

- [Dataset, documentation and download links](https://male-cns.janelia.org/download/)
- [Release notes](https://male-cns.janelia.org/release/)
- [CC BY 4.0 data license](https://creativecommons.org/licenses/by/4.0/)

Changes from the source data: selection of annotated neurons, ID reindexing,
simulation sign assignment, compatibility grouping and binary compression.
The application code retains its MIT license; the derived dataset is CC BY 4.0.
