# Phase 1 — UI Review

**Audited:** 2026-09-19
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md exists)
**Screenshots:** Not captured (no dev server — Electron tray popover)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Contextual labels, specific error/empty states; no generic "Submit/OK/Cancel" |
| 2. Visuals | 3/4 | Clear hierarchy, icon tooltips present; inline styles reduce consistency |
| 3. Color | 4/4 | Full CSS custom property system; semantic colors only; accent gradient consistent |
| 4. Typography | 3/4 | 4 sizes (11–14px), 3 weights (400/500/600); one inline 11px in SignInPopover |
| 5. Spacing | 3/4 | Coherent scale (2–16px); no arbitrary values; some inline gaps in SignInPopover |
| 6. Experience Design | 2/4 | Loading/error/disabled states exist; no ErrorBoundary; heavy inline styles in SignInPopover |

**Overall: 18/24**

---

## Top 3 Priority Fixes

1. **Consolidate inline styles in SignInPopover to CSS classes** — 12+ inline `style={{}}` objects reduce maintainability, break design token consistency, and prevent theme overrides. Move all spacing, colors, and typography to `index.css` using existing custom properties.

2. **Add React ErrorBoundary** — No error boundary wraps the popover. Uncaught render errors will crash the entire tray UI with no recovery. Wrap `<App />` in an ErrorBoundary showing a friendly fallback with "Reload" action.

3. **Extract SignInPopover divider and form layout to CSS** — The "or" divider (lines 132–141) and form spacing (lines 146–152) use inline flex/gap values. Create `.popover__divider--or` and `.popover__form` classes in `index.css` using the established spacing scale.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Strengths:**
- No generic labels found (`Submit`, `Click Here`, `OK`, `Cancel`, `Save` used only as identifiers, not user-facing text)
- Empty state: `"No data yet"` (TrayPopover.tsx:47) — clear, contextual
- Error state: `"Google sign-in failed. Please try again."` (SignInPopover.tsx:49) — specific, actionable
- Button labels: `"Continue with Google"`, `"Sign In with Email"`, `"Pause"`, `"Resume"`, `"↻"` with tooltip — all task-specific

**Issues:**
- `Loading…` (App.tsx:139, TrayPopover.tsx:105) — generic; consider `"Loading stats…"` / `"Loading phone data…"` for context
- `"No phone data today"` (TrayPopover.tsx:176) — good but could suggest action: `"No phone data today — tap ↻ to refresh"`

**Files:** `App.tsx`, `TrayPopover.tsx`, `SignInPopover.tsx`

---

### Pillar 2: Visuals (3/4)

**Strengths:**
- Clear focal point: Brand logo + title + tracking status dot in header
- Visual hierarchy: Stats (large values, tabular nums) > Mobile data (smaller) > Footer (smallest)
- Icon-only elements have tooltips: tracking dot (TrayPopover.tsx:96–98), sync refresh button (TrayPopover.tsx:138), sync status (TrayPopover.tsx:184)
- Status dots use semantic colors with animations (pulse for good/danger)

**Issues:**
- SignInPopover Google button (line 98–128) uses entirely inline styles — no CSS class for reuse or override
- Form inputs (lines 154–187) have duplicated inline style objects — should be `.popover__input` class
- `"or"` divider (lines 132–141) built with inline flex — should be a reusable component/class

**Files:** `TrayPopover.tsx`, `SignInPopover.tsx`, `index.css`

---

### Pillar 3: Color (4/4)

**Strengths:**
- Complete CSS custom property system in `index.css:8–26`:
  - Background: `--bg`, `--bg-hover`, `--border`
  - Text: `--text-primary`, `--text-secondary`, `--text-muted`
  - Semantic: `--color-good` (#00CEC9), `--color-warn` (#FDCB6E), `--color-danger` (#FF6B6B), `--color-off` (#444)
  - Accent: `--accent-start` (#6C5CE7), `--accent-end` (#00CEC9)
- All component colors reference `var(--*)` — zero hardcoded colors in component logic
- Accent gradient used only on brand title and primary button (60/30/10 respected)
- Semantic colors mapped to data thresholds (load ≤40/70, WM ≥60/30) in `TrayPopover.tsx:32–42`

**Issues:** None found.

**Hardcoded colors only in Google logo SVG** (SignInPopover.tsx:121–124) — expected for brand asset.

**Files:** `index.css`, `TrayPopover.tsx`, `SignInPopover.tsx`

---

### Pillar 4: Typography (3/4)

**Font sizes in use (4 distinct):**
- 11px — `popover__sync-text`, `"or"` divider label, error text
- 12px — `stat-row__label`, button text, input placeholder
- 13px — base body (`html, body` in index.css:42)
- 14px — `popover__title`, `stat-row__value`

**Font weights in use (3 distinct):**
- 400 — labels, secondary text
- 500 — button text
- 600 — title, stat values

**Issues:**
- SignInPopover.tsx:139 has inline `fontSize: '11px'` — should use CSS class
- No fluid type scale; fixed px values (acceptable for fixed-size popover)

**Files:** `index.css`, `TrayPopover.tsx`, `SignInPopover.tsx`

---

### Pillar 5: Spacing (3/4)

**Spacing values in use (consistent scale):**
- 0, 2px, 5px, 6px, 8px, 10px, 12px, 14px, 16px

**Patterns:**
- Base padding: `14px 16px 12px` (popover container)
- Stat rows: `2px 0` vertical
- Gaps: 6px (stats), 8px (header/brand), 12px (mobile stats)
- Button padding: `5px 14px`

**Issues:**
- SignInPopover uses inline spacing: `padding: '0 16px'` (line 97), `gap: '8px'` (line 107), `padding: '10px 16px 14px'` (line 147), `gap: '8px'` (line 150) — should map to spacing scale classes
- Mobile stat gap: `gap: '12px'` (TrayPopover.tsx:148) — not in standard scale (6, 8, 10, 14, 16); consider 10px or 14px

**No arbitrary `[px]` or `[rem]` values found.**

**Files:** `index.css`, `TrayPopover.tsx`, `SignInPopover.tsx`

---

### Pillar 6: Experience Design (2/4)

**Strengths:**
- **Loading states:** `popover__Loading` shown during auth check (App.tsx:136–142) and stats fetch (TrayPopover.tsx:104–106)
- **Error states:** SignInPopover displays `error` state inline (lines 189–197); API errors caught and logged (App.tsx:66–67, 78–79)
- **Disabled states:** Buttons disabled during loading (SignInPopover.tsx:101, 160, 177, 202; TrayPopover.tsx:137)
- **Destructive action confirmation:** Not applicable (no destructive actions in popover)

**Issues:**
- **No ErrorBoundary** — Uncaught render errors crash the entire popover with no UI recovery
- **Empty states minimal:** Only `"No data yet"` and `"No phone data today"` — no illustration, no primary action
- **Heavy inline styles in SignInPopover** (12+ `style={{}}` objects) — breaks design token system, prevents theme consistency, hard to maintain
- **No focus-visible styles** — Keyboard navigation affordance missing for inputs/buttons
- **No reduced-motion respect** — Pulse animations run unconditionally

**Files:** `App.tsx`, `TrayPopover.tsx`, `SignInPopover.tsx`, `index.css`

---

## Files Audited

- `cognitrack/apps/desktop/src/renderer/App.tsx`
- `cognitrack/apps/desktop/src/renderer/TrayPopover.tsx`
- `cognitrack/apps/desktop/src/renderer/SignInPopover.tsx`
- `cognitrack/apps/desktop/src/renderer/index.css`
- `cognitrack/apps/desktop/src/renderer/index.html`
- `cognitrack/apps/desktop/src/renderer/main.tsx`

---

## Registry Safety

No `components.json` found — shadcn not initialized. Registry audit skipped.

---

## Notes

- **Platform coverage:** Only desktop (Electron) app exists in this monorepo. No iOS/Android apps found at `cognitrack/apps/mobile` — audit covers Windows/macOS desktop tray popover only.
- **Architecture:** Frameless, draggable popover (260×280px) with backdrop blur — system-native feel achieved via `-webkit-app-region: drag` and `backdrop-filter`.
- **Fonts:** `@fontsource/inter` loaded; CSS variable `--font` with system fallbacks.