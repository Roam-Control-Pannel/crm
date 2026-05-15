'use client';

import { useEffect } from 'react';

// Global error boundary — catches errors in the app shell's render tree
// so the user sees a recoverable screen instead of Next's default frame.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error.tsx]', error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 16,
        fontFamily: 'var(--font-ui)',
        color: 'var(--ink-900)',
      }}
    >
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28 }}>
        Something went wrong
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 420, textAlign: 'center' }}>
        The page didn't load. This is usually a temporary glitch — try again.
      </div>
      <button
        type="button"
        onClick={reset}
        className="btn-primary"
        style={{ marginTop: 4 }}
      >
        Try again
      </button>
    </div>
  );
}
