import type { NextConfig } from 'next'

const config: NextConfig = {
  // Monorepo: các package nội bộ là TS nguồn, không build sẵn
  transpilePackages: ['@hr/schema', '@hr/templates', '@hr/db', '@hr/ai'],

  // packages/db dùng `pg` (driver Node) — không bundle vào client
  // pg là driver Node — không bundle
  serverExternalPackages: ['pg'],

  experimental: {
    serverActions: { bodySizeLimit: '12mb' },
  },

  eslint: { ignoreDuringBuilds: true },

  webpack(cfg) {
    /*
     * Các package nội bộ viết import kiểu ESM chuẩn: `import './budget.js'`
     * trỏ tới file nguồn `budget.ts`. Node, tsx và vitest đều hiểu; webpack thì
     * không. `extensionAlias` dạy nó cách phân giải.
     *
     * Cách khác là bỏ đuôi `.js` trong import, nhưng làm vậy sẽ hỏng khi chạy
     * bằng Node thuần — nên sửa ở đây là đúng chỗ.
     */
    cfg.resolve.extensionAlias = {
      ...cfg.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return cfg
  },
}

export default config
