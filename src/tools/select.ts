import Konva from 'konva';
import type { Editor } from '../editor';
import { boxOf, type Vec } from '../shapes';
import type { Tool } from './types';

/** Click / Shift+click to select, drag on empty space for a selection box. */
export function selectTool(ed: Editor): Tool {
  let marquee: Konva.Rect | null = null;
  let start: Vec = { x: 0, y: 0 };
  let additive = false;
  return {
    cursor: 'default',
    hint: 'Click to select · Shift+click adds · drag empty space to box-select · Del deletes · double-click text to edit',
    touchHint: 'Tap to select, drag to move · drag empty space to select several · double-tap text to edit',
    abortPress() {
      marquee?.destroy();
      marquee = null;
      ed.uiLayer.batchDraw();
    },
    deactivate() {
      marquee?.destroy();
      marquee = null;
    },
    down(p, e) {
      const n = ed.topNode(e.target);
      const sel = ed.selected();
      additive = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
      if (n) {
        if (additive) ed.select(sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n]);
        else if (!sel.includes(n)) ed.select([n]);
        return;
      }
      if (!additive) ed.select([]);
      start = p;
      marquee = new Konva.Rect({
        fill: 'rgba(124,58,237,0.12)',
        stroke: '#7c3aed',
        strokeWidth: 1,
        strokeScaleEnabled: false,
        listening: false,
      });
      ed.uiLayer.add(marquee);
    },
    move(p) {
      if (!marquee) return;
      marquee.setAttrs(boxOf(start, p));
      ed.uiLayer.batchDraw();
    },
    up(p) {
      if (!marquee) return;
      marquee.destroy();
      marquee = null;
      ed.uiLayer.batchDraw();
      const box = boxOf(start, p);
      if ((box.width + box.height) * ed.scale < 4) return;
      const hits = ed.annoLayer
        .getChildren()
        .filter((n) => Konva.Util.haveIntersection(box, n.getClientRect({ relativeTo: ed.annoLayer })));
      ed.select(additive ? [...new Set([...ed.selected(), ...hits])] : hits);
    },
  };
}
