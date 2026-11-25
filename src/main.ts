// Must come first: in the desktop app it installs the native file layer
// before src/files.ts checks which file APIs are available.
import { initDesktop, isTauri } from './platform/tauri';
import { platform } from './platform/hooks';
import './ui/styles.css';
import { registerSW } from 'virtual:pwa-register';
import { Editor, isAnnotationClip } from './editor';
import { FileSession, folderUsable, setupInputs } from './files';
import { coarsePointer } from './editor';
import { blankCanvas } from './imageOps';
import { kindOf } from './shapes';
import { copyToClipboard, shareImage } from './io';
import { buildFilePanel } from './ui/filePanel';
import { buildGallery } from './ui/gallery';
import { setupSaveTip } from './ui/saveTip';
import { TOOL_KEYS, buildStyleBar, buildToolbar, canShareFiles } from './ui/toolbar';
import { setupContextMenu } from './ui/contextMenu';
import { toast } from './ui/toast';
import { versionLabel } from './version';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const workspace = $<HTMLElement>('#workspace');
const fileInput = $<HTMLInputElement>('#file');
const empty = $<HTMLElement>('#empty');
const status = $<HTMLElement>('#status');
const ed = new Editor($<HTMLDivElement>('#stage'));
const files = new FileSession(ed);
let updateReady = false; // set by the service worker when a new version is waiting

// ------------------------------------------------------------ resize dialog
const dlg = $<HTMLDialogElement>('#resize-dialog');
const rw = $<HTMLInputElement>('#resize-w');
const rh = $<HTMLInputElement>('#resize-h');
const rlock = $<HTMLInputElement>('#resize-lock');
const ratio = () => ed.width / ed.height;
rw.addEventListener('input', () => {
  if (rlock.checked) rh.value = String(Math.max(1, Math.round(Number(rw.value) / ratio())));
});
rh.addEventListener('input', () => {
  if (rlock.checked) rw.value = String(Math.max(1, Math.round(Number(rh.value) * ratio())));
});
dlg.querySelectorAll<HTMLButtonElement>('[data-pct]').forEach((b) =>
  b.addEventListener('click', () => {
    const k = Number(b.dataset.pct) / 100;
    rw.value = String(Math.round(ed.width * k));
    rh.value = String(Math.round(ed.height * k));
  }),
);
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'ok') ed.resize(Number(rw.value), Number(rh.value));
});

// ----------------------------------------------------------------- actions
fileInput.addEventListener('change', () => {
  const list = [...(fileInput.files ?? [])];
  const insert = fileInput.dataset.mode === 'insert';
  fileInput.value = '';
  fileInput.multiple = false;
  delete fileInput.dataset.mode;
  if (!list.length) return;
  if (insert) files.addBlobs(list.map((f) => ({ blob: f, name: f.name, fromFile: true })));
  else files.openBlob(list[0], list[0].name, true);
});

/** Paste button: add the clipboard picture on top, or (asNew) start a new picture with it. */
async function pasteButton(asNew = false) {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/plain')) {
        const text = await (await item.getType('text/plain')).text();
        if (isAnnotationClip(text)) {
          if (ed.base) ed.pasteAnnotations(text);
          else toast('Open a picture to paste the annotations into', 'error');
          return;
        }
      }
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      return asNew ? files.openBlob(blob, 'pasted.png') : files.addBlobs([{ blob, name: 'pasted.png' }]);
    }
    toast('No image on the clipboard', 'error');
  } catch {
    toast('Clipboard not available here. Try Ctrl+V', 'error');
  }
}

const gallery = buildGallery(ed, files, () => panel.refresh());
const panel = buildFilePanel($('#files'), ed, files, () => gallery.open());
const saveTip = setupSaveTip($<HTMLDialogElement>('#save-tip'));
files.onDownloaded = saveTip.afterDownload;

const actions = {
  open: async () => {
    if (!(await files.pickFile())) fileInput.click();
  },
  openFolder: () => {
    if (!folderUsable) return;
    if (!panel.open) panel.toggle();
    files.pickFolder();
  },
  togglePanel: () => folderUsable && panel.toggle(),
  prev: () => files.step(-1),
  next: () => files.step(1),
  paste: () => pasteButton(false),
  pasteNew: () => pasteButton(true),
  insert: () => {
    fileInput.dataset.mode = 'insert';
    fileInput.multiple = true;
    fileInput.click();
  },
  fitContent: () => ed.fitToContent(),
  blank: () => files.openBlank(blankCanvas(1280, 720)),
  close: async () => {
    await files.close();
    showFolder();
  },
  copy: () => copyToClipboard(ed),
  save: () => files.save(),
  saveAs: () => files.saveAs(),
  share: () => shareImage(ed, files.name || 'image'),
  resize: () => {
    if (!ed.base) return;
    rw.value = String(ed.width);
    rh.value = String(ed.height);
    dlg.returnValue = '';
    dlg.showModal();
  },
  fileState: () => ({
    panelOpen: panel.open,
    folder: !!files.folderName,
    index: files.currentIndex(),
    count: files.visible.length,
    inPlace: files.canSaveInPlace && !files.writeBlocked ? files.handle!.name : null,
    downloads: files.writeBlocked,
    folderUsable,
  }),
};

buildToolbar($('#toolbar'), ed, actions);
async function copyAnnotations(cut: boolean) {
  const text = ed.copySelected();
  if (!text) return;
  const n = ed.selected().length;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast('Copying is not allowed here. Try Ctrl+C', 'error');
    return;
  }
  if (cut) ed.deleteSelected();
  toast(`${cut ? 'Cut' : 'Copied'} ${n === 1 ? 'annotation' : `${n} annotations`}`);
}

setupContextMenu($('#stage'), ed, () => [
  ...(ed.selected().length
    ? [
        { label: ed.selected().length === 1 ? 'Copy annotation' : 'Copy annotations', hint: 'Ctrl+C', run: () => copyAnnotations(false) },
        { label: ed.selected().length === 1 ? 'Cut annotation' : 'Cut annotations', hint: 'Ctrl+X', run: () => copyAnnotations(true) },
      ]
    : []),
  { label: 'Paste', hint: 'Ctrl+V', run: actions.paste },
  { label: 'Copy image', hint: ed.selected().length ? 'Ctrl+Shift+C' : 'Ctrl+C', run: actions.copy },
  { label: 'Save as…', hint: 'Ctrl+Shift+S', run: actions.saveAs },
  ...(canShareFiles() ? [{ label: 'Share…', run: actions.share }] : []),
]);
buildStyleBar($('#stylebar'), ed);
setupInputs(files, workspace);

for (const [act, fn] of Object.entries({
  open: actions.open,
  folder: actions.openFolder,
  paste: actions.paste,
  blank: actions.blank,
})) {
  const b = empty.querySelector<HTMLButtonElement>(`[data-act=${act}]`)!;
  b.addEventListener('click', fn);
  if (act === 'folder') b.hidden = !folderUsable;
}
// The folder panel can't work on phones; don't restore it from an earlier visit.
if (!folderUsable && panel.open) panel.toggle();

ed.onChange(() => {
  empty.hidden = !!ed.base;
  workspace.classList.toggle('has-image', !!ed.base);
  const dirty = ed.dirty;
  document.title = ed.base ? `${dirty ? '● ' : ''}${files.name || 'image'} – magic-image` : 'magic-image';
  status.replaceChildren();
  const ver = document.createElement('span');
  if (ed.base) {
    const parts = [files.name || 'image', `${ed.width} × ${ed.height}px`, `${Math.round(ed.scale * 100)}%`];
    const info = document.createElement('span');
    info.textContent = parts.join(' · ') + (dirty ? ' · unsaved' : '');
    // Phones hide the version label; tapping the picture info shows it.
    info.addEventListener('click', () => {
      if (getComputedStyle(ver).display === 'none') toast(`magic-image ${ver.textContent}`);
    });
    const hint = document.createElement('span');
    hint.className = 'hint';
    const sel = ed.selected();
    hint.textContent =
      ed.toolName === 'select' && sel.length === 1 && kindOf(sel[0]) === 'callout'
        ? `Drag the corners to resize the box, the blue dot to move the pointer · ${coarsePointer ? 'double-tap' : 'double-click'} to edit the text`
        : (coarsePointer && ed.tool.touchHint) || ed.tool.hint;
    status.append(info, hint);
  }
  const right = document.createElement('span');
  right.className = 'status-right';
  if (files.writeBlocked) {
    const why = document.createElement('button');
    why.type = 'button';
    why.className = 'link';
    why.textContent = 'Save downloads a copy – why?';
    why.addEventListener('click', () => saveTip.show());
    right.append(why);
  }
  if (updateReady) {
    const upd = document.createElement('button');
    upd.type = 'button';
    upd.className = 'link update';
    upd.textContent = 'New version available – update';
    upd.addEventListener('click', applyUpdate);
    right.append(upd);
  }
  const desktopUpdate = platform.update;
  if (desktopUpdate) {
    const upd = document.createElement('button');
    upd.type = 'button';
    upd.className = 'link update';
    upd.textContent = `Version ${desktopUpdate.version} available – install`;
    upd.title = 'Downloads and installs the new version, then restarts the app';
    upd.addEventListener('click', () => desktopUpdate.install().catch((e) => toast(`Update failed: ${e}`, 'error')));
    right.append(upd);
  }
  ver.className = ed.base ? 'version' : 'version always';
  ver.textContent = versionLabel() + (isTauri ? ' · desktop' : '');
  ver.title = 'App version (commit and build time)';
  right.append(ver);
  status.append(right);
});
ed.changed();
platform.onUpdate = () => ed.changed();

window.addEventListener('beforeunload', (e) => {
  ed.settle();
  if (ed.dirty) e.preventDefault();
});

// ------------------------------------------------- copy & paste annotations
// Ctrl+C / Ctrl+X with annotations selected puts them on the clipboard as
// text; Ctrl+V pastes them (also into another picture or another tab).
// Without a selection, Ctrl+C copies the whole picture (see the keys below).
const clipboardFree = () =>
  !isTyping(document.activeElement) && !document.querySelector('dialog[open]') && !window.getSelection()?.toString();

for (const type of ['copy', 'cut'] as const) {
  document.addEventListener(type, (e) => {
    if (!clipboardFree() || !e.clipboardData) return;
    const text = ed.copySelected();
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
    const n = ed.selected().length;
    if (type === 'cut') ed.deleteSelected();
    toast(`${type === 'cut' ? 'Cut' : 'Copied'} ${n === 1 ? 'annotation' : `${n} annotations`}`);
  });
}

document.addEventListener('paste', (e) => {
  if (!clipboardFree()) return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!isAnnotationClip(text)) return;
  e.preventDefault();
  files.pasteAsNewUntil = 0;
  if (!ed.base) {
    toast('Open a picture to paste the annotations into', 'error');
    return;
  }
  ed.pasteAnnotations(text);
});

// --------------------------------------------------------------- keyboard
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (ed.tool.key?.(e)) {
    e.preventDefault();
    return;
  }

  if (mod) {
    const handled = (() => {
      if (k === 'v') {
        // Let the browser's paste event through; Shift makes it a new picture.
        files.pasteAsNewUntil = e.shiftKey ? Date.now() + 1000 : 0;
        return false;
      } else if (k === 'z' && !e.shiftKey) ed.undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') ed.redo();
      else if (k === 's') (e.shiftKey ? actions.saveAs : actions.save)();
      else if (k === 'o') (e.shiftKey ? actions.openFolder : actions.open)();
      else if (k === 'b') actions.togglePanel();
      else if (k === 'f' && files.folderName) panel.focusSearch();
      else if (k === 'g' && files.folderName) gallery.open();
      else if (k === 'd') ed.duplicateSelected();
      else if (k === 'a') {
        ed.setTool('select');
        ed.select(ed.annoLayer.getChildren().slice());
      } else if ((k === 'c' || k === 'x') && !e.shiftKey && ed.selected().length && !window.getSelection()?.toString()) {
        // Selected annotations: let the browser's copy/cut event through (handled below).
        return false;
      } else if (k === 'c' && (e.shiftKey || !window.getSelection()?.toString())) copyToClipboard(ed);
      else if (k === '0') ed.fit();
      else if (k === '1') ed.actualSize();
      else if (k === '=' || k === '+') ed.zoomBy(1.25);
      else if (k === '-') ed.zoomBy(1 / 1.25);
      else return false;
      return true;
    })();
    if (handled) e.preventDefault();
    return;
  }

  if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault();
    files.step(e.key === 'PageDown' ? 1 : -1);
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    ed.setPanning(true);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    ed.deleteSelected();
    return;
  }
  if (e.key === 'Escape') {
    ed.select([]);
    return;
  }
  if (e.key === ']') return ed.reorderSelected(true);
  if (e.key === '[') return ed.reorderSelected(false);
  if (!e.altKey && TOOL_KEYS[k] && ed.base) ed.setTool(TOOL_KEYS[k]);
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ') ed.setPanning(false);
});
window.addEventListener('blur', () => ed.setPanning(false));

/**
 * With a folder open and no picture, show the folder's pictures instead of the
 * welcome screen (unless the side panel already shows them).
 */
function showFolder() {
  if (!ed.base && !panel.open && (files.entries.length || files.loading)) gallery.open();
}

// Start in the folder used last time. If a picture arrives meanwhile (shared
// to the app, or opened with it), that picture wins and the gallery closes.
let startupGallery = false;
files.onChange(() => {
  if (startupGallery && ed.base) gallery.close();
  if (ed.base || !gallery.isOpen) startupGallery = false;
});
files
  .restoreFolder(() => {
    showFolder();
    startupGallery = gallery.isOpen;
  })
  .then(() => initDesktop(files));

// If the browser wants permission again, offer the folder on the welcome screen.
const reopenBtn = document.createElement('button');
reopenBtn.type = 'button';
reopenBtn.className = 'primary';
reopenBtn.addEventListener('click', () => files.reconnect(showFolder));
empty.querySelector('.empty-actions')!.prepend(reopenBtn);
const emptyOpenBtn = empty.querySelector<HTMLButtonElement>('[data-act=open]')!;
const syncReopen = () => {
  const dir = files.pendingDir;
  reopenBtn.hidden = !dir;
  if (dir) reopenBtn.textContent = `Open “${dir.name}”`;
  // Only one main (blue) button.
  emptyOpenBtn.classList.toggle('primary', !dir);
};
files.onChange(syncReopen);
syncReopen();

/** An image shared to the installed app (see public/share-target.js). */
async function receiveShared() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('image-magic-share');
    const res = await cache.match('shared-image');
    if (!res) return;
    await cache.delete('shared-image');
    const name = decodeURIComponent(res.headers.get('x-file-name') || 'shared.png');
    await files.openBlob(await res.blob(), name, true);
  } catch {
    toast('Could not open the shared image', 'error');
  }
}
receiveShared();

if (import.meta.env.DEV) Object.assign(window, { ed, files }); // for debugging

// ------------------------------------------------------------------ updates
// A new version is installed in the background. It is switched to right away
// when nothing is being edited; otherwise the status bar offers an update
// button, so unsaved annotations are never lost to a reload.
let swRegistration: ServiceWorkerRegistration | undefined;
registerSW({
  immediate: true,
  onNeedRefresh() {
    if (!ed.base) {
      switchToNewVersion();
      return;
    }
    updateReady = true;
    ed.changed();
  },
  onRegisteredSW(_url, r) {
    swRegistration = r;
    setInterval(() => r?.update(), 30 * 60 * 1000);
  },
});
// Check for a newer version whenever the app comes back to the foreground.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') swRegistration?.update().catch(() => {});
});

async function applyUpdate() {
  if (!(await files.confirmDiscard())) return;
  ed.markSaved(); // already confirmed; don't ask again in beforeunload
  switchToNewVersion();
}

/**
 * Activate the waiting version and reload into it. The plugin's own updateSW()
 * only reloads in some cases (not e.g. for a second update found in the same
 * session), which left the update button doing nothing.
 */
async function switchToNewVersion() {
  const sw = navigator.serviceWorker;
  const reg = swRegistration ?? (await sw?.getRegistration().catch(() => undefined));
  const waiting = reg?.waiting;
  if (!sw || !waiting) {
    location.reload(); // nothing waiting (already activated): reloading loads it
    return;
  }
  sw.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // If the hand-over never happens, reload anyway.
  setTimeout(() => location.reload(), 4000);
}
