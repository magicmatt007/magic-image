import type { Editor } from '../editor';
import { SORT_MODES, type FileEntry, type FileSession, type SortMode } from '../files';
import { icon } from './icons';
import { ago, lazyThumbs, type ThumbImg } from './thumbs';

const SIZE_KEY = 'image-magic.gallery-size';
const MIN = 100, MAX = 320, DEFAULT = 180;

/** Heading for a date group: Today, Yesterday, This week, or the month. */
function dateGroup(t: number) {
  const d = new Date();
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (t >= today) return 'Today';
  if (t >= today - 86400e3) return 'Yesterday';
  if (t >= today - 6 * 86400e3) return 'This week';
  return new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Full-window grid of all the folder's images, for an overview of large
 * folders. Click an image to open it.
 */
export function buildGallery(ed: Editor, files: FileSession, onQueryChange: () => void) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };

  const dlg = el('dialog', 'gallery') as HTMLDialogElement;
  dlg.id = 'gallery';
  dlg.setAttribute('aria-label', 'Gallery');

  const head = el('div', 'gallery-head');
  const title = el('div', 'gallery-title');
  const count = el('span', 'gallery-count');
  const search = el('input', 'panel-search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search names…';
  search.setAttribute('aria-label', 'Search image names');
  search.spellcheck = false;
  const sortSel = el('select', 'panel-sort') as HTMLSelectElement;
  sortSel.setAttribute('aria-label', 'Sort order');
  for (const [value, label] of Object.entries(SORT_MODES)) {
    const o = el('option', '', label) as HTMLOptionElement;
    o.value = value;
    sortSel.append(o);
  }
  const sizeLabel = el('label', 'gallery-size');
  sizeLabel.title = 'Thumbnail size';
  const size = el('input') as HTMLInputElement;
  size.type = 'range';
  size.min = String(MIN);
  size.max = String(MAX);
  size.step = '10';
  size.setAttribute('aria-label', 'Thumbnail size');
  sizeLabel.append(el('span', '', 'Size'), size);
  const closeBtn = el('button', 'icon-btn');
  closeBtn.type = 'button';
  closeBtn.title = 'Close gallery (Esc)';
  closeBtn.setAttribute('aria-label', 'Close gallery');
  closeBtn.innerHTML = icon('close');
  closeBtn.addEventListener('click', () => dlg.close());
  const titleBox = el('div', 'gallery-titlebox');
  titleBox.append(title, count);
  head.append(titleBox, search, sortSel, sizeLabel, closeBtn);

  const body = el('div', 'gallery-body');
  const grid = el('div', 'gallery-grid');
  body.append(grid);
  dlg.append(head, body);
  document.body.append(dlg);

  const showThumb = lazyThumbs(body);

  // ---- size slider (remembered)
  let px = DEFAULT;
  try {
    const saved = Number(localStorage.getItem(SIZE_KEY));
    if (saved >= MIN && saved <= MAX) px = saved;
  } catch {
    /* ignore */
  }
  const applySize = () => {
    dlg.style.setProperty('--g', px + 'px');
    // Phones: the slider picks 3, 2 or 1 per row (pixel sizes barely differ there).
    dlg.style.setProperty('--cols', String(px < 160 ? 3 : px < 260 ? 2 : 1));
  };
  size.value = String(px);
  applySize();
  size.addEventListener('input', () => {
    px = Number(size.value);
    applySize();
    try {
      localStorage.setItem(SIZE_KEY, String(px));
    } catch {
      /* ignore */
    }
  });

  // ---- search + sort, shared with the side panel
  let typingTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => {
      files.setQuery(search.value.trim());
      render();
      onQueryChange();
    }, 80);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      // Esc first clears the search, then (next press) closes the gallery.
      e.preventDefault();
      search.value = '';
      files.setQuery('');
      render();
      onQueryChange();
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      const first = grid.querySelector<HTMLButtonElement>('.gallery-tile');
      if (first) {
        e.preventDefault();
        if (e.key === 'Enter') first.click();
        else first.focus();
      }
    }
  });
  sortSel.addEventListener('change', () => files.setSort(sortSel.value as SortMode));

  async function pick(e: FileEntry) {
    await files.openEntry(e);
    // Stay open if the switch was cancelled (unsaved changes) or failed.
    if (files.visible[files.currentIndex()] === e) dlg.close();
  }

  /** Arrow keys: left/right step through the list, up/down jump a row. */
  function move(tile: HTMLButtonElement, key: string) {
    const tiles = [...grid.querySelectorAll<HTMLButtonElement>('.gallery-tile')];
    const i = tiles.indexOf(tile);
    let target: HTMLButtonElement | undefined;
    if (key === 'ArrowRight') target = tiles[i + 1];
    else if (key === 'ArrowLeft') target = tiles[i - 1];
    else {
      const down = key === 'ArrowDown';
      const top = tile.offsetTop, left = tile.offsetLeft;
      const others = down ? tiles.slice(i + 1) : tiles.slice(0, i).reverse();
      const rowTop = others.find((t) => (down ? t.offsetTop > top : t.offsetTop < top))?.offsetTop;
      if (rowTop !== undefined) {
        const row = others.filter((t) => t.offsetTop === rowTop);
        target = row.reduce((a, b) => (Math.abs(b.offsetLeft - left) < Math.abs(a.offsetLeft - left) ? b : a));
      } else if (!down) {
        search.focus();
        return;
      }
    }
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    title.textContent = files.folderName ?? 'Folder';
    title.title = files.folderName ? `Folder: ${files.folderName}` : '';
    if (document.activeElement !== search && search.value.trim() !== files.query) search.value = files.query;
    sortSel.value = files.sort;
    const visible = files.visible;
    const total = files.entries.length;
    count.textContent = files.query ? `${visible.length} of ${total} images` : `${total} image${total === 1 ? '' : 's'}`;

    const focusedName = (document.activeElement as HTMLElement | null)?.dataset?.name;
    grid.replaceChildren();
    if (!visible.length) {
      grid.append(el('p', 'gallery-empty', files.query ? `No images match “${files.query}”.` : files.loading ? 'Reading folder…' : 'No images in this folder.'));
      return;
    }
    // Date headings only make sense when the list is in date order.
    const byDate = files.sort === 'modified-desc' || files.sort === 'modified-asc';
    const current = files.currentIndex();
    let group = '';
    visible.forEach((e, i) => {
      if (byDate) {
        const g = dateGroup(e.modified);
        if (g !== group) {
          group = g;
          grid.append(el('h3', 'gallery-group', g));
        }
      }
      const b = el('button', 'gallery-tile');
      b.type = 'button';
      b.title = e.name;
      b.dataset.name = e.name;
      if (i === current) {
        b.classList.add('current');
        b.setAttribute('aria-current', 'true');
      }
      const img = el('img') as ThumbImg;
      img.alt = '';
      img.loading = 'lazy';
      showThumb(img, e);
      const name = el('span', 'file-name', e.name);
      if (i === current && ed.dirty) name.prepend(el('span', 'dirty-dot', '●'));
      b.append(img, name, el('span', 'file-time', ago(e.modified)));
      b.addEventListener('click', () => pick(e));
      b.addEventListener('keydown', (ev) => {
        if (!ev.key.startsWith('Arrow')) return;
        ev.preventDefault();
        move(b, ev.key);
      });
      grid.append(b);
      if (focusedName === e.name) queueMicrotask(() => b.focus());
    });
  }

  files.onChange(() => {
    if (dlg.open) render();
  });
  dlg.addEventListener('close', () => clearTimeout(typingTimer));

  return {
    get isOpen() {
      return dlg.open;
    },
    open() {
      if (!files.folderName || (!files.entries.length && !files.loading) || dlg.open) return;
      render();
      dlg.showModal();
      const cur = grid.querySelector<HTMLButtonElement>('.gallery-tile.current');
      if (cur) {
        cur.scrollIntoView({ block: 'center' });
        cur.focus({ preventScroll: true });
      } else {
        body.scrollTop = 0;
        const first = grid.querySelector<HTMLButtonElement>('.gallery-tile');
        // Still loading: don't leave focus in the search box (phones would
        // pop up the keyboard).
        if (first) first.focus();
        else (document.activeElement as HTMLElement | null)?.blur();
      }
    },
    close() {
      dlg.close();
    },
  };
}
