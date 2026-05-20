import { NextResponse } from 'next/server';
import { getCronStatus, sendsToday } from '@/lib/cron-status';
import { getAppSettings } from '@/lib/app-settings';
import { getHiddenListIds } from '@/lib/hidden-lists';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Read-only ops view for the Settings page: Brevo reachability, last cron
 * run, sends-today vs cap, hidden list count. Each probe is best-effort —
 * one slow or failing call doesn't take the whole panel down.
 */
export async function GET() {
  const [brevo, cron, settings, hiddenIds] = await Promise.all([
    probeBrevo().catch(err => ({ ok: false as const, error: err?.message || String(err) })),
    getCronStatus().catch(() => ({ history: [] as any[] })),
    getAppSettings().catch(() => null),
    getHiddenListIds().catch(() => [] as number[]),
  ]);

  const sends = await sendsToday().catch(() => 0);
  const dailyCap = settings?.cadence.dailySendCap ?? 50;

  return NextResponse.json({
    brevo,
    cron: {
      lastRun: (cron as any).lastRun || null,
      sendsToday: sends,
      dailyCap,
    },
    hiddenLists: hiddenIds.length,
  });
}

async function probeBrevo(): Promise<{ ok: boolean; email?: string; error?: string }> {
  if (!process.env.BREVO_API_KEY) {
    return { ok: false, error: 'BREVO_API_KEY not configured' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `Brevo returned ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, email: data?.email };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? 'Brevo timed out' : (err?.message || String(err)) };
  } finally {
    clearTimeout(timer);
  }
}
