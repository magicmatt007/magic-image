import type { FileEntry } from '../files';

/** Thumbnail data URLs, shared by the folder panel and the gallery. */
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

async function makeThumb(e: FileEntry): Promise<string> {
  const file = e.file ?? (await e.handle!.getFile());
  // Tall enough to stay sharp in the gallery's largest tiles.
  const bmp = await createImageBitmap(file, { resizeHeight: 240, resizeQuality: 'medium' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.8);
}

export function thumbFor(e: FileEntry) {
  const key = thumbKey(e);
  let p = thumbCache.get(key);
  if (!p) {
    p = limited(() => makeThumb(e))
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
