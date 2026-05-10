import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { authGuardResponse, requireCurrentUser } from '@/lib/auth/guards';
import { createMediaFileResponse, getOwnedMediaAsset } from '@/lib/media-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = requireCurrentUser(req);
    const { id } = await params;
    const asset = getOwnedMediaAsset(db, id, auth.user.id);
    if (!asset) {
      return NextResponse.json({ error: 'Media not found.' }, { status: 404 });
    }

    return createMediaFileResponse(asset, req.headers);
  } catch (error: unknown) {
    const guardResponse = authGuardResponse(error);
    if (guardResponse) return guardResponse;
    console.error('Media delivery error:', error);
    return NextResponse.json({ error: 'Media is not available.' }, { status: 404 });
  }
}
