import { NextResponse } from 'next/server';
import { getCronStatus, sendsToday } from '@/lib/cron-status';
import { getAppSettings } from '@/lib/app-settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const status = await getCronStatus();
    const todayCount = await sendsToday();
    const { cadence } = await getAppSettings();
    const dailyCap = cadence.dailySendCap;
    return NextResponse.json({
      lastRun: status.lastRun || null,
      history: status.history.slice(0, 7),
      sendsToday: todayCount,
      dailyCap,
      capRemaining: Math.max(0, dailyCap - todayCount),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to read status' },
      { status: 500 }
    );
  }
}
