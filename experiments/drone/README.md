# FlyBrain Drone Lab

First prototype: seeded forest flight, FPV/chase cameras, bilateral visual samples, identified LPLC2/LC4 stimulation, connectome readout, direct vision baseline, circuit silencing, 0–200 ms added delay and CSV export. Expanding-object and uniform-dimming benches hold the drone still.

## Run

```sh
python3 scripts/build_drone_index.py
python3 -m http.server 8000
```

Open http://localhost:8000/experiments/drone/. No npm install is needed to run the site. The annotation build downloads a pinned public FlyWire table; use --annotations PATH to reuse a local copy. The vision baseline can run without that index.

## GitHub Pages

In Settings → Pages, choose **GitHub Actions**. The Drone Lab workflow builds, checks and deploys pushes to **master**. After enabling Pages, rerun the workflow if needed. The project URL after deployment is https://bquast.github.io/flybrain/experiments/drone/ . The upstream custom domain is not used.

## Methods and limits

- Each eye renders 32 × 25 grayscale perspective samples. The hexagonal display is an approximation, not reconstructed ommatidial optics.
- Gain/offset-normalized images supply dark connected components. Positive angular-area growth becomes engineered looming features injected into identified LPLC2/LC4 cells. This is not a complete visual circuit model.
- The annotation index retains root IDs as strings and maps them to the original neurons.csv.gz order. It uses FlyWire v783 annotations pinned to commit 8587524c1748ce5ef2080822a2fc890fc03bf597. Soma-side grouping is a routing assumption, not a measured receptive-field map.
- A bounded rate model uses the full graph. Incoming absolute weights are normalized, recurrent gain is 0.9, time constant 25 ms, and integration steps are at most 10 ms. Edge signs are inherited from FlyBrain; these dynamics are not fitted physiology.
- The hand-tuned, untrained readout uses bilateral LPLC2/LC4 rates for steering and speed. Those cells are directly stimulated, so successful flight alone does not establish a benefit from recurrent wiring.
- LC11, GF/DNp01 and descending cells are observation probes. The VNC is absent. Conventional attitude and altitude control handles simplified drone physics; obstacle coordinates enter rendering/collision detection only.
- Each sensory frame advances 1/30 second and four physics steps. Worker calls are sequential. Slow hardware lowers simulation speed, displayed in the interface. Added delay is in simulation time; compute and round-trip wall times are separately logged. Network jitter/loss is not modeled.
- Changing settings resets the seeded trial. Hiding the tab pauses it. CSV logging is capped at 18,000 frames (10 minutes).

## Checks

```sh
node --test experiments/drone/tests/core.test.cjs
python3 scripts/build_drone_index.py
node --test experiments/drone/tests/real-data.test.cjs
```

CI also checks the actual browser at a /flybrain/ subpath, cell silencing, flight, pause, CSV export and mobile layout, and saves screenshot evidence.

## Attribution

FlyBrain by snedea, MIT (../../license.md). Data and citations:

- https://doi.org/10.1038/s41586-024-07558-y
- https://github.com/flyconnectome/flywire_annotations
- https://pmc.ncbi.nlm.nih.gov/articles/PMC5340600/
- Inspiration: https://x.com/c10ned/status/2099183080065941919 (independent implementation; the author's source was unavailable).
