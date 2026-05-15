/**
 * Build the Unsplash attribution suffix that gets appended to a caption
 * at publish time.
 *
 * Unsplash compliance requires the photographer + Unsplash credit to
 * appear *in the post text itself* (not just the CRM UI) for any social
 * re-post of an Unsplash photo. On Instagram and Twitter we @-tag the
 * photographer when we know their handle; on LinkedIn / Facebook (no
 * native cross-platform @-mention) we fall back to a plain credit with
 * the photo URL.
 *
 * Returns '' when the post has no Unsplash attribution (own uploads,
 * Brain images), so this is a no-op for non-Unsplash content.
 *
 * Shared between the client UI (manual publish) and the server cron
 * (auto-publish) so both code paths produce identical post text.
 */

export interface UnsplashCreditFields {
  imageCredit?: string;
  imageCreditUrl?: string;
  imagePhotoUrl?: string;
  imageSocialHandles?: {
    instagram?: string | null;
    twitter?: string | null;
    unsplash?: string | null;
  };
}

export function buildUnsplashCredit(post: UnsplashCreditFields, platform: string): string {
  if (!post.imageCredit || !post.imageCreditUrl) return '';
  const handles = post.imageSocialHandles || {};
  if (platform === 'instagram' && handles.instagram) {
    return `\n\n📸 by @${handles.instagram} via Unsplash`;
  }
  if (platform === 'twitter' && handles.twitter) {
    return `\n\n📸 by @${handles.twitter} via Unsplash`;
  }
  return `\n\n📸 Photo by ${post.imageCredit} on Unsplash: ${post.imagePhotoUrl || post.imageCreditUrl}`;
}
