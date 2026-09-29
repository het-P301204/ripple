/* Runs before first paint (CSP-friendly: external, same-origin, no inline handlers).
   1. decides reduced-animations (mirrors src/lib/perf.ts) so ambient layers never flash on weak devices;
   2. loads the web-font CSS without blocking render (system fonts first, swap when it arrives; also fine offline). */
try {
  var m = localStorage.getItem('ripple.motion'), c = navigator.hardwareConcurrency, d = navigator.deviceMemory;
  var weak = (c && c <= 4) || (d && d <= 4), os = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var r = os || m === 'reduced' || (m !== 'full' && (weak || sessionStorage.getItem('ripple.motion.auto') === '1'));
  document.documentElement.setAttribute('data-motion', r ? 'reduced' : 'full');
} catch (e) {}
(function () {
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.media = 'print';
  l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap';
  l.onload = function () { l.media = 'all'; };
  document.head.appendChild(l);
})();
