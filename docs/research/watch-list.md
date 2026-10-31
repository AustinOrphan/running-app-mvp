# Watch list

Preprints and trial registrations, and a published paper that was read in full and left out, that
bear on the training engine and are not in the research corpus. The corpus does not admit a
preprint or a registration (`research/README.md`, "Sources outside the journals"): a preprint has
not been peer reviewed and a registration carries no result. A rule or a `Param` never cites an item
on this list, a topic synthesis never cites one as support (it may name a paper left out, to say why
no rule uses it), and `npm run research:check` does not read this file.

## What belongs here

- A preprint (for example on SportRxiv) or a trial registration (ClinicalTrials.gov, ISRCTN) whose
  question or result would matter to a rule or a gap of `research/engine-rules.md`.
- A published paper that was read in full and left out because it fails a gate of the rubric, when
  its question matters to a rule or a gap and something specific would move it in.
- One row per item, identified by DOI for a preprint or a published paper and by registry id for a
  registration.
- The date the row was added, in `YYYY-MM-DD`.
- Why the item is watched: the rule, gap or `Param` it would bear on.
- What would move it into the corpus: normally publication in a peer-reviewed journal for a preprint,
  and a published report of the results for a registration.

## How a row leaves

When the journal version or the results appear, the paper is added through the skill
`research-update` ("Add a paper"; the gates R1 to R6 apply to it like any source) under the id of the
published paper, and the row is deleted in the same change. A row is also deleted when the item is
withdrawn, or when the question it bore on is closed; the reason goes in the commit message. A row
for a published paper that was left out leaves when what its last column names has appeared and
the paper then passes the gates.

## Items

| Item                                                                                                                                           | DOI or registry id         | Added      | Why watched                                                                                                                                                                                                                                                                                                                                         | Moves into the corpus when                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qin G, Lee S, Kim S, Scientific Reports 15:41516 (2025), machine-learning personalized marathon training; published, read in full and left out | 10.1038/s41598-025-25369-7 | 2026-10-31 | The one trial that reports matching a training method to a characteristic of the runner (experience): it bears on rules P1 to P4 of `research/engine-rules.md` and on the gap that no study shows a method to suit a runner. Left out because R4 and R5 hold and its tables do not reconcile with its text (`research/topics/training-methods.md`). | A registration or protocol that fixes the training and the outcome, the training logs or the data, a correction that reconciles its tables with its text, or a replication in recreational runners. |
