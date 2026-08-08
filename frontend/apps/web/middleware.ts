import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Feature-flagged API cutover. Keep disabled until the Go contract gates pass
 * in staging; when enabled, the browser keeps the same `/api/*` URLs while
 * Next forwards business traffic to the Go service.
 */
export function middleware(req: NextRequest) {
  if (process.env.GO_API_CUTOVER !== 'true') return NextResponse.next()

  // PDF export vẫn cần Playwright + @hr/templates để tạo đúng bản CV đã
  // render. Giữ route này ở Next; các API nghiệp vụ còn lại đi qua Go.
  if (req.nextUrl.pathname.match(/^\/api\/cv\/[^/]+\/export\/?$/)) {
    return NextResponse.next()
  }

  const upstream = process.env.GO_BACKEND_URL ?? 'http://backend:8080'
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, upstream)
  return NextResponse.rewrite(target)
}

export const config = {
  matcher: ['/api/:path*'],
}
