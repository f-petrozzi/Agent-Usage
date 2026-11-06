/* Working arcs use elapsed CSS time, never quota or stream progress. Recover only a stalled visible arc. */
(() => {
  'use strict';
  const samples = new WeakMap();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function check() {
    const visible = !document.hidden && document.getElementById('root')?.classList.contains('visible');
    document.documentElement.toggleAttribute('data-activity-hidden', document.hidden);
    for (const layer of document.querySelectorAll('.activity-layer.running')) {
      const animation = layer.getAnimations().find(a => a.animationName === 'spin');
      if (!visible || reduced.matches || getComputedStyle(layer).animationPlayState !== 'running') {
        samples.delete(layer);
        continue;
      }
      if (!animation) continue;
      const previous = samples.get(layer), time = animation.currentTime;
      // Preserve normal phases. A browser-suspended animation resumes immediately;
      // a stalled running clock needs two observations at least four seconds apart.
      if (animation.playState === 'paused' || (previous && previous.animation === animation &&
          performance.now() - previous.at >= 4000 && time === previous.time)) {
        animation.cancel();
        animation.play();
        samples.delete(layer);
      } else samples.set(layer, { animation, time, at: performance.now() });
    }
  }
  document.addEventListener('visibilitychange', check);
  reduced.addEventListener('change', check);
  // Independent of native text/tool events, including multi-minute silent turns.
  let timer = 0;
  function resume() {
    if (!timer) timer = setInterval(check, 4100);
    check();
  }
  addEventListener('pageshow', resume);
  addEventListener('pagehide', () => { clearInterval(timer); timer = 0; });
  resume();
})();
