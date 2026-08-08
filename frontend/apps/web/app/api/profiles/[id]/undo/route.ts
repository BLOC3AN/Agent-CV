import { NextResponse } from 'next/server'
import { profileRepo } from '@/lib/db'

/** POST /api/profiles/:id/undo — hoàn tác bước gần nhất (UC-54, BR-54.1) */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await profileRepo().undoLast(id)
  if (!profile) return NextResponse.json({ error: 'Không có gì để hoàn tác' }, { status: 409 })
  return NextResponse.json({ profile })
}
