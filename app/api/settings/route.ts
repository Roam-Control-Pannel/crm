import { NextRequest, NextResponse } from 'next/server';
import { getAppSettings, updateAppSettings } from '@/lib/app-settings';
import { readErrorResponse } from '@/lib/store-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const settings = await getAppSettings();
    return NextResponse.json(settings);
  } catch (err) {
    // FAIL-CLOSED-READS-V1: this route had no error handling at all, so an
    // unreadable settings blob surfaced as an unhandled rejection and a
    // Next HTML error page.
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  try {
    const settings = await updateAppSettings(body);
    return NextResponse.json(settings);
  } catch (err) {
    // FAIL-CLOSED-READS-V1: updateAppSettings merges the patch onto the
    // CURRENT settings, so if the read failed we must not write. A 503 here
    // means the user's sender address and templates are untouched.
    const { body: errBody, status } = readErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
