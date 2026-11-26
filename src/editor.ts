import Konva from 'konva';
import { History, type Snapshot } from './history';
import { Style, type StyleKey } from './style';
import { applyStyle, calloutBox, calloutText, kindOf, readStyle, reviveNode, type Vec } from './shapes';
import { PointHandles } from './handles';
import { cropCanvas, extendCanvas, flipCanvas, newCanvas, pixelateCanvas, resizeCanvas, rotateCanvas } from './imageOps';
import { createTools, type ToolName, type Tools } from './tools';

/** Annotations on the clipboard (as text, so they also paste into another tab). */
interface AnnotationClip {
  app: typeof CLIP_APP;
  /** The picture they were copied from. */
  picture: string;
  /** Identifies this copy, to offset repeated pastes. */
  copy: string;
  nodes: object[];
  /** Pixels of pictures placed on top, as data URLs by image id. */
  images: Record<string, string>;
}
const CLIP_APP = 'magic-image/annotations';

function parseClip(text: string): AnnotationClip | null {
  if (!text.includes(CLIP_APP)) return null;
  try {
    const c = JSON.parse(text);
    return c?.app === CLIP_APP && Array.isArray(c.nodes) && c.nodes.length ? c : null;
  } catch {
    return null;
  }
}

/** Whether clipboard text holds annotations copied in this app. */
export const isAnnotationClip = (text: string) => !!parseClip(text);

function canvasFromUrl(url: string) {
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = newCanvas(img.naturalWidth, img.naturalHeight);
      c.getContext('2d')!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error('image could not be read'));
    img.src = url;
  });
}

function unionRect(rects: { x: number; y: number; width: number; height: number }[]) {
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((r) => r.x + r.width)), b = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: r - x, height: b - y };
}

/** Touch screens (phones, tablets): bigger handles and hit areas. */
export const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Owns the Konva stage. Content coordinates equal image pixels; zoom and pan
 * live on the stage transform, so exports are always at full resolution.
 */
export class Editor {
  readonly container: HTMLDivElement;
  readonly stage: Konva.Stage;
  readonly imageLayer = new Konva.Layer({ listening: false });
  readonly annoLayer = new Konva.Layer();
  readonly uiLayer = new Konva.Layer();
  readonly imageNode = new Konva.Image({
    image: undefined,
    shadowColor: '#000',
    shadowBlur: 18,
    shadowOpacity: 0.3,
  });
  readonly transformer: Konva.Transformer;
  readonly history: History;
  readonly style = new Style();
  readonly tools: Tools;

  base: HTMLCanvasElement | null = null;
  fileName = 'image';
  toolName: ToolName = 'arrow';
  /** The tool before the current one (the colour picker returns to it). */
  previousTool: ToolName = 'select';
  private handles!: PointHandles;
  panning = false;
  /** Keep the image fitted when the window resizes, until the user zooms or pans. */
  private autoFit = true;

  private drawing = false;
  /** Active touch points, for two-finger pinch zoom / pan. */
  private touches = new Map<number, Vec>();
  private gesture: { dist: number; center: Vec; scale: number; pos: Vec } | null = null;
  /** Pixelated copy of base + pasted pictures, for blur regions (see getPixelated). */
  private pix: { key: string; canvas: HTMLCanvasElement } | null = null;
  private baseIds = new WeakMap<HTMLCanvasElement, number>();
  private nextBaseId = 1;
  /** Pixels of pasted pictures, by id (kept for undo/redo for the whole session). */
  private imageStore = new Map<string, HTMLCanvasElement>();
  /** Changes with every picture opened, so a paste knows whether it came from this one. */
  private pictureId = '';
  /** How often each copied set was pasted into each picture (each paste lands a bit further). */
  private pasteCounts = new Map<string, number>();
  private listeners = new Set<() => void>();
  private dragOrigin = new Map<Konva.Node, Vec>();
  private commitTimer = 0;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.stage = new Konva.Stage({ container, width: container.clientWidth, height: container.clientHeight });
    this.imageLayer.add(this.imageNode);
    this.transformer = new Konva.Transformer({
      ignoreStroke: true,
      flipEnabled: false,
      padding: 4,
      anchorSize: coarsePointer ? 20 : 9,
      anchorCornerRadius: 2,
      anchorStroke: '#7c3aed',
      borderStroke: '#7c3aed',
      rotateAnchorOffset: coarsePointer ? 40 : 28,
    });
    this.uiLayer.add(this.transformer);
    this.stage.add(this.imageLayer, this.annoLayer, this.uiLayer);
    this.history = new History(this);
    this.tools = createTools(this);
    this.handles = new PointHandles(this);
    this.onChange(() => this.handles.sync());
    this.bindEvents();
    this.applyCursor();
    new ResizeObserver(() => {
      this.stage.size({ width: container.clientWidth, height: container.clientHeight });
      if (this.autoFit) this.fit();
    }).observe(container);
  }

  // ---------------------------------------------------------------- events

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  changed() {
    this.listeners.forEach((l) => l());
  }

  /**
   * Record the current state for undo. Pass the nodes that were just added,
   * moved or resized: if they stick out past the canvas, it grows to include
   * them (as part of the same undo step).
   */
  commit(changedNodes?: Konva.Node[]) {
    clearTimeout(this.commitTimer);
    this.commitTimer = 0;
    if (changedNodes?.length) this.growToFit(changedNodes);
    this.history.push();
    this.changed();
  }

  /** Debounced commit, for sliders and other rapid changes. */
  commitSoon() {
    clearTimeout(this.commitTimer);
    this.commitTimer = window.setTimeout(() => this.commit(), 400);
  }

  private flushCommit() {
    if (this.commitTimer) this.commit();
  }

  pointer(): Vec {
    return this.annoLayer.getRelativePointerPosition() ?? { x: 0, y: 0 };
  }

  private bindEvents() {
    const st = this.stage;
    this.bindTouchGestures();
    st.on('pointerdown', (e) => {
      if (!this.base || this.panning || this.gesture || e.evt.button !== 0 || !e.evt.isPrimary) return;
      if (e.target.getLayer() === this.uiLayer) return; // transformer / crop handles
      this.drawing = true;
      this.tool.down?.(this.pointer(), e);
    });
    st.on('pointermove', (e) => {
      if (!this.base || this.panning || this.gesture) return;
      this.tool.move?.(this.pointer(), e);
    });
    window.addEventListener('pointerup', (e) => {
      if (!this.drawing) return;
      this.drawing = false;
      this.tool.up?.(this.pointer(), e);
    });
    st.on('dblclick dbltap', (e) => {
      const n = this.topNode(e.target);
      const t = this.editableText(n);
      if (t && this.toolName !== 'text') this.tools.text.edit(t);
    });
    st.on('wheel', (e) => {
      e.evt.preventDefault();
      if (!this.base) return;
      const ev = e.evt;
      this.tools.text.finish();
      if (ev.ctrlKey || ev.metaKey) {
        const factor = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0025));
        this.zoomAt(this.scale * factor, st.getPointerPosition() ?? this.center());
      } else {
        const k = ev.deltaMode === 1 ? 20 : 1;
        const dx = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX;
        const dy = ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY;
        st.position({ x: st.x() - dx * k, y: st.y() - dy * k });
        this.autoFit = false;
        this.changed();
      }
    });
    st.on('dragmove', (e) => {
      if (e.target !== st) return; // stage pan only
      this.autoFit = false;
      this.changed();
    });

    // Moving several selected annotations together.
    this.annoLayer.on('dragstart', (e) => {
      const t = e.target;
      if (!this.selected().includes(t)) this.select([t]);
      this.dragOrigin.clear();
      for (const n of this.selected()) this.dragOrigin.set(n, n.position());
    });
    this.annoLayer.on('dragmove', (e) => {
      this.handles.sync();
      const t = e.target;
      const o = this.dragOrigin.get(t);
      if (!o) return;
      const dx = t.x() - o.x, dy = t.y() - o.y;
      for (const [n, p] of this.dragOrigin) if (n !== t) n.position({ x: p.x + dx, y: p.y + dy });
    });
    this.annoLayer.on('dragend', () => {
      if (!this.dragOrigin.size) return; // cancelled by a pinch
      const moved = [...this.dragOrigin.keys()];
      this.dragOrigin.clear();
      this.commit(moved);
    });
    this.transformer.on('transformend', () => this.commit(this.transformer.nodes()));
    this.transformer.on('transform', () => this.handles.sync());
  }

  /**
   * Two fingers: pinch to zoom and drag to pan. The second finger cancels
   * whatever the first one started (a shape being drawn, a drag).
   */
  private bindTouchGestures() {
    const el = this.container;
    const at = (e: PointerEvent): Vec => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const two = () => {
      const [a, b] = [...this.touches.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    // Capture phase: runs before Konva sees the second finger.
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch' || !this.base) return;
        this.touches.set(e.pointerId, at(e));
        if (this.touches.size !== 2) return;
        if (this.drawing) {
          this.drawing = false;
          this.tool.abortPress?.();
        }
        this.cancelDrags();
        if (this.transformer.isTransforming()) this.transformer.stopTransform();
        this.tools.text.finish();
        const g = two();
        this.gesture = { ...g, scale: this.scale, pos: this.stage.position() };
      },
      { capture: true },
    );
    el.addEventListener(
      'pointermove',
      (e) => {
        if (!this.touches.has(e.pointerId)) return;
        this.touches.set(e.pointerId, at(e));
        const g = this.gesture;
        if (!g || this.touches.size < 2) return;
        const now = two();
        const s = Math.min(16, Math.max(0.05, (g.scale * now.dist) / g.dist));
        // Keep the content point that was under the fingers' midpoint under it.
        const p = { x: (g.center.x - g.pos.x) / g.scale, y: (g.center.y - g.pos.y) / g.scale };
        this.stage.scale({ x: s, y: s });
        this.stage.position({ x: now.center.x - p.x * s, y: now.center.y - p.y * s });
        this.autoFit = false;
        this.updateHitWidths();
        this.changed();
      },
      { capture: true },
    );
    const end = (e: PointerEvent) => {
      if (!this.touches.delete(e.pointerId)) return;
      if (this.touches.size === 0) this.gesture = null;
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);

    // Konva starts drags (and transformer handle moves) from touch events, not
    // pointer events. While a pinch is going on, keep those away from Konva:
    // otherwise a finger resting on an annotation drags it along, against a
    // stage that is zooming underneath it, and the annotation lands far away.
    // The gesture lasts until the last finger is lifted.
    let blocking = false;
    const guard = (e: TouchEvent) => {
      if (this.gesture || e.touches.length > 1) blocking = true;
      if (!blocking) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (e.type === 'touchstart') this.cancelDrags();
      if (e.touches.length === 0) blocking = false;
    };
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
      el.addEventListener(type, guard as EventListener, { capture: true, passive: false });
  }

  /**
   * Drop every drag Konva has started or is about to start, putting dragged
   * annotations back where they were. Used when a second finger turns the
   * touch into a pinch.
   */
  private cancelDrags() {
    for (const [n, p] of this.dragOrigin) n.position(p);
    this.dragOrigin.clear();
    for (const [key, elem] of Konva.DD._dragElements) {
      if (elem.dragStatus === 'dragging') elem.node.stopDrag();
      Konva.DD._dragElements.delete(key);
    }
    this.annoLayer.batchDraw();
  }

  /**
   * Keep thin lines easy to hit: hit areas never get narrower than a finger
   * (or mouse) width on screen, whatever the zoom level.
   */
  updateHitWidths() {
    const minScreen = coarsePointer ? 32 : 14;
    const min = minScreen / this.scale;
    for (const n of this.annoLayer.getChildren()) {
      const kind = kindOf(n);
      if (kind === 'arrow' || kind === 'line' || kind === 'pen' || kind === 'rect' || kind === 'ellipse') {
        const sh = n as Konva.Shape;
        sh.hitStrokeWidth(Math.max(sh.strokeWidth() + 10, min));
      }
    }
  }

  /** The text to edit for an annotation: a text itself, or a callout's text. */
  editableText(n: Konva.Node | null): Konva.Text | null {
    if (n instanceof Konva.Text && kindOf(n) === 'text') return n;
    if (n && kindOf(n) === 'callout') return calloutText(n);
    return null;
  }

  /**
   * Colour of the picture (with annotations) at a content point, as #rrggbb,
   * or null outside the picture.
   */
  colorAt(p: Vec): string | null {
    const abs = this.stage.getAbsoluteTransform().point(p);
    const c = newCanvas(1, 1);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    for (const layer of [this.imageLayer, this.annoLayer]) {
      const part = layer.toCanvas({ x: Math.floor(abs.x), y: Math.floor(abs.y), width: 1, height: 1, pixelRatio: 1 });
      ctx.drawImage(part, 0, 0);
    }
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a < 128) return null;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  /** The annotation (direct child of the annotation layer) that contains `n`. */
  topNode(n: Konva.Node | null): Konva.Node | null {
    while (n && n.getParent() !== this.annoLayer) n = n.getParent();
    return n;
  }

  // ----------------------------------------------------------------- tools

  get tool() {
    return this.tools[this.toolName];
  }

  setTool(name: ToolName) {
    if (name === this.toolName) return;
    this.tool.deactivate?.();
    if (this.toolName !== 'pick') this.previousTool = this.toolName;
    this.toolName = name;
    // The colour picker keeps the selection, so the picked colour applies to it.
    if (name !== 'select' && name !== 'pick' && !(name === this.previousTool && this.selected().length)) this.select([]);
    this.updateDraggable();
    this.applyCursor();
    this.tool.activate?.();
    this.changed();
  }

  setPanning(on: boolean) {
    if (this.panning === on) return;
    this.panning = on;
    this.stage.draggable(on);
    this.updateDraggable();
    this.applyCursor();
  }

  private applyCursor() {
    this.container.style.cursor = this.panning ? 'grab' : this.tool.cursor;
  }

  updateDraggable() {
    const d = this.toolName === 'select' && !this.panning;
    this.annoLayer.getChildren().forEach((n) => n.draggable(d));
  }

  nextStepNumber() {
    let max = 0;
    this.annoLayer.find('.step').forEach((n) => (max = Math.max(max, Number(n.getAttr('stepNumber')) || 0)));
    return max + 1;
  }

  /** Add a freshly drawn annotation. */
  add(node: Konva.Group | Konva.Shape) {
    node.draggable(this.toolName === 'select');
    this.annoLayer.add(node);
    this.updateHitWidths();
  }

  // ------------------------------------------------------------- selection

  selected(): Konva.Node[] {
    return this.transformer.nodes();
  }

  select(nodes: Konva.Node[]) {
    this.transformer.nodes(nodes);
    const textLike =
      nodes.length > 0 &&
      nodes.every((n) => ['text', 'step', 'image', 'callout'].includes(kindOf(n)));
    // A single arrow or line is edited by its points (ends and bend) instead.
    const byPoints = nodes.length === 1 && PointHandles.replacesTransformer(nodes[0]);
    this.transformer.enabledAnchors(
      byPoints
        ? []
        : textLike
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          : ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'],
    );
    this.transformer.rotateEnabled(!byPoints);
    this.transformer.keepRatio(textLike);
    if (nodes.length === 1) this.style.load(readStyle(nodes[0]));
    this.uiLayer.batchDraw();
    this.changed();
  }

  applyStyleToSelection(key: StyleKey) {
    const sel = this.selected();
    if (!sel.length) return;
    sel.forEach((n) => applyStyle(n, key, this.style.state));
    this.updateHitWidths();
    this.transformer.forceUpdate();
    this.handles.sync();
    this.annoLayer.batchDraw();
    this.commitSoon();
  }

  deleteSelected() {
    const sel = this.selected();
    if (!sel.length) return;
    sel.forEach((n) => n.destroy());
    this.select([]);
    this.commit();
  }

  duplicateSelected() {
    const sel = this.selected();
    if (!sel.length) return;
    const offset = 16 / this.scale;
    let below = this.annoLayer.getChildren().filter((n) => kindOf(n) === 'image').length;
    const clones = sel.map((n) => {
      const c = n.clone({ x: n.x() + offset, y: n.y() + offset }) as Konva.Shape;
      reviveNode(this, c);
      this.annoLayer.add(c);
      // Pictures stay below arrows, text and other annotations.
      if (kindOf(c) === 'image') c.zIndex(below++);
      return c;
    });
    this.select(clones);
    this.commit(clones);
  }

  /**
   * The selected annotations as text for the clipboard (null if none).
   * Pictures placed on top carry their pixels, so they paste anywhere.
   */
  copySelected(): string | null {
    const sel = this.selected();
    if (!sel.length) return null;
    this.tools.text.finish();
    const images: Record<string, string> = {};
    for (const n of sel) {
      const id = n.getAttr('imageId');
      const c = kindOf(n) === 'image' && this.imageById(id);
      if (c) images[id] = c.toDataURL('image/png');
    }
    const clip: AnnotationClip = {
      app: CLIP_APP,
      picture: this.pictureId,
      copy: Math.random().toString(36).slice(2),
      // In stacking order, so the copies stack the same way.
      nodes: this.annoLayer.getChildren().filter((n) => sel.includes(n)).map((n) => n.toObject()),
      images,
    };
    return JSON.stringify(clip);
  }

  /**
   * Paste annotations copied with copySelected(). Into the same picture they
   * land a little offset (further with each paste), elsewhere where they were;
   * if that is outside the picture, in the middle of the view.
   */
  async pasteAnnotations(text: string) {
    const clip = parseClip(text);
    if (!clip || !this.base) return false;
    this.settle();
    if (this.toolName !== 'select') this.setTool('select');
    for (const [id, url] of Object.entries(clip.images)) {
      if (!this.imageById(id)) this.imageStore.set(id, await canvasFromUrl(url));
    }
    const same = clip.picture === this.pictureId;
    const key = `${clip.copy}|${this.pictureId}`;
    const count = this.pasteCounts.get(key) ?? 0;
    this.pasteCounts.set(key, count + 1);
    const step = (count + (same ? 1 : 0)) * (16 / this.scale);
    const nodes = clip.nodes.map((obj) => {
      const n = Konva.Node.create(obj) as Konva.Shape;
      reviveNode(this, n);
      n.position({ x: n.x() + step, y: n.y() + step });
      return n;
    });
    let below = this.annoLayer.getChildren().filter((n) => kindOf(n) === 'image').length;
    for (const n of nodes) {
      this.annoLayer.add(n);
      // Pictures stay below arrows, text and other annotations.
      if (kindOf(n) === 'image') n.zIndex(below++);
    }
    // Not visible in this picture at all: move them to the middle of the view.
    const box = unionRect(nodes.map((n) => n.getClientRect({ relativeTo: this.annoLayer, skipShadow: true })));
    if (box.x > this.width || box.y > this.height || box.x + box.width < 0 || box.y + box.height < 0) {
      const s = this.scale;
      const mid = { x: (this.stage.width() / 2 - this.stage.x()) / s, y: (this.stage.height() / 2 - this.stage.y()) / s };
      const dx = mid.x - (box.x + box.width / 2), dy = mid.y - (box.y + box.height / 2);
      for (const n of nodes) n.position({ x: n.x() + dx, y: n.y() + dy });
    }
    this.updateDraggable();
    this.updateHitWidths();
    this.select(nodes);
    this.commit(nodes);
    return true;
  }

  reorderSelected(toFront: boolean) {
    const sel = this.selected();
    if (!sel.length) return;
    sel.forEach((n) => (toFront ? n.moveToTop() : n.moveToBottom()));
    this.commit();
  }

  // ----------------------------------------------------------------- image

  get width() {
    return this.base?.width ?? 0;
  }

  get height() {
    return this.base?.height ?? 0;
  }

  /** Start editing a new picture. Undo history starts fresh and it counts as saved. */
  loadImage(canvas: HTMLCanvasElement, name?: string) {
    this.tools.text.finish();
    clearTimeout(this.commitTimer);
    this.commitTimer = 0;
    if (this.toolName === 'crop') this.setTool('select');
    this.select([]);
    this.annoLayer.destroyChildren();
    this.setBase(canvas);
    this.pictureId = Math.random().toString(36).slice(2);
    this.fileName = name?.replace(/\.[^.]+$/, '') || 'image';
    this.fit();
    this.history.reset();
    this.history.push();
    this.markSaved();
  }

  /** Close the picture: back to the empty start screen. */
  close() {
    this.tools.text.finish();
    clearTimeout(this.commitTimer);
    this.commitTimer = 0;
    if (this.toolName === 'crop') this.setTool('select');
    this.select([]);
    this.annoLayer.destroyChildren();
    this.base = null;
    this.imageNode.image(undefined);
    this.imageStore.clear();
    this.pix = null;
    this.history.reset();
    this.savedId = 0;
    this.imageLayer.batchDraw();
    this.annoLayer.batchDraw();
    this.changed();
  }

  private savedId = 0;

  /** True when there are edits since the image was opened or last saved. */
  get dirty() {
    return !!this.base && this.history.currentId !== this.savedId;
  }

  /** Commit pending text edits and debounced changes (call before save/switch). */
  settle() {
    this.tools.text.finish();
    this.flushCommit();
  }

  markSaved() {
    this.savedId = this.history.currentId;
    this.changed();
  }

  private setBase(c: HTMLCanvasElement) {
    this.base = c;
    this.imageNode.image(c);
    this.imageNode.size({ width: c.width, height: c.height });
    this.imageLayer.batchDraw();
    this.annoLayer.batchDraw();
    this.changed();
  }

  /**
   * Pixelated copy of the picture (base image plus pasted pictures), drawn by
   * blur regions. Recomputed only when the base or a pasted picture changes.
   */
  getPixelated(): HTMLCanvasElement | null {
    if (!this.base) return null;
    let bid = this.baseIds.get(this.base);
    if (!bid) {
      bid = this.nextBaseId++;
      this.baseIds.set(this.base, bid);
    }
    const imgs = this.annoLayer.getChildren().filter((n) => kindOf(n) === 'image') as Konva.Image[];
    const key =
      bid +
      '|' +
      imgs
        .map((n) => `${n.getAttr('imageId')}:${n.getTransform().getMatrix().map((v) => v.toFixed(2)).join(',')}:${n.width()}x${n.height()}`)
        .join(';');
    if (this.pix?.key !== key) {
      let src = this.base;
      if (imgs.length) {
        src = newCanvas(this.width, this.height);
        const ctx = src.getContext('2d')!;
        ctx.drawImage(this.base, 0, 0);
        for (const n of imgs) {
          const img = n.image();
          if (!img) continue;
          const m = n.getTransform().getMatrix();
          ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
          ctx.drawImage(img as CanvasImageSource, 0, 0, n.width(), n.height());
        }
      }
      this.pix = { key, canvas: pixelateCanvas(src) };
    }
    return this.pix.canvas;
  }

  imageById(id: string) {
    return this.imageStore.get(id);
  }

  /**
   * Add a picture on top of the current one (e.g. pasted from the clipboard),
   * at full resolution, centred in the visible area. Pasted pictures stay
   * above earlier ones but below arrows, text and other annotations.
   */
  insertImage(c: HTMLCanvasElement, cascade = 0) {
    if (!this.base) return;
    this.settle();
    if (this.toolName === 'crop') this.setTool('select');
    const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this.imageStore.set(id, c);
    const s = this.scale;
    const center = { x: (this.stage.width() / 2 - this.stage.x()) / s, y: (this.stage.height() / 2 - this.stage.y()) / s };
    const node = new Konva.Image({
      name: 'image',
      image: c,
      width: c.width,
      height: c.height,
      // Several at once are fanned out a little so they don't hide each other.
      x: Math.round(center.x - c.width / 2 + (cascade * 32) / s),
      y: Math.round(center.y - c.height / 2 + (cascade * 32) / s),
    });
    node.setAttr('imageId', id);
    const below = this.annoLayer.getChildren().filter((n) => kindOf(n) === 'image').length;
    this.annoLayer.add(node);
    node.zIndex(below);
    this.setTool('select');
    this.updateDraggable();
    this.commit([node]);
    this.select([node]);
  }

  /** Grow the canvas (white margin) so that `nodes` lie fully inside it. */
  private growToFit(nodes: Konva.Node[]) {
    if (!this.base) return;
    let minX = 0, minY = 0, maxX = this.width, maxY = this.height;
    for (const n of nodes) {
      if (!n.getParent()) continue; // destroyed
      const r = n.getClientRect({ relativeTo: this.annoLayer, skipShadow: true });
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    // Ignore sub-pixel overhangs (anti-aliasing, rounding).
    const l = minX < -0.5 ? Math.ceil(-minX) : 0;
    const t = minY < -0.5 ? Math.ceil(-minY) : 0;
    const r = maxX - this.width > 0.5 ? Math.ceil(maxX - this.width) : 0;
    const b = maxY - this.height > 0.5 ? Math.ceil(maxY - this.height) : 0;
    if (!l && !t && !r && !b) return;
    const next = extendCanvas(this.base, l, t, r, b);
    if (l || t) for (const n of this.annoLayer.getChildren()) n.position({ x: n.x() + l, y: n.y() + t });
    this.setBase(next);
    // Keep everything where it was on screen.
    const s = this.scale;
    this.stage.position({ x: this.stage.x() - l * s, y: this.stage.y() - t * s });
    this.transformer.forceUpdate();
  }

  /** Crop the canvas to the area covered by pictures and annotations. */
  fitToContent() {
    const kids = this.annoLayer.getChildren();
    if (!this.base || !kids.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of kids) {
      const r = n.getClientRect({ relativeTo: this.annoLayer, skipShadow: true });
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    const x = Math.max(0, Math.floor(minX)), y = Math.max(0, Math.floor(minY));
    this.crop({ x, y, width: Math.min(this.width, Math.ceil(maxX)) - x, height: Math.min(this.height, Math.ceil(maxY)) - y });
  }

  /**
   * Replace the base image and move annotations along with it.
   * `upright` keeps text and step badges unrotated/unmirrored (only moved).
   */
  private transformImage(next: HTMLCanvasElement, m: Konva.Transform, upright: boolean) {
    for (const n of this.annoLayer.getChildren()) {
      const kind = kindOf(n);
      if (upright && kind === 'callout') {
        // Keep the text upright: move the box, and send the tail to where its tip went.
        const tip = n.getTransform().point(n.getAttr('tail'));
        const { w, h } = calloutBox(n);
        const box = { x: w / 2, y: h / 2 };
        const c = n.getTransform().point(box);
        const nc = m.point(c);
        n.position({ x: n.x() + nc.x - c.x, y: n.y() + nc.y - c.y });
        n.setAttr('tail', n.getTransform().copy().invert().point(m.point(tip)));
      } else if (upright && (kind === 'text' || kind === 'step')) {
        const r = n.getClientRect({ relativeTo: this.annoLayer });
        const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        const nc = m.point(c);
        n.position({ x: n.x() + nc.x - c.x, y: n.y() + nc.y - c.y });
      } else {
        n.setAttrs(m.copy().multiply(n.getTransform()).decompose());
      }
    }
    this.setBase(next);
    this.select([]);
    this.fit();
    this.commit();
  }

  private beforeImageOp() {
    this.tools.text.finish();
    this.flushCommit();
    if (this.toolName === 'crop') this.setTool('select');
    return !!this.base;
  }

  rotate(clockwise: boolean) {
    if (!this.beforeImageOp()) return;
    const { width: w, height: h } = this;
    const m = clockwise
      ? new Konva.Transform().translate(h, 0).rotate(Math.PI / 2)
      : new Konva.Transform().translate(0, w).rotate(-Math.PI / 2);
    this.transformImage(rotateCanvas(this.base!, clockwise), m, true);
  }

  flip(horizontal: boolean) {
    if (!this.beforeImageOp()) return;
    const m = horizontal
      ? new Konva.Transform().translate(this.width, 0).scale(-1, 1)
      : new Konva.Transform().translate(0, this.height).scale(1, -1);
    this.transformImage(flipCanvas(this.base!, horizontal), m, true);
  }

  crop(r: { x: number; y: number; width: number; height: number }) {
    if (!this.beforeImageOp()) return;
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    const width = Math.min(this.width - x, Math.round(r.width));
    const height = Math.min(this.height - y, Math.round(r.height));
    if (width < 1 || height < 1) return;
    this.transformImage(cropCanvas(this.base!, { x, y, width, height }), new Konva.Transform().translate(-x, -y), false);
  }

  resize(w: number, h: number) {
    if (!this.beforeImageOp()) return;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.width && h === this.height) return;
    const m = new Konva.Transform().scale(w / this.width, h / this.height);
    this.transformImage(resizeCanvas(this.base!, w, h), m, false);
  }

  // ------------------------------------------------------------ undo state

  snapshot(): Omit<Snapshot, 'id'> {
    return { base: this.base, anno: JSON.stringify(this.annoLayer.getChildren().map((n) => n.toObject())) };
  }

  restore(s: Snapshot) {
    this.tools.text.finish();
    if (this.toolName === 'crop') this.setTool('select');
    const sizeChanged = !this.base || !s.base || this.base.width !== s.base.width || this.base.height !== s.base.height;
    this.select([]);
    this.annoLayer.destroyChildren();
    for (const obj of JSON.parse(s.anno)) {
      const n = Konva.Node.create(obj) as Konva.Shape;
      reviveNode(this, n);
      this.annoLayer.add(n);
    }
    if (s.base) this.setBase(s.base);
    this.updateDraggable();
    this.updateHitWidths();
    if (sizeChanged) this.fit();
    this.annoLayer.batchDraw();
    this.changed();
  }

  undo() {
    this.tools.text.finish();
    this.flushCommit();
    this.history.undo();
  }

  redo() {
    this.tools.text.finish();
    this.flushCommit();
    this.history.redo();
  }

  // ------------------------------------------------------------------ view

  get scale() {
    return this.stage.scaleX();
  }

  center(): Vec {
    return { x: this.stage.width() / 2, y: this.stage.height() / 2 };
  }

  zoomAt(scale: number, at: Vec) {
    const s = Math.min(16, Math.max(0.05, scale));
    const old = this.scale;
    const pt = { x: (at.x - this.stage.x()) / old, y: (at.y - this.stage.y()) / old };
    this.stage.scale({ x: s, y: s });
    this.stage.position({ x: at.x - pt.x * s, y: at.y - pt.y * s });
    this.autoFit = false;
    this.updateHitWidths();
    this.changed();
  }

  zoomBy(factor: number) {
    this.tools.text.finish();
    this.zoomAt(this.scale * factor, this.center());
  }

  /** Fit the whole image in the window (never enlarging beyond 100%). */
  fit() {
    if (!this.base) return;
    const cw = this.stage.width(), ch = this.stage.height();
    if (!cw || !ch) return;
    const pad = 32;
    const s = Math.max(0.02, Math.min((cw - pad * 2) / this.width, (ch - pad * 2) / this.height, 1));
    this.stage.scale({ x: s, y: s });
    this.stage.position({ x: (cw - this.width * s) / 2, y: (ch - this.height * s) / 2 });
    this.autoFit = true;
    this.updateHitWidths();
    this.changed();
  }

  actualSize() {
    this.zoomAt(1, this.center());
  }

  // ---------------------------------------------------------------- export

  /** The image with all annotations, at original resolution. */
  exportCanvas(): HTMLCanvasElement {
    this.tools.text.finish();
    const st = this.stage;
    const scale = st.scale(), pos = st.position();
    this.uiLayer.visible(false);
    this.imageNode.shadowEnabled(false);
    st.scale({ x: 1, y: 1 });
    st.position({ x: 0, y: 0 });
    const out = st.toCanvas({ x: 0, y: 0, width: this.width, height: this.height, pixelRatio: 1 });
    st.scale(scale);
    st.position(pos);
    this.imageNode.shadowEnabled(true);
    this.uiLayer.visible(true);
    st.batchDraw();
    return out;
  }
}
