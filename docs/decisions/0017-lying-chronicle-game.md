# 0017: A daily game, "Catch the lying chronicle"

**Context.** The archive's most distinctive idea is that its sources lie in character. Rival palace chronicles tell the same war, each shrinking its own dead and inflating the enemy's, against a record that knows the truth. The comparison view shows this, but a visitor has to find a war and read a table. Nothing invites a casual visitor to *do* something, or gives them a result to post.

**Decision.** `#/game`:
- **Daily rounds:** five rounds a day, the same for everyone (seeded by the date), drawn from the 660 wars whose two rival accounts survive. "Play five more" draws a random set.
- **A round:** both scribes' figures are shown side by side, and the player estimates one side's true dead on a logarithmic slider. The score runs from 10 for the exact figure down to 0 when off by a factor of four.
- **The reveal:** the record's figures, how each scribe bent them ("its own dead cut to 48%, the enemy's ×3.9"), and a link to the full comparison.
- **The end:** a score, emoji squares and a share button (share sheet on phones, clipboard elsewhere). The share link is `s/game.html`, a static page with its own card that opens the game.
- **Data:** `game.json` (49 KB gzipped) is exported from the comparison data, so the game can only show claims that the chronicles actually make (#23).

**Why.**
- **It teaches the archive's method in a minute.** By the second round most players work out that the truth usually lies between the two scribes.
- **A score is the most shareable thing a site can give.** It is new, small, and built entirely on data the archive already checks.
