import { NextResponse } from 'next/server';
import { getDemoReadinessReport } from '@/lib/demo-readiness';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await getDemoReadinessReport());
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
