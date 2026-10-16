# How accurate are the flagships?

The checker proves what it can read: links, dates, citations, quotations placed before a catalogue number. It cannot read prose. "The victors lost more men than the vanquished", "she peaked in 1740", "of the 840 documents that survive": a sentence like these is only as good as the agent that wrote it and the fact-checkers that followed. So we measured.

## Method (2026-10-15, after simulation v2 stage 1 and the flagship revision)
- **Sample:** 30 flagships drawn at random (seed 20261015), stratified by series:
  - 5 turning-point sources;
  - 3 rival-chronicle essays;
  - 8 wave-2 sources;
  - 4 Lives;
  - 6 voices from below;
  - 4 History chapters.
- **Checking:** three independent auditor agents each took ten files. They checked every claim, sentence by sentence, against the record (`world.sqlite`): dates and ages, rulers, family and sex, battles and wars, relative losses, treaty terms and signatories, statistics, superlatives, quotations and descriptions of documents, catalogue metadata, and anachronism.
- **Bias:** in-world voices may boast and lie in character. That is not counted as an error unless the bias runs the wrong way (nobody inflates their own dead) or the author could not know it.
- **Severity:** major means a reader would be misled on a fact that matters to the piece; minor means a small number or detail is off.

## Results

| Series | Files | Claims checked (approx.) | Major | Minor |
|---|---|---|---|---|
| Turning points, essays, wave-2 sources | 10 | 318 | 2 | 5 |
| Wave-2 sources, Lives | 10 | 415 | 0 | 1 |
| Voices, History chapters | 10 | 610 | 0 | 11 |
| **All** | **30** | **~1,340** | **2** | **17** |

That is about one error per 70 checked claims, and 0.07 major errors per file. Half the files were clean. The six voices from below and the four Lives had one error between them, a language claim in a voice that was a judgement call.

## What the errors were, and what we fixed at the source
- **Both major errors came from the archive, not the writers.** The chronicle generator computed each side's territory claim for the comparison view ("14 districts won"; the loser's "a few villages") but never wrote it into the tablet. The essays cited those claims faithfully, so they misdescribed their sources. Fix: chronicles now state the districts they claim, and the loser's claim follows the sentence its text actually uses (#23). A sweep of every essay and lecture on the chronicles followed: eight more files were corrected, and the rest already matched.
- **Most minor errors were in the History, and came from its fact sheets.**
  - A great power's size was given as its largest within the chapter's 250 years, so "peaked in 1740" was false for states that kept growing.
  - Document counts left out the literary works without saying so.
  - One count was taken up to the last decade start rather than the end of the period.
  - Fix: the fact sheets now label each figure with what it counts, and count each sound change once.
  - Sweep: all 21 chapters were then checked for the three patterns, about 300 instances in all. 37 small fixes were made in 16 chapters.
  - The commonest fix (8 of the last 10 chapters) was a single combined figure for "coinages and weight standards", which the chapters gave as one kind. Next came peaks that were not peaks, and document counts that silently left out the literary works.
- **The rest were single slips:** a decade row read as a point date (an old trap), an earlier yoke attributed to the wrong state, an omitted regnal numeral in a quotation.

**Outside the History, a follow-up sweep** checked every statistic in the 23 modern essays and lectures. It found 16 minor errors in 8 of them. All but one were the old decade-row trap: a row labelled 450 describes the 450s, not the year 450. The other was a word-replacement date that the essay had taken from the atlas, where the date was wrong (#28, fixed).

A last sweep of the biographical essays on the founders of faiths found 7 minor errors of a new kind. Essays written in AY 4950 gave a faith's size "at its height", but that height comes near AY 5000, after their date, because the fact sheet passed on the end-of-record peak. The essays now give the size at their own date, taken from a rerun of the canonical simulation. The fact sheet now keeps a peak only for faiths that had already ended.

The audit also turned up two oddities in the record itself, both filed: merchant houses trading iron before iron smelting (#27), and a famine listing a state that had just ended (#18).

## Lives II and III (2026-10-16): what one fact-check leaves behind

Sixty new Lives were each written by one agent from a fact sheet and then checked once by another (decision 0018). This time we measured both stages, and the second measurement is the one that matters: how much survives a single check.

**The first check.**

| Wave | Files | Claims checked (approx.) | Errors fixed | Clean files |
|---|---|---|---|---|
| Lives II (generals, inventors, founders, merchants, rebels, regents, chroniclers, heads of state) | 48 | 4,150 | 45 | 25 |
| Lives III (envoys, priests, usurpers, philosophers) | 12 | 950 | 13 | 2 |

That is about one error per 90 claims in fresh drafts. None was major in the sense above, but some would have misled a careful reader:
- the wrong man dying in a sentence;
- a superlative ("only one other") where SQL found two others;
- an excavation's "21 inscriptions" that included two muster rolls and a treaty;
- a battle credited to a king that his general fought;
- an election count that ran to AY 5000 in an essay dated 4955.

The commonest kinds were descriptions of documents (what a text says, its medium, which stanza a line is in), superlatives, and inventions in small connective phrases ("her chronicler" for a man appointed after her death).

**The audit.** Four auditors then took a random third of Lives II, 16 files drawn with seed 20261016, and checked every claim independently, without reading the checkers' notes until afterwards.

| Files | Claims checked (approx.) | Major | Minor |
|---|---|---|---|
| 16 | 1,195 | 0 | 2 |

About one error per 600 claims, and no major ones. One was an ambiguous clause that read as a false age. The other is the instructive one: **the fact-checker had introduced it.** The writer's excavation counts (105, 104, 315) were right; the checker recounted using published reports instead of digs and changed them to 102, 103 and 311. A single check removes most errors but can add its own, so checkers should change a figure only after finding the query that disagrees, and should say which.

**What the writers found in the record.** Close reading of sixty lives surfaced dozens of inconsistencies in the generated archive itself. The worst were fixed at the source and their flagships revised:
- 1,644 documents credited to translators who had died before the text was written (#38, now an invariant);
- 323 coins whose recorded end came before states stopped using them;
- treaties, chronicles and annals giving one event three different days (#41);
- chronicles of republics calling their president "king" (#40);
- victors' assemblies debating a won peace in the losers' words (#43);
- 5,567 editorial notes that spoke of "the ground truth" instead of the record (#42).

The rest are filed: armies counted in full on two fronts at once (#39), and women given men's names (#44).

## Caveats
- **This measures what the auditors caught.** Agents check claims well, but they can share a blind spot with the writers. Read the error rate as a lower bound, not a proof of accuracy.
- **The first audit is a sample of 30 out of 656, the second 16 out of 48.** Errors cluster by series and by cause, and a 95% interval on "major errors per file" from 2 in 30 runs from about 0.01 to 0.24.
- **The audit ran after an unusually thorough revision.** Most flagships had been fact-checked twice and revised against the corrected record on the same day.
