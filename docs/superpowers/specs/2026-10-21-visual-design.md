# Running app rewrite: visual design

Status: Accepted 2026-10-21 as the builder session's call (spec section 4.7 delegates visual direction). Companion to `2026-10-21-running-app-rewrite-design.md`. Contrast ratios below were computed 2026-10-21 with the WCAG 2.x relative-luminance formula. Revised 2026-11-08: sections 8 to 19 add the design rules every UI change follows; where they differ from sections 1 to 7, section 19 says which governs.

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

Accent contrast: light `#3A36B5` is 8.20:1 on surface `#F6F6F9` and 8.84:1 on raised `#FFFFFF`; dark `#A5A2FF` is 8.19:1 on surface `#121217` and 7.42:1 on raised `#1C1C25`. `accent-text` on accent fills: white on light indigo 8.84:1, dark ink on dark-mode lavender 8.19:1. `text-muted` is at least 6.37:1 and every status colour at least 5.87:1 on both surfaces in both themes. `border-strong` (control edges, planned series) is 3.32:1 on light surface (3.05:1 on light sunken) and 4.08:1 on dark raised, meeting the 3:1 non-text rule.

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
- **Dashboard hierarchy.** Today leads with the session, not the week (rewrite design, section 7, item 18). The session is the first block of the screen (owner decision 2026-11-07): the hero, its title in `--text-lg` serif, the duration as the only display-size figure ("45" at `--text-display`, "min" beside it at `--text-lg`), the targets as a term list with the figure the day is run by first at `--text-lg`, and Done, Explain and Not today in one row. Under the hero, behind a hairline, sits the readiness read, compact: the verdict in `--text-base` serif, the two or three readings behind it in `--text-sm`, and the one-tap check-in row. Below a hairline, the week strip: seven days, each with a mark whose shape carries its state, then the Meter spanning full width with its caption ("3.1 h of 7.5 h target") and one muted advisory line ("34 min a day left, through Sunday", captioned "advisory"). The race countdown ("87 days to the race" at `--text-xl`) follows with the finish estimate. No boxes, icons or sparklines on these.

## 5. Components

- **Button.** Variants: primary (accent fill, `accent-text`, one per view), secondary (1px `border-strong`, transparent), quiet (accent text, no border), danger (danger text and border; filled only inside a confirm step). 48px high on phones, 44px from 900px, 8px radius, 600 weight, no arrow glyphs; pressed state changes colour only.
- **Field.** Label above (600, `--text-sm`); control 48px with 16px+ text, `surface-raised`, 1px `border-strong`, 8px radius; hint below in muted; an error replaces the hint, in danger with a 2px danger border, and says what to type ("Enter minutes like 45, or 0:45:00").
- **Meter.** `role="meter"` with min, max and a text equivalent ("6.4 of 7.5 hours"). A 10px track (`surface-sunken`, 2px radius), accent fill, a dotted 2px target tick 22px tall in `text`, and a band from 85% to 100% of target in `accent-soft` (the "near" zone from the review rules). Under: fill short of the band. Near: fill inside the band, caption "1.1 h to target". Over: fill continues past the tick, the overshoot hatched with a 45-degree stripe of the same accent, caption "0.4 h past target". State is always stated in words too, never by colour alone.
- **Sheet.** As in section 4.
- **EmptyState and ErrorState.** One sentence in `--text-lg` serif, one muted line, one button. No illustration or icon, except behind the Illustrations switch (below).
- **Illustrations (experiment, owner decision 2026-11-07).** The owner: "I wouldn't mind experimenting with illustrations at least can kind of ab test". The no-illustration rule above holds whenever the switch is off, and it is off by default. The switch is "Illustrations" under Appearance in Settings, a device setting kept like the theme (`localStorage`, `rl_illustrations`), saved at once with the page's shared "Saved". `EmptyState` and `ErrorState` take an optional `art` key and draw it above the sentence only while the switch is on. At most eight drawings, inline SVG React components in `web/components/illustrations/` (no library, no outside asset): no runs yet, no plan or goal, no race, Trends with no records, Strength with no setup, My paces with no data, a page that did not load, and offline. Rules: hand-drawn line art in the paper-notebook manner, never stock characters, no area fills (a small filled dot is allowed); strokes in `currentColor` (muted text) plus one accent colour, `--accent`, on the few strokes that carry what the page is waiting for, so light and dark both work; `aria-hidden`, no animation; 128px tall, 96px at 480px and under; the sentence, line and button carry all the meaning, so a page reads the same without the drawing. Keep or remove the experiment on the owner's verdict after comparing the two.
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
- **Season strip (Plan page):** `WeeklyHoursChart` in compact mode, the bars alone: one equal band per plan week across the plot width (358 px at 390 wide, 328 at 360), so a week is 14.9 px at 24 weeks, about 11 px at 32 and about 9 px at 40. The outlined planned bar is 8 px and the solid bar 4 px by default; the strip sizes both to its band (about three quarters of it, 6 px at the least) and keeps the outline a stroke narrower than its column, so the outlines of a long plan never touch. The page lays one button per week over the same columns and phase brackets under them, so the chart draws no axis, grid, tooltip or hidden table (the one exception to the last line below: the buttons carry each week's figures). The current week has its outline in `--accent` and a triangle under it, the race week a flag in `--chart-4`, the weeks after the race dashed and faint; cutback and taper weeks are only shorter. Its accessible form is a short description of the plan and a named button for each week.
- **Trends page (`/trends`, rule T1, ADR 0019):** descriptive pictures over months, with no target, no aim line and no mark on a week outside a range. Each has a heading, one caption line, the chart and a visually hidden table with a row per week. Shape carries the meaning and colour second: a bar is a total, a small square (`--chart-2`) is a strength session, a flag (`--chart-4`) is a race week, a shaded band (`--accent-soft`) is the runner's recent range. Dashed lines stay reserved for plans.
  - *Running per week* (`TrendsRunChart`): bars of run time or distance (`--chart-1`), the current week outlined in `--accent` with a soft fill and no point on the line, a 2px `--text` line for the mean of each complete week and the three before it (time only), and a row of strength squares in the same columns under the bars (aria-hidden; the hidden table holds the counts). X ticks are month names (every month, every second or every third by range), not weeks; Y ticks at most three.
  - *Recovery panels* (140 px, `RecoveryChart`): the weekly mean as a 2px `--text` line with a marker per week over the band; a week with too few nights has no marker and the line breaks. No week is marked for sitting inside or outside the band.
  - The page is not on the offline allowlist (ADR 0012); offline it says it needs a connection.
- **Categorical series:** `--chart-1..4` map to run, strength, cross-training and race in that fixed order everywhere; all four are at least 4.65:1 on both light surfaces and 6.65:1 on both dark surfaces.
- Every chart has an `aria-label` giving the latest value and a visually hidden data table.

# Design rules

Added 2026-11-08 (owner decision: the app keeps its current look and improves in small steps, each its own PR; these rules are adopted first so every step follows them). Sections 8 to 18 are rules a reviewer can check. They came from the 2026-11-08 design sweep (six audits over 357 screenshots of `main`); only the direction-independent half was adopted. The look stays as sections 1 to 7 describe it: paper surface, indigo accent, Source Serif 4 for headings and figures, Libre Franklin for everything else.

Where a rule here differs from sections 1 to 7, the rule wins; section 19 lists each case. A rule describes the target. The code moves toward it one PR at a time, and a token a rule names that `tokens.css` does not yet hold (`--text-md`, `--text-hero`, `--chart-h-*`, the breakpoint names) is added by the first step that needs it.

House rules, binding everything below: targets are a sketch, never minimums; no red; no "behind" or "missed"; no streaks, badges, rings, confetti or gamification; figures in lining numerals, tabular wherever digits stack or change; WCAG 2.2 AA at least; works at 360 px; light and dark; reduced motion; offline PWA (fonts self-hosted, no third-party request at runtime).

Token names in this document are the ones in `web/styles/tokens.css`. The ochre status colour is `--warning` (this document says "attention" for its use). Fill and text share the one `--accent`; a separate fill token is added only if a step shows the two need different values.

## 8. Layout grid and spacing

- **Space scale (4 px base), the only values allowed:** 4, 8, 12, 16, 24, 32, 48, 64 (`--space-1` to `--space-8`). No literal px or rem in a component for margin, padding or gap. An optical nudge of 1 or 2 px is allowed only beside a hairline, with a comment.
- **What each step is for:** 4 inside a control group and label to value; 8 label to field, heading to its first line on phones; 12 between related lines of a block, heading to content on wide; 16 between blocks in a section and between fields; 24 between a button row and content; 32 between sections on phones; 48 between sections from 600 px; 64 above the first section on wide screens.
- **Section:** one `Section` component owns rhythm: `padding-block` 32 (compact) or 48 (medium and up), a 1 px top rule, none on the first. No component sets its own outer margin. No gap between two blocks of one section exceeds 24.
- **Breakpoints, named once in `tokens.css`:** `compact` < 600, `medium` 600 to 899, `wide` 900 to 1239, `full` >= 1240. Gutter 16 / 24 / 32 / 32. Tab bar below 900, rail (220 px) from 900. The rail query at 720 px moves to 900. No other width queries in page files.
- **Measures:** `--measure-page` 64rem (reading pages), 72rem only for Today, Plan, Trends, the activity page and Race; `--measure-form` 34rem; `--measure-read` 68ch for prose only, never a container width. Rules, headers, filters and charts run the full page measure; only text inside is capped. Header actions share the right edge of the rule below them.
- **Two columns:** only when each column is at least 340 px (Today from a 1100 px viewport). Primary column 2/3, secondary 1/3; both start on the same top rule; the secondary column's headings are h3.

## 9. Type scale and hierarchy

Sizes and line heights in px; line heights on a 2 px grid.

| Token | Size / line | Role |
| --- | --- | --- |
| `--text-xs` | 13 / 18 | captions, chart ticks, tab labels, table headers, units under 15 px figures |
| `--text-sm` | 15 / 22 | table cells, hints, row meta, chips |
| `--text-base` | 17 / 26 | body, controls (never below 16 in a field: iOS zoom) |
| `--text-md` | 20 / 26 | h3, block titles, verdict sentence |
| `--text-lg` | 24 / 30 | h2, secondary figures |
| `--text-xl` | 32 / 36 | h1, peer lead figures (`Figure` pattern), a race stop's arrival range |
| `--text-hero` | `clamp(2.75rem, 12vw, 3.5rem)` (44 to 56) / 1.05 | the lead figure of every page other than Today |
| `--text-display` | `clamp(3.5rem, 2.2rem + 5.5vw, 5.5rem)` (56 to 88) / 1 | Today's session duration only |

- **Faces:** Source Serif 4 (500, 600) for h1 to h3, lead figures and the figure style below; Libre Franklin for body, labels, controls, units and h4. Weights: body 400; labels and controls 500; buttons 600; h1 to h3 600; h4 600.
- `h1` to `h4` are styled once in `global.css` (h2 `--text-lg`, h3 `--text-md`, h4 `--text-base` 600); components never set a heading size. Visual order follows heading level.
- **One-glance rule:** every page shows, in its first 400 px at 390 x 844, the title, one lead figure with its unit (`--text-hero`, or the `Figure` pattern at `--text-xl` when there are peers) and at most one muted line of 60 characters. At most one hero or display figure per viewport.
- **Weights in prose:** at most one bold phrase per paragraph.
- **Tracking:** display -0.02em, hero -0.015em, h1 -0.01em, h2 -0.005em, all else 0. No all-caps, no eyebrows, no letter-spaced labels. Group labels are 13/18, 600, muted, sentence case.
- The serif figure style never sets a sentence, a link or a label; only a figure and the short value phrase it belongs to ("under 149", "3 to 4"). It never goes below 15 px.

## 10. Numbers and copy

- `tabular-nums lining-nums` on `.num`: tables, week strip, laps, Meter captions, splits, readouts, any figure that updates. The `body`-wide `font-variant-numeric` rule is removed.
- **Units:** after the figure with a no-break space, 0.5 to 0.6 of the figure size (never under 13 px), muted, baseline-aligned, in the sans. Words that follow a figure ("to target", "days to the race") are a sentence at `--text-base` or larger, never unit-sized. Side text beside a hero aligns to the figure baseline, never centred.
- **Formats:** clock durations in tables and splits `3:30:00`; prose and headings `3 h 30 min`; hours to one decimal `7.3 h`; pace `10:46 /mi`; distance to two decimals under 10, one above (`6.16 mi`, `19.5 mi`); thousands separated (`2,037 ft`); dates `Sat 7 Nov`, the year only when it is not this year; axis months `Jan` with the year as a second line at January and the first tick (never `Jan 26`, never clipped). Ranges in prose "30 to 50 g/h"; an en dash only in chart ticks. Negative values use U+2212.
- **Target language:** "3.1 h of 7.5 h target", "0.9 h to target", "0.4 h past target", "3 h 30 min, as planned". Never "behind", "missed", "short", "failed", "streak", "goal crushed", a percentage of a plan, a tick for a met plan, exclamation marks or emoji.
- **Voice:** plain, specific, sentence case, one job per line. Errors say what happened and the next step, never apologise. Subtitles one line. Anything that runs three lines or more under a heading becomes a list or moves behind the page's one "Why" disclosure.
- **Links and actions:** inline link = accent, weight inherited, 1 px underline at 0.2em offset. Standalone action = quiet button. Disclosure = 15 px, 500, accent, 16 px chevron, at the end of the paragraph it qualifies, never alone on a row. At most two accent words per row.

## 11. Components: anatomy and states

**State ladder (every interactive component, colour plus a second cue):**

| State | Treatment |
| --- | --- |
| Hover (`pointer: fine` only) | 6 to 8% `--text` overlay (`color-mix`), 120 ms |
| Pressed | 12% overlay; buttons `scale(0.98)`; 80 ms in, 160 ms out |
| Selected | `--accent-soft` fill, 1 px `--accent` edge, `--text` label at 600, `aria-checked` or `aria-current` |
| Current navigation | accent icon and label, 2 px accent bar on the tab's top edge or the rail item's leading edge; no fill |
| Focus visible | 2 px accent outline, 2 px offset, no layout change; on an accent fill the outline is `--accent-text` with a surface gap |
| Disabled | no opacity: `--surface-sunken` fill, `--text-muted` label, 1 px dashed `--border-strong`, and a reason line where the reason is not obvious |
| Busy | label stays, 16 px arc replaces the leading glyph, width frozen |
| Needs attention / error | `--warning` (ochre, never red): 1 px edge or 3 px leading bar, 16 px glyph, words; the text itself stays `--text` |

- **Buttons:** primary (one per view), secondary (1 px `--border-strong`), quiet (accent text, 8 px padding), destructive = secondary with a leading 16 px trash glyph and a confirm sheet, never red. Height 48 (compact, medium), 44 (wide). Max three in a row, equal basis, primary first; the rest go to the row's sheet. Never a lone wrapped button.
- **Fields:** label above (15/22, 500), 48 px control, `--surface-raised`, 1 px `--border-strong`, `--radius-md`; hint 13/18 muted 4 px below; error replaces the hint with glyph and ochre edge, `aria-describedby`. Native select keeps its picker with a drawn 16 px chevron; number fields hide steppers and use `inputmode`; file input is a secondary "Choose file" plus a muted filename.
- **Checkbox and radio:** 24 px box, 2 px `--border-strong`, drawn tick (2 px, round caps), 44 px row.
- **Choice controls, one idiom:** segmented with a sliding thumb (the selected treatment, inset 2 px, 180 ms `transform`). No underline (underline means navigation). Five or more options: equal-cell grid (5 x 2 for 1 to 10), never a clipped scroller, never a ragged centred last row.
- **Chips:** 28 px tall, 0 10 px, 13/18 600, one radius (`--radius-sm`). Neutral (`--surface-sunken`), accent (`--accent-soft`) and outline variants; dashed only for a default or planned value. Static chips are not tappable.
- **Sheet:** 36 x 4 grab handle, 44 px icon Close (X, `aria-label`), title h2, pinned footer, 16 px fade where the body continues, exit animation (stays mounted until it ends), drag to dismiss past 96 px. Dark: 1 px top highlight. Shadows are tokens for both themes.
- **Toast:** 48 px, leading glyph, verb of the action ("Run saved"), 4 s (6 s with Undo), at most two. The settings "Saved" note is inline beside the changed control, never absolute over a label.
- **Lists and rows:** min 56 px (one line plus gloss) or 72 px (two lines), whole row tappable, chevron only when it navigates. Figures in a fixed grid (`1fr 4.5rem 4.5rem 4.5rem`), right-aligned, tabular. Date groups are 15/22 600 muted labels, not headings. No ellipsis on a phone: wrap.
- **Tables:** header 13/18 500 muted, `nowrap`, aligned like its column; rows 56 px (48 in a split sheet); at 390 the first column plus at most three figures, the rest on a second line; row actions directly after the last data column, never across a gap. The current row: `--accent-soft` fill, 2 px accent leading bar, and its word ("This week", "Today").
- **Panel:** one inset container (`--surface-raised`, 1 px `--border`) allowed per screen for a block that takes input (Review check-ins, the readout row of a chart). Everything else separates by rule and space. No card grids.
- **Meter:** 10 px `--surface-sunken` track; actual in `--accent`; target a 2 px dotted `--text` tick 22 px tall; near band (85 to 100%) `--accent-soft` with a 1 px `--border-strong` edge, because the soft fill alone is too faint against the track (1.05:1 light, 1.34:1 dark; computed 2026-11-08), and that edge is asserted at 3:1 on the track in section 15; overshoot hatched in the accent. The caption states the position in words.
- **Hit areas:** 44 x 44 for every control; text links in rows get padding with a negative margin so the column stays aligned; chart columns 24 px minimum.

## 12. Data visualisation

- **Encoding:** planned = outline or dashed, actual = solid; shape before colour; target = dotted tick; reference line (easy ceiling, mean) = 1 px muted dash 4 3; a range = soft band with a 1 px edge. Dashed lines are reserved for plans and dotted for targets. A colour keeps one meaning across the app: elevation never encodes training volume.
- **Colour:** categories in a fixed order (run `--chart-1`, strength `--chart-2`, cross-training `--chart-3`, race `--chart-4`) and only to separate series; each paired with its own mark (bar, square, diamond, flag). Heart-rate zones use a five-step ramp of the accent hue, `--zone-1` to `--zone-5`, defined by the first step that draws them; each step 3:1 against the surface and 1.4:1 from its neighbour, always labelled, and added to the section 15 test. No red-to-green scale. Charts sit on `--surface`, never on a raised panel.
- **Bands** reach 1.25:1 against what they sit on (surface or track); otherwise draw the edge.
- **Geometry:** heights from three tokens, `--chart-h-sm` 96, `--chart-h-md` 176, `--chart-h-lg` 224. Plot margin left 36, right 12, top 12, bottom 24. Y ticks 3 (sm, md) or 4 (lg). At most five x labels at 360 px; the last label right-aligned to the plot edge, never clipped. Unit once, top of the y axis. A chart of a whole plan shows every week at 360 px, never a scrolled window.
- **Axes:** pace runs faster-up (the y axis inverted, the faster tick at the top) on every chart that draws pace; the caption says so once ("Faster is higher").
- **Strokes:** data 2 px round joins (1.5 px over 300 points), reference 1 px, grid 1 px horizontal only, planned outline 1.5 px. Bars 55 to 70% of the column, 2 px top radius. Dots 8 px.
- **Domains:** drop the first 10 s of a stream and points above the 99th percentile for display only; never clip a line silently. A rolling mean starts only when its window is full. Fewer than four points: a 40 px line ("3 runs needed, 1 so far"), not an empty 176 px frame.
- **Annotation:** each chart has one headline figure (h3-size figure) and one caption (at most 90 characters, 13/18) above it; long rules go behind "How to read this". Label the last point and the peak; draw the references the app knows (easy HR ceiling, planned pace band, target tick). Label series on the plot; a legend only when more than two series cannot be labelled, at most three items.
- **Interaction:** a fixed 40 px readout row above the chart, not a floating tooltip; tap or scrub updates it (`aria-live="polite"`, throttled 250 ms); long-press 300 ms pins it. Streams share one x axis, one crosshair, one readout. Partial periods (this week, this month) always use the outline.
- **Access:** `role="img"` with an `aria-label` that states the latest value, plus a hidden table.
- **One component:** a `Chart` wrapper owns heading, headline, caption, readout, plot, legend slot, table. Stats and Trends share one weekly component.

## 13. Motion

- **Durations:** 80 press, 120 hover and exits, 160 toggles and fades, 220 sheets, 320 the largest reveal, 500 the Today Meter fill only. Entrance `cubic-bezier(.2,.8,.2,1)`, exit `cubic-bezier(.4,0,1,1)`, exits at about 70% of the entrance. Animate `transform` and `opacity` only.
- **Allowed:** sheet in and out, scrim fade, toast in and out, segmented thumb and tab indicator slide, button press, disclosure expand, Meter fill on first Today load (session flag), chart draw-in on first view (line 320 ms, bars 240 ms with 12 ms stagger, 400 ms total), 160 ms cross-fade of a changed figure. **Banned:** count-up numbers, bounce or spring overshoot, confetti, scroll reveals, staggered page entrances, hover lifts, parallax, infinite spinners over 2 s.
- **Reduced motion:** durations collapse to 0.01 ms (tokens), translate and scale removed, end state rendered; no element relies on motion to carry meaning.

## 14. Accessibility

- State never by colour alone (shape, words, edge). Focus always visible. Targets 44 px (24 px for dense chart columns, with a keyboard path).
- Landmarks, one h1 per page, headings in order, sheets trap focus and return it, Escape closes the topmost sheet only. Live regions for toasts, readouts and saves.
- Text zoom to 200% without loss; layout holds at 320 CSS px (reflow). No information only on hover.

## 15. Contrast

- Text 4.5:1 at least on every surface it sits on; body and primary text 12:1; muted 6:1 on surface and raised, 4.5:1 on sunken. Non-text marks, control edges and chart series 3:1. A metadata-only `--text-faint` tier (4.5:1 on surface and raised, never on sunken, never prose) may be added by a step that needs it, with its pair in the test.
- `tests/unit/shared/tokensContrast.test.ts` parses `web/styles/tokens.css` and asserts the pairs below in both themes, and that the dark values under the media query and under `[data-theme="dark"]` are identical. A new token that carries text, a mark or an edge adds its pairs there in the same PR.

| Pair | Minimum |
| --- | --- |
| `--text` on surface, raised, sunken | 12:1 |
| `--text-muted` on surface, raised | 6:1 |
| `--text-muted` on sunken | 4.5:1 |
| `--accent` on surface, raised, sunken, `--accent-soft` | 4.5:1 |
| `--text` on `--accent-soft` | 4.5:1 |
| `--accent-text` on `--accent` | 4.5:1 |
| `--success`, `--warning`, `--danger` on surface, raised | 4.5:1 |
| `--border-strong` on surface, raised, sunken | 3:1 |
| `--chart-1` to `--chart-4`, `--chart-planned` on surface, raised | 3:1 |

## 16. Density per breakpoint

| | compact (< 600) | medium (600 to 899) | wide (900 to 1239) | full (>= 1240) |
| --- | --- | --- | --- | --- |
| Navigation | tab bar 56 + safe area | tab bar | rail 220 | rail 220 |
| Columns | 1 | 1 | 1, Today 2 from 1100 | 2 where the page has a secondary column |
| Section gap | 32 | 48 | 48 | 48 |
| Rows | 56 / 72 | 56 / 72 | 48 / 64 | 48 / 64 |
| Table | first col + 3 figures | first col + 5 | full | full |
| Controls | 48 | 48 | 44 | 44 |

## 17. Empty, error, offline and loading

- **Empty:** one sentence (h2 size), one muted line, one action; a spot mark (section 18) where illustrations are on; content left-aligned to the text column. Every page owns its empty state; the same art never serves two pages.
- **Error:** same layout, different words and glyph; title says what failed, line says what is safe ("Nothing you saved is lost"), primary "Try again".
- **Offline:** a 36 px line at the top of the content, "Offline. Showing what is saved.", plus the cached content; pages off the allowlist say they need a connection.
- **Loading:** static skeletons that copy the final layout within 4 px, `--surface-sunken`, shown after 300 ms; after 1 s an opacity pulse of 6% (none under reduced motion). No spinner under 300 ms.
- **New account Today:** one primary prompt; everything else collapses into a single "Later" list.

## 18. Illustration standard

**No illustration ships unless it is beautiful and deliberate by the rules below. "Good enough" does not ship.** A drawing that fails any item of the review checklist is not shipped, redrawn or left out; the page reads the same without it. Which illustrations the app has at all is the owner's decision and is outside these rules; this section says only how one is built and when it may ship.

**Decision:** no figurative illustration and no licensed set. Empty and error states carry a *spot mark*: a geometric line drawing built on the icon grid in the paper-notebook manner of section 5. Licensed sets were considered and rejected: unDraw (its own licence, not CC0, character scenes), Open Peeps and Humaaans (CC0, but people, which the design bans), Lucide (ISC) as spot art (an icon set at 72 px reads as a blown-up icon, and every Lucide app shares it).

**Why the shoe failed and the cup passed:** a shoe is a closed organic silhouette in perspective with a stack of overlapping parts that everyone knows by heart; hand-set Beziers at 128 px cannot get it right. The cup is an ellipse, a trapezoid and an arc, side-on and symmetrical, forgiving of error. The rule follows: draw only what reduces to primitives, or to lines the eye has no fixed memory of (a route, a ridge).

**Construction:**

- Sheet 160 x 120 units, one scale for every drawing (crop by `viewBox` width only, never per art). Rendered 72 px tall on phones, 96 px from 900 px. Live area inset 8 units.
- Elements: line, arc, circle, rect, rounded rect; at most 8 elements per drawing; no perspective, no tilt; one level of overlap; verticals and horizontals on a 4 unit grid.
- Stroke 2.5 units (1.5 to 2 px rendered), round caps and joins, never below 1.5 px. Dotted: dash `0.1 5.5`, round caps. No area fills except one dot up to 4 units.
- Palette: structure in `currentColor` = `--text-muted`; one accent stroke group in `--accent`, at most 25% of path length, marking what the page is waiting for. Ground line at y 108 for anything that stands.
- Static SVG authored by hand, `aria-hidden`, no animation, no text inside the drawing; the sentence carries the meaning.

**Subjects (closed list, one per page):** runs (a route line ending in a dotted continuation), Today rest day (a ridge line with the sun arc dotted over it), plan (calendar grid, one dotted cell), goals and race (pole and pennant on a ridge), trends (axis with three dots), strength (barbell side-on), paces (stopwatch face), fuel (cup side-on, the accepted drawing), review (open page with one ruled line), stats (stacked bars), load failure (route line with a gap), offline (signal arcs with one dotted). **Banned:** footwear, bodies, faces, hands, animals, food other than the cup, medals, trophies, flames, watches as hardware, anything in perspective. A new subject needs a line here and a primitives sketch first.

**Review checklist (a drawing ships only if all pass):** reads at 48 px tall; reads in greyscale; reads with the accent group removed; same stroke weight as its neighbours at the same size; uses only listed primitives; no element off the 4 unit grid; passes in dark; the page reads the same without it; a second person names the subject in one word without the caption.

## 19. Conflicts with sections 1 to 7, resolved

Each row names the older text and what governs now. Code that still follows the older text moves in its own PR.

| Older text | Governs now |
| --- | --- |
| 2: `--text-lg` 22 / 28 | 24 / 30; `--text-md` 20 / 26 and `--text-hero` added (section 9) |
| 2: every figure lining and tabular (body rule) | `.num` where digits stack or change (section 10) |
| 3: `--page-max` 72rem for every page | 64rem for reading pages, 72rem for Today, Plan, Trends, activity, Race (section 8) |
| 3: `--gutter` 16, 32 from 900 | 16 / 24 / 32 / 32 by breakpoint (section 8) |
| 4: sections separated by `--space-7` | 32 on compact, 48 from 600 (section 8) |
| 5: button variant "danger" (danger text and border) | destructive = secondary with a trash glyph and a confirm sheet, never red; the Delete button changes in its own PR |
| 5: field error in `--danger` with a 2px danger border | `--warning` edge, glyph and words (section 11); `--danger` stays in `tokens.css` until its last user is gone |
| 5: Meter near band `--accent-soft` alone | plus a 1 px `--border-strong` edge (section 11) |
| 5: illustrations 128 px tall, 96 px at 480 and under | 72 px on phones, 96 px from 900 (section 18) |
| 5: at most eight drawings | the closed subject list of section 18 is the ceiling; the shipped set is the owner's decision and each drawing must pass the checklist |
| 5: hand-drawn line art with no stated limits | construction rules of section 18 |
| 7: custom floating tooltip | fixed readout row above the chart (section 12) |
| 7: Y ticks at most three | 3 for small and medium charts, 4 for large (section 12) |

Contrast of `--border-strong` (light) changed from `#8a8996` to `#878693` in the PR that added the section 15 test: 3.19:1 to 3.32:1 on surface, 3.44:1 to 3.58:1 on raised, 2.93:1 to 3.05:1 on sunken.
