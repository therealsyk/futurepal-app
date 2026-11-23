import json
from playwright.sync_api import sync_playwright

# Exact markup from SimplePages.tsx line 469, inside an .mv-card-like container
SNIP = """
<button type="button" class="gp-bar">
  <span class="gp-ic"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg></span>
  <div><b>Pausar todas as metas</b><small>Para quando o mes aperta. Retomas quando quiseres.</small></div>
  <span class="gp-go ghost"><svg width="15" height="15" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
</button>
"""

res = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1200, "height": 800})
    pg.goto("http://localhost:5173/#/metas")
    pg.wait_for_timeout(1500)
    for w in (1200, 900, 760, 640):
        pg.set_viewport_size({"width": w, "height": 800})
        pg.wait_for_timeout(300)
        info = pg.evaluate("""snip => {
          document.body.insertAdjacentHTML('beforeend', '<div id="syn">' + snip + '</div>');
          const bar = document.querySelector('#syn .gp-bar');
          const s = getComputedStyle(bar);
          const go = bar.querySelector('.gp-go');
          const svg = go.querySelector('svg');
          const br = bar.getBoundingClientRect(), gr = go.getBoundingClientRect(), sr = svg.getBoundingClientRect();
          return {height: s.height, overflow: s.overflow, barH: +br.height.toFixed(1), barRight: +br.right.toFixed(1),
                  goW: +gr.width.toFixed(1), svgRight: +sr.right.toFixed(1),
                  clippedH: sr.right > br.right, clippedV: sr.bottom > br.bottom};
        }""", SNIP)
        info["viewport"] = w
        res.append(info)
    b.close()
open("_pause_out.txt", "w", encoding="utf-8").write(json.dumps(res, ensure_ascii=False, indent=1))
print("done")
