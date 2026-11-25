# magic-image

**Live app: https://magicmatt007.github.io/magic-image/**

*Formerly called image-magic. The web app moved to the address above; the old one no longer works, so install it again from there. The Windows desktop app updates itself and removes the old image-magic install.*

A lightweight image annotator for screenshots and pictures. It runs in any modern browser on Linux, Windows and macOS, and can be installed as a desktop app (PWA) that works offline.

## Features

- **Open an image:** paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>, drag and drop, use the file picker, start from a blank canvas, or use "Open with" from the OS (installed app, Chrome/Edge only).
- **Edit files in place:** Save writes back to the file you opened. Save as writes a copy.
- **Browse a folder:** open a folder (for example your screenshots) and flip through its images in a side panel.
- **Annotate:**
  - arrows, lines, rectangles, ellipses and freehand drawing, solid or dashed; arrows with a head at one or both ends
  - text
  - callouts: speech bubbles with a tail pointing at something
  - see-through highlighter boxes
  - numbered step badges (1, 2, 3 …)
  - pixelate, to hide sensitive content
- **Edit annotations:** select, move, resize and rotate; box-select; duplicate; copy, cut and paste (also into another picture); change stacking order; delete; restyle (colour, width, text size, fill/outline, dashed).
  - A selected arrow or line shows handles at both ends to move them, and one in the middle: drag it to bend the arrow into a curve, or back onto the line to straighten it.
  - A selected callout has four corner handles that resize its box (the text wraps to the width) and a blue handle on the tip of its tail to move the pointer.
- **Pick a colour from the picture** with the pipette next to the colours: press, slide to the colour, release. Anything selected takes on the colour too.
- **Change the image:** crop, rotate 90°, flip, and resize. Annotations move with the image.
- **Undo and redo** for everything, including crops, rotations and opening a new image.
- **Output:** copy to the clipboard, or save as PNG or JPEG at the image's original resolution, whatever the zoom level.
- **Light and dark** themes, following the system setting.

## On phones and tablets

Install it from Chrome on Android (**⋮ → Add to home screen** / **Install app**). The app then adapts to touch screens:

- **Two fingers** pinch to zoom and drag to pan. One finger draws, selects and moves.
- Handles and hit areas are finger-sized, so even thin arrows are easy to grab at any zoom level.
- **Compact layout:** one scrolling toolbar row (tools first). Colours and sizes open from the palette button.
- Text gets a **Done** button, and the hints describe touch actions instead of keyboard shortcuts.
- **Share into the app:** take a screenshot, tap **Share → magic-image**, annotate it, then use the app's **Share** button to send the result on (WhatsApp, email, Photos…). Save still downloads a copy. The app appears in the Share menu once it's installed; if you installed it before this version, Android may take a while to pick up the change, and reinstalling makes it immediate.
- The folder panel is hidden on phones, because phone browsers can't open folders. Open picks images from the gallery or files.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V A L R E P T K H N B C | Select, Arrow, Line, Rectangle, Ellipse, Pen, Text, Callout, Highlighter, Number step, Blur/pixelate, Crop |
| I | Pick a colour from the picture (Esc cancels) |
| Ctrl+V / Ctrl+Shift+V | Paste copied annotations, or add the clipboard picture on top / start a new picture from it |
| Ctrl+O / Ctrl+Shift+O | Open file / open folder |
| Ctrl+B | Show or hide the folder panel |
| Ctrl+F | Search the open folder by name |
| Ctrl+G | Show the open folder as a gallery |
| Page Down / Page Up | Next / previous image in the folder |
| Ctrl+C / Ctrl+X | Copy / cut the selected annotations; with nothing selected, Ctrl+C copies the annotated image |
| Ctrl+Shift+C | Copy the annotated image (even with a selection) |
| Ctrl+S / Ctrl+Shift+S | Save (over the opened file) / Save as |
| Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) | Undo / redo |
| Del or Backspace | Delete the selection |
| Ctrl+D / Ctrl+A | Duplicate the selection / select all |
| ] / [ | Bring to front / send to back |
| Shift while drawing | Snap lines to 45°, make squares and circles |
| Ctrl+scroll, Ctrl+= / Ctrl+− | Zoom |
| Ctrl+0 / Ctrl+1 | Fit to window / 100% |
| Scroll, or Space+drag | Pan |
| Enter / Esc (crop) | Apply / cancel the crop |
| Ctrl+Enter or Esc (text) | Finish editing text |

Double-click a text annotation or callout to edit it. For a callout, drag from the spot to point at to where the text should go, or just click the spot. With the **Fill / outline** option on, rectangles and ellipses are filled and text gets a contrasting outline.

## Combining several pictures

With a picture open, **Ctrl+V** (or the Paste button) **adds** the clipboard picture on top of it instead of replacing it. The pasted picture lands in the middle of the view at full resolution, already selected, so you can drag it into place, resize it from the corners (the aspect ratio stays fixed) or delete it. The same happens when you drop image files onto an open picture, or use **Insert picture from file** (several files at once fan out slightly). Pasted pictures stay above earlier ones but below arrows, text and other annotations. Pixelate also covers them.

- **The canvas grows automatically:** when a picture or annotation sticks out past the edge, the canvas grows to include it, and the new area is white. Undo reverts both.
- **Fit canvas to content** trims the canvas to the area covered by pictures and annotations, which is handy after assembling on a blank canvas.
- **Ctrl+Shift+V** (or **New picture from clipboard**) starts a new picture from the clipboard, as before.

For example: start with **Blank canvas**, paste several screenshots, arrange them, add arrows and text, then **Fit canvas to content** and save.

## Working with files and folders

**Save over the original.** When you open an image from disk (with Open, by dropping a file, from the folder panel, or with "Open with"), **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) writes the annotated image back to that same file, in the same format (PNG, JPEG or WebP). The first time, the browser asks for permission to edit the file. **Save as** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>) writes a copy under a new name, and you then keep editing that copy. Pasted images have no file yet, so Save asks where to put them.

> Saving flattens the annotations into the picture, so the original version of the file is replaced. Undo works until you switch to another image. Use **Save as** if you want to keep the original.

**Browse a folder.** Click the folder button (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>, or drop a folder onto the app) and pick a folder, for example your screenshots folder. The side panel lists its images with thumbnails, newest first (sorted by name, which for screenshots contains the date and time). Click one, or use <kbd>Page Down</kbd>/<kbd>Page Up</kbd>, to move between images. For big folders, type in the **search box** at the top of the panel (<kbd>Ctrl</kbd>+<kbd>F</kbd>) to filter by name: every word must appear in the name, so `11-03 0810` finds a screenshot from 3 November at 08:10. The count shows how many match. <kbd>Enter</kbd> opens the first match, <kbd>Esc</kbd> clears the search, and <kbd>↓</kbd>/<kbd>↑</kbd> move through the list. Page Up/Down and the toolbar arrows then step through the matches only. The **sort** menu orders the list by name (newest or A→Z) or by date modified (recent or oldest), and the app remembers your choice. The list refreshes when you come back to the app, so new screenshots show up. If you switch images with unsaved changes, the app asks whether to save them. The app remembers the folder: next time it reopens it straight away, or after one click on **Reopen** if the browser wants to confirm permission again.

These features use the browser's File System Access API, which is available in **Chrome, Edge and other Chromium-based browsers** (including the installed app).

**Gallery.** For an overview of a big folder, click the grid button at the top of the folder panel (or press <kbd>Ctrl</kbd>+<kbd>G</kbd>). The gallery fills the window with thumbnails of all the folder's images; the **Size** slider makes them bigger or smaller (remembered). Sorted by date, the images are grouped under Today, Yesterday, This week and then by month. Search and sort are the same as in the panel. The open image is highlighted. Click an image (or move with the arrow keys and press <kbd>Enter</kbd>) to open it; <kbd>Esc</kbd> closes the gallery.

**Basic mode.** Some computers block websites from accessing local folders. On company laptops this is usually a policy set by IT (for example Chrome's `DefaultFileSystemReadGuardSetting` / `DefaultFileSystemWriteGuardSetting`). Firefox and Safari don't support the API at all. In those cases the folder panel explains what happened, shows the technical error, and offers **Choose folder (basic mode)**. That uses the browser's classic folder picker, which always works: you can browse and annotate the folder's images, but the list doesn't refresh by itself. If read access is still allowed, the app opens the folder read-only instead.

**Saving when file editing is blocked.** If the browser isn't allowed to write files (the site info panel shows "File editing: Not allowed"), the app can't replace the original. Save then downloads a copy in the same format, named `<name>-annotated.<ext>` (for example `screenshot-annotated.png`). To get those copies next to your screenshots, set the browser's download **Location** to your screenshots folder (`edge://settings/downloads` or `chrome://settings/downloads`). If **Ask where to save each file** isn't locked by your organisation, turning it on lets you choose the folder each time. The folder panel picks up the new copy shortly after the download. The app explains this the first time it happens, and the status bar link **Save downloads a copy – why?** shows the explanation again. Replacing originals directly needs IT to allow the site for file editing (Edge/Chrome policy `FileSystemWriteAskForUrls`).

## Offline use

magic-image works without an internet connection:

- **First visit:** the first time you open the app (online), a service worker stores all of its files (HTML, JavaScript, CSS and icons, about 270 KB) in the browser's cache.
- **After that:** the app loads from that cache, online or offline. This works in a normal browser tab as well as in the installed desktop app.
- **Your images stay on your computer.** All editing, opening and saving happens locally in the browser. Images are never uploaded anywhere, even when you're online.
- **Updates:** when the app is online, it checks for a newer version at startup, whenever you switch back to it, and every 30 minutes. If no image is open, it switches to the new version straight away. Otherwise the status bar shows **New version available – update**, so a reload never throws away unsaved annotations. Offline, you keep using the version you last had.
- **Which version am I on?** The status bar shows the version, commit and build time, for example `v0.2.0 · e8394f4 · 15 Nov 2026, 14:05`. The commit matches the repository's history and the GitHub Pages deploy. On a phone the label only shows when no picture is open (close it with the **×** button); with a picture open, tap the picture info in the status bar to see it.

To check it yourself: open the app once, disconnect from the network, and reload it (or launch the installed app). The offline setup is configured in `vite.config.ts` (vite-plugin-pwa / Workbox) and registered in `src/main.ts`.

## Desktop app (Windows)

Some company computers block websites from writing files, so the web app can only download copies there. The **desktop app** is the same app, packaged as a small Windows program (about 10 MB, built with [Tauri](https://tauri.app/) on the Edge WebView2 engine that Windows 11 includes). Browser policies don't apply to it:

- **Save (Ctrl+S) overwrites the original file** directly, in its own format. Save as writes anywhere.
- **Open folder** opens any folder with the native dialog. The folder panel (search, sort, Page Up/Down) works the same, and the folder is reopened on the next start.
- **Open with:** the installer registers magic-image for PNG, JPEG, WebP, GIF and BMP files. Dropping files or folders onto the window works too.
- Closing the window with unsaved changes asks first.

**Download** it from the [Releases page](https://github.com/magicmatt007/magic-image/releases):
- `magic-image_<version>_x64-setup.exe` installs for your user account only (no admin rights needed).
- `magic-image-portable.exe` runs without installing anything.

The app isn't code-signed, so Windows SmartScreen may warn on first start: choose **More info → Run anyway**. On a company laptop, check that you're allowed to run your own software: IT may block unknown programs. Its status bar shows the version (with "desktop").

**Updates:** the installed app (version 0.7.0 or later) checks GitHub for a new release at startup and every few hours. When there is one, the status bar shows **Version x.y.z available – install**: it asks about unsaved changes, downloads the new installer, installs it and restarts. Updates are signed, and the app only accepts updates signed with this project's key. The portable exe doesn't update itself; download the new one from the Releases page. Versions before 0.7.0 have no updater, so install 0.7.0 by hand once.

**Releasing:** run `npm run bump -- 0.9.0` (it sets the version in package.json, package-lock.json, Cargo.toml and Cargo.lock), commit, and get it onto `main`, usually by merging a pull request. `.github/workflows/desktop.yml` sees the new version, creates the tag `v0.9.0`, builds on Windows and publishes the release with both files. No one needs to push a tag, so this works from cloud sessions too.

**Building and running it locally** (Linux shown; see the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for other systems):

```bash
sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
npm install
npm run desktop                     # dev window with live reload
npx tauri build --no-bundle         # release binary in src-tauri/target/release/
# A full build with installer also signs the update files and needs the private key:
# TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/image-magic-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD= npx tauri build
```

How it works: the frontend is shared with the web app. `src/platform/tauri.ts` provides the browser file APIs the app already uses (`showOpenFilePicker`, `showDirectoryPicker`, `showSaveFilePicker` and file/folder handles), backed by native dialogs and a few Rust commands in `src-tauri/src/lib.rs`. Those commands list images, read files, and write atomically through a temporary file and rename. The desktop build (`vite build --mode desktop`) leaves out the service worker.

## Run it

```bash
npm install
npm run dev        # development server at http://localhost:5173
npm run build      # static site in dist/
npm run preview    # serve the production build at http://localhost:4173
```

Every push to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`. `dist/` is a plain static site: host it anywhere (GitHub Pages, Netlify, any web server, including in a sub-folder). Copying to the clipboard and installing as an app need HTTPS or `localhost`.

## Install as a desktop app

Open the app in Chrome or Edge and click the install icon in the address bar (or choose **⋮ → Cast, save and share → Install page as app**). It then gets its own window and launcher icon, works offline, and appears in the OS "Open with" menu for image files. Safari on macOS: **File → Add to Dock**. Firefox can't install it, but the app works there in a normal tab. Installed this way it is called **magic-image Web** and has a teal/green icon, so it can be told apart from the Windows desktop app (**magic-image**, blue/purple icon).

## Project layout

- `src/editor.ts` sets up the Konva stage, layers, selection, zoom/pan, image operations and export.
- `src/tools/` has one module per tool (`drag.ts` covers the simple press-drag shapes).
- `src/shapes.ts` creates annotation shapes and applies styles to them.
- `src/history.ts` keeps undo/redo snapshots (base image and serialized annotations).
- `src/imageOps.ts` holds the pure canvas operations (rotate, flip, crop, resize, pixelate).
- `src/files.ts` handles file and folder handles: opening, saving in place, Save as, the folder list, the remembered folder, the unsaved-changes prompt, paste, drag and drop, and "Open with".
- `src/io.ts` decodes and encodes images, copies to the clipboard, and downloads files.
- `src/ui/` builds the toolbar, style bar, folder panel (`filePanel.ts`), gallery (`gallery.ts`), icons, toasts and CSS.
- `scripts/make-icons.mjs` regenerates the PWA PNG icons (`npm run icons`).

The project is built with Vite, TypeScript, [Konva](https://konvajs.org/) and vite-plugin-pwa. `package.json` pins `serialize-javascript` to 6.0.2 so that builds work on Node 18.

## Licence

Copyright (C) 2026 magicmatt007

magic-image is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. Anyone may use it, including at work. If you distribute a modified version, or run one as a website, you must publish its full source code under the same licence.

magic-image is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [LICENSE](LICENSE) file for details.
