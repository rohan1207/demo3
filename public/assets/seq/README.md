# Sequence frames (DRIP landing)

Keep these folders **in the repo** so Render (or any host) serves them from the **same origin** as the app (`/assets/seq/...`). That avoids a separate image CDN and extra bandwidth charges.

## Layout

- **Wide screens (>1081px):** `mobile-webp/ezgif-frame-001.png` … `ezgif-frame-810.png` (810 files)
- **Narrow (phones):** `desktop-webp/ezgif-frame-001.png` … `ezgif-frame-825.png` (825 files)

Paths in the browser look like `/assets/seq/mobile-webp/ezgif-frame-001.png` (Vite copies `public/` into the build).

## Git / push size

This folder is large (~100MB+). If `git push` fails over HTTPS, use **SSH** (`git@github.com:...`) or retry; do not move these to Cloudinary just for hosting — same-origin is the right default.
