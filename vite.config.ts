import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

// `--mode desktop` builds the frontend for the Tauri desktop app: same code,
// but no service worker (the app's files are bundled with the program).
export default defineConfig(({ mode }) => ({
  // Relative base so the built app works from any folder or sub-path.
  base: './',
  server: {
    // Rust build output changes constantly during `tauri dev`; don't watch it.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    VitePWA({
      // The desktop app needs no offline cache or updates via service worker.
      disable: mode === 'desktop',
      // 'prompt': the app decides when to switch versions, so an update never
      // reloads the page while there are unsaved annotations.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-web.svg'],
      manifest: {
        name: 'magic-image Web',
        short_name: 'magic-image Web',
        description: 'Lightweight image annotator for screenshots and pictures',
        theme_color: '#1b1f27',
        background_color: '#1b1f27',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-web.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        // Android (and other systems): appear in the Share menu for images.
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'image', accept: ['image/*', '.png', '.jpg', '.jpeg', '.webp', '.gif'] }],
          },
        },
        // Lets the installed app appear in the OS "Open with" menu for images.
        file_handlers: [
          {
            action: './',
            accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'] },
          },
        ],
      } as any,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Handles POSTs from the share target before Workbox's own routing.
        importScripts: ['share-target.js'],
      },
    }),
  ],
}));
