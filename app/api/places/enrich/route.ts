import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function GET(req: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  try {
    const { searchParams } = new URL(req.url);
    const placeId = searchParams.get('placeId');
    if (!placeId) {
      return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
    }

    const fields = ['website', 'formatted_phone_number', 'international_phone_number'].join(',');
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK') {
      return NextResponse.json({
        website: '', phone: '',
        warning: `Google Places: ${data.status}`,
      });
    }

    return NextResponse.json({
      website: data.result?.website || '',
      phone: data.result?.formatted_phone_number || data.result?.international_phone_number || '',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to enrich place';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
