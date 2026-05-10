import { NextResponse } from 'next/server';
import { runFinalRenderPhase } from '@/lib/pipeline_media';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    runFinalRenderPhase(sessionId).catch((error) => {
      console.error('Final render job failed:', error);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Render API Error:', error);
    return NextResponse.json({ error: 'Failed to start render' }, { status: 500 });
  }
}
