/**
 * Files on disk: open/save-in-place via the File System Access API
 * (Chrome, Edge and other Chromium browsers), plus browsing a folder of
 * images. Other browsers fall back to the file picker and downloads.
 */
import type { Editor } from './editor';
import { blobToCanvas, downloadBlob, encode, formatFor, type Format } from './io';
import { platform } from './platform/hooks';
import { toast } from './ui/toast';

type Perm = 'granted' | 'denied' | 'prompt';
type Mode = { mode: 'read' | 'readwrite' };
type WithPerm = { queryPermission?(m: Mode): Promise<Perm>; requestPermission?(m: Mode): Promise<Perm> };
type PickerType = { description: string; accept: Record<string, string[]> };
type FsWindow = Window & {
  showOpenFilePicker?(o: { types?: PickerType[]; id?: string; multiple?: boolean }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(o: { suggestedName?: string; types?: PickerType[]; id?: string; startIn?: unknown }): Promise<FileSystemFileHandle>;
  showDirectoryPicker?(o: { id?: string; mode?: 'read' | 'readwrite'; startIn?: unknown }): Promise<FileSystemDirectoryHandle>;
};
const w = window as FsWindow;

export const fsSupported = typeof w.showOpenFilePicker === 'function';
export const folderSupported = typeof w.showDirectoryPicker === 'function';
/**
 * Whether opening folders can work at all. Phone browsers support neither the
 * folder picker nor the classic folder input, so the folder UI is hidden there.
 */
export const folderUsable = folderSupported || !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const IMAGE_TYPES: PickerType[] = [
  { description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'] } },
];
const SAVE_TYPES: Record<Format, PickerType> = {
  png: { description: 'PNG image', accept: { 'image/png': ['.png'] } },
  jpeg: { description: 'JPEG image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
  webp: { description: 'WebP image', accept: { 'image/webp': ['.webp'] } },
};

async function hasPermission(h: FileSystemHandle, mode: Mode['mode'], ask: boolean) {
  const p = h as unknown as WithPerm;
  if (!p.queryPermission) return true;
  if ((await p.queryPermission({ mode })) === 'granted') return true;
  return ask && !!p.requestPermission && (await p.requestPermission({ mode })) === 'granted';
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';
/** Short technical description of an error, for messages. */
const errText = (e: unknown) => {
  const err = e as Error;
  return err?.name ? `${err.name}${err.message ? `: ${err.message}` : ''}` : String(e);
};

// ------------------------------------------------- remembered folder (IndexedDB)
// Storage names keep the app's old name (image-magic), so settings and the
// remembered folder survive the rename to magic-image.
const DB = 'image-magic', STORE = 'kv';
function idb<T>(fn: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
const idbGet = <T>(k: string) => idb<T>((s) => s.get(k) as IDBRequest<T>, 'readonly').catch(() => undefined);
const idbSet = (k: string, v: unknown) => idb((s) => s.put(v, k), 'readwrite').catch(() => undefined);

// ------------------------------------------------------------------ session

export type SortMode = 'name-desc' | 'name-asc' | 'modified-desc' | 'modified-asc';
export const SORT_MODES: Record<SortMode, string> = {
  'name-desc': 'Newest name first',
  'name-asc': 'Name A→Z',
  'modified-desc': 'Recently modified',
  'modified-asc': 'Oldest modified',
};
const SORT_KEY = 'image-magic.sort';
const byName = (a: FileEntry, b: FileEntry) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** An image in the opened folder: a real handle, or (basic mode) a plain File. */
export interface FileEntry {
  name: string;
  modified: number;
  handle?: FileSystemFileHandle;
  file?: File;
}

export class FileSession {
  /** File currently being edited (null for pasted/dropped-without-handle images). */
  handle: FileSystemFileHandle | null = null;
  /** Name of the current file, also when there is no handle. */
  name = '';
  /**
   * True when the image came from a file (not pasted / blank). Downloads
   * then keep the original name and format, so that with the browser's
   * "ask where to save" setting the original can be replaced.
   */
  fromFile = false;
  /**
   * The browser refused to write files (e.g. company policy). Save then
   * goes straight to a download instead of trying the failing prompts.
   */
  writeBlocked = false;
  /** Called after a save that had to fall back to a download. */
  onDownloaded: (() => void) | null = null;
  /** Plain file being edited when it came from a basic-mode folder. */
  private currentFile: File | null = null;
  dir: FileSystemDirectoryHandle | null = null;
  /** Name of the open folder (full access or basic mode), or null. */
  folderName: string | null = null;
  /**
   * Basic mode: the folder was picked with a classic folder input, because
   * the browser (or a company policy) does not allow folder access. Images
   * can be browsed, but not saved in place and the list cannot refresh.
   */
  basic = false;
  /** Why the last attempt to open a folder failed, shown in the panel. */
  folderError: string | null = null;
  /** A folder remembered from last time that still needs permission. */
  pendingDir: FileSystemDirectoryHandle | null = null;
  /** All images of the folder, unsorted. Use `visible` for display/navigation. */
  entries: FileEntry[] = [];
  /** Name filter typed in the folder panel. */
  query = '';
  sort: SortMode = 'name-desc';
  private visibleCache: { key: unknown[]; list: FileEntry[] } | null = null;
  private listeners = new Set<() => void>();
  private unsavedDialog: HTMLDialogElement;

  constructor(private ed: Editor) {
    this.unsavedDialog = document.querySelector('#unsaved-dialog')!;
    try {
      const saved = localStorage.getItem(SORT_KEY) as SortMode | null;
      if (saved && saved in SORT_MODES) this.sort = saved;
    } catch {
      /* ignore */
    }
  }

  /**
   * The folder's images that match the search, in the chosen order. The
   * panel shows this list, and Page Up/Down / the arrows step through it.
   */
  get visible(): FileEntry[] {
    const key = [this.entries, this.query, this.sort];
    const c = this.visibleCache;
    if (c && c.key.every((k, i) => k === key[i])) return c.list;
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = this.entries.filter((e) => {
      const n = e.name.toLowerCase();
      return words.every((w) => n.includes(w));
    });
    const cmp: Record<SortMode, (a: FileEntry, b: FileEntry) => number> = {
      'name-desc': (a, b) => byName(b, a),
      'name-asc': byName,
      'modified-desc': (a, b) => b.modified - a.modified || byName(b, a),
      'modified-asc': (a, b) => a.modified - b.modified || byName(a, b),
    };
    list.sort(cmp[this.sort]);
    this.visibleCache = { key, list };
    return list;
  }

  setQuery(q: string) {
    if (q === this.query) return;
    this.query = q;
    this.ed.changed(); // toolbar arrows follow the filtered list
  }

  setSort(m: SortMode) {
    this.sort = m;
    try {
      localStorage.setItem(SORT_KEY, m);
    } catch {
      /* ignore */
    }
    this.emit();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
    this.ed.changed();
  }

  get hasImage() {
    return !!this.ed.base;
  }

  get canSaveInPlace() {
    return !!this.handle && !!formatFor(this.handle.name);
  }

  // ------------------------------------------------------------- unsaved

  /** Ask before throwing away edits. Resolves false if the user cancels. */
  async confirmDiscard(): Promise<boolean> {
    this.ed.settle();
    if (!this.ed.dirty) return true;
    const d = this.unsavedDialog;
    d.querySelector('[data-name]')!.textContent = this.name || 'this image';
    d.returnValue = '';
    d.showModal();
    const choice = await new Promise<string>((r) => d.addEventListener('close', () => r(d.returnValue), { once: true }));
    if (choice === 'save') return this.save();
    return choice === 'discard';
  }

  // ---------------------------------------------------------------- open

  /**
   * Open an image without a file handle: paste, or a file from the classic
   * file input / a plain drop (`fromFile`).
   */
  async openBlob(blob: Blob, name: string, fromFile = false) {
    if (!(await this.confirmDiscard())) return;
    try {
      const canvas = await blobToCanvas(blob);
      this.handle = null;
      this.currentFile = null;
      this.fromFile = fromFile;
      this.name = name;
      this.ed.loadImage(canvas, name);
      this.emit();
    } catch {
      toast('That file could not be opened as an image', 'error');
    }
  }

  /** Set by Ctrl+Shift+V: a paste until this time opens a new picture instead of adding. */
  pasteAsNewUntil = 0;

  /**
   * Add pictures on top of the open one (pasted, dropped, inserted). With
   * nothing open, the first one is opened and the rest are added to it.
   */
  async addBlobs(items: { blob: Blob; name: string; fromFile?: boolean }[]) {
    let i = 0;
    for (const it of items) {
      if (!this.ed.base) {
        await this.openBlob(it.blob, it.name, it.fromFile);
        continue;
      }
      try {
        this.ed.insertImage(await blobToCanvas(it.blob), i++);
      } catch {
        toast(`${it.name} could not be opened as an image`, 'error');
      }
    }
  }

  /** Dropped or "opened with" while editing: add it; otherwise open it. */
  async dropHandle(h: FileSystemFileHandle) {
    if (!this.ed.base) return this.openHandle(h);
    const f = await h.getFile();
    return this.addBlobs([{ blob: f, name: f.name, fromFile: true }]);
  }

  async openHandle(h: FileSystemFileHandle) {
    if (h === this.handle) return;
    if (!(await this.confirmDiscard())) return;
    try {
      const file = await h.getFile();
      const canvas = await blobToCanvas(file);
      this.handle = h;
      this.currentFile = null;
      this.fromFile = true;
      this.name = file.name;
      this.ed.loadImage(canvas, file.name);
      this.emit();
    } catch (e) {
      toast(`Could not open ${h.name} (${errText(e)})`, 'error');
    }
  }

  /** Open an image from a basic-mode folder (no handle, so Save makes a copy). */
  async openFile(f: File) {
    if (f === this.currentFile) return;
    if (!(await this.confirmDiscard())) return;
    try {
      const canvas = await blobToCanvas(f);
      this.handle = null;
      this.currentFile = f;
      this.fromFile = true;
      this.name = f.name;
      this.ed.loadImage(canvas, f.name);
      this.emit();
    } catch (e) {
      toast(`Could not open ${f.name} (${errText(e)})`, 'error');
    }
  }

  openEntry(e: FileEntry) {
    return e.handle ? this.openHandle(e.handle) : this.openFile(e.file!);
  }

  /** Close the open picture (asks first about unsaved changes). */
  async close() {
    if (!this.ed.base || !(await this.confirmDiscard())) return;
    this.handle = null;
    this.currentFile = null;
    this.fromFile = false;
    this.name = '';
    this.ed.close();
    this.emit();
  }

  async openBlank(canvas: HTMLCanvasElement) {
    if (!(await this.confirmDiscard())) return;
    this.handle = null;
    this.currentFile = null;
    this.fromFile = false;
    this.name = 'untitled.png';
    this.ed.loadImage(canvas, 'untitled');
    this.emit();
  }

  /**
   * File picker. Returns false when the caller should use <input type=file>
   * instead: the API is missing, or the browser refused (e.g. company policy).
   */
  async pickFile(): Promise<boolean> {
    if (!w.showOpenFilePicker) return false;
    try {
      const [h] = await w.showOpenFilePicker({ types: IMAGE_TYPES, id: 'image-magic' });
      await this.openHandle(h);
      return true;
    } catch (e) {
      if (isAbort(e)) return true;
      console.warn('showOpenFilePicker failed, using the classic file picker', e);
      return false;
    }
  }

  // -------------------------------------------------------------- folder

  /**
   * Pick a folder with full access (read + write). If the browser refuses,
   * try read-only access; if that is refused too, record the reason so the
   * panel can offer basic mode.
   */
  async pickFolder() {
    if (!w.showDirectoryPicker) return this.pickFolderBasic();
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await w.showDirectoryPicker({ id: 'image-magic', mode: 'readwrite' });
    } catch (e) {
      if (isAbort(e)) return;
      console.warn('showDirectoryPicker (readwrite) failed', e);
      try {
        dir = await w.showDirectoryPicker({ id: 'image-magic', mode: 'read' });
      } catch (e2) {
        if (isAbort(e2)) return;
        console.warn('showDirectoryPicker (read) failed', e2);
        this.folderError = errText(e);
        this.emit();
        return;
      }
    }
    await this.useFolder(dir);
  }

  /**
   * Basic mode: the classic folder input, which works everywhere (also when
   * folder access is blocked). Must be called directly from a click.
   */
  pickFolderBasic() {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.addEventListener('change', async () => {
      const all = [...(input.files ?? [])];
      // Only the folder itself, not its sub-folders.
      const images = all.filter((f) => IMAGE_RE.test(f.name) && f.webkitRelativePath.split('/').length === 2);
      if (!all.length) return;
      this.dir = null;
      this.loading = false;
      this.basic = true;
      this.folderError = null;
      this.folderName = all[0].webkitRelativePath.split('/')[0] || 'Folder';
      this.entries = images.map((f) => ({ name: f.name, modified: f.lastModified, file: f }));
      this.query = '';
      this.emit();
      if (!this.ed.base && this.entries.length) await this.openEntry(this.visible[0]);
    });
    input.click();
  }

  async useFolder(dir: FileSystemDirectoryHandle) {
    // Don't show the previous folder's images while the new one loads.
    if (dir !== this.dir) this.entries = [];
    this.dir = dir;
    this.folderName = dir.name;
    this.basic = false;
    this.folderError = null;
    this.pendingDir = null;
    this.query = '';
    if (platform.rememberDir) platform.rememberDir(dir);
    else idbSet('lastDir', dir);
    await this.refresh();
    // Open the newest image if nothing is being edited yet.
    if (!this.ed.base && this.entries.length) await this.openEntry(this.visible[0]);
  }

  /** On startup: reconnect the folder used last time (silently if allowed). */
  async restoreFolder() {
    if (!folderSupported) return;
    const dir = platform.restoreDir ? platform.restoreDir() : await idbGet<FileSystemDirectoryHandle>('lastDir');
    if (!dir) return;
    if (await hasPermission(dir, 'read', false)) {
      this.dir = dir;
      this.folderName = dir.name;
      await this.refresh();
    } else {
      this.pendingDir = dir;
      this.emit();
    }
  }

  /** Needs a click (user gesture) to show the permission prompt. */
  async reconnect() {
    const dir = this.pendingDir;
    if (!dir) return;
    try {
      if (await hasPermission(dir, 'read', true)) await this.useFolder(dir);
      else toast('Permission to the folder was not granted', 'error');
    } catch {
      this.pendingDir = null;
      toast('That folder is no longer available', 'error');
      this.emit();
    }
  }

  /** True while the folder is being read (the list may still be empty). */
  loading = false;
  /** Images found so far while loading, and how many have their date read. */
  progress = { found: 0, dated: 0 };
  private reading: { dir: FileSystemDirectoryHandle; done: Promise<void> } | null = null;

  /** Re-read the folder (order and filtering happen in `visible`). */
  refresh(): Promise<void> {
    const dir = this.dir;
    if (!dir || this.basic) return Promise.resolve();
    // A read of this folder is already running (e.g. focus event right after opening).
    if (this.reading?.dir === dir) return this.reading.done;
    const reading = { dir, done: this.readFolder(dir) };
    this.reading = reading;
    reading.done.finally(() => {
      if (this.reading === reading) this.reading = null;
    });
    return reading.done;
  }

  private async readFolder(dir: FileSystemDirectoryHandle) {
    const current = () => this.reading?.dir === dir && this.dir === dir;
    this.loading = true;
    this.progress = { found: 0, dated: 0 };
    this.emit();
    // Re-render at most a few times a second while counting.
    let shown = performance.now();
    const tick = () => {
      if (performance.now() - shown < 250 || !current()) return;
      shown = performance.now();
      this.emit();
    };
    const list: FileEntry[] = [];
    try {
      const handles: FileSystemFileHandle[] = [];
      for await (const h of dir.values()) {
        if (h.kind !== 'file' || !IMAGE_RE.test(h.name)) continue;
        handles.push(h as FileSystemFileHandle);
        this.progress.found = handles.length;
        tick();
      }
      // Dates: the desktop layer knows them from the listing. In the browser,
      // getFile() doesn't read the contents, but on Android each call is a slow
      // round trip, so several run at once.
      let next = 0;
      const worker = async () => {
        while (next < handles.length) {
          const fh = handles[next++];
          let modified = (fh as { lastModifiedMs?: number }).lastModifiedMs;
          try {
            modified ??= (await fh.getFile()).lastModified;
          } catch {
            continue; // deleted meanwhile, or unreadable
          }
          // Keep the handle we are editing, so isSameEntry checks stay cheap.
          const same = this.handle?.name === fh.name && (await this.handle.isSameEntry(fh));
          list.push({ name: fh.name, handle: same ? this.handle! : fh, modified });
          this.progress.dated++;
          tick();
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
    } catch (e) {
      if (current()) toast(`Could not read the folder (${errText(e)})`, 'error');
    }
    if (!current()) {
      // Another folder was opened meanwhile: its own read reports when done.
      if (this.reading?.dir === dir) this.loading = false;
      return;
    }
    this.entries = list;
    this.loading = false;
    this.emit();
  }

  /** Index of the current file in the visible (filtered, sorted) list, or -1. */
  currentIndex() {
    return this.visible.findIndex(
      (e) => (!!e.handle && e.handle === this.handle) || (!!e.file && e.file === this.currentFile),
    );
  }

  /** Open the next (+1) or previous (-1) image of the visible (filtered) list. */
  async step(delta: number) {
    const list = this.visible;
    if (!list.length) return;
    const i = this.currentIndex();
    const next = i < 0 ? 0 : i + delta;
    if (next < 0 || next >= list.length) return;
    await this.openEntry(list[next]);
  }

  // ---------------------------------------------------------------- save

  private async write(h: FileSystemFileHandle, format: Format) {
    const blob = await encode(this.ed.exportCanvas(), format);
    const out = await h.createWritable();
    await out.write(blob);
    await out.close();
  }

  /** Save over the opened file; falls back to "Save as". Resolves true when saved. */
  async save(): Promise<boolean> {
    if (!this.ed.base) return false;
    this.ed.settle();
    const h = this.handle;
    const format = h && formatFor(h.name);
    if (!h || !format || this.writeBlocked) return this.saveAs();
    try {
      if (!(await hasPermission(h, 'readwrite', true))) return this.saveAs();
      await this.write(h, format);
      this.ed.markSaved();
      toast(`Saved ${h.name}`);
      this.touch(h);
      return true;
    } catch (e) {
      toast(`Could not write ${h.name} (${errText(e)}). Try Save as`, 'error');
      return false;
    }
  }

  async saveAs(): Promise<boolean> {
    if (!this.ed.base) return false;
    this.ed.settle();
    // Keep the original format for images that came from a file
    // (browsers can't encode GIF/BMP/AVIF, so those become PNG).
    const original = this.handle || this.fromFile ? formatFor(this.name) : null;
    const preferred: Format = original ?? 'png';
    const ext = preferred === 'jpeg' ? 'jpg' : preferred;
    const base = this.name.replace(/\.[^.]+$/, '') || 'image';
    // The save dialog may overwrite the original; a download never can, so it
    // gets a clear suffix instead of the browser's "(1)", "(2)" numbering.
    const suggestedName = this.handle && original ? this.name : `${base}.${ext}`;
    const downloadName = `${base.replace(/-annotated$/, '')}-annotated.${ext}`;

    const download = async () => {
      downloadBlob(await encode(this.ed.exportCanvas(), preferred), downloadName);
      this.ed.markSaved();
      toast(`Downloaded ${downloadName}`);
      this.onDownloaded?.();
      // If downloads go into the open folder, show the new copy there.
      if (this.dir && !this.basic) setTimeout(() => this.refresh(), 1500);
      return true;
    };
    if (!w.showSaveFilePicker || this.writeBlocked) return download();
    try {
      const order: Format[] = [preferred, ...(['png', 'jpeg', 'webp'] as Format[]).filter((f) => f !== preferred)];
      const h = await w.showSaveFilePicker({
        suggestedName,
        types: order.map((f) => SAVE_TYPES[f]),
        id: 'image-magic',
        startIn: this.handle ?? this.dir ?? 'pictures',
      });
      await this.write(h, formatFor(h.name) ?? 'png');
      this.handle = h;
      this.name = h.name;
      this.ed.fileName = h.name.replace(/\.[^.]+$/, '');
      this.ed.markSaved();
      toast(`Saved ${h.name}`);
      if (this.dir) await this.refresh();
      else this.emit();
      return true;
    } catch (e) {
      if (isAbort(e)) return false;
      // Save dialog refused (e.g. company policy): download instead, from now on.
      console.warn('showSaveFilePicker failed, downloading instead', e);
      this.writeBlocked = true;
      this.emit();
      return download();
    }
  }

  /** Update the folder list after writing a file in it. */
  private touch(h: FileSystemFileHandle) {
    const e = this.entries.find((x) => x.handle === h);
    if (e) e.modified = Date.now();
    this.visibleCache = null; // the date sort may change
    this.emit();
  }
}

/** Paste, drag-and-drop and "Open with" from the OS. */
export function setupInputs(files: FileSession, dropZone: HTMLElement) {
  document.addEventListener('paste', (e) => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    // Ctrl+V adds the picture on top of the open one; Ctrl+Shift+V starts a new picture.
    if (Date.now() < files.pasteAsNewUntil) {
      files.pasteAsNewUntil = 0;
      files.openBlob(file, 'pasted.png');
    } else {
      files.addBlobs([{ blob: file, name: 'pasted.png' }]);
    }
  });

  let depth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  dropZone.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    dropZone.classList.add('dragging');
  });
  dropZone.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      dropZone.classList.remove('dragging');
    }
  });
  dropZone.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    dropZone.classList.remove('dragging');
    const items = [...(e.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file');
    const plainFiles = items.map((i) => i.getAsFile()).filter((f): f is File => !!f && IMAGE_RE.test(f.name));
    // Chromium hands out real file/folder handles, so saving goes back to the file.
    type WithHandle = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };
    const handles = await Promise.all(items.map((i) => (i as WithHandle).getAsFileSystemHandle?.() ?? null));
    const dir = handles.find((h) => h?.kind === 'directory') as FileSystemDirectoryHandle | undefined;
    if (dir) {
      if (await hasPermission(dir, 'readwrite', true)) await files.useFolder(dir);
      return;
    }
    const fh = handles.find((h) => h?.kind === 'file' && IMAGE_RE.test(h.name)) as FileSystemFileHandle | undefined;
    // With nothing open, a single file is opened (Save then goes back to it).
    if (fh && !files.hasImage && plainFiles.length <= 1) return files.openHandle(fh);
    // Otherwise all dropped images are added on top of the open picture.
    if (plainFiles.length) return files.addBlobs(plainFiles.map((f) => ({ blob: f, name: f.name, fromFile: true })));
    toast('Drop an image file or a folder', 'error');
  });

  // Installed app opened via the OS "Open with" menu.
  type LaunchParams = { files: FileSystemFileHandle[] };
  const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
  lq?.setConsumer((params) => {
    if (params.files.length) files.openHandle(params.files[0]);
  });
}
