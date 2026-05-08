import { NextRequest, NextResponse } from 'next/server';
import { getLinkedInTokens, DEFAULT_USER_ID } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

interface PublishBody {
  text: string;
  authorUrn?: string;
  imageUrl?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: PublishBody = await req.json();
    const { text, imageUrl } = body;

    if (!text) {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: text' },
        { status: 400 }
      );
    }

    const li = await getLinkedInTokens(DEFAULT_USER_ID);
    if (!li?.accessToken || !li.memberUrn) {
      return NextResponse.json(
        { ok: false, error: 'LinkedIn account not connected' },
        { status: 400 }
      );
    }

    const accessToken = li.accessToken;
    const authorUrn = body.authorUrn || li.memberUrn;

    const payload: any = {
      author: authorUrn,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (imageUrl) {
      try {
        const registerRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'LinkedIn-Version': '202405',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
        });
        const registerData = await registerRes.json();
        const uploadUrl = registerData?.value?.uploadUrl;
        const imageUrn = registerData?.value?.image;

        if (uploadUrl && imageUrn) {
          const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
          const imgBuffer = await imgRes.arrayBuffer();
          await fetch(uploadUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: imgBuffer,
          });
          payload.content = { media: { id: imageUrn } };
        }
      } catch (imgErr) {
        console.error('Image upload failed, posting text only:', imgErr);
      }
    }

    const postRes = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202405',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(payload),
    });

    const postUrn = postRes.headers.get('x-restli-id') || postRes.headers.get('X-RestLi-Id');

    if (!postRes.ok) {
      const errBody = await postRes.text();
      console.error('LinkedIn publish failed:', postRes.status, errBody);
      return NextResponse.json(
        { ok: false, error: `LinkedIn API error ${postRes.status}` },
        { status: postRes.status }
      );
    }

    return NextResponse.json({
      ok: true,
      postUrn,
      url: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}` : null,
    });
  } catch (err) {
    console.error('LinkedIn publish error:', err);
    return NextResponse.json(
      { ok: false, error: 'Publish failed' },
      { status: 500 }
    );
  }
}
