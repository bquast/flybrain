# Direction: FlyBrain Gym

The app should become a gym that can load different experiments easily, with
drone/FPV flight as the first experiment. The gym interface is deferred.

Keep the shared connectome and its versioned dataset manifest independent of
experiment-specific sensing, readout, physics and rendering. `js/datasets.js`
and `data/dataset.json` are the first shared pieces, used by both current apps.

The later experiment interface should cover:

- A registry with experiment ID, name, entry point and required cell groups.
- Trial creation/reset with seed and settings, followed by step and observation.
- A stimulus encoder, neural readout, environment and renderer per experiment.
- Explicit teardown of workers, animation frames and graphics resources when
  switching experiments, avoiding multiple full connectomes in memory.
- Comparable result exports carrying experiment ID, dataset ID, model/readout
  version, seed, interventions, latency and outcome metrics.

Keep the existing `/experiments/drone/` URL usable when the gym launcher arrives.
The enclosure can become a second experiment without imposing its behavior or
Workday integration on the gym or other environments.

## Shared pieces now in use

Music Lab (`/experiments/music/`) is the second standalone lab. It reuses the
versioned dataset loader and `js/rate-model.js`, whose input and probe groups are
configurable. `experiments/lab.css` supplies a common light shell; enclosure,
drone and music pages link to one another. Full-page navigation currently tears
down each experiment before the next loads its connectome. A registry/launcher
can replace this navigation later without coupling the sensory adapters.
