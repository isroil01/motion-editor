# Changelog

Newest first. Each entry is what a person opening the app after an update
would want to know; the engine-level detail is in `ROADMAP.md`.

## 0.8.0 — 2026-09-10

- **3D lighting that behaves**: adding a light no longer shows a phantom
  second light — the automatic Ambient Fill is now an even lift across the
  frame, and its icon appears only while it is selected. New 3D layers answer
  lights and shadows out of the box; a light sitting between two layers no
  longer breaks shadow-map shadows; unticking Cast Shadows turns the shadow
  map off too; 3D solids cast shadows in both shadow modes.
- **Cameras you can direct**: Camera Options and Light Options in the
  timeline (Zoom, orbit, point of interest, depth of field, intensity, cone,
  shadow dials — stopwatch any of them from there); the View menu and every
  2-up / 4-up pane list each camera by name to look through;
  **Layer ▸ Camera ▸ Distribute Layers in Z** spreads layers in depth for
  instant parallax without changing the framing; a **Camera** preset folder
  (Push In, Pull Out, Orbit Sweep, Drift Parallax, Dolly Zoom, Handheld);
  Layer ▸ New ▸ Camera… / Light… open their option dialogs
  (Ctrl+Alt+Shift+C / L); new cameras and lights are numbered.
- **Effects on 3D layers**: glows, blurs, beams, light rays and lens flares
  are no longer clipped at a 3D layer's edge; Levels, Curves, Posterize,
  Exposure, Lumetri and the colour effects reach extruded shapes, 3D
  primitives and imported glTF models; gradient-filled extrusions grade their
  walls too.
- **Nested comps in 3D**: a composition placed as a layer renders its 3D
  through its own camera and lights — real depth, lighting and shadows —
  instead of a flat projection.
- **Deep Glow**: a physically based glow with a tight core and a long 1/r²
  tail, exposure, threshold, aspect, chromatic aberration and tint.
- **Energy Beam**: a Saber-style beam along a mask path, a text outline or a
  line — reveal, taper, distortion, flicker — with twenty presets
  (Lightsaber, Neon, Electric Arc, Plasma…); Lightning follows a mask path.
- **Particles v2 and Plexus**: sphere emitters, drag, size / opacity / colour
  ramps, sub-emission, velocity streaks and sprite sheets; Plexus draws
  point-and-line networks over a point cloud, a mask path or live particles.
- **More 3D**: height displacement from an image on extrusions, primitives
  and models; a second shadow-mapped light; Cryptomatte ID mattes from EXR in
  the Track Matte picker.
- **Tracking and masks**: Write-on and Vegas follow a mask path (a tracked
  mask moves the effect with the object); draw around an object to get a mask;
  the Object Matte neural model ships with the app and works out of the box;
  one-click tracking fixes, Parent to null, and mask tracks over 64 points.
- **Motion blur** is sized from how far a layer's silhouette travels, so
  spins, scale pops and card flips no longer strobe; per-layer Shutter Phase.
- **Also**: paste SVG straight from Illustrator; the render queue picks up
  where it stopped after a relaunch; 3D text extrusion gains gradient walls and
  face picking; the AI assistant's camera move is a real 3D camera.
- **Eighteen more After Effects effects** (201 in the browser, every one a
  GPU shader with a CPU reference, except the three lookup-table colour
  effects that render free on both backends):
  - *Simulation*: **CC Particle Systems II** — a point / ellipse emitter on the
    comp clock with Explosive, Direction Axis and Fountain physics, gravity,
    resistance, birth→death size and colour, Add or Normal compositing; and
    **CC Bubbles**, keyframed like Snowfall.
  - *Generate / Perspective*: **Fractal** (Mandelbrot and Julia, smooth
    escape colouring) and **3D Glasses** (red-cyan / red-green / red-blue /
    balanced anaglyph, stereo pair, interlace).
  - *Stylize*: **CC Kernel** (3×3 convolution), **CC Block Load** (progressive
    block loading) and **CC Threshold RGB**.
  - *Keying*: **Color Difference Key** and **CC Simple Wire Removal**.
  - *Colour*: **Broadcast Colors** (NTSC / PAL legaliser), **Noise HLS**,
    **CC Color Offset** and **Cineon Converter** (log ↔ linear for DPX/EXR).
  - *Distort / Transition*: **CC Tiler**, **CC Ripple Pulse**, **CC Radial
    ScaleWipe**, **CC Glass Wipe** and **CC Image Wipe**.
- **Twenty more effect presets** in the Effects & Presets panel (forty in
  all): Particle Sparks, Fountain, Rising Bubbles, Anaglyph 3D, Mandelbrot
  Backdrop, Julia Swirl, Sharpen / Edge Detect Kernel, Broadcast Safe, Log
  Footage Linearize, Psychedelic Offset, Three-Tone Threshold, Loading Blocks,
  Ripple Splash, Glass Reveal, Radial Collapse, Tile Wall, Green Screen
  Difference Key, HLS Film Grain and Wire Removal.

## 0.7.0 — 2026-09-06

- **Effects run on the GPU**: 177 of 183 effects now render as shaders — every
  keyer, distortion, transition, blur, noise, stylize, interior layer style,
  particle generator and the auto colour corrections. Video with effects or
  motion tracks plays at full speed instead of dropping to a per-frame CPU
  bake, and a "cpu fx" row in the viewport HUD shows the six that still bake
  (Vegas, Numbers, Timecode, Audio Spectrum, Audio Waveform, Lightning).
  Noise- and particle-based effects keep their controls and density but land
  in a different random arrangement than before.
- **Camera verbs** (Layer ▸ Camera): Create Orbit Null, Set / Link Focus
  Distance to a layer or to the point of interest, and Look at Selected / All
  under View ▸ Viewport ▸ 3D View. New lights bring an Ambient Fill so the
  unlit side of a 3D object is no longer black.
- **Layer ▸ Time**: reverse, freeze frame, time-remap enable, and stretch
  commands on the selected layers.
- **Smoother 3D handling**: dragging a 3D object, camera or light no longer
  shows the gizmo moving ahead of the object; the 3D Rotation and Orientation
  rows all edit their values.
- **Puppet**: tighter outline meshes on character cut-outs, bend pins that keep
  a rigid core and let the mesh solve the transition, and pins placed on a
  posed character land where you clicked.
- **Bug batch**: tracker overlay no longer reads as broken video, Character
  panel typography (case, small caps, super/subscript, scale, baseline,
  stroke) renders, one-sided keyframe navigators on every property row,
  Library duplicates removed, Media Browser file picking, channel views
  (R / G / B / Alpha) and the frame cache now agree, Lottie trim paths and
  animated SVG first frames import correctly, Preview panel controls work.
- **UX batch** (from `docs/UX_UI_IMPROVEMENT_PLAN.md`): design tokens with a
  density tier and high-contrast theme, native menus generated from one model,
  a docked Export panel, progress toasts with a job tray, mixed-value
  multi-select editing in the inspector, camera bookmarks, snapshot / wipe
  compare, timeline auto-follow, markers, lift / extract / ripple, and a
  faster playhead clock.

## 0.6.0 — 2026-09-03

- **Dialogs that get out of the way**: Composition Settings, Keyframe Velocity,
  the Smoother, the Wiggler and Interpret Footage are now floating tool windows —
  drag them by the title, keep working behind them, and they come back where you
  left them. Enter confirms any dialog.
- **Export as a panel**: Window ▸ Export docks the export form beside the
  inspector so you can queue renders without leaving the timeline.
- **Progress you can see**: renders, cache passes, transcription and model
  downloads show a progress toast and sit in the status-bar job tray, with
  "Reveal file" when a render lands.
- **Autosave settings** (Preferences ▸ Files): interval, how many snapshots to
  keep, an optional folder, and the last autosave time in the status bar.
- **Start screen**: search, sort by recent or name, pin projects, a Templates
  row, and Open folder… on the desktop.
- **Power-user tour** (Help ▸ Power-user tour): JKL, U / UU, `;` to fit, quick
  apply with `+`, and the command palette.
- **Help everywhere**: a `?` on every panel header opens the matching section of
  the docs; error screens and failed exports link to what to try next.
- **Version compare**: in Version History, "Compare with current" wipes between
  a saved version and the live composition at the playhead.

## 2026-09-02

- Source Monitor with in/out points, JKL shuttle and Insert / Overwrite / Add to
  end / New comp from range.
- Timeline edit tools as visible modes — Selection, Razor, Slip, Slide, Roll —
  with clip-edge snapping and Fit Composition / Fit Work Area.
- Per-cut transitions, Assemble from Footage, a Scopes panel, a Transcript panel
  with text-based editing, silence removal and ducking, chapters from markers.
- One graph editor with parametric stagger, modifier stacks, audio-reactive
  drivers, bake dynamics, the Smoother and the Wiggler as real dialogs.
- 3D: image skies and reflections, the full glTF PBR map set, curved primitives,
  a material editor, Composition Settings ▸ World, 3D IK.
- A knife tool, on-canvas gradient editor, smart guides, project swatches, an
  interactive onboarding tour, and Window ▸ Workspace.

## 2026-08-30

- A headless CLI (`premation render`) over the same deterministic pipeline.
- Data-driven batch rendering from CSV; captions in and out (`.srt` / `.vtt`)
  and generated from the composition's own audio.
- Auto-reframe to another aspect ratio; the pick-whip for parenting and
  expressions; a download-on-demand Object Matte model; idle caching of the
  whole work area.

## 2026-08-18

- The frame cache is keyed on scene content and survives undo and restart.
- Output-module templates; cloner cascade, push and path modes; physics rotation.

## 2026-08-17

- A named ease-curve library, a disk tier under the frame cache, onion skinning,
  text and colour Essential Properties, cloners with effectors, 2D rigid-body
  physics.
