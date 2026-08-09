# SP-1 — Nền tảng SPA production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa SPA ở `frontend/FRONTEND_NEW` thành một ứng dụng production thật — nằm trong npm workspace, có URL routing, có đăng nhập thật, đọc danh sách CV thật từ Postgres qua backend Go, và không còn một dòng nào gọi Gemini.

**Architecture:** SPA giữ nguyên React + Vite. Express phía trước rút gọn còn ba việc: phục vụ file tĩnh, proxy `/api/*` sang Go, và (ở SP-5) SSR trang in. Toàn bộ dữ liệu đi qua `src/lib/api.ts` — nơi duy nhất trong SPA biết đường dẫn HTTP. Backend Go được bổ sung hai endpoint còn thiếu (`GET /api/cv`, `GET /api/auth/session`) mà bản Next trước đây không cần vì nó truy vấn thẳng Postgres từ server component.

**Tech Stack:** React 19 · Vite 6 · react-router-dom 7 · Express 4 · TypeScript 5.8 · vitest 2 + @testing-library/react + happy-dom · Go 1.22+ (`net/http` ServeMux có pattern method) · PostgreSQL 16

## Global Constraints

- Spec nguồn: `backend/docs/superpowers/specs/2026-08-09-spa-production-migration-design.md`. Mọi mâu thuẫn thì spec thắng.
- **SP-1 không đụng vào schema dữ liệu.** CV v2, `_meta.verified`, `highlights[]` là việc của SP-2. Mọi thứ ở SP-1 chỉ chạm metadata CV (`id`, `title`, `updatedAt`, `jdTitle`) nên không phụ thuộc v1 hay v2.
- **Không có provider AI nào trong SPA.** `@google/genai` và `GEMINI_API_KEY` bị gỡ sạch. Mọi lời gọi model đi qua Go, theo `routing` trong `config.yml`.
- **SPA dùng import tương đối.** Không dùng alias `@/...`: `frontend/vitest.workspace.ts` đã map `@` sang `apps/web`, nên `@/...` trong SPA sẽ phân giải nhầm sang app Next mà không báo lỗi.
- Cookie phiên tên `hr_session`, `HttpOnly`, `SameSite=Lax` — do Go đặt. SPA **không bao giờ** đọc/ghi cookie này bằng JavaScript.
- Toàn bộ chuỗi hiển thị cho người dùng viết bằng tiếng Việt, giọng như phần còn lại của sản phẩm.
- Mỗi task kết thúc bằng một commit. Thông điệp commit tiếng Việt hoặc tiền tố `feat:`/`fix:`/`refactor:`/`test:` theo lệ của repo.
- Cổng: SPA chạy `:3002` suốt SP-1. Next giữ `:3000`. Việc đổi cổng là của SP-5.

---

## File Structure

| Đường dẫn | Trách nhiệm |
|---|---|
| `frontend/apps/web-spa/` | (đổi tên từ `frontend/FRONTEND_NEW/`) gốc ứng dụng |
| `frontend/apps/web-spa/server.ts` | Bootstrap: đọc env, gọi `createApp()`, `listen`. Không có logic. |
| `frontend/apps/web-spa/src/server/app.ts` | Dựng Express app. Nhận cấu hình qua tham số nên test được. |
| `frontend/apps/web-spa/src/server/proxy.ts` | Chuyển tiếp `/api/*` sang Go. Giữ cookie, giữ redirect, không đệm luồng. |
| `frontend/apps/web-spa/src/lib/api.ts` | Nơi DUY NHẤT biết đường dẫn HTTP. Một hàm cho mỗi endpoint. |
| `frontend/apps/web-spa/src/lib/format.ts` | Hàm thuần định dạng hiển thị (`relativeTime`). |
| `frontend/apps/web-spa/src/lib/session.tsx` | `SessionProvider`, `useSession`, `RequireAuth`. |
| `frontend/apps/web-spa/src/routes/routes.tsx` | Bản đồ URL → màn hình. Một chỗ duy nhất. |
| `frontend/apps/web-spa/src/routes/AppLayout.tsx` | Khung Header + Sidebar + `<Outlet/>`. Thay phần khung của `App.tsx`. |
| `frontend/apps/web-spa/src/routes/LoginPage.tsx` | Màn hình đăng nhập magic link. |
| `frontend/apps/web-spa/test/*.test.ts(x)` | Test của SPA. |
| `backend/internal/api/server.go` | Thêm `listCV`, `authSession`, `cvListItem`. |
| `backend/internal/api/server_test.go` | Test cho hai endpoint mới. |
| `backend/docker-compose.yml` | Thêm service `web-spa` cổng 3002. |
| `frontend/vitest.workspace.ts` | Mở rộng project `ui` để thấy test của web-spa. |

---

## Task 1: Đưa SPA vào workspace, rút Express về đúng vai, gỡ Gemini

**Files:**
- Move: `frontend/FRONTEND_NEW/` → `frontend/apps/web-spa/`
- Delete: `frontend/FRONTEND_NEW.zip`, `frontend/hr-agent---ai-cv-builder-&-job-matcher (1).zip`
- Create: `frontend/apps/web-spa/src/server/proxy.ts`
- Create: `frontend/apps/web-spa/src/server/app.ts`
- Modify: `frontend/apps/web-spa/server.ts` (viết lại toàn bộ)
- Modify: `frontend/apps/web-spa/package.json`
- Modify: `frontend/apps/web-spa/tsconfig.json`
- Modify: `frontend/apps/web-spa/index.html`
- Modify: `frontend/apps/web-spa/src/components/Sidebar.tsx:118` (dòng quảng cáo Gemini)
- Modify: `frontend/vitest.workspace.ts`
- Test: `frontend/apps/web-spa/test/proxy.test.ts`

**Interfaces:**
- Consumes: chưa có gì.
- Produces:
  - `createApiProxy(backendURL: string): (req: ExpressRequest, res: ExpressResponse) => Promise<void>`
  - `createApp(options: { backendURL: string }): Promise<express.Express>`

- [ ] **Step 1: Di chuyển thư mục và xoá hai file zip**

```bash
cd /home/hailt/Desktop/HR-agent
git mv frontend/FRONTEND_NEW frontend/apps/web-spa
rm -f frontend/FRONTEND_NEW.zip "frontend/hr-agent---ai-cv-builder-&-job-matcher (1).zip"
rm -rf frontend/apps/web-spa/node_modules frontend/apps/web-spa/bun.lock frontend/apps/web-spa/package-lock.json
```

Hai file zip là bản tải về, không phải nguồn. `package-lock.json` riêng của SPA phải biến mất: từ giờ nó dùng lock-file chung ở `frontend/package-lock.json`, hai lock-file cùng lúc sẽ phân giải ra hai cây phụ thuộc khác nhau.

- [ ] **Step 2: Viết lại `frontend/apps/web-spa/package.json`**

```json
{
  "name": "@hr/web-spa",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "PORT=${PORT:-3002} tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.9.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "esbuild": "^0.25.0",
    "tailwindcss": "^4.1.14",
    "vite": "^6.2.3"
  }
}
```

`@google/genai` biến mất ở đây. `tsx` và `typescript` không khai lại — chúng đã là devDependency ở gốc workspace.

- [ ] **Step 3: Cài lại và khai báo typecheck**

Thêm vào `scripts` của `frontend/package.json`:

```json
"typecheck:spa": "tsc --noEmit -p apps/web-spa/tsconfig.json",
```

và đổi dòng `typecheck` thành:

```json
"typecheck": "npm run typecheck:core && npm run typecheck:web && npm run typecheck:spa",
```

Rồi chạy:

```bash
cd frontend && npm install
```

- [ ] **Step 4: Đóng khung `tsconfig.json` của SPA**

Thêm hai khoá vào `frontend/apps/web-spa/tsconfig.json` (giữ nguyên `compilerOptions` sẵn có, chỉ **xoá** khối `paths` vì SPA không dùng alias):

```json
  "include": ["src/**/*", "test/**/*", "server.ts", "vite.config.ts"],
  "exclude": ["node_modules", "dist"]
```

- [ ] **Step 5: Cho vitest thấy test của SPA**

Trong `frontend/vitest.workspace.ts`, project `ui` đang chỉ nhìn `apps/web`. Đổi dòng `include` của nó:

```ts
      include: ['apps/*/test/**/*.ui.test.tsx'],
```

Project `unit` đã có `apps/**/test/**/*.test.ts` nên không cần sửa. **Không** thêm alias `@` cho SPA — xem Global Constraints.

- [ ] **Step 6: Viết test cho proxy (chưa có code, phải đỏ)**

Tạo `frontend/apps/web-spa/test/proxy.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/server/app.js'

/** Backend Go giả — ghi lại request nhận được và trả về thứ ta dặn trước. */
function fakeBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

async function startApp(backendURL: string) {
  // `serveApp: false` — test này chỉ quan tâm lớp proxy. Bật lớp phục vụ giao
  // diện sẽ dựng một Vite dev server với thư mục gốc sai (vitest chạy từ
  // `frontend/`, không phải `frontend/apps/web-spa/`), và test đỏ vì một lý do
  // chẳng liên quan gì tới thứ đang được kiểm.
  const app = await createApp({ backendURL, serveApp: false })
  const server = http.createServer(app)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

const openServers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (openServers.length) await openServers.pop()!()
})

describe('proxy /api', () => {
  it('chuyển tiếp cookie phiên lên backend', async () => {
    let seen = ''
    const backend = await fakeBackend((req, res) => {
      seen = req.headers.cookie ?? ''
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"items":[]}')
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/cv`, {
      headers: { cookie: 'hr_session=abc123' },
    })

    expect(res.status).toBe(200)
    expect(seen).toBe('hr_session=abc123')
  })

  it('trả set-cookie của backend về trình duyệt', async () => {
    const backend = await fakeBackend((_req, res) => {
      res.writeHead(200, {
        'set-cookie': 'hr_session=xyz; Path=/; HttpOnly',
        'content-type': 'application/json',
      })
      res.end('{"ok":true}')
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/auth/logout`, { method: 'POST' })

    expect(res.headers.getSetCookie()).toEqual([
      'hr_session=xyz; Path=/; HttpOnly',
    ])
  })

  it('không tự đi theo redirect — trả 302 và Location cho trình duyệt', async () => {
    const backend = await fakeBackend((_req, res) => {
      res.writeHead(302, { location: 'http://localhost:3002/' })
      res.end()
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/auth/verify?token=t`, {
      redirect: 'manual',
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3002/')
  })

  it('chuyển tiếp thân request POST nguyên vẹn', async () => {
    let body = ''
    const backend = await fakeBackend((req, res) => {
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end('{"id":"cv-1"}')
      })
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/cv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'CV thử' }),
    })

    expect(res.status).toBe(201)
    expect(JSON.parse(body)).toEqual({ title: 'CV thử' })
  })

  it('backend chết thì trả 502 kèm thông điệp tiếng Việt', async () => {
    // Cổng 1 chắc chắn không có gì lắng nghe.
    const app = await startApp('http://127.0.0.1:1')
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/cv`)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Không kết nối được backend' })
  })
})
```

- [ ] **Step 7: Chạy test để chắc chắn nó đỏ**

```bash
cd frontend && npx vitest run --project unit apps/web-spa/test/proxy.test.ts
```

Kỳ vọng: FAIL — `Cannot find module '../src/server/app.js'`.

- [ ] **Step 8: Viết `src/server/proxy.ts`**

```ts
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import { Readable } from 'node:stream'

/**
 * Header từng-chặng — thuộc về một kết nối TCP cụ thể, không được chuyển tiếp.
 * `content-length` cũng nằm đây: `fetch` tự tính lại, giữ giá trị cũ thì
 * trình duyệt cắt cụt response.
 */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
])

/**
 * Chuyển tiếp mọi request `/api/*` sang backend Go.
 *
 * Ba chi tiết dễ sai, mỗi cái đều làm hỏng một tính năng thật:
 *
 *  1. `redirect: 'manual'` — `GET /api/auth/verify` trả 302 về trang chủ. Để
 *     `fetch` tự đi theo thì proxy trả về HTML trang chủ với mã 200, và trình
 *     duyệt không bao giờ nhận được cookie phiên.
 *  2. `getSetCookie()` — `Headers.get('set-cookie')` gộp nhiều cookie thành
 *     một chuỗi ngăn bởi dấu phẩy, mà `Expires=` cũng chứa dấu phẩy. Gộp rồi
 *     tách lại là hỏng.
 *  3. Ống dẫn luồng, không `await res.text()` — SSE của `/api/chat` (SP-4)
 *     không bao giờ kết thúc, đọc hết thân response nghĩa là treo vĩnh viễn.
 */
export function createApiProxy(backendURL: string) {
  const base = backendURL.replace(/\/$/, '')

  return async function apiProxy(req: ExpressRequest, res: ExpressResponse): Promise<void> {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(key)) continue
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    let upstream: Response
    try {
      upstream = await fetch(base + req.originalUrl, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        // Bắt buộc khi thân request là luồng — undici từ chối nếu thiếu.
        ...(hasBody ? { duplex: 'half' } : {}),
        redirect: 'manual',
      } as RequestInit)
    } catch {
      res.status(502).json({ error: 'Không kết nối được backend' })
      return
    }

    res.status(upstream.status)
    upstream.headers.forEach((value, key) => {
      if (HOP_BY_HOP.has(key) || key === 'set-cookie') return
      res.setHeader(key, value)
    })
    const cookies = upstream.headers.getSetCookie()
    if (cookies.length > 0) res.setHeader('set-cookie', cookies)

    if (!upstream.body) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body as never).pipe(res)
  }
}
```

- [ ] **Step 9: Viết `src/server/app.ts`**

```ts
import express from 'express'
import path from 'node:path'
import { createApiProxy } from './proxy.js'

export interface AppOptions {
  backendURL: string
  /** `true` thì phục vụ `dist/`; `false` thì gắn Vite dev middleware. */
  production?: boolean
  /**
   * `false` thì chỉ dựng lớp proxy, bỏ hẳn phần phục vụ giao diện.
   * Test lớp proxy dùng cờ này để không phải dựng Vite dev server.
   */
  serveApp?: boolean
}

/**
 * Dựng Express app.
 *
 * KHÔNG có `express.json()`. Trước đây nó nằm ở đầu chuỗi middleware để ba
 * route AI đọc `req.body`. Giờ những route đó đã bị xoá, và giữ nó lại sẽ
 * ĐỌC CẠN thân request trước khi proxy kịp chuyển tiếp — mọi POST tới Go sẽ
 * mang thân rỗng, và không có lỗi nào được ném ra.
 */
export async function createApp(options: AppOptions): Promise<express.Express> {
  const app = express()
  const production = options.production ?? process.env.NODE_ENV === 'production'

  app.all('/api/*', createApiProxy(options.backendURL))

  if (options.serveApp === false) return app

  if (production) {
    const distPath = path.join(process.cwd(), 'dist')
    app.use(express.static(distPath))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  return app
}
```

- [ ] **Step 10: Chạy test để chắc chắn nó xanh**

```bash
cd frontend && npx vitest run --project unit apps/web-spa/test/proxy.test.ts
```

Kỳ vọng: PASS, 5/5.

- [ ] **Step 11: Viết lại `server.ts` thành bootstrap thuần**

Thay **toàn bộ** nội dung `frontend/apps/web-spa/server.ts`:

```ts
import dotenv from 'dotenv'
import { createApp } from './src/server/app.js'

dotenv.config()

const PORT = Number(process.env.PORT) || 3002
const backendURL = process.env.BACKEND_URL || 'http://localhost:8080'

const app = await createApp({ backendURL })
app.listen(PORT, '0.0.0.0', () => {
  console.log(`HR-Agent SPA đang chạy tại http://0.0.0.0:${PORT} — API đi tới ${backendURL}`)
})
```

`GoogleGenAI`, `getGeminiAI`, `/api/ai/chat`, `/api/ai/quick-action`, `/api/ai/match-job` và `/api/health` cục bộ đều biến mất. `/api/health` giờ do Go trả lời qua proxy — đúng thứ ta muốn, vì nó mới là cái nói được backend có sống không.

- [ ] **Step 12: Gỡ nốt dấu vết Gemini trong giao diện**

Trong `frontend/apps/web-spa/src/components/Sidebar.tsx`, đổi đoạn văn ở thẻ chân sidebar:

```tsx
        <p className="text-[11px] text-slate-500 leading-normal">
          Mô hình chạy nội bộ, tối ưu CV theo chuẩn ATS. Dữ liệu cá nhân không rời máy chủ.
        </p>
```

Và trong `frontend/apps/web-spa/index.html`, đổi tiêu đề:

```html
    <title>HR-Agent — Dựng CV và đối chiếu tin tuyển dụng</title>
```

- [ ] **Step 13: Kiểm tra không còn dấu vết nào**

```bash
cd /home/hailt/Desktop/HR-agent
grep -rni 'gemini\|genai\|google' frontend/apps/web-spa --include='*.ts' --include='*.tsx' --include='*.json' --include='*.html' --exclude-dir=node_modules
```

Kỳ vọng: **không có kết quả nào**. Còn kết quả thì xoá tiếp rồi chạy lại.

- [ ] **Step 14: Chạy typecheck và toàn bộ test**

```bash
cd frontend && npm run typecheck:spa && npx vitest run --project unit --project ui
```

Kỳ vọng: typecheck sạch, mọi test xanh.

- [ ] **Step 15: Commit**

```bash
cd /home/hailt/Desktop/HR-agent
git add -A frontend/
git commit -m "refactor: đưa SPA vào workspace, rút Express còn proxy, gỡ Gemini

Express không còn gọi model: ba route /api/ai/* và @google/genai bị xoá.
Mọi /api/* chuyển tiếp sang Go, giữ cookie phiên, giữ redirect 302 và
không đệm luồng để SSE dùng được ở SP-4.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Hai endpoint Go mà bản Next không cần

**Files:**
- Modify: `backend/internal/api/server.go:82-85` (bảng route), thêm hàm mới cuối file
- Test: `backend/internal/api/server_test.go`

**Interfaces:**
- Consumes: `s.currentUserID(r) string`, `writeJSON(w, status, body)` — đã có sẵn.
- Produces:
  - `GET /api/cv` → `200 {"items":[{"id","title","updatedAt","jdTitle"?}]}` · `401 {"error"}` · `503 {"error"}`
  - `GET /api/auth/session` → luôn `200 {"authenticated":bool,"email"?:string}`
  - `cvListItem(id, title string, updated time.Time, jdTitle string) map[string]any`

Bản Next đọc thẳng Postgres từ server component (`frontend/apps/web/app/(app)/cv/page.tsx:36-45`), nên chưa bao giờ cần endpoint liệt kê. SPA chạy trong trình duyệt thì không có đường nào khác.

- [ ] **Step 1: Viết test đỏ**

Thêm vào cuối `backend/internal/api/server_test.go`:

```go
func TestCVListItemOmitsEmptyJDTitle(t *testing.T) {
	at := time.Date(2026, 8, 9, 10, 30, 0, 0, time.UTC)

	withJD := cvListItem("cv-1", "CV Backend", at, "Junior Go Developer")
	if withJD["jdTitle"] != "Junior Go Developer" {
		t.Fatalf("jdTitle = %#v, want the job title", withJD["jdTitle"])
	}
	if withJD["updatedAt"] != "2026-08-09T10:30:00Z" {
		t.Fatalf("updatedAt = %#v, want RFC3339 in UTC", withJD["updatedAt"])
	}

	// CV không gắn tin tuyển dụng nào thì KHÔNG được có khoá jdTitle rỗng:
	// giao diện phân biệt "không gắn JD" bằng sự vắng mặt của khoá này.
	plain := cvListItem("cv-2", "CV chung", at, "")
	if _, exists := plain["jdTitle"]; exists {
		t.Fatalf("jdTitle must be absent when the CV has no job description: %#v", plain)
	}
}

func TestCVListRouteIsRegistered(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/cv", nil)
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /api/cv status = %d, want %d when PostgreSQL is unavailable", w.Code, http.StatusServiceUnavailable)
	}
}

func TestAuthSessionReportsAnonymousWithoutCookie(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("session status = %d, want 200 — the SPA asks this on every page load", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["authenticated"] != false {
		t.Fatalf("authenticated = %#v, want false", body["authenticated"])
	}
	if _, leaked := body["email"]; leaked {
		t.Fatalf("anonymous session must not carry an email: %#v", body)
	}
}
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
cd backend && go test ./internal/api/ -run 'TestCVList|TestAuthSession' -v
```

Kỳ vọng: FAIL — `undefined: cvListItem`.

- [ ] **Step 3: Đăng ký hai route**

Trong `backend/internal/api/server.go`, ngay **trước** dòng `mux.HandleFunc("POST /api/cv", s.createCV)`:

```go
	mux.HandleFunc("GET /api/cv", s.listCV)
```

và ngay **sau** dòng `mux.HandleFunc("POST /api/auth/logout", s.authLogout)`:

```go
	mux.HandleFunc("GET /api/auth/session", s.authSession)
```

Pattern `"GET /api/cv"` (không có gạch chéo cuối) khác hẳn `"GET /api/cv/"` — cái sau chỉ khớp đường dẫn có phần con. Hai cái sống chung được, ServeMux chọn cái cụ thể hơn.

- [ ] **Step 4: Viết ba hàm**

Thêm vào cuối `backend/internal/api/server.go`:

```go
// cvListItem dựng một dòng cho danh sách CV.
//
// Chỉ metadata: danh sách không đọc nội dung hồ sơ, nên nó không phụ thuộc
// schema v1 hay v2 — SP-2 đổi schema cũng không phải sửa hàm này.
func cvListItem(id, title string, updated time.Time, jdTitle string) map[string]any {
	item := map[string]any{
		"id":        id,
		"title":     title,
		"updatedAt": updated.UTC().Format(time.RFC3339),
	}
	if jdTitle != "" {
		item["jdTitle"] = jdTitle
	}
	return item
}

func (s *Server) listCV(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CV cần PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	// Tên tin tuyển dụng nằm trong `requirements`, không phải cột riêng —
	// bảng job_descriptions không có cột title.
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT c.id, COALESCE(c.title, 'CV'), c.updated_at,
		       COALESCE(j.requirements->>'title', '')
		  FROM cv_documents c
		  LEFT JOIN job_descriptions j ON j.id = c.jd_id
		 WHERE c.user_id = $1
		 ORDER BY c.updated_at DESC`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không đọc được danh sách CV"})
		return
	}
	defer rows.Close()

	// Khởi tạo rỗng chứ không để nil: nil serialize thành `null`, và giao diện
	// phải phân biệt "chưa có CV nào" với "gọi hỏng".
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, title, jdTitle string
		var updated time.Time
		if err := rows.Scan(&id, &title, &updated, &jdTitle); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không đọc được danh sách CV"})
			return
		}
		items = append(items, cvListItem(id, title, updated, jdTitle))
	}
	if rows.Err() != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không đọc được danh sách CV"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// authSession cho SPA biết nó đang là ai.
//
// LUÔN trả 200, kể cả khi chưa đăng nhập. Đây là câu hỏi mỗi lần tải trang;
// trả 401 cho một câu hỏi bình thường sẽ khiến mọi lớp xử lý lỗi phía trình
// duyệt phải có một ngoại lệ riêng cho đúng endpoint này.
func (s *Server) authSession(w http.ResponseWriter, r *http.Request) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}
	var email string
	if err := s.db.QueryRowContext(r.Context(), `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "email": email})
}
```

- [ ] **Step 5: Chạy test để chắc chắn nó xanh**

```bash
cd backend && go test ./... 2>&1 | tail -20
```

Kỳ vọng: `ok` cho mọi package.

- [ ] **Step 6: Commit**

```bash
cd /home/hailt/Desktop/HR-agent
git add backend/internal/api/server.go backend/internal/api/server_test.go
git commit -m "feat: thêm GET /api/cv và GET /api/auth/session

Bản Next đọc thẳng Postgres từ server component nên chưa bao giờ cần hai
endpoint này. SPA chạy trong trình duyệt thì không có đường nào khác.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `src/lib/api.ts` — nơi duy nhất biết đường dẫn HTTP

**Files:**
- Create: `frontend/apps/web-spa/src/lib/api.ts`
- Test: `frontend/apps/web-spa/test/api.test.ts`

**Interfaces:**
- Consumes: `GET /api/cv`, `GET /api/auth/session` (Task 2); `POST /api/auth/request`, `POST /api/auth/logout`, `DELETE /api/cv/:id` (đã có sẵn).
- Produces:
```ts
class ApiError extends Error { readonly status: number }
interface CVSummary { id: string; title: string; updatedAt: string; jdTitle?: string }
interface Session { authenticated: boolean; email?: string }
function listCVs(): Promise<CVSummary[]>
function deleteCV(id: string): Promise<void>
function getSession(): Promise<Session>
function requestLogin(email: string): Promise<{ ok: boolean; devLink?: string }>
function logout(): Promise<void>
```

- [ ] **Step 1: Viết test đỏ**

Tạo `frontend/apps/web-spa/test/api.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { ApiError, deleteCV, getSession, listCVs, requestLogin } from '../src/lib/api.js'

function mockFetch(status: number, body: unknown, contentType = 'application/json') {
  const spy = vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': contentType },
    }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listCVs', () => {
  it('trả về mảng items và gửi kèm cookie', async () => {
    const spy = mockFetch(200, {
      items: [{ id: 'cv-1', title: 'CV Backend', updatedAt: '2026-08-09T10:30:00Z' }],
    })

    const items = await listCVs()

    expect(items).toEqual([
      { id: 'cv-1', title: 'CV Backend', updatedAt: '2026-08-09T10:30:00Z' },
    ])
    const [url, init] = spy.mock.calls[0]!
    expect(url).toBe('/api/cv')
    // Thiếu `credentials: 'include'` thì cookie phiên không được gửi và mọi
    // request đều 401 — hỏng theo kiểu trông như "chưa đăng nhập".
    expect(init).toMatchObject({ credentials: 'include' })
  })

  it('danh sách rỗng là mảng rỗng, không phải lỗi', async () => {
    mockFetch(200, { items: [] })
    await expect(listCVs()).resolves.toEqual([])
  })

  it('401 ném ApiError giữ nguyên mã trạng thái', async () => {
    mockFetch(401, { error: 'Chưa đăng nhập' })

    const err = await listCVs().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect((err as ApiError).message).toBe('Chưa đăng nhập')
  })

  it('body không phải JSON vẫn ném ApiError chứ không vỡ', async () => {
    mockFetch(502, '<html>Bad Gateway</html>', 'text/html')

    const err = await listCVs().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(502)
  })
})

describe('deleteCV', () => {
  it('gọi DELETE đúng đường dẫn và mã hoá id', async () => {
    const spy = mockFetch(200, { ok: true })

    await deleteCV('cv/1')

    expect(spy.mock.calls[0]![0]).toBe('/api/cv/cv%2F1')
    expect(spy.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' })
  })
})

describe('getSession', () => {
  it('đọc trạng thái đăng nhập', async () => {
    mockFetch(200, { authenticated: true, email: 'a@b.com' })
    await expect(getSession()).resolves.toEqual({ authenticated: true, email: 'a@b.com' })
  })

  it('mạng hỏng thì coi như chưa đăng nhập, không ném', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    await expect(getSession()).resolves.toEqual({ authenticated: false })
  })
})

describe('requestLogin', () => {
  it('gửi email và trả devLink khi backend cung cấp', async () => {
    const spy = mockFetch(200, { ok: true, sent: false, devLink: 'http://x/verify?token=t' })

    const result = await requestLogin('  A@B.COM ')

    expect(JSON.parse(spy.mock.calls[0]![1]!.body as string)).toEqual({ email: 'a@b.com' })
    expect(result.devLink).toBe('http://x/verify?token=t')
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
cd frontend && npx vitest run --project unit apps/web-spa/test/api.test.ts
```

Kỳ vọng: FAIL — không tìm thấy `../src/lib/api.js`.

- [ ] **Step 3: Viết `src/lib/api.ts`**

```ts
/**
 * Nơi DUY NHẤT trong SPA biết đường dẫn HTTP.
 *
 * Màn hình gọi hàm ở đây, không tự dựng URL. Nhờ vậy khi backend đổi đường
 * dẫn, chỗ phải sửa là một file — và khi có ai quên `credentials: 'include'`,
 * lỗi đó không thể lặp lại ở mười chỗ khác nhau.
 */

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface CVSummary {
  id: string
  title: string
  /** ISO-8601 UTC, do backend sinh. Định dạng để hiển thị là việc của giao diện. */
  updatedAt: string
  /** Vắng mặt nghĩa là CV không gắn tin tuyển dụng nào. */
  jdTitle?: string
}

export interface Session {
  authenticated: boolean
  email?: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      // Cookie hr_session là HttpOnly — không có dòng này thì trình duyệt
      // không gửi nó, và mọi thứ trả về 401.
      credentials: 'include',
      ...init,
    })
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ')
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // Cổng lỗi trả HTML, không phải JSON. Đừng để chi tiết đó thành lỗi cú pháp.
      body = null
    }
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'Máy chủ trả về lỗi'
    throw new ApiError(res.status, message)
  }

  return body as T
}

export async function listCVs(): Promise<CVSummary[]> {
  const body = await request<{ items: CVSummary[] }>('/api/cv')
  return body.items ?? []
}

export async function deleteCV(id: string): Promise<void> {
  await request<unknown>(`/api/cv/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * Không bao giờ ném. Câu hỏi "tôi là ai" được đặt ở mỗi lần tải trang; để nó
 * ném thì backend chết sẽ thành màn hình trắng thay vì màn hình đăng nhập.
 */
export async function getSession(): Promise<Session> {
  try {
    return await request<Session>('/api/auth/session')
  } catch {
    return { authenticated: false }
  }
}

export async function requestLogin(email: string): Promise<{ ok: boolean; devLink?: string }> {
  return request<{ ok: boolean; devLink?: string }>('/api/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  })
}

export async function logout(): Promise<void> {
  await request<unknown>('/api/auth/logout', { method: 'POST' })
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

```bash
cd frontend && npx vitest run --project unit apps/web-spa/test/api.test.ts
```

Kỳ vọng: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
cd /home/hailt/Desktop/HR-agent
git add frontend/apps/web-spa/src/lib/api.ts frontend/apps/web-spa/test/api.test.ts
git commit -m "feat: client gọi API Go cho SPA

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Định dạng thời gian hiển thị

**Files:**
- Create: `frontend/apps/web-spa/src/lib/format.ts`
- Test: `frontend/apps/web-spa/test/format.test.ts`

**Interfaces:**
- Consumes: không.
- Produces: `relativeTime(iso: string, now?: Date): string`

Backend trả `updatedAt` dạng ISO. Kiểu `CV` cũ của SPA có `lastModified: string` là chuỗi viết tay trong mock (`'Vừa tạo'`). Hàm này thay chỗ đó, và là bản port của `when()` trong `frontend/apps/web/app/(app)/cv/page.tsx:23-29`.

- [ ] **Step 1: Viết test đỏ**

Tạo `frontend/apps/web-spa/test/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { relativeTime } from '../src/lib/format.js'

const now = new Date('2026-08-09T12:00:00Z')

describe('relativeTime', () => {
  it('dưới một phút vẫn nói "1 phút trước", không nói "0 phút"', () => {
    expect(relativeTime('2026-08-09T11:59:50Z', now)).toBe('1 phút trước')
  })

  it('tính theo phút trong vòng một giờ', () => {
    expect(relativeTime('2026-08-09T11:15:00Z', now)).toBe('45 phút trước')
  })

  it('tính theo giờ trong vòng một ngày', () => {
    expect(relativeTime('2026-08-09T04:00:00Z', now)).toBe('8 giờ trước')
  })

  it('tính theo ngày khi quá 24 giờ', () => {
    expect(relativeTime('2026-08-06T12:00:00Z', now)).toBe('3 ngày trước')
  })

  it('chuỗi không hợp lệ trả về dấu gạch, không trả "NaN phút trước"', () => {
    expect(relativeTime('không phải ngày tháng', now)).toBe('—')
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
cd frontend && npx vitest run --project unit apps/web-spa/test/format.test.ts
```

Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Step 3: Viết `src/lib/format.ts`**

```ts
/**
 * Thời gian tương đối cho danh sách CV.
 *
 * Port từ `when()` của bản Next. Nhận `now` qua tham số thay vì gọi
 * `Date.now()` bên trong: đó là điều kiện để test được mà không phải đóng
 * băng đồng hồ toàn cục.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'

  const phut = Math.round((now.getTime() - at.getTime()) / 60_000)
  if (phut < 60) return `${Math.max(phut, 1)} phút trước`
  const gio = Math.round(phut / 60)
  if (gio < 24) return `${gio} giờ trước`
  return `${Math.round(gio / 24)} ngày trước`
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

```bash
cd frontend && npx vitest run --project unit apps/web-spa/test/format.test.ts
```

Kỳ vọng: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
cd /home/hailt/Desktop/HR-agent
git add frontend/apps/web-spa/src/lib/format.ts frontend/apps/web-spa/test/format.test.ts
git commit -m "feat: hàm thời gian tương đối cho danh sách CV

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: URL routing thay `useState<ViewTab>`

**Files:**
- Create: `frontend/apps/web-spa/src/routes/AppLayout.tsx`
- Create: `frontend/apps/web-spa/src/routes/routes.tsx`
- Modify: `frontend/apps/web-spa/src/main.tsx`
- Modify: `frontend/apps/web-spa/src/components/Sidebar.tsx`
- Modify: `frontend/apps/web-spa/src/components/Header.tsx`
- Test: `frontend/apps/web-spa/test/routing.ui.test.tsx`

**Interfaces:**
- Consumes: các view sẵn có (`DashboardView`, `MyCVsView`, `CVEditorView`, `JobMatchView`, `TemplatesView`, `SettingsView`), `relativeTime` (Task 4).
- Produces:
  - `AppLayout` — khung Header + Sidebar + `<Outlet/>`
  - `appRoutes: RouteObject[]` — bản đồ URL, dùng lại được ở SSR của SP-5
  - `Sidebar` và `Header` đổi hợp đồng: bỏ `currentView` / `onNavigate`, dùng `NavLink`

`App.tsx` hiện giữ toàn bộ trạng thái CV trong `useState` và chuyển màn hình bằng `ViewTab`. Task này tách phần **khung + điều hướng** ra; phần **dữ liệu** vẫn tạm dùng `mockData` cho các màn hình chưa tới lượt (Task 7 mới bỏ mock ở `/cv`, SP-3 bỏ nốt ở các màn hình còn lại).

- [ ] **Step 1: Cài react-router-dom**

```bash
cd frontend && npm install --workspace @hr/web-spa react-router-dom@^7.9.1
```

- [ ] **Step 2: Viết test đỏ**

Tạo `frontend/apps/web-spa/test/routing.ui.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '../src/routes/routes.js'

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

describe('bản đồ URL', () => {
  it('/ mở màn hình tổng quan', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('view-dashboard')).toBeInTheDocument()
  })

  it('/cv mở danh sách CV', async () => {
    renderAt('/cv')
    expect(await screen.findByTestId('view-my-cvs')).toBeInTheDocument()
  })

  it('/templates mở kho mẫu', async () => {
    renderAt('/templates')
    expect(await screen.findByTestId('view-templates')).toBeInTheDocument()
  })

  it('/settings mở cài đặt', async () => {
    renderAt('/settings')
    expect(await screen.findByTestId('view-settings')).toBeInTheDocument()
  })

  it('URL không tồn tại hiện màn hình 404, không phải trang trắng', async () => {
    renderAt('/khong-co-that')
    expect(await screen.findByText(/không tìm thấy trang/i)).toBeInTheDocument()
  })

  it('mục sidebar tương ứng được đánh dấu đang mở', async () => {
    renderAt('/cv')
    const link = await screen.findByTestId('sidebar-item-cv')
    expect(link).toHaveAttribute('aria-current', 'page')
  })
})
```

- [ ] **Step 3: Chạy test để chắc chắn nó đỏ**

```bash
cd frontend && npx vitest run --project ui apps/web-spa/test/routing.ui.test.tsx
```

Kỳ vọng: FAIL — không tìm thấy `../src/routes/routes.js`.

- [ ] **Step 4: Viết `src/routes/AppLayout.tsx`**

```tsx
import React from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from '../components/Header'
import { Sidebar } from '../components/Sidebar'

/**
 * Khung chung: Header trên, Sidebar trái, nội dung route ở giữa.
 *
 * Sidebar ẩn ở trình soạn CV vì màn hình đó cần toàn bộ chiều ngang cho ba
 * cột riêng của nó (mục lục · CV · chat) — xem FRONTEND.md §3.1.
 */
export function AppLayout({ hideSidebar = false }: { hideSidebar?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-gray-900 antialiased selection:bg-violet-100 selection:text-violet-900">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {!hideSidebar && <Sidebar />}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Viết `src/routes/routes.tsx`**

Trước khi viết file này, sửa từng view để **bỏ các prop điều hướng** và dùng `useNavigate()` / `<Link>` trực tiếp:

| Prop bị bỏ | Thay bằng |
|---|---|
| `onNavigate('dashboard')` | `navigate('/')` |
| `onNavigate('my_cvs')` | `navigate('/cv')` |
| `onNavigate('job_match')` | `navigate('/analyze/' + cvId)` |
| `onNavigate('templates')` / `('settings')` | `navigate('/templates')` / `navigate('/settings')` |
| `onSelectCVToEdit(id)` | ``navigate(`/builder/${id}`)`` |
| `onSelectTemplate(name)` | đặt mẫu rồi ``navigate(`/builder/${cvId}`)`` |
| `currentView` (Header, Sidebar) | `useLocation()` — hoặc để `NavLink` tự lo |

Các prop còn lại liên quan tới **dữ liệu và modal** (`onUpdateCV`, `onDeleteCV`, `onOpenUploadModal`, `onOpenPreview`, `onOpenShare`, `onDownloadPDF`, `onCreateNewCV`) **giữ nguyên chữ ký** và tạm nhận hàm rỗng ở `routes.tsx`. Task 7 nối `/cv` vào dữ liệu thật; SP-3 nối phần còn lại.

```tsx
import React from 'react'
import type { RouteObject } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { initialCVs } from '../mockData'
import { DashboardView } from '../components/DashboardView'
import { MyCVsView } from '../components/MyCVsView'
import { CVEditorView } from '../components/CVEditorView'
import { JobMatchView } from '../components/JobMatchView'
import { TemplatesView } from '../components/TemplatesView'
import { SettingsView } from '../components/SettingsView'

/**
 * Bản đồ URL — một chỗ duy nhất.
 *
 * Tách khỏi `main.tsx` để hai người dùng chung được: `BrowserRouter` ở trình
 * duyệt, và `StaticRouter` khi SSR trang in ở SP-5.
 *
 * Các màn hình chưa tới lượt vẫn dùng `mockData`. Chúng được thay lần lượt:
 * `/cv` ở Task 7, phần còn lại ở SP-3.
 */
function NotFound() {
  return (
    <div className="p-10 text-center space-y-3">
      <h1 className="text-2xl font-bold text-slate-900">Không tìm thấy trang</h1>
      <p className="text-sm text-slate-600">Đường dẫn bạn mở không tồn tại hoặc đã được đổi tên.</p>
      <Link to="/" className="inline-block text-sm font-semibold text-violet-700 hover:underline">
        Về trang tổng quan
      </Link>
    </div>
  )
}

/** Chỗ giữ chân cho các prop dữ liệu chưa được nối. Task 7 và SP-3 thay dần. */
const noop = () => {}

export const appRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: (
          <div data-testid="view-dashboard">
            <DashboardView cvs={initialCVs} onOpenUploadModal={noop} />
          </div>
        ),
      },
      {
        path: 'cv',
        element: (
          <div data-testid="view-my-cvs">
            <MyCVsView
              cvs={initialCVs}
              onCreateNewCV={noop}
              onOpenUploadModal={noop}
              onDeleteCV={noop}
            />
          </div>
        ),
      },
      // Hai đường dẫn, một màn hình. `/analyze` để người dùng tự chọn CV —
      // `JobMatchView` vốn đã nhận cả danh sách và làm việc đó. `/analyze/:cvId`
      // chỉ là dạng chọn sẵn khi tới từ một CV cụ thể.
      {
        path: 'analyze',
        element: (
          <div data-testid="view-job-match">
            <JobMatchView cvs={initialCVs} />
          </div>
        ),
      },
      {
        path: 'analyze/:cvId',
        element: (
          <div data-testid="view-job-match">
            <JobMatchView cvs={initialCVs} />
          </div>
        ),
      },
      { path: 'templates', element: <div data-testid="view-templates"><TemplatesView /></div> },
      { path: 'settings', element: <div data-testid="view-settings"><SettingsView /></div> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    element: <AppLayout hideSidebar />,
    children: [
      {
        path: 'builder/:cvId',
        element: (
          <div data-testid="view-editor">
            <CVEditorView
              cv={initialCVs[0]!}
              onUpdateCV={noop}
              onOpenPreview={noop}
              onOpenShare={noop}
              onDownloadPDF={noop}
            />
          </div>
        ),
      },
    ],
  },
]
```

`MyCVsView` và `CVEditorView` vẫn nhận `onSelectCVToEdit` trong bản gốc — prop đó bị bỏ theo bảng ở trên, hai view tự gọi `useNavigate()`. Nếu `npm run typecheck:spa` báo thiếu hoặc thừa prop, sửa **chữ ký của view** cho khớp bảng, đừng thêm prop trở lại vào `routes.tsx`.

- [ ] **Step 6: Đổi `Sidebar.tsx` sang `NavLink`**

Thay khối `navItems`/`secondaryItems` và hai vòng lặp render. Bỏ hai prop `currentView` và `onNavigate`:

```tsx
import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileText, GitCompare, Layout, Settings,
} from 'lucide-react'

/*
 * Sidebar còn 5 mục, không phải 6.
 *
 * Bản SPA gốc có mục "Trợ lý AI" trỏ tới một màn hình chat đứng riêng. Spec
 * §5.1 gộp trợ lý thành panel của `/builder/:cvId`, vì trợ lý tách khỏi CV thì
 * không sinh được đề xuất có ngữ cảnh — nên mục sidebar đó không còn đích đến
 * và bị bỏ. Quyết định của chủ sản phẩm ngày 2026-08-09.
 *
 * `/analyze` KHÔNG kèm id là một màn hình thật: `JobMatchView` vốn đã nhận cả
 * danh sách CV và tự cho người dùng chọn. `/analyze/:cvId` chỉ là dạng chọn
 * sẵn. Trỏ một mục sidebar vào route chỉ tồn tại ở dạng có tham số thì nó rơi
 * thẳng vào màn hình 404.
 */
const primary = [
  { to: '/', end: true, id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/cv', end: false, id: 'cv', label: 'CV của tôi', icon: FileText },
  { to: '/analyze', end: false, id: 'analyze', label: 'Đối chiếu việc làm', icon: GitCompare },
]

const secondary = [
  { to: '/templates', end: false, id: 'templates', label: 'Mẫu CV', icon: Layout },
  { to: '/settings', end: false, id: 'settings', label: 'Cài đặt', icon: Settings },
]

function itemClass({ isActive }: { isActive: boolean }): string {
  return `w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl font-medium text-xs transition ${
    isActive
      ? 'bg-violet-700 text-white font-semibold shadow-xs'
      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
  }`
}

function NavGroup({ items, id }: { items: typeof primary; id: string }) {
  return (
    <nav className="space-y-1" id={id}>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.id}
            to={item.to}
            end={item.end}
            data-testid={`sidebar-item-${item.id}`}
            className={itemClass}
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
```

`NavLink` tự đặt `aria-current="page"` khi khớp — đó là thứ test ở Step 2 kiểm, và nó cũng là thứ trình đọc màn hình cần. Giữ nguyên phần `<aside>` bao ngoài và thẻ chân sidebar; chỉ thay hai vòng lặp bằng `<NavGroup items={primary} id="sidebar-primary-nav" />` và `<NavGroup items={secondary} id="sidebar-secondary-nav" />`.

- [ ] **Step 7: Đổi `Header.tsx` sang `Link`**

Bỏ prop `currentView` và `onNavigate`. Nút logo thành:

```tsx
import { Link } from 'react-router-dom'
...
        <Link to="/" className="flex items-center space-x-3 focus:outline-none group text-left" id="btn-brand-logo">
```

Mỗi tab điều hướng trong `<nav>` đổi từ `<button onClick={() => onNavigate(x)}>` sang `<NavLink>`, dùng đúng bản đồ URL ở bảng Step 5. Mẫu cho một tab, giữ nguyên className sẵn có của nó:

```tsx
          <NavLink
            to="/cv"
            className={({ isActive }) =>
              `px-3.5 py-2 rounded-xl font-medium text-xs transition ${
                isActive ? 'bg-violet-50 text-violet-700 font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`
            }
          >
            CV của tôi
          </NavLink>
```

Prop `userEmail` giữ nguyên chữ ký — Task 6 sẽ đổ dữ liệu thật vào.

- [ ] **Step 8: Viết lại `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from './routes/routes'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(appRoutes)} />
  </StrictMode>,
)
```

- [ ] **Step 9: Xoá `src/App.tsx`**

```bash
cd /home/hailt/Desktop/HR-agent && git rm frontend/apps/web-spa/src/App.tsx
```

Toàn bộ vai trò của nó đã chuyển sang `routes.tsx` và `AppLayout.tsx`. Để lại thì sẽ có hai nguồn sự thật về "màn hình nào đang mở".

- [ ] **Step 10: Chạy test để chắc chắn nó xanh**

```bash
cd frontend && npx vitest run --project ui apps/web-spa/test/routing.ui.test.tsx && npm run typecheck:spa
```

Kỳ vọng: PASS 6/6, typecheck sạch.

- [ ] **Step 11: Xem bằng mắt**

```bash
cd frontend && npm --workspace @hr/web-spa run dev
```

Mở `http://localhost:3002/cv`, bấm F5. Kỳ vọng: vẫn ở danh sách CV, **không** nhảy về tổng quan. Bấm nút Lùi của trình duyệt: quay về trang trước. Đây là thứ `useState<ViewTab>` không bao giờ làm được.

- [ ] **Step 12: Commit**

```bash
cd /home/hailt/Desktop/HR-agent
git add -A frontend/apps/web-spa frontend/package.json frontend/package-lock.json
git commit -m "feat: URL routing thay useState<ViewTab>

Mỗi màn hình có một địa chỉ. Tải lại trang và nút Lùi hoạt động đúng,
và SSR trang in ở SP-5 dùng lại được cùng bản đồ route.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Đăng nhập thật và chặn route

**Files:**
- Create: `frontend/apps/web-spa/src/lib/session.tsx`
- Create: `frontend/apps/web-spa/src/routes/LoginPage.tsx`
- Modify: `frontend/apps/web-spa/src/routes/routes.tsx`
- Modify: `frontend/apps/web-spa/src/routes/AppLayout.tsx`
- Modify: `frontend/apps/web-spa/src/components/Header.tsx`
- Test: `frontend/apps/web-spa/test/session.ui.test.tsx`

**Interfaces:**
- Consumes: `getSession`, `requestLogin`, `logout`, `Session` (Task 3); `appRoutes` (Task 5).
- Produces:
  - `SessionProvider({ children })`
  - `useSession(): { status: 'loading' | 'authenticated' | 'anonymous'; email?: string; signOut(): Promise<void> }`
  - `RequireAuth({ children })` — chuyển hướng `/login` khi chưa đăng nhập
  - route `/login`

- [ ] **Step 1: Viết test đỏ**

Tạo `frontend/apps/web-spa/test/session.ui.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '../src/routes/routes.js'
import * as api from '../src/lib/api.js'

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('chặn route khi chưa đăng nhập', () => {
  it('chưa đăng nhập thì /cv chuyển sang màn hình đăng nhập', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: false })

    renderAt('/cv')

    expect(await screen.findByRole('heading', { name: /đăng nhập/i })).toBeInTheDocument()
  })

  it('đang hỏi phiên thì hiện trạng thái chờ, không chớp màn hình đăng nhập', async () => {
    // Phiên chưa trả lời — nếu guard mặc định là "chưa đăng nhập", người dùng
    // đã đăng nhập sẽ thấy màn hình đăng nhập nhấp nháy mỗi lần tải trang.
    vi.spyOn(api, 'getSession').mockReturnValue(new Promise(() => {}))

    renderAt('/cv')

    expect(await screen.findByTestId('session-loading')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /đăng nhập/i })).not.toBeInTheDocument()
  })

  it('đã đăng nhập thì vào thẳng và Header hiện email thật', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: true, email: 'ha@example.com' })
    vi.spyOn(api, 'listCVs').mockResolvedValue([])

    renderAt('/cv')

    expect(await screen.findByTestId('view-my-cvs')).toBeInTheDocument()
    expect(screen.getByText('ha@example.com')).toBeInTheDocument()
  })
})

describe('màn hình đăng nhập', () => {
  it('gửi email và báo đã gửi link', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: false })
    const send = vi.spyOn(api, 'requestLogin').mockResolvedValue({ ok: true })

    renderAt('/login')
    await userEvent.type(await screen.findByLabelText(/email/i), 'ha@example.com')
    await userEvent.click(screen.getByRole('button', { name: /gửi link đăng nhập/i }))

    expect(send).toHaveBeenCalledWith('ha@example.com')
    expect(await screen.findByText(/đã gửi link đăng nhập/i)).toBeInTheDocument()
  })

  it('backend trả devLink thì hiện link bấm được để chạy thử', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: false })
    vi.spyOn(api, 'requestLogin').mockResolvedValue({
      ok: true,
      devLink: 'http://localhost:3002/api/auth/verify?token=abc',
    })

    renderAt('/login')
    await userEvent.type(await screen.findByLabelText(/email/i), 'ha@example.com')
    await userEvent.click(screen.getByRole('button', { name: /gửi link đăng nhập/i }))

    expect(await screen.findByRole('link', { name: /mở link đăng nhập/i })).toHaveAttribute(
      'href',
      'http://localhost:3002/api/auth/verify?token=abc',
    )
  })

  it('gửi hỏng thì hiện lỗi và giữ nguyên email đã nhập', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: false })
    vi.spyOn(api, 'requestLogin').mockRejectedValue(new api.ApiError(400, 'Email không hợp lệ'))

    renderAt('/login')
    const input = await screen.findByLabelText(/email/i)
    await userEvent.type(input, 'sai')
    await userEvent.click(screen.getByRole('button', { name: /gửi link đăng nhập/i }))

    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument()
    expect(input).toHaveValue('sai')
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
cd frontend && npx vitest run --project ui apps/web-spa/test/session.ui.test.tsx
```

Kỳ vọng: FAIL.

- [ ] **Step 3: Viết `src/lib/session.tsx`**

```tsx
import React, { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession, logout } from './api'

type Status = 'loading' | 'authenticated' | 'anonymous'

interface SessionValue {
  status: Status
  email?: string
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue>({
  status: 'loading',
  signOut: async () => {},
})

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [email, setEmail] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    getSession().then((s) => {
      if (!alive) return
      setStatus(s.authenticated ? 'authenticated' : 'anonymous')
      setEmail(s.email)
    })
    return () => {
      alive = false
    }
  }, [])

  async function signOut() {
    await logout()
    setStatus('anonymous')
    setEmail(undefined)
    // Tải lại thay vì chỉ đổi state: mọi dữ liệu đã nạp của người dùng cũ phải
    // biến mất khỏi bộ nhớ, không chỉ khỏi màn hình.
    window.location.assign('/login')
  }

  return (
    <SessionContext.Provider value={{ status, email, signOut }}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionValue {
  return useContext(SessionContext)
}

/**
 * Chặn route.
 *
 * Trạng thái `loading` có nhánh riêng, không gộp vào `anonymous`. Gộp thì
 * người đã đăng nhập thấy màn hình đăng nhập nhấp nháy ở mỗi lần tải trang,
 * trong khoảng thời gian chờ backend trả lời.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div data-testid="session-loading" className="p-10 text-center text-sm text-slate-500">
        Đang kiểm tra phiên đăng nhập…
      </div>
    )
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}
```

- [ ] **Step 4: Viết `src/routes/LoginPage.tsx`**

```tsx
import React, { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ApiError, requestLogin } from '../lib/api'
import { useSession } from '../lib/session'

export function LoginPage() {
  const { status } = useSession()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  if (status === 'authenticated') return <Navigate to="/" replace />

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSending(true)
    setError(undefined)
    try {
      const result = await requestLogin(email)
      setSent(true)
      setDevLink(result.devLink)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không gửi được link đăng nhập')
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-5">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-900">Đăng nhập</h1>
          <p className="text-xs text-slate-500">
            Nhập email, chúng tôi gửi cho bạn một đường dẫn đăng nhập. Không cần mật khẩu.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            disabled={sending}
            className="w-full px-4 py-2.5 bg-violet-700 hover:bg-violet-800 disabled:opacity-60 text-white font-semibold text-xs rounded-xl transition"
          >
            {sending ? 'Đang gửi…' : 'Gửi link đăng nhập'}
          </button>
        </form>

        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

        {sent && !error && (
          <div className="space-y-2 text-xs text-slate-600">
            <p>Đã gửi link đăng nhập. Mở hộp thư của bạn và bấm vào đường dẫn trong email.</p>
            {devLink && (
              <a href={devLink} className="inline-block font-semibold text-violet-700 hover:underline">
                Mở link đăng nhập (chỉ có ở môi trường chạy thử)
              </a>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Nối vào `routes.tsx`**

Chỉ đổi **phần khung** của mảng `appRoutes`; mảng `children` bên trong giữ y nguyên nội dung đã viết ở Task 5. Toàn cây được bọc trong `SessionProvider` bằng một route gốc không có `path`, và `/login` nằm **ngoài** vòng bảo vệ:

```tsx
import { Link, Outlet } from 'react-router-dom'
import { RequireAuth, SessionProvider } from '../lib/session'
import { LoginPage } from './LoginPage'

const protectedChildren: RouteObject[] = [
  // ĐÚNG NGUYÊN VĂN năm route đã viết ở Task 5 Step 5: index (dashboard),
  // 'cv', 'analyze/:cvId', 'templates', 'settings', '*' (NotFound).
]

const builderChildren: RouteObject[] = [
  // ĐÚNG NGUYÊN VĂN route 'builder/:cvId' đã viết ở Task 5 Step 5.
]

export const appRoutes: RouteObject[] = [
  {
    element: (
      <SessionProvider>
        <Outlet />
      </SessionProvider>
    ),
    children: [
      { path: 'login', element: <LoginPage /> },
      {
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: protectedChildren,
      },
      {
        element: (
          <RequireAuth>
            <AppLayout hideSidebar />
          </RequireAuth>
        ),
        children: builderChildren,
      },
    ],
  },
]
```

`/login` phải nằm ngoài `RequireAuth`, nếu không nó sẽ tự chuyển hướng về chính nó và trình duyệt treo trong vòng lặp.

- [ ] **Step 6: Header hiện email thật và nút đăng xuất**

Trong `Header.tsx`, bỏ prop `userEmail`, thay bằng:

```tsx
import { useSession } from '../lib/session'
...
  const { email, signOut } = useSession()
```

Chỗ đang hiển thị email cứng đổi thành `{email ?? 'Chưa đăng nhập'}`, và thêm nút:

```tsx
          <button
            onClick={signOut}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            Đăng xuất
          </button>
```

Xoá giá trị mặc định `'tester@example.com'` khỏi file — để lại thì một lỗi phiên sẽ hiện ra dưới dạng một email trông có vẻ hợp lệ.

- [ ] **Step 7: Chạy test để chắc chắn nó xanh**

```bash
cd frontend && npx vitest run --project ui apps/web-spa/test/ && npm run typecheck:spa
```

Kỳ vọng: mọi test xanh, typecheck sạch.

- [ ] **Step 8: Thử tay đầu-cuối với backend thật**

```bash
cd backend && docker compose up -d postgres redis backend
cd ../frontend && npm --workspace @hr/web-spa run dev
```

Mở `http://localhost:3002/cv` → bị chuyển sang `/login`. Nhập email bất kỳ → bấm gửi → bấm "Mở link đăng nhập" → quay lại ứng dụng đã đăng nhập, Header hiện đúng email vừa nhập. Bấm Đăng xuất → về `/login`.

- [ ] **Step 9: Commit**

```bash
cd /home/hailt/Desktop/HR-agent
git add -A frontend/apps/web-spa
git commit -m "feat: đăng nhập magic link và chặn route cho SPA

Trạng thái phiên có ba nhánh chứ không hai: đang hỏi, đã đăng nhập, chưa
đăng nhập. Gộp nhánh đang-hỏi vào chưa-đăng-nhập làm màn hình đăng nhập
nhấp nháy ở mỗi lần tải trang.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `/cv` đọc dữ liệu thật, bỏ mockData

**Files:**
- Modify: `frontend/apps/web-spa/src/components/MyCVsView.tsx`
- Create: `frontend/apps/web-spa/src/routes/MyCVsRoute.tsx`
- Modify: `frontend/apps/web-spa/src/routes/routes.tsx`
- Test: `frontend/apps/web-spa/test/my-cvs.ui.test.tsx`

**Interfaces:**
- Consumes: `listCVs`, `deleteCV`, `CVSummary`, `ApiError` (Task 3); `relativeTime` (Task 4); `RequireAuth` (Task 6).
- Produces: `MyCVsRoute` — component nạp dữ liệu; `MyCVsView` đổi prop `cvs: CV[]` → `cvs: CVSummary[]`.

Tách nạp-dữ liệu khỏi trình bày: `MyCVsRoute` gọi API và giữ trạng thái; `MyCVsView` nhận dữ liệu đã sẵn sàng và không biết gì về mạng. Nhờ vậy test bốn trạng thái (chờ · rỗng · có dữ liệu · lỗi) không cần giả lập mạng cho phần trình bày.

- [ ] **Step 1: Viết test đỏ**

Tạo `frontend/apps/web-spa/test/my-cvs.ui.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { MyCVsRoute } from '../src/routes/MyCVsRoute.js'
import * as api from '../src/lib/api.js'

function renderRoute() {
  return render(
    <MemoryRouter>
      <MyCVsRoute />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/cv', () => {
  it('hiện trạng thái đang tải trước khi có dữ liệu', async () => {
    vi.spyOn(api, 'listCVs').mockReturnValue(new Promise(() => {}))
    renderRoute()
    expect(await screen.findByTestId('cv-list-loading')).toBeInTheDocument()
  })

  it('liệt kê CV kèm thời gian tương đối và tên tin tuyển dụng', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([
      {
        id: 'cv-1',
        title: 'CV Backend Fresher',
        updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
        jdTitle: 'Junior Go Developer',
      },
    ])

    renderRoute()

    expect(await screen.findByText('CV Backend Fresher')).toBeInTheDocument()
    expect(screen.getByText(/3 giờ trước/)).toBeInTheDocument()
    expect(screen.getByText('Junior Go Developer')).toBeInTheDocument()
  })

  it('chưa có CV nào thì mời tạo, không hiện danh sách rỗng câm lặng', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([])
    renderRoute()
    expect(await screen.findByText(/chưa có cv nào/i)).toBeInTheDocument()
  })

  it('gọi hỏng thì hiện lỗi kèm nút thử lại', async () => {
    vi.spyOn(api, 'listCVs').mockRejectedValue(new api.ApiError(500, 'Không đọc được danh sách CV'))

    renderRoute()

    expect(await screen.findByText('Không đọc được danh sách CV')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /thử lại/i })).toBeInTheDocument()
  })

  it('xoá phải hỏi xác nhận, và chỉ gọi API sau khi người dùng đồng ý', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([
      { id: 'cv-1', title: 'CV Backend Fresher', updatedAt: new Date().toISOString() },
    ])
    const remove = vi.spyOn(api, 'deleteCV').mockResolvedValue(undefined)

    renderRoute()
    await userEvent.click(await screen.findByRole('button', { name: /^xoá$/i }))
    expect(remove).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /xoá vĩnh viễn/i }))
    expect(remove).toHaveBeenCalledWith('cv-1')
    expect(await screen.findByText(/chưa có cv nào/i)).toBeInTheDocument()
  })

  it('xoá hỏng thì CV vẫn còn trong danh sách và có thông báo lỗi', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([
      { id: 'cv-1', title: 'CV Backend Fresher', updatedAt: new Date().toISOString() },
    ])
    vi.spyOn(api, 'deleteCV').mockRejectedValue(new api.ApiError(403, 'Không có quyền xoá CV này'))

    renderRoute()
    await userEvent.click(await screen.findByRole('button', { name: /^xoá$/i }))
    await userEvent.click(screen.getByRole('button', { name: /xoá vĩnh viễn/i }))

    expect(await screen.findByText('Không có quyền xoá CV này')).toBeInTheDocument()
    expect(screen.getByText('CV Backend Fresher')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
cd frontend && npx vitest run --project ui apps/web-spa/test/my-cvs.ui.test.tsx
```

Kỳ vọng: FAIL — không tìm thấy `MyCVsRoute`.

- [ ] **Step 3: Viết `src/routes/MyCVsRoute.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, deleteCV, listCVs, type CVSummary } from '../lib/api'
import { MyCVsView } from '../components/MyCVsView'

/**
 * Nạp dữ liệu cho `/cv`.
 *
 * Tách khỏi `MyCVsView` để phần trình bày không biết gì về mạng: bốn trạng
 * thái (chờ · rỗng · có dữ liệu · lỗi) kiểm được ở đây, còn giao diện kiểm
 * bằng props thuần.
 */
export function MyCVsRoute() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CVSummary[] | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [actionError, setActionError] = useState<string | undefined>()

  const load = useCallback(async () => {
    setError(undefined)
    setItems(null)
    try {
      setItems(await listCVs())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không đọc được danh sách CV')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(id: string) {
    setActionError(undefined)
    try {
      await deleteCV(id)
      // Bỏ khỏi danh sách tại chỗ thay vì nạp lại: nạp lại làm màn hình nháy
      // về trạng thái chờ cho một thao tác đã biết chắc kết quả.
      setItems((current) => (current ?? []).filter((cv) => cv.id !== id))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không xoá được CV')
    }
  }

  if (error) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-sm font-semibold text-rose-600">{error}</p>
        <button
          onClick={() => void load()}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
        >
          Thử lại
        </button>
      </div>
    )
  }

  if (items === null) {
    return (
      <div data-testid="cv-list-loading" className="p-10 text-center text-sm text-slate-500">
        Đang tải danh sách CV…
      </div>
    )
  }

  return (
    <div data-testid="view-my-cvs">
      {actionError && (
        <p className="mx-6 mt-6 rounded-xl bg-rose-50 border border-rose-100 px-4 py-2.5 text-xs font-medium text-rose-600">
          {actionError}
        </p>
      )}
      <MyCVsView
        cvs={items}
        onSelectCVToEdit={(id) => navigate(`/builder/${id}`)}
        onCreateNewCV={() => navigate('/cv/new')}
        onOpenUploadModal={() => navigate('/import')}
        onDeleteCV={(id) => void remove(id)}
      />
    </div>
  )
}
```

`/cv/new` và `/import` chưa tồn tại ở SP-1 — chúng rơi vào route `*` và hiện màn hình "Không tìm thấy trang". Đó là hành vi đúng và tạm thời; SP-3 dựng hai màn hình đó.

- [ ] **Step 4: Đổi `MyCVsView.tsx` sang `CVSummary`**

Ba thay đổi, giữ nguyên toàn bộ phần còn lại của giao diện:

```tsx
import { CVSummary } from '../lib/api'
import { relativeTime } from '../lib/format'

interface MyCVsViewProps {
  cvs: CVSummary[]
  onSelectCVToEdit: (cvId: string) => void
  onCreateNewCV: () => void
  onOpenUploadModal: () => void
  onDeleteCV: (cvId: string) => void
}
```

Bộ lọc tìm kiếm không còn `sections.intro.fullName` để tra:

```tsx
  const filteredCVs = cvs.filter((cv) =>
    cv.title.toLowerCase().includes(searchQuery.toLowerCase()),
  )
```

Và thân mỗi thẻ CV:

```tsx
                <div>
                  <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-600 transition">
                    {cv.title}
                  </h3>
                  <p className="text-xs font-medium text-slate-500 mt-0.5">
                    {relativeTime(cv.updatedAt)}
                  </p>
                  {cv.jdTitle && (
                    <p className="text-xs font-medium text-indigo-600 mt-0.5">{cv.jdTitle}</p>
                  )}
                </div>
```

- [ ] **Step 5: Nối `MyCVsRoute` vào bản đồ route**

Trong `routes.tsx`, đổi dòng route `cv`:

```tsx
      { path: 'cv', element: <MyCVsRoute /> },
```

và bỏ `import { MyCVsView }` khỏi file này — nó chỉ còn được dùng bởi `MyCVsRoute`.

- [ ] **Step 6: Chạy test để chắc chắn nó xanh**

```bash
cd frontend && npx vitest run --project ui apps/web-spa/test/ && npm run typecheck:spa
```

Kỳ vọng: mọi test xanh, typecheck sạch.

- [ ] **Step 7: Thử tay với Postgres thật**

Backend và SPA vẫn chạy từ Task 6. Tạo một CV thật bằng `curl`, dùng hũ cookie thay vì chép tay từ DevTools:

```bash
cd /tmp
# 1. Xin link đăng nhập — môi trường chạy thử trả devLink ngay trong response.
LINK=$(curl -s -X POST http://localhost:3002/api/auth/request \
  -H 'content-type: application/json' \
  -d '{"email":"thu@example.com"}' | grep -o 'http[^"]*')
echo "$LINK"

# 2. Đổi link lấy cookie phiên, lưu vào hũ.
curl -s -c hr.jar -o /dev/null "$LINK"

# 3. Tạo CV bằng chính phiên đó.
curl -s -b hr.jar -X POST http://localhost:3002/api/cv \
  -H 'content-type: application/json' \
  -d '{"title":"CV thử nghiệm"}'
```

Gọi qua cổng 3002 chứ không 8080: như vậy bài thử này đi qua đúng đường mà trình duyệt đi, và nếu proxy làm rơi cookie thì lỗi lộ ra ngay ở đây.

Rồi đăng nhập bằng `thu@example.com` trên giao diện và mở `http://localhost:3002/cv`. Kỳ vọng: thấy "CV thử nghiệm" với mốc thời gian tương đối. Bấm Xoá → xác nhận → dòng biến mất. Tải lại trang: vẫn mất, vì nó đã bị xoá khỏi Postgres chứ không chỉ khỏi React state — đây chính là điều `mockData` không bao giờ làm được.

- [ ] **Step 8: Commit**

```bash
cd /home/hailt/Desktop/HR-agent
git add -A frontend/apps/web-spa
git commit -m "feat: /cv đọc danh sách thật từ Postgres

Nạp dữ liệu tách khỏi trình bày, nên bốn trạng thái chờ/rỗng/có/lỗi đều
kiểm được. Xoá hỏng thì CV vẫn còn trong danh sách, không biến mất giả.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Đóng gói và chạy trong Docker ở cổng 3002

**Files:**
- Create: `frontend/apps/web-spa/Dockerfile`
- Create: `frontend/apps/web-spa/.dockerignore`
- Modify: `backend/docker-compose.yml`
- Modify: `.env.example`
- Test: `frontend/apps/web-spa/test/smoke.int.test.ts`

**Interfaces:**
- Consumes: `createApp` (Task 1).
- Produces: service compose `web-spa` phục vụ cổng 3002.

- [ ] **Step 1: Viết test khói (đỏ khi chưa có gì chạy)**

Tạo `frontend/apps/web-spa/test/smoke.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

/**
 * Test tích hợp — cần `docker compose --profile full up -d web-spa backend`.
 * Nằm ở project `integration`, không chạy trong bộ test thường.
 */
const BASE = process.env.SPA_BASE_URL ?? 'http://localhost:3002'

describe('SPA đóng gói', () => {
  it('phục vụ trang chủ dạng HTML', async () => {
    const res = await fetch(BASE + '/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('URL sâu trả về HTML chứ không phải 404 — SPA tự định tuyến phía trình duyệt', async () => {
    const res = await fetch(BASE + '/cv')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('/api/health đi tới backend Go, không phải một handler cục bộ', async () => {
    const res = await fetch(BASE + '/api/health')
    expect(res.status).toBe(200)
    // `service: backend-go` chỉ có ở Go. Nhận được nó nghĩa là proxy đã thông,
    // và Express không còn tự trả lời /api/health như trước.
    expect(await res.json()).toMatchObject({ ok: true, service: 'backend-go' })
  })

  it('chưa đăng nhập thì GET /api/cv trả 401 từ Go', async () => {
    const res = await fetch(BASE + '/api/cv')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Viết `Dockerfile`**

Tạo `frontend/apps/web-spa/Dockerfile`:

```dockerfile
# SPA: Vite build ra tĩnh, Express phục vụ + proxy sang Go.
#
# Build từ GỐC repo, không phải từ apps/web-spa — `npm ci` cần package.json
# của mọi workspace mà package-lock khai:
#   docker compose --profile full build web-spa   (context: .. — xem docker-compose.yml)

# ── Giai đoạn build ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/apps/web/package.json             apps/web/
COPY frontend/apps/web-spa/package.json         apps/web-spa/
COPY frontend/packages/schema/package.json      packages/schema/
COPY frontend/packages/ai/package.json          packages/ai/
COPY frontend/packages/db/package.json          packages/db/
COPY frontend/packages/kb/package.json          packages/kb/
COPY frontend/packages/matching/package.json    packages/matching/
COPY frontend/packages/templates/package.json   packages/templates/

RUN npm ci --ignore-scripts

COPY frontend/apps/web-spa/ apps/web-spa/

WORKDIR /app/apps/web-spa
RUN npm run build

# ── Giai đoạn chạy ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# `server.cjs` được esbuild gói với `--packages=external`, nên express và các
# phụ thuộc runtime vẫn phải có mặt trong node_modules.
#
# KHÔNG `npm prune --omit=dev` ở đây. Prune cần package.json của MỌI workspace
# mà package-lock khai; stage này chỉ có node_modules và dist, nên npm sẽ thấy
# một cây workspace khuyết và gỡ nhầm. Image to hơn vài chục MB, đổi lại nó
# chạy đúng — cái giá đó chấp nhận được cho một service nội bộ.
COPY --from=builder /app/node_modules       ./node_modules
COPY --from=builder /app/apps/web-spa/dist  ./dist

EXPOSE 3002
ENV PORT=3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3002/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
```

- [ ] **Step 3: Viết `.dockerignore`**

Tạo `frontend/apps/web-spa/.dockerignore`:

```
node_modules
dist
.env
.env.local
```

- [ ] **Step 4: Thêm service vào `backend/docker-compose.yml`**

Ngay sau service `web`, thêm:

```yaml
  # SPA mới — chạy song song với `web` (Next) suốt SP-1..SP-4.
  # Cổng 3002 chứ không 3000: việc chiếm cổng 3000 là bước cutover ở SP-5.
  web-spa:
    build:
      context: ..
      dockerfile: frontend/apps/web-spa/Dockerfile
    container_name: hr-web-spa
    restart: unless-stopped
    environment:
      PORT: 3002
      NODE_ENV: production
      BACKEND_URL: http://backend:8080
    ports:
      - '3002:3002'
    depends_on:
      backend: { condition: service_started }
```

- [ ] **Step 4b: Gỡ `profiles: ['full']` khỏi mọi service**

Yêu cầu của chủ sản phẩm ngày 2026-08-09: `docker compose up -d --build` phải dựng **toàn bộ** service, không còn cái nào phải gọi riêng.

Hiện `web`, `pdfkit` và `worker` đều mang `profiles: ['full']`, nên lệnh trên bỏ qua chúng **im lặng** — không báo lỗi, không cảnh báo, chỉ đơn giản là không dựng. Xoá dòng `profiles: ['full']` khỏi cả ba. `web-spa` ở Step 4 đã không có sẵn.

Hệ quả phải nói rõ trong report: từ đây `docker compose up -d --build` sẽ **rebuild và khởi động lại cả `hr-web`** — bản Next đang phục vụ production ở `:3000`. Trước đây profile che nó khỏi việc đó. Đây là điều chủ sản phẩm đã chọn khi biết đánh đổi.

Sau khi xoá, xác minh bằng:

```bash
cd backend && docker compose config --services | sort
```

Kỳ vọng: liệt kê đủ `backend`, `pdfkit`, `postgres`, `redis`, `web`, `web-spa`, `worker` — bảy service, không thiếu cái nào.

- [ ] **Step 5: Ghi biến môi trường vào `.env.example`**

Thêm hai dòng vào `.env.example` ở gốc repo:

```
SPA_PORT=3002
BACKEND_URL=http://localhost:8080
```

- [ ] **Step 6: Dựng và chạy**

```bash
cd backend && docker compose --profile full up -d --build web-spa backend postgres redis
docker compose ps web-spa
```

Kỳ vọng: trạng thái `healthy` sau khoảng 20 giây. Nếu `unhealthy`, xem `docker compose logs web-spa`.

- [ ] **Step 7: Chạy test khói**

```bash
cd frontend && npx vitest run --project integration apps/web-spa/test/smoke.int.test.ts
```

Kỳ vọng: PASS, 4/4.

- [ ] **Step 8: Chạy toàn bộ bộ test một lượt**

```bash
cd frontend && npm run typecheck && npx vitest run --project unit --project ui
cd ../backend && go test ./...
```

Kỳ vọng: tất cả xanh. Bộ test cũ của `apps/web` **vẫn phải xanh** — SP-1 không được làm hỏng bản Next đang phục vụ production.

- [ ] **Step 9: Commit**

```bash
cd /home/hailt/Desktop/HR-agent
git add frontend/apps/web-spa/Dockerfile frontend/apps/web-spa/.dockerignore \
        frontend/apps/web-spa/test/smoke.int.test.ts backend/docker-compose.yml .env.example
git commit -m "build: đóng gói SPA và chạy ở cổng 3002 song song với Next

Cổng 3002 chứ không 3000: chiếm cổng 3000 là bước cutover của SP-5, và
Next phải còn phục vụ được cho tới lúc đó.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Điều kiện hoàn thành SP-1

Đánh dấu xong khi **tất cả** những điều sau đúng:

- [ ] `grep -rni 'gemini\|genai' frontend/apps/web-spa --exclude-dir=node_modules` không có kết quả.
- [ ] `docker compose --profile full ps` cho thấy `hr-web-spa` ở trạng thái `healthy`.
- [ ] Mở `http://localhost:3002/cv` khi chưa đăng nhập → chuyển sang `/login`.
- [ ] Đăng nhập bằng magic link → `/cv` hiện danh sách CV thật từ Postgres, Header hiện đúng email.
- [ ] Tải lại trang ở URL sâu bất kỳ → vẫn ở đúng màn hình đó.
- [ ] `cd frontend && npm run typecheck && npx vitest run --project unit --project ui` xanh.
- [ ] `cd backend && go test ./...` xanh.
- [ ] `http://localhost:3000` (Next) vẫn chạy bình thường.

## Việc SP-1 cố tình chưa làm

Ghi ra để người thực thi không đi lạc:

- Các màn hình `DashboardView`, `CVEditorView`, `JobMatchView`, `TemplatesView`, `SettingsView` **vẫn dùng `mockData`**. Chúng được nối vào dữ liệu thật ở SP-3 và SP-4.
- `/login`, `/cv` là hai màn hình duy nhất chạm dữ liệu thật ở SP-1.
- `/import`, `/cv/new`, `/diagnose/:cvId`, `/start/guided`, `/kb`, `/print/:cvId` chưa tồn tại — chúng rơi vào màn hình "Không tìm thấy trang". Đúng như thiết kế.
- Schema vẫn là v1. `_meta.verified`, `highlights[]`, `PII_PATHS` mới là việc của SP-2.
- Biến thể bản in `ats` và `thumbnail`: SP-5.
