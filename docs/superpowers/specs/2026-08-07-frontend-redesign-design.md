# Thiết kế lại frontend HR-Agent

| | |
|---|---|
| **Ngày** | 2026-08-07 |
| **Trạng thái** | Đã duyệt, chờ lập kế hoạch triển khai |
| **Phụ thuộc** | [TDD.md](../../TDD.md) §2.4 · §3.2 A7 · §8.2.3 · [FRONTEND.md](../../FRONTEND.md) §3.1 · §8.1 · §9.3 · [PRODUCT.md](../../PRODUCT.md) §6.1 |

---

## 1. Vấn đề

Giao diện hiện tại chạy đúng nhưng đọc như một bản nháp kỹ thuật. Đo được trên
mã nguồn ngày 2026-08-07:

| Chỉ số | Giá trị |
|---|---:|
| Dòng TSX | 5.136 |
| Component + page | 25 + 13 |
| Lượt dùng màu, toàn bộ là palette thô Tailwind | 586 |
| Token thiết kế | 0 |
| Mẫu nút lặp lại (`bg-sky-600 px-4 py-2`) | 7 |
| Mẫu thẻ lặp lại (`rounded-xl border p-4`) | 7 |

Ba hệ quả:

**Không có phân cấp thị giác.** Trên màn Trang chủ, bốn khối dùng chung một
kiểu viền, một bo góc, một cỡ chữ nhãn. Mắt không có điểm vào.

**Số liệu không mang nghĩa.** `44%` hiển thị bằng `font-medium tabular-nums`,
không màu, không nhãn, không phân rã. Con số cần diễn giải nhất lại là con số
trần trụi nhất — và lỗi này lặp ở cả `ReportView`.

**Tài liệu không xuất hiện.** Sản phẩm xoay quanh một bản CV, nhưng không màn
hình nào ngoài `/builder` cho thấy nó.

### 1.1 Hai lỗi phát hiện khi khảo sát

**Font Be Vietnam Pro được khai nhưng chưa bao giờ được nạp.** `globals.css`
khai `--font-ui`, `packages/templates/src/styles.css` khai `--cv-font`, nhưng
repo không có `@font-face`, không `next/font`, không file `.woff2` nào. Cả app
lẫn **bản CV xuất ra PDF** đang chạy bằng font thay thế của hệ thống; worker
Dockerfile chỉ cài DejaVu, Liberation và Noto.

**`PatchReviewModal` thiếu a11y cơ bản.** Có `role="dialog"` và
`aria-modal="true"` nhưng không xử lý `Escape`, không bẫy focus, không trả focus
về nơi đã mở. Đây là modal chặn mọi thay đổi từ AI — dùng bằng bàn phím sẽ lạc.

---

## 2. Quyết định đã chốt

| # | Quyết định | Ghi chú |
|---|---|---|
| D1 | **Teal + Ink** làm hệ màu thương hiệu | Thị trường tuyển dụng VN kín màu đỏ (TopCV, ITviec) và xanh dương (VietnamWorks); teal đứng riêng mà vẫn đọc là tin cậy |
| D2 | **Top nav cho workspace thao tác; sidebar cho dashboard đã đăng nhập** | Giữ trọn chiều ngang cho `/builder` ở 1366×768; Home/CV/settings cần rail ổn định để quét nhanh theo dashboard spec 2026-08-08 |
| D3 | **AI nổi bật theo cả ba cách**, đặt ở ba tầng khác nhau | Bề mặt · lối vào · chứng cứ — xem §5 |
| D4 | **Chỉ chế độ sáng**, gỡ toàn bộ `dark:` | Bớt một bảng màu phải chăm; `/print` vốn luôn sáng |
| D5 | **Hệ màu + tái cấu trúc màn hình** | Đổi màu suông không chữa được vấn đề phân cấp |
| D6 | **Token + primitive tự viết**, không thêm dependency UI | Radix/shadcn để dành, chỉ thêm khi có nhu cầu cụ thể |
| D7 | Ràng buộc primitive là **khuyến nghị**, không phải lỗi biên dịch | Cảnh báo `console.warn` ở dev, im lặng ở production |
| D8 | **Điểm khớp JD không tô màu** | TDD §8.2.3 cấm khẳng định ngưỡng tuyệt đối — xem §5.4 |
| D9 | **`/print` nằm ngoài phạm vi** | Nó là đầu vào của file PDF người dùng nộp đi |

---

## 3. Tầng token

Khai trong `apps/web/app/globals.css` bằng `@theme` của Tailwind v4.

### 3.1 Màu

Ba nhóm tách bạch. **Không nhóm nào mượn màu của nhóm khác.**

```css
@theme {
  /* Thương hiệu — dùng cho brand VÀ cho mọi vùng AI, không dùng cho gì khác */
  --color-brand:        #0D9488;
  --color-brand-hover:  #0F766E;
  --color-brand-subtle: #F0FDFA;
  --color-brand-border: #99F6E4;
  --color-brand-ink:    #134E4A;

  /* Mực và nền */
  --color-ink:          #0F172A;
  --color-ink-muted:    #475569;
  --color-ink-subtle:   #94A3B8;
  --color-surface:      #FFFFFF;
  --color-canvas:       #F8FAFC;
  --color-border:       #E2E8F0;
  --color-border-strong:#CBD5E1;

  /* Trạng thái — không bao giờ dùng teal */
  --color-success:        #059669;
  --color-success-subtle: #ECFDF5;
  --color-warn:           #D97706;
  --color-warn-subtle:    #FFFBEB;
  --color-danger:         #DC2626;
  --color-danger-subtle:  #FEF2F2;
}
```

**Quy tắc một dòng:** teal chỉ dành cho thương hiệu và AI. Thấy teal là biết máy
đang tham gia. Trạng thái không mượn teal; AI không mượn xanh lá / vàng / đỏ.

### 3.2 Chữ

Nạp Be Vietnam Pro thật bằng `next/font/local`, file `.woff2` đặt trong repo
(`apps/web/app/fonts/`) — không gọi mạng, đúng ý định ghi ở `globals.css`. Thêm
cùng font vào `services/worker/Dockerfile` để PDF khớp bản xem trước.

> **Cập nhật khi triển khai:** đã đo bằng Playwright thật và quyết định KHÔNG
> cần bước này — `/print` tải `.woff2` qua HTTP từ chính web app, cùng origin
> với trang Chromium vừa mở. Số liệu đo và lý do đầy đủ ở
> [FRONTEND.md §12.2](../../FRONTEND.md#122-chữ).

Thang chữ nới rộng hơn mặc định vì dấu tiếng Việt chồng cả trên lẫn dưới
(`ệ`, `ữ`, `ợ`):

| Vai | Cỡ / dòng | Đậm |
|---|---|---|
| `display` | 30 / 38 | 600 |
| `h1` | 24 / 32 | 600 |
| `h2` | 18 / 28 | 600 |
| `h3` | 15 / 22 | 600 |
| `body` | 15 / 24 | 400 |
| `small` | 13 / 20 | 400 |
| `micro` | 12 / 16 | 500 |

`body` 15px chứ không 14px: người dùng đọc trên laptop 1366, và chữ có dấu ở
14px bắt đầu dính nét.

### 3.3 Còn lại

- **Khoảng cách:** bội số 4 — `4 8 12 16 24 32 48 64`
- **Bo góc:** `sm 6` · `md 10` · `lg 14` · `full`
- **Bóng:** đúng hai mức — `sm` cho thẻ nổi, `md` cho lớp phủ. Không có mức ba.

---

## 4. Bộ primitive

Đặt ở `apps/web/components/ui/`. Tám cái.

| Primitive | Trách nhiệm | Thay cho |
|---|---|---|
| `Button` | 4 kiểu (`primary`/`secondary`/`ghost`/`danger`), 2 cỡ, trạng thái disabled kèm lý do | 7 chỗ lặp |
| `Card` | vỏ thẻ; biến thể `default` / `ai` / `raised` | 7 chỗ lặp |
| `Section` | tiêu đề mục + hành động phụ + khoảng cách | `<h2 className="text-sm uppercase…">` lặp 3× |
| `Badge` | nhãn trạng thái, **luôn icon + chữ** (FRONTEND §9.8) | span màu rời rạc |
| `Meter` | thanh số liệu kèm phân rã | `CompletenessBar` viết tay |
| `Dialog` | modal + toàn bộ a11y | `PatchReviewModal` |
| `Sheet` | slide-over + toàn bộ a11y | `ChatPanel` |
| `Field` | nhãn + input + gợi ý + lỗi, nối `aria-describedby` | form rải rác |

### 4.1 Hai API mang doctrine

Theo D7, cả hai là **khuyến nghị**: prop tuỳ chọn, thiếu thì `console.warn` ở
`NODE_ENV !== 'production'`, im lặng khi chạy thật.

```tsx
// Button — FRONTEND §8.1: khi AI chết, nút phải MỜ ĐI kèm giải thích, KHÔNG
// biến mất (biến mất làm người dùng tưởng mình thao tác sai).
<Button disabled={!aiUp} disabledReason="Trợ lý AI đang tạm ngưng">

// Meter — BR-02.1: không phần trăm nào mà người dùng không tra được nguồn.
<Meter value={85} label="Hồ sơ đã đầy đủ" parts={completeness.parts} />
```

### 4.2 `Dialog` và `Sheet` nhận trách nhiệm a11y

Cả hai phải làm, và phải có test:

- `Escape` đóng
- Focus chuyển vào lớp phủ khi mở
- `Tab` không thoát ra ngoài lớp phủ
- Trả focus về phần tử đã mở nó khi đóng
- Khoá cuộn nền
- `aria-labelledby` trỏ tới tiêu đề

### 4.3 Cố tình không có

`Tooltip` (chỉ `Button` cần — gộp vào nó) · `Modal` chung chung (đã có `Dialog`)
· `Grid`/`Stack` (Tailwind làm rồi) · `EmptyState` (ghép `Card` + `Button`).

---

## 5. Chữ ký AI và degrade

### 5.1 Tầng bề mặt

Mọi vùng có AI tham gia mang cùng một chữ ký:

```
┌────────────────────────────────────────────┐
│▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  ← dải 3px teal→nhạt │
│  ✦ Trợ lý                                  │
│                                            │
│  Phần kinh nghiệm có 4 gạch đầu dòng chỉ   │
│  mô tả nhiệm vụ...                         │
│                                            │
│  [Cùng tôi sửa]  [Để sau]                  │
└────────────────────────────────────────────┘
   nền brand-subtle · viền brand-border
```

Gradient **chỉ** nằm ở dải 3px phía trên, không phủ nền — đủ để nhận ra, không
đủ làm chữ khó đọc. Chuyển động duy nhất: shimmer trên dải đó **khi đang
stream**, đứng yên khi xong, tắt hẳn nếu `prefers-reduced-motion: reduce`.

### 5.2 Tầng lối vào

Nút `✦ Trợ lý` cố định bên phải top nav ở mọi màn. **Luôn mang theo ngữ cảnh:**

| Ở đâu | Mở ra gì |
|---|---|
| `/builder/:cvId` | `Sheet` với CV đang sửa |
| `/analyze/:cvId` | `Sheet` kèm báo cáo đối chiếu |
| `/` hoặc `/cv` | Hỏi chọn CV trước — **không mở chat rỗng** (BR-56.2) |

### 5.3 Tầng chứng cứ

Trong mọi output của AI:

- Diff trước/sau cho từng op
- Badge nguồn theo `grounding.type` — 4 loại theo FRONTEND §6.2; `inference`
  màu vàng và **không tick sẵn**
- Dấu ⚪ cho nội dung chưa xác nhận (CSS đã có ở `globals.css`)

### 5.4 Điểm khớp JD — không tô màu (D8)

TDD §8.2.3 ghi: đo thực tế cho 41 điểm và 41 là **đúng**; thứ có ý nghĩa là
**thứ tự tương đối**, không phải vạch ngưỡng. Vì vậy bỏ hẳn nhãn kiểu
"Cần cải thiện" và không tô màu con số.

```
Junior Full-stack Developer · ABC          44
                                    ▬▬▬▬▬▬▬▬▬▬
Thiếu 4/11 kỹ năng JD yêu cầu · 8/9 từ khoá ATS chưa có
Kỹ năng ▓▓▓░░  Kinh nghiệm ▓▓░░░  Học vấn ▓▓▓▓░  ATS ▓░░░░

So với 2 lần đối chiếu khác của bạn: cao nhất
```

Con số để màu `ink` trung tính. Dòng dưới là **sự thật đếm được**; dòng cuối là
**thứ tự tương đối** — đúng thứ §8.2.3 nói là có nghĩa.

### 5.5 Degrade — bắt buộc thiết kế

Tầng 5.1 làm khối AI to, nên phải thiết kế lúc model chết, nếu không khối lộng
lẫy nhất màn hình sẽ thành khối rỗng nhất.

```
┌────────────────────────────────────────────┐
│  ○ Trợ lý đang tạm ngưng                   │  ← không gradient
│                                            │     nền canvas, viền border
│  Bạn vẫn sửa CV, đổi mẫu và tải file      │
│  bình thường.                              │
│                                            │
│  [Thử lại]                                 │
└────────────────────────────────────────────┘
```

Khối **giữ nguyên kích thước**, đổi sang trung tính, và nói rõ việc gì vẫn làm
được. Nút cần AI: `disabled` kèm `disabledReason`. Các nút không cần AI phải
vẫn bấm được (TDD §3.2 A7).

---

## 6. Tái cấu trúc màn hình

| Nhóm | Màn hình | Làm gì |
|---|---|---|
| **A** | `/` (3 biến thể), `/builder/:cvId`, `/analyze/:cvId` | dựng lại bố cục |
| **B** | `/import`, `/import/:jobId/review`, `/cv`, `/cv/new`, `/diagnose/:cvId`, `/start/guided`, `/settings`, `/kb`, `/login` | giữ bố cục, thay lớp trình bày |
| **C** | `/print/:cvId` | **không đụng** (D9) |

### 6.1 `CvThumbnail`

Thành phần mới, giải quyết "tài liệu không xuất hiện" mà không cần backend:

```tsx
// Render CHÍNH component @hr/templates, thu nhỏ bằng CSS transform.
// A4 ở 96dpi = 794px → scale(width / 794).
<CvThumbnail profile={profile} theme={theme} width={160} />
```

Không Playwright, không cache, không route mới, không invalidation. Luôn khớp
bản thật vì **nó chính là bản thật**. FRONTEND §9.3 vốn đã ghi component này
dùng ở ba nơi, nơi thứ ba là thumbnail — chỉ là chưa làm.

Phải chịu được `profile` rỗng hoặc thiếu section mà không nổ.

### 6.2 `/` — ReturningHome

```
┌───────────────────────────────────────────────────────┐
│ ▍HR-Agent  Trang chủ  CV  Đối chiếu    ✦Trợ lý  Hải ▾ │
├───────────────────────────────────────────────────────┤
│  Chào buổi tối, Hải                                   │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │ ┌──────┐ LE THANH HAI                           │  │
│  │ │▒▒▒▒▒▒│ Junior Full-stack Developer            │  │ ◀ KHỐI CHÍNH
│  │ │▒ CV ▒│ Sửa 6 giờ trước                        │  │   surface + bóng sm
│  │ │▒▒▒▒▒▒│                                        │  │
│  │ └──────┘ Hồ sơ đầy đủ 85% ▬▬▬▬▬▬▬▬▬▬▬░          │  │
│  │ thumbnail  Gồm những gì?                        │  │
│  │           [Tiếp tục chỉnh CV] [Xem CV]          │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔┐  │
│  │ ✦ Trợ lý                                        │  │ ◀ KHỐI AI
│  │ Thêm số liệu vào các gạch đầu dòng — con số là  │  │   brand-subtle
│  │ thứ nhà tuyển dụng nhớ                          │  │
│  │ [Cùng tôi sửa] [Để sau]                         │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ĐỐI CHIẾU GẦN ĐÂY                       Xem tất cả   │ ◀ KHỐI PHỤ
│  Junior Full-stack Developer          hôm nay     44  │   dòng trần
│  Backend Developer                    3 ngày trước 72 │   không viền
└───────────────────────────────────────────────────────┘
```

Ba mức trọng số rõ rệt thay cho bốn khối viền xám giống hệt nhau.

**Ba lỗi sửa kèm:**

1. `apps/web/app/page.tsx:130` truyền `greet(null)` cứng — truyền tên người dùng vào.
2. Danh sách đối chiếu trùng lặp: khử theo `jd_id`, giữ bản mới nhất.
3. Thêm mốc thời gian mỗi dòng để hai lần đối chiếu không còn giống hệt nhau.

Hai dòng phân biệt nhau bằng **tiêu đề + mốc thời gian**. Tên công ty sẽ phân
biệt tốt hơn nhưng `JobDescriptionSchema` hiện chỉ có `title`, không có
`company` — thêm field là thay đổi schema, nằm ngoài phạm vi (§9).

**`IntentRouter`** (chưa có hồ sơ) và **`ResumeHome`** (đang dở) nhận cùng ngôn
ngữ thị giác: một khối chính chiếm ưu thế, không có ô rỗng.

### 6.3 `/builder/:cvId`

Giữ 2 pane theo FRONTEND §3.1. Top nav mảnh mang tên CV sửa tại chỗ, `[Xuất]`,
`[✦ Trợ lý]`. Mục lục 240px; bản xem trước lấy toàn bộ phần còn lại (~980px ở
1366). Chat chuyển sang `Sheet`.

### 6.4 `/analyze/:cvId`

Áp cách hiện điểm ở §5.4. Mỗi gap là một `Card`; biến thể `ai` khi có lời khuyên
từ AI, kèm badge nguồn theo `grounding.type`.

---

## 7. Di trú và kiểm thử

### 7.1 Thứ tự

| Bước | Việc | Vì sao ở vị trí này |
|---|---|---|
| 1 | Token vào `@theme` | Chỉ thêm, không đổi gì đang chạy |
| 2 | Font thật + Dockerfile worker | Độc lập, kiểm bằng PDF xuất ra |
| 3 | 8 primitive + test của chúng | Chưa ai dùng, chưa thể làm vỡ gì |
| 4 | **Chỉ màn `/`** — lát cắt dọc đầu | Dùng thật cả token, primitive, `CvThumbnail`, chữ ký AI |
| 5 | Nhóm B — 9 màn còn lại | Lặp lại khuôn đã kiểm chứng |
| 6 | Nhóm A — `/builder`, `/analyze` | Phức tạp nhất, làm khi khuôn đã chắc |
| 7 | Quét nốt `dark:` / palette thô còn sót, bật rule chặn | Bước 4–6 đã gỡ phần lớn khi đi qua từng màn; bước này dọn phần còn lại rồi khoá lại |

Bước 4 là điểm mấu chốt: nếu tầng token thiết kế sai, ta biết sau khi sửa **một**
màn hình chứ không phải mười hai.

### 7.2 Lưới an toàn sẵn có

627 test / 33 file đang xanh. Kiểm tra ngày 2026-08-07: **không test UI nào bám
vào `className`** — toàn bộ 76 truy vấn dùng `getByRole` / `getByText` /
`getByLabelText`. Đổi style không làm vỡ test.

### 7.3 Test mới

```
Dialog / Sheet — bàn phím thật, không mock
  · Escape đóng, và trả focus về nút đã mở nó
  · Tab không thoát khỏi lớp phủ
  · aria-labelledby trỏ đúng tiêu đề
Meter       · mở ra thấy đủ parts
Button      · disabled + disabledReason đọc được qua aria-describedby
CvThumbnail · profile rỗng / thiếu section → không nổ
Degrade     · model chết → khối AI trung tính, nút cần AI mờ kèm lý do,
              nút không cần AI vẫn bấm được
```

Test degrade quan trọng nhất — nó khoá ràng buộc A7 ("degrade, đừng sập") vào
lưới an toàn thay vì để nó là lời hứa trong tài liệu.

### 7.4 Chống tái phát

```js
// eslint.config.js — palette thô không được xuất hiện trong apps/web nữa.
'no-restricted-syntax': ['error', {
  selector: 'JSXAttribute[name.name="className"][value.value=/\\b(bg|text|border|ring|divide)-(sky|neutral|gray|slate|zinc)-\\d{2,3}\\b/]',
  message: 'Dùng token ngữ nghĩa (bg-surface, text-ink, border-subtle) thay cho palette thô.',
}]
```

Giới hạn đã biết: chỉ bắt chuỗi literal, không bắt `clsx()` hay template string.
Mục tiêu là chặn thói quen, không phải chứng minh tuyệt đối.

### 7.5 Cổng kiểm tra

`npm run lint && npm run typecheck && npm run test` phải xanh trước khi sang
bước sau. Bước 2 kiểm thêm bằng file PDF thật xuất từ worker.

---

## 8. Cập nhật tài liệu

`docs/FRONTEND.md` viết lại các mục sau cho khớp thiết kế này:

- §9.1 Stack — bỏ cột "Trạng thái" tạm thời, ghi thẳng hệ token và primitive
- §9.7 Hiệu năng — chuyển "Virtualize danh sách gap" và "Prefetch template khi
  hover" xuống §12 (việc chưa làm). Cả hai nằm ngoài phạm vi lần này, và để
  chúng ở mục "Hiệu năng" khiến người đọc tưởng đã có
- §10 Thư viện thành phần — thêm `components/ui/`
- §12 Việc chưa làm — gỡ "Chế độ tối" (đã quyết bỏ hẳn, không phải hoãn)

Thêm mục mới **§13 Hệ thiết kế**: token, primitive, chữ ký AI, quy tắc màu.

---

## 9. Ngoài phạm vi

| Hạng mục | Vì sao |
|---|---|
| `/print/:cvId` | Đầu vào của file PDF người dùng nộp đi (D9) |
| Đổi route hoặc luồng nghiệp vụ | Trộn thay đổi giao diện với thay đổi nghiệp vụ thì hỏng không biết do bên nào |
| Thêm `company` vào `JobDescriptionSchema` | Cần để hiện tên công ty ở §6.2, nhưng là thay đổi schema — tách riêng |
| i18n **giao diện** (`uiLocale`) | Chưa có `next-intl`; là dự án riêng. **Không nhầm với ngôn ngữ CV** — xem §11 |
| Công tắc ngôn ngữ **JD** (`jd.language`) | `JdForm` đang gửi cứng `'vi'`; thuộc kế hoạch 2 khi dựng lại `/analyze` |
| Kéo thả sắp xếp section | Chưa có `@dnd-kit`; là dự án riêng |
| Chế độ tối | Đã quyết bỏ (D4) |

---

## 10. Rủi ro đã biết

| Rủi ro | Giảm thiểu |
|---|---|
| Tự viết a11y cho `Dialog`/`Sheet` sai mà không ai báo | Test bàn phím thật ở §7.3; nếu quá khó thì thêm Radix riêng cho hai cái này |
| D7 nới ràng buộc thành khuyến nghị → có chỗ quên `disabledReason` / `parts` | `console.warn` ở dev; rà lại khi review |
| `CvThumbnail` dùng `transform: scale` có thể vỡ layout với CV dài | Cắt bằng `overflow: hidden` + tỷ lệ khung cố định; test với profile nhiều section |
| 586 lượt màu di trú thủ công dễ sót | Rule ESLint ở §7.4 bắt phần còn lại; `npm run lint` là cổng |
| Font `.woff2` làm nặng bundle | Chỉ nạp 2 weight (400, 600), `font-display: swap`, subset Latin + Vietnamese |
| Người dùng bấm `EN` rồi tưởng CV sẽ tự dịch | Nhãn cạnh công tắc nói thẳng "đổi tiêu đề mục — không dịch nội dung bạn đã viết"; có test khoá câu này |

---

## 11. Bổ sung — ngôn ngữ CV `vi | en`

Thêm sau khi spec được duyệt, theo yêu cầu ngày 2026-08-07.

FRONTEND §9.6 quy định **ba trục ngôn ngữ độc lập**. Phần bổ sung này chỉ làm
trục **CV**, không đụng hai trục kia:

| Trục | Phạm vi |
|---|---|
| `profile.language` — ngôn ngữ CV | ✅ **trong** phạm vi |
| `jd.language` — ngôn ngữ JD | ⛔ kế hoạch 2 |
| `uiLocale` — ngôn ngữ giao diện | ⛔ dự án riêng (§9) |

Gộp ba trục làm một là sai: người Việt muốn giao diện tiếng Việt mà CV tiếng
Anh để nộp công ty nước ngoài là trường hợp **phổ biến nhất**, không phải
ngoại lệ.

**Phần lớn đã có sẵn.** Khảo sát cho thấy mọi tầng dưới đã hoàn chỉnh từ
trước: `LanguageSchema = z.enum(['vi','en'])`, `sectionTitle(id, lang)` có đủ
cả hai bộ nhãn, `renderSection` đọc `profile.language`, `ProfileRepo` lưu nó,
và `PATCH /api/profiles/:id` nhận mọi `PatchOp`. Thiếu đúng **một công tắc**
trên giao diện.

**Ràng buộc sản phẩm.** Đổi công tắc **không dịch nội dung** — nó đổi ngôn ngữ
khai báo, tiêu đề mục do template sinh đi theo, chữ người dùng tự viết giữ
nguyên. Giao diện phải nói rõ điều này ngay cạnh công tắc.

**Đặt ở đâu.** Thanh trên của `/builder`, cạnh Hoàn tác. Đi qua `applyUser`
như mọi thay đổi khác (FRONTEND §9.2) nên Hoàn tác dùng được, không cần cơ chế
riêng.
