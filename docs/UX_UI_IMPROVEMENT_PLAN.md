# Premation — UI / UX / Performance Improvement Plan

> Written 2026-09-03 against `dev` (v0.6.0). Basis: five code audits (timeline,
> viewport, sidebars + inspector, chrome + modals, design system + perf), the
> app running in a browser tab, and `docs/AE_COMPARISON.md`. Every "missing"
> claim below was checked by grep before it was written; every "present" item
> names the file that proves it, so nobody rebuilds what already exists.
>
> Goal stated by the owner: be *stronger than After Effects* not only in
> capability (already true in several columns) but in **speed of use, clarity,
> and feel**. Capability parity is covered elsewhere; this document is about the
> layer above the engine.


---

## Status — executed 2026-09-04/05

Everything below was implemented on `dev` (uncommitted at the time of writing)
by a batch of subagents working one area each, then integrated and verified:
`tsc --noEmit` clean, **1196 jest suites / 15,781 tests green**, `npm run lint`
0 errors (warning cap raised to the measured 620 after the new
`design-system/*` rules landed), no CRLF flips, and a browser smoke of the
start screen → new comp → draw → select flow. Items marked *deferred* are the
honest leftovers and why.

| Area | Shipped | Deferred (and why) |
|------|---------|--------------------|
| Perf root cause | `playbackClockStore` (§1 #1): time out of the immer store, 4 Hz mirror, `commitAllTimes()` on save; 10 per-frame selector sites migrated | `useShallow`/`React.memo` sweep done for the inspector and timeline rows, not yet tree-wide |
| Timeline (§3) | auto-follow + edge auto-scroll, `Shift+;` fit selection, navigator zoom window, keyframe context menu + value tooltip + drag HUD, arrow nudge (300 ms undo bursts), expand/collapse all, label colour bar, In/Out/Duration columns, snap toggle (`S`), interactive markers + lane, listbox keyboard nav, row-height drag + persist, lift/extract/ripple, property search, inline go-to-time, hover/pinned switches, sticky category headers, interpolation-coloured glyphs with hold tail, 24 px hit regions with narrow-clip precedence, graph editor numeric strip / marquee incl. tangents / Shift constrain / normalise, heat lane, transcript lane, tick/clip/keyframe culling, single drag overlay, memoised waveforms, lock guards; `Timeline.tsx` split 4733 → 2544 lines + 10 modules | Stretch column: no per-layer time-stretch API exists in the engine. Razor / transition / work-area / reorder sections stay in the composer (shared closures) |
| Viewport (§4) | shared JKL transport + audio scrub + in/out (comp and Source Monitor), snapshot / A-B / wipe / difference compare, camera bookmarks, snap-to-pixel, guide lock/clear commands, display modes (overlay-drawn), in-viewport HUD, overlay opacity, viewer LUT in the header, roto brush tool (`Alt+W`), tool shortcuts assigned + shown in tooltips, `ViewportHeader` strip, AI-chat canvas ref, inline AI prompt (`Ctrl+Enter`), probe → vectorscope marker, overlay a11y + tokens, composition `pixelAspect` + settings row | Renderer wireframe pass (needs its own index buffer, shader in both dialects and a PACKERS row); `useWorkspace.ts` only partly split (gesture/render/cache effect is one closure). Worker plan: measured `buildSnapshot` at 2.4 ms / 500 layers — **don't build the worker**; the real leads (`buildEnvSpecularAtlas` at 18 % CPU, now cached; a per-root cost in `buildSnapshot`) are in `docs/VIEWPORT_WORKER_PLAN.md` |
| Inspector (§6) | mixed-value multi-selection editing (relative scrub, per-node math, one undo per gesture), per-section subscriptions + memo + per-node revision, sticky selection header, Pinned tab (`__pinnedProps`), `=` expression toggle with autocomplete/error/pick-whip, keyframe lane per row, section presets, colour-management readout, modifier-stack chips, Effects sub-tab, `AppearanceSection`/`TrackMotionSection` split | — |
| Sidebar (§5) | asset grid/list with thumbnails and hover scrub, sort/tags/labels/filters, metadata drawer, Reveal in Explorer, Browse tab (folder tree, drag-import), virtualised Assets and Effects, effect hover previews, rail keyboard traversal, Layers panel filters, Library sections, file-type tokens | Scene-filter state is panel-local by choice (no store, no doc-count bump) |
| Chrome (§7) | `ProjectStatus` mounted, tab dirty dot, workspace switcher + comp name in the web top bar, `ResizeObserver` collapse, palette MRU + focus trap + `?` docs search, menubar a11y, native Electron menu generated from `menuModel.ts`, context-menu shortcut column, tool flyout a11y, status bar extracted + job tray, focus modes (`Tab` / `Shift+Tab`), Color workspace | — |
| Modals & feedback (§8–9) | floating/draggable/remembered dialogs, Enter-to-confirm, `DialogFooter`, inert stacking, docked Export panel, `jobs` slice + progress toasts (render / cache / transcribe / model download), autosave Files tab, What's New from `CHANGELOG.md`, start-screen search/sort/pin/templates, power tour, panel `?` help, version compare with wipe; first-run tour no longer fires behind the start screen | Plugin-install job emitter lives in `PluginHost` (not wired) |
| Design system (§10) | `--surface-0..3` contract, dark theme from the slate ramp, bar-scale unification, opacity/border/line-height/axis/file-type tokens, density tier, high-contrast theme + `prefers-contrast`, contrast test, focus ring on inputs, self-hosted IBM Plex, `lucide-react` removed, `t()` seam, primitives `Kbd` `Badge` `Chip` `Segmented` `Progress` `Toast` `Combobox` `Toolbar` `ContextMenu` `DataGrid` `DialogFooter` + `Tooltip.shortcut` + collapsible `SplitPane`, lint rules for hex and local button classes | The 279 local button classes / 553 inline styles are now *warned* (620 warnings), not yet migrated |
| Better-than-AE (§12) | modifier chips (1), inline AI prompt (2), effect/preset previews (3), shared transport (4), version compare (5), heat lane (6), inspector keyframe lane (7), focus modes (8), Color workspace + probe link (9), transcript lane (10) | — |

---

## 0. The one-paragraph diagnosis

The engine and the data model are ahead of the shell. The audits found a mature
token system, a first-class `ValueField`, a real keymap editor, a working
pop-out/docking system, an on-demand rAF render loop, and a spotlight
onboarding tour — all things most editors get wrong. What is holding the product
back is **density and feedback**: the timeline is not legible or fast with
hundreds of tracks, long jobs give no feedback outside their own panel, common
gestures (auto-follow playhead, JKL, zoom-to-selection, keyframe right-click,
multi-object editing) are absent, and the visual layer drifts because 279 local
button styles and 553 inline styles bypass the design system. Fixing those is
mostly *reach* and *polish* work, not engine work — the same shape as the
2026-09-02 pass.

---

## 1. Top 15 moves, ranked by leverage

| # | Move | Why it matters | Effort |
|---|------|----------------|--------|
| 1 | **Transient clock store** — move `time`/`frame` out of the immer `projectStore` (written 60×/s at `projectStore.ts:370-378`) into a non-immer store read via `subscribe`/refs. Convert the 10 per-frame selector sites. | Every playback frame currently allocates a new tab object and fans out re-renders. This is the single biggest perf lever in the UI. | M |
| 2 | **Playhead auto-follow + edge auto-scroll** in the timeline (zero hits for `followPlayhead`/`scrollIntoView` in `src/layout/Timeline`). | Long comps scroll off-screen during playback; drags past the panel edge never scroll. Table-stakes in every NLE. | S |
| 3 | **Multi-object mixed-value editing** in the inspector (`PropertiesPanel` reads `selected[0]` only; no `mixed`/`indeterminate` anywhere). | Selecting 3 layers and editing one is the biggest gap vs Figma/AE/Blender. | M |
| 4 | **Progress-bearing notifications + render-done toast** (`Notification` in `uiStore.ts:96` has no `progress`; `renderQueueStore.ts` notifies plugins only). | Renders, caching and transcription finish silently unless their panel is open. | S |
| 5 | **Timeline horizontal culling** — cull ruler ticks (`generateRulerTicks`, `Timeline.tsx:3813`, ~24k divs on a 10-min comp at max zoom), clips and keyframes to the visible time window. | The "not fast with hundreds of tracks" item on the roadmap is mostly this plus #6. | M |
| 6 | **Stop drag re-render storms** — `setClipPreviews([...])`, `kfPreview` new `Map`, `setSelectedKfIds` new `Set` per pointermove defeat `areRowPropsEqual` for every row; waveform paths recomputed per move (`Timeline.tsx:3546-3564`). Fix: preview layer rendered on one overlay, keyed diffs, memoised waveform paths. | Dragging a clip on a 200-track comp re-renders 200 rows per mouse move. | M |
| 7 | **`useShallow` + `React.memo` sweep** (zero `useShallow` in the repo; `React.memo` in 4 files; 76 inspector files with no memo boundary; `PropertiesPanel` re-renders every section on every scrub via `useSceneRevision`). | Systemic; makes every later feature cheaper. | M |
| 8 | **Kbd primitive + shortcut on every tooltip** (`Tooltip.tsx` takes only `label`; no `Kbd` component). | The fastest way to teach shortcuts is on hover. AE, Figma, Blender all do it. | S |
| 9 | **Keyframe right-click menu + value tooltip + arrow-nudge** (`Timeline.tsx` context menus are on rows only; keyframe `title` is time + ease only; keydown handles Delete/Cmd+A only). | Three small gaps that together make keyframe editing feel unfinished. | S |
| 10 | **Non-blocking, draggable, remembered dialogs** for Composition Settings, Keyframe Velocity, Smoother, Wiggler (no `draggable`/`resizable`/position persistence in `components/Modal`). Enter-to-confirm everywhere. | AE users move these dialogs aside and keep working. | M |
| 11 | **Replace 279 local `.button` classes and 553 inline styles** with `Button`/`IconButton` and CSS modules; self-host IBM Plex (render-blocking Google Fonts `@import` at `global.css:7`, fails offline). | Visual drift and a network dependency in a desktop app. | M (mechanical) |
| 12 | **JKL shuttle + audio scrub + in/out navigation** in the composition viewport (present only in the Source Monitor). | Reviewing a comp without JKL is slower than Premiere/Resolve. | S |
| 13 | **Snapshot / A-B / wipe compare** in the viewport (zero hits for `takeSnapshot`, `compareMode`, `splitView`). | Every colourist and animator uses before/after. | M |
| 14 | **Mount `ProjectStatus`** (built, zero importers) and add a dirty dot to comp tabs. | The desktop title bar shows no project name or save state. | XS |
| 15 | **First-run bug**: the tour auto-starts on shell mount (`onboardingStore.ts:onEditorMounted`) while the Start screen is still in front, so step 1 ("Draw something") points at a tool the user cannot reach. Gate `canAutoStart()` on the start screen being dismissed. | Observed live on a fresh profile. First impression. | XS |

---

## 2. Shell, layout structure and visual language

### What is there (keep)
- Dock icon rail on both sides, drag-to-reorder, per-panel rail menus, pop-out
  windows, saved workspaces (`DockPanel.tsx`, `workspaceManager.ts`).
- Two themes, accent colour, UI scale, density, reduced motion
  (`preferenceStore.ts`, `CustomizeDialog.tsx`).
- Command palette with prefix modes (`>` `@` `#` `:` `+` `*`) and resolved
  shortcuts (`CommandPalette.tsx`, `quickApply.ts`).

### Observed in the running app
- The whole UI reads **very dark and low-contrast**: panel backgrounds, borders
  and secondary text sit within a narrow luminance band, so panel edges and
  section boundaries are hard to see at a glance. Dark mode is authored in raw
  hex (`themes/dark.css`) rather than from the slate ramp that light mode uses,
  which is why the two themes do not share a contrast contract.
- Body text is ~11px at 1600px width; icons at 15px with 22px hit targets in the
  timeline. Dense is right for a pro tool, but the *secondary* text (labels,
  column heads, empty-state copy) drops below comfortable contrast.
- Preview and Export share the top bar centre, but the comp name, save state
  and workspace switcher are absent in the browser build and buried in Electron.
- The "Scene" panel is really a composition list plus layer tree, while the
  real viewport lives in `layout/Workspace`. Naming in the UI and in code
  disagree.

### Recommendations
1. **Three-level surface contrast contract.** Define `--surface-0/1/2/3`
   (app bg → panel → raised row → popover) with a guaranteed ΔL between levels,
   and author `dark.css` from the slate ramp exactly as `light.css` does.
   Remove the ramp break at `--color-slate-700` (`#3a3a3d`).
2. **Unify the bar scale.** `--space-toolbar-height: 40px`/`--space-statusbar-height: 24px`
   contradict `--bar-height-*` (36/22) defined 20 lines above in `spacing.css`.
   Keep one set.
3. **Text contrast floor.** Secondary and tertiary text tokens should pass
   WCAG AA (4.5:1) on `--surface-1`. Add a `cssTokens.test.ts` assertion for it
   the way icon sizes are already guarded by `sizeScaleGuard.test.ts`.
4. **Top bar composition.** Left: menu + tools + tool options. Centre: comp
   name / dirty state / workspace switcher (mount `ProjectStatus`). Right:
   Preview, Export, account. Replace the `window.innerWidth` breakpoints in
   `TopNav.tsx:325-330` with a `ResizeObserver` on the bar so collapse is driven
   by available width, not window width.
5. **Rename "Scene" panel → "Project"/"Layers"** in the UI (Assets is the bin,
   this is the outliner). Keep the code name if the churn is not worth it.
6. **Panel header consistency.** One `PanelHeader` with title, optional
   search, overflow menu, and pop-out/close — and *every* panel uses it.
7. **High-contrast theme** (there is none; `CustomizeDialog.tsx:525` mislabels
   light mode as high-contrast) driven by `prefers-contrast` plus a manual
   toggle. Cheap once (1) is done.

---

## 3. Timeline

Reference: `src/layout/Timeline/Timeline.tsx` (3839 lines),
`BottomTimeline.tsx`, `GraphEditor.tsx` (2038 lines), `useTimelineKeys.ts`.

### Present and good (do not rebuild)
Vertical virtualisation with overscan; row model memoised so playback does not
rebuild it; J/K keyframe nav, U/UU reveal, P/S/R/T/A reveal, B/N work area,
`[`/`]`, Alt-trim, ripple trim, razor/slip/slide/roll modes with HUD, clip and
keyframe snapping with coloured guide lines, marquee, Alt time-scale of a
keyframe selection, pick-whip parenting, inline rename, waveforms, transitions
as records, cache bars, vertical minimap, pop-out.

### Gaps (verified absent)

| Gap | Evidence | Fix |
|-----|----------|-----|
| Playhead auto-follow; drag edge auto-scroll | no `followPlayhead`/`scrollIntoView` | Follow modes: off / page / continuous. Auto-scroll when a drag is within 24px of an edge. |
| Zoom to selection; horizontal navigator with a draggable window | `timelineFitCommands.ts` has fit-comp and fit-work-area only; navigator is a progress fill by design (`BottomTimeline.tsx:405`) | `Shift+;` fit selection. Give the navigator a draggable/resizable window (Premiere/Resolve style). |
| Keyframe context menu | `onContextMenu` on rows/tracks only | Interpolation, Easy Ease, Hold, Velocity…, Rove, Copy/Paste, Delete. |
| Keyframe value tooltip and on-drag HUD | `title` is time + ease | Hover: `t=1:04 · 320.5 px`. Drag: time + delta + value HUD, same widget as slip/slide. |
| Arrow-key keyframe nudge | keydown handles Delete/Cmd+A | ←/→ 1 frame, Shift 10, Alt = value nudge. |
| Expand-all / collapse-all | zero hits | Alt+click disclosure = recursive; Ctrl+` collapses all. |
| Per-layer colour bar on the row | `--track-color` set on `.trackHeader` but never read by CSS | 3px left bar from label colour; tint clip bars by label too. |
| In / Out / Duration / Stretch columns | not in `TimelineModel.ts` | Add as toggleable columns; editable via `ValueField`. |
| Snap on/off toggle in the timeline | only hold-Alt | Magnet toggle in `TimelineTools`, `S` when timeline focused. |
| Interactive comp markers | rendered `aria-hidden`, no handlers (`Timeline.tsx:2734`) | Drag, double-click to edit, right-click delete, marker lane. |
| Vertical keyboard nav between rows | rows `role="option"` without listbox or Up/Down | Roving tabindex, Up/Down/Home/End, Shift for range. |
| Row-height persistence and drag-resize | `useState(28)` in `BottomTimeline` | Persist in `preferenceStore`; add drag handle between header and lanes. |
| Lift / extract / ripple delete from the row | `rippleDeleteLayer` exists on the controller, unreachable | Add to clip context menu and `Shift+Delete`. |
| Property search box inside the timeline | search field filters layers only | Filter props too; reveal matching rows expanded. |

### Legibility and density (the roadmap item)
- **Track header layout**: today 7 AE switches sit inline on every row. Show
  switches on hover / on a `⋯` toggle per row, keep only eye/solo/lock/name
  visible by default, and let the column block cycle (already exists via
  `cycleTimelineColumns`) stay as the power-user mode.
- **Category headers as sticky sub-headers** when scrolling inside an expanded
  layer, so "Transform" stays visible while its 8 rows scroll.
- **Breadcrumb for nested comps** already exists (focus path); add
  double-click-to-enter on precomp bars and `Esc`-to-exit to the same crumb.
- **Keyframe glyphs**: colour by interpolation (AE), plus a small tail glyph
  for hold; selection ring should be 2px, not fill change only.
- **Bigger hit areas without bigger visuals**: keyframes are 12×12 and trim
  handles 10px; a 2px-wide clip is entirely covered by its handles and cannot
  be moved. Use invisible 24px hit regions, and give the clip body precedence
  once it is narrower than 3 × handle width.
- **Go-to-time**: the timecode opens `customPrompt` (`BottomTimeline.tsx:264`).
  Replace with an inline `ValueField` that accepts `+10`, `1:04`, `320f`.

### Timeline performance (specifics)
1. Cull ruler ticks, clips and keyframes to `[scrollLeft/pps - margin, +width]`.
2. Render drag previews on a single overlay layer instead of mutating every
   row's props; diff `Set`/`Map` identities only when membership changes.
3. Memoise `waveformPath(clip, window, pps)` per clip; recompute only on
   zoom or source change.
4. `Minimap` effect has no dependency array (`Timeline.tsx:2849`): listeners
   re-bind every render.
5. `audioEngine.onChange → forceUpdate({})` on the whole panel
   (`Timeline.tsx:484`): subscribe per waveform row instead.
6. Hoist `TIMELINE_LEFT_OFFSET` out of the component body and replace the four
   bare `8` literals (`3716`, `3571`, `3649`, `2511`).
7. Fix the NUL literal at `GraphEditor.tsx:617` (`join('\0')` → `' '`)
   — the file is currently classified as binary by grep/ripgrep, so every
   repo-wide search silently skips it.
8. Split `Timeline.tsx` into header column, lanes, ruler stack, keyframe layer
   and drag controllers. 3839 lines in one file is the maintainability ceiling.
9. Lock is cosmetic: `track.locked` only draws the icon (`Timeline.tsx:3010`);
   clip/keyframe/reorder handlers start a drag that the controller refuses on
   release. Guard at pointerdown and show a lock cursor.

### Graph editor
- Value tooltips on hover, numeric fields for selected key (value, in/out
  speed, influence) in a small docked strip.
- Box-select tangents; Shift-drag constrains a handle to horizontal.
- Normalise view (fit all curves to the panel height) as a one-key command.

---

## 4. Viewport (main body)

Reference: `src/layout/Workspace/` (19k LOC; `useWorkspace.ts` is 3568 lines),
`TransportBar.tsx`, `ViewportTools.tsx`, `TopNav/ViewControls.tsx`.

### Present and good
On-demand rAF-coalesced rendering (`WorkspaceController.scheduleRender`),
frame-coalesced overlay reconcile, content-hash cache key, RAM + disk cache
with idle pump, adaptive resolution with hysteresis, DPI re-read on resize,
1/2/4-up with independent cameras, pixel probe (hover), zoom-to-selection,
isolation + ghosting (`focusStore`), view cube, smart guides with measurement,
per-guide lock in the engine, viewer LUT, on-canvas gradient editor, knife.

### Gaps (verified absent)

| Gap | Fix |
|-----|-----|
| JKL shuttle, audio scrub, go-to in/out in the comp viewport | Lift the Source Monitor's JKL (`SourceMonitorPanel.tsx`) into a shared transport controller used by both. |
| Snapshot / A-B / wipe compare | `F5` take snapshot, `F6` show; wipe slider and side-by-side modes; store as an image in the frame cache. |
| Camera bookmarks | Named viewpoints per comp, `Ctrl+1..9` to recall; persisted in the document. |
| Pixel-aspect-ratio correction toggle | Composition setting + viewport toggle. |
| Snap-to-pixel toggle | Rounds transform results during drag; badge in the tool options bar. |
| Guide lock / clear guides commands | Engine supports lock (`Guides.ts:22,83`); add View menu items. |
| Display modes (shaded / wireframe / bounding box) | Cheap in the render graph; big win for dense 3D. |
| In-viewport HUD (fps, frame ms, cache hit, resolution) | Toggle, top-left corner; `FpsMeter` exists in the status bar, move a copy here. |
| Overlay opacity control for guides/grid/gizmos | Slider in View Options. |
| Viewer LUT reachable only from Composition Settings (`CompositionSettingsDialog.tsx:71`) | Move to the Preview menu next to channel view. |
| Roto brush as a viewport tool | Algorithm exists (`core/tracking/rotoBrush.ts`), invoked only from the inspector. Add tool + stroke UI. |
| Tools with empty shortcuts (`builtin.ts` lines 1075, 1082, 1261, 1455, 1772, 1788, 1807, knife included) | Assign and show in tooltips. |

### Structure and discoverability
- The viewport toolbar is split across **three homes** (`TransportBar`,
  `ViewportTools`, `TopNav/ViewControls`), documented as intentional at
  `ViewportTools.tsx:1-24`, but discoverability suffers. Recommend one
  **viewport header strip** (view layout, channel, resolution, quality, LUT,
  HUD, compare, snapshot) and one **transport strip** below (transport, JKL,
  loop, in/out, timecode, zoom). Keep the Preview menu as the deep settings.
- Stale comments claim the Free/Fixed lock is in `ViewportTools`
  (`ViewportTools.tsx:10`, `TopNav.tsx:366`); it moved to
  `Tabs/EditorTabs.tsx:277`.
- AI chat preview thumbnail grabs `document.querySelector('canvas')`
  (`AiChatPanel.tsx:230`) — the first canvas in the DOM, which is wrong with
  scopes or 2/4-up mounted. Use the workspace's content canvas ref.

### Performance
- No `OffscreenCanvas`/render worker; snapshot building and scene walk are on
  the main thread. The blocker (fonts and DOM media in workers) is documented
  in `AE_COMPARISON.md` §3; the pragmatic step is moving *snapshot building*
  and *cache blits* to a worker while keeping the draw on the main thread.
- Split `useWorkspace.ts` into gesture routing, render loop, cache
  orchestration, context menu and probe modules.

### Accessibility
`AxisWidgetOverlay`, `BoneOverlay`, `Gizmo3dOverlay`, `PuppetOverlay`,
`SceneGeometryOverlay`, `SmartGuideOverlay`, `ViewportTools` have **zero**
`aria-*`/`role` attributes. Overlay handles need `role="button"`, `tabIndex`,
keyboard activation and arrow nudge. Axis colours (`#ff3b30/#34c759/#007aff`)
are hardcoded and not CVD-safe; route through `--color-axis-x/y/z` tokens with
a colour-blind preset.

---

## 5. Left sidebar (Scene / Assets / Effects / Templates / Plugins / AI)

### Present and good
Icon rail with drag-reorder and per-tab menus; Assets with nested folders,
directory import, drag payloads that work on both viewport and timeline,
Interpret Footage, Source Monitor; Effects with search, categories,
favourites, user presets, drag-to-layer; Templates with live animating cards
that pause off-screen; Plugins with consent sheets and key rotation.

### Gaps (verified absent)

| Gap | Fix |
|-----|-----|
| Asset grid / thumbnail view (thumbnails are generated and persisted in `assetStore.ts` but never shown per row) | List/grid toggle; thumbnails + duration badge; hover scrub on video thumbnails. |
| Sortable columns, tags, ratings, colour labels on assets | Sort by name/type/size/date/used; tag chips; "unused" filter. |
| Asset metadata panel (codec, fps, colour space, duration, usage) | Bottom drawer in Assets, like AE's footage header but always visible. |
| Reveal in Explorer/Finder (no `showItemInFolder` in `src/` or `electron/`) | One IPC call. |
| Virtualisation in Assets and Effects lists (`VirtualList` used only by `FontPicker`) | Adopt `VirtualList`. |
| Keyboard tab traversal on the rail (`role="tablist"` with roving tabindex but no arrow handler) | Left/Right/Home/End. |
| Layer tree (Scene panel) filters | Filter by kind, label colour, animated, with effects; `KIND_COLOR` in `ScenePanel.tsx:81` should come from tokens. |

### Structure
- **Assets** should become the project bin *and* the media browser: a
  "Browse" tab that lists a watched folder (like Premiere's Media Browser) so
  import is drag-from-disk without an OS dialog.
- **Effects** should show a small animated preview thumbnail per effect on
  hover (render the effect on a standard plate at 96×54, cache it). This is
  the single biggest discoverability win for 183 effects.
- **Library** and **Templates** overlap; merge into one "Library" with
  sections: Templates, Presets, Materials, Swatches, Ease library.

---

## 6. Right inspector (Properties, Effect Controls, Render Queue)

### Present and good
Category sub-tabs that only appear when populated; property search across
tabs with tab badges; `ValueField` with pointer-lock scrubbing, Shift/Alt
scaling, math expressions (`+15`, `*1.5`, `960/2`), full ARIA; `PropertyRow`
with stopwatch, keyframe navigator, reset; colour picker with history and
project swatches; effect stack with drag reorder, presets, copy/paste;
property menu with interpolation presets, bake, Essential Properties promotion.

### Gaps

| Gap | Fix |
|-----|-----|
| **Mixed-value multi-selection editing** (`PropertiesPanel` uses `selected[0]`) | Show `—` for mixed, apply edits to all, relative drag (`+Δ`) on mixed. Highest-value inspector item. |
| Inspector re-renders wholesale on every scrub (`useSceneRevision` at panel root; zero `React.memo` in 76 inspector files) | Subscribe per section; memo sections; `useShallow` selectors. |
| Property pinning / a panel listing a layer's own promoted properties | "Pinned" sub-tab; `Essential Properties` already stores the data. |
| Expression field affordances | Inline expression editor with error underline, `=` toggle on the value field, pick-whip from the field itself (PickWhip exists). |
| Keyframe strip in the inspector | A mini keyframe lane per row (Blender/Cavalry style) so you can see animation without opening the timeline. |
| Section presets | Save/apply a section's values (Transform preset, Text style preset). |
| Colour management readout | Show working space and display transform in the colour picker header. |

### Structure
- Sub-tabs (`Transform / Style / Layer / Animation`) are correct. Add a
  **sticky selection header** with layer name, kind icon, label colour, and
  quick toggles (visible, solo, lock, 3D, motion blur) so the timeline is not
  needed for the basics.
- Effect Controls and Properties should be one panel with a pinned **Effects**
  sub-tab, not two panels; AE's split is historical.
- Files to break up: `AppearanceSection.tsx` (46 KB), `TrackMotionSection.tsx`
  (38 KB), `EffectStack.tsx` (36 KB).

---

## 7. Top bar, menus, command palette

### Present and good
Nested app menu model with shortcut rendering and edition gating
(`menuModel.ts`), keymap editor with conflict detection
(`CustomizeDialog.tsx` ShortcutsTab, `shortcutOverrides.ts`), context menus
on layers, viewport, assets, effects, tabs, inspector rows, panel rails.

### Gaps

| Gap | Fix |
|-----|-----|
| Recent / frequent commands in the palette (no `recent` in `CommandPalette/`) | MRU boost + "Recent" section at the top when the query is empty. |
| Palette is not a real focus trap (hand-rolled portal) | Use Radix Dialog like `Modal` does. |
| `AppMenuBar` has no `role="menubar"`, no arrow-key nav, no `aria-expanded` (the inner `Menu` is fine) | Add roving focus and Left/Right between groups. |
| Electron native menu (`electron/main.ts:1116-1177`, ~15 items) is a drifting subset of `APP_MENU` (labels already differ) | Generate the native menu from `menuModel.ts` at startup. |
| `ContextMenuItem.shortcut` almost never populated | Resolve from the command registry automatically. |
| Tool flyout triggers have `title` but no `aria-label`/`aria-pressed` | Fix in `TopNav.tsx`; the Snap button (line 743) is the pattern. |
| Tool options bar mode colours hardcoded (`ToolOptionsBar.tsx:26-28`) | Tokens. |

### Structure
- Add a **workspace switcher** and **comp name** to the web build's top bar
  (currently Electron title bar only).
- Palette: add `?` prefix for help/docs search once docs are linked in-app.
- Show **shortcut hints in the empty palette state**, grouped by what the
  focused panel supports (needs the panel-focus model below).

---

## 8. Modals and popups

### Present and good
`Modal` is Radix Dialog (focus trap, scroll lock, Esc, titles); `modalStore`
stack; Export dialog with preview, presets and Add to Queue; Render Queue is a
dockable panel, not a modal.

### Gaps

| Gap | Fix |
|-----|-----|
| No draggable / non-blocking / remembered dialogs | `Modal` variants: `blocking` (default), `floating` (draggable, no scrim, remembers position/size per id). Use floating for Composition Settings, Keyframe Velocity, Smoother, Wiggler, Interpret Footage. |
| Enter-to-confirm only in `Dialogs.tsx` prompt | `Modal` handles Enter → primary action unless focus is in a textarea. |
| Footer order/spacing hand-rolled per dialog (`Dialogs.tsx` inline styles, `ExportDialog` own footer) | One `DialogFooter` component: secondary left, destructive left-aligned red, primary right. |
| `ModalHost` renders every stacked modal with competing focus traps | Only top-of-stack is interactive; lower ones `inert`. |
| `Modal.tsx:78` sets `aria-describedby={undefined}` unconditionally | Pass the description id when provided. |
| Export is modal-only | Keep the modal, add a docked "Export" panel variant that shares the same form so users can queue while working. |
| No "unsaved changes" dirty indicator in comp tabs | Dot in `EditorTabs.tsx`. |
| No autosave settings UI | Interval, keep-N, location; surface last autosave time in the status bar. |
| No in-app changelog / What's New | Show on first launch of a new version; feeds the auto-update flow. |

---

## 9. Feedback: notifications, status bar, start screen, onboarding

- **Toasts**: add `progress` (0–1 or indeterminate), `sticky`, and grouping to
  `Notification`; render a job tray in the status bar showing active jobs
  (render, cache, transcribe, model download). Emit on render done/failed from
  `renderQueueStore.ts` (today only plugins are told).
- **Status bar** content is inlined in `App.tsx:1608-1705` with imperative
  hover colour mutation; move into `StatusBar` modules and tokens.
- **Start screen** (`StartScreen.tsx`): add search, sort (recent/name), pin,
  a Templates row, and "Open folder". Hide the onboarding tour until the
  start screen is dismissed (bug in §1 item 15).
- **Onboarding**: the pointer + task tour is excellent. Add a second-run
  "power tour" (JKL, U/UU, `;`, quick apply `+`) triggered from Help.
- **Help links**: zero in `src/layout`. Add `?` on every panel header that
  opens the relevant `docs/*.md` section, and "Learn more" in error states.
- **Empty states** exist in 19 files — good; ensure each has one primary
  action (New comp, Import, Add effect).

---

## 10. Design system and component library

### Present and good
Eight token files in strict import order; 6 control heights; elevation
semantics (`--shadow-panel/popover/modal/floating`); motion tokens with a
spring reserved for direct manipulation; focus ring token; tabular numerals on
`[data-numeric]`; self-hosted Material Symbols sprite with a size guard test;
37 components including `ValueField`, `PickWhip`, virtualised `TreeView`.

### Fix list
1. **Adoption before invention**: 279 local `.button`/`.btn` classes in 46
   stylesheets, 553 inline `style={{}}` sites in 96 files, 2213 raw `px`
   literals (~29% of layout CSS untokenised). Lint rule: no `.button` classes
   outside `components/`, no hex outside `tokens/` and canvas overlays.
2. **Missing primitives**, in dependency order: `Kbd` → `Tooltip.shortcut` →
   `Badge/Chip` → `Segmented` → `Toast` (promote `NotificationHost`) →
   `Progress` → `Combobox` → `Toolbar` → `ContextMenu` primitive (promote
   `ContextMenuHost`) → `Resizable` with collapse-to-rail (the
   `--dock-rail-width` token already exists for it) → `DataGrid`.
3. **Token gaps**: opacity/disabled scale, border-width scale, line-height
   paired per size, `--surface-*` levels (§2), axis colours, label palette for
   asset file types (13 raw hexes at `panels.module.css:1361-1373`).
4. **Focus visibility**: `input/textarea/select` force `box-shadow: none
   !important` on `:focus-visible`, leaving a border shift only. Use the ring.
5. **Fonts**: self-host IBM Plex (drop the Google Fonts `@import`); remove
   the unused `lucide-react` dependency.
6. **i18n**: none. Decide now whether the product ships in one language; if
   not, start extracting strings from new code only, behind a `t()` that is a
   no-op today. Retrofitting ~58k lines later is expensive.
7. **Density as a token tier**, not two runtime-injected vars
   (`preferenceStore.ts:307-314`): `compact / default / comfortable` sets for
   control height, row height, font size.
8. **UI scale** uses non-standard `zoom` (`preferenceStore.ts:295`), which
   interacts with `getBoundingClientRect` in canvas hit-testing. Audit the
   timeline and viewport at 125%/150% or switch to `transform`-free rem scaling.

---

## 11. Performance programme (UI layer)

Ordered by measured impact potential. Profile before each; attach the profile
to the PR (per `ROADMAP.md`).

| Step | Where | Expected effect |
|------|-------|-----------------|
| Transient clock store | `projectStore.ts:370-378`; sites listed in the audit (`AxisWidgetOverlay`, `FocusPlaneOverlay`, `PreviewPanel`, `BounceSection`, `MotionEditorPanel`, `MotionPresetsPanel`, `MulticamViewer`, `PopoutTimeline`) | Removes 60 immer productions/s and their render fan-out. |
| `useShallow` + `React.memo` | all object-returning selectors; timeline rows, inspector sections, overlays | Systemic re-render cut. |
| Timeline culling + drag preview overlay | `Timeline.tsx` | Dense comps become interactive. |
| Inspector per-section subscription | `PropertiesPanel.tsx`, `InspectorContent.tsx` | Scrub no longer re-renders every section. |
| Split `Providers.tsx` (2826 lines, command registry in the boot path) and add panel-level `lazy()` | `providers/`, `panelRenderers.ts`, `vite.config.ts` manualChunks | Faster cold start; smaller editor chunk. |
| Virtualise Assets, Effects, EffectStack | `VirtualList` | Large bins stay smooth. |
| Snapshot building in a worker | `useViewportRenderer.ts`, `buildSnapshot` | Frees main thread during playback. |
| `sourcemap: true` in prod build | `vite.config.ts` | Smaller ship. |
| Self-hosted fonts | `global.css:7` | No render-blocking request; works offline. |

Add a **perf budget test** in `packages/render-tests` style: a synthetic
300-track / 5000-keyframe comp, measure scrub and drag frame times in
Playwright, ratchet like the render-test ceilings.

---

## 12. Capabilities that make it *better than AE*, not just equal

These are UX-shaped, build on what exists, and have no AE equivalent.

1. **Modifier stacks as a visible, reorderable UI** on every property (data
   already exists in `modifierStack.ts`); chips on the property row, drag to
   reorder, click to edit. Cavalry-class, AE has nothing.
2. **AI in the flow, not in a panel**: `Ctrl+Enter` on any selection opens an
   inline prompt anchored to the selection ("stagger these by 3f", "make this
   bounce"), using the existing 65 tools; preview transaction with Apply/Decline
   already exists (`useAiChat.ts`).
3. **Effect hover previews** rendered by the engine (§5) and **preset
   thumbnails** for animation presets.
4. **Live shared transport** between Source Monitor and comp (JKL, in/out) with
   a three-point edit HUD.
5. **Snapshot compare with the frame cache**, plus a **version compare**
   (`versionHistoryStore` exists) that wipes between two saved versions.
6. **A "what changed" heat lane** in the timeline: highlight clips and
   keyframes touched since the last save or by the last AI transaction.
7. **Inline keyframe lane in the inspector** (§6) so simple animation never
   needs the timeline.
8. **One-key focus modes**: `Tab` toggles the UI down to viewport + timeline;
   `Shift+Tab` viewport only. Uses the existing region collapse.
9. **Scopes docked next to the viewport** by default in a "Color" workspace,
   with a click-to-probe link between the pixel probe and the vectorscope.
10. **Transcript editing surfaced in the timeline** as a text lane, not only
    a panel.

---

## 13. Phasing

**Phase A — 1–2 weeks, no design debate** (items are small and verified):
first-run tour gating; mount `ProjectStatus` + tab dirty dot; playhead
auto-follow + edge auto-scroll; keyframe context menu, value tooltip, arrow
nudge; `Kbd` + tooltip shortcuts; progress toasts + render-done toast; JKL in
the comp viewport; Enter-to-confirm in dialogs; self-hosted fonts; remove
`lucide-react`; fix the NUL literal in `GraphEditor.tsx`; lock guard on drags;
`Minimap` effect deps; hoist `TIMELINE_LEFT_OFFSET`.

**Phase B — 3–5 weeks, performance + density**: transient clock store;
`useShallow`/memo sweep; timeline horizontal culling and drag overlay;
inspector per-section subscriptions; virtualise Assets/Effects; split
`Timeline.tsx`, `useWorkspace.ts`, `Providers.tsx`; perf budget test.

**Phase C — 4–6 weeks, interaction depth**: multi-object mixed editing;
floating/remembered dialogs + `DialogFooter`; snapshot/A-B compare; asset
grid + metadata + tags + sort; effect hover previews; timeline navigator
window, zoom-to-selection, In/Out/Duration columns, interactive markers;
viewport header strip consolidation; HUD; camera bookmarks.

**Phase D — design system consolidation** (can run in parallel, mechanical):
surface contrast contract and dark theme from the ramp; bar-scale unification;
button and inline-style migration with a lint rule; token gaps; density tier;
high-contrast theme; a11y pass on overlays and the menubar.

---

## Appendix A — verified present (do not rebuild)

Keymap editor · accent colour · UI scale · density · reduced motion · property
search · effect presets, favourites, reorder, copy/paste · colour history ·
project swatches · math expressions in value fields · pointer-lock scrubbing ·
pick-whip · asset folders · pop-out windows · workspace presets · command
palette with prefix modes and shortcut rendering · J/K keyframe nav · U/UU ·
razor/slip/slide/roll · clip + keyframe snapping · marquee · Alt time-scale ·
vertical minimap · pixel probe · zoom-to-selection (viewport) · isolation mode ·
view cube · smart guides with measurement · 1/2/4-up · viewer LUT · adaptive
resolution · onion skin · spotlight onboarding tour · empty states (19) ·
dockable render queue · Source Monitor JKL.

## Appendix B — file map for the work above

| Area | Files |
|------|-------|
| Timeline | `src/layout/Timeline/Timeline.tsx`, `GraphEditor.tsx`, `TimelineModel.ts`, `useTimelineKeys.ts`, `timelineFitCommands.ts`, `src/layout/BottomTimeline/BottomTimeline.tsx` |
| Viewport | `src/layout/Workspace/Workspace.tsx`, `useWorkspace.ts`, `useViewportRenderer.ts`, `TransportBar.tsx`, `ViewportTools.tsx`, `src/layout/TopNav/ViewControls.tsx`, `packages/workspace/src/tools/builtin.ts` |
| Inspector | `src/layout/EditorLayout/PropertiesPanel.tsx`, `src/layout/Inspector/*`, `src/core/inspector/inspectorSections.ts`, `src/components/ValueField`, `src/components/PropertyRow` |
| Sidebar | `src/components/DockPanel/DockPanel.tsx`, `src/layout/Assets/AssetsPanel.tsx`, `src/layout/Effects/EffectsPanel.tsx`, `src/layout/Scene/ScenePanel.tsx`, `src/layout/EditorLayout/panelDefs.ts` |
| Chrome | `src/layout/TitleBar/TitleBar.tsx`, `src/layout/TopNav/TopNav.tsx`, `src/layout/Menu/menuModel.ts`, `src/layout/CommandPalette/CommandPalette.tsx`, `src/layout/StatusBar/*`, `src/App.tsx:1608-1705`, `electron/main.ts:1116-1177` |
| Modals | `src/components/Modal/Modal.tsx`, `Dialogs.tsx`, `src/stores/modalStore.ts`, `src/layout/overlays/ModalHost.tsx`, `NotificationHost.tsx` |
| Feedback | `src/stores/uiStore.ts` (Notification), `src/stores/renderQueueStore.ts`, `src/layout/ProjectStatus/ProjectStatus.tsx`, `src/layout/Start/StartScreen.tsx`, `src/stores/onboardingStore.ts` |
| Design system | `src/tokens/*.css`, `src/themes/dark.css`, `light.css`, `src/styles/global.css`, `src/components/*`, `src/stores/preferenceStore.ts`, `src/layout/Settings/CustomizeDialog.tsx` |
| Perf | `src/stores/projectStore.ts:370-378`, `src/stores/compositionStore.ts:150-160`, `src/providers/Providers.tsx`, `vite.config.ts`, `src/workers/*` |
