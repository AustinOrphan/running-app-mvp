# 0015. Sources outside the journals: caps by class, the vetting rubric, book fields on paper records

Status: Accepted 2026-10-31 (#602)

Builds on ADR 0005. Adds the section "Sources outside the journals" to `research/README.md` and a
section of the same name to the skill `research-update`. The reasoning is section 3 of
`docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md`; decisions 1, 2 and 4 of
its section 7 were answered on 2026-10-31.

## Context

The research corpus holds 396 records. The 19 practice records (design `book-or-guideline`, level D,
no DOI) are programme pages, magazine and web articles and clinical documents, and no record is a
book. README method step 7 keeps them at grade D ("they may set a default and never raise a
grade"), but that was a convention: no schema field held an edition, a page, the author's interests
or the result of a check, `research:verify` skips records without a DOI, and no test tied a `Param`
to the cap. One practice record shows the cost: `macroDesign.longRunShareOfWeek` cites, among three
grade D sources, a magazine article that reports a rule of Daniels's book, and the book was not read.

Books are the next sources wanted (Daniels, Pfitzinger, Koop and others, task S3 of the proposal), and
a plan method can only be described from a prescription read on the page. Before any book is added,
the corpus needs a standard for a source outside the journals, a record shape that can hold it, and a
list of what such a source may and may not do.

## Decision

A source outside the journals passes six gates before it is a record, is capped by its class, and its
record states each gate result. A book is a paper record with optional fields.

- **Caps by class.** Coaching books and manuals, programme pages and columns, and data reports
  outside journals: grade D at most. Conference abstracts and theses: C at most. Consensus statements
  and guidelines: graded by content, A to D. Preprints and trial registrations: not admitted; they go
  on `docs/research/watch-list.md`. A dataset analysis in a journal stays a paper graded by its design.
  No class raises a grade, moves a default toward more load or stands in for the study it reports.
- **The rubric R1 to R6** (provenance, author, currency, agreement, applicability, grade cap), in
  `research/README.md` and the skill. R1 and R2 are hard gates: a source that does not pass both is
  held or left out.
- **Sign-off.** The owner, or two independent reading passes that each read the source (README method
  steps 2 and 3). One agent's pass signs nothing off.
- **What stays out.** Forums, anonymous or uncited blogs, marketing, calculator pages, mirrored books,
  retracted work, and text written by a language model, a model's summary of a book included.
- **Recording (option B).** `paperSchema` gains optional `edition`, `isbn` (check digit verified),
  `pagesRead` and `interests`, allowed on `book-or-guideline` records only, and `vetting` (`r1` to
  `r6`, each a result `pass`, `fail`, `hold` or `n/a` with a note, and `signedOff` naming a date),
  allowed on any record. `research:check` fails a `book-or-guideline` record whose `vetting` lacks R1
  and R2 `pass`. The 19 records admitted before the rubric are listed in `PREDATES_RUBRIC`
  (`scripts/research-check.ts`) and exempt until task S4 re-vets each of them and removes it from the
  list; a listed record that passes, or is not a `book-or-guideline` record, is an error. The workflow's
  paper schema lists the same fields and `write-corpus.mjs` keeps them on a rewrite. `PaperCard` shows
  the record's `url`, and a book's edition, pages read, interests and sign-off. What a method prescribes
  goes in a topic `training-methods`, which S3 adds with the first book.
- **A test for the cap.** `params.test.ts` fails when a `Param` whose evidence is practice sources only
  has a grade above D. It covers 15 `Param`s today, all D.

No record, value, grade, `Param`, `PARAMS_VERSION` or oracle digest changes.

Reasons:

- **Fact:** The corpus has 19 records of design `book-or-guideline`, all level D, and 23 of 396 records
  without a DOI (counted over `research/papers` on 2026-10-31). A throwaway script over `allParams()`
  found 33 `Param`s citing a practice source, all grade D, and 15 citing nothing else, the same day.
- **Fact:** `citations()` in `scripts/research-check.ts` and `tests/unit/engine/params.test.ts` resolve
  paper ids only (read 2026-10-31), so a book that a `Param` cites has to be a paper record.
- **Fact:** `verifyPaper` in `scripts/research-verify.ts` returns before any request when a record has
  no DOI (read 2026-10-31), so the provenance of a book or a page can only be a human reading.
- **Fact:** `write-corpus.mjs` wrote every stored record from a fixed list of fields, so a field outside
  the list was dropped when it rewrote `research/papers`; the new writer test failed on that on
  2026-10-31 before the change.
- **Fact:** `PaperCard` showed a DOI link and, for a record without a DOI, only a line saying so (read
  2026-10-31), so the 19 practice records showed no link to their page.
- **Fact:** In a cohort of 102 randomised trials approved in Copenhagen in 1994 to 1995, 62% had at
  least one primary outcome changed, introduced or omitted between protocol and article (Chan 2004,
  abstract read on Europe PMC 2026-10-31).
- **Fact:** 37.3% of meeting abstracts (95% CI 35.3 to 39.3) were published in full, and a positive
  result went with full publication (RR 1.31, 95% CI 1.23 to 1.40; Scherer 2018, 425 reports, abstract
  read on Europe PMC 2026-10-31).
- **Fact:** Peer-reviewed articles reported 5.0% more checklist items than bioRxiv preprints (95% CI 1.4
  to 8.6) in independent samples, which the authors read as "within a similar range" (Carneiro 2020,
  abstract read on Europe PMC 2026-10-31). None of the three studies is about sport.
- **Fact:** The two corpus studies of model output rate plans, not summaries of books: three
  ChatGPT six-week plans rated by coaching experts (`duking-2024-chatgpt-running-plans`) and the
  six-month marathon plans of eight models (`montaruli-2026-ai-marathon-programs`), as their
  populations are recorded (read 2026-10-31).
- **Rule:** README method step 7 (`research/README.md`): practice sources are grade D conventions that
  may set a default and never raise a grade. The D cap, and the new test, restate it.
- **Rule:** G6 in `research/engine-rules.md`: where rules collide the more conservative wins, and a
  change toward more load needs stronger evidence. The caps forbid a source in these classes to move a
  default toward more load, and R4 asks for the conservative reading where sources disagree.
- **Rule:** ADR 0005: a language model never chooses a session. A model's summary of a book would let
  one decide what a book says, so it is never a source (R1).
- **Rule:** `CLAUDE.md`, Structure: the skill `research-update` covers changing the corpus, so the
  steps for these sources live in the skill and the writer, and no other path adds a record.
- **Rule:** README method steps 2 and 3: a researcher and an independent verifier who re-fetches
  every source. The sign-off of two independent passes follows that pair.
- **Opinion:** The C cap for abstracts and theses and the exclusion of preprints rest on biomedical
  studies outside sport (above). They show that protocols, abstracts and preprints can differ from
  the version that survives review, not by how much in running research. The preprint gap is small
  (5%), so preprints wait on a list and are not barred for good.
- **Opinion:** R1 and R2 are the hard gates because a missing reading or an unidentified author cannot
  be repaired by a later reader, while currency, agreement and applicability change how a record is
  used and are recorded as `hold` or `fail` with a note.
- **Opinion:** A verified ISBN check digit catches a mistyped or recalled number, the failure R1 exists
  for, at the cost of about ten lines; a date in `signedOff` lets a sign-off be matched to the
  edition and fetch date it covers.
- **Opinion:** Optional fields on the record that `citations()`, `researchBundle.ts` and `PaperCard`
  already handle keep loading, citing, display and checks on one path, and `vetting` is allowed on a
  journal record so that a reading of a correction notice (R1) has somewhere to go.
- **Opinion:** A named list for the 19 records is better than a rule by date: it exempts exactly those
  records, and goes stale loudly, which keeps the rule from being worn down by a new record with an old
  `checkedAt`.
- **Preference:** Re-vetting all 19 records now (S4), over marking them and re-vetting when next
  touched, is a preference for one standard across the corpus over the cheaper course (decision 2,
  answered 2026-10-31). No constraint forces it.

Alternatives:

- **A. Books as paper records with no new fields** (section 3.4, option A). For (**Opinion**): the
  schema stays as it is. Against (**Fact**): nothing but free-text `notes` could hold an edition, a
  page range, an interest or a gate result, and `research:check` could not tell a read book from a
  recalled one.
- **C. A `research/methods/<id>.json` type** (section 3.4, option C). For (**Opinion**): methods
  become first-class. Against (**Fact**): no `Param` can cite such a file and nothing loads it
  (above). Revisit when a method needs its own citation path.
- **No rubric, only the step-7 convention.** For (**Opinion**): fewer steps per source. Against
  (**Fact**): the convention admitted a rule known only from a magazine's report of a book; the record
  says the book was not read, and no field or check asked for more. Against (**Preference**): decision
  2 chose one standard.
- **Admit preprints and registrations at C.** For (**Opinion**): a strong preprint need not wait for
  publication. Against (**Opinion**): the studies above. Against (**Fact**): a registration carries no
  result, so there is nothing for it to be graded on.
- **A hard-gate rule inside `paperSchema`.** For (**Opinion**): one place for every rule. Against
  (**Opinion**): the list of 19 would sit inside the schema, and `paperSchema` is also parsed by
  `research:verify`, which has no need of it.
- **Require `vetting` on every record, journal papers included.** Against (**Fact**): the other 377
  records are graded by their design (R6), and the rubric is written for the sources outside the
  journals.
- **Cap books at C.** Against (**Rule**): README method step 7 keeps practice sources at D, and
  decision 4 of the proposal puts books in that class.

## Consequences

- `npm run research:check` stays offline and green on 396 records. A new `book-or-guideline` record
  fails it until its `vetting` passes R1 and R2. The check shows that a gate result is recorded, not
  that the reading happened; the sign-off carries that.
- Task S4 re-vets the 19 records against R1 to R6. A record that fails R1 or R2 (the proposal expects
  this of the Daniels article, a magazine's report of a book that was not read) stays on
  `PREDATES_RUBRIC` until it is re-read or removed from the corpus, and a `Param` that loses a source
  goes through `research-update`; S4 changes no value or grade.
- Task S3 adds the first book records, each with `vetting`, and the topic `training-methods`.
- The corpus workflow cannot admit a book: its agents return summaries. A book record is written by
  hand in the session that reads the pages.
- `docs/research/watch-list.md` is prose that no check reads; it holds no item today.
- The Research page and the why drawer show a record's page by host name and, for a book, its edition,
  pages read, interests and sign-off. The gate results stay in the JSON.
