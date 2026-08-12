# Tách trang mức bullet & tách đôi `pageMargin` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preview CV cắt trang giữa một item theo từng gạch đầu dòng thay vì đẩy nguyên khối, và `pageMargin` chỉ còn nghĩa "khe giữa trang trong preview" với default 20mm.

**Architecture:** Giữ nguyên kiến trúc đo-rồi-xếp của `CVPageComposer`. Hạ đơn vị nhồi từ "một item" xuống "head của item" + "từng bullet", bằng cách thêm bậc thứ ba vào khoá segment (`nodeId::itemId::head` và `nodeId::itemId::h<i>`). `pageGroupsForNodes` không đổi một dòng — nó chỉ nhận danh sách dài hơn với phần tử nhỏ hơn. Khi render, các sub-segment của một trang được gom thành prop mới `itemSlices` của `CVBlockRenderer`, cho biết trang này có render head của item hay không và lấy những bullet index nào. Song song đó, `pageMargin` bị gỡ khỏi phép tính `@page margin` và chuyển thành `gap` của container preview.

**Tech Stack:** React 19, TypeScript (repo **không** bật `strict`), Zod (`@hr/schema`), Vitest 2 + Testing Library + happy-dom.

## Global Constraints

- Spec nguồn: `backend/docs/superpowers/specs/2026-08-12-bullet-level-pagination-design.md`. Mọi mục "Cố ý không làm" trong spec là ràng buộc, không phải thiếu sót.
- Mọi lệnh test/typecheck chạy từ thư mục `frontend/`.
- Test cần DOM **bắt buộc** đặt tên `*.ui.test.tsx` — project `ui` của Vitest chỉ include `apps/*/test/**/*.ui.test.tsx`. File `*.test.ts` chạy ở project `unit` với `environment: 'node'`, không có `document`.
- Repo không bật `strict`/`strictNullChecks`. TypeScript sẽ **không** thu hẹp union theo discriminant kiểu boolean. Dùng kiểm tra tường minh (`typeof part === 'number'`) thay vì dựa vào narrowing.
- Không viết migration dữ liệu. CV cũ có `pageMargin > 0` sẽ in ra lề hẹp lại đúng bằng giá trị đó — đây là hệ quả có chủ đích.
- Không đụng tới đường in SSR (`src/server/print.tsx`) ngoài phần CSS: nó render dòng chảy liên tục và để trình duyệt tự ngắt, không dùng `itemSlices`.
- Giữ nguyên `.cv-bullets` là class của `<ul>` gạch đầu dòng ở mọi variant — cả đo lẫn test đều bám vào nó.

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `frontend/packages/schema/src/cv.ts` | Default `pageMargin` 0 → 20 | 1 |
| `frontend/apps/web-spa/src/lib/cv-typography.ts` | Default `pageMargin` 0 → 20 | 1 |
| `frontend/apps/web-spa/src/lib/print-css.ts` | `@page margin` bỏ cộng `pageMargin` | 1 |
| `frontend/apps/web-spa/src/components/PaginatedA4Document.tsx` | `marginBottom` mỗi tờ → `gap` container | 1 |
| `frontend/apps/web-spa/src/lib/i18n/messages.{vi,en}.ts` | Khoá `pageGap` mới; đổi nghĩa `pageMargin` thành tiêu đề nhóm | 1 |
| `frontend/apps/web-spa/src/components/CVEditorView.tsx` | Bỏ chuỗi hardcode `'Margin trang'`, dùng `t('pageGap')` | 1 |
| `frontend/apps/web-spa/src/components/CVBlockRenderer.tsx` | Prop `itemSlices`; head có điều kiện; bullet theo index | 2 |
| `frontend/apps/web-spa/src/components/CVPageComposer.tsx` | Sinh/parse sub-segment, đo theo bullet, gom lát cắt cho trang | 3 |

Test:

| File | Task |
|---|---|
| `frontend/packages/schema/test/cv.test.ts` (sửa) | 1 |
| `frontend/apps/web-spa/test/print.test.ts` (sửa) | 1 |
| `frontend/apps/web-spa/test/paginated-a4.ui.test.tsx` (sửa + thêm) | 1, 3 |
| `frontend/apps/web-spa/test/cv-item-slices.ui.test.tsx` (tạo) | 2 |
| `frontend/apps/web-spa/test/cv-page-segments.ui.test.tsx` (tạo) | 3 |

---

## Task 1: Tách đôi `pageMargin`

Sau task này `pageMargin` chỉ còn điều khiển khe hở giữa các tờ giấy trong preview; bản in lấy lề thẳng từ bốn padding.

**Files:**
- Modify: `frontend/packages/schema/src/cv.ts:170`
- Modify: `frontend/apps/web-spa/src/lib/cv-typography.ts:48`
- Modify: `frontend/apps/web-spa/src/lib/print-css.ts:56-62`
- Modify: `frontend/apps/web-spa/src/components/PaginatedA4Document.tsx:66-98`
- Modify: `frontend/apps/web-spa/src/lib/i18n/messages.vi.ts:80`
- Modify: `frontend/apps/web-spa/src/lib/i18n/messages.en.ts:69`
- Modify: `frontend/apps/web-spa/src/components/CVEditorView.tsx:335-341`
- Test: `frontend/packages/schema/test/cv.test.ts:41`, `frontend/apps/web-spa/test/print.test.ts:53-59`, `frontend/apps/web-spa/test/paginated-a4.ui.test.tsx`

**Interfaces:**
- Consumes: không có.
- Produces: không có API mới. Task 2 và 3 không phụ thuộc task này — ba task độc lập, chỉ chạy tuần tự cho gọn review.

- [ ] **Step 1: Sửa test lề in cho khớp hành vi mới**

Trong `frontend/apps/web-spa/test/print.test.ts`, đổi kỳ vọng ở dòng 58. Padding là `12/14/16/18` (top/bottom/left/right) và `@page margin` viết theo thứ tự top-right-bottom-left, nên giá trị đúng là `12mm 18mm 14mm 16mm` — `pageMargin: 2` không còn được cộng vào:

```ts
it('builds print page margins from the editable padding settings alone', () => {
  const css = printCSSForDesign({
    font: 'Auto', fontSize: 10.5, bodyFontSize: 10.5, sectionTitleFontSize: 13, headerFontSize: 20,
    spacing: 'normal', paddingTop: 12, paddingBottom: 14, paddingLeft: 16, paddingRight: 18, pageMargin: 2, lineHeight: 1.4, textAlign: 'justify',
  })
  expect(css).toContain('@page{size:A4;margin:12mm 18mm 14mm 16mm}')
})
```

Không đụng vào kỳ vọng ở dòng 86 (`@page{size:A4;margin:20mm 20mm 20mm 20mm}`) — CV đó dùng padding mặc định 20mm, trước cộng `pageMargin: 0` ra 20mm, giờ lấy thẳng padding cũng ra 20mm.

- [ ] **Step 2: Sửa test default của schema**

Trong `frontend/packages/schema/test/cv.test.ts` dòng 41:

```ts
    expect(design.pageMargin).toBe(20)
```

- [ ] **Step 3: Viết test cho khe giữa trang trong preview**

Thêm vào `frontend/apps/web-spa/test/paginated-a4.ui.test.tsx`, bên trong `describe('PaginatedA4Document', ...)`:

```tsx
  it('separates composed pages with the preview-only page gap', () => {
    render(
      <PaginatedA4Document
        pageGroups={[['header'], ['experience']]}
        renderPage={(keys) => keys.map((key) => <div key={key}>{key}</div>)}
      />,
    )

    expect(screen.getByTestId('a4-document').getAttribute('style')).toContain('gap: var(--cv-page-margin, 0mm)')
    for (const page of screen.getAllByTestId('a4-page')) {
      expect(page.getAttribute('style') ?? '').not.toContain('margin-bottom')
    }
  })
```

- [ ] **Step 4: Chạy ba test, xác nhận đỏ**

```bash
cd frontend
npx vitest run --project unit packages/schema/test/cv.test.ts apps/web-spa/test/print.test.ts
npx vitest run --project ui apps/web-spa/test/paginated-a4.ui.test.tsx
```

Kỳ vọng: `cv.test.ts` đỏ với `expected 0 to be 20`; `print.test.ts` đỏ vì CSS vẫn chứa `margin:14mm 20mm 16mm 18mm`; `paginated-a4.ui.test.tsx` đỏ vì style của container chưa có `gap`.

- [ ] **Step 5: Đổi default trong schema**

`frontend/packages/schema/src/cv.ts` dòng 170:

```ts
  pageMargin: z.number().min(0).max(20).default(20),
```

- [ ] **Step 6: Đổi default trong resolver typography**

`frontend/apps/web-spa/src/lib/cv-typography.ts` dòng 48:

```ts
    pageMargin: design.pageMargin ?? 20,
```

- [ ] **Step 7: Gỡ `pageMargin` khỏi lề in**

Thay toàn bộ thân hàm ở `frontend/apps/web-spa/src/lib/print-css.ts` dòng 56-62 bằng:

```ts
  const typography = resolveCVTypography(design)
  // `pageMargin` KHÔNG góp vào đây: nó chỉ là khe hở giữa các tờ giấy trên màn
  // hình xem trước. Lề giấy thật chỉ do bốn padding quyết định, nhờ vậy vùng
  // nội dung mà preview dùng để phân trang khớp đúng với vùng nội dung của PDF.
  return `${PRINT_CSS}\n@page{size:A4;margin:${typography.paddingTop}mm ${typography.paddingRight}mm ${typography.paddingBottom}mm ${typography.paddingLeft}mm}`
```

Giữ nguyên dòng khai báo hàm phía trên (`export function printCSSForDesign(...)`) và xoá các biến `margin`, `top`, `right`, `bottom`, `left` cũ.

- [ ] **Step 8: Chuyển khe trang từ `marginBottom` sang `gap`**

Trong `frontend/apps/web-spa/src/components/PaginatedA4Document.tsx`, nhánh `pageGroups`: đặt `gap` trên container và bỏ `marginBottom` khỏi từng `<section>`. Container (dòng 68-74) thành:

```tsx
      <div
        id={id}
        data-testid="a4-document"
        aria-label={`CV ${pageGroups.length} trang`}
        className={`flex w-[210mm] flex-col ${className}`}
        style={{ gap: 'var(--cv-page-margin, 0mm)', ...style }}
      >
```

và trong `style` của `<section>` (dòng 81-90) xoá đúng dòng:

```tsx
              marginBottom: 'var(--cv-page-margin, 0mm)',
```

Nhánh còn lại (đo chiều cao, định vị tuyệt đối) giữ nguyên — nó không có khe giữa trang.

- [ ] **Step 9: Chạy lại ba test, xác nhận xanh**

```bash
cd frontend
npx vitest run --project unit packages/schema/test/cv.test.ts apps/web-spa/test/print.test.ts
npx vitest run --project ui apps/web-spa/test/paginated-a4.ui.test.tsx
```

Kỳ vọng: PASS cả ba file.

- [ ] **Step 10: Sửa nhãn trong panel**

`frontend/apps/web-spa/src/lib/i18n/messages.vi.ts` dòng 80 — đổi nghĩa khoá cũ và thêm khoá mới ngay dưới:

```ts
  pageMargin: 'Lề trang',
  pageGap: 'Khe giữa trang (chỉ xem trước)',
```

`frontend/apps/web-spa/src/lib/i18n/messages.en.ts` dòng 69:

```ts
  pageMargin: 'Page margins',
  pageGap: 'Page gap (preview only)',
```

`frontend/apps/web-spa/src/components/CVEditorView.tsx` dòng 341 — bỏ chuỗi tiếng Việt hardcode:

```tsx
                  ['pageMargin', t('pageGap')],
```

Dòng 335 (`{t('pageMargin')}`) giữ nguyên: nó là tiêu đề nhóm và giờ đọc là "Lề trang".

- [ ] **Step 11: Chạy toàn bộ test và typecheck**

```bash
cd frontend
npm run test
npm run typecheck
```

Kỳ vọng: PASS toàn bộ. Nếu có test khác khẳng định `pageMargin` mặc định là 0 hoặc khẳng định nhãn `'Margin trang'`, sửa kỳ vọng đó theo hành vi mới — đừng khôi phục mã.

- [ ] **Step 12: Commit**

```bash
git add frontend/packages/schema/src/cv.ts frontend/packages/schema/test/cv.test.ts \
  frontend/apps/web-spa/src/lib/cv-typography.ts frontend/apps/web-spa/src/lib/print-css.ts \
  frontend/apps/web-spa/src/components/PaginatedA4Document.tsx \
  frontend/apps/web-spa/src/components/CVEditorView.tsx \
  frontend/apps/web-spa/src/lib/i18n/messages.vi.ts frontend/apps/web-spa/src/lib/i18n/messages.en.ts \
  frontend/apps/web-spa/test/print.test.ts frontend/apps/web-spa/test/paginated-a4.ui.test.tsx
git commit -m "fix: pageMargin chỉ còn là khe giữa trang trong preview, default 20mm"
```

---

## Task 2: `CVBlockRenderer` render được lát cắt của item

Cho phép render một phần của item: có/không có head, và chỉ một số bullet theo index gốc.

**Files:**
- Modify: `frontend/apps/web-spa/src/components/CVBlockRenderer.tsx`
- Test: `frontend/apps/web-spa/test/cv-item-slices.ui.test.tsx` (tạo mới)

**Interfaces:**
- Consumes: không có.
- Produces:
  - `export interface CVItemSlice { head: boolean; highlights: number[] }`
  - Prop mới trên `CVBlockRendererProps`: `itemSlices?: Record<string, CVItemSlice>` — khoá là `item.id`. Vắng mặt hoặc không có khoá cho một item = render đầy đủ item đó. Task 3 dựng object này.

- [ ] **Step 1: Viết test đỏ**

Tạo `frontend/apps/web-spa/test/cv-item-slices.ui.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CVBlockRenderer } from '../src/components/CVBlockRenderer'
import { initialCVs } from './fixtures/cvs'
import type { CVLayout } from '../src/types'

const cv = initialCVs[0]!
const layout: CVLayout = {
  version: 1,
  nodes: [{ id: 'experience', type: 'experience', visible: true }],
}
const highlights = cv.sections.experience[0]!.highlights

function renderSlice(itemSlices?: Record<string, { head: boolean; highlights: number[] }>) {
  return render(
    <CVBlockRenderer
      cv={cv}
      layout={layout}
      variant="preview"
      nodeIds={['experience']}
      itemIds={{ experience: ['exp-1'] }}
      itemSlices={itemSlices}
    />,
  )
}

describe('item slices', () => {
  it('renders the whole item when no slice is given', () => {
    const { container } = renderSlice()

    expect(container.textContent).toContain('IMESPRO')
    expect(container.querySelectorAll('ul.cv-bullets li')).toHaveLength(4)
  })

  it('renders the head slice with only its leading bullets', () => {
    const { container } = renderSlice({ 'exp-1': { head: true, highlights: [0] } })

    expect(container.textContent).toContain('IMESPRO')
    const bullets = [...container.querySelectorAll('ul.cv-bullets li')]
    expect(bullets).toHaveLength(1)
    expect(bullets[0]!.textContent).toBe(highlights[0])
  })

  it('renders the tail slice without repeating the item head', () => {
    const { container } = renderSlice({ 'exp-1': { head: false, highlights: [2, 3] } })

    expect(container.textContent).not.toContain('IMESPRO')
    const bullets = [...container.querySelectorAll('ul.cv-bullets li')]
    expect(bullets).toHaveLength(2)
    expect(bullets[0]!.textContent).toBe(highlights[2])
    expect(bullets[1]!.textContent).toBe(highlights[3])
  })

  it('keeps the item selectable on every slice it appears in', () => {
    const { container } = renderSlice({ 'exp-1': { head: false, highlights: [3] } })

    expect(container.querySelector('[data-cv-item-id="exp-1"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd frontend
npx vitest run --project ui apps/web-spa/test/cv-item-slices.ui.test.tsx
```

Kỳ vọng: FAIL — TypeScript/React không biết prop `itemSlices`, và bài "tail slice" thấy `IMESPRO` vì head luôn được render.

- [ ] **Step 3: Khai báo kiểu và prop**

Trong `frontend/apps/web-spa/src/components/CVBlockRenderer.tsx`, ngay dưới `export type CVRenderVariant`:

```ts
/**
 * Một item bị cắt ngang trang: `head` cho biết trang này có render phần đầu
 * (chức danh, tổ chức, ngày, tech stack…) hay không, `highlights` là các index
 * GỐC trong mảng `highlights` mà trang này nhận. Vắng mặt = render đầy đủ.
 */
export interface CVItemSlice {
  head: boolean
  highlights: number[]
}
```

Thêm vào `CVBlockRendererProps`, ngay dưới `itemIds`:

```ts
  itemSlices?: Record<string, CVItemSlice>
```

- [ ] **Step 4: Truyền `itemSlices` xuống context**

Ở `export function CVBlockRenderer(...)` (cuối file): thêm `itemSlices` vào danh sách destructure và vào object truyền cho `nodeRenderers[node.type]({ ... })`. Sau khi sửa, hàm đọc như sau:

```tsx
export function CVBlockRenderer({ cv, layout, variant, onSelect, onEdit, nodeIds, itemIds, itemSlices, selectedNodeId, selectedItemId, changes, language }: CVBlockRendererProps) {
  const nodeIdSet = nodeIds ? new Set(nodeIds) : undefined
  return <>{layout.nodes.filter((node) => node.visible && (!nodeIdSet || nodeIdSet.has(node.id))).map((node) => <React.Fragment key={node.id}>{nodeRenderers[node.type]({ cv, layout, variant, onSelect, onEdit, node, itemIds, itemSlices, selectedNodeId, selectedItemId, changes, language })}</React.Fragment>)}</>
}
```

`RenderContext` kế thừa `CVBlockRendererProps` nên không cần sửa gì thêm ở đó.

- [ ] **Step 5: Cho `RegisteredHighlights` nhận danh sách index**

Thay hàm `RegisteredHighlights` (dòng 59-63) bằng:

```tsx
function RegisteredHighlights({ fieldKey = 'highlights', itemId, values, changes, changePath, indexes }: { fieldKey?: string; itemId: string; values: string[]; changes?: CVChangeMap; changePath?: string; indexes?: number[] }) {
  const definition = CV_FIELD_CATALOG.find((field) => field.key === fieldKey)
  // `indexes` là index GỐC, không phải vị trí sau khi lọc: `data-cv-change` tra
  // theo `${changePath}.${index}` nên đánh số lại sẽ trỏ nhầm ô diff.
  const picked = (indexes ?? values.map((_, index) => index)).filter((index) => values[index] != null)
  if (!definition || !picked.length) return null
  return <ul className="cv-bullets" data-cv-field={fieldKey} data-print-style={definition.printStyle}>{picked.map((index) => <li key={`${itemId}-${index}`} data-cv-change={changePath ? changes?.[`${changePath}.${index}`] : undefined}>{values[index]}</li>)}</ul>
}
```

- [ ] **Step 6: Cắt head và bullet trong `renderExperience`**

Trong `renderExperience`, thay thân của `items.map((item) => {...})` bằng:

```tsx
  const entries = items.map((item) => {
    const changed = changeAt(context, 'experience', item.id)
    const time = dateRange(item.startDate, item.current ? 'Present' : item.endDate)
    const slice = context.itemSlices?.[item.id]
    return <div className="cv-entry space-y-1" key={item.id} {...interactiveProps(context, item.id)}>
      {(!slice || slice.head) && <>
        <EntryHead
          title={<RegisteredValue fieldKey="role" value={item.title} change={changed('title')} />}
          organisation={item.company ? <RegisteredValue fieldKey="company" value={item.company} change={changed('company')} /> : null}
          date={time ? <RegisteredValue fieldKey="time" value={time} change={changed('startDate') ?? changed('endDate') ?? changed('current')} /> : null}
        />
        <div className="flex flex-wrap gap-x-3 text-xs"><RegisteredValue fieldKey="teamSize" value={item.teamSize} label="Team size" change={changed('teamSize')} /><RegisteredValue fieldKey="techStack" value={item.techStack} label="Tech stack" change={changed('techStack')} /></div>
      </>}
      <RegisteredHighlights itemId={item.id} values={item.highlights} indexes={slice?.highlights} changes={context.changes} changePath={`experience.${item.id}.highlights`} />
    </div>
  })
```

- [ ] **Step 7: Cắt head và bullet trong `renderProjects`**

Cùng khuôn, nhưng head của project gồm cả `link` và `contribution`:

```tsx
  const entries = items.map((item) => {
    const changed = changeAt(context, 'projects', item.id)
    const time = dateRange(item.startDate, item.endDate)
    const slice = context.itemSlices?.[item.id]
    return <div className="cv-entry space-y-1" key={item.id} {...interactiveProps(context, item.id)}>
      {(!slice || slice.head) && <>
        <EntryHead
          title={<RegisteredValue fieldKey="name" value={item.name} change={changed('name')} />}
          organisation={item.role ? <RegisteredValue fieldKey="role" value={item.role} change={changed('role')} /> : null}
          date={time ? <RegisteredValue fieldKey="time" value={time} change={changed('startDate') ?? changed('endDate')} /> : null}
        />
        {item.link && <RegisteredValue fieldKey="link" value={item.link} change={changed('link')} />}
        <div className="flex flex-wrap gap-x-3 text-xs"><RegisteredValue fieldKey="teamSize" value={item.teamSize} label="Team size" change={changed('teamSize')} /><RegisteredValue fieldKey="techStack" value={item.techStack} label="Tech stack" change={changed('techStack')} /></div>
        {item.contribution && <p><RegisteredValue fieldKey="contribution" value={item.contribution} label="Contribution" change={changed('contribution')} /></p>}
      </>}
      <RegisteredHighlights itemId={item.id} values={item.highlights} indexes={slice?.highlights} changes={context.changes} changePath={`projects.${item.id}.highlights`} />
    </div>
  })
```

- [ ] **Step 8: Cắt head và bullet trong `renderEducation`**

Head của education gồm cả `gpa`:

```tsx
  const entries = items.map((item) => {
    const changed = changeAt(context, 'education', item.id)
    const time = dateRange(item.startDate, item.endDate)
    const slice = context.itemSlices?.[item.id]
    return <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}>
      {(!slice || slice.head) && <>
        <EntryHead
          title={<RegisteredValue fieldKey="school" value={item.school} change={changed('school')} />}
          organisation={item.degree || item.fieldOfStudy ? <><RegisteredValue fieldKey="degree" value={item.degree} change={changed('degree')} />{item.degree && item.fieldOfStudy ? ' — ' : ''}<RegisteredValue fieldKey="field" value={item.fieldOfStudy} change={changed('fieldOfStudy')} /></> : null}
          date={time ? <RegisteredValue fieldKey="time" value={time} change={changed('startDate') ?? changed('endDate')} /> : null}
        />
        {item.gpa && <p><RegisteredValue fieldKey="gpa" value={item.gpa} label="GPA" change={changed('gpa')} /></p>}
      </>}
      <RegisteredHighlights itemId={item.id} values={item.highlights ?? []} indexes={slice?.highlights} changes={context.changes} changePath={`education.${item.id}.highlights`} />
    </div>
  })
```

Không đụng tới `renderSkills`, `renderActivities`, `renderCertifications`, `renderLanguages`, `renderSummary`, `renderHeader`, `renderFooter` — các node đó không tách.

- [ ] **Step 9: Chạy test, xác nhận xanh**

```bash
cd frontend
npx vitest run --project ui apps/web-spa/test/cv-item-slices.ui.test.tsx
```

Kỳ vọng: PASS cả 4 bài.

- [ ] **Step 10: Chạy toàn bộ test và typecheck**

```bash
cd frontend
npm run test
npm run typecheck
```

Kỳ vọng: PASS. Các test render sẵn có không truyền `itemSlices` nên phải giữ nguyên kết quả — nếu có bài đỏ, đó là hồi quy thật, sửa mã chứ đừng sửa kỳ vọng.

- [ ] **Step 11: Commit**

```bash
git add frontend/apps/web-spa/src/components/CVBlockRenderer.tsx frontend/apps/web-spa/test/cv-item-slices.ui.test.tsx
git commit -m "feat: CVBlockRenderer render được lát cắt head/bullet của một item"
```

---

## Task 3: `CVPageComposer` phân trang theo bullet

Sinh sub-segment cho ba node tách được, đo chiều cao ở mức bullet, và gom sub-segment của mỗi trang thành `itemSlices`.

**Files:**
- Modify: `frontend/apps/web-spa/src/components/CVPageComposer.tsx`
- Test: `frontend/apps/web-spa/test/cv-page-segments.ui.test.tsx` (tạo mới), `frontend/apps/web-spa/test/paginated-a4.ui.test.tsx` (thêm một bài)

**Interfaces:**
- Consumes: `CVItemSlice` và prop `itemSlices` của `CVBlockRenderer` (Task 2).
- Produces (export mới từ `CVPageComposer.tsx`, dùng cho test và không dùng ở nơi khác):
  - `segmentsForLayout(cv: CV, layout: CVLayout): string[]`
  - `parseSegment(segment: string): { nodeId: string; itemId?: string; part?: 'head' | number }`
  - `heightsForItem(item?: Element): { head: number; highlights: number[] }`
  - `pageSlices(pageSegments: string[]): { nodeIds: string[]; itemIds: Record<string, string[]>; itemSlices: Record<string, CVItemSlice> }`
  - `pageGroupsForNodes` giữ nguyên chữ ký cũ, không sửa.

- [ ] **Step 1: Viết test đỏ cho bốn hàm thuần**

Tạo `frontend/apps/web-spa/test/cv-page-segments.ui.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { heightsForItem, pageGroupsForNodes, pageSlices, parseSegment, segmentsForLayout } from '../src/components/CVPageComposer'
import { initialCVs } from './fixtures/cvs'
import type { CVLayout } from '../src/types'

const cv = initialCVs[0]!
const layout: CVLayout = {
  version: 1,
  nodes: [
    { id: 'summary', type: 'summary', visible: true },
    { id: 'experience', type: 'experience', visible: true, itemOrder: ['exp-2', 'exp-1'] },
  ],
}

function stubHeight(element: Element, height: number) {
  element.getBoundingClientRect = () => ({ height }) as DOMRect
}

describe('page segments', () => {
  it('emits one head segment plus one segment per bullet for splittable items', () => {
    expect(segmentsForLayout(cv, layout)).toEqual([
      'summary',
      'experience::exp-2::head', 'experience::exp-2::h0', 'experience::exp-2::h1',
      'experience::exp-1::head', 'experience::exp-1::h0', 'experience::exp-1::h1', 'experience::exp-1::h2', 'experience::exp-1::h3',
    ])
  })

  it('parses all three segment shapes', () => {
    expect(parseSegment('summary')).toEqual({ nodeId: 'summary' })
    expect(parseSegment('experience::exp-1::head')).toEqual({ nodeId: 'experience', itemId: 'exp-1', part: 'head' })
    expect(parseSegment('experience::exp-1::h12')).toEqual({ nodeId: 'experience', itemId: 'exp-1', part: 12 })
  })

  it('measures the item head as the item minus its bullet list', () => {
    const item = document.createElement('div')
    const list = document.createElement('ul')
    list.className = 'cv-bullets'
    const first = document.createElement('li')
    const second = document.createElement('li')
    list.append(first, second)
    item.append(list)
    stubHeight(item, 300)
    stubHeight(list, 180)
    stubHeight(first, 80)
    stubHeight(second, 100)

    expect(heightsForItem(item)).toEqual({ head: 120, highlights: [80, 100] })
  })

  it('measures an item without bullets as head only', () => {
    const item = document.createElement('div')
    stubHeight(item, 90)

    expect(heightsForItem(item)).toEqual({ head: 90, highlights: [] })
  })

  it('groups the sub-segments of a page into node ids, item ids and slices', () => {
    expect(pageSlices(['experience::exp-1::h2', 'experience::exp-1::h3', 'education::edu-1::head'])).toEqual({
      nodeIds: ['experience', 'education'],
      itemIds: { experience: ['exp-1'], education: ['edu-1'] },
      itemSlices: { 'exp-1': { head: false, highlights: [2, 3] }, 'edu-1': { head: true, highlights: [] } },
    })
  })

  it('keeps the leading bullets with the item head and flows the rest to the next page', () => {
    const segments = ['experience::exp-1::head', ...Array.from({ length: 5 }, (_, index) => `experience::exp-1::h${index}`)]
    const heights = new Map(segments.map((segment) => [segment, 100]))

    expect(pageGroupsForNodes(segments, heights, 400)).toEqual([
      ['experience::exp-1::head', 'experience::exp-1::h0', 'experience::exp-1::h1', 'experience::exp-1::h2'],
      ['experience::exp-1::h3', 'experience::exp-1::h4'],
    ])
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd frontend
npx vitest run --project ui apps/web-spa/test/cv-page-segments.ui.test.tsx
```

Kỳ vọng: FAIL — `segmentsForLayout`, `parseSegment`, `heightsForItem`, `pageSlices` chưa được export.

- [ ] **Step 3: Viết bộ hàm thuần trong `CVPageComposer.tsx`**

Thay hai hàm `segmentNodeId`/`segmentItemId` (dòng 48-55) bằng khối dưới đây, và thêm `import type { CVItemSlice }` vào dòng import `CVBlockRenderer`:

```tsx
const SPLITTABLE_SECTIONS = ['experience', 'projects', 'education'] as const

interface ParsedSegment {
  nodeId: string
  itemId?: string
  /** 'head' = phần đầu item; số = index GỐC của một gạch đầu dòng. */
  part?: 'head' | number
}

function parseSegment(segment: string): ParsedSegment {
  const [nodeId, itemId, part] = segment.split(SEGMENT_SEPARATOR)
  if (!itemId) return { nodeId: nodeId! }
  if (part === 'head') return { nodeId: nodeId!, itemId, part: 'head' }
  return { nodeId: nodeId!, itemId, part: Number(part!.slice(1)) }
}

function segmentsForLayout(cv: CV, layout: CVLayout): string[] {
  // Khoá theo `type:id` chứ không riêng id: hai section khác nhau về lý thuyết
  // có thể mang trùng id item, và nhầm ở đây thì số bullet sẽ sai câm.
  const highlightCounts = new Map<string, number>()
  for (const type of SPLITTABLE_SECTIONS) {
    for (const item of cv.sections[type]) highlightCounts.set(`${type}:${item.id}`, item.highlights?.length ?? 0)
  }
  const itemIdsByNode = new Map<string, string[]>(SPLITTABLE_SECTIONS.map((type) => [
    type,
    orderedItemIds(cv.sections[type], layout.nodes.find((node) => node.type === type && 'itemOrder' in node)?.itemOrder),
  ]))
  return layout.nodes.filter((node) => node.visible).flatMap((node) => {
    if (!SPLITTABLE_NODES.has(node.type)) return [node.id]
    const itemIds = itemIdsByNode.get(node.type) ?? []
    return itemIds.flatMap((itemId) => {
      const base = `${node.id}${SEGMENT_SEPARATOR}${itemId}`
      const count = highlightCounts.get(`${node.type}:${itemId}`) ?? 0
      return [`${base}${SEGMENT_SEPARATOR}head`, ...Array.from({ length: count }, (_, index) => `${base}${SEGMENT_SEPARATOR}h${index}`)]
    })
  })
}

function heightOf(element?: Element): number {
  if (!element) return 0
  return element.getBoundingClientRect().height || (element as HTMLElement).offsetHeight || 0
}

function bulletListOf(item?: Element): Element | undefined {
  // Duyệt con trực tiếp thay vì `:scope > ul.cv-bullets` — bám vào cấu trúc thật
  // của `.cv-entry` và không phụ thuộc mức hỗ trợ selector của môi trường test.
  return item ? [...item.children].find((child) => child.classList.contains('cv-bullets')) : undefined
}

function heightsForItem(item?: Element): { head: number; highlights: number[] } {
  const list = bulletListOf(item)
  return {
    head: heightOf(item) - heightOf(list),
    highlights: list ? [...list.children].map((bullet) => heightOf(bullet)) : [],
  }
}

function pageSlices(pageSegments: string[]): { nodeIds: string[]; itemIds: Record<string, string[]>; itemSlices: Record<string, CVItemSlice> } {
  const nodeIds: string[] = []
  const itemIds: Record<string, string[]> = {}
  const itemSlices: Record<string, CVItemSlice> = {}
  for (const segment of pageSegments) {
    const { nodeId, itemId, part } = parseSegment(segment)
    if (!nodeIds.includes(nodeId)) nodeIds.push(nodeId)
    if (!itemId) continue
    if (!itemIds[nodeId]) itemIds[nodeId] = []
    if (!itemIds[nodeId]!.includes(itemId)) itemIds[nodeId]!.push(itemId)
    if (!itemSlices[itemId]) itemSlices[itemId] = { head: false, highlights: [] }
    if (part === 'head') itemSlices[itemId]!.head = true
    else if (typeof part === 'number') itemSlices[itemId]!.highlights.push(part)
  }
  return { nodeIds, itemIds, itemSlices }
}
```

Sửa dòng export cuối file thành:

```tsx
export { heightsForItem, pageGroupsForNodes, pageSlices, parseSegment, segmentsForLayout }
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

```bash
cd frontend
npx vitest run --project ui apps/web-spa/test/cv-page-segments.ui.test.tsx
```

Kỳ vọng: PASS cả 6 bài.

- [ ] **Step 5: Nối bộ hàm mới vào component**

Trong `CVPageComposer`, thay khối dựng `itemIdsByNode` + `segments` (dòng 59-68) bằng một dòng:

```tsx
  const segments = segmentsForLayout(cv, layout)
```

Khối `itemIdsByNode` cũ trong thân component bị xoá hẳn. Hàm `orderedItemIds` ở đầu file **giữ nguyên** — giờ nó được gọi từ `segmentsForLayout` thay vì từ thân component. Biến `visibleNodeIds` vẫn cần cho state khởi tạo, nhánh CV rỗng và khối đo ẩn, đừng xoá.

Thay vòng lặp đo (dòng 83-94) bằng:

```tsx
    const heights = new Map<string, number>()
    const itemHeights = new Map<string, { head: number; highlights: number[] }>()
    for (const segment of segments) {
      const { nodeId, itemId, part } = parseSegment(segment)
      const element = [...measurement.querySelectorAll<HTMLElement>('[data-cv-node-id]')]
        .find((candidate) => candidate.dataset.cvNodeId === nodeId)
      if (!itemId) {
        heights.set(segment, heightOf(element))
        continue
      }
      const cacheKey = `${nodeId}${SEGMENT_SEPARATOR}${itemId}`
      if (!itemHeights.has(cacheKey)) {
        const item = element ? [...element.querySelectorAll<HTMLElement>('[data-cv-item-id]')]
          .find((candidate) => candidate.dataset.cvItemId === itemId) : undefined
        itemHeights.set(cacheKey, heightsForItem(item))
      }
      const measured = itemHeights.get(cacheKey)!
      heights.set(segment, part === 'head' ? measured.head : (measured.highlights[part as number] ?? 0))
    }
```

Thay thân `renderPage` (dòng 113-127) bằng:

```tsx
        renderPage={(pageSegments) => {
          const { nodeIds, itemIds, itemSlices } = pageSlices(pageSegments)
          return (
          <div className="cv-page-flow" style={{ lineHeight: 'var(--cv-line-height)' }}>
            <CVBlockRenderer cv={cv} layout={layout} variant={variant} nodeIds={nodeIds} itemIds={itemIds} itemSlices={itemSlices} selectedNodeId={selectedNodeId} selectedItemId={selectedItemId} onSelect={onSelect} onEdit={onEdit} language={language} />
          </div>
          )
        }}
```

Giữ nguyên `contentHeightPx`, `measurementKey`, khối đo ẩn và `pageGroupsForNodes`.

- [ ] **Step 6: Viết test đầu-cuối cho composer**

Thêm vào cuối `frontend/apps/web-spa/test/cv-page-segments.ui.test.tsx`:

```tsx
describe('CVPageComposer', () => {
  it('paginates the item head and its bullets as separate units', () => {
    const segments = segmentsForLayout(cv, layout)
    const heights = new Map(segments.map((segment) => [segment, 100]))
    const pages = pageGroupsForNodes(segments, heights, 300)

    const first = pageSlices(pages[0]!)
    expect(first.itemSlices['exp-2']).toEqual({ head: true, highlights: [0] })

    const carried = pages.flatMap((page) => pageSlices(page).itemSlices['exp-2']?.highlights ?? [])
    expect(carried).toEqual([0, 1])
  })
})
```

`segments` bắt đầu bằng `summary` (100), rồi `exp-2::head` (100), `exp-2::h0` (100) — vừa đúng 300, nên `exp-2::h1` sang trang sau.

- [ ] **Step 7: Chạy test, xác nhận xanh**

```bash
cd frontend
npx vitest run --project ui apps/web-spa/test/cv-page-segments.ui.test.tsx apps/web-spa/test/paginated-a4.ui.test.tsx
```

Kỳ vọng: PASS.

- [ ] **Step 8: Chạy toàn bộ test và typecheck**

```bash
cd frontend
npm run test
npm run typecheck
```

Kỳ vọng: PASS toàn bộ. Test nào khẳng định preview đặt trọn một item trên một trang là kỳ vọng cũ đã lỗi thời — sửa nó theo hành vi mới và ghi lý do trong commit.

- [ ] **Step 9: Commit**

```bash
git add frontend/apps/web-spa/src/components/CVPageComposer.tsx frontend/apps/web-spa/test/cv-page-segments.ui.test.tsx
git commit -m "feat: preview cắt trang theo từng gạch đầu dòng thay vì đẩy nguyên item"
```

---

## Kiểm chứng cuối

Sau khi cả ba task xong:

```bash
cd frontend
npm run test
npm run typecheck
npm run lint
```

Kiểm tra bằng mắt trên ứng dụng thật: mở một CV có item nhiều gạch đầu dòng, kéo slider "Padding dưới" và xác nhận (a) block cuối trang bị cắt giữa chừng thay vì nhảy nguyên khối, (b) không phần tử nào vượt quá đáy vùng nội dung, (c) khe giữa hai tờ giấy đúng 20mm ở mặc định, (d) PDF tải về có lề đúng bằng padding, không cộng thêm.
