import { NextResponse } from 'next/server'
import { getPool } from '@hr/db'
import { Gateway } from '@hr/ai'

/**
 * GET /api/health — UC-71.
 *
 * FE dùng endpoint này để quyết định có hiện banner degrade không. Quan trọng:
 * app KHÔNG sập khi model server chết, nên endpoint này phải trả 200 kể cả khi
 * mọi model đều down — chỉ báo `degraded: true`.
 */

export const dynamic = 'force-dynamic'

const g = globalThis as unknown as { __hrGateway?: Gateway }
function gateway(): Gateway {
  if (!g.__hrGateway) g.__hrGateway = new Gateway()
  return g.__hrGateway
}

export async function GET() {
  const [db, ai] = await Promise.allSettled([
    getPool().query('SELECT 1'),
    gateway().health(),
  ])

  const dbOk = db.status === 'fulfilled'
  const aiState =
    ai.status === 'fulfilled'
      ? ai.value
      : { healthy: false, models: {}, breakers: {} }

  // Tính năng nào còn dùng được — bảng degrade ở TDD §5.5
  const features = {
    editProfile: dbOk,
    changeTemplate: dbOk,
    exportPdf: dbOk,
    matchKeyword: dbOk,
    matchSemantic: Boolean(aiState.models['local.embedder']),
    importCv: Boolean(aiState.models['local.reasoner']),
    chat: Boolean(aiState.models['local.reasoner']),
  }

  return NextResponse.json(
    {
      ok: dbOk,
      degraded: !aiState.healthy,
      db: dbOk,
      models: aiState.models,
      breakers: aiState.breakers,
      features,
    },
    // 200 kể cả khi degraded — app vẫn dùng được (BR-71.1)
    { status: dbOk ? 200 : 503 },
  )
}
