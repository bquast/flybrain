# Music Lab

Open `https://bquast.github.io/flybrain/experiments/music/`, wait for the neural
model, then press **Play Bach**. Everything runs locally in the browser, on the
same GitHub Pages deployment as the enclosure and Drone Lab.

- Built-in sound: a local synthesis of the opening eight bars of J. S. Bach's
  Prelude in C major, BWV 846, at 72 BPM. The public-domain composition is
  rendered by our own simple plucked-keyboard synthesizer; there is no downloaded
  recording. Pitches/rhythm were checked against
  [this MusicXML score](https://github.com/evanlenz/bwv-846-prelude/blob/master/input/score.xml).
- **220 Hz pulses** provide a regular on/off control stimulus.
- **Your audio file** accepts browser-decodable audio up to two minutes / 30 MB.
  It is decoded in memory and never uploaded.
- **Speaker volume** changes only what you hear. **Stimulus strength** scales
  the neural input. **Direction** attenuates the opposite side. **Silence input**
  sets external neural drive to zero while playback and propagation continue.
- **Pause** preserves the trial; **Reset** clears neural state, audio position and
  recorded samples. Changing tracks resets the trial. Hiding the tab pauses it.
- **Export CSV** contains dataset/model/encoder IDs, both clocks, stimulus
  settings, filtered RMS, applied drives, active-cell counts and bilateral rates.

## What is modelled

The current manifest selects [MaleCNS v1.0](https://male-cns.janelia.org/).
`core.js` selects only index rows whose `subclass` is `auditory`, whose cell type
starts with `JO-A` or `JO-B`, and whose anatomical side is `left` or `right`.
Some JO-B cells are labelled `wind_gravity`; those are deliberately excluded.
No cell IDs are guessed, and absent auditory annotations produce an error.

Johnston's organ contains neurons responsive to antennal vibration; separating
sound-sensitive and wind-sensitive populations is supported by
[Yorozu et al., Nature (2009)](https://doi.org/10.1038/nature07843).
This experiment is an engineering demonstration, not a physiological recreation
of that study or a test of musical preference.

The sound is downmixed for analysis and filtered by second-order high-pass and
low-pass filters at 60 and 1,000 Hz. RMS amplitude from a 2,048-sample analyser
window is multiplied by six and the stimulus gain, then clamped to [0,1]. Both
JO families receive that same amplitude. Anatomical side labels route the drive;
the direction slider is an artificial left/right gain, not acoustic localization.
There is no calibrated sound-pressure/particle-velocity conversion, antenna
mechanics, phase locking, frequency tuning by subtype, or perception model.

`js/rate-model.js` is shared with Drone Lab. It normalizes incoming absolute
connection weights per neuron and uses bounded rates, recurrent gain 0.9 and a
25 ms time constant. Dataset transmitter signs are prototype conventions, not
fitted receptor physiology. Only JO sensory groups receive external drive.
First-hop targets (all directly connected non-input cells), descending neurons
and motor neurons are **observation probes**, not additional inputs.

Charts show the mean of left and right group means. The bars and traces apply
`log(1 + 999 * rate) / log(1000)` to make small downstream rates visible; numeric
readouts and CSV remain untransformed. Centre/unknown-side neurons participate
in graph dynamics but are omitted from bilateral visualizations. The fly drawing
reacts to the input signal, not motor output or inferred enjoyment.

## Timing and limits

Audio runs on the Web Audio clock in real time. At most one neural request is
in flight, sampled at most 20 times per second. Each request advances **20 ms of
model time**, in two 10 ms integration steps. Slower devices sample the current
audio less often: missed sound is not replayed and no work queue grows. This keeps
the interface responsive but makes it a sampled demonstration, **not a time-faithful
simulation of continuous hearing**. Compare the audio and model clocks in CSV;
response history is indexed by completed neural sample, not wall time.

There is no baseline spontaneous activity. A trial starting with silenced input
remains at zero. All experimental gain/direction/silence changes are recorded
per sample. Responses depend on sampling speed as well as audio content.

## Focused checks

`node --test experiments/music/tests/core.test.cjs experiments/drone/tests/core.test.cjs`

The tests check auditory selection, routing/silence, bounded input, actual
propagation through a small graph, reset, and compatibility with Drone Lab.
