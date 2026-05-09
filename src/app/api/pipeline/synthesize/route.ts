import { NextResponse } from 'next/server';
import { generateVideoAudioPhase } from '@/lib/pipeline_final';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    generateVideoAudioPhase(sessionId).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Synthesize API Error:', error);
    return NextResponse.json({ error: 'Failed to start synthesis' }, { status: 500 });
  }
}
