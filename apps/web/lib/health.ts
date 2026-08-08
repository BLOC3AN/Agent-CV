import 'server-only'
import { Gateway } from '@hr/ai'

/**
 * `aiAvailable()` — nguồn cho prop `aiAvailable` của Home.
 *
 * `Gateway.health()` ping 6 provider qua mạng và KHÔNG cache. Gọi thẳng nó khi
 * render Home sẽ làm trang chủ phụ thuộc model server — trái tinh thần TDD
 * §3.2 A7 ("degrade, đừng sập"): model server treo thì Home treo theo.
 *
 * Bọc bằng ba lớp:
 *  - cache 30 giây trong bộ nhớ (singleton `globalThis`, cùng mẫu với
 *    `lib/db.ts`/`lib/jobs.ts`) — đủ mới cho một trang chủ, không dội việc
 *    ping vào model server mỗi lần có người load Home;
 *  - timeout 1.5 giây (`Promise.race` với một promise hẹn giờ) — Home không
 *    bao giờ chờ model server lâu hơn ngưỡng này;
 *  - lỗi hoặc quá hạn thì trả `true` (lạc quan) — nhánh degrade chỉ bật khi
 *    Gateway THỰC SỰ trả lời là không khoẻ, không phải khi nó im lặng.
 */

const CACHE_MS = 30_000
const TIMEOUT_MS = 1_500

const g = globalThis as unknown as {
  __hrGateway?: Gateway
  __hrHealthCache?: { value: boolean; at: number }
}

function gateway(): Gateway {
  if (!g.__hrGateway) g.__hrGateway = new Gateway()
  return g.__hrGateway
}

export async function aiAvailable(): Promise<boolean> {
  const cached = g.__hrHealthCache
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(true), TIMEOUT_MS)
  })

  const value = await Promise.race([
    gateway()
      .health()
      .then((s) => s.healthy)
      .catch(() => true),
    timeout,
  ])

  g.__hrHealthCache = { value, at: Date.now() }
  return value
}

/**
 * CHỈ dùng trong test (`apps/web/test/health.test.ts`). Cache và singleton
 * `Gateway` sống trên `globalThis` — không dọn giữa các test thì test sau ăn
 * kết quả cache của test trước và xanh giả.
 */
export function __resetHealthForTest(): void {
  delete g.__hrGateway
  delete g.__hrHealthCache
}
