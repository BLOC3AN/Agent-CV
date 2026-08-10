import express from 'express'
import path from 'node:path'
import { createApiProxy } from './proxy.js'
import { createPrintHandler } from './print.js'

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
  app.get('/print/:cvId', createPrintHandler(options.backendURL))

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
