# Audio: current state, AE parity, and what to build

> **Status 2026-09-12 — P0–P4 implemented.** Everything in §6 shipped except the
> three items listed under "Deliberately not shipped" at the end of this file.
> The §5 gap descriptions are kept as written, as the record of what was wrong;
> §8 below says what each one became.

Written 2026-09-12. Method: read of `src/core/audio/`, `src/layout/`, `src/core/effects/`,
`src/core/timeline/propertyTree.ts` on `dev`, against Adobe's own AE 26.3 help pages
(audio effects, previewing, generate effects, keyboard-shortcuts reference), read
2026-09-12. Nothing here was verified by running the app; the code claims are
file-level and cited.

---

## 1. The headline

**The audio *engine* is not the problem — it is close to AE-complete and beats AE on
several verbs. The problem is that almost none of it has a front door.**

Roughly 250 KB of audio core exists (`src/core/audio/`, 20 modules + tests). What the
user can reach is: a speaker glyph on a clip bar, an "Audio" accordion in the
inspector, two read-only VU meters in two different panels, and five entries under
Animation ▸ Audio. There is no Audio panel, no audio-only preview, no stereo level,
no fades, and the one inspector control that edits an audio layer's level is a
legacy percent slider with no stopwatch on it.

So the ask is mostly **surface work, not engine work** — with one genuine engine gap
(the 2026 AE audio effects) and one high-visibility motion-design gap (path-based
audio visualizers).

---

## 2. What we already have

### Engine — strong
| Thing | Where | Note |
|---|---|---|
| Multi-voice playback, per-**clip** voices, master bus, stereo analysers | `AudioEngine.ts` | A split bar = two voices of one asset |
| **Level as dB, keyframeable** (`audioLevelDb`, −60…+12) | `audioParams.ts` | Sampled per frame into a 50 Hz gain ramp |
| **Preview / export use the same ramp builder** | `audioParams.ts` → `AudioEngine` + `audioMixdown` | This is the seam that stops "sounds right, exports wrong" |
| Varispeed (`playbackRate`), layer-time reverse, time-remap piecewise segments | `audioRetimeSegments.ts`, `audioScene.ts` | Incl. nested-comp audio (2026-09-12) |
| Offline mixdown wired into export | `audioMixdown.ts` → `exportManager.ts`, `videoSink.ts`, `webmMuxer.ts` | |
| 10 audio effects with keyframeable params | `audioEffects.ts` | See §3 — exactly AE's *classic* set |
| Convert Audio to Keyframes (both/L/R, smoothing, gain) | `audioKeyframes.ts` | |
| Waveform decode + peak cache | `waveform.ts`, `audioWaveformGen.ts` | |

### Verbs where we already beat AE
These are shipped and should **not** be rebuilt — they should be made *findable*.

- **Remove Silence** — detect dead air, split picture and sound on the same
  boundaries, close the gaps, one undo (`silenceRemoval.ts`).
- **Duck Under Voice** — real ducking written as `audioLevelDb` keyframes, with
  Re-duck (`ducking.ts`).
- **Beat grid** — beat detection, Markers on Beats, Animate In on Beats
  (`beatGrid.ts`, `beatCommands.ts`).
- **Audio driver** — drive *any* property from a frequency band (low/mid/high/custom)
  (`audioDriver.ts`). AE needs Trapcode Sound Keys for this.
- **Transcript** — transcribe, click-a-word-to-seek, delete a word range from every
  layer at once (`src/layout/Transcript/`).
- **AI voiceover** — `generateSpeechBytes` drops a `voiceover.*` asset into the project.

---

## 3. AE 26.3 audio effects vs ours

AE shipped **four new audio effects** in this cycle. We have none of them.

| AE effect | Us | Gap |
|---|---|---|
| Backwards | ✅ | AE also has **Swap Channels** |
| Bass & Treble | ✅ | parity |
| **Compressor** | ❌ | Threshold / Ratio / Knee / Attack / Release / Auto Release / Makeup Gain / Output Limit |
| **De-esser** (AE beta) | ❌ | Threshold / Frequency / Bandwidth / Attack / Release / Sibilance-Only monitor |
| Delay | ✅ | AE splits Delay Amount from Feedback, and Dry Out / Wet Out separately |
| **Distortion** | ❌ | 6 types (Soft/Hard Clip, Saturation 1–2, Tube, Fuzz) + Drive/Gain/Mix/Volume + **bitcrusher** (Resolution, Downsample) |
| Flange & Chorus | ⚠️ | We have one voice. AE has **Voices, Voice Phase Change, Invert Phase, Stereo Voices** — the thing that makes it a *chorus* |
| **Gate** | ❌ | Threshold / Attack / Hold / Release |
| High-Low Pass | ✅ | parity |
| Modulator | ⚠️ | AE separates FM depth from **Amplitude Modulation**; ours conflates them |
| Parametric EQ | ⚠️ | AE has **3 bands + a live frequency-response graph** (band 1 red, 2 green, 3 blue). Ours is one band, no graph |
| Reverb | ⚠️ | AE has **Diffusion** and **Brightness**; we have decay/pre-delay/mix |
| Stereo Mixer | ⚠️ | AE has **Invert Phase** |
| Tone | ⚠️ | AE does **up to 5 simultaneous tones** (chords) and a **White Noise** waveform; we do one tone, four shapes |

Note the build cost: every new effect needs **both** a live Web Audio path and an
offline twin in `audioMixdown`, exactly like the GPU/CPU twin rule for visual
effects. `DynamicsCompressorNode` gets Compressor ~80 % of the way; Gate, De-esser
and Distortion want an `AudioWorklet`.

---

## 4. The visualizer gap (highest visible payoff)

We have `audio-spectrum` and `audio-waveform` as real drawing effects
(`canvas2dEffects.ts`, fed by `audioSpectrum.ts`). They are the shallow versions.

AE's have, and ours do not:

- **Path** — draw the spectrum/waveform **along a mask path**.
- **Use Polar Path** — the radial graph. *This is the circular-spectrum-around-a-logo
  look, which is the single most-requested audio visual in motion design.*
- Start Point / End Point when Path is None.
- **Audio Duration** and **Audio Offset** (ms) — the analysis window.
- Softness, Hue Interpolation, Dynamic Hue Phase, Color Symmetry.
- Side Options (A / B / both), Display Options (Digital / Analog Lines / Analog Dots).
- Spectrum: Blend Overlapping Colors. Waveform: Displayed Samples, Mono / L / R.

We already have mask-path machinery in the app, so Path and Polar Path are reachable.

---

## 5. The UI/UX gaps — this is the real answer to the question

### 5.1 There is no Audio panel
AE has a dockable Audio panel (**Ctrl+4**) with a tall VU meter, **clipping
indicators**, **separate L and R level sliders that write the selected layer's Audio
Levels**, and an Options menu with **Units (dB / %)** and **Slider Minimum**.

We have *three* partial substitutes and no whole one:
- `InfoAudioPanel.tsx` — L/R meter bars, a −48…0…+6 scale, and a **master** volume
  slider. Read-only w.r.t. the selected layer.
- `PreviewPanel.tsx` — a second meter and a second master mute, duplicating the above.
- `VUMeter.tsx` in the status bar — a third meter.

None of them edits a layer's level. There is no clip indicator and no peak hold.

### 5.2 An audio layer's level cannot be keyframed from the inspector
This is an inconsistency, not just polish:

- `propertyMeta.ts:393` defines `audioLevelDb` — "Audio Levels", dB, −60…+12.
- `propertyTree.ts:497` gives **audio *and* video** layers an Audio Levels row.
- `MediaSection.tsx:222` (video layers) renders it with an `AnimToggle` stopwatch. ✅
- `AudioControls.tsx:185` (audio layers) renders a **0–200 % `Slider` writing the
  legacy `__level`, with no stopwatch**. ❌

So the *audio* layer is the one layer type whose level you cannot key from the
inspector. You have to know to go find the row in the timeline.

### 5.3 Level is mono; AE's is stereo, and there is no pan and no fades
`levelDb` is a scalar. AE's Audio Levels is a two-value **(L, R)** property, which is
what makes the Audio panel's two faders meaningful. We also have:
- no per-layer **Pan** (only via the Stereo Mixer *effect*),
- no **fade handles** on the clip bar (the one gesture every editor reaches for first).

### 5.4 Missing AE shortcuts and transport behaviours
Verified against Adobe's keyboard-shortcuts reference:

| AE | Us |
|---|---|
| `L` → show only Audio Levels | ✅ `App.tsx:421` (`l: ['audio']`) |
| `LL` → show only **audio waveform** | ❌ waveform is on the clip bar, never under the property row |
| `.` (numpad) → **preview only audio** from current time | ❌ no audio-only transport |
| `Alt`+`.` (numpad) → preview only audio over the work area | ❌ |
| `*` (numpad) → **drop a marker at the playhead, works during audio-only preview** | ⚠️ `timeline.addMarker` exists but is not bound to a tap key — this is the "tap the beat" workflow |
| `Ctrl`+drag CTI → scrub audio | ✅ `scrubAudioAt` (`transportController.ts:384`), menu toggle at `menuModel.ts:267` |
| `Ctrl`+`4` → Audio panel | ❌ no such panel |
| Preview panel per-shortcut **Include Video / Include Audio / Mute Audio** | ❌ only a global master mute |

### 5.5 No audio switch column in the timeline
`TrackHeaderColumn.tsx` has visible / solo / lock / shy. AE's **A/V Features** column
carries a **speaker switch per layer** next to the eye. Ours lives only on the clip
bar (`Lanes.tsx:127`), so a layer whose bar is scrolled out of view has no reachable
audio switch, and the two halves of "is this layer on" sit in different columns.

*(Corrected: AE has a single Solo switch covering picture **and** sound — there is no
separate audio solo. `voicesOf` in `audioScene.ts` already silences non-soloed voices
off `node.solo`, so that behaviour is already right. AE also offers Alt-click a solo
switch to clear every other solo, and `Ctrl+Alt+Shift+V` to toggle the eye — both of
which we lack.)*

### 5.6 No audio hardware or project audio settings
AE: **Preferences ▸ Audio Hardware** (device class, default output mapping, settings,
latency), **Audio Output Mapping**, and **Project Settings ▸ audio sample rate**.
We have none — no output-device picker (`setSinkId` appears nowhere), no latency
control, no project sample rate.

### 5.7 Discoverability
The strong verbs are scattered: Remove Silence and Duck Under Voice are buttons
*inside* the audio-layer inspector accordion **and** menu entries; Markers on Beats
and Animate In on Beats are only in Animation ▸ Audio; Convert Audio to Keyframes is
a popover inside `AudioControls`. Nothing tells a new user this editor can do any of it.

---

## 6. Recommended plan

Ordered by payoff-per-unit-work. P0 is mostly small and fixes things that currently
read as bugs.

### P0 — make what exists reachable and consistent
1. **`AudioControls` level → `audioLevelDb` + `AnimToggle`**, mirroring
   `MediaSection.tsx:222`. Keep `percentToDb` so existing projects don't jump.
   *This is the single highest-value change in the document.*
2. **Audio switch column** in `TrackHeaderColumn` (speaker), matching AE's A/V
   Features column, plus Alt-click-solo to clear other solos.
3. **`LL`** → reveal the waveform under the Audio Levels row (peaks already cached).
4. **Audio-only preview**: `.` and `Alt`+`.`; add Include Video / Include Audio /
   Mute Audio to the Preview panel's per-shortcut behaviours.
5. **Tap markers**: bind `*` to `timeline.addMarker` and make it fire during playback.
6. **Fade handles** on audio clip bars, writing `audioLevelDb` keyframes.

### P1 — a real Audio panel
7. New dockable `audio` panel (`PANEL_COMPONENTS`), `Ctrl+4`: tall VU with **clip
   indicator + peak hold**, **L/R faders bound to the selected layer's Audio Levels**,
   Units (dB / %) toggle, Slider Minimum, master fader + mute. Make `InfoAudioPanel`,
   `PreviewPanel` and the status-bar `VUMeter` read the *same* store rather than each
   polling `audioEngine.getLevels()` on its own rAF.
8. **Decide the stereo schema now**, before more code depends on the scalar: either
   `audioLevelDb` becomes `[L, R]`, or add a separate keyframeable `audioPan`. Doing
   this after P1 ships means migrating documents twice.

### P2 — close the AE 26.3 effect gap
9. **Compressor** (`DynamicsCompressorNode` + makeup/limit), **Gate**, **Distortion**
   (6 curves + bitcrusher), **De-esser**. Each needs its offline twin in `audioMixdown`.
10. Deepen the existing ones: Parametric EQ → **3 bands + response graph**; Tone →
    **5 tones + white noise**; Flange & Chorus → **voices/phase/stereo**; Reverb →
    diffusion + brightness; Modulator → separate AM; Backwards → swap channels;
    Stereo Mixer → invert phase.

### P3 — visualizer parity (the motion-design win)
11. **Path + Use Polar Path** on Audio Spectrum and Audio Waveform, then Audio
    Duration / Offset, Softness, hue interpolation, Side Options, channel selection,
    Displayed Samples.

### P4 — plumbing
12. Preferences ▸ **Audio Hardware**: output device via `setSinkId`, latency hint.
    Project Settings ▸ **sample rate**.
13. Surface the strong verbs in one place — an Audio section in the Assets/Library
    rail, or a "Sound" group in the Properties sub-tabs — so Remove Silence, Ducking,
    Beats and Convert-to-Keyframes are discoverable without menu archaeology.

---

## 7. What to tell `docs/AE_COMPARISON.md`

The current Audio row ("Multi-voice engine + time-remap varispeed; silence removal and
ducking … **Premation wins** on the edit verbs") is true but hides the gap. It should
split into **Audio engine** (parity+, we win on verbs), **Audio effects** (behind by
four effects as of AE 26.3), **Audio UI** (behind: no Audio panel, no stereo levels,
no audio-only preview), and **Audio visualizers** (behind: no path/polar).

---

## 8. What shipped (2026-09-12)

Verified three ways: unit tests (12,445 passing), a `build:local` production
build, and driving the running app — every effect built against a real
`OfflineAudioContext` and rendered, with the DSP measured rather than assumed.

### P0 — reachability and consistency
| Gap (§5) | What it is now |
|---|---|
| 5.2 Audio level not keyframeable from the inspector | `AudioControls` renders `audioLevelDb` through the same `KeyframeRow` a video layer uses. `percentToDb` keeps old projects at their gain |
| 5.5 No speaker in the layer switches | `TrackHeaderColumn` has one, between the eye and solo, for layers that make a sound; `audioLayerSwitches.ts` is the single writer the clip bar, the header and the pop-out all share. Alt-click solo clears every other solo |
| `L` did nothing | **It was dead** — the reveal filter matches a row's `prop`, and `l: ['audio']` named the group key. Now `[audioLevelDb, audioPan, audioLevel]` |
| 5.4 No `LL` | A Waveform pseudo-row under the Audio group (`AUDIO_WAVEFORM_ROW`), drawn per clip by `WaveformLane` on the timeline's own time axis |
| 5.4 No audio-only preview | `Numpad .` and `Alt+Numpad .`, plus Include Video / Include Audio (`previewBehaviorStore`). The render loop returns before any work while the picture is off. `chordKeyFromEvent` learned to tell the numpad apart (`Numpad.` / `Numpad*`) |
| 5.4 No tap markers | `Numpad *` → `timeline.addMarker`, bound globally so it works mid-playback — the point of the gesture |
| 5.3 No fades | `audioFades.ts`: Fade In / Fade Out as ordinary level keyframes, merged around existing ones so a duck survives. Menu, inspector and Audio panel |

### P1 — the Audio panel
A dockable `audio` panel (**Ctrl+4**) with a tall VU, **clip indicators and peak
hold**, and **two faders that edit the selected layer**. Units (dB / %) and
Slider Minimum, as AE's Options menu has.

**The stereo decision (§5.3):** `audioLevelDb` stays scalar and a keyframeable
`audioPan` joins it, rather than making the level a two-component property. Both
halves then keyframe, graph-edit and ride the existing ramp builder that keeps
preview and export identical; a two-component property would have needed its own
sampling path and the graph editor could not have drawn it. The two fader
positions are derived in `faderMath.ts`, which normalises the equal-power law so
a centred fader reads the layer's own level instead of −3 dB below it.

A centred layer builds **no panner node at all**, so a project that never touched
pan keeps exactly the graph it had — verified by rendering.

### P2 — the AE 26.3 effects
**Compressor**, **Distortion** (6 curves + bitcrusher), **De-esser** shipped as
real chain effects, all from native nodes, with offline twins. Measured on a
rendered test signal: the compressor takes a 1.29 peak to 0.34; the de-esser
drops the sibilance peak while leaving the tone's RMS alone.

Deepened: Parametric EQ → **3 bands**; Tone → **5 tones + White Noise**; Flange &
Chorus → **voices, phase, stereo voices, invert phase**; Reverb → **diffusion +
brightness** (both shape the IR); Modulator → **separate FM depth**; Backwards →
**swap channels**; Stereo Mixer → **invert phase**. A `flags` mechanism carries
the booleans so `AudioEffect` does not grow a field per effect. Every new control
is inert at its default — pinned by tests, because that is not audible.

**Gate** is a baked verb (`audioGate.ts` + `GateDialog`), not a chain effect —
see the omissions below.

### P3 — the visualizers
`audioVizLayout.ts` gives both Audio Spectrum and Audio Waveform **Use Polar
Path**, **mask Path** (through the existing `pathMaskId` → `pathPoints` seam),
Start/End Point, Side Options, Softness, Hue Interpolation, and Audio Duration /
Offset; the Waveform also gets Displayed Samples and Mono/L/R. The ring-around-a-
logo look is now reachable.

**And a dead effect was found:** `applyAudioWaveform` read a `samples` param
documented as snapshot-resolved that **nothing ever wrote**, so the Audio
Waveform effect drew nothing, ever. `resolveAudioWaveformSamples` now fills it.

### P4 — plumbing
Preferences ▸ **Audio**: output device (`setSinkId`), latency, and the device's
reported sample rate. Every failure path — no `mediaDevices`, refused
permission, unplugged device, a platform without `setSinkId` — keeps playing
rather than throwing or falling silent.

---

## 9. Deliberately not shipped, and why

These are the three places where AE has a control and we do not. Each is absent
rather than faked, because a control that does not do what its label says is
worse than a missing one.

1. **Compressor ▸ Auto Release.** AE's is program-dependent — the release time
   follows the material. Web Audio's compressor exposes no hook for that, and a
   control labelled Auto Release that quietly picked a fixed number would leave
   the user believing the release was being handled.
2. **Distortion ▸ Downsample.** Re-sampling needs state between blocks, which
   means an `AudioWorklet`. A low-pass standing in for it would sound *duller*
   where the effect is meant to sound *crunchier* — the opposite character.
3. **Gate as a chain effect.** A compressor only acts above its threshold; a
   gate acts below, and nothing native expands. The real-time answer is a
   worklet, which would then have to be reimplemented against the
   `OfflineAudioContext` the export uses and the two proved to agree — the
   argument `ducking.ts` sets out at length. So Gate bakes to level keyframes
   instead, which also means you can see where it closed and drag a point that
   closed too early.

The first two are the only reason to revisit the no-`AudioWorklet` stance; both
are small, and neither is worth the preview/export divergence risk on its own.

---

## 10. The hand-walkthrough (2026-09-12), and the three bugs it caught

Tests and rendered-DSP measurements had all passed. Driving the app with a real
6-second clip — four spoken-word bursts over a quiet bed — found three defects
anyway. Each is worth recording, because none of them could have been caught by
the tests as they were written.

1. **The Audio panel's faders showed the static level, not the playhead value.**
   Mid-fade the inspector's Level row read −60 dB while the fader sat at 0. Both
   halves were individually correct; only using them together showed the
   disagreement. `readTarget` now samples the track on the layer's own keyframe
   axis.

2. **The noise gate's Threshold did almost nothing across 74 dB of travel.**
   `analyseAudioEnvelope` returns a 0..1 position on a −60…0 dB scale, not a
   linear amplitude. `audioGate.ts` had written its own `envToDb` using
   `20·log10`, which crushed a 21 dB range into 3 dB. **The unit tests passed
   because the fixture made the same mistake** — it built envelopes with
   `10 ** (db/20)`. Both now go through `ducking.ts`'s `envToDb`/`dbToEnv`,
   which were right all along.

3. **The gate analysed the whole comp, not the layer.** A 6 s clip in a 10 s
   comp had its four dead seconds counted as "closed" — which is what the
   constant "40% closed" readout actually was — and keyframes were written past
   the end of the bar. `computeGateEnvelope` now intersects the driver range
   with the layer's audible span.

After the fixes, the gate opens on [0.5–1.2], [1.8–2.6], [3.2–4.0], [4.6–5.6]
against words at [0.5–1.2], [1.8–2.6], [3.2–4.0], [4.6–5.5] — the 0.1 s overhang
is the 60 ms hold, as intended.

### What the walkthrough confirmed working
Import → decode → waveform on the clip bar (its four loud spans land at 8–20 %,
30–43 %, 53–67 %, 77–92 % of the bar, matching the file); speaker switch writes
and round-trips; **the Level stopwatch on an audio layer** creates an
`audioLevelDb` track migrated from the legacy percent; Fade In/Out write a clean
−60 → 0 → 0 → −60 envelope; `L` shows Audio Levels + Pan and `LL` shows Waveform
only; the Audio panel's faders track the fade curve frame by frame and a drag to
−8 dB on the left round-trips exactly through level + pan; the gate dialog
previews and applies; audio-only preview switches the picture off and **restores
it when the transport stops**; and both visualizers resolve real data — including
the Audio Waveform effect, which had never drawn anything at all.
