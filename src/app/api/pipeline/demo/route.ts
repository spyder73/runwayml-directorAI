import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { createDemoMemorySeed } from '@/lib/demo-seeds';
import type { AspectRatio } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { aspectRatio?: AspectRatio };
    const aspectRatio = body.aspectRatio === '9:16' ? '9:16' : '16:9';
    const result = createDemoMemorySeed(db, { aspectRatio });

    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
