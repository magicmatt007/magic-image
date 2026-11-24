import Konva from 'konva';
import { coarsePointer, type Editor } from '../editor';
import { boxOf, type Vec } from '../shapes';
import type { Tool } from './types';

export interface CropTool extends Tool {
  apply(): void;
  cancel(): void;
}

/**
 * Drag over the image to choose the area to keep. The box can then be moved
 * or resized; dragging outside it draws a new one. Enter applies.
 */
export function cropTool(ed: Editor): CropTool {
  let rect: Konva.Rect | null = null;
  let tr: Konva.Transformer | null = null;
  let shade: Konva.Shape | null = null;
  let bar: HTMLDivElement | null = null;
  let sizeLabel: HTMLSpanElement | null = null;
  let applyBtn: HTMLButtonElement | null = null;
  let from: Vec | null = null;

  const clampPt = (p: Vec): Vec => ({
    x: Math.min(ed.width, Math.max(0, p.x)),
    y: Math.min(ed.height, Math.max(0, p.y)),
  });

  /** Fold transformer scaling into width/height and keep the box on the image. */
  function normalize() {
    if (!rect) return;
    let w = Math.abs(rect.width() * rect.scaleX());
    let h = Math.abs(rect.height() * rect.scaleY());
    let x = rect.x(), y = rect.y();
    w = Math.min(w, ed.width);
    h = Math.min(h, ed.height);
    x = Math.min(Math.max(0, x), ed.width - w);
    y = Math.min(Math.max(0, y), ed.height - h);
    rect.setAttrs({ x, y, width: w, height: h, scaleX: 1, scaleY: 1 });
    refresh();
  }

  const hasBox = () => !!rect && rect.visible() && rect.width() > 0 && rect.height() > 0;

  function refresh() {
    if (!rect) return;
    if (sizeLabel)
      sizeLabel.textContent = hasBox()
        ? `${Math.round(rect.width())} × ${Math.round(rect.height())}`
        : 'Drag over the image to choose the area to keep';
    if (applyBtn) applyBtn.disabled = !hasBox();
    tr?.forceUpdate();
    ed.uiLayer.batchDraw();
  }

  function setBox(b: { x: number; y: number; width: number; height: number }) {
    rect?.setAttrs({ ...b, scaleX: 1, scaleY: 1 });
    refresh();
  }

  function apply() {
    if (!rect || !hasBox()) return;
    const r = { x: rect.x(), y: rect.y(), width: rect.width(), height: rect.height() };
    ed.setTool('select');
    const whole = Math.round(r.x) === 0 && Math.round(r.y) === 0 &&
      Math.round(r.width) === ed.width && Math.round(r.height) === ed.height;
    if (!whole) ed.crop(r);
  }

  function cancel() {
    ed.setTool('select');
  }

  function button(label: string, title: string, cls: string, fn: () => void) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.className = cls;
    b.addEventListener('click', fn);
    return b;
  }

  return {
    cursor: 'crosshair',
    hint: 'Drag over the area to keep · adjust with the handles · Enter applies · Esc cancels',
    touchHint: 'Drag over the area to keep · adjust with the handles · then tap Apply',
    abortPress() {
      if (!from || !rect) return;
      from = null;
      rect.visible(false);
      setBox({ x: 0, y: 0, width: 0, height: 0 });
    },
    apply,
    cancel,
    activate() {
      if (!ed.base) return;
      shade = new Konva.Shape({
        listening: false,
        sceneFunc: (ctx) => {
          if (!rect || !hasBox()) return;
          const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
          c.save();
          c.fillStyle = 'rgba(0,0,0,0.55)';
          c.beginPath();
          c.rect(0, 0, ed.width, ed.height);
          c.rect(rect.x(), rect.y(), rect.width() * rect.scaleX(), rect.height() * rect.scaleY());
          c.fill('evenodd');
          c.restore();
        },
      });
      rect = new Konva.Rect({
        visible: false,
        stroke: '#ffffff',
        strokeWidth: 1.5,
        dash: [6, 4],
        strokeScaleEnabled: false,
        fill: 'rgba(0,0,0,0)',
        draggable: true,
      });
      tr = new Konva.Transformer({
        rotateEnabled: false,
        flipEnabled: false,
        keepRatio: false,
        ignoreStroke: true,
        borderEnabled: false,
        anchorSize: coarsePointer ? 22 : 11,
        anchorFill: '#7c3aed',
        anchorStroke: '#ffffff',
      });
      rect.on('dragmove transform', normalize);
      ed.uiLayer.add(shade, rect, tr);
      ed.uiLayer.batchDraw();

      bar = document.createElement('div');
      bar.className = 'crop-bar';
      sizeLabel = document.createElement('span');
      applyBtn = button('Apply', 'Apply crop (Enter)', 'primary', apply);
      bar.append(sizeLabel, applyBtn, button('Cancel', 'Cancel (Esc)', '', cancel));
      ed.container.parentElement!.appendChild(bar);
      refresh();
    },
    deactivate() {
      shade?.destroy();
      rect?.destroy();
      tr?.destroy();
      bar?.remove();
      shade = rect = tr = null;
      bar = sizeLabel = applyBtn = null;
      from = null;
      ed.uiLayer.batchDraw();
    },
    down(p) {
      if (!rect) return;
      from = clampPt(p);
      tr?.nodes([]);
      rect.visible(true);
      setBox({ ...from, width: 0, height: 0 });
    },
    move(p, e) {
      if (!from) return;
      setBox(boxOf(from, clampPt(p), e.evt.shiftKey));
    },
    up() {
      if (!from || !rect) return;
      from = null;
      if (rect.width() * ed.scale < 4 || rect.height() * ed.scale < 4) {
        rect.visible(false); // a plain click clears the box
        setBox({ x: 0, y: 0, width: 0, height: 0 });
        return;
      }
      normalize();
      tr?.nodes([rect]);
      refresh();
    },
    key(e) {
      if (e.key === 'Enter') {
        apply();
        return true;
      }
      if (e.key === 'Escape') {
        cancel();
        return true;
      }
      return false;
    },
  };
}
