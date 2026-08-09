import dotenv from 'dotenv'
import { createApp } from './src/server/app.js'

dotenv.config()

const PORT = Number(process.env.PORT) || 3002
const backendURL = process.env.BACKEND_URL || 'http://localhost:8080'

// Không await ở top-level: esbuild bundle bản production thành CJS
// (`--format=cjs` ở script `build`), và CJS không hỗ trợ top-level await.
createApp({ backendURL }).then((app) => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HR-Agent SPA đang chạy tại http://0.0.0.0:${PORT} — API đi tới ${backendURL}`)
  })
})
