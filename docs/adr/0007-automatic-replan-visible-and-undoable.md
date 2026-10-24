# 0007. The weekly re-plan stays automatic, and every re-plan is visible and undoable

Status: Accepted 2026-10-23 (#546)

## Context

The rewrite design (`docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md`, section 2)
lists as an anti-goal "any automatic change to a training target without the owner's decision".
The scheduler already re-plans every active version-2 plan on Monday at 03:00 local time
(`REPLAN_SLOT` in `server/jobs/scheduler.ts`) and writes a `PlanRevision` with week-level field
changes, which the Plan page lists in a collapsed "What changed" panel. Nothing tells the runner a
change happened, nothing shows which sessions moved, and nothing reverses it.

The phase 3 audit (2026-10-22) found that this adaptation is invisible, so the app reads as one that
does not adapt, and that the plan is about to be published to a watch (ADR 0008): a watch fed by a
plan that waits for acceptance goes stale whenever the runner does not open the app on Monday. The
owner's mandate is a self-adjusting coach.

Two designs for phase 3a (the explanations epic and the disruptions epic) each proposed a revision
model and an undo route for the same table. They differed in storage (full-row snapshots against a
row-level payload), in what blocks an undo (edits to touched rows against any newer revision) and in
safety (inform against refuse). One model is chosen here.

## Decision

The engine may re-plan on a schedule, when a review is saved and on request. Each re-plan, each
owner edit of a session and each disruption window is stored as a `PlanRevision` with a
session-level diff and a row-level undo payload: the rows the change created, the full rows it
deleted, the changed columns of rows it updated, and a content hash of each row's state after the
change. A what-if preview, built by the same code as the commit, shows the diff before any
owner-initiated change, undo included, is applied.

A revision can be undone in one action while all of these hold:

1. it is effective (has a payload, is not undone, is not itself an undo) and its plan is active;
2. it is younger than `revision.undoWindowDays` (7 days, a grade D default);
3. no session, week or rest window it created or changed has changed since (by content hash); a
   later change to other rows does not block it;
4. none of its sessions has been run or linked to an activity since;
5. no safety rule it cites (n-1 to n-4 in `research/engine-rules.md`) is still active, except that
   a rest window the runner reported can always be withdrawn;
6. the restored plan passes the plan quality checklist.

Undo restores sessions dated today or later and leaves the past as it is, except the back-dated
skips of a rest window that the undone revision created. An undo is itself a revision; it has no
undo of its own. Undo restores the plan, not the data: the next re-plan can make the same change
when the data still supports it, and the confirm text says so. Targets the owner set by hand (week
overrides) and rest windows are not overwritten by a re-plan; a re-plan may still lower a week below
an owner's target when a limit requires it (G6). Sessions the owner moved, adjusted (shortened or
swapped) or skipped are kept for `macroDesign.keepOwnerEditsDays` (14 days, a grade D default) from
today, and the rest of those weeks is planned around them; a session dated later is rebuilt with its
week, and the revision shows it and can be undone (`keptByReplan` in `shared/engine/index.ts`). A
rest window releases the edits that fall on a day it holds (rule J9). Each revision has one `seenAt`
marker, which Today, the Plan page and the weekly brief share.

Amended 2026-10-23 (phase 3a close review): the paragraph first said that moved, shortened and
skipped sessions "are not overwritten by a re-plan". The shipped rule has the 14-day horizon, which
the engine already carried when this ADR was written (#529), so the text is brought to the code.
The horizon is a default that no evidence picks (**Preference**: grade D). The anti-goal holds
beyond it (**Fact**: checked 2026-10-23 in `server/services/planEngine.ts` and `replan.ts`): the
rebuilt session is in the revision's diff and the undo payload is built from the rows written.

The anti-goal is amended to: "Any change to a training target that the owner cannot see and
reverse. Changes the engine makes on schedule are shown as revisions and can be undone; targets the
owner set by hand are kept unless a safety limit requires a lower week, and the change is shown as a
revision."

Reasons:

- **Rule:** `research/engine-rules.md` G6 ("Safety first") makes the more conservative rule win, so
  undo cannot restore load that n-1 to n-4 hold back.
- **Rule:** ADR 0005 and G1 keep every plan decision and every sentence about it deterministic; the
  diff text is built from templates over the stored diff, not by a model.
- **Fact:** the weekly re-plan already runs automatically (`REPLAN_SLOT` in
  `server/jobs/scheduler.ts`, checked 2026-10-22), so this decision adds visibility and reversal, not
  a new automatic behaviour.
- **Fact:** a re-plan rewrites only a handful of sessions once session identity keeps unchanged rows
  in place (design spec section 4.1), so a row-level payload is a few kilobytes per Monday; the
  full-row snapshot proposed in the explanations design was estimated at about 100 KB per Monday
  (phase 3a design review, 2026-10-22).
- **Fact:** the audit's Runna lens (2026-10-22, third-party reviews) reports that the most repeated
  complaint about that app is a plan that does not adjust after a disrupted week, and its Strava lens
  found no visible record of plan changes.
- **Opinion:** a change the runner can read and reverse in one tap costs less trust than a proposal
  that waits for acceptance; with a proposal, a runner who skips Monday trains on, and publishes to
  the watch, a plan that has gone stale.
- **Opinion:** blocking an undo only on the rows the update touched keeps Monday's undo available
  after the runner moves one session on Tuesday; the hash check, the safety rule and the checklist
  bound the risk of restoring rows next to changed ones.
- **Opinion:** comparing content hashes rather than `updatedAt` keeps a run being linked to a
  session (which updates the row) from reading as an edit; it is reported as its own reason.
- **Preference:** one-tap undo over per-change accept or decline, because the owner asked for a
  self-adjusting coach.
- **Preference:** a 7-day undo window; the length is a default, not a result.

Alternatives:

- **A weekly proposal that waits for acceptance.** Against (**Opinion**): the stale-watch case
  above. Against (**Fact**): every change is already bounded by the engine's limits G-1 to G-3 and
  the quality checklist, so a proposal adds a decision without adding safety.
- **Keep the silent weekly re-plan.** Against (**Rule**): the amended anti-goal. Against
  (**Opinion**): adaptation nobody sees reads as none.
- **Last-in-first-out undo (only the newest revision).** Against (**Opinion**): one later edit,
  however unrelated, would cancel the undo of a Monday update the runner has not opened yet.
- **Inform about an active safety flag but allow the undo.** Against (**Rule**): G6.
- **Full-plan snapshot per revision.** Against (**Fact**): the size estimate above; against
  (**Opinion**): restoring whole weeks would overwrite owner edits made after the update.
- **No undo window.** Against (**Opinion**): an undo weeks later restores sessions planned from
  data that no longer describes the runner; the touched-row rule alone does not bound that.
- **Per-field locks on targets.** Against (**Opinion**): configuration nobody sets, which the
  rewrite design lists as an anti-goal; a hand-set target is already kept.

## Consequences

- `PlanRevision` gains `auto`, `decision`, `diff`, `undo`, `undoneAt`, `undoneById`, `undoOf`,
  `seenAt` and `disruptionId`; existing rows get `auto` for weekly and break revisions and
  `seenAt = createdAt`, and have no diff and no undo.
- `computeReplan` (reads only), `applyReplan` and `recordPlanWrite` in `server/services/replan.ts`
  become the only way to write a re-plan or a revision; `replanActivePlan` keeps its signature as a
  wrapper. One `computeAction` builds both a preview and its commit.
- Re-plans write row-level changes through the session identity of the foundation epic, so unchanged
  sessions keep their ids and published workouts are updated rather than duplicated.
- Undo answers with a reason when refused: an edit to a touched row, a run linked since, an active
  safety rule, a failing checklist, an expired window, an archived plan or an earlier undo.
- A restart after the Monday slot no longer skips the week's update: a catch-up runs the re-plan when
  no weekly revision exists for the current week.
- The rewrite design's anti-goal and the training-engine design section 5 are edited in the same
  change as this ADR's acceptance.
- A change to the 14-day horizon is a change to `macroDesign.keepOwnerEditsDays` through
  `research-update`, and amends the Decision above.
