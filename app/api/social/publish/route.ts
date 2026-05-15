import { NextRequest, NextResponse } from 'next/server';
import { publishToAccount, PublishPlatform } from '@/lib/social-publish';

export const dynamic = 'force-dynamic';

interface PublishBody {
  accountId: string;       // real account id: 'li-personal:{urn}', 'meta-page:{id}', 'meta-ig:{id}'
  platform: PublishPlatform;
  caption: string;
  imageUrl?: string;
  // Optional explicit overrides (mostly for legacy callers):
  metaPageId?: string;
  linkedinAuthorUrn?: string;
}

export async function POST(req: NextRequest) {
  let body: PublishBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const result = await publishToAccount(body);
  const { httpStatus, ...payload } = result;
  return NextResponse.json(payload, { status: result.ok ? 200 : (httpStatus || 400) });
}
