/**
 * LayerPaintSurface — painting and Roto Brush in the Layer panel, where After
 * Effects does both.
 *
 * Active while the app's Paint, Eraser or Roto tool is (the toolbar, or the
 * Layer panel's own buttons); in any other mode it is not in the DOM, so the
 * mask editor underneath keeps the pointer.
 *
 *   • Paint / Eraser — drag to paint a stroke onto the layer (one undo step).
 *     Size, colour, opacity, hardness and Paint vs Clone come from the same
 *     Tool Options / Paint panel as the comp viewer. With Clone, Alt-click sets
 *     the source first.
 *   • Roto — paint over the subject (Alt: background); on release the whole
 *     stroke set is re-segmented into the layer's Roto Brush mask, exactly as
 *     the comp viewer's `RotoBrushOverlay` does — same store, same segmenter.
 *
 * Points need no conversion: the Layer panel shows the layer untransformed, so
 * the panel's fit (`maskEditing.screenToLocal`) is the whole mapping into the
 * layer's own centred space, which is what paint strokes and roto strokes are
 * stored in.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { addPaintStroke } from '@core/paint/paintStrokes';
import { isPaintableKind } from '@core/paint/paintCoords';
import { segmentStrokesToMask } from '@core/workspace/rotoBrushTool';
import { runDocumentEdit } from '@core/commands/documentEdit';
import { drawToolOptions } from '@motion/workspace';
import { assetIdOf } from '@core/source/sourceInfo';
import { useUIStore } from '@stores/uiStore';
import { useAssetStore } from '@stores/assetStore';
import { usePaintStore } from '@stores/paintStore';
import { useRotoBrushStore, type RotoStroke } from '@stores/rotoBrushStore';
import { bumpScene } from '@stores/sceneStore';
import { cn } from '@utils/cn';
import { appendPoint, paintStrokeFrom } from './layerPaint';
import { localToScreen, screenToLocal, type ViewFit } from './maskEditing';
import styles from './LayerViewer.module.css';

export interface LayerPaintSurfaceProps {
  nodeId: string;
  frameWidth: number;
  frameHeight: number;
  view: ViewFit;
  stageWidth: number;
  stageHeight: number;
  /** Comp time — where roto segments. */
  compTime: number;
}

type Pt = { x: number; y: number };

export function LayerPaintSurface({
  nodeId, frameWidth: w, frameHeight: h, view, stageWidth, stageHeight, compTime,
}: LayerPaintSurfaceProps): JSX.Element | null {
  const tool = useUIStore((s) => s.activeTool) as string;
  const painting = tool === 'paint' || tool === 'eraser';
  const roto = tool === 'roto';

  const svgRef = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<Pt[] | null>(null);
  const [cloneSource, setCloneSource] = useState<Pt | null>(null);
  const rotoDown = useRef(false);

  const rotoStrokes = useRotoBrushStore((s) => s.strokes);
  const rotoLive = useRotoBrushStore((s) => s.live);
  const rotoSize = useRotoBrushStore((s) => s.size);
  const rotoBusy = useRotoBrushStore((s) => s.busy);
  const rotoStatus = useRotoBrushStore((s) => s.status);

  // Roto strokes are in ONE layer's pixels — bind the store to this layer.
  useEffect(() => {
    if (roto) useRotoBrushStore.getState().setNode(nodeId);
  }, [roto, nodeId]);
  // A different layer has a different clone source.
  useEffect(() => { setCloneSource(null); }, [nodeId]);

  const node = defaultSceneGraph.getNode(nodeId);
  const paintable = !!node && isPaintableKind(node);
  const locked = node?.locked === true;
  // The segmenter cuts the layer's SOURCE pixels, so Roto needs footage — a
  // solid or a comp layer has nothing for it to read.
  const assetId = node ? assetIdOf(node) : null;
  const assetType = useAssetStore((s) => (assetId ? s.assets.find((a) => a.id === assetId)?.type : undefined));
  const rotoable = assetType === 'video' || assetType === 'image';

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current?.getBoundingClientRect();
    const [x, y] = screenToLocal(view, w, h, e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0));
    return { x, y };
  };
  const toScreen = (p: Pt): Pt => {
    const [x, y] = localToScreen(view, w, h, p.x, p.y);
    return { x, y };
  };

  const finishRoto = useCallback((): void => {
    if (!rotoDown.current) return;
    rotoDown.current = false;
    const store = useRotoBrushStore.getState();
    const done = store.end();
    if (!done) return;
    store.setBusy(true);
    store.setStatus('Segmenting…');
    void segmentStrokesToMask(nodeId, useRotoBrushStore.getState().strokes, compTime, {
      featherPx: store.featherPx,
      replacePathId: store.maskPathId,
    })
      .then((pathId) => {
        const s = useRotoBrushStore.getState();
        s.setMaskPathId(pathId);
        s.setStatus(pathId ? null : 'Nothing to segment there — paint over the subject.');
        bumpScene();
      })
      .catch((err: unknown) => {
        useRotoBrushStore.getState().setStatus(err instanceof Error ? err.message : 'Segmentation failed.');
      })
      .finally(() => useRotoBrushStore.getState().setBusy(false));
  }, [nodeId, compTime]);

  if (!painting && !roto) return null;

  const onDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0 || locked) return;
    e.preventDefault();
    e.stopPropagation();
    const p = local(e);
    if (painting) {
      if (!paintable) return;
      // Clone stamp aiming: Alt-click sets the source, paints nothing.
      if (e.altKey && usePaintStore.getState().mode === 'clone' && tool === 'paint') {
        setCloneSource(p);
        return;
      }
      svgRef.current?.setPointerCapture?.(e.pointerId);
      setLive([p]);
      return;
    }
    if (rotoBusy || !rotoable) return;
    svgRef.current?.setPointerCapture?.(e.pointerId);
    rotoDown.current = true;
    // Alt flips THIS stroke to background, as in the comp viewer.
    useRotoBrushStore.getState().begin(e.altKey ? 'bg' : 'fg', p);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (painting && live) {
      setLive(appendPoint(live, local(e)));
    } else if (roto && rotoDown.current) {
      useRotoBrushStore.getState().extend(local(e));
    }
  };
  const onUp = (): void => {
    if (painting && live) {
      const s = usePaintStore.getState();
      const stroke = paintStrokeFrom(live, {
        tool: tool as 'paint' | 'eraser',
        mode: s.mode,
        color: drawToolOptions.brushColor,
        size: drawToolOptions.brushSize,
        opacity: s.opacity,
        hardness: s.hardness,
        cloneSource,
      });
      setLive(null);
      if (stroke) {
        runDocumentEdit(stroke.mode === 'erase' ? 'Erase' : 'Paint Stroke', () => addPaintStroke(nodeId, stroke));
        bumpScene();
      }
      return;
    }
    if (roto) finishRoto();
  };

  const d = (pts: ReadonlyArray<Pt>): string =>
    pts.map((p, i) => {
      const s = toScreen(p);
      return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
    }).join(' ');

  const erasing = tool === 'eraser';
  const brushPx = Math.max(1, drawToolOptions.brushSize * view.scale);
  const rotoAll: RotoStroke[] = rotoLive ? [...rotoStrokes, rotoLive] : rotoStrokes;
  const message = painting
    ? (!paintable ? 'This layer cannot be painted on.' : locked ? 'This layer is locked.' : null)
    : !rotoable
      ? 'Roto Brush works on footage — open a video or image layer.'
      : locked ? 'This layer is locked.' : rotoStatus;
  const cloneMark = cloneSource ? toScreen(cloneSource) : null;

  return (
    <>
      <svg
        ref={svgRef}
        className={cn(styles.paintSurface)}
        width={stageWidth}
        height={stageHeight}
        aria-label={roto ? 'Roto Brush' : erasing ? 'Eraser' : 'Paint'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {painting && live && live.length > 0 ? (
          <path
            d={d(live)}
            className={cn(styles.paintLive, erasing && styles.paintLiveErase)}
            stroke={erasing ? undefined : drawToolOptions.brushColor}
            strokeWidth={brushPx}
            strokeOpacity={erasing ? undefined : usePaintStore.getState().opacity}
          />
        ) : null}
        {roto
          ? rotoAll.map((s) => (
              <g key={s.id}>
                <path className={styles.rotoHalo} d={d(s.points)} strokeWidth={rotoSize + 2} />
                <path className={s.kind === 'fg' ? styles.rotoFg : styles.rotoBg} d={d(s.points)} strokeWidth={rotoSize} />
              </g>
            ))
          : null}
        {cloneMark && painting ? (
          <g className={styles.cloneMark}>
            <circle cx={cloneMark.x} cy={cloneMark.y} r={6} />
            <line x1={cloneMark.x - 10} y1={cloneMark.y} x2={cloneMark.x + 10} y2={cloneMark.y} />
            <line x1={cloneMark.x} y1={cloneMark.y - 10} x2={cloneMark.x} y2={cloneMark.y + 10} />
          </g>
        ) : null}
      </svg>
      {message ? <div className={styles.paintStatus} role="status">{message}</div> : null}
    </>
  );
}

export default LayerPaintSurface;
