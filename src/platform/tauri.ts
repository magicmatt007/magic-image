/**
 * Desktop (Tauri) file layer.
 *
 * The app's file code (src/files.ts) is written against the browser's File
 * System Access API: showOpenFilePicker / showDirectoryPicker /
 * showSaveFilePicker and file/directory handles. Inside the desktop app this
 * module installs versions of exactly those, backed by native dialogs and a
 * few Rust commands (src-tauri/src/lib.rs). Browser policies don't apply, so
 * files can be overwritten in place and any folder can be opened.
 *
 * Must be imported before src/files.ts (it is the first import in main.ts).
 */
import { platform } from './hooks';
import { toast } from '../ui/toast';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
};
const LAST_DIR_KEY = 'image-magic.lastDirPath';

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
const sep = (p: string) => (p.includes('\\') ? '\\' : '/');
const extOf = (p: string) => /\.([^.\\/]+)$/.exec(p)?.[1]?.toLowerCase() ?? '';

const core = () => import('@tauri-apps/api/core');
const dialog = () => import('@tauri-apps/plugin-dialog');

const abort = () => new DOMException('The user aborted a request.', 'AbortError');

interface DirEntry {
  name: string;
  path: string;
  modified_ms: number;
}

/** A file on disk, shaped like the browser's FileSystemFileHandle. */
export class TauriFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  constructor(
    readonly path: string,
    private modified?: number,
  ) {
    this.name = baseName(path);
  }

  async getFile(): Promise<File> {
    const { invoke } = await core();
    const bytes = await invoke<ArrayBuffer>('read_file', { path: this.path });
    if (this.modified === undefined) this.modified = await invoke<number>('modified_ms', { path: this.path });
    return new File([bytes], this.name, { type: MIME[extOf(this.name)] ?? '', lastModified: this.modified });
  }

  async createWritable() {
    const parts: Blob[] = [];
    return {
      write: async (data: Blob) => {
        parts.push(data);
      },
      close: async () => {
        const { invoke } = await core();
        const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
        // Raw body (no JSON encoding of the image); the path travels as a header.
        await invoke('write_file', bytes, { headers: { path: encodeURIComponent(this.path) } });
        this.modified = Date.now();
      },
    };
  }

  /** Known from the folder listing, so refreshing never reads file contents. */
  get lastModifiedMs() {
    return this.modified;
  }

  async isSameEntry(other: unknown) {
    return other instanceof TauriFileHandle && other.path === this.path;
  }

  async queryPermission() {
    return 'granted' as const;
  }

  async requestPermission() {
    return 'granted' as const;
  }
}

/** A folder on disk, shaped like the browser's FileSystemDirectoryHandle. */
export class TauriDirHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  constructor(readonly path: string) {
    this.name = baseName(path);
  }

  async *values(): AsyncGenerator<TauriFileHandle> {
    const { invoke } = await core();
    const entries = await invoke<DirEntry[]>('list_dir', { path: this.path });
    for (const e of entries) yield new TauriFileHandle(e.path, e.modified_ms);
  }

  async queryPermission() {
    return 'granted' as const;
  }

  async requestPermission() {
    return 'granted' as const;
  }
}

type StartIn = { path?: string } | string | undefined;
const startDir = (s: StartIn) => {
  if (!s || typeof s === 'string') return undefined;
  if (s instanceof TauriFileHandle) return dirName(s.path);
  return s.path;
};

function installShims() {
  const w = window as unknown as Record<string, unknown>;

  w.showOpenFilePicker = async () => {
    const { open } = await dialog();
    const p = await open({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: IMAGE_EXTS }] });
    if (!p || Array.isArray(p)) throw abort();
    return [new TauriFileHandle(p)];
  };

  w.showDirectoryPicker = async () => {
    const { open } = await dialog();
    const p = await open({ directory: true, multiple: false });
    if (!p || Array.isArray(p)) throw abort();
    return new TauriDirHandle(p);
  };

  w.showSaveFilePicker = async (o: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[]; startIn?: StartIn }) => {
    const { save } = await dialog();
    const dir = startDir(o?.startIn);
    const name = o?.suggestedName ?? 'image.png';
    const filters = (o?.types ?? []).map((t) => ({
      name: t.description,
      extensions: Object.values(t.accept)
        .flat()
        .map((e) => e.replace(/^\./, '')),
    }));
    const p = await save({ defaultPath: dir ? `${dir}${sep(dir)}${name}` : name, filters });
    if (!p) throw abort();
    return new TauriFileHandle(p);
  };

  platform.rememberDir = (dir) => {
    const path = (dir as unknown as { path?: string }).path;
    try {
      if (path) localStorage.setItem(LAST_DIR_KEY, path);
    } catch {
      /* ignore */
    }
  };
  platform.restoreDir = () => {
    try {
      const p = localStorage.getItem(LAST_DIR_KEY);
      return p ? (new TauriDirHandle(p) as unknown as FileSystemDirectoryHandle) : null;
    } catch {
      return null;
    }
  };
  platform.copyImage = async (png) => {
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeImage(new Uint8Array(await png.arrayBuffer()));
  };
}

if (isTauri) {
  platform.desktop = true;
  installShims();
}

/** What the desktop integration needs from the app's file session. */
interface Session {
  openHandle(h: FileSystemFileHandle): Promise<void>;
  dropHandle(h: FileSystemFileHandle): Promise<void>;
  useFolder(d: FileSystemDirectoryHandle): Promise<void>;
  confirmDiscard(): Promise<boolean>;
}

/**
 * Startup file ("Open with" / file association), drag and drop of files and
 * folders, and the unsaved-changes prompt when the window is closed.
 */
export async function initDesktop(files: Session) {
  if (!isTauri) return;
  const { invoke } = await core();
  const asFile = (p: string) => new TauriFileHandle(p) as unknown as FileSystemFileHandle;
  const asDir = (p: string) => new TauriDirHandle(p) as unknown as FileSystemDirectoryHandle;

  const openPath = async (p: string, dropped = false) => {
    const kind = await invoke<'file' | 'dir' | 'missing'>('path_kind', { path: p });
    if (kind === 'dir') await files.useFolder(asDir(p));
    else if (kind === 'file' && IMAGE_EXTS.includes(extOf(p)))
      await (dropped ? files.dropHandle(asFile(p)) : files.openHandle(asFile(p)));
  };

  const start = await invoke<string | null>('startup_path');
  if (start) await openPath(start);

  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  await getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type !== 'drop') return;
    const paths = e.payload.paths;
    // A folder wins; otherwise the first image.
    (async () => {
      for (const p of paths) {
        if ((await invoke('path_kind', { path: p })) === 'dir') return openPath(p);
      }
      // Dropped pictures are added on top of the open one (or opened if none is).
      for (const p of paths.filter((p) => IMAGE_EXTS.includes(extOf(p)))) await openPath(p, true);
    })();
  });

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().onCloseRequested(async (e) => {
    if (!(await files.confirmDiscard())) e.preventDefault();
  });

  // The installed app updates itself from GitHub Releases (the portable exe doesn't).
  if (await invoke<boolean>('is_installed')) {
    const checkForUpdate = async () => {
      if (platform.update) return;
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!update) return;
        platform.update = {
          version: update.version,
          install: async () => {
            if (!(await files.confirmDiscard())) return;
            toast(`Downloading magic-image ${update.version}…`);
            await update.downloadAndInstall();
            // Windows closes the app to run the installer; elsewhere restart.
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          },
        };
        platform.onUpdate?.();
      } catch (err) {
        console.warn('Update check failed', err); // offline, or GitHub unreachable
      }
    };
    checkForUpdate();
    setInterval(checkForUpdate, 6 * 60 * 60 * 1000);
  }
}
