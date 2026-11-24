import Konva from 'konva';
import { coarsePointer, type Editor } from './editor';
import { calloutBox, calloutMinWidth, calloutText, kindOf, layoutCallout, type Vec } from './shapes';

/** A draggable point on an annotation, in the annotation's own coordinates. */
interface Point {
  get(): Vec;
  set(v: Vec): void;
  /** Called on release (e.g. to straighten a nearly straight arrow). */
  done?(): void;
  style?: 'end' | 'bend';
  /** Shown only while this returns true (e.g. while there's room on screen). */
  shown?(): boolean;
}

/**
 * Round handles for the points of a single selected arrow or line (both ends,
 * plus a middle one to bend it) or callout (four box corners that resize the
 * box, and the tip of the tail).
 */
export class PointHandles {
  private nodes: Konva.Circle[] = [];
  private target: Konva.Node | null = null;
  private points: Point[] = [];

  constructor(private ed: Editor) {}

  /** Does this kind of annotation get point handles instead of resize handles? */
  static replacesTransformer(n: Konva.Node) {
    const k = kindOf(n);
    return k === 'arrow' || k === 'line' || k === 'callout';
  }

  /** Re-read the selection and put the handles where they belong. */
  sync() {
    const sel = this.ed.selected();
    const n = sel.length === 1 ? sel[0] : null;
    const pts = n ? pointsOf(n, this.ed) : [];
    if (n !== this.target || pts.length !== this.points.length) this.rebuild(n, pts);
    this.place();
  }

  private rebuild(n: Konva.Node | null, pts: Point[]) {
    this.nodes.forEach((c) => c.destroy());
    this.nodes = [];
    this.target = n;
    this.points = pts;
    if (!n) return;
    const r = coarsePointer ? 13 : 7;
    pts.forEach((pt, i) => {
      const c = new Konva.Circle({
        radius: r,
        fill: pt.style === 'bend' ? '#7c3aed' : '#ffffff',
        stroke: '#7c3aed',
        strokeWidth: 2,
        hitStrokeWidth: coarsePointer ? 20 : 8,
        draggable: true,
        name: 'point-handle',
      });
      c.on('mousedown touchstart pointerdown', (e) => (e.cancelBubble = true));
      c.on('dragmove', () => {
        const local = n.getTransform().copy().invert().point(c.position());
        this.points[i].set(local);
        this.ed.annoLayer.batchDraw();
        this.ed.transformer.forceUpdate();
        this.place(c);
      });
      c.on('dragend', () => {
        this.points[i].done?.();
        this.ed.commit([n]);
        this.sync();
      });
      this.ed.uiLayer.add(c);
      this.nodes.push(c);
    });
  }

  /** Position (and keep a constant on-screen size for) every handle except `skip`. */
  private place(skip?: Konva.Circle) {
    const n = this.target;
    if (!n) return;
    const m = n.getTransform();
    const s = 1 / this.ed.scale;
    this.nodes.forEach((c, i) => {
      c.scale({ x: s, y: s });
      if (c !== skip) c.position(m.point(this.points[i].get()));
      c.visible(this.ed.toolName === 'select' && (this.points[i].shown?.() ?? true));
    });
    this.ed.uiLayer.batchDraw();
  }
}

function pointsOf(n: Konva.Node, ed: Editor): Point[] {
  const kind = kindOf(n);
  if (kind === 'callout') {
    const corner = (right: boolean, bottom: boolean): Point => ({
      get: () => {
        const { w, h } = calloutBox(n);
        return { x: right ? w : 0, y: bottom ? h : 0 };
      },
      set: (v) => {
        // The opposite corner stays put; moving the left/top edge moves the
        // group, so the tail is shifted back to keep its tip on the same spot.
        const t = calloutText(n);
        const { w, h } = calloutBox(n);
        const minW = calloutMinWidth(n);
        const nw = Math.max(minW, right ? v.x : w - v.x);
        const dx = right ? 0 : w - nw;
        t.width(nw);
        n.setAttr('boxH', 0);
        const textH = calloutBox(n).h;
        const nh = Math.max(textH, bottom ? v.y : h - v.y);
        const dy = bottom ? 0 : h - nh;
        n.setAttr('boxH', nh > textH + 0.5 ? nh : undefined);
        if (dx || dy) {
          n.position(n.getTransform().point({ x: dx, y: dy }));
          const tail: Vec = n.getAttr('tail') ?? { x: 0, y: 0 };
          n.setAttr('tail', { x: tail.x - dx, y: tail.y - dy });
        }
        layoutCallout(n);
      },
      style: 'end',
      // On a box too small on screen, four handles would cover it: keep only
      // the bottom-right one, which still resizes it.
      shown: () => {
        if (right && bottom) return true;
        const { w, h } = calloutBox(n);
        const room = (coarsePointer ? 13 : 7) * 6;
        return w * ed.scale >= room && h * ed.scale >= room * 0.6;
      },
    });
    return [
      corner(false, false),
      corner(true, false),
      corner(false, true),
      corner(true, true),
      { get: () => n.getAttr('tail') ?? { x: 0, y: 0 }, set: (v) => n.setAttr('tail', v), style: 'bend' },
    ];
  }
  if (kind !== 'arrow' && kind !== 'line') return [];
  const l = n as Konva.Line;
  const pts = () => l.points();
  const last = () => pts().length - 2;
  const at = (i: number): Vec => ({ x: pts()[i], y: pts()[i + 1] });
  const write = (i: number, v: Vec) => {
    const p = pts().slice();
    p[i] = v.x;
    p[i + 1] = v.y;
    l.points(p);
  };
  return [
    { get: () => at(0), set: (v) => write(0, v), style: 'end' },
    {
      // Middle point: dragging it bends the line into a curve through it.
      get: () => {
        if (pts().length >= 6) return at(2);
        const a = at(0), b = at(last());
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      },
      set: (v) => {
        const a = at(0), b = at(last());
        l.points([a.x, a.y, v.x, v.y, b.x, b.y]);
        l.tension(0.5);
      },
      done: () => {
        // Barely bent: snap back to a straight line.
        if (pts().length < 6) return;
        const a = at(0), m = at(2), b = at(4);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const off = Math.abs((b.x - a.x) * (a.y - m.y) - (a.x - m.x) * (b.y - a.y)) / len;
        if (off * ed.scale < 8) {
          l.points([a.x, a.y, b.x, b.y]);
          l.tension(0);
        }
      },
      style: 'bend',
    },
    { get: () => at(last()), set: (v) => write(last(), v), style: 'end' },
  ];
}
