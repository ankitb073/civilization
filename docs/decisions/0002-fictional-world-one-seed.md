# 0002: A fully fictional world from one seed

**Context.** An Earth-analog would invite comparison with real history. The point of the project is *synthetic* history.

**Decision.**
- Generate the whole world procedurally from a single integer seed: continents, rivers, climate, peoples, languages and gods.
- Derive every random stream from that seed by name (`Rng.fork(label, …)`), never from call order.

**Why.**
- The result is reproducible: the same seed and code give a byte-identical database.
- It stays stable under development: changing one system doesn't reshuffle the others.
- Anyone can regenerate the archive and audit it.
