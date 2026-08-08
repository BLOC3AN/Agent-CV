// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import nextPlugin from '@next/eslint-plugin-next'

/**
 * ESLint — cưỡng chế QUY TẮC KIẾN TRÚC, không phải quy tắc trình bày.
 *
 * ── Vì sao chỉ có bấy nhiêu rule ──
 * TDD §4 ghi "enforce bằng ESLint `no-restricted-imports`" từ đầu, nhưng repo
 * không hề có ESLint — nên ranh giới package chỉ tồn tại trong văn bản và sống
 * nhờ kỷ luật thủ công. Một lần lỡ tay là A6 ("không import SDK model trong code
 * nghiệp vụ") gãy im lặng, và chỉ lộ ra khi cần đổi provider.
 *
 * Bật cả bộ `recommended` về style sẽ đổ ra hàng trăm cảnh báo ngay lượt đầu,
 * và một lệnh lint luôn đỏ thì không ai đọc — nó thành tiếng ồn, và rule kiến
 * trúc chết chìm trong đó. Ở đây chỉ giữ những rule mà VI PHẠM = LỖI THẬT.
 */

/** SDK gọi model trực tiếp — chỉ `packages/ai/src/providers/**` được đụng vào. */
const MODEL_SDKS = ['@anthropic-ai/sdk', 'openai', '@google/generative-ai', 'cohere-ai', 'ollama']

const NO_MODEL_SDK = MODEL_SDKS.map((name) => ({
  name,
  message:
    'TDD §3.2 A6: chỉ packages/ai/src/providers/** được gọi model trực tiếp. ' +
    'Đi qua gateway của @hr/ai — nếu không, đổi provider sẽ phải sửa code nghiệp vụ.',
}))

/**
 * `@hr/worker/queues` là subpath ĐƯỢC KHAI trong "exports" — hợp lệ.
 * `@hr/ai/src/gateway` thì không: nó bám vào bố cục thư mục nội bộ của package
 * khác, nên mọi lần sắp xếp lại file sẽ gãy ở chỗ không ai ngờ.
 */
const NO_DEEP_IMPORT = {
  group: ['@hr/*/src/*', '@hr/*/test/*'],
  message:
    'Import qua entry point công khai (index.ts) hoặc subpath khai trong "exports", ' +
    'đừng bám vào đường dẫn file bên trong package khác.',
}

const NO_UPWARD_IMPORT = [
  {
    group: ['@hr/web', '@hr/worker', '@hr/worker/*'],
    message:
      'TDD §4: chiều phụ thuộc là apps/services → packages, KHÔNG có chiều ngược lại. ' +
      'Cần dữ liệu từ tầng trên thì nhận qua tham số, đừng import ngược.',
  },
  {
    group: ['**/apps/**', '**/services/**'],
    message: 'TDD §4: package không được với sang apps/ hay services/ bằng đường dẫn tương đối.',
  },
]

/** Gộp toàn bộ hạn chế của một tầng thành MỘT option — xem ghi chú ở dưới. */
function restricted({ layer }) {
  switch (layer) {
    case 'top':
      return { paths: NO_MODEL_SDK, patterns: [NO_DEEP_IMPORT] }
    case 'package':
      return { paths: NO_MODEL_SDK, patterns: [NO_DEEP_IMPORT, ...NO_UPWARD_IMPORT] }
    case 'schema':
      return {
        paths: NO_MODEL_SDK,
        patterns: [
          {
            group: ['@hr/*'],
            message:
              'packages/schema là đáy cây phụ thuộc — mọi package khác import nó. ' +
              'Nó import ngược lại là tạo vòng.',
          },
        ],
      }
    case 'provider':
      // Được gọi SDK, nhưng vẫn không được chọc ruột package khác.
      return { patterns: [NO_DEEP_IMPORT] }
  }
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      'var/**',
      'apps/web/var/**',
      'services/pdfkit/**',
      '**/*.tsbuildinfo',
      // Next sinh lại file này mỗi lần build — sửa là mất.
      'apps/web/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Bộ `recommended` của typescript-eslint gồm nhiều rule về style/độ chặt mà
    // dự án này cố tình không theo. Tắt ở đây, KHÔNG tắt rải rác bằng
    // `eslint-disable` trong code — để chỗ nào có disable là chỗ đó đáng đọc.
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `destructuring: 'all'` chứ không phải mặc định 'any': `let { valid, rejected }`
      // với `rejected` được gán lại là cách viết đúng, mặc định lại bắt lỗi nó.
      'prefer-const': ['error', { destructuring: 'all' }],
      // `skipRegExps`: services/worker/src/cv-chunk.ts có U+200B NẰM TRONG regex
      // nhận diện gạch đầu dòng — đó là ký tự cần khớp, không phải lỗi gõ nhầm.
      'no-irregular-whitespace': ['error', { skipRegExps: true }],
    },
  },

  // ── React / Next — chỉ ở apps/web ─────────────────────────────────────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      // Rule này đi tìm thư mục `pages/` của Pages Router. Dự án dùng App
      // Router nên nó chỉ in ra một cảnh báo về đường dẫn ở mỗi lần chạy.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // ── Ranh giới kiến trúc (TDD §3.2 A6, §4) ─────────────────────────────────
  //
  // LƯU Ý khi sửa phần này: flat config THAY THẾ option của rule, không gộp.
  // Hai config object cùng đặt `no-restricted-imports` cho một file thì cái sau
  // xoá sạch cái trước. Đây không phải lý thuyết — bản đầu của file này viết
  // thành 4 khối chồng nhau, và 2 trong 3 rule kiến trúc lặng lẽ không bao giờ
  // nổ. Vì vậy mỗi phạm vi có ĐÚNG MỘT khối, gộp bằng hàm dưới đây.
  ...['apps/**/*.{ts,tsx}', 'services/worker/**/*.ts', 'eval/**/*.ts', 'scripts/**/*.ts'].map(
    (glob) => ({
      files: [glob],
      rules: { 'no-restricted-imports': ['error', restricted({ layer: 'top' })] },
    }),
  ),
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', restricted({ layer: 'package' })] },
  },
  {
    // schema là ĐÁY cây phụ thuộc: mọi package khác import nó, nó không import ai.
    files: ['packages/schema/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', restricted({ layer: 'schema' })] },
  },
  {
    // NGOẠI LỆ DUY NHẤT của A6 — đây chính là chỗ được phép biết model ở đâu.
    files: ['packages/ai/src/providers/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', restricted({ layer: 'provider' })] },
  },

  // Test được phép thoải mái hơn: mock cần gán kiểu lỏng, fixture cần biến thừa.
  {
    files: ['**/test/**/*.{ts,tsx}', 'eval/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
