import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query') || 'town landscape';
  const count = parseInt(req.nextUrl.searchParams.get('count') || '6');
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;

  if (!accessKey) {
    return NextResponse.json({
      images: Array.from({length: count}, (_, i) => ({
        url: `https://picsum.photos/seed/${encodeURIComponent(query+i)}/800/800`,
        thumb: `https://picsum.photos/seed/${encodeURIComponent(query+i)}/400/400`,
        credit: 'Placeholder',
        creditUrl: 'https://unsplash.com',
      }))
    });
  }

  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=squarish`,
      { headers: { Authorization: `Client-ID ${accessKey}` } }
    );
    const data = await res.json();
    const images = (data.results || []).map((img: {urls:{regular:string;small:string;thumb:string};user:{name:string;links:{html:string}}}) => ({
      url: img.urls.regular,
      thumb: img.urls.small || img.urls.thumb || img.urls.regular,
      credit: img.user.name,
      creditUrl: img.user.links.html,
    }));
    return NextResponse.json({ images });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
