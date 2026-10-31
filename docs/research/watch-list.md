# Watch list

Preprints and trial registrations that bear on the training engine and are not in the research
corpus. The corpus does not admit either class (`research/README.md`, "Sources outside the
journals"): a preprint has not been peer reviewed and a registration carries no result. A rule, a
topic synthesis or a `Param` never cites an item on this list, and `npm run research:check` does not
read this file.

## What belongs here

- A preprint (for example on SportRxiv) or a trial registration (ClinicalTrials.gov, ISRCTN) whose
  question or result would matter to a rule or a gap of `research/engine-rules.md`.
- One row per item, identified by DOI for a preprint or by registry id for a registration.
- The date the row was added, in `YYYY-MM-DD`.
- Why the item is watched: the rule, gap or `Param` it would bear on.
- What would move it into the corpus: normally publication in a peer-reviewed journal for a preprint,
  and a published report of the results for a registration.

## How a row leaves

When the journal version or the results appear, the paper is added through the skill
`research-update` ("Add a paper"; the gates R1 to R6 apply to it like any source) under the id of the
published paper, and the row is deleted in the same change. A row is also deleted when the item is
withdrawn, or when the question it bore on is closed; the reason goes in the commit message.

## Items

| Item | DOI or registry id | Added | Why watched | Moves into the corpus when |
| ---- | ------------------ | ----- | ----------- | -------------------------- |

No item is listed (2026-10-31).
