# Viewport worker plan — moving snapshot building off the main thread

> Written 2026-09-04 against `dev`. **PLAN, except §4 Step 1 — that one is now
> done, and §7 records what checking it first actually found (the memoisation
> already existed; the cache's KEY and its eviction were the real defects).
> Steps 2–4 remain unimplemented.**
> Every number below was measured on this machine with the commands quoted, so
> a later reader can re-run them and disagree with evidence rather than taste.
>
> Prompted by `UX_UI_IMPROVEMENT_PLAN.md` §4 → Performance: *"No
> `OffscreenCanvas`/render worker; snapshot building and scene walk are on the
> main thread… the pragmatic step is moving snapshot building and cache blits
> to a worker while keeping the draw on the main thread."*

---

## 0. The conclusion first

**Do not build a snapshot worker yet.** The measurement does not support it,
and two cheaper fixes in the same code path are worth more than the worker
would be.

`buildSnapshot` costs **2.4 ms** for a 500-layer scene with realistic parent
chains and **9.8 ms** for 2000 layers. At 60 Hz the budget is 16.7 ms, so the
scene walk is not what makes a heavy comp stutter — it is roughly 15 % of the
frame at 500 layers and only becomes the frame at ~3500 layers.

What *did* dominate app-code CPU in the profile is a single function that has
nothing to do with the walk: **`buildEnvSpecularAtlas`** in
`src/core/scene/environmentLight.ts`, at **1037 ms of self time — 18 % of all
app-code CPU sampled**, and 2491 ms inclusive across `environmentLight.ts`.
That is an image-based-lighting prefilter, it is pure numeric work over a
pixel buffer, it has no DOM dependency, and it is the single best worker
candidate in the viewport. It is also the best *caching* candidate, which is
cheaper still.

So the order of work is: (1) memoise the environment atlas, (2) make the
snapshot walk incremental, (3) *then* re-measure and decide about a worker.

---

## 1. How this was measured

```bash
# 1. Profile the whole buildSnapshot suite (30 files, 309 tests).
node --cpu-prof --cpu-prof-dir=<scratch>/cpuprof \
     node_modules/jest/bin/jest.js src/core/rendering/buildSnapshot --runInBand

# 2. Sum self time per function from the .cpuprofile:
#    self[node] = Σ timeDeltas[i] where samples[i] == node
#    inclusive[node] = Σ self over the node's subtree
```

A second, temporary jest file benchmarked `buildSnapshot` directly on
synthetic scenes (10 warm-up calls, then 60 timed calls, reporting the mean).
It was deleted after the run; the generator is reproduced in §5 so the numbers
can be regenerated.

Caveats, stated up front so the numbers are not over-read:

- The profile is a **Jest** process. 15 % of all samples are `open` and
  another ~15 % `read`/`stat`/`readFileUtf8`/`Script` — that is module
  resolution, not the app. Only **25.7 %** of sampled time is app code at all,
  which is why the table below is filtered to app files.
- Test scenes are small. The profile establishes *which* functions are hot;
  the synthetic benchmark establishes *how much* they cost at real scale. Both
  are needed, and neither alone is sufficient.
- No GPU work is in either measurement. This is about the CPU half — the walk
  that produces the snapshot, not the draw that consumes it.

---

## 2. What the profile says

Self time, app code only, top entries (22 696 ms sampled, 5 836 ms of it app
code):

| Self ms | % of sample | Function | File |
|--------:|------------:|----------|------|
| 769.4 | 3.39 % | `buildEnvSpecularAtlas` | `src/core/scene/environmentLight.ts` |
| 185.4 | 0.82 % | `boxColsClamp` | `src/core/scene/environmentLight.ts` |
| 66.5 | 0.29 % | `buildSnapshot` | `src/core/rendering/buildSnapshot.ts` |
| 61.3 | 0.27 % | module init | `src/core/effects/effects.ts` |
| 40.8 | 0.18 % | `traceBitmap` | `src/core/geometry/traceBitmap.ts` |
| 29.5 | 0.13 % | `rasterizeText` | `src/core/scene/shapesFromText.ts` |
| 26.5 | 0.12 % | `environmentSpecularMap` | `src/core/scene/environmentLight.ts` |
| 20.8 | 0.09 % | `presetPixels` | `src/core/scene/environmentLight.ts` |
| 20.4 | 0.09 % | `hashUnknown` | `src/core/rendering/contentHash.ts` |
| 18.6 | 0.08 % | `boxRowsWrap` | `src/core/scene/environmentLight.ts` |

By file, and by call tree:

| Measure | ms |
|---------|---:|
| `environmentLight.ts` — self | 1037.8 |
| `environmentLight.ts` — **inclusive** | **2491.5** |
| `buildSnapshot.ts` — self | 128.6 |
| `buildSnapshot` — **inclusive (134 call-tree nodes)** | **1460.2** |

Read that last pair carefully: `buildSnapshot`'s own body is 129 ms, and its
whole subtree is 1460 ms. **Nine tenths of "snapshot building" is not the walk
— it is the work the walk calls into**, and the largest single piece of that
is environment lighting.

---

## 3. What the benchmark says

Mean ms per `buildSnapshot` call, 60 runs after 10 warm-ups, shape layers with
an animated `x` track each:

| Layers | Parent chain depth | ms / call | ms per 1000 layers |
|-------:|-------------------:|----------:|-------------------:|
| 100 | 1 (flat) | 5.06 | 50.6 |
| 500 | 1 (flat) | 24.99 | 50.0 |
| 1000 | 1 (flat) | 41.97 | 42.0 |
| 500 | 8 | **2.38** | 4.8 |
| 2000 | 8 | **9.82** | 4.9 |

Two things fall out of this, and the second is the interesting one.

**It is linear.** 4.9 ms per thousand layers at depth 8, flat from 500 to
2000. There is no super-linear blow-up hiding in the walk, which is what would
have made a worker urgent.

**Flat scenes are 10× more expensive per layer than deep ones** — 50 ms vs
4.9 ms per thousand. That is the opposite of the intuition (a deep parent
chain sounds like more work per node), and it is a real finding: in the flat
case every one of the N layers is a root of the composition, so per-root work
runs N times, while in the depth-8 case it runs N/8 times. Whatever that
per-root work is, it costs roughly **0.45 ms per root** and dwarfs the
per-node cost. A 1000-layer flat comp — an imported SVG, a text explosion, a
particle bake — is the pathological shape, not a deep rig.

**That is the highest-value single lead in this document**, and it is a fix in
`buildSnapshot`, not a worker: a worker would move 42 ms off the main thread,
whereas finding the per-root cost could delete most of it outright.

---

## 4. The plan, in order

### Step 1 — Memoise the environment specular atlas *(largest win, smallest change)* — **DONE 2026-09-04, but not for the reason stated below. See §7.**

`buildEnvSpecularAtlas` is 18 % of app-code CPU. An IBL prefilter is a pure
function of (environment source, resolution, roughness levels): it does not
depend on the playhead, the selection, or anything else that changes per
frame. If it is being rebuilt per snapshot, it is being rebuilt ~60×/s for an
answer that changed zero times.

- Confirm the call frequency first (`console.count` in the function, scrub a
  comp with an environment light for five seconds). If it is once per document
  load, this step is void and the profile figure is module-init noise from 30
  test files — **check before building anything.**
- If it is per frame: key a module-level cache on the environment's content
  hash (`contentHash.ts` already exists and is already in this path) and
  return the cached atlas.
- Expected: removes up to 1 s per 22 s of app CPU in the profile's terms; on a
  frame budget, removes the atlas from the frame entirely.

### Step 2 — Find and kill the per-root cost in `buildSnapshot`

From §3: ~0.45 ms per composition root, against ~0.005 ms per parented node.

- Instrument by root count rather than by node count: build 1000 layers as
  1 chain, 8 chains, 100 chains, 1000 chains, and plot. The slope is the cost.
- Likely suspects, in the order worth checking: `resolveGlobalLight` and the
  solo/precomp scan near the top of `buildSnapshot` (they read composition-wide
  state and may be re-resolved per root), and `readBase` (18.6 ms self, which
  is large for a per-node accessor).
- Expected: a flat 1000-layer comp from 42 ms to roughly the 4.9 ms/1000 the
  deep case already achieves.

### Step 3 — Incremental snapshots

Only after 1 and 2. The walk rebuilds every layer every frame; during
playback, most layers are unchanged between adjacent frames. A per-node cache
keyed on (content hash, sampled-time bucket) turns the walk into a diff.

This is strictly better than a worker for the same problem: it removes the
work rather than relocating it, and it does not pay serialisation.

### Step 4 — *Then* reconsider the worker

Re-measure after 1–3. Build the worker only if the walk is still over ~8 ms on
a scene the product actually has to support.

---

## 5. If the worker is built anyway — the shape it must take

The blocker is documented in `AE_COMPARISON.md` §3: fonts and DOM media are
not available in a worker. That rules out moving the whole pipeline and shapes
what a worker version has to look like.

**Split by dependency, not by module.** `buildSnapshot` has three kinds of
input:

1. **Pure numeric** — transforms, parent chains, keyframe sampling, z-sort,
   matrices, the environment prefilter. Worker-safe today.
2. **DOM-measured** — text metrics (`measureText.ts`), rasterised text
   (`rasterizeText`, 29.5 ms self), traced bitmaps (`traceBitmap`, 40.8 ms).
   Not worker-safe, but *cacheable* — they change on edit, not per frame.
3. **Live media** — video frames, decoded audio. Must stay on the main thread.

The viable split is: main thread resolves (2) and (3) into plain data on
change, hands that to the worker as part of a scene description, and the
worker does (1) per frame and posts back a transferable snapshot.

**Cost to beat.** A snapshot for a 2000-layer scene is thousands of small
objects. Structured-clone of that is not free, and at 9.8 ms of work you can
easily spend more on transfer than you save. Any worker design must be
prototyped against a **transferable** representation — typed arrays in a
`SharedArrayBuffer` or a transferred `ArrayBuffer`, with layers as struct-of-
arrays — *before* it is committed to. A worker that posts an object graph will
be slower than the code it replaces.

**Cache blits are the easier half.** The RAM preview cache holds 2D canvases
and `ImageBitmap`s; blitting them does not need the scene at all, and
`ImageBitmap` is transferable by design. If a worker lands at all, this is the
piece to move first — it is small, its data is already transferable, and it
carries none of the font/media blocker.

**What must not move.** `renderFrameAt`'s tap points — `publishFrame`,
`compareStore.captureFrom`, `captureLiveFrame` — all read the WebGL canvas in
the same task that drew it. That constraint is absolute (no
`preserveDrawingBuffer`) and it pins the draw, the scope tap and the snapshot
compare to the main thread whatever else happens.

---

## 6. Reproducing the benchmark

```ts
// A throwaway jest file in src/core/rendering/. Delete it after the run.
function shapeNode(id: string, parent: string | null): SceneNode {
  return {
    id, name: id, parent, children: [], visible: true, locked: false,
    transform: { position: { x: 10, y: 20 }, rotation: 45, scale: { x: 1, y: 1 } },
    components: [
      { id: `${id}_t`, type: 'Transform',
        props: { [SCENE_KIND_PROP]: 'shape', x: 10, y: 20, rotation: 45, width: 120, height: 80 } },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#2b7eff', blur: 4 } },
    ],
  } as unknown as SceneNode;
}

function bench(n: number, depth: number): void {
  const graph = new SceneGraph();
  const anim = new AnimationEngine();
  let chainParent: string | null = null;
  for (let i = 0; i < n; i++) {
    const id = `n${i}`;
    graph.addNode(shapeNode(id, i % depth === 0 ? null : chainParent) as never);
    chainParent = id;
    anim.setKeyframe(id, 'x', 0, 0);
    anim.setKeyframe(id, 'x', 2, 500);
  }
  for (let i = 0; i < 10; i++) buildSnapshot(graph, anim, i / 60);   // warm up
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) buildSnapshot(graph, anim, i / 60);
  console.log(`layers=${n} depth=${depth}  ${((performance.now() - t0) / 60).toFixed(2)} ms/call`);
}
```

Run with `npx jest <that file> --runInBand`. Numbers vary with machine and
thermal state; what should reproduce is the **shape** — linearity in layer
count, and the ~10× penalty for flat scenes over parented ones.

---

## 7. Step 1, done — and what the check found first (2026-09-04)

§4 Step 1 said, in bold: *"Confirm the call frequency first… If it is once per
document load, this step is void and the profile figure is module-init noise
from 30 test files — check before building anything."*

**That check was run, and the warning was right.** The memoisation the step
asked for already existed: `environmentSpecularMap` has held a module-level
`Map` keyed on the sky string since the Environment Light landed. Instrumenting
`buildEnvSpecularAtlas` with a build counter and re-running the profiled suite:

```
npx jest src/core/rendering/buildSnapshot --runInBand
→ 30 suites, 309 tests, 2 atlas builds:  'sunset', 'sky'
```

Two builds. Not per frame, not per test file — **two, for the two distinct
skies the suite uses.** The 1037 ms in §2 is two cold prefilters of a
256×128×5 atlas inside ts-jest at ~265 ms each, and a cold prefilter per sky
per session is the correct cost of the feature.

So the caching win §4 predicted was not available. What the check *did* find is
that the cache had the two defects a cache can have, and both of them cost real
work on a real user path.

### 7.1 What was actually wrong

**The key was a NAME, not a CONTENT.** The key was the sky string
(`asset:hdri_3|256x128x5`). Two different pixel buffers under one asset id — a
re-import, an EXR re-interpreted — are one name and two contents, so
`setEnvironmentAssetPixels` papered over it by calling `specularCache.clear()`
every time any image decoded. On a project holding N HDRIs that is N global
flushes while it opens: sky 1's atlas is rebuilt when sky 2 lands, again when
sky 3 lands, and so on. **O(N²) prefilters for N skies.**

And the flush did not achieve the thing it was there for. The renderer keys its
GPU texture off `EnvSpecularMap.id` — *"equal ids must mean equal texels"*,
`environmentSpecular.test.ts` — and the rebuilt atlas carried the same id. A
re-imported HDRI therefore paid a full CPU prefilter and kept the **stale
texture on the GPU**.

**Eviction was a flush.** At the 8-entry bound the code called `.clear()`: the
ninth sky threw away eight good atlases. A bound should cost you the least
useful entry, not all of them.

### 7.2 The change

`src/core/scene/envAtlasCache.ts` (new), wired into `environmentLight.ts`:

- **Content keys.** `v1|<content>|256x128x5`, where `<content>` is a preset id
  (procedural — the name *is* the content) or `assetId#<FNV-1a of the pixel
  words>`. FNV-1a over a `Uint32Array` view of the buffer, the same word-granular
  scheme `rendering/contentHash.ts` uses, computed **once per decoded image** in
  `setEnvironmentAssetPixels` and never on the per-frame path.
- **No flush on decode.** New pixels are a new key, so they are a new atlas and
  a new `id` (a real re-upload) without touching any other sky's entry.
- **LRU eviction**, 8 entries — ≈5 MB at the shipped layout.

### 7.3 Before / after, same harness

The benchmark is the project-open path: 6 HDRIs decoding one at a time, the
viewport painting 3 frames between decodes and querying every sky it holds.
Reproduced in §7.5.

```bash
node --cpu-prof --cpu-prof-dir=<scratch> \
     node_modules/jest/bin/jest.js src/core/scene/envAtlasCacheBench --runInBand
```

| Measure | Before | After | Change |
|---------|-------:|------:|-------:|
| Benchmark wall time | 7642 ms | 2365 ms | **3.23× faster** |
| `buildEnvSpecularAtlas` self | 5842.7 ms | 1764.6 ms | **−69.8 %** |
| `boxColsClamp` self | 1400.3 ms | 431.6 ms | −69.2 % |
| app-code self, whole run | 7644.2 ms | 2381.0 ms | −68.8 % |
| `hashEnvPixels` self | — | 65.4 ms | the new cost, 2.7 % of what it saves |
| Atlas builds | 21 | 6 | N²/2 → N |

The 21 → 6 is the whole story: 6 skies used to cost 1+2+3+4+5+6 prefilters and
now cost one each. The hashing that buys it is 65 ms against 4078 ms saved.

**These are jest numbers and must not be quoted as production milliseconds.**
jsdom + ts-jest inflate tight numeric loops by 10–30× — a ~265 ms atlas here is
tens of milliseconds in a browser. Only the same-harness A/B and the build
*count* mean anything, and the count is harness-independent.

### 7.4 What this does *not* claim

Nothing here removes the atlas from a frame, because it was never in one — the
old cache already handled the steady state. This removes the **O(N²) during
project open**, the stale GPU texture on re-import, and the cache-wide flush at
the bound. §4 Step 2 (the ~0.45 ms per composition root) is untouched and is
now the largest remaining lead in this document.

### 7.5 Reproducing the benchmark

```ts
// A throwaway jest file in src/core/scene/. Delete it after the run.
function skyPixels(seed: number): EnvPixels {
  const data = new Float32Array(ENV_SPEC_WIDTH * ENV_SPEC_HEIGHT * 3);
  for (let i = 0; i < data.length; i++) data[i] = ((i * 2654435761 + seed) % 1000) / 1000;
  return { width: ENV_SPEC_WIDTH, height: ENV_SPEC_HEIGHT, data };
}

it('bench', () => {
  clearEnvironmentAssetPixels();
  const ids = Array.from({ length: 6 }, (_, i) => `hdri_${i}`);
  const px = ids.map((_, i) => skyPixels(i + 1));
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) {
    setEnvironmentAssetPixels(ids[i]!, px[i]!);
    for (let f = 0; f < 3; f++) for (let j = 0; j <= i; j++) environmentSpecularMap(`asset:${ids[j]!}`);
  }
  console.log(`[BENCH] ${Date.now() - t0} ms`);
}, 600000);
```

The durable half of it lives in `src/core/scene/envAtlasCache.test.ts`, which
asserts the *counts* rather than the clock: decoding one HDRI must not rebuild
any other sky's atlas (object identity), re-imported pixels must produce a new
`id`, and the cache must stay at or under 8 entries while a project cycles.
