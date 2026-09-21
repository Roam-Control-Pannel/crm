import { NextResponse } from 'next/server';
import { getCronStatus, sendsToday, getInboundStatus } from '@/lib/cron-status';
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
  // FAIL-CLOSED-READS-V1: these catches are deliberate — this is a
  // read-only ops panel and one failing probe shouldn't blank the rest. But
  // a failed read is reported AS a failure rather than as a plausible zero:
  // "0 of 50 sent today" when the history is simply unreadable is exactly
  // the misreading that let the send cap reset unnoticed.
  const FAILED = Symbol('failed');
  const [brevo, cron, settings, hiddenIds, inbound] = await Promise.all([
    probeBrevo().catch(err => ({ ok: false as const, error: err?.message || String(err) })),
    getCronStatus().catch(() => FAILED as any),
    getAppSettings().catch(() => null),
    getHiddenListIds().catch(() => FAILED as any),
    // INBOUND-HEALTH-V1
    getInboundStatus().catch(() => FAILED as any),
  ]);

  const sends = await sendsToday().catch(() => FAILED as any);
  const dailyCap = settings?.cadence.dailySendCap ?? 50;
  const cronUnavailable = cron === FAILED;

  return NextResponse.json({
    brevo,
    cron: {
      unavailable: cronUnavailable,
      lastRun: cronUnavailable ? null : ((cron as any).lastRun || null),
      sendsToday: sends === FAILED ? null : sends,
      dailyCap,
    },
    hiddenLists: hiddenIds === FAILED ? null : (hiddenIds as number[]).length,
    // INBOUND-HEALTH-V1: the reply poller had no health surface at all. A
    // stale `lastRun` here is the signal that replies are not being ingested
    // — which is what lets the sequences cron send a "final nudge" to someone
    // who already wrote back.
    inbound: inbound === FAILED
      ? { unavailable: true, lastRun: null, staleMinutes: null }
      : (() => {
          const last = (inbound as any).lastRun || null;
          const staleMinutes = last
            ? Math.round((Date.now() - new Date(last.ranAt).getTime()) / 60000)
            : null;
          return {
            unavailable: false,
            lastRun: last,
            staleMinutes,
            // The job is scheduled every 15 minutes; flag it well before a
            // human would notice replies had stopped arriving.
            stale: staleMinutes === null || staleMinutes > 45,
          };
        })(),
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
