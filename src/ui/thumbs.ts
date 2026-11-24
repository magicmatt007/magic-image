import { entryHandle, type FileEntry } from '../files';

/** Thumbnail URLs, shared by the folder panel and the gallery. */
const thumbCache = new Map<string, Promise<string>>();
/** Finished thumbnails, so re-renders show them immediately (no flicker). */
const thumbReady = new Map<string, string>();
const thumbKey = (e: FileEntry) => `${e.name}|${e.modified}`;

/**
 * Decoding a full-size screenshot is slow on phones; doing dozens at once makes
 * every thumbnail late. A few at a time, in the order they scrolled into view.
 */
const MAX_PARALLEL = 3;
let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * Thumbnails of folder images are also kept in the browser's cache storage, so
 * the next start shows them at once instead of decoding every picture again.
 */
const STORE = 'image-magic-thumbs';
const storeUrl = (folder: string, e: FileEntry) =>
  `${location.origin}/__thumbs/${encodeURIComponent(folder)}/${encodeURIComponent(e.name)}/${e.modified}`;
const folderPrefix = (folder: string) => `${location.origin}/__thumbs/${encodeURIComponent(folder)}/`;
const openStore = () => (self.caches ? caches.open(STORE).catch(() => null) : Promise.resolve(null));

async function storedThumb(e: FileEntry): Promise<string> {
  if (!e.dir) return '';
  const res = await (await openStore())?.match(storeUrl(e.dir.name, e)).catch(() => undefined);
  return res ? URL.createObjectURL(await res.blob()) : '';
}

/** Forget stored thumbnails of pictures no longer in the folder (or changed). */
export async function pruneThumbs(folder: string, entries: FileEntry[]) {
  const store = await openStore();
  if (!store) return;
  const keep = new Set(entries.map((e) => storeUrl(folder, e)));
  const prefix = folderPrefix(folder);
  for (const req of await store.keys().catch(() => [] as readonly Request[]))
    if (req.url.startsWith(prefix) && !keep.has(req.url)) store.delete(req).catch(() => {});
}

async function makeThumb(e: FileEntry): Promise<string> {
  const file = e.file ?? (await (await entryHandle(e)).getFile());
  // Tall enough to stay sharp in the gallery's largest tiles.
  const bmp = await createImageBitmap(file, { resizeHeight: 240, resizeQuality: 'medium' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8));
  if (!blob) throw new Error('thumbnail could not be encoded');
  if (e.dir) {
    const res = new Response(blob, { headers: { 'content-type': 'image/jpeg' } });
    (await openStore())?.put(storeUrl(e.dir.name, e), res).catch(() => {});
  }
  return URL.createObjectURL(blob);
}

export function thumbFor(e: FileEntry) {
  const key = thumbKey(e);
  let p = thumbCache.get(key);
  if (!p) {
    // A stored thumbnail is quick to load, so it doesn't wait in the queue.
    p = storedThumb(e)
      .catch(() => '')
      .then((stored) => stored || limited(() => makeThumb(e)))
      .then((src) => (thumbReady.set(key, src), src))
      .catch(() => '');
    thumbCache.set(key, p);
  }
  return p;
}

/** The thumbnail if it's already made, else ''. */
export const readyThumb = (e: FileEntry) => thumbReady.get(thumbKey(e)) ?? '';

export type ThumbImg = HTMLImageElement & { entry?: FileEntry };

/** Lazily fills in thumbnails of images scrolled (nearly) into view of `root`. */
export function lazyThumbs(root: HTMLElement) {
  const io = new IntersectionObserver(
    (items) => {
      for (const it of items) {
        if (!it.isIntersecting) continue;
        const img = it.target as ThumbImg;
        io.unobserve(img);
        if (img.entry)
          thumbFor(img.entry).then((src) => {
            if (src) img.src = src;
            else img.classList.add('thumb-failed'); // stop the loading pulse
          });
      }
    },
    { root, rootMargin: '300px' },
  );
  return (img: ThumbImg, e: FileEntry) => {
    img.entry = e;
    const ready = readyThumb(e);
    if (ready) img.src = ready;
    else io.observe(img);
  };
}

export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
