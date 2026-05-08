import { NextResponse } from 'next/server';
import { getCronStatus, sendsToday, DAILY_SEND_CAP } from '@/lib/cron-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const status = await getCronStatus();
    const todayCount = await sendsToday();
    return NextResponse.json({
      lastRun: status.lastRun || null,
      history: status.history.slice(0, 7),
      sendsToday: todayCount,
      dailyCap: DAILY_SEND_CAP,
      capRemaining: Math.max(0, DAILY_SEND_CAP - todayCount),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to read status' },
      { status: 500 }
    );
  }
}
