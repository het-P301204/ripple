/*
 * RIPPLE perf probe. Paste into the browser DevTools console (or run through a browser javascript tool) on any page of the app.
 *
 *   - Samples requestAnimationFrame frame times for 5 s (change DURATION_MS below or set window.__probeMs first).
 *   - Reports avg FPS, median / p95 / p99 / max frame time, dropped frames (> 20 ms) and long tasks (> 50 ms, PerformanceObserver).
 *   - Also prints the motion mode (<html data-motion>) and JS-heap use when available.
 *
 * Tips for a fair number:
 *   - Interact while it samples (scroll, open the graph, switch routes): the probe is passive, it does not click anything.
 *   - The app has an FPS guard that switches to reduced animations after ~2s under 40 fps. To measure the FULL-animation build
 *     without it stepping in, run first:  localStorage.setItem('ripple.motion','full'); location.reload()
 *     To measure the reduced build:        localStorage.setItem('ripple.motion','reduced'); location.reload()
 *     To go back to automatic:             localStorage.removeItem('ripple.motion'); location.reload()
 *   - Background tabs throttle rAF to ~0-1 fps: keep the tab visible.
 *
 * Returns a Promise resolving to the result object (also console.table'd).
 */
(function () {
  var DURATION_MS = window.__probeMs || 5000
  return new Promise(function (resolve) {
    var frames = []
    var longTasks = []
    var lt = null
    try {
      lt = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) { longTasks.push(Math.round(e.duration)) })
      })
      lt.observe({ entryTypes: ['longtask'] })
    } catch (e) { /* longtask not supported */ }

    var start = 0
    var last = 0
    function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0 }
    function done() {
      if (lt) lt.disconnect()
      var sorted = frames.slice().sort(function (a, b) { return a - b })
      var total = frames.reduce(function (a, b) { return a + b }, 0)
      var res = {
        'motion mode': document.documentElement.getAttribute('data-motion') || '(unset)',
        'sampled (s)': +(DURATION_MS / 1000).toFixed(1),
        frames: frames.length,
        'avg FPS': +((frames.length * 1000) / (total || 1)).toFixed(1),
        'median frame (ms)': +pct(sorted, 50).toFixed(1),
        'p95 frame (ms)': +pct(sorted, 95).toFixed(1),
        'p99 frame (ms)': +pct(sorted, 99).toFixed(1),
        'max frame (ms)': +(sorted[sorted.length - 1] || 0).toFixed(1),
        'dropped (>20ms)': frames.filter(function (f) { return f > 20 }).length,
        'janky (>33ms)': frames.filter(function (f) { return f > 33.4 }).length,
        'long tasks (>50ms)': longTasks.length,
        'longest task (ms)': longTasks.length ? Math.max.apply(null, longTasks) : 0,
        'heap (MB)': performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 'n/a',
        'DOM nodes': document.getElementsByTagName('*').length,
      }
      console.table(res)
      resolve(res)
    }
    function tick(t) {
      if (!start) { start = t; last = t; requestAnimationFrame(tick); return }
      frames.push(t - last)
      last = t
      if (t - start >= DURATION_MS) done()
      else requestAnimationFrame(tick)
    }
    console.log('[ripple perf-probe] sampling for ' + DURATION_MS / 1000 + 's, keep the tab visible and interact normally...')
    requestAnimationFrame(tick)
  })
})()
