# Phase 8 — Keyword Scout table: Boostable column, header-click sorting, frozen headers, no cost card, no priority column

Working directory is the app root (`landingpages/rankboost`), static Cloudflare Pages site, no build step. `npm test` is green (`test/scout.test.js` covers the scout API/model; `test/endpoints.test.js` covers pages). The Keyword Scout UI is `public/scout.html` (markup + its own `<style>` block) and `public/scout.js` (renders the results table from `/api/scout` JSON: each keyword has `keyword, url, position, volume, cpc, intent, score, signals[], boost (bool), brand (bool)`).

## Outcome (one sentence)

The scout results view has no "Lookup cost" stat card and no "Priority" column; a new **Boostable** column shows a green check for `boost === true` rows and a red X otherwise (the inline "boost" pill on the keyword is gone); clicking the **Keyword, Boostable, Position, Volume / mo, CPC** column headers sorts the table (click again to flip direction, with a visible arrow); the `<thead>` stays frozen at the top while the page scrolls; and `bash .goal/verify-phase8.sh` prints `ALL GREEN`.

## Files you may modify

- `public/scout.html`
- `public/scout.js`
- `test/scout.test.js` and/or `test/endpoints.test.js` (only to update assertions that reference removed UI, plus one new test described below)

Do NOT touch `functions/**`, `public/styles.css`, `public/index.html`, `public/thank-you.html`, or `.goal/**`.

## Exact changes

### 1. Summary cards (`render()` in scout.js)
Remove the fourth `.sc-stat` card (`Lookup cost`). Keep Boost candidates, Searches in play, Buying intent. Nothing else in the summary changes. The word "cost" must not appear in the rendered summary HTML.

### 2. Table columns
New header row, in this order:

```
# | Keyword | Boostable | Position | Volume / mo | CPC | Intent
```

- Remove the `Priority` column entirely (the score bar, the number, and the `.sc-why` signals line). Remove the now-unused `.score`, `.score .bar`, `.score b`, `.sc-why` CSS rules from scout.html.
- Remove the inline `<span class="tag boostlbl">boost</span>` from the keyword cell and its `.tag.boostlbl` CSS rule.
- Add the Boostable cell right after Keyword:
  - boost rows: `<td class="sc-boost"><span class="yes" aria-label="Boostable" title="Position 2–50: rank-boost candidate">✓</span></td>`
  - other rows: `<td class="sc-boost"><span class="no" aria-label="Not boostable" title="Outside positions 2–50">✕</span></td>`
  - CSS in scout.html: `.sc-boost { text-align: center; }` `.sc-boost span { display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; font-weight: 800; font-size: 0.9rem; }` `.sc-boost .yes { color: #34D399; background: rgba(52, 211, 153, 0.14); border: 1px solid rgba(52, 211, 153, 0.45); }` `.sc-boost .no { color: #F87171; background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.4); }`
- Keep the gold row tint for boost rows and the position pill styles as they are.
- The empty-state row keeps `colspan="7"` (still 7 columns).

### 3. Sorting by clicking column names
- Replace the `view.sort` string with `view.sort = { key: "score", dir: "desc" }` (default = current behaviour: commercial-intent score descending, then volume, then position; the intro copy still says the list is ordered by commercial intent).
- Headers carry `data-sort` keys: Keyword → `keyword` (alphabetical, A→Z ascending first), Boostable → `boost` (boostable rows first on the first click), Position → `position` (ascending first: #1 on top; rows with no position always last), Volume / mo → `volume` (descending first), CPC → `cpc` (descending first). `#` and `Intent` are not sortable (no `data-sort`, `cursor: default`).
- Clicking a header that is not the active sort sets that key with its natural first direction above; clicking the active header flips `dir`. Ties break by volume desc, then position asc.
- Active header gets class `on` and an arrow: append `<span class="sc-arrow" aria-hidden="true">▲</span>` / `▼` (ascending ▲, descending ▼) inside the active `<th>` only; other headers show no arrow. Add `aria-sort="ascending|descending"` on the active header and remove it from the others.
- Delete the `Sort:` `<select id="sc-sort">` from the tools bar and its change handler; header clicks are the only sort control. The filter tabs, search box, Copy CSV and Copy keywords stay and keep working on the sorted/filtered rows (`visibleRows()` must apply the new sort).
- The `#` cell keeps showing the visible row index (1..n) after sorting.

### 4. Frozen column headers on scroll
In scout.html's `<style>`:
- `.sc-table-wrap { overflow: visible; }` at widths ≥ 800px (keep `overflow-x: auto` below 800px so the table can still scroll sideways on phones; the header freeze is a desktop feature). Keep the border/radius.
- `.sc-table thead th { position: sticky; top: 0; z-index: 2; background: #0e1725; }` so the header row stays pinned at the top of the viewport while the page scrolls through the 100 rows. Check `.step-header` in `public/styles.css`: if it is `position: sticky`, set `top` to its rendered height instead of 0 so the two do not overlap.
- Because `border-collapse: collapse` drops sticky cell borders in some browsers, switch the table to `border-collapse: separate; border-spacing: 0;` and keep the existing `border-bottom` on `th`/`td` so the lines still render.

### 5. Tests
- Update any assertion in `test/scout.test.js` / `test/endpoints.test.js` that references the removed pieces (`Lookup cost`, `Priority`, `sc-sort`, `boostlbl`, `.score`).
- Add one test (in `test/scout.test.js`) that reads `public/scout.js` and `public/scout.html` and asserts: the string `Lookup cost` is absent; `Priority` is absent from the header markup; `data-sort="boost"`, `data-sort="position"`, `data-sort="volume"`, `data-sort="cpc"`, `data-sort="keyword"` are present; `sc-boost` is present in scout.js; `position: sticky` is present in scout.html; `sc-sort` is absent from scout.js.

## Exit criterion

```
bash .goal/verify-phase8.sh    # ALL GREEN (includes npm test)
```

Fix every FAIL line and re-run. Reply with a short summary. Do not commit.
