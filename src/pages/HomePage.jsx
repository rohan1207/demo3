import React, { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import DRIPLandingSequence from '../components/drip/DripLandingSequence';
import DRIPPreloader from '../components/drip/DripPreloader';
import { useSequencePreload } from '../hooks/useSequencePreload';

/**
 * Home: video + progress until all sequence frames are loaded (same as former Landing),
 * then the scroll-driven canvas. Single route + one useSequencePreload subscription so
 * hard reload always replays preload and avoids blank canvas from a stale /home-only load.
 */
export default function HomePage() {
  const [percent, setPercent] = useState(0);
  const onProgress = useCallback((p) => setPercent(p), []);

  const { frames, entryReady, error, ready } = useSequencePreload(onProgress, {
    landingProgress: true,
  });

  const showPreloader = !ready;

  return (
    <>
      <DRIPPreloader percent={percent} visible={showPreloader} />

      {ready && entryReady && (
        <div className="DRIP-page min-h-screen overflow-x-hidden bg-white">
          <DRIPLandingSequence frames={frames} sequenceReady />
        </div>
      )}

      {ready && !entryReady && error && (
        <div className="DRIP-page flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
          <p className="text-sm text-slate-600">
            The scroll animation could not load. You can still shop the store.
          </p>
          <Link
            to="/shop"
            className="rounded-full bg-[#7FAF73] px-6 py-2.5 text-xs font-semibold uppercase tracking-wider text-white"
          >
            Shop
          </Link>
        </div>
      )}
    </>
  );
}
