# Nền tảng hệ thiết kế HR-Agent — Kế hoạch triển khai (1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng tầng token Teal+Ink, nạp font thật, 8 primitive dùng chung, công tắc ngôn ngữ CV `vi | en`, và dựng lại màn `/` làm lát cắt dọc kiểm chứng cả hệ thống.

**Architecture:** Token khai bằng `@theme` của Tailwind v4 trong `globals.css`, sinh ra utility ngữ nghĩa (`bg-surface`, `text-ink`, `border-brand`). Tám primitive tự viết ở `apps/web/components/ui/` tiêu thụ token đó; không thêm dependency UI. Màn `/` dựng lại bằng chính bộ primitive này để lộ ra sai sót của tầng token khi mới đụng một màn hình.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Tailwind CSS v4 · Vitest + Testing Library + happy-dom

**Nguồn:** [spec 2026-08-07](../specs/2026-08-07-frontend-redesign-design.md). Kế hoạch này phủ **bước 1–4** của spec §7.1, cộng §11 (ngôn ngữ CV).

**Thuộc kế hoạch 2, KHÔNG làm ở đây** — nêu rõ để không ai tưởng bị bỏ sót:

| Hạng mục spec | Vì sao hoãn |
|---|---|
| §5.3 Tầng chứng cứ — diff, badge nguồn theo `grounding.type`, dấu ⚪ | Sống trong `PatchReviewModal` và cây template ở `/builder` — nhóm A, dựng lại ở kế hoạch 2 |
| §6.3 `/builder`, §6.4 `/analyze` | Nhóm A, phức tạp nhất, làm khi khuôn đã chắc |
| Di trú 9 màn nhóm B | Bước 5 của §7.1 |
| §7.4 Rule ESLint chặn palette thô | Bước 7 — bật khi không còn ai dùng palette thô, nếu bật sớm thì `npm run lint` đỏ suốt |
| Đổi `PatchReviewModal`/`ChatPanel` sang `Dialog`/`Sheet` | Primitive dựng ở Task 6–7, thay chỗ dùng ở kế hoạch 2 |

**Nhánh:** tạo `feat/design-system` từ `chore/frontend-foundation`.

---

## Global Constraints

Mọi task đều phải thoả những điều dưới đây.

- **Không thêm dependency UI nào** (spec D6). Không Radix, không shadcn, không thư viện icon.
- **Chỉ chế độ sáng** (spec D4). Không viết class `dark:` mới. Class `dark:` cũ trong file đang sửa thì gỡ; file không đụng tới thì để nguyên cho kế hoạch 2.
- **Teal chỉ dành cho thương hiệu và AI.** Trạng thái không mượn teal; AI không mượn `success`/`warn`/`danger`.
- **Không tô màu điểm khớp JD** (spec D8, TDD §8.2.3).
- **`/print/:cvId` không được sửa** (spec D9) — trừ đúng một dòng `--cv-font` ở Task 2.
- **Cổng trước mỗi commit:** `npm run lint && npm run typecheck && npm run test` phải xanh. Số test chỉ được tăng, không giảm — mốc hiện tại **627 test / 33 file**.
- **Test UI:** file `apps/web/test/<tên>.ui.test.tsx`, chạy bằng `npx vitest run --project ui <đường-dẫn>`. Setup dùng chung ở `apps/web/test/setup.ts` (đã có `cleanup` + `vi.restoreAllMocks`).
- **Truy vấn trong test dùng `getByRole`/`getByText`/`getByLabelText`**, không bám `className` — 76 truy vấn hiện có đều theo quy ước này.
- **Commit message tiếng Việt**, tiền tố conventional, kết thúc bằng:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Comment trong code giải thích LÝ DO**, không mô tả lại code — theo văn phong sẵn có của repo.

---

## File Structure

**Tạo mới**

| File | Trách nhiệm |
|---|---|
| `apps/web/app/fonts/` | File `.woff2` của Be Vietnam Pro (400, 600) |
| `apps/web/lib/fonts.ts` | Khai `next/font/local`, xuất biến CSS |
| `apps/web/components/ui/Button.tsx` | Nút, 4 kiểu, 2 cỡ, disabled kèm lý do |
| `apps/web/components/ui/Card.tsx` | Vỏ thẻ, 3 biến thể |
| `apps/web/components/ui/Section.tsx` | Tiêu đề mục + hành động phụ |
| `apps/web/components/ui/Badge.tsx` | Nhãn trạng thái, luôn icon + chữ |
| `apps/web/components/ui/Meter.tsx` | Thanh số liệu + phân rã mở được |
| `apps/web/components/ui/Dialog.tsx` | Modal + a11y đầy đủ |
| `apps/web/components/ui/Sheet.tsx` | Slide-over + a11y đầy đủ |
| `apps/web/components/ui/Field.tsx` | Nhãn + input + gợi ý + lỗi |
| `apps/web/components/ui/index.ts` | Điểm xuất chung của bộ primitive |
| `apps/web/components/ui/devWarn.ts` | Cảnh báo dev dùng chung |
| `apps/web/components/cv/CvThumbnail.tsx` | Bản CV thu nhỏ |
| `apps/web/components/ai/AiPanel.tsx` | Chữ ký AI + trạng thái degrade |
| `apps/web/components/editor/CvLanguageSwitch.tsx` | Công tắc ngôn ngữ CV `vi \| en` |

**Sửa**

| File | Sửa gì |
|---|---|
| `apps/web/app/globals.css` | Thêm khối `@theme`; gỡ style `dark:` không còn dùng |
| `apps/web/app/layout.tsx` | Gắn class biến font lên `<html>` |
| `packages/templates/src/styles.css:18` | `--cv-font` trỏ vào biến của next/font |
| `apps/web/app/page.tsx` | Truyền tên người dùng; khử trùng lặp đối chiếu; thêm mốc thời gian |
| `apps/web/components/home/ReturningHome.tsx` | Dựng lại theo spec §6.2 |
| `apps/web/components/home/IntentRouter.tsx` | Áp primitive — giữ nguyên `ENTRIES` và mọi `href` |
| `apps/web/components/home/ResumeHome.tsx` | Áp primitive — nhánh job hỏng dùng tông `danger` |
| `apps/web/components/nav/TopNav.tsx` | Nav mới + nút Trợ lý |
| `apps/web/components/editor/BuilderShell.tsx:76-82` | Chèn `CvLanguageSwitch` vào `<header>` sẵn có — **chỉ chèn**, không dựng lại (`/builder` thuộc kế hoạch 2) |
| `docs/FRONTEND.md` | Thêm §13 Hệ thiết kế; sửa §9.1, §9.6, §9.7, §10, §12 |

---

## Task 1: Tầng token

**Files:**
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/test/tokens.ui.test.tsx` (tạo mới)

**Interfaces:**
- Consumes: không có
- Produces: utility class Tailwind sinh từ `@theme` — `bg-brand`, `bg-brand-hover`, `bg-brand-subtle`, `border-brand-border`, `text-brand-ink`, `text-ink`, `text-ink-muted`, `text-ink-subtle`, `bg-surface`, `bg-canvas`, `border-border`, `border-border-strong`, `text-success`, `bg-success-subtle`, `text-warn`, `bg-warn-subtle`, `text-danger`, `bg-danger-subtle`. Mọi task sau dùng đúng những tên này.

- [ ] **Step 1: Viết test thất bại**

Test kiểm biến CSS có mặt trên `document`, vì đó là thứ mọi component sau phụ thuộc.

Tạo `apps/web/test/tokens.ui.test.tsx`:

```tsx
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Token là hợp đồng giữa tầng thiết kế và mọi component sau nó.
 * Đọc thẳng globals.css chứ không render: happy-dom không chạy Tailwind,
 * nên kiểm bằng DOM sẽ luôn xanh dù token chưa hề được khai.
 */

let css = ''
beforeAll(() => {
  css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
})

const REQUIRED = [
  ['--color-brand', '#0D9488'],
  ['--color-brand-hover', '#0F766E'],
  ['--color-brand-subtle', '#F0FDFA'],
  ['--color-brand-border', '#99F6E4'],
  ['--color-brand-ink', '#134E4A'],
  ['--color-ink', '#0F172A'],
  ['--color-ink-muted', '#475569'],
  ['--color-ink-subtle', '#94A3B8'],
  ['--color-surface', '#FFFFFF'],
  ['--color-canvas', '#F8FAFC'],
  ['--color-border', '#E2E8F0'],
  ['--color-border-strong', '#CBD5E1'],
  ['--color-success', '#059669'],
  ['--color-success-subtle', '#ECFDF5'],
  ['--color-warn', '#D97706'],
  ['--color-warn-subtle', '#FFFBEB'],
  ['--color-danger', '#DC2626'],
  ['--color-danger-subtle', '#FEF2F2'],
]

describe('tầng token', () => {
  it.each(REQUIRED)('khai %s = %s', (name, value) => {
    expect(css).toMatch(new RegExp(`${name}:\\s*${value};`, 'i'))
  })

  it('khối @theme tồn tại', () => {
    expect(css).toContain('@theme')
  })

  it('KHÔNG còn khai màu trong :root ngoài @theme — token phải ở một chỗ', () => {
    const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rootBlock).not.toMatch(/--color-/)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/tokens.ui.test.tsx`
Expected: FAIL — nhiều `it.each` đỏ vì `globals.css` chưa có `@theme`.

- [ ] **Step 3: Thêm khối `@theme`**

Chèn vào `apps/web/app/globals.css` ngay sau hai dòng `@import` đang có:

```css
/*
 * Token thiết kế — spec 2026-08-07 §3.
 *
 * ── Vì sao ở đây chứ không rải trong component ──
 * Trước đây 586 lượt màu dùng thẳng palette Tailwind (`bg-sky-600`,
 * `text-neutral-500`) trên 38 file. Đổi một sắc độ phải sửa 38 chỗ, và chỗ
 * thứ 39 sẽ lệch mà không ai biết.
 *
 * QUY TẮC MỘT DÒNG: teal chỉ dành cho thương hiệu và AI. Nhìn thấy teal là
 * biết máy đang tham gia. Trạng thái không mượn teal; AI không mượn xanh lá,
 * vàng hay đỏ.
 */
@theme {
  /* Thương hiệu — brand VÀ mọi vùng AI, không dùng cho gì khác */
  --color-brand: #0D9488;
  --color-brand-hover: #0F766E;
  --color-brand-subtle: #F0FDFA;
  --color-brand-border: #99F6E4;
  --color-brand-ink: #134E4A;

  /* Mực và nền */
  --color-ink: #0F172A;
  --color-ink-muted: #475569;
  --color-ink-subtle: #94A3B8;
  --color-surface: #FFFFFF;
  --color-canvas: #F8FAFC;
  --color-border: #E2E8F0;
  --color-border-strong: #CBD5E1;

  /* Trạng thái — không bao giờ dùng teal */
  --color-success: #059669;
  --color-success-subtle: #ECFDF5;
  --color-warn: #D97706;
  --color-warn-subtle: #FFFBEB;
  --color-danger: #DC2626;
  --color-danger-subtle: #FEF2F2;

  /* Bo góc — đúng ba mức, đừng thêm mức thứ tư */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  /* Bóng — đúng hai mức: thẻ nổi và lớp phủ */
  --shadow-sm: 0 1px 2px rgb(15 23 42 / 6%), 0 1px 3px rgb(15 23 42 / 8%);
  --shadow-md: 0 4px 12px rgb(15 23 42 / 8%), 0 12px 32px rgb(15 23 42 / 10%);
}
```

Trong khối `:root` sẵn có, **giữ nguyên** `--font-ui` (Task 2 sẽ thay). Không thêm biến màu nào vào `:root`.

- [ ] **Step 4: Đặt nền trang**

Sửa quy tắc `body` trong `globals.css`:

```css
body {
  font-family: var(--font-ui);
  background-color: var(--color-canvas);
  color: var(--color-ink);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 5: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/tokens.ui.test.tsx`
Expected: PASS — toàn bộ.

- [ ] **Step 6: Kiểm tra Tailwind thật sự sinh ra utility**

Run: `npm run build:web`
Expected: exit 0.

Sau đó xác nhận class được sinh:

```bash
grep -o "bg-brand\|text-ink\|bg-canvas" apps/web/.next/static/css/*.css | sort -u
```

Expected: in ra ít nhất `bg-brand`, `text-ink`. Nếu trống thì `@theme` đặt sai chỗ — nó phải nằm **sau** `@import 'tailwindcss'`.

- [ ] **Step 7: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/app/globals.css apps/web/test/tokens.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): tầng token Teal+Ink thay cho 586 lượt palette thô

Token khai một chỗ bằng @theme của Tailwind v4. Quy tắc: teal CHỈ dành cho
thương hiệu và AI — trạng thái không mượn teal, AI không mượn xanh lá/vàng/đỏ.

Test đọc thẳng globals.css chứ không render: happy-dom không chạy Tailwind
nên kiểm bằng DOM sẽ luôn xanh dù token chưa hề được khai.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Nạp font Be Vietnam Pro thật

**Files:**
- Create: `apps/web/app/fonts/BeVietnamPro-Regular.woff2`, `apps/web/app/fonts/BeVietnamPro-SemiBold.woff2`
- Create: `apps/web/lib/fonts.ts`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/globals.css` (dòng `--font-ui`)
- Modify: `packages/templates/src/styles.css:18` (dòng `--cv-font`)
- Test: `apps/web/test/fonts.ui.test.tsx` (tạo mới)

**Interfaces:**
- Consumes: token từ Task 1
- Produces: `beVietnamPro` từ `@/lib/fonts` — đối tượng của `next/font/local`, có `.variable` (chuỗi class) và `.className`. Biến CSS tên `--font-be-vietnam`.

**Bối cảnh — vì sao task này tồn tại.** `globals.css` khai `--font-ui: 'Be Vietnam Pro'` và `packages/templates/src/styles.css` khai `--cv-font` cùng font, nhưng repo **không có** `@font-face`, không `next/font`, không file `.woff2` nào. Cả giao diện lẫn **bản CV xuất ra PDF** đang chạy bằng font hệ thống.

**Sai khác so với spec §3.2 — đọc trước khi làm.** Spec ghi "thêm cùng font vào `services/worker/Dockerfile`". Kế hoạch này **không làm vậy**, vì hai lý do: (1) `packages/templates/src/field.tsx:16-24` ghi rõ cả cây template là `'use client'` và `/print` vẫn được server-render — nghĩa là Chromium của Playwright tải trang `/print` qua HTTP từ chính web app, nên nó nhận luôn `@font-face` do `next/font` sinh ra; (2) fontconfig không xử lý `woff2` đáng tin. Step 7 kiểm chứng bằng PDF thật. **Nếu step 7 thất bại**, khi đó mới thêm bản `.ttf` vào Dockerfile worker.

- [ ] **Step 1: Tải file font**

Be Vietnam Pro theo giấy phép OFL. Chạy từ gốc repo:

```bash
mkdir -p apps/web/app/fonts
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
CSS=$(curl -sf -A "$UA" 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600&display=swap')

# Google trả các khối @font-face theo subset; lấy khối 'vietnamese' cho từng weight.
echo "$CSS" | grep -B6 "unicode-range: U+0102" | grep -oE 'https://[^)]+\.woff2' > /tmp/vn-fonts.txt
wc -l /tmp/vn-fonts.txt   # kỳ vọng 2 dòng: 400 và 600
```

Nếu ra đúng 2 dòng thì tải:

```bash
curl -sfo apps/web/app/fonts/BeVietnamPro-Regular.woff2  "$(sed -n '1p' /tmp/vn-fonts.txt)"
curl -sfo apps/web/app/fonts/BeVietnamPro-SemiBold.woff2 "$(sed -n '2p' /tmp/vn-fonts.txt)"
ls -la apps/web/app/fonts/
```

Expected: hai file, mỗi file khoảng 15–40 KB. File 0 byte nghĩa là tải hỏng — dừng lại, đừng đi tiếp.

Nếu máy không ra được internet: tải thủ công từ <https://fonts.google.com/specimen/Be+Vietnam+Pro>, lấy weight 400 và 600, chuyển sang `.woff2`, đặt đúng hai tên trên.

- [ ] **Step 2: Viết test thất bại**

Tạo `apps/web/test/fonts.ui.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Font từng được KHAI mà không được NẠP — `globals.css` và
 * `packages/templates/src/styles.css` cùng ghi 'Be Vietnam Pro' trong khi repo
 * không có file font nào. Hệ quả không lộ trên màn hình dev (máy nào cũng có
 * font thay thế trông tạm ổn) mà lộ ở file PDF người dùng nộp đi.
 *
 * Test này giữ cho khai báo và file luôn đi cùng nhau.
 */

const FONTS = [
  'BeVietnamPro-Regular.woff2',
  'BeVietnamPro-SemiBold.woff2',
]

describe('font Be Vietnam Pro', () => {
  it.each(FONTS)('%s có mặt và không rỗng', (name) => {
    const p = resolve(__dirname, '../app/fonts', name)
    expect(existsSync(p)).toBe(true)
    expect(statSync(p).size).toBeGreaterThan(1_000)
  })

  it('lib/fonts.ts khai biến CSS --font-be-vietnam', () => {
    const src = readFileSync(resolve(__dirname, '../lib/fonts.ts'), 'utf8')
    expect(src).toContain("variable: '--font-be-vietnam'")
  })

  it('globals.css dùng biến của next/font, không dùng tên họ font trần', () => {
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
    expect(css).toMatch(/--font-ui:\s*var\(--font-be-vietnam\)/)
  })

  it('CV dùng CÙNG biến đó — preview và PDF không được lệch font', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../packages/templates/src/styles.css'),
      'utf8',
    )
    expect(css).toMatch(/--cv-font:\s*var\(--font-be-vietnam\)/)
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/fonts.ui.test.tsx`
Expected: FAIL — `lib/fonts.ts` chưa tồn tại (test ném ENOENT), các assert CSS đỏ.

- [ ] **Step 4: Khai font**

Tạo `apps/web/lib/fonts.ts`:

```ts
import localFont from 'next/font/local'

/**
 * Be Vietnam Pro — nhúng cục bộ, KHÔNG gọi Google Fonts lúc chạy.
 *
 * Trang /print render trong Playwright ở worker; nếu font đến từ mạng ngoài
 * thì môi trường không có internet sẽ in ra font thay thế, và lỗi chỉ lộ ở
 * file PDF cuối cùng chứ không lộ trên màn hình dev.
 *
 * Dùng `variable` chứ không `className`: `packages/templates/src/styles.css`
 * cần tham chiếu font qua biến CSS, vì nó là gói dùng chung không biết gì về
 * next/font. Đặt `className` thì next/font sinh tên họ băm mà CSS kia không
 * đoán được.
 *
 * Chỉ hai weight (400, 600) — thang chữ ở spec §3.2 không dùng weight nào khác,
 * và mỗi weight thêm vào là một file nữa phải tải trước khi trang hiện chữ.
 */
export const beVietnamPro = localFont({
  src: [
    { path: '../app/fonts/BeVietnamPro-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../app/fonts/BeVietnamPro-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-be-vietnam',
  display: 'swap',
  fallback: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
})
```

- [ ] **Step 5: Gắn biến lên `<html>`**

Trong `apps/web/app/layout.tsx`, import và thêm class vào thẻ `<html>`. Giữ nguyên mọi thứ khác:

```tsx
import { beVietnamPro } from '@/lib/fonts'

// ...trong JSX:
<html lang="vi" className={beVietnamPro.variable}>
```

- [ ] **Step 6: Trỏ hai biến font vào next/font**

Trong `apps/web/app/globals.css`:

```css
:root {
  /* next/font sinh --font-be-vietnam ở scope <html>; giữ chuỗi dự phòng để
     trang vẫn đọc được nếu file font tải hỏng. */
  --font-ui: var(--font-be-vietnam), 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
```

Trong `packages/templates/src/styles.css` dòng 18:

```css
  --cv-font: var(--font-be-vietnam), 'Inter', 'Segoe UI', Arial, sans-serif;
```

- [ ] **Step 7: Kiểm chứng bằng PDF thật**

Đây là bước quyết định spec §3.2 có cần đổi hay không.

```bash
npm run dev:restart                        # build lại + chạy ở :3100
docker compose up -d postgres redis
docker compose --profile full up -d pdfkit
npm --workspace @hr/worker run dev &        # worker cần cho export
```

Mở `http://localhost:3100`, tạo hoặc mở một CV, xuất PDF. Rồi kiểm font nhúng:

```bash
# đường dẫn file vừa xuất nằm dưới $STORAGE_ROOT
pdffonts "$(ls -t "$STORAGE_ROOT"/**/*.pdf | head -1)"
```

Expected: bảng kết quả có dòng chứa `BeVietnamPro`.
Nếu KHÔNG có: dừng, ghi lại kết quả, và thêm bản `.ttf` vào `services/worker/Dockerfile` kèm `fc-cache -f` như spec §3.2 dự phòng.

- [ ] **Step 8: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/fonts.ui.test.tsx`
Expected: PASS — cả 5.

- [ ] **Step 9: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/app/fonts apps/web/lib/fonts.ts apps/web/app/layout.tsx \
        apps/web/app/globals.css packages/templates/src/styles.css \
        apps/web/test/fonts.ui.test.tsx
git commit -m "$(cat <<'EOF'
fix(ui): nạp Be Vietnam Pro thật — font được khai nhưng chưa bao giờ có file

globals.css và packages/templates/src/styles.css cùng khai 'Be Vietnam Pro'
trong khi repo không có @font-face, không next/font, không file .woff2 nào.
Cả giao diện lẫn file PDF xuất ra đang chạy bằng font hệ thống.

Dùng `variable` chứ không `className`: packages/templates là gói dùng chung,
không biết gì về next/font, nên phải tham chiếu qua biến CSS.

Không cài font vào Dockerfile worker: /print được server-render và Chromium
tải font qua HTTP từ chính web app. Đã kiểm bằng pdffonts trên PDF thật.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Primitive `Button`

**Files:**
- Create: `apps/web/components/ui/devWarn.ts`
- Create: `apps/web/components/ui/Button.tsx`
- Create: `apps/web/components/ui/index.ts`
- Test: `apps/web/test/ui-button.ui.test.tsx`

**Interfaces:**
- Consumes: token từ Task 1
- Produces:
  ```ts
  type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
  type ButtonSize = 'sm' | 'md'
  interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant   // mặc định 'primary'
    size?: ButtonSize         // mặc định 'md'
    disabledReason?: string
  }
  function Button(props: ButtonProps): JSX.Element
  function devWarn(condition: boolean, message: string): void
  ```
- Task 5–14 import từ `@/components/ui`.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/ui-button.ui.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui'

/**
 * FRONTEND §8.1: khi model server chết, nút cần AI phải MỜ ĐI kèm lời giải
 * thích, KHÔNG được biến mất — biến mất khiến người dùng tưởng mình vừa thao
 * tác sai và thử lại nhiều lần.
 */

afterEach(() => vi.restoreAllMocks())

describe('Button', () => {
  it('bấm được và gọi onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Tiếp tục</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disabled thì không gọi onClick', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled disabledReason="Trợ lý AI đang tạm ngưng" onClick={onClick}>
        Cùng tôi sửa
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: /Cùng tôi sửa/ }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('nút vẫn CÓ MẶT khi disabled — không biến mất', () => {
    render(
      <Button disabled disabledReason="Trợ lý AI đang tạm ngưng">Cùng tôi sửa</Button>,
    )
    expect(screen.getByRole('button', { name: /Cùng tôi sửa/ })).toBeInTheDocument()
  })

  it('lý do disabled đọc được qua aria-describedby', () => {
    render(
      <Button disabled disabledReason="Trợ lý AI đang tạm ngưng">Cùng tôi sửa</Button>,
    )
    const btn = screen.getByRole('button', { name: /Cùng tôi sửa/ })
    const id = btn.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    expect(document.getElementById(id!)?.textContent).toBe('Trợ lý AI đang tạm ngưng')
  })

  it('disabled mà THIẾU lý do: vẫn render, nhưng cảnh báo ở dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Button disabled>Cùng tôi sửa</Button>)
    expect(screen.getByRole('button', { name: 'Cùng tôi sửa' })).toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disabledReason'))
  })

  it('không disabled thì không có aria-describedby thừa', () => {
    render(<Button>Tiếp tục</Button>)
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).not.toHaveAttribute(
      'aria-describedby',
    )
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/ui-button.ui.test.tsx`
Expected: FAIL — không phân giải được `@/components/ui`.

- [ ] **Step 3: Viết `devWarn`**

Tạo `apps/web/components/ui/devWarn.ts`:

```ts
/**
 * Cảnh báo lúc phát triển, im lặng khi chạy thật.
 *
 * Spec D7: các ràng buộc của primitive là KHUYẾN NGHỊ, không phải lỗi biên
 * dịch. Nhưng "khuyến nghị" mà không có tín hiệu nào thì bằng không có — chỗ
 * quên sẽ trôi qua review và chỉ lộ ra khi có người đọc lại.
 *
 * `console.warn` là mức đúng: người viết code thấy ngay khi mở màn hình, còn
 * người dùng cuối không thấy gì.
 */
export function devWarn(condition: boolean, message: string): void {
  if (condition && process.env.NODE_ENV !== 'production') {
    console.warn(`[ui] ${message}`)
  }
}
```

- [ ] **Step 4: Viết `Button`**

Tạo `apps/web/components/ui/Button.tsx`:

```tsx
'use client'

import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { devWarn } from './devWarn'

/**
 * Nút dùng chung.
 *
 * Trước khi có file này, mẫu `rounded-lg bg-sky-600 px-4 py-2` được chép lại
 * 7 lần ở 7 chỗ — lần thứ 8 sẽ lệch một sắc độ hoặc một pixel padding mà
 * không ai phát hiện.
 *
 * ── disabledReason ──
 * FRONTEND §8.1: model server không có SLA, nên nút cần AI sẽ có lúc phải tắt.
 * Tắt mà không nói lý do thì người dùng tưởng mình thao tác sai. Prop này là
 * khuyến nghị (spec D7) — thiếu thì cảnh báo ở dev, không chặn.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Vì sao nút đang tắt — hiện ra cho cả người nhìn lẫn trình đọc màn hình */
  disabledReason?: string
  children: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'border border-border-strong bg-surface text-ink hover:border-brand hover:text-brand',
  ghost: 'text-ink-muted hover:bg-canvas hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-90',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[13px]',
  md: 'px-4 py-2 text-[15px]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  disabled,
  disabledReason,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const reasonId = useId()
  devWarn(
    Boolean(disabled) && !disabledReason,
    'Button đang disabled mà không có disabledReason — người dùng sẽ không biết vì sao bấm không được.',
  )

  const showReason = Boolean(disabled && disabledReason)

  return (
    <>
      <button
        {...rest}
        disabled={disabled}
        aria-describedby={showReason ? reasonId : undefined}
        className={[
          'inline-flex items-center justify-center gap-2 rounded-md font-medium',
          'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
          VARIANT[variant],
          SIZE[size],
          className,
        ].join(' ')}
      >
        {children}
      </button>
      {showReason && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  )
}
```

- [ ] **Step 5: Tạo điểm xuất chung**

Tạo `apps/web/components/ui/index.ts`:

```ts
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button'
export { devWarn } from './devWarn'
```

- [ ] **Step 6: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/ui-button.ui.test.tsx`
Expected: PASS — cả 6.

- [ ] **Step 7: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/ui apps/web/test/ui-button.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): primitive Button — gom 7 chỗ chép lại cùng một mẫu nút

disabledReason là khuyến nghị (spec D7), thiếu thì cảnh báo ở dev. Nó tồn tại
vì FRONTEND §8.1: model server không có SLA, nút cần AI sẽ có lúc phải tắt, và
tắt mà không nói lý do làm người dùng tưởng mình thao tác sai.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Primitive `Card`, `Section`, `Badge`

**Files:**
- Create: `apps/web/components/ui/Card.tsx`, `Section.tsx`, `Badge.tsx`
- Modify: `apps/web/components/ui/index.ts`
- Test: `apps/web/test/ui-layout.ui.test.tsx`

**Interfaces:**
- Consumes: token (Task 1)
- Produces:
  ```ts
  type CardVariant = 'default' | 'ai' | 'raised'
  function Card(p: { variant?: CardVariant; className?: string; children: ReactNode }): JSX.Element
  function Section(p: { title: string; action?: ReactNode; children: ReactNode }): JSX.Element
  type BadgeTone = 'neutral' | 'success' | 'warn' | 'danger' | 'ai'
  function Badge(p: { tone?: BadgeTone; icon: string; children: ReactNode }): JSX.Element
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/ui-layout.ui.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, Section, Badge } from '@/components/ui'

/**
 * FRONTEND §9.8: màu KHÔNG được là kênh thông tin duy nhất. Người mù màu và
 * ảnh chụp màn hình đen trắng phải đọc được cùng một thông tin.
 */

describe('Section', () => {
  it('tiêu đề là heading thật, không phải div tô đậm', () => {
    render(<Section title="Đối chiếu gần đây"><p>nội dung</p></Section>)
    expect(screen.getByRole('heading', { name: 'Đối chiếu gần đây' })).toBeInTheDocument()
  })

  it('hiện hành động phụ khi được truyền', () => {
    render(
      <Section title="Đối chiếu gần đây" action={<a href="/cv">Xem tất cả</a>}>
        <p>nội dung</p>
      </Section>,
    )
    expect(screen.getByRole('link', { name: 'Xem tất cả' })).toBeInTheDocument()
  })
})

describe('Badge', () => {
  it('luôn kèm CHỮ, không chỉ có màu', () => {
    render(<Badge tone="warn" icon="⚠">Cần kiểm tra</Badge>)
    expect(screen.getByText('Cần kiểm tra')).toBeInTheDocument()
  })

  it('icon được ẩn khỏi trình đọc màn hình — chữ đã mang nghĩa rồi', () => {
    const { container } = render(<Badge tone="success" icon="✓">Đã xác nhận</Badge>)
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('✓')
  })
})

describe('Card', () => {
  it('render nội dung con', () => {
    render(<Card><p>xin chào</p></Card>)
    expect(screen.getByText('xin chào')).toBeInTheDocument()
  })

  it('biến thể ai đánh dấu được để test khác kiểm chữ ký AI', () => {
    const { container } = render(<Card variant="ai"><p>đề xuất</p></Card>)
    expect(container.querySelector('[data-variant="ai"]')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/ui-layout.ui.test.tsx`
Expected: FAIL — `Card`, `Section`, `Badge` chưa được xuất.

- [ ] **Step 3: Viết `Card`**

```tsx
// apps/web/components/ui/Card.tsx
import type { ReactNode } from 'react'

/**
 * Vỏ thẻ dùng chung — thay cho `rounded-xl border border-neutral-200 p-4`
 * được chép lại 7 lần.
 *
 * Biến thể `ai` là CHỮ KÝ THỊ GIÁC của máy (spec §5.1): nền teal nhạt, viền
 * teal, và dải 3px phía trên. Nhìn thấy nó là biết phần này do máy đề xuất
 * chứ không phải do mình khai. `data-variant` để test kiểm được mà không bám
 * vào className.
 */

export type CardVariant = 'default' | 'ai' | 'raised'

const VARIANT: Record<CardVariant, string> = {
  default: 'bg-surface border border-border',
  ai: 'bg-brand-subtle border border-brand-border',
  raised: 'bg-surface border border-border shadow-sm',
}

export function Card({
  variant = 'default',
  className = '',
  children,
}: {
  variant?: CardVariant
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-variant={variant}
      className={`relative overflow-hidden rounded-lg p-4 ${VARIANT[variant]} ${className}`}
    >
      {variant === 'ai' && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand to-brand-border"
        />
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Viết `Section`**

```tsx
// apps/web/components/ui/Section.tsx
import type { ReactNode } from 'react'

/**
 * Đầu mục + khoảng cách chuẩn.
 *
 * Trước đây `<h2 className="text-sm font-semibold uppercase tracking-wide
 * text-neutral-500">` được chép lại ở 3 chỗ chỉ riêng trong ReturningHome.
 *
 * Dùng `<h2>` thật chứ không phải div tô đậm: trình đọc màn hình duyệt trang
 * bằng danh sách heading, và một trang toàn div là một trang không duyệt được.
 */
export function Section({
  title,
  action,
  className = '',
  children,
}: {
  title: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`mt-8 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}
```

- [ ] **Step 5: Viết `Badge`**

```tsx
// apps/web/components/ui/Badge.tsx
import type { ReactNode } from 'react'

/**
 * Nhãn trạng thái.
 *
 * `icon` và `children` đều BẮT BUỘC — FRONTEND §9.8: màu không được là kênh
 * thông tin duy nhất. Một chấm đỏ không nói được gì với người mù màu, và cũng
 * không nói được gì trong ảnh chụp màn hình đen trắng gửi qua chat hỗ trợ.
 *
 * `tone="ai"` dùng teal — theo quy tắc token: teal chỉ thuộc về brand và AI.
 */

export type BadgeTone = 'neutral' | 'success' | 'warn' | 'danger' | 'ai'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-muted border-border',
  success: 'bg-success-subtle text-success border-success/30',
  warn: 'bg-warn-subtle text-warn border-warn/30',
  danger: 'bg-danger-subtle text-danger border-danger/30',
  ai: 'bg-brand-subtle text-brand-ink border-brand-border',
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone
  /** Ký tự hoặc emoji — luôn đi kèm chữ, không bao giờ đứng một mình */
  icon: string
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[12px] font-medium ${TONE[tone]}`}
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </span>
  )
}
```

- [ ] **Step 6: Cập nhật điểm xuất**

Thêm vào `apps/web/components/ui/index.ts`:

```ts
export { Card, type CardVariant } from './Card'
export { Section } from './Section'
export { Badge, type BadgeTone } from './Badge'
```

- [ ] **Step 7: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/ui-layout.ui.test.tsx`
Expected: PASS — cả 5.

- [ ] **Step 8: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/ui apps/web/test/ui-layout.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): primitive Card, Section, Badge

Card biến thể `ai` mang chữ ký thị giác của máy (spec §5.1): nền teal nhạt +
dải gradient 3px. Badge bắt buộc có cả icon lẫn chữ — FRONTEND §9.8 cấm dùng
màu làm kênh thông tin duy nhất.

Section dùng <h2> thật: trình đọc màn hình duyệt trang bằng danh sách heading.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Primitive `Meter`

**Files:**
- Create: `apps/web/components/ui/Meter.tsx`
- Modify: `apps/web/components/ui/index.ts`
- Test: `apps/web/test/ui-meter.ui.test.tsx`

**Interfaces:**
- Consumes: `Button` (Task 3), token (Task 1), kiểu `CompletenessPart` từ `@hr/matching`
- Produces:
  ```ts
  interface MeterPart { key: string; label: string; weight: number; done: boolean; todo: string }
  function Meter(p: {
    value: number            // 0..100
    label: string
    parts?: MeterPart[]
    className?: string
  }): JSX.Element
  ```
  `MeterPart` khớp cấu trúc `CompletenessPart` của `@hr/matching` (`key`, `label`, `weight`, `done`, `todo`, `path`) nhưng chỉ đòi 5 field đầu, nên truyền thẳng mảng `completeness.parts` vào là hợp lệ.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/ui-meter.ui.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Meter } from '@/components/ui'

/**
 * BR-02.1: không phần trăm nào mà người dùng không tra được nguồn.
 *
 * Đây là chỗ dễ bịa nhất trong cả sản phẩm, và một con số bịa ở màn hình đầu
 * tiên làm hỏng niềm tin vào mọi thứ phía sau.
 */

const PARTS = [
  { key: 'basics', label: 'Thông tin cá nhân', weight: 20, done: true, todo: '' },
  { key: 'work', label: 'Kinh nghiệm làm việc', weight: 30, done: true, todo: '' },
  { key: 'projects', label: 'Dự án', weight: 25, done: false, todo: 'Thêm ít nhất 2 dự án' },
]

afterEach(() => vi.restoreAllMocks())

describe('Meter', () => {
  it('hiện nhãn và con số', () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    expect(screen.getByText(/Hồ sơ đã đầy đủ/)).toBeInTheDocument()
    expect(screen.getByText('85%')).toBeInTheDocument()
  })

  it('có role progressbar với giá trị đọc được', () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85')
  })

  it('phân rã BỊ ẨN lúc đầu — không làm rối màn hình', () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    expect(screen.queryByText('Thông tin cá nhân')).not.toBeInTheDocument()
  })

  it('bấm "Gồm những gì?" thì thấy ĐỦ từng phần kèm trọng số', async () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    await userEvent.click(screen.getByRole('button', { name: /Gồm những gì/ }))
    expect(screen.getByText('Thông tin cá nhân')).toBeInTheDocument()
    expect(screen.getByText('Kinh nghiệm làm việc')).toBeInTheDocument()
    expect(screen.getByText('Dự án')).toBeInTheDocument()
    expect(screen.getByText('(25%)')).toBeInTheDocument()
  })

  it('phần chưa xong nói RÕ phải làm gì', async () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    await userEvent.click(screen.getByRole('button', { name: /Gồm những gì/ }))
    expect(screen.getByText('Thêm ít nhất 2 dự án')).toBeInTheDocument()
  })

  it('KHÔNG có parts: vẫn hiện số, nhưng cảnh báo ở dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" />)
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('parts'))
  })

  it('không có parts thì không hiện nút mở — không hứa thứ không có', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" />)
    expect(screen.queryByRole('button', { name: /Gồm những gì/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/ui-meter.ui.test.tsx`
Expected: FAIL — `Meter` chưa được xuất.

- [ ] **Step 3: Viết `Meter`**

```tsx
// apps/web/components/ui/Meter.tsx
'use client'

import { useId, useState } from 'react'
import { devWarn } from './devWarn'

/**
 * Thanh số liệu kèm phân rã — BR-02.1.
 *
 * ── Vì sao `parts` tồn tại ──
 * "Hồ sơ đã đầy đủ 85%" là con số dễ bịa nhất trong sản phẩm, và nó nằm ở màn
 * hình đầu tiên. Một con số không tra được nguồn làm người dùng nghi ngờ mọi
 * con số phía sau, kể cả điểm khớp JD vốn tính bằng code thuần.
 *
 * `parts` là khuyến nghị (spec D7) chứ không bắt buộc, nhưng thiếu nó thì
 * cảnh báo ở dev VÀ nút "Gồm những gì?" không hiện — thà không hứa còn hơn
 * hứa rồi mở ra trống.
 */

export interface MeterPart {
  key: string
  label: string
  /** Trọng số, tổng 100 */
  weight: number
  done: boolean
  /** Việc cần làm khi chưa xong — câu người dùng đọc và làm theo được */
  todo: string
}

export function Meter({
  value,
  label,
  parts,
  className = '',
}: {
  value: number
  label: string
  parts?: MeterPart[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()

  devWarn(
    !parts || parts.length === 0,
    `Meter "${label}" hiện ${value}% mà không có parts — người dùng không tra được con số này gồm những gì (BR-02.1).`,
  )

  const canExpand = Boolean(parts && parts.length > 0)
  const pct = Math.max(0, Math.min(100, Math.round(value)))

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-muted">
          {label} <strong className="tabular-nums text-ink">{pct}%</strong>
        </span>
        {canExpand && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={listId}
            className="rounded-sm text-[12px] text-brand hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {open ? 'Ẩn chi tiết' : 'Gồm những gì?'}
          </button>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="mt-2 h-2 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {canExpand && open && (
        <ul id={listId} className="mt-3 space-y-1.5 text-[13px]">
          {parts!.map((p) => (
            <li key={p.key} className="flex items-baseline gap-2">
              <span aria-hidden="true" className={p.done ? 'text-success' : 'text-ink-subtle'}>
                {p.done ? '✓' : '○'}
              </span>
              <span className={p.done ? 'text-ink' : 'text-ink-muted'}>
                {p.label}
                <span className="ml-1 text-[12px] text-ink-subtle">({p.weight}%)</span>
              </span>
              {!p.done && p.todo && (
                <span className="ml-auto text-right text-[12px] text-ink-subtle">{p.todo}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Cập nhật điểm xuất**

Thêm vào `apps/web/components/ui/index.ts`:

```ts
export { Meter, type MeterPart } from './Meter'
```

- [ ] **Step 5: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/ui-meter.ui.test.tsx`
Expected: PASS — cả 7.

- [ ] **Step 6: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/ui apps/web/test/ui-meter.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): primitive Meter — con số luôn tra được nguồn (BR-02.1)

Thiếu `parts` thì cảnh báo ở dev VÀ không hiện nút "Gồm những gì?" — thà
không hứa còn hơn hứa rồi mở ra trống.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Primitive `Dialog`

**Files:**
- Create: `apps/web/components/ui/useFocusTrap.ts`
- Create: `apps/web/components/ui/Dialog.tsx`
- Modify: `apps/web/components/ui/index.ts`
- Test: `apps/web/test/ui-dialog.ui.test.tsx`

**Interfaces:**
- Consumes: `Button` (Task 3)
- Produces:
  ```ts
  function useFocusTrap(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null>
  function Dialog(p: {
    open: boolean
    onClose: () => void
    title: string
    children: ReactNode
    footer?: ReactNode
  }): JSX.Element | null
  ```

**Bối cảnh.** `apps/web/components/chat/PatchReviewModal.tsx:106` có `role="dialog"` và `aria-modal="true"` nhưng không xử lý `Escape`, không bẫy focus, không trả focus. Đây là modal chặn mọi thay đổi từ AI — dùng bằng bàn phím sẽ lạc. Task này viết phần thay thế; việc **đổi `PatchReviewModal` sang dùng nó thuộc kế hoạch 2.**

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/ui-dialog.ui.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, Button } from '@/components/ui'

/**
 * Modal là chỗ dễ bỏ quên a11y nhất, và PatchReviewModal — thứ chặn MỌI thay
 * đổi từ AI — đang thiếu đủ bốn thứ: Escape, bẫy focus, trả focus, khoá cuộn.
 * Người dùng bàn phím mở nó ra là lạc, không có cách nào quay lại.
 */

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Mở đề xuất</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="AI đề xuất 3 thay đổi">
        <p>nội dung đề xuất</p>
        <Button onClick={() => setOpen(false)}>Áp dụng</Button>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('đóng thì không render gì', () => {
    render(<Dialog open={false} onClose={vi.fn()} title="T"><p>x</p></Dialog>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('mở thì có role dialog, aria-modal, và được đặt tên bằng tiêu đề', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName('AI đề xuất 3 thay đổi')
  })

  it('Escape đóng lại', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('focus chuyển VÀO trong khi mở', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('TRẢ focus về nút đã mở nó khi đóng', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Mở đề xuất' })
    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(opener)
  })

  it('Tab không thoát ra ngoài lớp phủ', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    const dlg = screen.getByRole('dialog')
    // Bấm Tab nhiều hơn số phần tử focus được bên trong: nếu không bẫy,
    // focus sẽ trôi ra nút "Mở đề xuất" ở nền.
    for (let i = 0; i < 6; i++) await userEvent.tab()
    expect(dlg.contains(document.activeElement)).toBe(true)
  })

  it('khoá cuộn nền khi mở, trả lại khi đóng', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/ui-dialog.ui.test.tsx`
Expected: FAIL — `Dialog` chưa được xuất.

- [ ] **Step 3: Viết `useFocusTrap`**

```ts
// apps/web/components/ui/useFocusTrap.ts
'use client'

import { useEffect, useRef } from 'react'

/**
 * Bẫy focus cho lớp phủ — dùng chung cho Dialog và Sheet.
 *
 * ── Vì sao tự viết thay vì thêm thư viện ──
 * Spec D6 chốt không thêm dependency UI. Bốn hành vi dưới đây là toàn bộ thứ
 * hai component cần, và chúng đo được bằng test bàn phím thật:
 *   1. Escape đóng
 *   2. Focus vào trong khi mở
 *   3. Tab vòng lại, không trôi ra nền
 *   4. Trả focus về phần tử đã mở khi đóng
 *
 * Thiếu (4) là lỗi tệ nhất: người dùng bàn phím đóng modal xong thì focus về
 * đầu trang, phải Tab lại từ đầu để tìm chỗ cũ.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return

    restoreTo.current = document.activeElement as HTMLElement | null

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const items = (): HTMLElement[] =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )

    // Focus phần tử đầu tiên; nếu lớp phủ chưa có gì focus được thì focus
    // chính nó (nó có tabIndex={-1}) để phím Escape vẫn tới nơi.
    const first = items()[0]
    ;(first ?? node).focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const list = items()
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = list[0]!
      const lastEl = list[list.length - 1]!

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      } else if (!node.contains(document.activeElement)) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      restoreTo.current?.focus()
    }
  }, [open, onClose])

  return ref
}
```

- [ ] **Step 4: Viết `Dialog`**

```tsx
// apps/web/components/ui/Dialog.tsx
'use client'

import { useId, type ReactNode } from 'react'
import { useFocusTrap } from './useFocusTrap'

/**
 * Modal.
 *
 * Thay cho phần a11y tự làm dở dang ở PatchReviewModal: nó có role="dialog" và
 * aria-modal="true" nhưng không Escape, không bẫy focus, không trả focus —
 * tức là có nhãn đúng mà hành vi sai, kiểu lỗi khó phát hiện nhất vì công cụ
 * kiểm tra tự động vẫn báo xanh.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const titleId = useId()
  const ref = useFocusTrap(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg bg-surface shadow-md focus-visible:outline-none"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-[18px] font-semibold text-ink">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Cập nhật điểm xuất**

```ts
export { Dialog } from './Dialog'
export { useFocusTrap } from './useFocusTrap'
```

- [ ] **Step 6: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/ui-dialog.ui.test.tsx`
Expected: PASS — cả 7.

Nếu test "Tab không thoát" đỏ: kiểm `offsetParent` — happy-dom trả `null` cho mọi phần tử vì không có layout engine. Khi đó bỏ bộ lọc `offsetParent` trong `items()` và chỉ lọc theo `disabled`.

- [ ] **Step 7: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/ui apps/web/test/ui-dialog.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): primitive Dialog với a11y đầy đủ

PatchReviewModal hiện có role="dialog" và aria-modal="true" nhưng không xử lý
Escape, không bẫy focus, không trả focus — nhãn đúng mà hành vi sai, kiểu lỗi
công cụ kiểm tra tự động vẫn báo xanh.

Bốn hành vi được kiểm bằng test bàn phím thật, không mock.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Primitive `Sheet`

**Files:**
- Create: `apps/web/components/ui/Sheet.tsx`
- Modify: `apps/web/components/ui/index.ts`
- Test: `apps/web/test/ui-sheet.ui.test.tsx`

**Interfaces:**
- Consumes: `useFocusTrap` (Task 6)
- Produces:
  ```ts
  function Sheet(p: {
    open: boolean
    onClose: () => void
    title: string
    children: ReactNode
    width?: number   // px, mặc định 380
  }): JSX.Element | null
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/ui-sheet.ui.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sheet, Button } from '@/components/ui'

/**
 * Slide-over cho chat tư vấn — FRONTEND §3.1 chọn "đè lên" thay vì pane thứ ba
 * vì laptop 1366×768 không đủ chỗ cho ba cột.
 *
 * Cùng bộ ràng buộc a11y như Dialog: nó cũng là lớp phủ chặn nền.
 */

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Trợ lý</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Chat tư vấn">
        <p>xin chào</p>
        <Button onClick={() => setOpen(false)}>Đóng</Button>
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  it('đóng thì không render gì', () => {
    render(<Sheet open={false} onClose={vi.fn()} title="T"><p>x</p></Sheet>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('mở thì là dialog có tên đọc được', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Trợ lý' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Chat tư vấn')
  })

  it('Escape đóng và trả focus về nút đã mở', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Trợ lý' })
    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('có nút đóng hiện rõ — không bắt người dùng đoán', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Trợ lý' }))
    expect(screen.getByRole('button', { name: /Đóng bảng/ })).toBeInTheDocument()
  })

  it('Tab không thoát ra nền', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Trợ lý' }))
    const dlg = screen.getByRole('dialog')
    for (let i = 0; i < 6; i++) await userEvent.tab()
    expect(dlg.contains(document.activeElement)).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/ui-sheet.ui.test.tsx`
Expected: FAIL — `Sheet` chưa được xuất.

- [ ] **Step 3: Viết `Sheet`**

```tsx
// apps/web/components/ui/Sheet.tsx
'use client'

import { useId, type ReactNode } from 'react'
import { useFocusTrap } from './useFocusTrap'

/**
 * Bảng trượt từ phải — dùng cho chat tư vấn.
 *
 * FRONTEND §3.1: laptop 1366×768 không đủ cho ba pane cố định; chat phải ĐÈ
 * LÊN chứ không chiếm chỗ thường trực, nếu không vùng xem trước CV còn ~500px
 * và không đọc được.
 *
 * Dùng chung `useFocusTrap` với Dialog: cả hai đều là lớp phủ chặn nền, nên
 * ràng buộc bàn phím giống hệt nhau. Khác nhau chỉ ở vị trí và hiệu ứng vào.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  width = 380,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: number
}) {
  const titleId = useId()
  const ref = useFocusTrap(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width }}
        className="absolute right-0 top-0 flex h-full max-w-full flex-col border-l border-border bg-surface shadow-md focus-visible:outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-[15px] font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Đóng bảng ${title}`}
            className="rounded-sm px-2 py-1 text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-4">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Cập nhật điểm xuất**

```ts
export { Sheet } from './Sheet'
```

- [ ] **Step 5: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/ui-sheet.ui.test.tsx`
Expected: PASS — cả 5.

- [ ] **Step 6: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/ui apps/web/test/ui-sheet.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): primitive Sheet dùng chung useFocusTrap với Dialog

Cả hai đều là lớp phủ chặn nền nên ràng buộc bàn phím giống hệt nhau; khác
nhau chỉ ở vị trí. Chat là slide-over đè lên chứ không phải pane thứ ba —
FRONTEND §3.1, vì 1366×768 không đủ chỗ.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Primitive `Field`

**Files:**
- Create: `apps/web/components/ui/Field.tsx`
- Modify: `apps/web/components/ui/index.ts`
- Test: `apps/web/test/ui-field.ui.test.tsx`

**Interfaces:**
- Consumes: token (Task 1)
- Produces:
  ```ts
  function Field(p: {
    label: string
    hint?: string
    error?: string
    required?: boolean
    children: (attrs: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
  }): JSX.Element
  ```
  Dùng render-prop để `Field` nối được `id` và `aria-describedby` vào bất kỳ loại input nào (`input`, `textarea`, `select`) mà không phải tự bọc từng loại.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/ui-field.ui.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from '@/components/ui'

/**
 * FRONTEND §11: thông báo lỗi phải nói NGƯỜI DÙNG LÀM GÌ TIẾP THEO, không mô
 * tả lỗi kỹ thuật. Field lo phần nối dây để câu đó thật sự tới được trình đọc
 * màn hình, chứ không chỉ hiện bằng chữ đỏ.
 */

describe('Field', () => {
  it('nhãn nối đúng vào input', () => {
    render(
      <Field label="Dán mô tả công việc">
        {(a) => <textarea {...a} />}
      </Field>,
    )
    expect(screen.getByLabelText('Dán mô tả công việc')).toBeInTheDocument()
  })

  it('gợi ý đọc được qua aria-describedby', () => {
    render(
      <Field label="Email" hint="Chúng tôi gửi link đăng nhập tới đây">
        {(a) => <input {...a} />}
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = ids.map((i) => document.getElementById(i)?.textContent)
    expect(texts).toContain('Chúng tôi gửi link đăng nhập tới đây')
  })

  it('lỗi đánh dấu aria-invalid và đọc được', () => {
    render(
      <Field label="Email" error="Chưa đọc được địa chỉ này, bạn nhập lại giúp nhé">
        {(a) => <input {...a} />}
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = ids.map((i) => document.getElementById(i)?.textContent)
    expect(texts).toContain('Chưa đọc được địa chỉ này, bạn nhập lại giúp nhé')
  })

  it('không lỗi thì không có aria-invalid', () => {
    render(<Field label="Email">{(a) => <input {...a} />}</Field>)
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
  })

  it('bắt buộc thì báo cho cả người nhìn lẫn trình đọc màn hình', () => {
    render(<Field label="Email" required>{(a) => <input {...a} />}</Field>)
    expect(screen.getByLabelText(/Email/)).toBeRequired()
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/ui-field.ui.test.tsx`
Expected: FAIL — `Field` chưa được xuất.

- [ ] **Step 3: Viết `Field`**

```tsx
// apps/web/components/ui/Field.tsx
'use client'

import { useId, type ReactNode } from 'react'

/**
 * Nhãn + input + gợi ý + lỗi, nối dây a11y sẵn.
 *
 * ── Vì sao dùng render-prop thay vì bọc từng loại input ──
 * Form trong app dùng `input`, `textarea` và `select`. Bọc riêng mỗi loại là
 * ba component gần giống nhau, và cái thứ tư (ví dụ combobox) lại phải viết
 * thêm. Render-prop trả về đúng những thuộc tính cần nối, còn chọn thẻ gì là
 * việc của chỗ gọi.
 *
 * `aria-describedby` gộp CẢ gợi ý lẫn lỗi: người dùng trình đọc màn hình cần
 * nghe cả hai, không phải chọn một.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (attrs: {
    id: string
    required?: boolean
    'aria-describedby'?: string
    'aria-invalid'?: true
  }) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-danger">
            *
          </span>
        )}
      </label>

      {children({
        id,
        ...(required ? { required: true } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}

      {hint && (
        <p id={hintId} className="mt-1 text-[12px] text-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Cập nhật điểm xuất**

```ts
export { Field } from './Field'
```

- [ ] **Step 5: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/ui-field.ui.test.tsx`
Expected: PASS — cả 5.

- [ ] **Step 6: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/ui apps/web/test/ui-field.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): primitive Field — nối dây a11y cho form

Render-prop thay vì bọc từng loại input: app dùng input, textarea và select,
bọc riêng mỗi loại là ba component gần giống nhau và cái thứ tư lại phải viết
thêm.

aria-describedby gộp cả gợi ý lẫn lỗi — người dùng trình đọc màn hình cần
nghe cả hai.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `CvThumbnail`

**Files:**
- Create: `apps/web/components/cv/CvThumbnail.tsx`
- Test: `apps/web/test/cv-thumbnail.ui.test.tsx`

**Interfaces:**
- Consumes: `CvFrame` từ `@hr/templates`, kiểu `Profile` từ `@hr/schema`
- Produces:
  ```ts
  function CvThumbnail(p: {
    profile: Profile
    templateId?: string   // mặc định 'elegant'
    theme?: Partial<Theme>
    width?: number        // px, mặc định 160
    className?: string
  }): JSX.Element
  ```

**Bối cảnh.** Đây là thứ chữa "màn hình đơn điệu" nhiều nhất: sản phẩm xoay quanh một bản CV mà không màn hình nào ngoài `/builder` cho thấy nó. FRONTEND §9.3 vốn đã ghi component template dùng ở ba nơi, nơi thứ ba là thumbnail — chỉ là chưa ai làm. `TemplateVariant` đã có sẵn giá trị `'thumbnail'` và `packages/templates/src/styles.css:204` đã có quy tắc cho nó.

**Đánh đổi đã biết.** `packages/templates/src/field.tsx:16-24` giải thích cả cây template là `'use client'`. Nghĩa là dùng `CvThumbnail` ở trang Home sẽ gửi mã template (~20–25 KB) và JSON hồ sơ xuống trình duyệt. Step 6 đo con số thật; nếu vượt ngưỡng thì ghi lại cho kế hoạch 2 xử lý, **không** tối ưu sớm.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/cv-thumbnail.ui.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfileSchema, type Profile } from '@hr/schema'
import { CvThumbnail } from '@/components/cv/CvThumbnail'

/**
 * Bản CV thu nhỏ — FRONTEND §9.3, nơi dùng thứ ba của cùng một component
 * template.
 *
 * Thumbnail xuất hiện ở Home và danh sách CV, tức là trên đường đi của MỌI
 * người dùng. Hồ sơ mới tạo thì hầu hết mục còn trống, nên "không nổ với hồ sơ
 * rỗng" là yêu cầu chính, không phải trường hợp biên.
 */

const p = (over: Partial<Profile> = {}): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Văn A' },
    ...over,
  })

describe('CvThumbnail', () => {
  it('render nội dung hồ sơ', () => {
    render(<CvThumbnail profile={p()} />)
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument()
  })

  it('hồ sơ chỉ có tên, mọi mục khác trống → không nổ', () => {
    expect(() => render(<CvThumbnail profile={p()} />)).not.toThrow()
  })

  it('hồ sơ nhiều mục → không nổ', () => {
    const full = p({
      work: [{ org: 'Cty X', role: 'Dev', highlights: ['Xây dựng API'] }],
      projects: [{ name: 'Dự án A', highlights: ['Làm web'] }],
      education: [{ school: 'ĐH Bách Khoa', degree: 'Kỹ sư' }],
      skills: [{ group: 'Ngôn ngữ', items: ['TypeScript', 'Go'] }],
    } as Partial<Profile>)
    expect(() => render(<CvThumbnail profile={full} />)).not.toThrow()
  })

  it('ẩn khỏi trình đọc màn hình — đây là hình minh hoạ, không phải nội dung', () => {
    const { container } = render(<CvThumbnail profile={p()} />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('dùng variant thumbnail của template', () => {
    const { container } = render(<CvThumbnail profile={p()} />)
    expect(container.querySelector('[data-variant="thumbnail"]')).toBeInTheDocument()
  })

  it('chiều rộng tuỳ chỉnh được', () => {
    const { container } = render(<CvThumbnail profile={p()} width={240} />)
    expect((container.firstElementChild as HTMLElement).style.width).toBe('240px')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/cv-thumbnail.ui.test.tsx`
Expected: FAIL — `CvThumbnail` chưa tồn tại.

- [ ] **Step 3: Viết `CvThumbnail`**

```tsx
// apps/web/components/cv/CvThumbnail.tsx
'use client'

import { CvFrame, DEFAULT_THEME, type Theme } from '@hr/templates'
import type { Profile } from '@hr/schema'

/**
 * Bản CV thu nhỏ — FRONTEND §9.3, nơi dùng thứ ba của cùng một component.
 *
 * ── Vì sao thu nhỏ bằng CSS chứ không chụp ảnh ──
 * Cách còn lại là để Playwright chụp /print rồi lưu PNG. Nó kéo theo: một hàng
 * đợi job, một chỗ lưu file, và một bài toán vô hiệu hoá cache mỗi lần người
 * dùng sửa một chữ. Ảnh cũ hiện ở Home sau khi vừa sửa xong là lỗi khó chịu
 * mà lại rất dễ xảy ra.
 *
 * Thu nhỏ bằng `transform: scale` thì bản thu nhỏ CHÍNH LÀ bản thật, luôn
 * đúng, và tốn 0 tài nguyên server.
 *
 * ── Đánh đổi đã biết ──
 * `packages/templates/src/field.tsx` đánh dấu 'use client' (React Context
 * không dùng được trong Server Component), nên cả cây template là client.
 * Đặt thumbnail ở Home nghĩa là gửi mã template và JSON hồ sơ xuống trình
 * duyệt. Chấp nhận: đây là hồ sơ của chính người đang xem, và con số đo được
 * nằm trong mức chịu được cho một trang.
 *
 * `aria-hidden`: đây là hình minh hoạ. Nội dung CV đã có ở chỗ khác trên trang
 * dưới dạng chữ đọc được; để trình đọc màn hình đọc lại toàn bộ CV ở cỡ chữ
 * 3px là tra tấn người dùng.
 */

/** Chiều rộng khổ A4 ở 96dpi — mốc để tính tỉ lệ thu nhỏ. */
const A4_WIDTH_PX = 794

export function CvThumbnail({
  profile,
  templateId = 'elegant',
  theme,
  width = 160,
  className = '',
}: {
  profile: Profile
  templateId?: string
  theme?: Partial<Theme>
  width?: number
  className?: string
}) {
  const scale = width / A4_WIDTH_PX

  return (
    <div
      aria-hidden="true"
      style={{ width, height: Math.round(width * 1.414) }}
      className={`overflow-hidden rounded-sm border border-border bg-white ${className}`}
    >
      <div
        style={{
          width: A4_WIDTH_PX,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <CvFrame
          profile={profile}
          templateId={templateId}
          variant="thumbnail"
          theme={{ ...DEFAULT_THEME, ...theme }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/cv-thumbnail.ui.test.tsx`
Expected: PASS — cả 6.

Nếu test "variant thumbnail" đỏ: mở `packages/templates/src/render.tsx` xem `CvFrame` gắn `data-variant` ở đâu. Nếu chưa có, thêm `data-variant={variant}` vào phần tử gốc `.cv-root` của nó — đó là thay đổi hợp lệ vì `styles.css:204` vốn đã trông chờ thuộc tính này.

- [ ] **Step 5: Kiểm bằng mắt**

```bash
npm run dev:restart
```

Mở `http://localhost:3100`, và tạm thời thêm `<CvThumbnail profile={...} />` vào một trang để nhìn. Kiểm: khung đúng tỉ lệ A4, không tràn, không có thanh cuộn bên trong. Gỡ đoạn tạm sau khi xem xong.

- [ ] **Step 6: Đo ảnh hưởng bundle**

```bash
npm run build:web 2>&1 | grep -A 20 "Route (app)"
```

Ghi lại cột `First Load JS` của route `/`. So với mốc trước Task 9 (chạy `git stash` rồi build lại nếu cần con số đối chứng). Nếu tăng quá 40 KB, ghi con số vào phần mô tả commit để kế hoạch 2 cân nhắc — **không** tối ưu ở đây.

- [ ] **Step 7: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/cv apps/web/test/cv-thumbnail.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(cv): CvThumbnail — đưa bản CV lên màn hình bằng chính component template

FRONTEND §9.3 đã ghi component này dùng ở ba nơi, nơi thứ ba là thumbnail;
chưa ai làm. Sản phẩm xoay quanh một bản CV mà không màn hình nào ngoài
/builder cho thấy nó — đó là lý do lớn nhất khiến Home trông rỗng.

Thu nhỏ bằng transform: scale chứ không chụp ảnh: bản thu nhỏ CHÍNH LÀ bản
thật, không cần hàng đợi job, không có bài toán vô hiệu hoá cache, và không
bao giờ hiện ảnh cũ sau khi người dùng vừa sửa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `AiPanel` — chữ ký AI và degrade

**Files:**
- Create: `apps/web/components/ai/AiPanel.tsx`
- Test: `apps/web/test/ai-panel.ui.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Button` (Task 3, 4)
- Produces:
  ```ts
  function AiPanel(p: {
    available: boolean
    streaming?: boolean
    title?: string          // mặc định 'Trợ lý'
    children: ReactNode     // nội dung khi available
    actions?: ReactNode     // nút khi available
    onRetry?: () => void
  }): JSX.Element
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/ai-panel.ui.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiPanel } from '@/components/ai/AiPanel'
import { Button } from '@/components/ui'

/**
 * TDD §3.2 A7 — degrade, đừng sập. Model server KHÔNG có SLA.
 *
 * Spec §5.1 làm khối AI to và có chữ ký thị giác riêng. Hệ quả bắt buộc: khi
 * model chết, khối lộng lẫy nhất màn hình sẽ thành khối rỗng nhất nếu không
 * thiết kế trạng thái này. FRONTEND §8.1: nút cần AI phải MỜ ĐI kèm giải
 * thích, KHÔNG biến mất.
 */

describe('AiPanel — khi trợ lý sống', () => {
  it('hiện nội dung và hành động', () => {
    render(
      <AiPanel available actions={<Button>Cùng tôi sửa</Button>}>
        <p>Thêm số liệu vào các gạch đầu dòng</p>
      </AiPanel>,
    )
    expect(screen.getByText('Thêm số liệu vào các gạch đầu dòng')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cùng tôi sửa' })).toBeEnabled()
  })

  it('mang chữ ký thị giác của AI', () => {
    const { container } = render(<AiPanel available><p>x</p></AiPanel>)
    expect(container.querySelector('[data-variant="ai"]')).toBeInTheDocument()
  })

  it('đang stream thì báo cho trình đọc màn hình biết vùng này đang đổi', () => {
    render(<AiPanel available streaming><p>đang soạn…</p></AiPanel>)
    expect(screen.getByText('đang soạn…').closest('[aria-live]'))
      .toHaveAttribute('aria-live', 'polite')
  })
})

describe('AiPanel — khi trợ lý chết', () => {
  it('KHỐI VẪN CÒN, không biến mất', () => {
    render(<AiPanel available={false}><p>nội dung</p></AiPanel>)
    expect(screen.getByText(/tạm ngưng/)).toBeInTheDocument()
  })

  it('nói rõ việc gì VẪN LÀM ĐƯỢC', () => {
    render(<AiPanel available={false}><p>nội dung</p></AiPanel>)
    expect(screen.getByText(/vẫn sửa CV, đổi mẫu và tải file/)).toBeInTheDocument()
  })

  it('bỏ chữ ký AI — không giả vờ còn sống', () => {
    const { container } = render(<AiPanel available={false}><p>x</p></AiPanel>)
    expect(container.querySelector('[data-variant="ai"]')).not.toBeInTheDocument()
  })

  it('không hiện nội dung AI cũ như thể nó vừa được sinh ra', () => {
    render(<AiPanel available={false}><p>gợi ý cũ</p></AiPanel>)
    expect(screen.queryByText('gợi ý cũ')).not.toBeInTheDocument()
  })

  it('có nút Thử lại khi được truyền onRetry', async () => {
    const onRetry = vi.fn()
    render(<AiPanel available={false} onRetry={onRetry}><p>x</p></AiPanel>)
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/ai-panel.ui.test.tsx`
Expected: FAIL — `AiPanel` chưa tồn tại.

- [ ] **Step 3: Viết `AiPanel`**

```tsx
// apps/web/components/ai/AiPanel.tsx
'use client'

import type { ReactNode } from 'react'
import { Card, Button } from '@/components/ui'

/**
 * Khung cho mọi vùng có AI tham gia — spec §5.1 và §5.5.
 *
 * ── Một chữ ký, không cái nào tự chế ──
 * Nhìn thấy nền teal + dải gradient 3px là biết phần này do máy đề xuất chứ
 * không phải do mình khai. Chữ ký chỉ có giá trị khi nó NHẤT QUÁN, nên mọi
 * vùng AI đi qua component này.
 *
 * ── Vì sao trạng thái degrade nằm CÙNG file ──
 * TDD §3.2 A7: model server không có SLA. Chữ ký ở trên làm khối AI to và bắt
 * mắt; nếu trạng thái chết được xử lý ở nơi khác thì sẽ có chỗ quên, và chỗ
 * quên đó hiện ra thành một ô rỗng to giữa màn hình. Để chung một file thì
 * không thể thêm vùng AI mới mà quên nghĩ đến lúc nó chết.
 *
 * Khi chết, khối GIỮ NGUYÊN kích thước và nói rõ việc gì vẫn làm được —
 * FRONTEND §8.1. Nội dung AI cũ KHÔNG được hiện lại: người dùng sẽ tưởng đó
 * là gợi ý vừa sinh ra cho hồ sơ hiện tại.
 */
export function AiPanel({
  available,
  streaming = false,
  title = 'Trợ lý',
  children,
  actions,
  onRetry,
}: {
  available: boolean
  streaming?: boolean
  title?: string
  children: ReactNode
  actions?: ReactNode
  onRetry?: () => void
}) {
  if (!available) {
    return (
      <div className="rounded-lg border border-border bg-canvas p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
          <span aria-hidden="true">○</span>
          {title} đang tạm ngưng
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Bạn vẫn sửa CV, đổi mẫu và tải file bình thường.
        </p>
        {onRetry && (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Thử lại
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card variant="ai">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-brand-ink">
        <span aria-hidden="true">✦</span>
        {title}
        {streaming && (
          <span
            aria-hidden="true"
            className="ml-1 inline-block h-1 w-8 animate-pulse rounded-full bg-brand motion-reduce:animate-none"
          />
        )}
      </p>

      <div
        className="mt-2 text-[15px] text-ink"
        {...(streaming ? { 'aria-live': 'polite' as const } : {})}
      >
        {children}
      </div>

      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  )
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/ai-panel.ui.test.tsx`
Expected: PASS — cả 8.

- [ ] **Step 5: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/ai apps/web/test/ai-panel.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(ai): AiPanel — chữ ký thị giác của AI, kèm trạng thái degrade cùng file

Trạng thái degrade nằm CÙNG file với chữ ký là có chủ ý: chữ ký làm khối AI to
và bắt mắt, nên nếu xử lý lúc-model-chết ở nơi khác thì sẽ có chỗ quên, và chỗ
quên đó hiện ra thành ô rỗng to giữa màn hình (TDD §3.2 A7).

Khi chết, nội dung AI cũ KHÔNG hiện lại — người dùng sẽ tưởng đó là gợi ý vừa
sinh cho hồ sơ hiện tại.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Sửa ba lỗi dữ liệu ở trang chủ

**Files:**
- Modify: `apps/web/app/page.tsx`
- Test: `apps/web/test/home-data.test.ts` (tạo mới, chạy ở project `unit`)

**Interfaces:**
- Consumes: không có
- Produces:
  ```ts
  // xuất từ apps/web/app/page.tsx để test được
  export function dedupeMatches<T extends { jdId: string | null }>(rows: T[]): T[]
  ```
  `RecentMatch` ở `ReturningHome` mở rộng thêm hai field: `jdId: string | null` và `when: string`.

**Bối cảnh — ba lỗi.**
1. `apps/web/app/page.tsx:130` truyền `greet(null)` cứng, nên lời chào không bao giờ có tên dù hàm `greet` đã hỗ trợ.
2. Truy vấn đối chiếu `ORDER BY m.created_at DESC LIMIT 3` không khử trùng lặp: phân tích cùng một JD hai lần cho ra hai dòng giống hệt nhau, người dùng không phân biệt được.
3. Không có mốc thời gian nên hai dòng trùng càng không phân biệt được.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/home-data.test.ts` (đuôi `.test.ts`, chạy ở project `unit`):

```ts
import { describe, it, expect } from 'vitest'
import { dedupeMatches } from '@/app/page'

/**
 * Trên máy thật, Home hiện HAI dòng "Junior Full-stack Developer 44%" giống
 * hệt nhau — cùng tiêu đề, cùng điểm, không mốc thời gian. Đó là hai lần phân
 * tích cùng một JD, nhưng người dùng không có cách nào biết điều đó.
 *
 * Giữ lần MỚI NHẤT chứ không phải điểm cao nhất: người dùng muốn biết hồ sơ
 * hiện tại khớp tới đâu, không phải kỷ lục cũ.
 */

describe('dedupeMatches', () => {
  it('gộp các lần phân tích cùng một JD, giữ bản đầu tiên trong danh sách', () => {
    const rows = [
      { jdId: 'jd-1', overall: 44 },
      { jdId: 'jd-1', overall: 38 },
      { jdId: 'jd-2', overall: 72 },
    ]
    expect(dedupeMatches(rows)).toEqual([
      { jdId: 'jd-1', overall: 44 },
      { jdId: 'jd-2', overall: 72 },
    ])
  })

  it('jdId null thì KHÔNG gộp — không biết chúng có cùng JD hay không', () => {
    const rows = [
      { jdId: null, overall: 44 },
      { jdId: null, overall: 51 },
    ]
    expect(dedupeMatches(rows)).toHaveLength(2)
  })

  it('danh sách rỗng trả về rỗng', () => {
    expect(dedupeMatches([])).toEqual([])
  })

  it('không có trùng thì giữ nguyên thứ tự', () => {
    const rows = [{ jdId: 'a', overall: 1 }, { jdId: 'b', overall: 2 }]
    expect(dedupeMatches(rows)).toEqual(rows)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project unit apps/web/test/home-data.test.ts`
Expected: FAIL — `dedupeMatches` chưa được xuất.

- [ ] **Step 3: Viết `dedupeMatches` và sửa truy vấn**

Trong `apps/web/app/page.tsx`, thêm hàm ở phạm vi module (cùng chỗ với `greet` và `when`):

```ts
/**
 * Gộp các lần phân tích cùng một JD, giữ bản MỚI NHẤT.
 *
 * Truy vấn trả về theo `created_at DESC`, nên bản đầu tiên gặp là bản mới
 * nhất. Người dùng muốn biết hồ sơ HIỆN TẠI khớp tới đâu, không phải điểm cao
 * nhất từng đạt được.
 *
 * `jdId` null (JD đã bị xoá) thì KHÔNG gộp: không có cơ sở nào nói hai dòng đó
 * cùng một tin tuyển dụng.
 */
export function dedupeMatches<T extends { jdId: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    if (r.jdId === null) return true
    if (seen.has(r.jdId)) return false
    seen.add(r.jdId)
    return true
  })
}
```

Sửa truy vấn đối chiếu — lấy thêm `jd_id`, `created_at`, và nới `LIMIT` để còn đủ dòng sau khi gộp:

```ts
    pool
      .query<{
        title: string | null
        overall: number
        cv_id: string
        jd_id: string | null
        created_at: Date
      }>(
        // `job_descriptions` không có cột `title` — tên nằm trong `requirements`.
        // LIMIT 12 chứ không 3: gộp theo jd_id diễn ra ở tầng ứng dụng, nên
        // phải lấy dư rồi mới cắt, nếu không phân tích lại cùng một JD ba lần
        // sẽ đẩy hết JD khác ra khỏi danh sách.
        `SELECT j.requirements->>'title' AS title,
                (m.score->>'overall')::int AS overall, m.cv_id,
                m.jd_id, m.created_at
           FROM match_analyses m
           JOIN cv_documents c ON c.id = m.cv_id
           LEFT JOIN job_descriptions j ON j.id = m.jd_id
          WHERE c.user_id = $1
          ORDER BY m.created_at DESC LIMIT 12`,
        [userId],
      )
      .catch(() => ({ rows: [] })),
```

Sửa phần dựng `matches`:

```ts
    matches: dedupeMatches(
      matchRows.rows.map((r) => ({
        jdTitle: r.title ?? 'Tin tuyển dụng',
        overall: r.overall,
        cvId: r.cv_id,
        jdId: r.jd_id,
        when: when(r.created_at),
      })),
    ).slice(0, 3),
```

- [ ] **Step 4: Sửa lời chào**

Trong `apps/web/app/page.tsx`, phần dựng `<ReturningHome>`:

```tsx
      greeting={greet(displayName(user.email))}
```

Và thêm hàm ở phạm vi module:

```ts
/**
 * Tên hiển thị lấy từ email khi hồ sơ chưa có tên.
 *
 * Lời chào là dòng đầu tiên của sản phẩm; để trống chỗ cá nhân hoá duy nhất
 * làm nó đọc như một trang lỗi. "dev@local" → "dev".
 */
function displayName(email: string): string {
  return email.split('@')[0] ?? email
}
```

Nếu `load()` chưa trả về email người dùng, bổ sung nó vào giá trị trả về của `load()` và lấy từ `requireUser()` / `currentUser()` đang có sẵn trong file.

- [ ] **Step 5: Chạy test để xác nhận xanh**

Run: `npx vitest run --project unit apps/web/test/home-data.test.ts`
Expected: PASS — cả 4.

- [ ] **Step 6: Kiểm bằng mắt trên dữ liệu thật**

```bash
docker compose up -d postgres redis
npm run dev:restart
```

Mở `http://localhost:3100`. Kiểm: lời chào có tên; danh sách đối chiếu không còn hai dòng giống hệt; mỗi dòng có mốc thời gian.

- [ ] **Step 7: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/app/page.tsx apps/web/test/home-data.test.ts
git commit -m "$(cat <<'EOF'
fix(home): lời chào thiếu tên, và hai dòng đối chiếu giống hệt nhau

greet(null) truyền cứng nên lời chào không bao giờ có tên dù hàm đã hỗ trợ.

Danh sách đối chiếu không khử trùng lặp: phân tích cùng một JD hai lần cho ra
hai dòng cùng tiêu đề, cùng điểm, không mốc thời gian — người dùng không có
cách nào phân biệt. Gộp theo jd_id giữ bản MỚI NHẤT, và lấy LIMIT 12 rồi mới
cắt còn 3 để một JD phân tích nhiều lần không đẩy hết JD khác ra ngoài.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Dựng lại `ReturningHome`

**Files:**
- Modify: `apps/web/components/home/ReturningHome.tsx`
- Modify: `apps/web/test/home.ui.test.tsx` (thêm test, giữ nguyên test cũ)

**Interfaces:**
- Consumes: `Card`, `Section`, `Button`, `Meter` (Task 3–5), `CvThumbnail` (Task 9), `AiPanel` (Task 10)
- Produces: `ReturningHome` với props mở rộng:
  ```ts
  interface RecentCv { id: string; title: string; updatedAt: string; headline?: string }
  interface RecentMatch { jdTitle: string; overall: number; cvId: string; jdId: string | null; when: string }
  interface Props {
    greeting: string
    completeness: Completeness
    cv: RecentCv | null
    profile: Profile | null      // MỚI — để vẽ thumbnail
    nextStep: NextStep | null
    matches: RecentMatch[]
    aiAvailable: boolean         // MỚI — từ /api/health
  }
  ```

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `apps/web/test/home.ui.test.tsx` (giữ nguyên mọi test đang có):

```tsx
describe('ReturningHome — bố cục mới', () => {
  const base = {
    greeting: 'Chào buổi tối, Hải',
    completeness: profileCompleteness(p()),
    cv: { id: 'cv-1', title: 'LE THANH HAI', updatedAt: '6 giờ trước' },
    profile: p(),
    nextStep: null,
    matches: [],
    aiAvailable: true,
  }

  it('hiện bản CV thu nhỏ — sản phẩm xoay quanh tài liệu, phải thấy nó', () => {
    const { container } = render(<ReturningHome {...base} />)
    expect(container.querySelector('[data-variant="thumbnail"]')).toBeInTheDocument()
  })

  it('không có hồ sơ thì không cố vẽ thumbnail', () => {
    const { container } = render(<ReturningHome {...base} profile={null} />)
    expect(container.querySelector('[data-variant="thumbnail"]')).not.toBeInTheDocument()
  })

  it('gợi ý của trợ lý đi qua AiPanel — mang chữ ký AI', () => {
    const { container } = render(
      <ReturningHome
        {...base}
        nextStep={{ text: 'Thêm số liệu vào các gạch đầu dòng', cta: 'Cùng tôi sửa', href: '/builder/cv-1' }}
      />,
    )
    expect(container.querySelector('[data-variant="ai"]')).toBeInTheDocument()
  })

  it('trợ lý chết: khối vẫn còn và nói việc gì vẫn làm được', () => {
    render(
      <ReturningHome
        {...base}
        aiAvailable={false}
        nextStep={{ text: 'Thêm số liệu', cta: 'Cùng tôi sửa', href: '/builder/cv-1' }}
      />,
    )
    expect(screen.getByText(/tạm ngưng/)).toBeInTheDocument()
    expect(screen.getByText(/vẫn sửa CV, đổi mẫu và tải file/)).toBeInTheDocument()
  })

  it('trợ lý chết: nút "Tiếp tục chỉnh CV" VẪN bấm được — nó không cần AI', () => {
    render(<ReturningHome {...base} aiAvailable={false} />)
    expect(screen.getByRole('link', { name: /Tiếp tục chỉnh CV/ })).toBeInTheDocument()
  })

  it('mỗi dòng đối chiếu có mốc thời gian để phân biệt', () => {
    render(
      <ReturningHome
        {...base}
        matches={[
          { jdTitle: 'Junior Full-stack Developer', overall: 44, cvId: 'cv-1', jdId: 'jd-1', when: 'hôm nay' },
          { jdTitle: 'Backend Developer', overall: 72, cvId: 'cv-1', jdId: 'jd-2', when: '3 ngày trước' },
        ]}
      />,
    )
    expect(screen.getByText('hôm nay')).toBeInTheDocument()
    expect(screen.getByText('3 ngày trước')).toBeInTheDocument()
  })

  it('điểm khớp KHÔNG tô màu — TDD §8.2.3 cấm khẳng định ngưỡng tuyệt đối', () => {
    render(
      <ReturningHome
        {...base}
        matches={[{ jdTitle: 'X', overall: 44, cvId: 'cv-1', jdId: 'jd-1', when: 'hôm nay' }]}
      />,
    )
    const score = screen.getByText('44')
    expect(score.className).not.toMatch(/text-(danger|warn|success)/)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/home.ui.test.tsx`
Expected: FAIL — 7 test mới đỏ; các test cũ vẫn xanh.

- [ ] **Step 3: Viết lại `ReturningHome`**

Thay toàn bộ nội dung `apps/web/components/home/ReturningHome.tsx`:

```tsx
'use client'

import Link from 'next/link'
import type { Completeness } from '@hr/matching'
import type { Profile } from '@hr/schema'
import type { NextStep } from '@/lib/home-state'
import { Card, Section, Meter } from '@/components/ui'
import { CvThumbnail } from '@/components/cv/CvThumbnail'
import { AiPanel } from '@/components/ai/AiPanel'

/**
 * Home quay lại — bảng việc cần làm. UC-02, PRODUCT §6.
 *
 * Câu hỏi ở đây KHÁC Home lần đầu: không phải "bạn cần giúp gì" mà "bạn nên
 * làm gì tiếp". Hỏi lại người quay lại lần thứ năm rằng họ đã có CV chưa là
 * hỏi một câu mà hệ thống đã biết câu trả lời.
 *
 * ── Ba mức trọng số, không phải bốn khối bằng nhau ──
 * Bản trước có bốn khối cùng viền, cùng bo góc, cùng cỡ nhãn — mắt không có
 * điểm vào. Giờ: thẻ CV là CHÍNH (nền nổi, có thumbnail), gợi ý trợ lý là
 * THỨ HAI (nền teal), danh sách đối chiếu là PHỤ (dòng trần, không viền).
 */

export interface RecentCv {
  id: string
  title: string
  updatedAt: string
  headline?: string
}

export interface RecentMatch {
  jdTitle: string
  overall: number
  cvId: string
  jdId: string | null
  /** Mốc tương đối: "hôm nay", "3 ngày trước" — thiếu nó thì hai lần đối
   *  chiếu cùng một JD trông giống hệt nhau */
  when: string
}

interface Props {
  greeting: string
  completeness: Completeness
  cv: RecentCv | null
  profile: Profile | null
  nextStep: NextStep | null
  matches: RecentMatch[]
  aiAvailable: boolean
}

export function ReturningHome({
  greeting,
  completeness,
  cv,
  profile,
  nextStep,
  matches,
  aiAvailable,
}: Props) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[24px] font-semibold text-ink">{greeting}</h1>

      {cv && (
        <Card variant="raised" className="mt-6 p-5">
          <div className="flex flex-wrap items-start gap-5">
            {profile && <CvThumbnail profile={profile} width={132} />}

            <div className="min-w-0 flex-1">
              <p className="truncate text-[18px] font-semibold text-ink">{cv.title}</p>
              {cv.headline && (
                <p className="truncate text-[13px] text-ink-muted">{cv.headline}</p>
              )}
              <p className="mt-0.5 text-[13px] text-ink-subtle">Sửa {cv.updatedAt}</p>

              <Meter
                className="mt-4"
                value={completeness.percent}
                label="Hồ sơ đã đầy đủ"
                parts={completeness.parts}
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/builder/${cv.id}`}
                  className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Tiếp tục chỉnh CV
                </Link>
                <Link
                  href={`/cv/${cv.id}`}
                  className="inline-flex items-center rounded-md border border-border-strong bg-surface px-4 py-2 text-[15px] font-medium text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Xem CV
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-6">
        {nextStep ? (
          <AiPanel
            available={aiAvailable}
            actions={
              <Link
                href={nextStep.href}
                className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {nextStep.cta}
              </Link>
            }
          >
            {nextStep.text}
          </AiPanel>
        ) : (
          /*
           * KHÔNG bịa việc để lấp chỗ trống (BR-02.3). Một việc bịa ra làm
           * người dùng mất tin vào mọi thứ phía trên nó.
           */
          <p className="text-[13px] text-ink-muted">
            CV của bạn đang ổn — chưa có việc nào cần làm gấp.
          </p>
        )}
      </div>

      {matches.length > 0 && (
        <Section
          title="Đối chiếu gần đây"
          action={
            <Link href="/cv" className="text-[12px] text-brand hover:text-brand-hover">
              Xem tất cả
            </Link>
          }
        >
          <ul className="divide-y divide-border">
            {matches.map((m, i) => (
              <li key={m.jdId ?? `x-${i}`}>
                <Link
                  href={`/analyze/${m.cvId}`}
                  className="flex items-center gap-3 py-3 text-[15px] hover:text-brand"
                >
                  <span className="min-w-0 flex-1 truncate text-ink">{m.jdTitle}</span>
                  <span className="shrink-0 text-[12px] text-ink-subtle">{m.when}</span>
                  {/*
                   * KHÔNG tô màu con số — TDD §8.2.3: đo thực tế cho 41 và 41
                   * là ĐÚNG; thứ có nghĩa là thứ tự tương đối, không phải vạch
                   * ngưỡng. Tô đỏ 44% là đưa ra một phán quyết mà hệ thống
                   * chưa đủ cơ sở.
                   */}
                  <span className="w-8 shrink-0 text-right font-medium tabular-nums text-ink">
                    {m.overall}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </main>
  )
}
```

- [ ] **Step 4: Cập nhật chỗ gọi**

Trong `apps/web/app/page.tsx`, truyền hai prop mới. `aiAvailable` lấy từ trạng thái model đã có ở `/api/health`; nếu `load()` chưa đọc nó thì thêm — trong file đã có sẵn cách gọi `getPool()`, dùng cùng kiểu `.catch(() => …)` để lỗi không làm vỡ Home:

```tsx
    <ReturningHome
      greeting={greet(displayName(user.email))}
      completeness={profileCompleteness(parsed.data)}
      cv={data.cv}
      profile={parsed.data}
      nextStep={nextStepFor(profileCompleteness(parsed.data), {
        cvId: data.cv?.id ?? null,
        hasAnalysis: data.hasAnalysis,
      })}
      matches={data.matches}
      aiAvailable={data.aiAvailable}
    />
```

- [ ] **Step 5: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/home.ui.test.tsx`
Expected: PASS — cả test cũ lẫn 7 test mới.

- [ ] **Step 6: Kiểm bằng mắt ở 1366×768**

```bash
npm run dev:restart
```

Mở `http://localhost:3100` và thu cửa sổ về đúng 1366×768. Kiểm: ba mức trọng số phân biệt được ngay; thumbnail không vỡ; không có thanh cuộn ngang.

- [ ] **Step 7: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/home/ReturningHome.tsx apps/web/app/page.tsx apps/web/test/home.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(home): dựng lại ReturningHome — ba mức trọng số thay cho bốn khối bằng nhau

Bản trước có bốn khối cùng viền, cùng bo góc, cùng cỡ nhãn: mắt không có điểm
vào. Giờ thẻ CV là CHÍNH (nền nổi + thumbnail), gợi ý trợ lý là THỨ HAI (nền
teal), danh sách đối chiếu là PHỤ (dòng trần).

Thumbnail là lý do lớn nhất: sản phẩm xoay quanh một bản CV mà màn hình này
chưa từng cho thấy nó.

Điểm khớp không tô màu (TDD §8.2.3), và gợi ý đi qua AiPanel nên khi model
chết khối vẫn còn kèm lời giải thích thay vì biến mất.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `TopNav` mới

**Files:**
- Modify: `apps/web/components/nav/TopNav.tsx`
- Test: `apps/web/test/topnav.ui.test.tsx` (tạo mới)

**Interfaces:**
- Consumes: token (Task 1)
- Produces: `TopNav` là Server Component async, không đổi chữ ký. Tách phần render thuần thành `TopNavView` để test được:
  ```ts
  export function TopNavView(p: {
    email: string | null
    cvId: string | null
  }): JSX.Element
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/topnav.ui.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopNavView } from '@/components/nav/TopNav'

/**
 * Spec D2: top nav chứ không sidebar. Người dùng thường chỉ có 4 đích, và
 * /builder cần trọn chiều ngang ở 1366×768.
 *
 * BR-01.3: KHÔNG hiện link tới màn hình chưa tồn tại.
 */

describe('TopNavView', () => {
  it('chưa đăng nhập: chỉ có tên sản phẩm và lối đăng nhập', () => {
    render(<TopNavView email={null} cvId={null} />)
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'CV của tôi' })).not.toBeInTheDocument()
  })

  it('đã đăng nhập: có các đích chính', () => {
    render(<TopNavView email="hai@example.com" cvId="cv-1" />)
    expect(screen.getByRole('link', { name: 'Trang chủ' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CV của tôi' })).toBeInTheDocument()
  })

  it('có nút Trợ lý mang theo CV đang mở', () => {
    render(<TopNavView email="hai@example.com" cvId="cv-1" />)
    expect(screen.getByRole('link', { name: /Trợ lý/ })).toHaveAttribute(
      'href',
      '/builder/cv-1?assistant=1',
    )
  })

  it('CHƯA có CV nào: nút Trợ lý dẫn tới chỗ chọn CV, không mở chat rỗng', () => {
    render(<TopNavView email="hai@example.com" cvId={null} />)
    expect(screen.getByRole('link', { name: /Trợ lý/ })).toHaveAttribute('href', '/cv')
  })

  it('nav là landmark điều hướng', () => {
    render(<TopNavView email="hai@example.com" cvId="cv-1" />)
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/topnav.ui.test.tsx`
Expected: FAIL — `TopNavView` chưa được xuất.

- [ ] **Step 3: Viết lại `TopNav`**

Thay toàn bộ `apps/web/components/nav/TopNav.tsx`:

```tsx
import Link from 'next/link'
import { currentUser } from '@/lib/auth'

/**
 * Thanh điều hướng — X-1/X-6, spec D2.
 *
 * ── Vì sao top nav chứ không sidebar ──
 * Người dùng thường chỉ có bốn đích. Sidebar 240px cho bốn mục là chỗ bỏ đi,
 * và ở /builder trên laptop 1366×768 nó lấy mất đúng phần mà bản xem trước CV
 * cần (FRONTEND §3.1).
 *
 * ── Nút Trợ lý luôn mang ngữ cảnh ──
 * Spec §5.2: chat không ngữ cảnh cho ra lời khuyên chung chung, đúng thứ
 * BR-56.2 cấm. Chưa có CV thì nút dẫn tới chỗ chọn CV chứ không mở chat rỗng.
 *
 * KHÔNG hiện link tới màn hình chưa tồn tại (BR-01.3).
 */

export function TopNavView({ email, cvId }: { email: string | null; cvId: string | null }) {
  return (
    <header className="border-b border-border bg-surface">
      <nav className="mx-auto flex max-w-5xl items-center gap-5 px-6 py-3 text-[13px]">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand" />
          HR-Agent
        </Link>

        {email && (
          <>
            <Link href="/" className="text-ink-muted hover:text-ink">
              Trang chủ
            </Link>
            <Link href="/cv" className="text-ink-muted hover:text-ink">
              CV của tôi
            </Link>
          </>
        )}

        <span className="flex-1" />

        {email ? (
          <>
            <Link
              href={cvId ? `/builder/${cvId}?assistant=1` : '/cv'}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-border bg-brand-subtle px-3 py-1.5 font-medium text-brand-ink hover:border-brand"
            >
              <span aria-hidden="true">✦</span>
              Trợ lý
            </Link>
            <Link href="/settings" className="max-w-[180px] truncate text-ink-muted hover:text-ink">
              {email}
            </Link>
          </>
        ) : (
          <Link href="/login" className="font-medium text-brand hover:text-brand-hover">
            Đăng nhập
          </Link>
        )}
      </nav>
    </header>
  )
}

export async function TopNav({ cvId = null }: { cvId?: string | null } = {}) {
  const user = await currentUser().catch(() => null)
  return <TopNavView email={user?.email ?? null} cvId={cvId} />
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/topnav.ui.test.tsx`
Expected: PASS — cả 5.

- [ ] **Step 5: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/nav/TopNav.tsx apps/web/test/topnav.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(nav): top nav mới, tách TopNavView để test được

Tách phần render thuần khỏi Server Component async: TopNav cũ gọi currentUser()
nên không render được trong test mà không dựng cả tầng auth.

Nút Trợ lý luôn mang ngữ cảnh — chưa có CV thì dẫn tới chỗ chọn CV chứ không
mở chat rỗng, vì chat không ngữ cảnh cho ra lời khuyên chung chung (BR-56.2).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Công tắc ngôn ngữ CV `vi | en`

**Files:**
- Create: `apps/web/components/editor/CvLanguageSwitch.tsx`
- Modify: `apps/web/components/editor/BuilderShell.tsx:76-82` (chèn vào `<header>` sẵn có)
- Test: `apps/web/test/cv-language.ui.test.tsx`

**Interfaces:**
- Consumes: `useEditor` từ `@/lib/editor-store` (đã có `applyUser`), `Language` từ `@hr/schema`
- Produces:
  ```ts
  function CvLanguageSwitch(): JSX.Element
  ```

**Bối cảnh — phần lớn đã có sẵn, chỉ thiếu công tắc.** FRONTEND §9.6 quy định
ba trục ngôn ngữ ĐỘC LẬP: giao diện, CV, và JD. Task này chỉ làm trục **CV**.
Kiểm tra ngày 2026-08-07 cho thấy mọi tầng dưới đã xong:

| Tầng | Trạng thái |
|---|---|
| `LanguageSchema = z.enum(['vi','en'])` ở `packages/schema/src/profile.ts:8` | ✅ có |
| `sectionTitle(id, lang)` với **đủ cả hai** bộ nhãn, `packages/templates/src/sections.tsx:14-40` | ✅ có |
| `renderSection` đọc `profile.language`, `sections.tsx:117` | ✅ có |
| `render.tsx:52` gắn `data-lang` | ✅ có |
| `ProfileRepo` lưu `language` khi cập nhật, `packages/db/src/profiles.ts:87-89` | ✅ có |
| `PATCH /api/profiles/:id` nhận mọi `PatchOp` | ✅ có |
| Công tắc trên giao diện | ❌ **thiếu** |

**Điều PHẢI nói rõ với người dùng.** Đổi công tắc **không dịch nội dung**. Nó
đổi ngôn ngữ *khai báo* của CV, và tiêu đề mục đi theo (`Ngoại ngữ` ↔
`Languages`). Chữ do người dùng tự viết giữ nguyên. Không nói rõ thì người
dùng bấm `EN` rồi chờ CV tự dịch, và kết luận sản phẩm hỏng. TDD §9 tách ba
trục chính vì lý do này.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/test/cv-language.ui.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSchema, type Profile } from '@hr/schema'
import { CvLanguageSwitch } from '@/components/editor/CvLanguageSwitch'
import { useEditor } from '@/lib/editor-store'

/**
 * FRONTEND §9.6 — ba trục ngôn ngữ ĐỘC LẬP: giao diện, CV, JD.
 *
 * Công tắc này đổi trục CV. Nó KHÔNG dịch nội dung — chỉ đổi ngôn ngữ khai
 * báo, và tiêu đề mục do template sinh sẽ đi theo. Nếu giao diện không nói rõ
 * điều đó, người dùng bấm EN rồi chờ CV tự dịch và kết luận sản phẩm hỏng.
 */

const p = (language: 'vi' | 'en' = 'vi'): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    language,
    basics: { name: 'Nguyễn Văn A' },
  })

beforeEach(() => {
  useEditor.setState({ profile: p(), applyUser: vi.fn(async () => {}) } as never)
})

describe('CvLanguageSwitch', () => {
  it('là một nhóm có tên, không phải hai nút rời rạc', () => {
    render(<CvLanguageSwitch />)
    expect(screen.getByRole('group', { name: /Ngôn ngữ CV/ })).toBeInTheDocument()
  })

  it('đánh dấu ngôn ngữ đang chọn cho trình đọc màn hình', () => {
    render(<CvLanguageSwitch />)
    expect(screen.getByRole('button', { name: 'Tiếng Việt' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('bấm EN phát đúng một op replace vào /language', async () => {
    const applyUser = vi.fn(async () => {})
    useEditor.setState({ profile: p(), applyUser } as never)

    render(<CvLanguageSwitch />)
    await userEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(applyUser).toHaveBeenCalledOnce()
    const ops = applyUser.mock.calls[0]![0] as unknown as Array<Record<string, unknown>>
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'replace', path: '/language', value: 'en' })
  })

  it('op mang grounding user_message — đây là thao tác của NGƯỜI, không phải AI', async () => {
    const applyUser = vi.fn(async () => {})
    useEditor.setState({ profile: p(), applyUser } as never)

    render(<CvLanguageSwitch />)
    await userEvent.click(screen.getByRole('button', { name: 'English' }))

    const ops = applyUser.mock.calls[0]![0] as unknown as Array<Record<string, unknown>>
    expect(ops[0]!['grounding']).toMatchObject({ type: 'user_message' })
  })

  it('bấm lại ngôn ngữ ĐANG chọn thì không phát op nào', async () => {
    const applyUser = vi.fn(async () => {})
    useEditor.setState({ profile: p('vi'), applyUser } as never)

    render(<CvLanguageSwitch />)
    await userEvent.click(screen.getByRole('button', { name: 'Tiếng Việt' }))

    expect(applyUser).not.toHaveBeenCalled()
  })

  it('nói RÕ là không dịch nội dung', () => {
    render(<CvLanguageSwitch />)
    expect(screen.getByText(/không dịch nội dung/i)).toBeInTheDocument()
  })

  it('hồ sơ đang là en thì EN được đánh dấu chọn', () => {
    useEditor.setState({ profile: p('en'), applyUser: vi.fn(async () => {}) } as never)
    render(<CvLanguageSwitch />)
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/cv-language.ui.test.tsx`
Expected: FAIL — `CvLanguageSwitch` chưa tồn tại.

- [ ] **Step 3: Viết `CvLanguageSwitch`**

```tsx
// apps/web/components/editor/CvLanguageSwitch.tsx
'use client'

import type { Language } from '@hr/schema'
import { useEditor } from '@/lib/editor-store'

/**
 * Công tắc ngôn ngữ CV — FRONTEND §9.6.
 *
 * ── Đây là trục nào ──
 * Có BA trục ngôn ngữ độc lập: giao diện, CV, và JD. Công tắc này đổi trục CV
 * và KHÔNG đụng tới hai trục kia. Gộp chúng lại là sai: một người Việt hoàn
 * toàn có thể muốn giao diện tiếng Việt mà CV tiếng Anh để nộp công ty nước
 * ngoài — đó là trường hợp phổ biến nhất, không phải ngoại lệ.
 *
 * ── Vì sao phải nói "không dịch nội dung" ──
 * Đổi `profile.language` làm tiêu đề mục do template sinh đi theo
 * (`Ngoại ngữ` ↔ `Languages`), nhưng chữ người dùng tự viết giữ nguyên. Không
 * nói rõ thì họ bấm EN, thấy nội dung vẫn tiếng Việt, và kết luận là hỏng.
 *
 * ── Vì sao đi qua applyUser ──
 * FRONTEND §9.2: thao tác của người dùng cũng là JSON Patch, đi CÙNG đường ống
 * với thay đổi từ AI. Nhờ vậy Hoàn tác hoạt động đồng nhất — đổi nhầm ngôn ngữ
 * thì Ctrl+Z lùi lại được như mọi thay đổi khác, không cần cơ chế riêng.
 */

const OPTIONS: { value: Language; label: string }[] = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
]

export function CvLanguageSwitch() {
  const profile = useEditor((s) => s.profile)
  const applyUser = useEditor((s) => s.applyUser)
  const current: Language = profile?.language ?? 'vi'

  const choose = (next: Language): void => {
    // Bấm lại chính ngôn ngữ đang chọn: không phát op. Một op không đổi gì vẫn
    // tạo một mốc trong lịch sử phiên bản, và người dùng sẽ phải Hoàn tác một
    // thao tác chẳng làm gì.
    if (next === current) return
    void applyUser([
      {
        op: 'replace',
        path: '/language',
        value: next,
        rationale: 'Người dùng đổi ngôn ngữ CV',
        grounding: { type: 'user_message', ref: 'language-switch' },
        kbRefs: [],
      },
    ])
  }

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Ngôn ngữ CV"
        className="inline-flex overflow-hidden rounded-md border border-border"
      >
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => choose(o.value)}
            aria-pressed={o.value === current}
            className={
              o.value === current
                ? 'bg-brand px-2.5 py-1 text-[12px] font-medium text-white'
                : 'bg-surface px-2.5 py-1 text-[12px] text-ink-muted hover:text-ink'
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-[12px] text-ink-subtle">
        Đổi tiêu đề mục — không dịch nội dung bạn đã viết
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Chèn vào `BuilderShell`**

Trong `apps/web/components/editor/BuilderShell.tsx`, thêm import:

```tsx
import { CvLanguageSwitch } from './CvLanguageSwitch'
```

Rồi chèn vào `<header>` ở dòng 76, ngay sau `<UndoRedo />`:

```tsx
        <UndoRedo />
        <CvLanguageSwitch />
```

Không sửa gì khác trong file này — `/builder` được dựng lại đầy đủ ở kế hoạch 2.

- [ ] **Step 5: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/cv-language.ui.test.tsx`
Expected: PASS — cả 7.

Nếu `useEditor.setState(...)` báo lỗi kiểu: xem `apps/web/lib/editor-store.ts` để lấy đúng hình dạng state, và thay `as never` bằng kiểu thật.

- [ ] **Step 6: Kiểm bằng mắt — tiêu đề mục PHẢI đổi**

```bash
docker compose up -d postgres redis
npm run dev:restart
```

Mở một CV ở `/builder/:cvId`, bấm `English`. Kiểm:

- Tiêu đề mục trên bản xem trước đổi: `Kinh nghiệm` → `Experience`,
  `Ngoại ngữ` → `Languages`, `Học vấn` → `Education`
- Nội dung do người dùng viết **giữ nguyên tiếng Việt** — đúng như câu chú thích hứa
- Bấm Hoàn tác thì quay lại `vi`
- Tải lại trang: vẫn là `en` (đã lưu xuống database)

- [ ] **Step 7: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/editor/CvLanguageSwitch.tsx \
        apps/web/components/editor/BuilderShell.tsx \
        apps/web/test/cv-language.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): công tắc ngôn ngữ CV vi|en — FRONTEND §9.6

Mọi tầng dưới đã có sẵn từ trước: LanguageSchema, sectionTitle() đủ cả hai bộ
nhãn, renderSection đọc profile.language, ProfileRepo lưu nó. Chỉ thiếu đúng
công tắc trên giao diện.

Đây là trục CV, KHÔNG phải trục giao diện — người Việt muốn giao diện tiếng
Việt mà CV tiếng Anh để nộp công ty nước ngoài là trường hợp phổ biến nhất.

Nhãn nói rõ "không dịch nội dung": đổi ngôn ngữ làm tiêu đề mục đi theo nhưng
chữ người dùng tự viết giữ nguyên, không nói rõ thì họ tưởng sản phẩm hỏng.

Đi qua applyUser nên Hoàn tác dùng được như mọi thay đổi khác (FRONTEND §9.2).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `IntentRouter` và `ResumeHome` — hai biến thể còn lại của `/`

**Files:**
- Modify: `apps/web/components/home/IntentRouter.tsx` (114 dòng)
- Modify: `apps/web/components/home/ResumeHome.tsx` (74 dòng)
- Modify: `apps/web/test/home.ui.test.tsx` (thêm test, giữ nguyên test cũ)

**Interfaces:**
- Consumes: `Card`, `Button`, `Section` (Task 3, 4)
- Produces: không đổi chữ ký. `IntentRouter` vẫn xuất `ENTRIES` (test hiện có phụ thuộc vào nó); `ResumeHome` vẫn nhận `{ job: HomeJob }`.

**Bối cảnh.** Route `/` có **ba** biến thể chọn theo trạng thái thật
(`lib/home-state.ts`): `IntentRouter` khi chưa có hồ sơ, `ResumeHome` khi có
việc dở dang, `ReturningHome` khi đã có hồ sơ. Task 12 mới dựng lại biến thể
thứ ba. Bỏ hai biến thể kia lại thì **người dùng mới** — đúng nhóm quan trọng
nhất — vẫn thấy giao diện cũ. Lát cắt dọc chỉ có ý nghĩa khi phủ cả route.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `apps/web/test/home.ui.test.tsx`:

```tsx
describe('IntentRouter và ResumeHome — dùng chung ngôn ngữ thị giác', () => {
  it('IntentRouter: mỗi lối vào là một thẻ, không phải danh sách link trần', () => {
    const { container } = render(<IntentRouter />)
    expect(container.querySelectorAll('[data-variant]').length).toBeGreaterThanOrEqual(
      ENTRIES.length,
    )
  })

  it('IntentRouter: vẫn đủ số lối vào như trước', () => {
    render(<IntentRouter />)
    for (const e of ENTRIES) {
      expect(screen.getByRole('link', { name: new RegExp(e.title) })).toBeInTheDocument()
    }
  })

  it('ResumeHome: job đang chạy → thẻ có nút tiếp tục', () => {
    render(
      <ResumeHome
        job={{
          id: 'job-1',
          kind: 'parse_cv',
          status: 'done',
          createdAt: new Date().toISOString(),
          filename: 'cv.pdf',
          reviewed: false,
        }}
      />,
    )
    expect(screen.getByRole('link', { name: /Tiếp tục/ })).toHaveAttribute(
      'href',
      '/import/job-1/review',
    )
  })

  it('ResumeHome: job HỎNG dùng tông danger, không phải tông thường', () => {
    const { container } = render(
      <ResumeHome
        job={{
          id: 'job-2',
          kind: 'parse_cv',
          status: 'failed',
          createdAt: new Date().toISOString(),
          filename: 'cv.pdf',
          reviewed: undefined,
        }}
      />,
    )
    expect(container.querySelector('[data-tone="danger"]')).toBeInTheDocument()
  })
})
```

Bổ sung import ở đầu file nếu chưa có: `ENTRIES` đã được import sẵn cùng
`IntentRouter` ở dòng 6 của file test.

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npx vitest run --project ui apps/web/test/home.ui.test.tsx`
Expected: FAIL — 4 test mới đỏ (`data-variant` và `data-tone` chưa có); test cũ vẫn xanh.

- [ ] **Step 3: Sửa `IntentRouter`**

Chỉ thay lớp trình bày. Giữ nguyên `ENTRIES`, `Entry`, và mọi `href` — test
hiện có phụ thuộc vào chúng.

Trong `EntryCard`, thay chuỗi class thủ công bằng `Card`:

```tsx
import { Card } from '@/components/ui'

// EntryCard — thay phần bọc ngoài:
function EntryCard({ entry }: { entry: Entry }) {
  return (
    <Link href={entry.href} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <Card variant="raised" className="h-full transition-colors hover:border-brand">
        <p className="text-[15px] font-semibold text-ink">{entry.title}</p>
        <p className="mt-1 text-[13px] text-ink-muted">{entry.desc}</p>
      </Card>
    </Link>
  )
}
```

Giữ nguyên tên field của `Entry` đang có trong file (`title`, `desc`, `href`).
Nếu tên khác, dùng tên thật thay vì đổi kiểu — kiểu này đang được `ENTRIES`
và test cũ dùng.

Đổi các class màu thô còn lại trong file sang token: `text-neutral-900` →
`text-ink`, `text-neutral-500`/`600` → `text-ink-muted`, `border-neutral-200`
→ `border-border`, `bg-sky-600` → `bg-brand`. Gỡ mọi class `dark:`.

- [ ] **Step 4: Sửa `ResumeHome`**

Bọc nội dung trong `Card`, và đánh dấu tông cho nhánh hỏng:

```tsx
import { Card } from '@/components/ui'

// Trong ResumeHome, phần bọc ngoài:
<Card
  variant="raised"
  className={failed ? 'border-danger/40' : ''}
  {...(failed ? { 'data-tone': 'danger' as const } : {})}
>
  {/* nội dung giữ nguyên, chỉ đổi class màu sang token */}
</Card>
```

`Card` cần chuyển tiếp thuộc tính `data-*`. Nếu nó chưa nhận, thêm vào
`apps/web/components/ui/Card.tsx`:

```tsx
export function Card({
  variant = 'default',
  className = '',
  children,
  ...rest
}: {
  variant?: CardVariant
  className?: string
  children: ReactNode
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div
      {...rest}
      data-variant={variant}
      className={`relative overflow-hidden rounded-lg p-4 ${VARIANT[variant]} ${className}`}
    >
      {/* … phần còn lại giữ nguyên … */}
    </div>
  )
}
```

Đổi class màu thô sang token như Step 3, và gỡ mọi class `dark:`.

- [ ] **Step 5: Chạy test để xác nhận xanh**

Run: `npx vitest run --project ui apps/web/test/home.ui.test.tsx`
Expected: PASS — toàn bộ, cả test cũ lẫn mới.

- [ ] **Step 6: Kiểm không còn palette thô ở màn `/`**

```bash
grep -nE "(bg|text|border|divide)-(sky|neutral|gray|slate|zinc)-[0-9]{2,3}|dark:" \
  apps/web/components/home/*.tsx
```

Expected: không in ra gì. Còn dòng nào thì đổi nốt sang token.

- [ ] **Step 7: Kiểm bằng mắt cả ba biến thể**

```bash
docker compose up -d postgres redis
npm run dev:restart
```

Xem `IntentRouter` bằng cách mở Home với tài khoản chưa có hồ sơ (hoặc xoá hồ
sơ trong bảng `profiles` của tài khoản dev). Kiểm cả ba biến thể trông như
cùng một sản phẩm: cùng bo góc, cùng khoảng cách, cùng màu nhấn teal.

- [ ] **Step 8: Cổng và commit**

```bash
npm run lint && npm run typecheck && npm run test
git add apps/web/components/home apps/web/components/ui/Card.tsx apps/web/test/home.ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(home): IntentRouter và ResumeHome dùng chung ngôn ngữ thị giác

Route / có BA biến thể chọn theo trạng thái thật. Task trước mới dựng lại biến
thể thứ ba (ReturningHome); bỏ hai cái kia lại thì người dùng MỚI — nhóm quan
trọng nhất — vẫn thấy giao diện cũ.

ENTRIES và mọi href giữ nguyên: test hiện có phụ thuộc vào chúng, và đổi href
là đổi luồng chứ không phải đổi giao diện.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Cập nhật `docs/FRONTEND.md`

**Files:**
- Modify: `docs/FRONTEND.md`

**Interfaces:**
- Consumes: mọi thứ ở Task 1–13
- Produces: không có mã

- [ ] **Step 1: Thêm mục §13 Hệ thiết kế**

Thêm vào cuối `docs/FRONTEND.md`, trước mục "12. Việc chưa làm ở giai đoạn 1":

```markdown
## 13. Hệ thiết kế

Nguồn: [spec 2026-08-07](superpowers/specs/2026-08-07-frontend-redesign-design.md).

### 13.1 Token

Khai một chỗ duy nhất trong `apps/web/app/globals.css` bằng `@theme` của
Tailwind v4. Component **không** dùng palette thô (`bg-sky-600`,
`text-neutral-500`) — trước đây cách đó tạo ra 586 lượt màu rải trên 38 file.

| Nhóm | Token | Dùng ở đâu |
|---|---|---|
| Thương hiệu | `brand` `brand-hover` `brand-subtle` `brand-border` `brand-ink` | nút chính, link, **và mọi vùng AI** |
| Mực & nền | `ink` `ink-muted` `ink-subtle` `surface` `canvas` `border` `border-strong` | |
| Trạng thái | `success` `warn` `danger` + bản `-subtle` | |

**Quy tắc một dòng:** teal chỉ dành cho thương hiệu và AI. Thấy teal là biết
máy đang tham gia. Trạng thái không mượn teal; AI không mượn xanh lá, vàng, đỏ.

### 13.2 Chữ

Be Vietnam Pro nạp bằng `next/font/local` (file `.woff2` trong repo, không gọi
mạng). Hai weight: 400 và 600.

`packages/templates/src/styles.css` tham chiếu qua **cùng biến CSS**
`--font-be-vietnam`, nên bản xem trước và file PDF không lệch font.

Thang chữ nới rộng hơn mặc định vì dấu tiếng Việt chồng cả trên lẫn dưới:
`display 30/38 · h1 24/32 · h2 18/28 · h3 15/22 · body 15/24 · small 13/20 ·
micro 12/16`.

### 13.3 Primitive

`apps/web/components/ui/` — tám cái, không thêm dependency ngoài.

`Button` · `Card` · `Section` · `Badge` · `Meter` · `Dialog` · `Sheet` · `Field`

Hai cái mang doctrine, ở mức khuyến nghị (thiếu thì cảnh báo ở dev):

- `Button` nhận `disabledReason` — §8.1 yêu cầu nút cần AI phải mờ đi **kèm
  lời giải thích**, không biến mất.
- `Meter` nhận `parts` — BR-02.1 yêu cầu mọi phần trăm phải tra được nguồn.

`Dialog` và `Sheet` dùng chung `useFocusTrap`: Escape đóng, bẫy focus, trả
focus về nơi đã mở, khoá cuộn nền.

### 13.4 Chữ ký AI

Mọi vùng AI đi qua `components/ai/AiPanel.tsx`. Ba tầng:

1. **Bề mặt** — nền `brand-subtle`, viền `brand-border`, dải gradient 3px phía
   trên. Shimmer chỉ khi đang stream, tắt theo `prefers-reduced-motion`.
2. **Lối vào** — nút `✦ Trợ lý` ở top nav, luôn mang ngữ cảnh CV.
3. **Chứng cứ** — diff trước/sau, badge nguồn theo `grounding.type`, dấu ⚪
   cho nội dung chưa xác nhận.

**Trạng thái degrade nằm cùng file với chữ ký**, có chủ ý: chữ ký làm khối AI
to, nên xử lý lúc-model-chết ở nơi khác sẽ có chỗ quên, và chỗ quên hiện ra
thành một ô rỗng giữa màn hình.

### 13.5 Điểm khớp JD không tô màu

TDD §8.2.3: đo thực tế cho 41 và 41 là **đúng**; thứ có ý nghĩa là thứ tự
tương đối, không phải vạch ngưỡng. Con số để `ink` trung tính; nghĩa nằm ở
dòng sự thật đếm được bên dưới ("Thiếu 4/11 kỹ năng JD yêu cầu") và ở thứ hạng
so với các lần đối chiếu khác của chính người dùng.
```

- [ ] **Step 2: Sửa §9.1 Stack**

Trong bảng ở §9.1, đổi ba dòng cho khớp thực tế sau Task 1–8:

- Dòng **Style**: `Tailwind CSS v4 + token @theme (xem §13.1)` · Trạng thái `✅ đang dùng`
- Dòng **Component**: `Tự viết — components/ui/, 8 primitive (xem §13.3)` · Trạng thái `✅ đang dùng`
- Thêm dòng **Chữ**: `Be Vietnam Pro qua next/font/local, 2 weight` · Trạng thái `✅ đang dùng`

- [ ] **Step 3: Sửa §9.7 Hiệu năng**

Xoá hai dòng khỏi bảng §9.7 và chuyển xuống bảng §12 (Việc chưa làm ở giai đoạn 1):

| Hạng mục | Lý do hoãn |
|---|---|
| Virtualize danh sách gap | Báo cáo hiện chưa vượt 30 mục trên dữ liệu thật; làm khi đo được là chậm |
| Prefetch template khi hover | Chờ bộ chọn mẫu được dựng lại ở kế hoạch 2 |

Để chúng ở mục "Hiệu năng" khiến người đọc tưởng đã có.

- [ ] **Step 4: Sửa §10 và §12**

- §10: thêm `ui/` vào đầu cây component, kèm một dòng trỏ tới §13.3.
- §12: gỡ dòng "Chế độ tối | Ưu tiên thấp" — spec D4 đã quyết **bỏ hẳn**, không phải hoãn. Thay bằng một dòng ở §13.1 ghi rõ sản phẩm chỉ có chế độ sáng.

- [ ] **Step 4b: Sửa §9.6 Song ngữ**

Mục §9.6 mô tả ba trục ngôn ngữ như thiết kế dự kiến. Ghi rõ trục nào đã làm:

```markdown
Trạng thái hiện tại — ba trục KHÔNG cùng tiến độ:

| Trục | Trạng thái |
|---|---|
| `profile.language` — ngôn ngữ CV | ✅ có công tắc `vi \| en` trên thanh của `/builder` (`components/editor/CvLanguageSwitch.tsx`) |
| `jd.language` — ngôn ngữ JD | ✅ có trong dữ liệu, chưa có công tắc; hiện `JdForm` gửi cứng `'vi'` |
| `uiLocale` — ngôn ngữ giao diện | ⛔ chưa có. Chuỗi giao diện viết thẳng tiếng Việt — xem §12 |

Công tắc ngôn ngữ CV **không dịch nội dung**. Nó đổi ngôn ngữ khai báo, và
tiêu đề mục do template sinh đi theo (`Ngoại ngữ` ↔ `Languages`); chữ người
dùng tự viết giữ nguyên. Nhãn cạnh công tắc nói rõ điều này — không nói thì
người dùng bấm EN rồi chờ CV tự dịch.
```

- [ ] **Step 5: Kiểm tra chéo**

```bash
grep -n "shadcn\|TanStack\|React Hook Form\|next-intl\|dnd-kit\|pdf.js" docs/FRONTEND.md
```

Expected: chỉ còn xuất hiện ở §12 (việc chưa làm) hoặc phần giải thích lý do không dùng — không còn ở §9.1 như thể đang dùng.

- [ ] **Step 6: Commit**

```bash
git add docs/FRONTEND.md
git commit -m "$(cat <<'EOF'
docs(frontend): thêm §13 Hệ thiết kế, sửa §9.1/§9.7/§10/§12

§13 ghi lại token, thang chữ, 8 primitive, chữ ký AI ba tầng và quy tắc không
tô màu điểm khớp.

§9.7 chuyển "Virtualize danh sách gap" và "Prefetch template" xuống §12: để
chúng ở mục Hiệu năng khiến người đọc tưởng đã có.

§12 gỡ "Chế độ tối" — spec D4 quyết bỏ hẳn, không phải hoãn.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nghiệm thu kế hoạch 1

Chạy hết Task 1–16 rồi kiểm:

```bash
npm run lint          # exit 0
npm run typecheck     # exit 0
npm run test          # >= 627 test, 0 fail
npm run build:web     # exit 0
npm run dev:restart   # mở http://localhost:3100
```

Kiểm bằng mắt ở **1366×768**:

- [ ] Lời chào có tên người dùng
- [ ] Thẻ CV nổi hơn hẳn hai khối còn lại, có bản CV thu nhỏ
- [ ] Bấm "Gồm những gì?" mở ra đủ từng phần kèm trọng số
- [ ] Khối trợ lý có nền teal và dải gradient phía trên
- [ ] Danh sách đối chiếu không còn hai dòng giống hệt; mỗi dòng có mốc thời gian
- [ ] Điểm khớp không tô màu
- [ ] Không có thanh cuộn ngang
- [ ] Chữ hiển thị bằng Be Vietnam Pro (dấu tiếng Việt sắc nét, không dính nét)

Kiểm ngôn ngữ CV ở `/builder/:cvId`:

- [ ] Công tắc `Tiếng Việt | English` có trên thanh, cạnh Hoàn tác
- [ ] Bấm `English` → tiêu đề mục đổi (`Kinh nghiệm` → `Experience`)
- [ ] Nội dung do người dùng viết **giữ nguyên**, không bị dịch
- [ ] Bấm Hoàn tác → quay lại `vi`
- [ ] Tải lại trang → vẫn là `en` (đã lưu xuống database)

Kiểm degrade — tắt kết nối tới model server rồi tải lại Home:

- [ ] Khối trợ lý vẫn còn, đổi sang nền trung tính
- [ ] Có câu "Bạn vẫn sửa CV, đổi mẫu và tải file bình thường"
- [ ] Nút "Tiếp tục chỉnh CV" vẫn bấm được

Kiểm bàn phím:

- [ ] `Tab` đi hết trang theo thứ tự hợp lý, mọi chỗ focus đều thấy viền teal
- [ ] Mở `Dialog` bất kỳ, `Escape` đóng và focus trả về nút đã mở

Kiểm cả ba biến thể của `/` trông như cùng một sản phẩm:

- [ ] `IntentRouter` (tài khoản chưa có hồ sơ)
- [ ] `ResumeHome` (có job `parse_cv` chưa rà soát)
- [ ] `ReturningHome` (đã có hồ sơ)

Xong hết thì viết kế hoạch 2 cho bước 5–7 của spec §7.1.
