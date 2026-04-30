import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const town = searchParams.get('town');
    const type = searchParams.get('type') || 'establishment';
    const limit = Number(searchParams.get('limit') || 20);

    if (!town) {
      return NextResponse.json({ error: 'town is required' }, { status: 400 });
    }

    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(type + ' in ' + town + ' UK')}&key=${GOOGLE_API_KEY}`;
    const res = await fetch(searchUrl);
    const data = await res.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Google Places error: ${data.status} - ${data.error_message || ''}`);
    }

    const results = (data.results || []).slice(0, limit).map((place: {
      place_id: string;
      name: string;
      formatted_address: string;
      rating?: number;
      types?: string[];
    }) => ({
      placeId: place.place_id,
      name: place.name,
      address: place.formatted_address,
      rating: place.rating,
      types: place.types,
      website: '',
      phone: '',
      email: '',
      source: 'google' as const,
      town,
      status: 'not_contacted' as const,
    }));

    return NextResponse.json({ results, total: results.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch places';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
