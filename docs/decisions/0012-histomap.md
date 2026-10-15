# 0012: A Histomap view of five thousand years of power

**Context.** The map shows one year at a time. Nothing shows the whole arc at a glance: who rose, who fell, who lasted.

**Decision.**
- Export `histomap.json`: every state as a stream whose width is its share of the population living under states, sampled every 20 years, ordered west to east by founding capital.
- The 140 largest states are kept and the rest folded into "lesser states".
- The atlas renders it as a vertical scroll, in the spirit of John B. Sparks's *Histomap* (1931).

**Why.**
- It is the single most shareable picture of the whole simulation.
- Its readability comes from the deterministic data. Hand-drawn histomaps had to invent theirs.
