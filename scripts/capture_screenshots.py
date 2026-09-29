"""Capture README screenshots + a rough FPS probe of the running RIPPLE dashboard.

Usage (servers running, see start-ripple.bat):
    python scripts/capture_screenshots.py [--base http://localhost:5175] [--out docs/screenshots]

Requires: pip install playwright && playwright install chromium
Read-only: it only loads pages and clicks around the local UI.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

FPS_PROBE = """
() => new Promise(resolve => {
  const frames = []; let last = performance.now(); const end = last + 3000; let long = 0;
  try { new PerformanceObserver(l => { long += l.getEntries().length }).observe({entryTypes:['longtask']}) } catch (e) {}
  function tick(t) { frames.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else {
    frames.shift(); frames.sort((a,b)=>a-b);
    const avg = frames.reduce((a,b)=>a+b,0)/frames.length;
    resolve({fps: +(1000/avg).toFixed(1), p95_ms: +frames[Math.floor(frames.length*0.95)].toFixed(1), max_ms: +frames[frames.length-1].toFixed(1), long_tasks: long}) } }
  requestAnimationFrame(tick)
})
"""


def go(page: Page, path: str, wait_ms: int = 1400) -> None:
    """Client-side navigation (keeps the loaded scan in memory)."""
    page.evaluate(
        "p => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }", path
    )
    page.wait_for_timeout(wait_ms)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5175")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "docs" / "screenshots"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    perf: dict[str, dict] = {}

    HIDE_TOASTS = """
    () => {
      for (const el of document.querySelectorAll('div,section,li')) {
        if (el.children.length < 6 && /Animations reduced for smoother/.test(el.textContent || '') && el.textContent.length < 200) {
          let n = el; while (n.parentElement && getComputedStyle(n).position !== 'fixed') n = n.parentElement;
          n.style.display = 'none';
        }
      }
    }
    """

    def shot(page: Page, name: str, full: bool = False) -> None:
        page.evaluate(HIDE_TOASTS)  # headless software rendering trips the FPS guard; keep the toast out of README shots
        raw = out / f"{name}.png"
        page.screenshot(path=str(raw), full_page=full)
        try:  # 2880px PNGs are ~1 MB each; WebP keeps them crisp at a fraction of the size
            from PIL import Image
            im = Image.open(raw)
            if im.width > 1800 and im.width > im.height:
                im = im.resize((1800, round(im.height * 1800 / im.width)), Image.LANCZOS)
            im.save(out / f"{name}.webp", "WEBP", quality=90, method=6)
            raw.unlink()
            print(f"  saved {name}.webp")
        except ImportError:
            print(f"  saved {name}.png (install Pillow for WebP output)")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page = ctx.new_page()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        print("loading screen")
        page.goto(args.base)
        page.wait_for_timeout(1100)
        shot(page, "01-loading")
        page.wait_for_timeout(2200)
        shot(page, "02-landing")
        perf["landing"] = page.evaluate(FPS_PROBE)

        print("scan modal")
        for label in ("Start New Scan", "Scan"):
            try:
                page.get_by_role("button", name=label).first.click(timeout=2000)
                break
            except Exception:
                continue
        page.wait_for_timeout(900)
        shot(page, "03-scan-modal")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        print("load demo")
        page.get_by_role("button", name="Load Demo Dataset").first.click(timeout=5000)
        page.wait_for_timeout(600)
        shot(page, "03b-scan-running")
        try:
            page.get_by_text("Attack surface mapped").first.wait_for(timeout=15000)
            page.wait_for_timeout(600)
            shot(page, "03c-scan-complete")
            page.get_by_role("button", name="View overview").first.click(timeout=3000)
        except Exception as e:  # noqa: BLE001
            print("  (demo modal flow differs:", e.__class__.__name__, ")")
        page.wait_for_timeout(2600)
        shot(page, "04-overview")
        perf["overview"] = page.evaluate(FPS_PROBE)

        pages = [
            ("05-findings", "/findings", 1600),
            ("06-finding-detail", "/findings/RIP-0001", 1600),
            ("07-graph", "/graph", 3800),
            ("08-attack-surface", "/attack-surface", 2200),
            ("09-typosquatting", "/typosquatting/requests", 2200),
            ("10-packages", "/packages", 1600),
            ("11-ecosystems", "/ecosystems/npm", 1600),
            ("12-history", "/history", 1600),
            ("13-reports", "/reports", 1800),
            ("14-settings", "/settings", 1600),
        ]
        for name, path, wait in pages:
            print(name, path)
            go(page, path, wait)
            shot(page, name)
            perf[name] = page.evaluate(FPS_PROBE)

        print("mobile")
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = mctx.new_page()
        mp.on("pageerror", lambda e: errors.append(f"mobile pageerror: {e}"))
        mp.goto(args.base)
        mp.wait_for_timeout(3200)
        try:
            mp.get_by_role("button", name="Load Demo Dataset").first.click(timeout=4000)
            mp.get_by_text("Attack surface mapped").first.wait_for(timeout=15000)
            mp.get_by_role("button", name="View overview").first.click(timeout=3000)
        except Exception as e:  # noqa: BLE001
            print("  mobile demo flow:", e.__class__.__name__)
        mp.wait_for_timeout(2400)
        shot(mp, "15-mobile-overview")
        go(mp, "/findings", 1500)
        shot(mp, "16-mobile-findings")
        go(mp, "/graph", 3000)
        shot(mp, "17-mobile-graph")
        try:
            mp.get_by_role("button", name="Open navigation").first.click(timeout=2000)
        except Exception:
            try:
                mp.locator("button[aria-label*='enu' i]").first.click(timeout=2000)
            except Exception:
                pass
        mp.wait_for_timeout(700)
        shot(mp, "18-mobile-drawer")

        browser.close()

    print("\n=== FPS probe (3s each; headless software rendering is pessimistic) ===")
    for k, v in perf.items():
        print(f"{k:22} {json.dumps(v)}")
    print("\n=== console/page errors ===")
    print("\n".join(sorted(set(errors))) or "none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
