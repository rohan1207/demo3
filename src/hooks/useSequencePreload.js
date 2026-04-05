import { useState, useEffect, useCallback } from 'react';

/**
 * Optional absolute base for sequence PNGs when they are not in the deployed bundle
 * (e.g. `public/assets/seq/` gitignored — host the same folder layout on R2/S3/CDN).
 * Render: add `VITE_SEQUENCE_BASE=https://your-cdn.example.com` (no trailing slash) and rebuild.
 */
const SEQUENCE_BASE = (import.meta.env.VITE_SEQUENCE_BASE || '').replace(/\/$/, '');

function sequenceSrc(pathFromSiteRoot) {
  if (SEQUENCE_BASE) return `${SEQUENCE_BASE}${pathFromSiteRoot}`;
  return pathFromSiteRoot;
}

// Load every Nth frame to keep memory under ~2-3 GB.
// The rAF lerp in DRIPLandingSequence smooths skipped frames invisibly.
const FRAME_STEP = 1; // load all frames; memory is manageable without ImageBitmap conversion

const DESKTOP_TOTAL_FRAMES = 810;
// Phone (≤1081px): desktop-webp folder, ezgif-frame-001 … 825
const MOBILE_START_FRAME = 1;
const MOBILE_END_FRAME = 825;

const desktopLoadCount = Math.ceil(DESKTOP_TOTAL_FRAMES / FRAME_STEP);
const MOBILE_TOTAL_FRAMES = Math.ceil((MOBILE_END_FRAME - MOBILE_START_FRAME + 1) / FRAME_STEP);

/** Must match DripLandingSequence: wide vs narrow uses different asset folders (same 1081px breakpoint). */
const SEQUENCE_MOBILE_BREAKPOINT_PX = 1081;

// Landing splash: 100% means all frames for the current screen size are loaded.
const LANDING_PRELOAD_TARGET = 1;

// Wide screens (>1081px): mobile-webp/ — 810 frames (ezgif-frame-001 … 810).
function framePathDesktop(loadIndex) {
  const num = loadIndex * FRAME_STEP + 1;
  return sequenceSrc(
    `/assets/seq/mobile-webp/ezgif-frame-${String(num).padStart(3, '0')}.png`,
  );
}

// Phone (≤1081px): desktop-webp/ — 825 frames (ezgif-frame-001 … 825).
function framePathMobile(loadIndex) {
  const num = MOBILE_START_FRAME + loadIndex * FRAME_STEP;
  return sequenceSrc(
    `/assets/seq/desktop-webp/ezgif-frame-${String(num).padStart(3, '0')}.png`,
  );
}

// Legacy baseline scroll height — scales phone scroll distance with frame count
const LEGACY_MOBILE_FRAME_COUNT = 564;
/** Values below 1 shorten total mobile scroll (more frames per px). Desktop layout is unchanged. */
const MOBILE_SCROLL_DISTANCE_SCALE = 0.55;
const MOBILE_SEQUENCE_SCROLL_VH = Math.round(
  ((2000 * MOBILE_TOTAL_FRAMES) / LEGACY_MOBILE_FRAME_COUNT) * MOBILE_SCROLL_DISTANCE_SCALE,
);

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // null = failed, skip silently
    img.src = src;
  });
}

function createManager(total, pathFn) {
  return {
    total,
    pathFn,
    loaded: 0,
    frames: null,
    ready: false,
    entryReady: false,
    error: null,
    started: false,
    subscribers: new Set(),
  };
}

const preloadManagers = {
  desktop: createManager(desktopLoadCount, framePathDesktop),
  mobile: createManager(MOBILE_TOTAL_FRAMES, framePathMobile),
};

function toSnapshot(manager) {
  return {
    frames: manager.frames,
    ready: manager.ready,
    entryReady: manager.entryReady,
    error: manager.error,
    loaded: manager.loaded,
    total: manager.total,
  };
}

function subscribeManager(manager, callback) {
  manager.subscribers.add(callback);
  callback(toSnapshot(manager));
  return () => {
    manager.subscribers.delete(callback);
  };
}

function notifyManager(manager) {
  const snapshot = toSnapshot(manager);
  manager.subscribers.forEach((cb) => cb(snapshot));
}

function entryReadyThreshold(total) {
  return Math.max(1, Math.ceil(total * LANDING_PRELOAD_TARGET));
}

/**
 * Home / canvas can show as soon as frame 0 is drawable.
 * Home page waits for `ready` (full sequence) before hiding the preloader. Do not tie entryReady to total frame count.
 */
function ensureEntryReady(manager) {
  if (manager.entryReady) return;
  const hasFirstFrame = Boolean(manager.frames?.[0]);
  if (hasFirstFrame && manager.loaded >= 1) {
    manager.entryReady = true;
  }
}

function startManager(manager) {
  if (manager.started) return;
  manager.started = true;

  (async () => {
    const BATCH = 20;
    const results = new Array(manager.total).fill(null);
    manager.frames = results;
    notifyManager(manager);

    try {
      // Load first frame first so canvas always has a drawable fallback frame.
      // Short delay + one retry helps flaky reload / cache timing (desktop + mobile).
      const path0 = manager.pathFn(0);
      let firstFrame = await loadImage(path0);
      if (!firstFrame) {
        await new Promise((r) => setTimeout(r, 80));
        const bust = path0.includes('?') ? '&' : '?';
        firstFrame = await loadImage(`${path0}${bust}_=${Date.now()}`);
      }
      if (!firstFrame) {
        manager.ready = true;
        manager.entryReady = false;
        manager.error = new Error(
          SEQUENCE_BASE
            ? 'Sequence frames failed to load from VITE_SEQUENCE_BASE. Check URLs and CORS.'
            : 'No sequence frames on this host. Commit public/assets/seq/ or set VITE_SEQUENCE_BASE to a CDN mirror of that folder.',
        );
        notifyManager(manager);
        return;
      }
      results[0] = firstFrame;
      manager.loaded = 1;
      ensureEntryReady(manager);
      notifyManager(manager);

      for (let start = 1; start < manager.total; start += BATCH) {
        const end = Math.min(start + BATCH, manager.total);
        const batch = Array.from({ length: end - start }, (_, j) => {
          const idx = start + j;
          return loadImage(manager.pathFn(idx)).then((img) => {
            if (img) {
              results[idx] = img;
              manager.loaded += 1;
            }
            ensureEntryReady(manager);
          });
        });
        await Promise.all(batch);

        // Batch-level notify keeps UI smooth without render thrash.
        notifyManager(manager);
      }

      manager.ready = true;
      // Never advertise entryReady without a drawable first frame — avoids blank white canvas on /home reload (all viewports).
      manager.entryReady = Boolean(manager.frames?.[0]);

      if (!manager.entryReady) {
        manager.error = new Error(
          'No sequence frames loaded. Wide: public/assets/seq/mobile-webp/ (810) · Phone: public/assets/seq/desktop-webp/ (001–825).'
        );
      }

      notifyManager(manager);
    } catch (err) {
      manager.error = err instanceof Error ? err : new Error('Failed to preload sequence frames');
      manager.ready = true;
      manager.entryReady = Boolean(manager.frames?.[0]);
      notifyManager(manager);
    }
  })();
}

/**
 * Progressive preload (singleton per layout: desktop vs phone — same paths as DripLandingSequence at 1081px).
 * - entryReady: first frame is drawable (show Home canvas + hero without waiting for the full sequence)
 * - ready: full sequence loaded (HomePage hides video preloader when true)
 *
 * @param {function(number): void} [onProgress] — 0–100; if options.landingProgress, denom = full frame count
 */
export function useSequencePreload(onProgress, options = {}) {
  const landingProgress = options.landingProgress === true;

  const getInitialSnapshot = () => {
    const isMobile =
      typeof window !== 'undefined' ? window.innerWidth <= SEQUENCE_MOBILE_BREAKPOINT_PX : false;
    return toSnapshot(isMobile ? preloadManagers.mobile : preloadManagers.desktop);
  };
  const [snapshot, setSnapshot] = useState(getInitialSnapshot);

  useEffect(() => {
    const isMobile =
      typeof window !== 'undefined' ? window.innerWidth <= SEQUENCE_MOBILE_BREAKPOINT_PX : false;
    const manager = isMobile ? preloadManagers.mobile : preloadManagers.desktop;
    startManager(manager);
    const unsubscribe = subscribeManager(manager, setSnapshot);
    return unsubscribe;
  }, []);

  const report = useCallback(() => {
    if (!onProgress) return;
    if (snapshot.total > 0) {
      if (landingProgress) {
        const denom = entryReadyThreshold(snapshot.total);
        onProgress(Math.min(100, Math.floor((100 * snapshot.loaded) / denom)));
      } else {
        onProgress(Math.min(100, Math.floor((100 * snapshot.loaded) / snapshot.total)));
      }
    } else {
      onProgress(100);
    }
  }, [onProgress, landingProgress, snapshot.loaded, snapshot.total]);

  useEffect(() => {
    report();
  }, [report]);

  return {
    frames: snapshot.frames,
    ready: snapshot.ready,
    entryReady: snapshot.entryReady,
    error: snapshot.error,
    loaded: snapshot.loaded,
    total: snapshot.total,
  };
}

export {
  DESKTOP_TOTAL_FRAMES as TOTAL_FRAMES,
  framePathDesktop as framePath,
  framePathMobile,
  MOBILE_TOTAL_FRAMES,
  MOBILE_SEQUENCE_SCROLL_VH,
  LANDING_PRELOAD_TARGET,
  SEQUENCE_MOBILE_BREAKPOINT_PX,
};
