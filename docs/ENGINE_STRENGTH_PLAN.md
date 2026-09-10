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
| 26.2 (Apr) | **AI Object Matte**; Quick Apply; **displacement for 3D materials**; proportional scrubbing; SVG workflow polish | Object Matte ✅ (bundled SlimSAM, 2026-09-07), Quick Apply ✅, proportional scrubbing ✅, **displacement ✅ (2026-09-09, B1)** |
| 26.3 (Jun) | **Advanced 3D depth of field** (near/far blur, focus linked to a layer); Curl Noise; mask tracker "up to 5× faster"; Illustrator/SVG paste; variable-font filter; copy frame to clipboard | DOF ✅ (depth-buffer gather + focus verbs), Curl Noise ✅, mask tracker ✅ (one decode walk, analysis tier), paste ✅ (2026-09-08, C1), font filter ✅, copy frame ✅ |

Sources: [Digital Production](https://digitalproduction.com/2026/01/23/adobe-after-effects-2026-lands-with-3d-text-and-performance-boosts/), [Newsshooter](https://www.newsshooter.com/2026/01/22/whats-new-in-adobe-after-effects-26-0/), [CG Channel on 26.3](https://www.cgchannel.com/2026/06/adobe-releases-after-effects-26-3/), [Plugin Play](https://www.pluginplay.app/blog/whats-new-in-adobe-after-effects-2026), [Adobe release notes](https://helpx.adobe.com/after-effects/release-note/release-notes-after-effects.html).

### The plugins people keep installed
Every 2026 round-up converges on the same core: **Trapcode Particular** (3D particles, now with a fluids engine), **Element 3D**, **Saber** (free — energy beams along masks and text), **Deep Glow** (physically based glow), **Plexus / Stardust** (point-line networks, node particles), **Mocha** (planar tracking), **Duik** (rigging), **Newton** (2D physics), **Animation Composer / FX Console** (workflow). Of these, Premation already covers Element 3D (extrusion + glTF + PBR), Duik (bones/IK/ARAP — natively better), Newton (2D rigid bodies), Mocha's common cases (planar + mesh + RANSAC), and Animation Composer's role (presets + Quick Apply). **The uncovered four are Deep Glow, Saber, Particular and Plexus** — and they are all *looks*, which is why users perceive "our effects are weaker" even with 204 effects on the list.

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
| Glow | `glow` is a single-scale CSS `drop-shadow` (radius ≤ 60 px, no falloff model, no aspect, no HDR) — was the single biggest *look* gap next to AE + Deep Glow. **Closed 2026-09-08 by `deep-glow` (A1)**; `glow` stays for existing documents | `effects.ts` glow + deep-glow defs, `deepGlow.ts`, `fxDeepGlow.ts` |
| Energy beams | Path effects existed since 09-07 (Write-on/Vegas along masks) and `lightning` was start→end only; there was no core-plus-glow-plus-distortion beam that follows a mask or text. **Closed 2026-09-08 by `beam-path` (A2)**; `lightning` follows a mask path too | `beamPath.ts`, `fxBeamPath.ts`, `generateAdvanced.ts` |
| Particles | Was: closed-form 2D system, 4 sprite shapes, no 3D emitters, no camera awareness, no sprite particles, no drag, no parent/child. **Closed 2026-09-09 by A3** (sphere emitter, camera-lens-aware depth, sprite sheets, exact drag, mid-point ramps, continuous children, velocity streaks); still one card in 3D, no fluids | `particleSim.ts` header, `particleV2.test.ts` |
| Motion blur | N-sample additive accumulation (correct); the adaptive count was sized from ANCHOR travel (spins and flips strobed) and there was no per-layer shutter phase. **Closed 2026-09-08 by B3** (silhouette travel, Force Motion Blur ▸ Shutter Phase) | `CompositionPass.ts:2162, 3679`, `forceMotionBlur.ts` |
| 3D | ~~Displacement (AE 26.2) not started~~ **shipped 2026-09-09 (B1)**; ~~one shadow-mapped light per run~~ **two since 2026-09-09 (B2)**; SSAO shipped | `ROADMAP.md`, `AE_COMPARISON.md` §3 item 13 |
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

**A1 — DONE 2026-09-08.** `deep-glow` ships in Stylize: a PROGRESSIVE octave
pyramid (level k = level k−1 blurred by √(σ_k²−σ_{k−1}²), sigmas doubling up
to Radius, 4/6/8 octaves by Quality) summed with equal weights — which on
energy-normalised Gaussians *is* the inverse-square falloff, no exponent to
tune. Linear light, premultiplied, on the GPU's f16 chain. Params: Radius,
Exposure (stops), Threshold (soft knee), Aspect Ratio, Chromatic Aberration
(per-channel sigma multipliers), Tint + amount, Glow Only, Dither, Quality.
Dither earned its place in the live check: a 1/r² tail crosses the 8-bit floor
over a wide band, which rendered as a faint disc with an edge on a dark ground
— ±1 output code of hashed noise on the glow (only where there is glow)
breaks it. GPU = three small passes (`fxDeepGlow.ts`: per-channel
separable blur, weighted additive accumulate into BLUR_TARGET3, two-texture
composite) driven from `CompositionPass`; CPU twin `deepGlow.ts` mirrors the
same 33-tap (±4σ) integer-stride ladder from `deepGlowKernel.ts`, so the
`effect-deep-glow` golden is a parity gate. Verified: `deepGlow.test.ts`
measures the log-log slope between 12/24/48/96 px at −1.5…−2.7 and monotone
outward; the pyramid is >5× the single Gaussian at the core.

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

**A2 — DONE 2026-09-08.** `beam-path` ("Energy Beam", Generate). Geometry:
mask path via the 09-07 resolver, the layer's text outline (`traceTextRuns`,
flattened per letter with a pen-up sentinel), or Start→End. Field: signed
distance to the spine with the Start/End window applied per segment (exact
ends), a Start/End Size taper, inverse-power glow `(1 + d/spread)^-e` with
Bias → e ∈ [1, 4] and a smooth cut at 10·spread, curl-noise domain warp (the
Curl Noise effect's own fbm + hash), keyframed Evolution / Flicker Phase
(the repo's TIME_DEPENDENT rule — no wall clock). The spine is resampled by
arc length to ≤64 points and carried in the uniform block (`beamPathRows`,
39 rows), so it is the one path effect exempt from the CPU-bake gate and the
first that runs on the GPU with a polyline. CPU twin `beamPath.ts` mirrors
`fxBeamPath.ts` formula for formula. Twenty presets; `lightning` gained
`pathMaskId` (path-guided bolt: midpoint displacement along the spine's
normal). Verified: `beamPath.test.ts` (resample keeps the circle to <1 px,
window/taper/glow values exact, byte-identical renders, deterministic
flicker); goldens `effect-beam-path` and `effect-beam-path-mask` on both
backends.

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

**A3 — DONE 2026-09-09 (scoped).** Everything stays a closed form of
(config, time) — the property the whole system is built on — so each item is
exact, scrub-free and byte-identical for pre-v2 configs:
- **Sphere emitter** (uniform ball, born with depth) beside point/box/disc;
  box + Depth is the 3D box. The stateful sim shares the origin sampler.
- **Camera-lens-aware depth**: a 3D particle layer under a scene camera takes
  the camera's focal length as its perspective when none is set, so z parallax
  follows the comp lens. Honest limit: the field is still ONE card in 3D
  (placed and projected like any 3D layer) — particles do not sort against
  other 3D layers and do not take the camera's DOF per particle; that is the
  "renderer subsystem" the sim header describes and stays out of scope.
- **Sprite particles**: `shape: 'sprite'` draws an image asset (any layer can
  be pre-composed to one), with horizontal sprite sheets indexed by age or at
  a fixed rate; the provider decodes through the image loader and re-renders
  the frame when the bitmap lands.
- **Drag** as a first-class force, the EXACT solution of `v' = a − k·v`
  (`flightAt`), which the bursts, trails and children all share; turbulence
  was already first-class.
- **Per-age curves**: mid-point rows for size / opacity / colour at `midAge`
  (unset → the old straight ramps, byte for byte).
- **Parent/child**: `subEmit: 'continuous'` sheds children along a living
  parent's path at `subRate` (death and bounce bursts already existed).
- **Velocity streaks**: `motionBlur` × the comp shutter (handed to the field
  only when the layer's motion-blur switch is on) stamps each sprite along
  its own closed-form velocity.
Verified: `particleV2.test.ts` (compat byte-identity, drag vs a fine Euler
reference, ball fill, ramp mid values, continuous children on the parent
path, streak velocity, sheet indexing); golden `particles-v2` (GPU oracle —
the Canvas2D reference never rasterised the sim).

**A4. Point/line networks (`plexus`)** — a generator drawing points (from a
particle system, a mask, or a layer's shape vertices) and lines between
points within a max distance, with per-line opacity by distance, optional
triangles, and 3D camera awareness. Cheap once A3's 3D point cloud exists;
schedule it *after* A3.

**A4 — DONE 2026-09-09.** One renderer, two homes (`plexus.ts`). (1) The
`plexus` EFFECT (Generate, Canvas2D-only like Lightning; EffectType 204): a
deterministic point cloud hashed into the layer box and drifting on value
noise as Evolution advances — or the vertices of an assigned mask path
(every `pathStep`-th polyline sample), so a tracked mask makes the network
follow the object — with every pair inside Max Distance linked by a line
whose opacity falls to zero at that distance, optional triangles over
mutually-close triples, and points on top. (2) The same network over a
PARTICLE SYSTEM's live particles (Plexus Distance in the Particle section),
drawn under the sprites at their projected positions — which is where A3's
depth/perspective makes it read as 3D; per-particle camera sorting against
other layers is the same "one card" limit as A3. Cost is O(n²) with a hard
cap (`PLEXUS_MAX_POINTS` = 700), chosen over a spatial hash because at these
counts the hash costs more than it saves. Verified: `plexus.test.ts` (link
rule and edge opacity, triangle rule, cap, cloud determinism/spread/drift,
heads-not-ghosts in the field); golden `effect-plexus` (both engines bake
the same pass).

### Phase B — 3D (AE 26.2/26.3 parity) · ~1.5 weeks

**B1. Height displacement for 3D materials** (AE 26.2). Vertex displacement
along the normal from a height texture on the `mesh3d-pbr` material, with
subdivision level for extruded/parametric meshes. Blocked-by list in
`ROADMAP.md` says "not started"; the PBR map plumbing (`gltf.ts`) already
carries the sampler.
Verify: golden on a subdivided plane with a ramp height map.

**B1 — DONE 2026-09-09.** `heightDisplacement.ts`: a height field (the luma
of an image asset, or a primed procedural field) pushes every vertex along
its normal by `(h − 0.5)·Displacement` px — 50 % grey is flat — after 0–3
rounds of midpoint subdivision (edge midpoints shared, attributes
interpolated, triangle order preserved so a carrier's material ranges remap
by ×4ⁿ), then the normals are recomputed from the displaced faces so the
lighting follows the relief. It runs on the CPU at snapshot time over the
interleaved mesh the renderer already takes, on the same seam skinning and
morphs use — so extrusions, parametric primitives and imported glTF meshes
all displace through one function and no shader changed. Material Options
▸ Displacement: Height Map (any image asset), Displacement (keyframeable,
`MATERIAL_ANIMATABLE`), Subdivide. The field decodes asynchronously and
nudges a re-render when it lands. Verified: `heightDisplacement.test.ts`
(bilinear clamp sampling, watertight order-preserving subdivision, exact
(h−0.5)·amount along the normal, normals tilt with the slope and keep their
authored sense, memo keys); golden `primitive-displaced-sphere` (a lit UV
sphere over a primed 6×4 sine bump field, one subdivision).

**B2. Second shadow-mapped light** — lift the one-light-per-run limit in
`shadowMap.ts` (two packed targets, additive shadow terms).

**B2 — DONE 2026-09-09.** The run's second light with Shadow Map on gets its
own map (a second pinned target per size, bindings 13/14 on every lit-3d
material, its own NEAREST sampler on both backends) and its own 28-float
block at the end of the shade tail (`shadow2Matrix/Axis/Origin/Params`,
`Shade3D.shadow2`, light flag `shadowed2`). The shader's shadow body became
ONE parameterised `shadowTerm` (block uniforms + map handles as arguments)
called once per map, so the second light's shadow is the same arithmetic
against its own map rather than a copy; each term multiplies only its own
light's attenuation, so the two shadows compose as light does. A third mapped
light still takes the projected copy. Golden `shadow-map-two-lights`
(two spots, two crossing geometric shadows); `shadowMaps.test.ts` pins the
tail layout, the binding order and the single tap site.

**B3. Motion blur quality** — adaptive sample count from screen-space velocity
(cap at 32, floor at 4), and a per-layer *shutter phase* row; cheap and it is
what makes A3's particles and fast 2D motion stop ghosting.

**B3 — DONE 2026-09-08.** The adaptive count already existed (`adaptiveMotionBlurSamples`,
~1 sample per 2 px, floor = comp Samples, cap = comp Limit) but was sized
from the ANCHOR's travel, which reads zero for a spin, a scale pop and a 3D
card flip — exactly the motion that strobed. It is now sized from the
SILHOUETTE's travel: `motionBlurTravelPx` adds `Δθ·halfDiagonal` and
`Δscale·halfDiagonal` to the anchor path in 2D, and `affineTravelPx` takes
the farthest corner of the projected box in 3D (`buildSnapshot.sampleMotion`).
The per-layer shutter phase is the `Shutter Phase` row on Force Motion Blur
(`forceMotionBlur.ts`, threaded into `blurCfg`), so one layer can lead or
trail the frame while the comp keeps its own phase. Tests in
`motionBlur.test.ts` / `forceMotionBlur.test.ts`.

### Phase C — video editing & compositing finishing · ~1 week

**C1. Illustrator/SVG *paste*** (26.3): clipboard SVG → the existing SVG
importer (`clipboard.ts` already reads text; the parser exists).
**C2. Cryptomatte on EXR import** — read the ID manifest and expose
per-object mattes as selectable layer mattes (`exr.ts` refuses multi-part;
Cryptomatte lives in extra channels of a single part, so scope is the channel
reader + a picker).
**C2 — DONE 2026-09-09.** `exr.ts` now keeps the header's string attributes
(the `cryptomatte/<id>/name` + `manifest` pair); `cryptomatte.ts` finds each
layer's `<name>00.R/G/B/A…` rank planes, reads the manifest's object → hash
map (or lists the ids it finds, by hex, when the manifest is stripped), and
builds an object's matte as the sum of its coverage over ranks on the ids'
BIT patterns — shared edges split, every object sums to one. Registered
at import beside the float planes; the Track Matte ▸ Matte Source picker
lists "ID matte: <object>" for a layer whose EXR carries a set, and picking
one bakes the coverage to a grey PNG asset, inserts it above and sets it as
the luma matte (`cryptomatteCommands.ts`) — a matte layer like any other
from there. Tests in `cryptomatte.test.ts`.

**C3. Render-queue resume across relaunch** — serialize `resumeFrame` +
output path (session-only today).
**C4. Apply-to-"this layer" guard** in the tracker (one confirm).

### Phase D — the bug ledger (do alongside A)

**D0 — DONE 2026-09-08.** Fixed, not re-blessed, except where the old golden
was itself the approximation. What it took: (1) the CPU noise family now uses
the shaders' u32 hash (`noiseHash.ts`), so Add Grain / Turbulent Noise / Cell
Pattern render the same grain on every route; (2) the interior layer styles,
bevel and Shadow/Highlight shaders now shade in display sRGB like the CPU pass
(they added in linear — the wrong hue and curve); (3) `blurA` no longer
hard-zeroes samples past the layer box (it saturated Inner Shadow to black
edge lines and doubled Satin's rim); bevel taps read the padding likewise;
(4) the GPU median takes the exact (2r+1)² window for r ≤ 3; (5) **3D Glasses
never compiled on WebGL2** — its GLSL used the reserved word `half`; (6) the 17
round-seven scenes + particle-systems got their first references, and the
noise family and bevel-above-cap were re-blessed on those grounds. Gate:
29 regressions → 0. The original finding follows for the record.

**D0 (original finding). The golden gate is red on `dev` — fix before A1 lands on it.** The
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

- ~~Mask-tracker vertex cap (64)~~ — **done 2026-09-08** (`maskVertexSampling.ts`: tracks an arc-length-even subset ≤ 64, moves the rest with their neighbours).
- Puppet black first frame after alpha decode — **still open** (2026-09-10): not reproduced; the solver side is now ruled out — `coverageMeshFirstDeform.test.ts` pins that the first deform after the coverage mesh replaces the bbox grid (pins outside the artwork included, every mesh mode, ARAP and LBS) is finite, artwork-sized and bit-identical to the second. If it returns, the remaining suspects are on the render side of that one frame (texture readiness / frame-cache invalidation on the `__puppet_coverage__` AnimationChanged), not the mesh.
- ~~Golden gate drifting between runs on one machine~~ — **done 2026-09-10.** Three separate causes, each now pinned or logged: (1) the WebGL2 harness window inherited the desktop's display scaling (`devicePixelRatio` 2.18 on this laptop's panel, 1 on its docked monitor), and particle fields and vector tiers scale their rasters by it — `main.cjs` now forces `device-scale-factor=1`; (2) the WebGPU process runs on the machine's real adapter with hardware Canvas2D, so a baked layer's thousands of translucent Canvas2D fills (Plexus) came out 20 % different from the CPU raster the references are blessed from — baked layers now take a `willReadFrequently` (CPU) context in `Canvas2DVectorRasterizer`, and the divergence is gone on both adapters; (3) a dual-GPU laptop hands WebGPU a different adapter from run to run (Radeon 780M vs RTX 4060), which moves antialiased edges by a pixel — `renderEntry` now logs the WebGL2 renderer string, the WebGPU adapter and the DPR once per run so a drifted ratchet reads as an environment fact. Also: `primitive-displaced-sphere` flickered one pixel on WebGPU because a UV sphere's seam column and pole fans were displaced per vertex and tore into z-fighting slivers — coincident vertices (same position AND normal) now share one height and pool their recomputed normals (`positionGroups`).
- ~~Puppet black first frame after alpha decode~~ (original note) — reproduce with the browser
  recipe (`motion-editor-browser-repro`) on a WebM alpha clip; suspect the
  first `VideoFrame` closing before the texture upload.
- ~~Mask-tracker vertex cap (64)~~ (original note) — SAM contours are decimated to 48 now; make
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
