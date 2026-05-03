import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function requireSession() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
