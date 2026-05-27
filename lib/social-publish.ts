import { getUserTokens, DEFAULT_USER_ID } from '@/lib/tokens';

/**
 * Single-account publish logic for LinkedIn / Facebook / Instagram.
 *
 * Shared by:
 *   - POST /api/social/publish  (browser-initiated, one account per call)
 *   - POST /api/social/publish-due  (cron, iterates a due post's accounts)
 *
 * Returns a plain result object — never throws for platform errors, only
 * for programmer errors (missing args). The route layers turn this into
 * NextResponse / writes it into post.results.
 */

export type PublishPlatform = 'linkedin' | 'facebook' | 'instagram';

export interface PublishInput {
  accountId: string;
  platform: PublishPlatform;
  caption: string;
  imageUrl?: string;
  metaPageId?: string;
  linkedinAuthorUrn?: string;
}

export interface PublishResult {
  ok: boolean;
  accountId: string;
  platform: PublishPlatform;
  postId?: string | null;
  postUrl?: string | null;
  error?: string;
  details?: unknown;
  /** Suggested HTTP status when surfaced via an API. */
  httpStatus?: number;
}

/**
 * Parse account ID prefix into platform routing info.
 * 'li-personal:urn:li:person:abc'    -> { kind: 'li-personal', value: 'urn:li:person:abc' }
 * 'li-company:urn:li:organization:1' -> { kind: 'li-company', value: 'urn:li:organization:1' }
 * 'meta-page:1234567890'             -> { kind: 'meta-page', value: '1234567890' }
 * 'meta-ig:1234567890'               -> { kind: 'meta-ig', value: '1234567890' }
 */
export function parseAccountId(id: string): { kind: string; value: string } {
  const idx = id.indexOf(':');
  if (idx === -1) return { kind: '', value: id };
  return { kind: id.slice(0, idx), value: id.slice(idx + 1) };
}

function fail(input: PublishInput, error: string, httpStatus = 400, details?: unknown): PublishResult {
  return { ok: false, accountId: input.accountId, platform: input.platform, error, httpStatus, details };
}

/**
 * Resolve LinkedIn URN / Meta page ID from the accountId prefix when not
 * explicitly provided. Mirrors the inline logic that used to live in the
 * route handler.
 */
function resolveRoutingFromAccountId(input: PublishInput): PublishInput {
  const next = { ...input };
  if (input.accountId) {
    const parsed = parseAccountId(input.accountId);
    if (parsed.kind === 'li-personal' && !next.linkedinAuthorUrn) {
      next.linkedinAuthorUrn = parsed.value;
    } else if (parsed.kind === 'li-company' && !next.linkedinAuthorUrn) {
      next.linkedinAuthorUrn = parsed.value;
    } else if (parsed.kind === 'meta-page' && !next.metaPageId) {
      next.metaPageId = parsed.value;
    }
    // meta-ig is resolved inside the Instagram block by matching against
    // tokens.meta.pages[*].instagramId.
  }
  return next;
}

/**
 * META-IMAGE-FORMAT-V1
 *
 * Meta's Graph API for both Facebook page photos and Instagram media
 * containers fetches `image_url` from our side. Unsplash's CDN serves
 * content-negotiated formats — without an explicit `fm=` parameter,
 * Meta typically receives WebP, which the Instagram media-ingest backend
 * rejects with error code 36001 / 2207083 "The image format is not
 * supported."
 *
 * This helper rewrites Unsplash CDN URLs to force JPEG (`fm=jpg`) and
 * pins width to 1080 (Instagram requires 320–1440px wide; 1080 matches
 * Unsplash's `urls.regular` default and is well within both FB and IG
 * limits). Non-Unsplash URLs (Brain uploads, own-hosted images) pass
 * through untouched.
 *
 * We do this at publish time rather than at search time so we don't
 * have to migrate existing scheduled posts whose stored imageUrl
 * predates this fix.
 */
/**
 * INSTAGRAM-CONTAINER-READY-V1
 *
 * A media container created from a remote `image_url` is processed
 * asynchronously: the POST /{ig-id}/media call returns a creation id
 * immediately, but Meta only fetches and validates the image afterwards.
 * Calling /media_publish before the container reaches
 * `status_code === 'FINISHED'` fails with code 9007 / subcode 2207027
 * ("Media ID is not available — the media must be successfully created
 * before it can be published").
 *
 * Facebook's /photos endpoint is synchronous, which is why a combined
 * "publish to Facebook + Instagram" run would report Facebook as the only
 * success: the IG container simply wasn't ready when we asked to publish.
 *
 * Poll the container until it's FINISHED (or errors out). status_code
 * values are: EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED.
 * The cap keeps us comfortably inside the route's function budget while
 * giving Meta enough time for the typical few-second image ingest.
 */
async function waitForInstagramContainer(
  containerId: string,
  accessToken: string,
): Promise<{ error: string; details?: unknown } | null> {
  const maxAttempts = 12;
  const intervalMs = 1500;
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
    );
    const data = await res.json();
    last = data;
    if (data?.error) {
      return { error: `Instagram: ${data.error.message}`, details: data };
    }
    const status = data?.status_code;
    if (status === 'FINISHED') return null;
    if (status === 'ERROR' || status === 'EXPIRED') {
      return {
        error: `Instagram media processing ${String(status).toLowerCase()}`,
        details: data,
      };
    }
    // IN_PROGRESS (or an unexpected/missing status) — wait and re-poll.
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return {
    error: 'Instagram media not ready (timed out waiting for container processing)',
    details: last,
  };
}

function forceJpegForMeta(url: string | undefined): string | undefined {
  if (!url) return url;
  if (!url.startsWith('https://images.unsplash.com/')) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('fm', 'jpg');
    // Only pin width if there isn't already one set — respect explicit
    // sizing if a future code path adds it.
    if (!parsed.searchParams.has('w')) parsed.searchParams.set('w', '1080');
    // q=80 is Unsplash's default for `urls.regular`; only set if missing
    // so we don't override an intentionally-higher quality.
    if (!parsed.searchParams.has('q')) parsed.searchParams.set('q', '80');
    return parsed.toString();
  } catch {
    // Malformed URL — return as-is and let Meta report the error.
    return url;
  }
}

export async function publishToAccount(rawInput: PublishInput): Promise<PublishResult> {
  if (!rawInput.platform || !rawInput.caption) {
    return fail(rawInput, 'Missing platform or caption', 400);
  }

  const input = resolveRoutingFromAccountId(rawInput);
  const { accountId, platform, caption, imageUrl, metaPageId, linkedinAuthorUrn } = input;
  const tokens = await getUserTokens(DEFAULT_USER_ID);

  try {
    // ============================
    // LinkedIn
    // ============================
    if (platform === 'linkedin') {
      if (!tokens.linkedin?.accessToken) {
        return fail(input, 'LinkedIn not connected', 400);
      }
      const isCompanyPost = !!linkedinAuthorUrn?.includes(':organization:');
      if (isCompanyPost && !tokens.linkedin.capabilities?.postCompany) {
        return fail(input, 'LinkedIn company posting capability not granted (Community Management API approval required)', 403);
      }
      if (!isCompanyPost && !tokens.linkedin.capabilities?.postPersonal && !linkedinAuthorUrn) {
        return fail(input, 'LinkedIn personal posting capability not granted', 403);
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

      if (imageUrl) {
        const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'LinkedIn-Version': '202604',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
        });
        if (!initRes.ok) {
          const initErr = await initRes.text();
          console.error('LinkedIn image init failed:', initRes.status, initErr);
          return fail(input, 'LinkedIn image upload init failed', 502, initErr);
        }
        const initData = await initRes.json();
        const uploadUrl = initData?.value?.uploadUrl;
        const imageUrn = initData?.value?.image;
        if (!uploadUrl || !imageUrn) {
          console.error('LinkedIn init returned no uploadUrl/image:', initData);
          return fail(input, 'LinkedIn did not return upload URL', 502, initData);
        }

        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
          console.error('Source image fetch failed:', imgRes.status, imageUrl);
          return fail(input, `Could not fetch source image (${imgRes.status})`, 502);
        }
        const imgBuffer = await imgRes.arrayBuffer();
        const imgContentType = imgRes.headers.get('content-type') || 'image/jpeg';

        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': imgContentType,
          },
          body: imgBuffer,
        });
        if (!uploadRes.ok) {
          const uploadErr = await uploadRes.text().catch(() => '');
          console.error('LinkedIn image upload failed:', uploadRes.status, uploadErr);
          return fail(input, `LinkedIn image upload failed (${uploadRes.status})`, 502, uploadErr);
        }

        payload.content = { media: { id: imageUrn } };
      }

      const postRes = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202604',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(payload),
      });

      const postUrn = postRes.headers.get('x-restli-id') || postRes.headers.get('X-RestLi-Id');

      if (!postRes.ok) {
        const errText = await postRes.text();
        console.error('LinkedIn publish failed:', postRes.status, errText);
        return fail(input, `LinkedIn ${postRes.status}`, postRes.status, errText);
      }

      return {
        ok: true,
        accountId,
        platform,
        postId: postUrn,
        postUrl: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}` : null,
      };
    }

    // ============================
    // Facebook page post
    // ============================
    if (platform === 'facebook') {
      if (!tokens.meta?.userToken) {
        return fail(input, 'Meta not connected', 400);
      }
      const page = (tokens.meta.pages || []).find(p => p.id === metaPageId);
      if (!page) {
        return fail(input, `No Facebook page for id ${metaPageId}`, 400);
      }

      if (imageUrl) {
        // META-IMAGE-FORMAT-V1: see forceJpegForMeta() above. Unsplash
        // serves WebP by default and Meta rejects it on Instagram; same
        // hazard exists on Facebook though we haven't hit it in practice.
        const fbImageUrl = forceJpegForMeta(imageUrl);
        const photoRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: fbImageUrl,
            caption,
            access_token: page.pageToken,
          }),
        });
        const photoData = await photoRes.json();
        if (photoData.error) {
          return fail(input, photoData.error.message, 400);
        }
        const postId = photoData.post_id || photoData.id;
        return {
          ok: true, accountId, platform, postId,
          postUrl: postId ? `https://www.facebook.com/${postId}` : null,
        };
      }

      const fbRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: caption,
          access_token: page.pageToken,
        }),
      });
      const fbData = await fbRes.json();
      if (fbData.error) {
        return fail(input, fbData.error.message, 400);
      }
      return {
        ok: true, accountId, platform, postId: fbData.id,
        postUrl: fbData.id ? `https://www.facebook.com/${fbData.id}` : null,
      };
    }

    // ============================
    // Instagram post
    // ============================
    if (platform === 'instagram') {
      if (!tokens.meta?.userToken) {
        return fail(input, 'Meta not connected', 400);
      }
      let page = (tokens.meta.pages || []).find(p => p.id === metaPageId);
      if (!page && accountId) {
        const parsed = parseAccountId(accountId);
        if (parsed.kind === 'meta-ig') {
          page = (tokens.meta.pages || []).find(p => p.instagramId === parsed.value);
        }
      }
      if (!page?.instagramId) {
        return fail(input, 'No Instagram account linked to this page', 400);
      }
      if (!imageUrl) {
        return fail(input, 'Instagram requires an image', 400);
      }

      // META-IMAGE-FORMAT-V1: see forceJpegForMeta() above. This is the
      // path that was failing with error 36001/2207083 — Instagram only
      // accepts JPEG/PNG containers, and Unsplash defaults to WebP.
      const igImageUrl = forceJpegForMeta(imageUrl);
      const containerRes = await fetch(
        `https://graph.facebook.com/v21.0/${page.instagramId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: igImageUrl, caption, access_token: page.pageToken }),
        }
      );
      const container = await containerRes.json();
      if (!container.id) {
        // INSTAGRAM-CONTAINER-ERROR-V1
        // Surface Meta's actual error message rather than the generic
        // 'Container creation failed' so we can tell which class of
        // problem we're hitting (image URL unreachable, scope missing,
        // dimensions invalid, etc.). Meta's standard error shape is
        // { error: { message, type, code, fbtrace_id } }. We also log
        // the full response server-side as a paper trail.
        console.error('[social-publish] IG container creation failed:', JSON.stringify(container));
        const metaMsg = container?.error?.message;
        const metaCode = container?.error?.code;
        const metaSub = container?.error?.error_subcode;
        const detail = metaMsg
          ? `Instagram: ${metaMsg}` + (metaCode ? ` (code ${metaCode}${metaSub ? '/' + metaSub : ''})` : '')
          : 'Container creation failed';
        return fail(input, detail, 502, container);
      }

      // INSTAGRAM-CONTAINER-READY-V1: the container is processed
      // asynchronously, so publishing immediately races Meta's image
      // ingest and fails with "Media ID is not available". Wait for the
      // container to reach FINISHED before publishing. See
      // waitForInstagramContainer() above.
      const notReady = await waitForInstagramContainer(container.id, page.pageToken);
      if (notReady) {
        console.error('[social-publish] IG container not ready:', JSON.stringify(notReady.details));
        return fail(input, notReady.error, 502, notReady.details);
      }

      const publishRes = await fetch(
        `https://graph.facebook.com/v21.0/${page.instagramId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: container.id, access_token: page.pageToken }),
        }
      );
      const publishData = await publishRes.json();
      if (publishData.error) {
        return fail(input, publishData.error.message, 400);
      }
      return {
        ok: true, accountId, platform, postId: publishData.id,
        postUrl: publishData.id ? `https://www.instagram.com/p/${publishData.id}` : null,
      };
    }

    return fail(input, 'Unknown platform', 400);
  } catch (err: any) {
    console.error('publish error:', err);
    return fail(input, err?.message || 'Unknown error', 500);
  }
}
