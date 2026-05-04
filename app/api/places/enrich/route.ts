import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const placeId = searchParams.get('placeId');

    if (!placeId) {
      return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=website,formatted_phone_number,international_phone_number&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK') {
      return NextResponse.json({ website: '', phone: '' });
    }

    const result = data.result || {};
    return NextResponse.json({
      website: result.website || '',
      phone: result.formatted_phone_number || result.international_phone_number || '',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to enrich place';
    return NextResponse.json({ error: message, website: '', phone: '' }, { status: 500 });
  }
}
