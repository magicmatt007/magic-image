import type { Editor } from '../editor';

export interface MenuItem {
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Our own right-click menu over the picture. The browser's menu would offer
 * "Copy image" for whichever Konva canvas is under the pointer: that is the
 * transparent overlay holding the selection handles, so it copies an empty
 * picture. This menu copies/saves the real composed picture instead.
 */
export function setupContextMenu(target: HTMLElement, ed: Editor, items: () => MenuItem[]) {
  let menu: HTMLDivElement | null = null;

  const close = () => {
    menu?.remove();
    menu = null;
  };

  target.addEventListener('contextmenu', (e) => {
    if (!ed.base) return; // nothing to copy: leave the browser's menu alone
    e.preventDefault();
    close();
    menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.setAttribute('role', 'menu');
    for (const it of items()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = '<span></span><kbd></kbd>';
      b.firstElementChild!.textContent = it.label;
      b.lastElementChild!.textContent = it.hint ?? '';
      b.addEventListener('click', () => {
        close();
        it.run();
      });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(e.clientX, innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(e.clientY, innerHeight - height - 4))}px`;
    menu.querySelector('button')?.focus();
  });

  document.addEventListener('pointerdown', (e) => {
    if (menu && !menu.contains(e.target as Node)) close();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!menu) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = [...menu.querySelectorAll('button')];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus();
    }
  }, true);
  addEventListener('blur', close);
  addEventListener('resize', close);
  target.addEventListener('wheel', close, { passive: true });
}
