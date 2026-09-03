# Phase 5 brief — remove the reassurance note under the "GET MY FREE BOOST NOW" button

Working tree has uncommitted user changes. **No state-changing git commands** (no commit, stash,
checkout, reset, clean, add).

## Outcome (one sentence)

The paragraph "If you qualify, you'll see your keywords and book your call right here, on the
spot. If not, we'll tell you straight. No pressure, no spam. We never ask for site access or
logins." under the qualify toggle button is removed on all viewports, along with its now-dead JS,
CSS, and test assertions; nothing else changes.

## Files you may modify — nothing else

- `public/index.html`
- `public/styles.css`
- `test/endpoints.test.js`

Do not touch anything in `<head>`, any `fbq(` line, the `wistia` markup, `meta.js`, or
`functions/`. `grep -c 'fbq(' public/index.html` must stay 4.

## Exact edits

### public/index.html

1. Delete this single line (near line 99):
   `<p class="form-note qualify-toggle-note" id="qualify-toggle-note">If you qualify, …</p>`
2. In the inline script (near line 928) delete the line
   `var formToggleNote = document.getElementById("qualify-toggle-note");`
3. In the same click handler (near line 937) delete the line
   `if (formToggleNote) formToggleNote.hidden = true;`

Leave `formToggle.hidden = true;`, `form.hidden = false;`, the `aria-expanded` line, and the
`formOpened` / `fbq("trackCustom", "LeadFormOpened", …)` block exactly as they are.

### public/styles.css

Delete the two rules (near lines 324–332):

```css
.hero-qualify .qualify-toggle-note {
  margin: 0.85rem auto 0;
  max-width: 62ch;
  text-align: center;
}

.hero-qualify .qualify-toggle-note[hidden] {
  display: none !important;
}
```

Leave `.hero-qualify .qualify-form-toggle[hidden]` and everything else.

### test/endpoints.test.js

In the test that contains `const qualification = index.slice(qualifyStart, qualifyEnd);`
(around lines 355–395), delete only these assertions:

- `assert.match(index, /formToggleNote = document\.getElementById\("qualify-toggle-note"\)/);`
- `assert.match(index, /formToggleNote\.hidden = true/);`
- `assert.match(index, /qualify-toggle-note/);`
- `assert.match(styles, /\.hero-qualify \.qualify-toggle-note\[hidden\] \{\s*display: none !important;\s*\}/);`
- `assert.ok(qualification.includes("id=\"qualify-toggle-note\""));`
- `assert.doesNotMatch(qualification, /id="qualify-toggle-note"[^\n]*hidden/);`
- the `const reassurance = "If you qualify, …";` line and the three `assert.ok(...)` lines that
  use `reassurance`.

Replace them with these two assertions (same place) so the removal is locked in:

```js
  assert.doesNotMatch(index, /qualify-toggle-note/);
  assert.doesNotMatch(index, /We never ask for site access or logins\./);
```

Keep every other assertion in that test unchanged.

## Exit criteria

```
bash .goal/verify-vsl.sh
```

must print `ALL GREEN` and exit 0 (it runs `npm test`; all tests must pass), and
`grep -c 'qualify-toggle-note\|formToggleNote' public/index.html public/styles.css` must print
`0` for both files. Print those results and stop.
