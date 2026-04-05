import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MOBILE_SEQUENCE_SCROLL_VH, SEQUENCE_MOBILE_BREAKPOINT_PX } from '../../hooks/useSequencePreload';

gsap.registerPlugin(ScrollTrigger);

/** Scroll container for the sequence: same for desktop & mobile (App uses overflow on <main>). */
function getHomeScrollRoot() {
  if (typeof document === 'undefined') return null;
  return (
    document.querySelector('main.main-content') ||
    document.querySelector('main[class~="main-content"]') ||
    document.querySelector('main')
  );
}

const ASSETS = '/assets/images';

/** ScrollTrigger: seconds for playhead to ease toward scroll (not raw `true` = less harsh scrubbing). */
const SCROLL_SCRUB_SMOOTH_SEC = 0.42;
/** rAF lerp toward fractional frame target; lower = silkier, higher = snappier. */
const FRAME_LERP = 0.13;

const NUM_SECTIONS = 11;

/** Mobile scroll heights: total must equal MOBILE_SEQUENCE_SCROLL_VH. Last section is 2× a normal slice so sticky CTA has runway; first 10 share the remainder. */
const MOBILE_SCROLL_TOTAL = MOBILE_SEQUENCE_SCROLL_VH;
const lastMobileSectionVh = (2 * MOBILE_SCROLL_TOTAL) / NUM_SECTIONS;
const firstTenMobileSectionVh = (MOBILE_SCROLL_TOTAL - lastMobileSectionVh) / 10;

/**
 * Scroll progress before which “Ready to experience” stays hidden — only the tail of the scrub
 * (last frames) crosses this, so the CTA effectively appears at the end.
 * Desktop block ≈ 1200vh → 1198/1200 is the last ~2vh before progress hits 1.
 * Mobile: final slice is 2/11 of total → (9 + 1.955)/11 — small nudge later than prior.
 */
function getReadySectionHoldProgress() {
  if (typeof window === 'undefined') return 0.993;
  return window.innerWidth <= SEQUENCE_MOBILE_BREAKPOINT_PX
    ? (9 + 1.955) / 11
    : 1198 / 1200;
}

/**
 * SCROLL MODEL: Canvas is fixed while scrolling through the sequence. When the end of the
 * animation (last frame) is reached, the canvas is "unsticky" (hidden) so content below
 * (DummySection, Footer in App) is fully visible. Footer lives in App.jsx only.
 */
export default function DRIPLandingSequence({ frames, sequenceReady }) {
  const sequenceBlockRef = useRef(null);
  const canvasRef = useRef(null);
  const mobileFinalReadyRef = useRef(null);
  const desktopFinalReadyRef = useRef(null);
  const [readyExperiencePinned, setReadyExperiencePinned] = useState(false);
  const [readyCtaAllowed, setReadyCtaAllowed] = useState(false);
  const readyCtaAllowedPrevRef = useRef(false);
  // Lerp state — target is set by ScrollTrigger, current is advanced each rAF tick
  const targetFrameRef = useRef(0);
  const currentFrameRef = useRef(0);
  const sequenceProgressRef = useRef(0);
  const rafIdRef = useRef(null);

  // Reload / client navigations: start at top so scroll-driven frame index matches the hero (frame 0).
  useLayoutEffect(() => {
    if (!sequenceReady) return;
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    const main = getHomeScrollRoot();
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
    targetFrameRef.current = 0;
    currentFrameRef.current = 0;
    sequenceProgressRef.current = 0;
    readyCtaAllowedPrevRef.current = false;
    setReadyCtaAllowed(false);
    requestAnimationFrame(() => {
      ScrollTrigger.refresh();
    });
  }, [sequenceReady]);

  useEffect(() => {
    if (!frames || frames.length === 0 || !sequenceBlockRef.current || !canvasRef.current) return;

    const rootEl = sequenceBlockRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    if (!container || !ctx) return;

    const maxFrame = frames.length - 1;
    let lastDrawn = -1;

    function syncCanvasSize() {
      const w = Math.max(1, Math.round(container.clientWidth));
      const h = Math.max(1, Math.round(container.clientHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** Full frame visible, no crop; always paint background so missing frames never show a transparent canvas. */
    function drawFrame(index) {
      const i = Math.max(0, Math.min(index, maxFrame));
      const img = frames[i];
      if (!ctx) return;
      const cw = Math.max(1, Math.round(container.clientWidth));
      const ch = Math.max(1, Math.round(container.clientHeight));
      if (cw < 1 || ch < 1) return;
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      if (!img) return;

      const iw = img.naturalWidth || 1;
      const ih = img.naturalHeight || 1;
      const scale = Math.min(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    const scroller = getHomeScrollRoot() || window;

    syncCanvasSize();
    const ro = new ResizeObserver(() => {
      syncCanvasSize();
      lastDrawn = -1;
      drawFrame(Math.min(Math.round(currentFrameRef.current), maxFrame));
      ScrollTrigger.refresh();
    });
    ro.observe(container);

    // rAF loop: lerp toward fractional scroll target so frames ease instead of snapping on every wheel tick.
    function renderLoop() {
      const target = targetFrameRef.current;
      const current = currentFrameRef.current;
      const next = current + (target - current) * FRAME_LERP;

      const snapped = Math.abs(next - target) < 0.04 ? target : next;
      currentFrameRef.current = snapped;

      const displayFrame = Math.min(Math.round(snapped), maxFrame);
      if (displayFrame !== lastDrawn) {
        drawFrame(displayFrame);
        lastDrawn = displayFrame;
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
    }

    rafIdRef.current = requestAnimationFrame(renderLoop);

    let stInstance;
    const attachScrollTrigger = () => {
      if (stInstance) stInstance.kill();
      stInstance = ScrollTrigger.create({
        trigger: rootEl,
        scroller,
        start: 'top top',
        end: 'bottom top',
        scrub: SCROLL_SCRUB_SMOOTH_SEC,
        onUpdate: (self) => {
          const p = self.progress;
          sequenceProgressRef.current = p;
          targetFrameRef.current = p * maxFrame;
          const hold = getReadySectionHoldProgress();
          const allowed = p >= hold - 1e-6;
          if (allowed !== readyCtaAllowedPrevRef.current) {
            readyCtaAllowedPrevRef.current = allowed;
            setReadyCtaAllowed(allowed);
          }
        },
      });
      targetFrameRef.current = 0;
      currentFrameRef.current = 0;
      sequenceProgressRef.current = 0;
      ScrollTrigger.refresh();
    };

    // Double rAF: layout & scroll parent ready (desktop & mobile hard reload).
    let bootOuter = null;
    let bootInner = null;
    bootOuter = requestAnimationFrame(() => {
      bootInner = requestAnimationFrame(() => {
        attachScrollTrigger();
        drawFrame(0);
      });
    });

    const refreshST = () => {
      syncCanvasSize();
      lastDrawn = -1;
      drawFrame(Math.min(Math.round(currentFrameRef.current), maxFrame));
      ScrollTrigger.refresh();
    };

    const onPageShow = (e) => {
      if (e.persisted) attachScrollTrigger();
      refreshST();
    };
    const onWindowLoad = () => {
      attachScrollTrigger();
      refreshST();
    };
    window.addEventListener('pageshow', onPageShow);
    // `load` may already have fired (cached reload); still run setup once.
    if (document.readyState === 'complete') {
      requestAnimationFrame(onWindowLoad);
    } else {
      window.addEventListener('load', onWindowLoad, { once: true });
    }

    let vv;
    if (typeof window !== 'undefined' && window.visualViewport) {
      vv = window.visualViewport;
      vv.addEventListener('resize', refreshST);
    }

    return () => {
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('load', onWindowLoad);
      if (vv) vv.removeEventListener('resize', refreshST);
      if (bootOuter != null) cancelAnimationFrame(bootOuter);
      if (bootInner != null) cancelAnimationFrame(bootInner);
      ro.disconnect();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (stInstance) stInstance.kill();
    };
  }, [frames]);

  // Phone + desktop: fixed “Ready to experience” while final section is in the pin band, and keep it through scroll progress 1 (last frame) until user scrolls back.
  useEffect(() => {
    if (!sequenceReady) return;

    const scroller = getHomeScrollRoot() || window;

    const checkPinZone = () => {
      const isMobileLayout = window.innerWidth <= SEQUENCE_MOBILE_BREAKPOINT_PX;
      const target = isMobileLayout ? mobileFinalReadyRef.current : desktopFinalReadyRef.current;
      const progress = sequenceProgressRef.current;
      const holdFrom = getReadySectionHoldProgress();

      const pinByRect = (() => {
        if (!target || progress < holdFrom - 1e-6) return false;
        const rect = target.getBoundingClientRect();
        const pinThresholdFromTop = window.innerHeight * 0.12;
        const sectionStillVisibleBelowTop = rect.bottom > 0;
        const inUpperBand = rect.top <= pinThresholdFromTop;
        return sectionStillVisibleBelowTop && inUpperBand;
      })();

      const pinThroughLastFrames = progress >= holdFrom - 1e-6 && progress <= 1 + 1e-6;

      setReadyExperiencePinned(pinByRect || pinThroughLastFrames);
    };

    checkPinZone();
    scroller.addEventListener('scroll', checkPinZone, { passive: true });
    window.addEventListener('resize', checkPinZone);

    return () => {
      scroller.removeEventListener('scroll', checkPinZone);
      window.removeEventListener('resize', checkPinZone);
    };
  }, [sequenceReady]);

  const scrollToBottom = () => {
    const main = getHomeScrollRoot();
    if (main) main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };
  if (!sequenceReady) {
    return (
      <div className="DRIP-landing-sequence-container flex h-screen min-h-[100dvh] items-center justify-center bg-white">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="DRIP-landing-sequence-container">
      {/* Wrapper so sequence + footer sit above the fixed canvas and are visible when you scroll past the frames */}
      <div className="DRIP-sequence-content-wrapper">
      <div ref={sequenceBlockRef} className="DRIP-sequence-block">
        {/* Desktop (≥1082px): invisible scroll slices drive frames; only final CTA is visible */}
        <div className="hidden min-[1082px]:block">
          {Array.from({ length: 10 }, (_, i) => (
            <section
              key={`d-scroll-${i}`}
              className="pointer-events-none min-h-screen w-full select-none"
              aria-hidden="true"
            />
          ))}
          {/* Tall runway: sticky in-flow copy until pin hands off to fixed centered overlay */}
          <section
            ref={desktopFinalReadyRef}
            className="min-h-[200vh] w-full flex items-start justify-center px-6 pt-[12vh] lg:px-24 lg:pt-[14vh]"
          >
            {readyCtaAllowed && !readyExperiencePinned && (
              <div className="DRIP-sticky-ready sticky top-[min(20vh,9rem)] z-10 mx-auto w-full max-w-md space-y-9 text-center">
                <h2 className="text-5xl md:text-6xl lg:text-[3.4rem] font-semibold tracking-tight text-gray-900 leading-tight">
                  Ready to<br />experience it?
                </h2>
                <Link
                  to="/shop"
                  className="inline-flex items-center gap-3 rounded-full bg-[#7FAF73] px-8 py-3 text-sm md:text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-white hover:bg-[#719D66] transition-colors"
                >
                  Buy now
                </Link>
              </div>
            )}
          </section>
        </div>

        {/* Phone (≤1081px): same scroll heights as before; only final CTA is visible */}
        <div className="min-[1082px]:hidden relative z-20">
          {Array.from({ length: 10 }, (_, i) => (
            <section
              key={`m-scroll-${i}`}
              className="DRIP-mobile-section pointer-events-none flex w-full select-none"
              style={{ minHeight: `${firstTenMobileSectionVh}vh` }}
              aria-hidden="true"
            />
          ))}
          <section
            ref={mobileFinalReadyRef}
            className="DRIP-mobile-section DRIP-mobile-section--final flex w-full items-start justify-center px-5"
            style={{ minHeight: `${lastMobileSectionVh}vh` }}
          >
            {readyCtaAllowed && !readyExperiencePinned && (
              <div className="sticky top-16 z-20 mx-auto w-full max-w-md space-y-5 px-2 py-1 text-center">
              <h2 className="text-2xl font-semibold tracking-tight text-gray-900 leading-tight sm:text-3xl">Ready to experience it?</h2>
              <Link
                to="/shop"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#7FAF73] px-8 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white"
              >
                Buy now
              </Link>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Scroll-release zone: transparent spacer that gives the scroll enough room to reach
          progress=1.0 without visually covering the fixed canvas beneath it. */}
      <div className="h-screen w-full bg-transparent" aria-hidden="true" />
      </div>

      {readyExperiencePinned && (
        <div className="fixed left-1/2 top-[22%] z-[70] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 px-2 text-center min-[1082px]:top-1/2 min-[1082px]:max-w-md min-[1082px]:gap-6">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-gray-900 min-[1082px]:text-5xl min-[1082px]:leading-tight">
            Ready to
            <br />
            experience it?
          </h2>
          <Link
            to="/shop"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#7FAF73] px-7 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-white min-[1082px]:px-10 min-[1082px]:py-3.5 min-[1082px]:text-sm"
          >
            Buy now
          </Link>
        </div>
      )}

      {/* Fixed canvas — always visible, stays on last frame once animation completes */}
      <div className="DRIP-canvas-container">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>

      <button type="button" className="DRIP-scroll-to-bottom" onClick={scrollToBottom} aria-label="Scroll to bottom">
        <img src={`${ASSETS}/scroll-bottom.svg`} alt="" />
      </button>

      {(!frames || frames.length === 0) && (
        <p className="fixed bottom-20 left-1/2 -translate-x-1/2 text-black/70 text-xs z-10 max-w-md text-center">
          Add sequence frames: wide → mobile-webp/ (810) · phone → desktop-webp/ (001–825). See useSequencePreload.js.
        </p>
      )}
    </div>
  );
}
