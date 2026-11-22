// Loaded into the service worker (see workbox.importScripts in vite.config.ts).
// Receives images shared to the installed app, e.g. Android "Share → magic-image",
// keeps the file in a cache for a moment, and opens the app, which picks it up.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const file = form.getAll('image').find((f) => f && typeof f !== 'string');
      if (file) {
        const cache = await caches.open('image-magic-share');
        await cache.put(
          'shared-image',
          new Response(file, {
            headers: {
              'content-type': file.type || 'image/png',
              'x-file-name': encodeURIComponent(file.name || 'shared.png'),
            },
          }),
        );
      }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })(),
  );
});
