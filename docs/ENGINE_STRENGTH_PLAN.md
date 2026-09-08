# Engine Strength Plan — effects, 2D/3D motion, video editing

> Written 2026-09-08 from (a) internet research on After Effects 26.0–26.3, the
> plugins working motion designers actually keep installed, and the two
> credible alternatives (Cavalry, Fusion 21); (b) a code-level audit of this
> repository, with the tracker/SAM/path-effects work of 2026-09-07 measured
> rather than assumed; (c) `scripts/featureCounts.cjs` for every count.
> Companion to [`AE_COMPARISON.md`](AE_COMPARISON.md), which stays the
> feature-by-feature ledger; this file is the *what-to-build-next* argument.

## 0. The one-paragraph version

Premation already matches or beats After Effects on the **structural** things
(one deterministic pipeline, timeline edit tools, tracking, rigging, scopes,
transcript editing, modifier stacks) and now has a real neural Object Matte,
an AE-class tracker instrument and path-following effects. What still makes a
motion designer reach for AE **plus plugins** is not a missing feature list —
it is five *looks* and one *quality floor*: a physically based glow (Deep
Glow), an energy-beam-along-a-path effect (Saber), a 3D particle system that
knows about the camera and lights (Particular), point/line networks (Plexus),
material displacement in 3D (AE 26.2), and sub-frame motion blur that reads as
film rather than as ghosting. Those six are the plan. Everything else in this
document is either already at parity or is a finishing item.

## 1. What the research says (September 2026)

### After Effects 26.0 → 26.3
| Release | Headline additions | Premation today |
|---|---|---|
| 26.0 (Jan) | Native parametric 3D meshes; 1,300 Substance materials; SVG import with editable gradients; Unmult; audio effects (Distortion / Compressor / Gate); per-character styling via expressions | Meshes ✅ (sphere/cylinder/cone/torus/capsule/box), SVG ✅, Unmult ✅, audio effects ✅ (`src/core/audio/`), Substance library ✗ (a material library exists, not a Substance graph) |
| 26.2 (Apr) | **AI Object Matte**; Quick Apply; **displacement for 3D materials**; proportional scrubbing; SVG workflow polish | Object Matte ✅ (bundled SlimSAM, 2026-09-07), Quick Apply ✅, proportional scrubbing ✅, **displacement ✗** |
| 26.3 (Jun) | **Advanced 3D depth of field** (near/far blur, focus linked to a layer); Curl Noise; mask tracker "up to 5× faster"; Illustrator/SVG paste; variable-font filter; copy frame to clipboard | DOF ✅ (depth-buffer gather + focus verbs), Curl Noise ✅, mask tracker ✅ (one decode walk, analysis tier), paste ✗ (import only), font filter ✅, copy frame ✅ |

Sources: [Digital Production](https://digitalproduction.com/2026/01/23/adobe-after-effects-2026-lands-with-3d-text-and-performance-boosts/), [Newsshooter](https://www.newsshooter.com/2026/01/22/whats-new-in-adobe-after-effects-26-0/), [CG Channel on 26.3](https://www.cgchannel.com/2026/06/adobe-releases-after-effects-26-3/), [Plugin Play](https://www.pluginplay.app/blog/whats-new-in-adobe-after-effects-2026), [Adobe release notes](https://helpx.adobe.com/after-effects/release-note/release-notes-after-effects.html).

### The plugins people keep installed
Every 2026 round-up converges on the same core: **Trapcode Particular** (3D particles, now with a fluids engine), **Element 3D**, **Saber** (free — energy beams along masks and text), **Deep Glow** (physically based glow), **Plexus / Stardust** (point-line networks, node particles), **Mocha** (planar tracking), **Duik** (rigging), **Newton** (2D physics), **Animation Composer / FX Console** (workflow). Of these, Premation already covers Element 3D (extrusion + glTF + PBR), Duik (bones/IK/ARAP — natively better), Newton (2D rigid bodies), Mocha's common cases (planar + mesh + RANSAC), and Animation Composer's role (presets + Quick Apply). **The uncovered four are Deep Glow, Saber, Particular and Plexus** — and they are all *looks*, which is why users perceive "our effects are weaker" even with 201 effects on the list.

Sources: [School of Motion](https://schoolofmotion.com/blog/best-after-effects-plugins-and-effect-packs-you-need-in-2026), [Maxon](https://www.maxon.net/en/article/best-after-effects-plugins), [Vagon](https://vagon.io/blog/top-10-plugins-for-after-effects), [Creative Dojo — Deep Glow review](https://creativedojo.net/deep-glow-review/), [Plugin Everything — Deep Glow](https://www.plugineverything.com/deep-glow), [ProVideo Coalition — Saber](https://www.provideocoalition.com/saber-new-free-effects-plug-video-copilot/), [Motion Array — Saber review](https://motionarray.com/learn/post-production/video-copilots-free-saber-plug-in-review/), [Lesterbanks — Stardust vs Particular](https://lesterbanks.com/2017/07/stardust-compare-trapcode-particular/).

### Alternatives
- **Cavalry** — node/behaviour-based, procedural, real-time; wins on data-driven and generative work. Premation's cloners + effectors, modifier stacks and audio drivers are the same idea without a node graph. No action beyond keeping those first-class. ([School of Motion](https://schoolofmotion.com/blog/cavalry-houdini-of-2d-after-effects), [MotionCircles](https://motioncircles.com/knowledge/what-is-cavalry-cavalry-vs-after-effects-comparison/))
- **Fusion 21 / Resolve 21** — deep compositing, USD, Cryptomatte in the 3D renderer, lens-distortion calibration, audio-driven modifiers, Lottie/OGraf import. Only **Cryptomatte** touches a motion-design workflow (ID mattes on imported EXR renders). ([CG Channel](https://www.cgchannel.com/2026/06/blackmagic-design-releases-fusion-studio-21-0/))

## 2. What the audit says (our side, measured)

**Sound (measured this week, do not re-litigate):** the point tracker is
sub-pixel (0.001 px on smooth planes, ~1 px on hard synthetic edges),
transform/apply maths are exact to 0.01 px, bidirectional walks are seamless,
the SAM pipeline segments at 98.7 % coverage / 0.1 % leak, and the tracked
mask → path effect chain resolves per frame exactly (+160 px at t=2 against
analytic truth). See `motion-editor-tracker-debug-2026-09-07` in memory and
the commit messages of `f4651302`, `94db94be`, `632f52be`.

**Where the "weak" feeling actually comes from — code-level findings:**

| Area | Finding | Evidence |
|---|---|---|
| Glow | `glow` is a single-scale CSS `drop-shadow` (radius ≤ 60 px, no falloff model, no aspect, no HDR) — this is the single biggest *look* gap next to AE + Deep Glow | `effects.ts` glow def (`css: drop-shadow(...)`) |
| Energy beams | Path effects exist since 09-07 (Write-on/Vegas along masks) and `lightning` is start→end only; there is no core-plus-glow-plus-distortion beam that follows a mask or text — the Saber use case that started this whole thread | `effects.ts` write-on / vegas / lightning defs |
| Particles | Deterministic closed-form 2D system with point/box/circle emitters and 4 sprite shapes; stateful mode adds floor bounce. No 3D emitters, no camera/light awareness, no sprite/texture particles, no turbulence fields as a first-class force, no parent/child emitters, no fluids | `src/core/particles/particleSim.ts` header |
| Motion blur | Layer motion blur is an N-sample additive accumulation in `CompositionPass` (correct, film-like at high N, ghosts at low N); no adaptive sample count and no per-layer shutter phase UI | `CompositionPass.ts:2162, 3679`, `forceMotionBlur.ts` |
| 3D | Displacement (AE 26.2) not started; one shadow-mapped light per run; SSAO shipped | `ROADMAP.md`, `AE_COMPARISON.md` §3 item 13 |
| Segment UX | Fixed 09-07: the old Segment button ran on a synthetic blob, the SAM box prompt selected everything (no box embeddings in the slimsam export) | `objectMask.ts`, `samPipeline.ts` |
| Tracker UX | Fixed 09-07: dead pick after apply, phantom handle, no marquee/loupe/resize | `TrackPointOverlay.tsx` |
| Code health | 6 TODO/FIXME markers in `src/core`, 0 in renderer/tracking/timeline — the tree is clean; "not supported" strings are honest format limits (tiled/deep EXR, compressed DPX, PSD merged RLE) | grep 2026-09-08 |
| Known bugs | Puppet: intermittent black first frame after alpha decode (2026-09-06, unresolved); Apply-to-"this layer" doubles the source's own motion | memory `motion-editor-puppet-2026-09-06`, tracker audit |

## 3. The plan

Ordered by *perceived-strength per week of work*. Each item names the file it
starts from and the way it is verified, because "looks better" is not a test.

### Phase A — the four looks (effects) · ~3 weeks

**A1. Physically based glow (`deep-glow`)** — new effect, GPU shader + CPU parity.
Model: multi-scale (octave pyramid, 6–8 levels of separable Gaussian at
increasing radius) summed with inverse-square-style weights → true wide-and-soft
falloff; params: *Radius, Exposure, Threshold, Aspect ratio, Chromatic
aberration (per-channel radius multipliers), Tint, Glow-only / Source+glow,
Quality (downsample), Dither*. Works in the linear working space so HDR
sources bloom correctly. Keep the existing `glow` untouched (documents depend
on it).
Verify: render-test golden on a small bright disc — falloff should follow
1/r² within tolerance at 4 radii; no banding at 8-bit output.

**A2. Energy beam (`beam-path`, the Saber class)** — new effect building on
the 09-07 path resolver. Geometry: mask path (`pathMaskId`), text outline (via
`shapesFromText`) or Start→End. Rendering: an inner *core* stroke (width,
softness, start/end size taper) + stacked *glow* layers (bias, spread, falloff
reuse from A1) + procedural *distortion* (curl-noise displacement along the
normal, evolution keyframeable) + *flicker* (deterministic seed, rate, depth);
*Start/End* percent for the reveal; 20 presets (fire, electric, neon, plasma,
lightsaber…). Add `pathMaskId` to `lightning` as well (path-guided bolts).
Verify: golden on a circle mask; determinism test that two renders at the same
`t` are byte-identical.

**A3. Particles v2 (the Particular class)** — extend `particleSim` rather than
replace it, keeping determinism (closed-form where possible, cached stateful
sim where not — `statefulParticleCache.ts` already exists):
- **3D emitters** (point/box/sphere/layer/light) with particles in comp 3D
  space, drawn through the camera with correct depth ordering and DOF
  participation;
- **sprite / textured-polygon particles** (any layer or asset as the particle,
  animated sprites by age);
- **turbulence & drag fields** as first-class forces (curl noise is in the
  tree), **parent/child emitters** (trails, sparks off sparks);
- **per-age curves** for size / opacity / colour over life (reuse the graph
  editor's curve widget);
- **motion blur** on particles from velocity (free — the sim knows `v`).
Fluids are explicitly *not* in this phase.
Verify: sim unit tests (already the pattern), golden for a sprite emitter
under a moving camera.

**A4. Point/line networks (`plexus`)** — a generator drawing points (from a
particle system, a mask, or a layer's shape vertices) and lines between
points within a max distance, with per-line opacity by distance, optional
triangles, and 3D camera awareness. Cheap once A3's 3D point cloud exists;
schedule it *after* A3.

### Phase B — 3D (AE 26.2/26.3 parity) · ~1.5 weeks

**B1. Height displacement for 3D materials** (AE 26.2). Vertex displacement
along the normal from a height texture on the `mesh3d-pbr` material, with
subdivision level for extruded/parametric meshes. Blocked-by list in
`ROADMAP.md` says "not started"; the PBR map plumbing (`gltf.ts`) already
carries the sampler.
Verify: golden on a subdivided plane with a ramp height map.

**B2. Second shadow-mapped light** — lift the one-light-per-run limit in
`shadowMap.ts` (two packed targets, additive shadow terms).

**B3. Motion blur quality** — adaptive sample count from screen-space velocity
(cap at 32, floor at 4), and a per-layer *shutter phase* row; cheap and it is
what makes A3's particles and fast 2D motion stop ghosting.

### Phase C — video editing & compositing finishing · ~1 week

**C1. Illustrator/SVG *paste*** (26.3): clipboard SVG → the existing SVG
importer (`clipboard.ts` already reads text; the parser exists).
**C2. Cryptomatte on EXR import** — read the ID manifest and expose
per-object mattes as selectable layer mattes (`exr.ts` refuses multi-part;
Cryptomatte lives in extra channels of a single part, so scope is the channel
reader + a picker).
**C3. Render-queue resume across relaunch** — serialize `resumeFrame` +
output path (session-only today).
**C4. Apply-to-"this layer" guard** in the tracker (one confirm).

### Phase D — the bug ledger (do alongside A)

**D0. The golden gate is red on `dev` — fix before A1 lands on it.** The
full `npm run render-tests` run of 2026-09-08 fails: 11 WebGPU ratchet
breaks and 29 visual regressions. Cause, traced: the 2026-09-06 batch
(`e8b8707b`) ported rounds 10/12/13 — the interior layer styles, bevel, the
noise family, median and shadow-highlight — to shaders and moved them out of
`CANVAS2D_ONLY` in `canvas2dEffects.ts`, so the harness now renders them on
the GPU against goldens blessed from the CPU pass on 08-14. Two classes,
verified by looking at the diffs:
- *Noise family* — `add-grain` 38 %, `turbulent-noise` 38 %,
  `cell-pattern` 39 %, `median-denoise` 37 %: the same look with a
  **different noise realization**. The shader's hash is not the CPU pass's
  hash, so the same document renders different grain depending on which route
  it takes (a `maskId`, an opacity or a path forces the CPU chain). Fix:
  make the WGSL/GLSL hash bit-match the CPU `hash2`, then re-bless.
- *Interior styles* — `satin` 14 %, `inner-glow` 16 %, `inner-shadow` 10 %,
  `bevel` 3–9 %, `shadow-highlight` 23 %: a **visibly different look**
  (satin renders a hard inner rim where the reference has a soft sheen).
  These are shader bugs against the CPU reference; fix, do not re-bless.
- The 17 round-seven effects have **no committed references** ("18 not
  rendered") — review each on both backends, then bless.
The rig / 3D / DOF diffs in `.artifacts/diff` are stale files from 09-03 and
are not part of this run.

- Puppet black first frame after alpha decode — reproduce with the browser
  recipe (`motion-editor-browser-repro`) on a WebM alpha clip; suspect the
  first `VideoFrame` closing before the texture upload.
- Mask-tracker vertex cap (64) — SAM contours are decimated to 48 now; make
  `trackLayerMask` sample vertices instead of refusing when a hand-drawn path
  exceeds the cap.

## 4. What NOT to do (and why)

- **A node graph** (Cavalry envy). Modifier stacks + cloners + audio drivers
  cover the motion-design half of it without the UI cost. Revisit only if a
  user asks for data-driven sequences the stacks cannot express.
- **Fluid particles** (Particular 2026). Impressive, rarely used in delivery
  work, and expensive to make deterministic. After A3 lands, measure demand.
- **True multi-frame parallel rendering.** Investigated and declined in
  `AE_COMPARISON.md` §3 (1b) — a worker render would produce different pixels
  for any comp with text. The encode/IO stage is already pipelined.
- **Substance graphs.** The material library + glTF PBR covers the delivered
  look; a Substance-compatible node evaluator is a product in itself.

## 5. Order of work

D0 first (a red gate makes every later golden meaningless), then A1 → A2 (they share the glow kernel; A2 is the "lightning around the wheel"
the tracker thread set out to build) → B3 → A3 → A4 → B1 → C1..C4 → B2, with D
interleaved. After A2 ships, the demo that sells the engine is: *draw a box
around a wheel → tracked mask → Beam on the path with Deep Glow — no plugins*.

## 6. Verification standard for every item

Each item lands with (1) a unit test for its pure maths, (2) a golden in
`packages/render-tests/` on both backends, (3) a determinism check (same `t`
twice → identical bytes), and (4) a line in `AE_COMPARISON.md`. Counts in
docs go through `scripts/featureCounts.cjs`; `docFeatureCounts.test.ts` will
catch drift.
