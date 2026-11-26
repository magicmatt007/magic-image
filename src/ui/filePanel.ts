import type { Editor } from '../editor';
import { SORT_MODES, type FileSession, type SortMode } from '../files';
import { icon } from './icons';
import { ago, lazyThumbs, type ThumbImg } from './thumbs';

const STORAGE_KEY = 'image-magic.panel';

/** Side panel listing the images of the opened folder. */
export function buildFilePanel(panel: HTMLElement, ed: Editor, files: FileSession, openGallery: () => void) {
  // On narrow screens the panel covers the image, so it starts closed and
  // closes again after picking an image.
  const narrow = () => matchMedia('(max-width: 700px)').matches;
  let open = false;
  try {
    open = localStorage.getItem(STORAGE_KEY) === 'open' && !narrow();
  } catch {
    /* ignore */
  }

  const showThumb = lazyThumbs(panel);

  function setOpen(v: boolean) {
    open = v;
    shownCurrent = null; // scroll to the open picture when shown again
    panel.hidden = !open;
    document.body.classList.toggle('panel-open', open);
    try {
      localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed');
    } catch {
      /* ignore */
    }
    ed.changed();
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function iconButton(name: string, title: string, fn: () => void) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon(name);
    b.addEventListener('click', fn);
    return b;
  }

  // Search + sort controls are created once and re-attached on every render,
  // so the search box keeps focus and cursor while the list updates.
  const controls = el('div', 'panel-controls');
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
  const count = el('div', 'panel-count');
  controls.append(search, sortSel, count);
  let listHost = el('div');

  let typingTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => {
      files.setQuery(search.value.trim());
      renderList();
    }, 80);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(typingTimer);
      files.setQuery(search.value.trim());
      const first = files.visible[0];
      if (first) files.openEntry(first);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (search.value) {
        clearSearch();
      } else {
        search.blur();
      }
    } else if (e.key === 'ArrowDown') {
      const btn = listHost.querySelector<HTMLButtonElement>('.file-item');
      if (btn) {
        e.preventDefault();
        btn.focus();
      }
    }
  });
  sortSel.addEventListener('change', () => files.setSort(sortSel.value as SortMode));

  function clearSearch() {
    clearTimeout(typingTimer);
    search.value = '';
    files.setQuery('');
    renderList();
    search.focus();
  }

  function render() {
    const hadFocus = document.activeElement === search;
    const caret = [search.selectionStart, search.selectionEnd] as const;
    panel.replaceChildren();
    const head = el('div', 'panel-head');
    const title = el('div', 'panel-title', files.folderName ?? 'Folder');
    title.title = files.folderName ? `Folder: ${files.folderName}` : '';
    head.append(title);
    if (files.folderName) {
      if (files.entries.length) head.append(iconButton('grid', 'Show all as gallery (Ctrl+G)', openGallery));
      if (!files.basic) {
        const r = iconButton('refresh', files.loading ? 'Reading folder…' : 'Refresh list', () => files.refresh());
        r.classList.toggle('spinning', files.loading);
        head.append(r);
      }
      head.append(
        iconButton('folder', 'Open another folder', () => (files.basic ? files.pickFolderBasic() : files.pickFolder())),
      );
    }
    head.append(iconButton('close', 'Hide panel', () => setOpen(false)));
    panel.append(head);

    if (files.folderError) {
      const box = el('div', 'panel-empty');
      box.append(
        el('p', 'panel-warn', 'The browser didn’t allow access to the folder. On a company computer this is usually a security policy set by IT.'),
        el('p', 'panel-note', 'You can still open the folder in basic mode: browse and annotate its images. Save then downloads an -annotated copy instead of overwriting the original, and the list doesn’t refresh by itself.'),
      );
      const basicBtn = el('button', 'primary', 'Choose folder (basic mode)…');
      basicBtn.type = 'button';
      basicBtn.addEventListener('click', () => files.pickFolderBasic());
      const retry = el('button', '', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => files.pickFolder());
      const details = el('details', 'panel-details');
      details.append(el('summary', '', 'Technical details'), el('code', '', files.folderError));
      box.append(basicBtn, retry, details);
      panel.append(box);
      return;
    }

    if (!files.folderName) {
      const box = el('div', 'panel-empty');
      box.append(el('p', '', 'Open a folder to flip through its images, for example your screenshots folder.'));
      const openBtn = el('button', 'primary', 'Open folder…');
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => files.pickFolder());
      box.append(openBtn);
      if (files.pendingDir) {
        const again = el('button', '', `Reopen “${files.pendingDir.name}”`);
        again.type = 'button';
        again.addEventListener('click', () => files.reconnect());
        box.append(again);
      }
      panel.append(box);
      return;
    }

    if (files.basic)
      panel.append(el('p', 'panel-note', 'Basic mode: Save downloads an -annotated copy. Reopen the folder to see new files.'));

    if (!files.entries.length) {
      if (files.loading) {
        const box = el('div', 'panel-loading');
        box.setAttribute('role', 'status');
        box.append(el('span', 'spinner'), el('span', '', files.progressText));
        panel.append(box);
      } else {
        panel.append(el('p', 'panel-note', 'No images in this folder.'));
      }
      return;
    }

    if (search.value.trim() !== files.query) search.value = files.query;
    sortSel.value = files.sort;
    panel.append(controls);
    listHost = el('div', 'file-list-host');
    panel.append(listHost);
    renderList();
    if (hadFocus) {
      search.focus();
      search.setSelectionRange(caret[0], caret[1]);
    }
  }

  /** The open picture the list last scrolled to. */
  let shownCurrent: string | null = null;

  /** Rebuild only the list (and count) from the filtered, sorted entries. */
  function renderList() {
    const visible = files.visible;
    const total = files.entries.length;
    count.textContent = files.query ? `${visible.length} of ${total} images` : `${total} image${total === 1 ? '' : 's'}`;
    if (files.loading) count.textContent += ' · updating…';
    listHost.replaceChildren();

    if (!visible.length) {
      const box = el('div', 'panel-empty');
      box.append(el('p', '', `No images match “${files.query}”.`));
      const clear = el('button', '', 'Clear search');
      clear.type = 'button';
      clear.addEventListener('click', clearSearch);
      box.append(clear);
      listHost.append(box);
      return;
    }

    const list = el('ul', 'file-list');
    const current = files.currentIndex();
    visible.forEach((e, i) => {
      const li = el('li');
      const b = el('button', 'file-item');
      b.type = 'button';
      b.title = e.name;
      if (i === current) {
        b.classList.add('current');
        b.setAttribute('aria-current', 'true');
      }
      const img = el('img') as ThumbImg;
      img.alt = '';
      showThumb(img, e);
      const meta = el('span', 'file-meta');
      const name = el('span', 'file-name', e.name);
      if (i === current && ed.dirty) name.prepend(el('span', 'dirty-dot', '●'));
      meta.append(name, el('span', 'file-time', ago(e.modified)));
      b.append(img, meta);
      b.addEventListener('click', async () => {
        await files.openEntry(e);
        if (narrow() && files.currentIndex() >= 0) setOpen(false);
      });
      // Arrow keys move between list items; ↑ on the first goes back to search.
      b.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
        ev.preventDefault();
        ev.stopPropagation();
        const sib = ev.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
        if (sib) (sib.querySelector('.file-item') as HTMLButtonElement).focus();
        else if (ev.key === 'ArrowUp') search.focus();
      });
      li.append(b);
      list.append(li);
    });
    listHost.append(list);
    // Bring the open picture into view when it changes (or the panel opens),
    // not on every refresh: that would undo the user's scrolling.
    const currentName = visible[current]?.name ?? null;
    if (currentName !== shownCurrent) list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
    shownCurrent = currentName;
  }

  // Re-render on file changes; on editor changes only the dirty marker matters.
  let lastDirty = false;
  files.onChange(() => {
    lastDirty = ed.dirty;
    if (open) render();
  });
  ed.onChange(() => {
    if (ed.dirty !== lastDirty) {
      lastDirty = ed.dirty;
      if (open) render();
    }
  });

  // New screenshots may have arrived while the app was in the background.
  window.addEventListener('focus', () => {
    if (open && files.dir && !files.basic) files.refresh();
  });

  setOpen(open);
  render();

  return {
    get open() {
      return open;
    },
    /** Open the panel (if needed) and put the cursor in the search box. */
    focusSearch() {
      if (!open) setOpen(true);
      render();
      if (search.isConnected) {
        search.focus();
        search.select();
      }
      return search.isConnected;
    },
    /** Redraw (e.g. after the gallery changed the search). */
    refresh() {
      if (open) render();
    },
    toggle() {
      setOpen(!open);
      if (open) {
        render();
        if (files.dir && !files.basic) files.refresh();
      }
    },
  };
}
