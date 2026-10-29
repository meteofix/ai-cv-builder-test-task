# Evals on real and invented CVs

The tests run on a scripted model and prove the mechanics. How well the real models write and review is measured here, with `apps/api/src/eval/eval-cli.ts`: a whole generation through the real `LlmClient` and the same `generation/compose` steps a job runs (time, tokens and cost of every call), a blind pairwise comparison of two runs, and a reviewer test with planted inventions. The numbers are counts on a small corpus, not rates; they measure, they do not prove.

The corpus is not in the repository, because some CVs belong to real people (used with their permission). The expectations for each input were written from the source before a run. Reports name files and quote their content, so the script refuses an output path that git does not ignore.

## Run it yourself

Live calls are paid (about $0.10 per generation at the default models). `ANTHROPIC_API_KEY` is read from the environment.

```sh
pnpm --filter @cv/api build
# no model call: only the PDF text of every file in a folder
node apps/api/dist/eval/eval-cli.js --mode text --corpus examples --dump /tmp/eval-text --out /tmp/eval-text.md
# a whole generation per file; --roles maps file names to target roles (JSON), --dump keeps the documents
node apps/api/dist/eval/eval-cli.js --mode compose --corpus examples --out /tmp/eval.md --dump /tmp/eval-dump
```

`--mode pairwise` compares two dumps blind and in both orders. The options are described at the top of the file.

## What was checked

- **Inputs.**
  - Dev: 11 CVs, each for a realistic role of its own profession. Ten are PDFs: two-column with a sidebar, banded two-column, dates in a right-hand column, dates and company in a left-hand column, two LinkedIn exports, a Ukrainian two-column CV, a sidebar with subsections inside a job, a LaTeX template, and the repository owner's own CV. One is plain text.
  - The owner's CV was also run for an adjacent role, and five dev CVs for adjacent roles.
  - Free text: 5 inputs — a detailed story, a short vague one, a Ukrainian story, a career change, and prose with a hidden instruction.
  - Two invented inputs were added late: eleven jobs over twenty years, and a student.
  - First holdout, run once at the end: 3 free-text inputs (notes, paragraphs without headings, a Ukrainian list plus a story) and 3 real CVs (a sidebar with subsections, a table with company and dates on the left, a sidebar with a group of positions).
  - Second holdout, 4 more real CVs outside software (HR, product operations, design, product management), one run.
- **Runs.** The final configuration ran once on everything above and a second time on 6 key inputs. Opus/medium ran at least three times on every dev CV across the trials. This is the procedure as the author recorded it; the raw files stay local with the corpus.
- **Covered:** software, data, QA, design, localization, product, engineering management, support, marketing, HR; English and Ukrainian.
- **Not covered:** scanned PDFs (no OCR), three-column layouts, long tables, languages other than English and Ukrainian, DOCX, and a labelled set large enough for confidence intervals.

## Results of the final configuration (author Opus/medium, reviewer Opus/low)

- **Against the previous pipeline (fact-by-fact validator, decision 035).** Blind pairwise comparison by two judges (Opus and Sonnet), each in both orders; a win or a loss counts only when all four verdicts agree, anything else is a split.
  - Dev: 9 wins, 0 losses, 2 splits. Free text: 5 wins out of 5. The owner's CV: a win. A second run on 5 inputs: 5 wins out of 5.
- **Reviewer test.** Inventions are planted into good answers in ten kinds: verb and role inflation, a dropped qualifier, a changed unit, a year moved by one, an added cause, a metric borrowed from another item, a team's result given to the person, a self-assessment, a changed scope. **76 of 76 planted items were flagged** (the scorer counts a plant as found when a reviewer issue names the planted item; it does not check the diagnosis or the class). On the untouched answers it raised 4 findings over 131 text items.
- **Inventions in the final documents:** none found by reading them against the source. What the judges still flag are roundings ("nearly 3 years" for a little less), totals of years counted from the dates (the prompt asks for whole years from the dates), and mild characterisations ("maintains" an open-source project the source lists as current). A judge's "altered LinkedIn link" was a LinkedIn export that wraps the address over two lines; the joined address is the right one.
- **First holdout** (one run): every job has its company and dates on every CV, including the table layout, where the previous pipeline had lost one whole job and the dates of the others; numbers and qualifiers are exact ("10+ language pairs", "~80 %"); links broken over two lines are joined; the traps in the expectations were avoided. It found one bug: messenger handles written without an address ("Telegram @name") became broken links. This was fixed after the run, so for contacts that holdout is no longer independent.
- **Second holdout** (4 real CVs, one run, 30–58 s each, $0.66 in all, one author re-ask, reviewer 0 issues on three and one fix on the fourth; no invented fact found by reading the documents against the parser text):
  - an HR CV: 5 jobs at 4 companies with dates split over two lines, wrapped skill names joined, numbers exact;
  - a product-operations CV: 6 jobs, every number exact, three pages where two were expected;
  - a design / performance-marketing CV: the links hidden behind labels ("LinkedIn", "Telegram") were lost, a summary kept the motivation paragraph, and a course name was silently "corrected" (one case; the reviewer did not catch it, not fixed);
  - a product-management CV: every metric exact and with its own context; a freelancer was asked for a company name (noise).
  - It found four defects, all fixed after the run (so this holdout is no longer independent for these points): link addresses held only in the PDF's link annotations were never read; years of experience were counted without the current date; a company description written on the dates line counted as placed and showed nowhere (now listed in "Not in your CV", decision 040); a skill label or a skill name with a comma of its own was split apart.
- **Stability** (2 runs × 6 inputs): the same jobs, bullets and pages; one difference, a freelance job written once with "Freelance" as its company and once inside its title, which then asked for the company. The time for the same input differs up to 2× (the model's reasoning varies).
- **Time and price per generation** (the compose steps only: no upload, queue or PDF; 17 inputs): median 24 s (16–63 s) and $0.10 (at most $0.24). The dev-only median is 25 s, the number in the table below; the owner's three-page CV takes 63 s.

## Model and effort: the trade-off

([Decision 039](DECISIONS.md#039-v2-models-and-effort--opus-at-medium-writes-opus-at-low-reviews).) Quality is a hard condition: a setting must not be worse than Opus/medium in the pairwise comparison and the reviewer test, and must invent nothing. Among the settings that pass, the fastest is chosen. Because the models vary from run to run, the noise level comes from a second Opus/medium run judged against the first (A/A). "Judge votes" counts the individual verdicts for and against.

| author + reviewer                           | dev median | the owner's CV | cost  | against Opus/medium on dev: agreed W/L/S, judge votes for/against | reviewer test: found, false alarms | what is lost                                          |
| ------------------------------------------- | ---------- | -------------- | ----- | ----------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| Opus/medium + Opus/medium, second run (A/A) | 25 s       | 63–77 s        | $0.09 | 0/1/10, 7/8 — the noise level                                     | 72/77, 4/130                       | —                                                     |
| **Opus/medium + Opus/low (chosen)**         | 25 s       | 63 s           | $0.10 | 0/2/9, 5/9 — within noise                                         | 76/76, 4/131                       | nothing measurable; saves about 1 s                   |
| Sonnet/high + Opus/low                      | 20 s       | 48 s           | $0.07 | 1/1/9, 4/12 — worse than noise                                    | —                                  | detail: lines hidden behind headers, fewer bullets    |
| Opus/low + Opus/medium                      | 20 s       | 32 s           | $0.07 | 0/1/10, 4/15 — worse than noise                                   | —                                  | detail: honours and a thesis, a "technical lead" line |
| Sonnet/medium + Opus/medium                 | 15 s       | 23 s           | $0.05 | 0/7/4 — clearly worse                                             | —                                  | bullets cut mid-sentence, a link cut short            |
| reviewer Sonnet                             | —          | —              | —     | —                                                                 | 74/78, 13/131                      | false alarms take true items out                      |

## Problems found on real CVs, and how they were solved

- **The rules of the fact-by-fact pipeline lost content.** A misquoted position took its bullets with it; a company printed above three titles was erased; skill groups and projects were flattened; about half of the judge's rejections were faithful rewrites. Solution: an author and a reviewer (decision 035).
- **Structure.** Subsections inside a job and records of projects and courses were flattened: every list became groups (decision 036). One paragraph was split into a bullet and its continuation: the author's prompt says one source item is one bullet. Page 1 held only the header: the template now breaks inside a job, never right after a title. A page that starts inside a job read as the previous job's bullets: it now starts with "<Company> — continued".
- **Layout artefacts of two-column PDFs.** A label alone on a line ("Over 1000 lines:") became a skill; a skill name wrapped over two lines was split in two (the author marks such a group as wrapped instead of retyping it); a stylized handle ("Site://name", "Telegram: @name") became a broken link.
- **Wording.** Compression removed the evidence of level ("from scratch", "self-initiated", "closed every finding"): the prompt keeps mechanism, scale and ownership. The reviewer let "providers and models" become "models": it has a class for a changed scope. On a short CV the summary retold the bullets: the prompt asks for a shorter summary there; it is still a split against the previous pipeline on one CV.
- **Silent loss behind a header.** A school or a job could cite its GPA, honours or company description as one of its own lines, so the line counted as placed but showed nowhere. Now a prompt rule, with a script counting such lines: 0 in the three dev runs checked after the rule, against up to 6 per run on Opus/low and 1 on Opus/medium before it. A mechanical check of the same thing (does the line contain the header's name or a year?) was tried and rejected for false flags on lines that were shown.
- **An omitted optional field** in the author's answer used to need a re-ask, and once failed a generation. It is now read as empty.
- **Headings that hold content.** The reviewer also sees the segments the author called headings and may return one that holds content; planted content lines among the headings: 6 of 6 reported, 1 report about a real heading line over 11 clean answers ($0.46).

## Known open items

- "Add" on a multi-line entry the CV left out returns one bullet with the lines joined by spaces.
- On a very short CV the summary still leans on the bullets (one split in the pairwise comparison).
- A free-text input kept a volunteering entry without its dates.
