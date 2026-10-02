// iOS Safari ignores `user-scalable=no` / `maximum-scale=1`: a pinch (two thumbs on the stick and a
// button), a double tap or a focused input can zoom the page, after which the controls sit outside
// the visible area and touches pan instead of playing. Block the gestures, and if the page still
// ends up zoomed, snap it back to 1×.

const VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

function resetZoom(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
  if (!meta) return;
  // rewriting the viewport tag makes Safari re-apply initial-scale=1
  meta.content = VIEWPORT.replace('maximum-scale=1', 'maximum-scale=1.01');
  requestAnimationFrame(() => {
    meta.content = VIEWPORT;
    window.scrollTo(0, 0);
  });
}

export function installNoZoom(): void {
  // Safari-only pinch gesture events
  const block = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  document.addEventListener('gestureend', block, { passive: false });
  // a two-finger touch must never become a pinch-zoom (the game itself reads pointer events)
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || ((e as TouchEvent & { scale?: number }).scale ?? 1) !== 1) e.preventDefault();
  }, { passive: false });
  // double-tap zoom is already off: touch-action none / manipulation everywhere (styles.css)

  const vv = window.visualViewport;
  if (vv) {
    let pending = 0;
    const check = () => {
      if (vv.scale > 1.01 && !pending) {
        pending = window.setTimeout(() => {
          pending = 0;
          if (vv.scale > 1.01) resetZoom();
        }, 250);
      }
    };
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
  }
  // the page itself must never scroll (body is fixed); undo anything Safari scrolled
  window.addEventListener('scroll', () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  });
  window.addEventListener('orientationchange', () => setTimeout(resetZoom, 300));
}
