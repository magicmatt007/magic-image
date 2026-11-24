# magic-image

Image annotator: web app (PWA on GitHub Pages) and Windows desktop app (Tauri). The owner doesn't code; explain in plain words.

## Workflow (same for cloud and local sessions)
- Work on a branch and open a pull request. Merging into `main` deploys the web app (`.github/workflows/deploy.yml`).
- Ask before pushing, merging, or anything else that changes GitHub.
- **Releases:** in the PR, run `npm run bump -- X.Y.Z`. When that reaches `main`, `.github/workflows/desktop.yml` creates the tag `vX.Y.Z` and publishes the Windows release. Never push tags by hand.
- Cloud sessions start from GitHub's `main`; local work must be pushed or merged first. Locally, `git pull` before starting.

## Commands
- `npm run dev`: web app dev server. `npm run build`: type check + build (run before committing).
- `npm run desktop`: desktop app (needs Rust). `npm run icons`: regenerate icons.

## Don't change
- Storage keys stay `image-magic.*`, the IndexedDB name `image-magic` and cache `image-magic-share` (the app was renamed; changing them loses user settings). The Tauri `identifier` stays as is.
- `src-tauri/windows/hooks.nsh` removes old image-magic installs; keep it.
- The updater signing key lives outside the repo (GitHub secret `TAURI_SIGNING_PRIVATE_KEY`). Never commit or print it.
