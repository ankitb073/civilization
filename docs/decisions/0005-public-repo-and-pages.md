# 0005: Public repository, MIT licence, GitHub Pages

**Context.** The brief says "open-source, self-hosted". The owner's default is private repositories.

**Decision.**
- The owner chose a public repo (`ankitb073/civilization`) under the MIT licence.
- CI rebuilds the world from the seed on every push, gates on the consistency checker, and deploys the static atlas to GitHub Pages.
- Generated data is not committed. It is a build output.

**Why.**
- The site is shareable with a live URL.
- Reproducibility is visible: the data on the site is exactly what the code produces.
