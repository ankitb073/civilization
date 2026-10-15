import { useState } from 'preact/hooks';
import { surprise } from '../extras.ts';

export function SurpriseButton({ label = 'Surprise me', compact = false }: { label?: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button class={`btn surprise${compact ? ' surprise--compact' : ''}`} disabled={busy} title="Open a random document (flagship sources are five times as likely)"
      onClick={() => { setBusy(true); surprise().finally(() => setBusy(false)); }}>
      <svg class={busy ? 'is-rolling' : ''} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="1.8" />
        <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" />
      </svg>
      {label}
    </button>
  );
}
