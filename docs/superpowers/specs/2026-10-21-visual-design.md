# Running app rewrite: visual design

Status: Accepted 2026-10-21 as the builder session's call (spec section 4.7 delegates visual direction). Companion to `2026-10-21-running-app-rewrite-design.md`. Contrast ratios below were computed 2026-10-21 with the WCAG 2.x relative-luminance formula.

## 1. Direction

A paper training notebook, set in type. Cool, quiet paper in light mode, deep ink-blue night in dark mode, one fountain-pen indigo accent, and a serif voice for every number and heading that matters. The distinctive move is the target drawn as a sketch: in the Meter the target is a dotted tick with a soft "near" band behind it, and going past it is a hatched continuation in the same accent, never a finish line, never red. That is the owner's rule ("Targets are a sketch, not minimums") made visible. The app must never look like a gamified fitness dashboard (rings, streak flames, badges, confetti, green and red arrows), a grid of identical rounded KPI cards with gradients, or a generic admin template. Sections are separated by space and hairline rules on one paper surface, not by boxes.

## 2. Typography

Self-host both families with `@fontsource-variable/source-serif-4` and `@fontsource-variable/libre-franklin` (no third-party request, works offline in the PWA; `font-display: swap`).

- **Serif, for numbers and headings:** Source Serif 4, weights 500 and 600, optical sizing automatic. Fallback: `"Source Serif 4 Variable", "Source Serif 4", Charter, "Iowan Old Style", Georgia, serif`.
- **Sans, for body, labels, controls:** Libre Franklin, weights 400, 500, 600. Fallback: `"Libre Franklin Variable", "Libre Franklin", system-ui, -apple-system, "Segoe UI", sans-serif`.

| Step | Token | Size / line-height (px) | Use |
| --- | --- | --- | --- |
| 1 | `--text-xs` | 13 / 18 | captions, chart ticks, tab labels |
| 2 | `--text-sm` | 15 / 22 | table cells, hints, chips |
| 3 | `--text-base` | 17 / 26 | body, form controls (never below 16, which avoids iOS zoom) |
| 4 | `--text-lg` | 22 / 28 | serif; secondary numbers, empty-state sentence |
| 5 | `--text-xl` | 32 / 36 | serif; page titles (h1), secondary dashboard figures |
| 6 | `--text-display` | 56 to 88 / 1 (`clamp`) | serif; the one hero figure per screen |

Numbers: every figure (hours, miles, pace, minutes, dates in tables) uses `font-variant-numeric: lining-nums tabular-nums`, so columns align and values do not jitter when they change. Units sit beside the figure one step smaller in text-muted ("6.4 h", "8:42 /mi"). Body line length stays under 68ch. Sentence case everywhere; no all-caps labels, no eyebrows.

## 3. Colour and tokens

Accent contrast: light `#3A36B5` is 8.20:1 on surface `#F6F6F9` and 8.84:1 on raised `#FFFFFF`; dark `#A5A2FF` is 8.19:1 on surface `#121217` and 7.42:1 on raised `#1C1C25`. `accent-text` on accent fills: white on light indigo 8.84:1, dark ink on dark-mode lavender 8.19:1. `text-muted` is at least 6.37:1 and every status colour at least 5.87:1 on both surfaces in both themes. `border-strong` (control edges, planned series) is 3.19:1 on light surface and 4.08:1 on dark raised, meeting the 3:1 non-text rule.

Success is not used for hitting a target; it confirms saves and complete data only. Under, near and over target all use the accent.

```css
/* web/styles/tokens.css */
:root {
  color-scheme: light dark;

  /* type */
  --font-serif: "Source Serif 4 Variable", "Source Serif 4", Charter, "Iowan Old Style", Georgia, serif;
  --font-sans: "Libre Franklin Variable", "Libre Franklin", system-ui, -apple-system, "Segoe UI", sans-serif;
  --text-xs: 0.8125rem;   /* 13 / 18 */
  --lh-xs: 1.125rem;
  --text-sm: 0.9375rem;   /* 15 / 22 */
  --lh-sm: 1.375rem;
  --text-base: 1.0625rem; /* 17 / 26 */
  --lh-base: 1.625rem;
  --text-lg: 1.375rem;    /* 22 / 28 */
  --lh-lg: 1.75rem;
  --text-xl: 2rem;        /* 32 / 36 */
  --lh-xl: 2.25rem;
  --text-display: clamp(3.5rem, 2.2rem + 5.5vw, 5.5rem); /* 56 to 88 / 1 */
  --lh-display: 1;

  /* space: 4px base */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 4rem;
  --gutter: var(--space-4);

  /* shape: radii differ by role, not one value everywhere */
  --radius-xs: 2px;    /* meter track */
  --radius-sm: 4px;    /* chips */
  --radius-md: 8px;    /* buttons, fields, toast */
  --radius-lg: 20px;   /* sheet top corners */
  --radius-pill: 999px;

  /* layout */
  --page-max: 72rem;
  --prose-max: 68ch;
  --rail-w: 13.75rem;
  --tabbar-h: 3.5rem;
  --control-h: 3rem;

  /* motion */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast: 160ms;
  --dur-sheet: 220ms;

  /* colour, light */
  --surface: #f6f6f9;
  --surface-raised: #ffffff;
  --surface-sunken: #ececf2;
  --text: #17161d;
  --text-muted: #5a5966;
  --border: #dedee6;
  --border-strong: #8a8996;
  --accent: #3a36b5;
  --accent-text: #ffffff;
  --accent-soft: #e6e5f8;
  --success: #1d6b3a;
  --warning: #8a5300;
  --danger: #b3261e;
  --scrim: rgb(23 22 29 / 0.45);

  --chart-1: #3a36b5; /* run (accent) */
  --chart-2: #0c7c7c; /* strength */
  --chart-3: #9a5f00; /* cross-training */
  --chart-4: #a8326f; /* race */
  --chart-planned: #8a8996;
  --chart-actual: var(--accent);
  --chart-grid: var(--border);

  --shadow-sheet: 0 -8px 32px rgb(23 22 29 / 0.16);
  --shadow-toast: 0 4px 16px rgb(23 22 29 / 0.18);
  --focus-ring: 2px solid var(--accent);
  --focus-offset: 2px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --surface: #121217;
    --surface-raised: #1c1c25;
    --surface-sunken: #0c0c10;
    --text: #efeef5;
    --text-muted: #a9a8b8;
    --border: #2c2c38;
    --border-strong: #7c7b8c;
    --accent: #a5a2ff;
    --accent-text: #121217;
    --accent-soft: #26254a;
    --success: #6fd08c;
    --warning: #f0b45a;
    --danger: #ff8a80;
    --scrim: rgb(0 0 0 / 0.6);

    --chart-1: #a5a2ff;
    --chart-2: #4fc3c3;
    --chart-3: #e0a040;
    --chart-4: #f07cb5;
    --chart-planned: #7c7b8c;

    --shadow-sheet: 0 -8px 32px rgb(0 0 0 / 0.5);
    --shadow-toast: 0 4px 16px rgb(0 0 0 / 0.5);
  }
}

:root[data-theme="dark"] {
  --surface: #121217;
  --surface-raised: #1c1c25;
  --surface-sunken: #0c0c10;
  --text: #efeef5;
  --text-muted: #a9a8b8;
  --border: #2c2c38;
  --border-strong: #7c7b8c;
  --accent: #a5a2ff;
  --accent-text: #121217;
  --accent-soft: #26254a;
  --success: #6fd08c;
  --warning: #f0b45a;
  --danger: #ff8a80;
  --scrim: rgb(0 0 0 / 0.6);

  --chart-1: #a5a2ff;
  --chart-2: #4fc3c3;
  --chart-3: #e0a040;
  --chart-4: #f07cb5;
  --chart-planned: #7c7b8c;

  --shadow-sheet: 0 -8px 32px rgb(0 0 0 / 0.5);
  --shadow-toast: 0 4px 16px rgb(0 0 0 / 0.5);
}

:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }

@media (min-width: 900px) {
  :root { --gutter: var(--space-6); }
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0.01ms; --dur-sheet: 0.01ms; }
}
```

## 4. Layout language

- **Navigation.** Below 900px a bottom tab bar (Today, Log, Plan, Review, More), 56px plus safe-area inset, raised surface with a top hairline; the active tab is accent-coloured with a 2px accent line on its top edge. From 900px the same five items become a left rail, 220px, wordmark in the serif at the top, theme toggle at the bottom. Goals, Stats and Settings live under More (a list page on phones, a rail group on wide screens). Log shows the activities list with a sticky primary "Log activity" button at the top that opens the add sheet, and Today carries the same shortcut, so the 20-second path is two taps, then fields, and the log itself stays a first-class page.
- **Page.** One paper surface. Content column max 72rem, centred, 16px gutter on phones and 32px from 900px. Prose and notes cap at 68ch. Sections are separated by `--space-7` and a 1px `--border` rule, not by boxes. `surface-raised` is reserved for things that float or take input: tab bar, sheet, toast, fields, tooltips.
- **PageHeader.** In flow, not sticky. The h1 is `--text-xl` serif, with one line of context under it in `--text-sm` muted ("Week of 19 Oct, Base 2"). Actions sit right of the title from 900px; on phones they move into the Log sheet or a bottom action row.
- **Sheet.** On phones, forms open as a bottom sheet: scrim, 20px top radius, `max-height: 92dvh`, internal scroll, primary button pinned at the bottom above the safe area. Logging order: date (today), type (segmented, Run default), duration, distance; RPE and notes sit behind "More details". From 900px the same component is a 440px right-hand panel. Focus is trapped, Escape closes, focus returns to the trigger.
- **Dashboard hierarchy.** Today leads with the week's hours as the only display-size figure: "6.4" at `--text-display` in serif, "h of 7.5 h target" beside it at `--text-lg`, the Meter spanning full width directly beneath, then one muted line ("Base 2, week 5 of 18"). Below a hairline, the other two numbers sit side by side at `--text-xl`: "87 days to the race" and "34 min a day left, through Sunday", each with a `--text-sm` muted caption (the second says "advisory"). They stack on the narrowest phones. No boxes, icons or sparklines on these three.

## 5. Components

- **Button.** Variants: primary (accent fill, `accent-text`, one per view), secondary (1px `border-strong`, transparent), quiet (accent text, no border), danger (danger text and border; filled only inside a confirm step). 48px high on phones, 44px from 900px, 8px radius, 600 weight, no arrow glyphs; pressed state changes colour only.
- **Field.** Label above (600, `--text-sm`); control 48px with 16px+ text, `surface-raised`, 1px `border-strong`, 8px radius; hint below in muted; an error replaces the hint, in danger with a 2px danger border, and says what to type ("Enter minutes like 45, or 0:45:00").
- **Meter.** `role="meter"` with min, max and a text equivalent ("6.4 of 7.5 hours"). A 10px track (`surface-sunken`, 2px radius), accent fill, a dotted 2px target tick 22px tall in `text`, and a band from 85% to 100% of target in `accent-soft` (the "near" zone from the review rules). Under: fill short of the band. Near: fill inside the band, caption "1.1 h to target". Over: fill continues past the tick, the overshoot hatched with a 45-degree stripe of the same accent, caption "0.4 h past target". State is always stated in words too, never by colour alone.
- **Sheet.** As in section 4.
- **EmptyState.** One sentence in `--text-lg` serif, one muted line, one button. No illustration.
- **Toast.** Raised, 8px radius, above the tab bar on phones and bottom-left of the content area on wide screens, `role="status"`, 4s, repeating the action's own verb ("Run saved", "Week of 26 Oct saved"). Delete toasts carry Undo. Errors are not toasts; they stay in the form.
- **PageHeader.** As in section 4.
- **Week table row.** Phone: a two-line list row; line 1 is week start (600) plus phase chip on the left and target hours in serif on the right; line 2 is muted ("Long run 120 min, 4 run days, strength 2"). From 900px a true table: Week, Phase, Target, Long run, Day 2, Run days, Strength, Focus. Phase chip: 4px radius, `--text-sm`, background `color-mix(in srgb, var(--accent) calc(var(--phase-level) * 4%), var(--surface))` with `--phase-level` 1 (Restart) to 6 (Peak), so intensity builds with the phase in one hue. Taper and Race chips are dashed-outline and transparent. Cutback weeks: dashed top rule, target in italic serif, the word "cutback" in muted after the chip. Taper rows use muted text. Race week: 2px `text` rules above and below, "Race" in 600 serif. The current week has a 3px accent bar on its leading edge. An edited target shows the baseline struck through in muted beside it and an underlined "edited" that reveals the override note.

## 6. Motion and states

Allowed: sheet slide-up 220ms and scrim fade 160ms (`--ease-out`); toast fade 160ms; one Meter fill from 0 to value, 500ms, on first load of Today only; expansion of "More details". No hover lifts, no scroll reveals, no staggered entrances. `prefers-reduced-motion` collapses all durations (tokens above).

Loading: skeletons that mirror the final layout in `surface-sunken`, static (no shimmer), shown only after 300ms so fast loads do not flash.

Copy tone: plain, specific, sentence case, one job per line, no cheerleading and no guilt. Empty: "No runs this week yet. Log one when you're out." / "No plan yet. Choose a goal race, then generate weekly targets." / "Nothing to review. Last week is closed." Errors state what happened and the next step, and never apologise: "Run not saved. The server did not respond. Your entries are still in the form; try again." Past-target and short weeks stay neutral: "0.4 h past target" and "3.1 h of 7.5 h target", never "behind" or "missed".

## 7. Charts (recharts)

Keep them few: last 12 weeks of hours on Today and Stats, monthly totals on Stats. All styling lives in one `web/components/charts/theme.ts` exporting CSS-variable strings (`stroke="var(--chart-grid)"` works as an SVG attribute), so charts follow light, dark and the manual override with no JavaScript.

- **Axes:** no axis lines, no tick lines, ticks in `--text-xs` Libre Franklin, fill `--text-muted`, `tickMargin={8}`, tabular figures. Y axis shows 3 ticks at most.
- **Grid:** horizontal lines only, 1px `--chart-grid`, solid.
- **Tooltip:** a custom component in a CSS module: `surface-raised`, 1px `--border`, 8px radius, `--shadow-toast`, serif figures, one row per series. No default recharts tooltip chrome. The cursor is a 1px `--border-strong` line.
- **Legend:** avoid; label series directly or in the caption ("Solid is actual, outline is planned").
- **Planned vs actual:** planned is an outlined, unfilled bar (1.5px `--chart-planned` stroke) drawn full width behind; actual is a solid `--chart-actual` bar drawn narrower in front. On line charts planned is a dashed step line and actual a solid 2px line. Shape and fill carry the difference, so it survives colour blindness and greyscale. Cutback and taper weeks simply show a shorter planned outline.
- **Categorical series:** `--chart-1..4` map to run, strength, cross-training and race in that fixed order everywhere; all four are at least 4.65:1 on both light surfaces and 6.65:1 on both dark surfaces.
- Every chart has an `aria-label` giving the latest value and a visually hidden data table.
