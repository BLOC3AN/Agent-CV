import { NextResponse } from 'next/server'
import { profileRepo } from '@/lib/db'

/** GET /api/profiles/:id/revisions — lịch sử thay đổi (UC-54) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json({ revisions: await profileRepo().revisions(id) })
}
