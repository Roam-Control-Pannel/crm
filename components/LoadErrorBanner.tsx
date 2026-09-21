'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * FAIL-CLOSED-READS-V1
 *
 * Shown when a page could not read its data from the store.
 *
 * Before fail-closed reads, this state was invisible: a failed read returned
 * the same empty value as "nothing stored", so the page rendered as though
 * the account were new — an empty task list, no briefs, no accounts — and the
 * next save wrote that emptiness back. The banner exists so the difference
 * between "you have nothing" and "we couldn't load it" is on screen, and so
 * the page can refuse to save rather than quietly destroying data.
 *
 * Deliberately blunt: it tells the user not to edit, because any save from a
 * half-loaded page is the exact write we are trying to prevent.
 */
export default function LoadErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        marginBottom: 16,
        background: 'color-mix(in srgb, var(--alert) 8%, var(--white))',
        border: '1.5px solid var(--alert)',
        borderRadius: 'var(--r-sm)',
        color: 'var(--ink-900)',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <AlertTriangle size={16} color="var(--alert)" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        <strong style={{ display: 'block', marginBottom: 2 }}>Couldn’t load your data</strong>
        <span style={{ opacity: 0.85 }}>{message}</span>
        <span style={{ display: 'block', marginTop: 4, opacity: 0.85 }}>
          Nothing has been changed. Please reload before editing — saving from this
          screen could overwrite what’s stored.
        </span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            background: 'var(--white)',
            color: 'var(--ink-900)',
            border: '1.5px solid var(--ink-200)',
            borderRadius: 'var(--r-sm)',
          }}
        >
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}
