import { NextRequest, NextResponse } from 'next/server';
import { getUserTokens, DEFAULT_USER_ID } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

interface PublishBody {
  accountId: string;       // local account id (acc1, acc2, etc.)
  platform: 'linkedin' | 'facebook' | 'instagram';
  caption: string;
  imageUrl?: string;
  // For Facebook/Instagram: which Meta page to use (matched by platform)
  metaPageId?: string;
  // For LinkedIn: which entity to post as (defaults to personal memberUrn)
  linkedinAuthorUrn?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: PublishBody = await req.json();
    const { accountId, platform, caption, imageUrl, metaPageId, linkedinAuthorUrn } = body;

    if (!platform || !caption) {
      return NextResponse.json({ ok: false, error: 'Missing platform or caption' }, { status: 400 });
    }

    const tokens = await getUserTokens(DEFAULT_USER_ID);

    // ============================
    // LinkedIn
    // ============================
    if (platform === 'linkedin') {
      if (!tokens.linkedin?.accessToken) {
        return NextResponse.json({ ok: false, error: 'LinkedIn not connected' }, { status: 400 });
      }
      if (!tokens.linkedin.capabilities?.postPersonal && !linkedinAuthorUrn) {
        return NextResponse.json({ ok: false, error: 'LinkedIn posting capability not granted' }, { status: 403 });
      }

      const authorUrn = linkedinAuthorUrn || tokens.linkedin.memberUrn;
      const accessToken = tokens.linkedin.accessToken;

      const payload: any = {
        author: authorUrn,
        commentary: caption,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };

      // Image upload (optional)
      if (imageUrl) {
        try {
          const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'LinkedIn-Version': '202405',
              'X-Restli-Protocol-Version': '2.0.0',
            },
            body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
          });
          const initData = await initRes.json();
          const uploadUrl = initData?.value?.uploadUrl;
          const imageUrn = initData?.value?.image;
          if (uploadUrl && imageUrn) {
            const imgRes = await fetch(imageUrl);
            const imgBuffer = await imgRes.arrayBuffer();
            await fetch(uploadUrl, {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}` },
              body: imgBuffer,
            });
            payload.content = { media: { id: imageUrn } };
          }
        } catch (imgErr) {
          console.error('LinkedIn image upload failed:', imgErr);
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
        const errText = await postRes.text();
        console.error('LinkedIn publish failed:', postRes.status, errText);
        return NextResponse.json(
          { ok: false, error: `LinkedIn ${postRes.status}`, details: errText, accountId, platform },
          { status: postRes.status }
        );
      }

      return NextResponse.json({
        ok: true,
        accountId,
        platform,
        postId: postUrn,
        postUrl: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}` : null,
      });
    }

    // ============================
    // Facebook page post
    // ============================
    if (platform === 'facebook') {
      if (!tokens.meta?.userToken) {
        return NextResponse.json({ ok: false, error: 'Meta not connected' }, { status: 400 });
      }
      const page = (tokens.meta.pages || []).find(p => p.id === metaPageId);
      if (!page) {
        return NextResponse.json({ ok: false, error: `No Facebook page for id ${metaPageId}` }, { status: 400 });
      }

      const fbRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: caption,
          ...(imageUrl ? { link: imageUrl } : {}),
          access_token: page.pageToken,
        }),
      });
      const fbData = await fbRes.json();
      if (fbData.error) {
        return NextResponse.json({ ok: false, error: fbData.error.message, accountId, platform }, { status: 400 });
      }
      return NextResponse.json({
        ok: true, accountId, platform, postId: fbData.id,
        postUrl: fbData.id ? `https://www.facebook.com/${fbData.id}` : null,
      });
    }

    // ============================
    // Instagram post
    // ============================
    if (platform === 'instagram') {
      if (!tokens.meta?.userToken) {
        return NextResponse.json({ ok: false, error: 'Meta not connected' }, { status: 400 });
      }
      const page = (tokens.meta.pages || []).find(p => p.id === metaPageId);
      if (!page?.instagramId) {
        return NextResponse.json({ ok: false, error: 'No Instagram account linked to this page' }, { status: 400 });
      }
      if (!imageUrl) {
        return NextResponse.json({ ok: false, error: 'Instagram requires an image' }, { status: 400 });
      }

      // Step 1: Create container
      const containerRes = await fetch(
        `https://graph.facebook.com/v19.0/${page.instagramId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: imageUrl, caption, access_token: page.pageToken }),
        }
      );
      const container = await containerRes.json();
      if (!container.id) {
        return NextResponse.json({ ok: false, error: 'Container creation failed', details: container, accountId, platform }, { status: 400 });
      }

      // Step 2: Publish
      const publishRes = await fetch(
        `https://graph.facebook.com/v19.0/${page.instagramId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: container.id, access_token: page.pageToken }),
        }
      );
      const publishData = await publishRes.json();
      if (publishData.error) {
        return NextResponse.json({ ok: false, error: publishData.error.message, accountId, platform }, { status: 400 });
      }
      return NextResponse.json({
        ok: true, accountId, platform, postId: publishData.id,
        postUrl: publishData.id ? `https://www.instagram.com/p/${publishData.id}` : null,
      });
    }

    return NextResponse.json({ ok: false, error: 'Unknown platform' }, { status: 400 });
  } catch (err: any) {
    console.error('publish error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
