import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { platform, accountId, caption, imageUrl, pageToken, instagramId } = await req.json();

    if (platform === 'instagram' && instagramId) {
      // Step 1: Create media container
      const containerRes = await fetch(
        `https://graph.facebook.com/v19.0/${instagramId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imageUrl || 'https://roam-local.co.uk/images/og-image.jpg',
            caption,
            access_token: pageToken,
          }),
        }
      );
      const container = await containerRes.json();
      if (!container.id) return NextResponse.json({ error: 'Container creation failed', details: container }, { status: 400 });

      // Step 2: Publish
      const publishRes = await fetch(
        `https://graph.facebook.com/v19.0/${instagramId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: container.id, access_token: pageToken }),
        }
      );
      const published = await publishRes.json();
      return NextResponse.json({ success: true, postId: published.id, platform: 'instagram' });
    }

    if (platform === 'facebook' && accountId && pageToken) {
      // Post to Facebook Page
      const postRes = await fetch(
        `https://graph.facebook.com/v19.0/${accountId}/feed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: caption,
            ...(imageUrl ? { link: imageUrl } : {}),
            access_token: pageToken,
          }),
        }
      );
      const posted = await postRes.json();
      return NextResponse.json({ success: true, postId: posted.id, platform: 'facebook' });
    }

    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
