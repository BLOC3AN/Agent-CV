import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/** Keep the browser contract while routing every API request to Go. */
export function middleware(req: NextRequest) {
  const upstream = process.env.GO_BACKEND_URL ?? 'http://backend:8080'
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, upstream)
  return NextResponse.rewrite(target)
}

export const config = {
  matcher: ['/api/:path*'],
}
