import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://ankitb073.github.io/civilization/';
const TITLE = 'Palimpsest — a 5,000-year archive of a world that never existed';

/** Fill the social-card description from the export's meta.json at build time. */
function socialMeta(): Plugin {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return {
    name: 'palimpsest-social-meta',
    transformIndexHtml(html) {
      let desc = 'One seed, fifty centuries simulated: borders, harvests, coinage, sound laws and wars — and the treaties, ledgers, inscriptions and rival chronicles they left behind, every one checked against the record.';
      try {
        const m = JSON.parse(readFileSync(fileURLToPath(new URL('./public/data/meta.json', import.meta.url)), 'utf8'));
        const docs = (m.counts?.artifact ?? m.counts?.documents ?? 0).toLocaleString('en-US');
        const facts = (m.check?.invariants ?? []).reduce((s: number, i: { checked: number }) => s + i.checked, 0).toLocaleString('en-US');
        const viol = (m.check?.invariants ?? []).reduce((s: number, i: { violations: number }) => s + i.violations, 0);
        desc = `${docs} primary sources from 5,000 years of ${m.worldName} — treaties, ledgers, inscriptions, poems and rival chronicles — with ${facts} facts checked against the simulated record. ${viol === 0 ? 'Zero violations.' : `${viol} violations.`}`;
      } catch { /* no export yet: keep the generic description */ }
      return html.replaceAll('%PAL_TITLE%', esc(TITLE)).replaceAll('%PAL_DESC%', esc(desc)).replaceAll('%PAL_SITE%', SITE);
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/civilization/' : '/',
  plugins: [preact(), socialMeta()],
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
}));
