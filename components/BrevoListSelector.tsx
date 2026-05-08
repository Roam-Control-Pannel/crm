'use client';
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Users } from 'lucide-react';

/**
 * BrevoListSelector
 *
 * Reusable picker + sync widget for Brevo list filtering. Drop this into any
 * page that needs to filter views by Brevo list. Manages the list dropdown
 * state internally and calls back when the user picks a different list or
 * triggers a sync.
 *
 * Lists are re-fetched whenever the user clicks Sync — that way new lists
 * created directly in the Brevo dashboard show up without a page reload.
 *
 * The component does NOT control "what to do" with the selected list — the
 * parent page decides whether/how to filter its data based on the listId.
 */

interface BrevoList {
  id: number;
  name: string;
  uniqueSubscribers?: number;
}

export interface BrevoListSelectorProps {
  /** Currently selected list id, or null for "All lists". */
  value: number | null;
  /** Called when user picks a different list. */
  onChange: (listId: number | null) => void;
  /**
   * Called when user clicks Sync. Parent should re-fetch its own data.
   * Returns a promise so we can show a spinner while it runs.
   */
  onSync?: () => Promise<void> | void;
  /** Hide the sync button (for cases where sync makes no sense). */
  hideSync?: boolean;
}

export function BrevoListSelector({ value, onChange, onSync, hideSync }: BrevoListSelectorProps) {
  const [lists, setLists] = useState<BrevoList[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadLists = useCallback(async () => {
    try {
      const res = await fetch('/api/brevo/lists', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setLists(data.lists || []);
    } catch (err) {
      console.error('Failed to load Brevo lists:', err);
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      // Refresh the list-of-lists so newly-created lists appear without a
      // page reload, and let the parent re-pull whatever data it cares about.
      await Promise.all([
        loadLists(),
        onSync ? Promise.resolve(onSync()) : Promise.resolve(),
      ]);
    } finally {
      // Keep the spinner up for a beat so the click feels solid.
      setTimeout(() => setSyncing(false), 250);
    }
  }

  const selected = value !== null ? lists.find(l => l.id === value) : null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 14px',
      background: 'var(--white)',
      border: '1px solid var(--ink-100)',
      borderRadius: 'var(--r-md)',
      flexWrap: 'wrap',
    }}>
      <Users size={14} color="var(--ink-400)" />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-500)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        List
      </span>
      <select
        value={value === null ? '' : String(value)}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
        disabled={loadingLists}
        style={{
          padding: '6px 10px',
          fontSize: 12.5,
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-md)',
          background: 'var(--white)',
          color: 'var(--ink-900)',
          fontFamily: 'inherit',
          cursor: 'pointer',
          minWidth: 200,
          fontWeight: 500,
        }}
      >
        <option value="">All lists ({lists.reduce((s, l) => s + (l.uniqueSubscribers || 0), 0) || '…'})</option>
        {lists.map(l => (
          <option key={l.id} value={l.id}>
            {l.name}{typeof l.uniqueSubscribers === 'number' ? ` (${l.uniqueSubscribers})` : ''}
          </option>
        ))}
      </select>

      {selected && (
        <span style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 600 }}>
          → {selected.name}
        </span>
      )}

      {!hideSync && (
        <button
          onClick={handleSync}
          disabled={syncing || loadingLists}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            marginLeft: 'auto',
            padding: '6px 12px',
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--ink-700)',
            background: 'var(--paper)',
            border: '1px solid var(--ink-200)',
            borderRadius: 'var(--r-md)',
            cursor: syncing ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            opacity: syncing ? 0.7 : 1,
          }}
          title="Re-fetch lists and contacts from Brevo"
        >
          <RefreshCw size={12} style={syncing ? { animation: 'spin 0.8s linear infinite' } : undefined} />
          {syncing ? 'Syncing…' : 'Sync from Brevo'}
        </button>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
