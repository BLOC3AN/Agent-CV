# Nợ kỹ thuật và việc chưa làm — sau kế hoạch 1/2 hệ thiết kế

| | |
|---|---|
| **Ngày** | 2026-08-08 |
| **Nguồn** | Thực thi [kế hoạch 1](2026-08-07-design-system-foundation.md), 16 task, 24 commit |
| **Trạng thái** | Đầu vào cho kế hoạch 2 |

Ghi ở đây vì thư mục làm việc của quy trình thực thi (`.superpowers/`) bị
`.gitignore` — mọi phán xử và ghi chú trong đó biến mất khi ai đó clone mới.
Những mục dưới đây đã được cân nhắc và **cố ý hoãn**, không phải bỏ sót.

---

## 1. Phải làm trong kế hoạch 2

### 1.1 Hai tham số URL chưa ai đọc

| Tham số | Dựng ở | Ai phải đọc |
|---|---|---|
| `?assistant=1` | `components/nav/TopNav.tsx` | `BuilderShell` / `ChatPanel` — mở panel trợ lý |
| `?focus=<pointer>` | `lib/home-state.ts` (CTA chính của khối AI trên Home) | `BuilderShell` — cuộn tới và focus đúng mục |

`app/(app)/builder/[cvId]/page.tsx` hiện **không nhận `searchParams`**. Hai nút
này điều hướng đúng CV nhưng không làm điều chúng hứa. Đã ghi ở
[FRONTEND.md §12.4](../../FRONTEND.md).

### 1.2 `Button` chỉ có một chỗ dùng thật, và nhánh đẻ thêm 7 bản chép tay

Mục đích của primitive `Button` là gom 7 chỗ chép lại cùng một mẫu nút. Kết quả
sau kế hoạch 1: `<Button>` chỉ được gọi ở `components/ai/AiPanel.tsx`.

Nguyên nhân cấu trúc: `Button` render `<button>` và **không có lối thoát
`as` / `asChild`**, nên mọi hành động **điều hướng** — phần lớn thao tác trên
Home — không dùng được nó. Hệ quả: `ResumeHome.tsx` và `ReturningHome.tsx` có 7
bản `<Link className="rounded-md bg-brand px-4 py-2 …">` chép tay.

Lệch đã đo được: nút phụ ở `ReturningHome` có `bg-surface`, nút phụ cùng vai ở
`ResumeHome` không có. Cùng một vai thị giác, hai kết quả — đúng thứ primitive
sinh ra để chặn.

**Việc:** thêm lối thoát cho `Button` render thẻ khác (`Link`), rồi thay 7 chỗ.

### 1.3 Bốn primitive chưa từng chạy ngoài test của chính chúng

| Primitive | Chỗ dùng thật |
|---|---:|
| `Card` | 4 |
| `Button` · `Section` · `Meter` · `CvThumbnail` · `AiPanel` | 1 |
| **`Badge` · `Dialog` · `Sheet` · `Field`** | **0** |

`Dialog` và `Sheet` được sinh ra để thay `PatchReviewModal` (vẫn còn
`role="dialog"` mà không `Escape`, không bẫy focus — đúng lỗi đã nêu ở
[spec §1.1](../specs/2026-08-07-frontend-redesign-design.md)) và `ChatPanel`.
Cả hai còn nguyên. Rủi ro "tự viết a11y sai mà không ai báo" mới được giảm bằng
unit test, **chưa bằng dùng thật**.

`ui/Field.tsx` có 0 chỗ dùng, trong khi `app/(app)/cv/new/page.tsx` có một
`Field` cục bộ riêng dùng 4 lần — hai lời giải cùng tên đang sống chung.

### 1.4 Còn 12 màn hình chạy palette thô

Đo cuối kế hoạch 1: **235 lượt palette thô** và **147 lượt `dark:`** ngoài
những file đã đụng. D4 đã quyết bỏ hẳn chế độ tối. Rule ESLint chặn palette thô
(§7.4 của kế hoạch 1) **chưa bật** — bật sớm thì `npm run lint` đỏ suốt.

---

## 2. Cạm bẫy đã biết — đọc trước khi làm kế hoạch 2

### 2.1 Bẫy focus chỉ can thiệp ở BIÊN

`useFocusTrap` chỉ xử lý khi focus ở phần tử đầu / cuối / lọt ra ngoài. Tab
giữa hai phần tử hiện là do trình duyệt xử lý theo tab-order.

**Hệ quả cho test:** một test kiểu "phần tử ẩn không nằm trong vòng Tab" mà đặt
phần tử ẩn **xen giữa** hai phần tử hiện sẽ **xanh giả** — nó xanh kể cả khi gỡ
sạch bẫy focus. Phần tử đặc biệt phải nằm ở vị trí biên.

### 2.2 happy-dom trả `undefined` cho `offsetParent`, không phải `null`

Nên `offsetParent !== null` luôn đúng và không lọc được gì. `useFocusTrap` dùng
`checkVisibility({ visibilityProperty: true })` — chạy đúng trong happy-dom lẫn
trình duyệt, và bắt được cả `visibility:hidden` mà `offsetParent` bỏ sót.

### 2.3 Không export hàm thuần từ file `app/**/page.tsx`

Next sinh `.next/types` chặn page export ngoài danh sách cho phép (`default`,
`metadata`, `dynamic`…); `tsc` đỏ sau khi đã `next build` một lần. Đặt hàm
thuần vào `lib/`.

### 2.4 `'server-only'` ném lỗi ngay khi import module

Import tĩnh `@/lib/auth` vào một component có phần thuần muốn test được sẽ làm
test đỏ. Dùng `await import('@/lib/auth')` trong hàm — mẫu này đã có ở
`app/page.tsx` và `components/nav/TopNav.tsx`.

### 2.5 `Meter` tô thanh bằng `bg-brand`

Kế hoạch 2 dựng `/analyze` rất dễ với tay lấy `Meter` cho điểm khớp JD. Nhưng
D8 cấm tô màu điểm khớp, và thanh teal chính là tô màu. Xem
[FRONTEND.md §12.5](../../FRONTEND.md).

---

## 3. Nợ nhỏ — không chặn, ghi để khỏi quên

**Độ phủ test** (code đã đúng, chỉ thiếu lưới):
- `devWarn` im lặng khi `NODE_ENV=production`
- `Meter` kẹp `value` ngoài khoảng 0–100
- `Sheet` Shift+Tab (Dialog đã có)
- `AiPanel` `aria-live` vắng mặt khi không streaming; title mặc định
- `Card variant="ai"` dải gradient mang `aria-hidden`
- `--radius-*` và `--shadow-*` không có test khoá giá trị
- Overlay lồng nhau (Dialog mở trong lúc Sheet đang mở) — cả hai nghe `keydown`
  ở capture phase, hành vi chưa xác minh

**Mã và quy ước:**
- `IntentRouter.Entry.soon` là field chết — không entry nào set, nhánh render
  không bao giờ chạy
- `CvThumbnail` không nhận `theme` từ chỗ gọi nên luôn vẽ `DEFAULT_THEME`, chứ
  không phải theme người dùng chọn ở `ThemePicker`
- `text-white` dùng rộng khắp vì không có token "chữ trên nền màu" — cân nhắc
  thêm token khi quét §7.4
- `__resetHealthForTest` không có rào chắn runtime
- `Button` set `aria-describedby` SAU `{...rest}` nên ghi đè giá trị người gọi
  tự truyền trên nút không-disabled
- Firefox và một số trình đọc màn hình không công bố `aria-describedby` trên
  `<button disabled>` vì phần tử bị loại khỏi accessibility tree

**Sản phẩm — cần người quyết, không phải lỗi:**
- Điểm khớp JD hiện là số trần không có `%`, theo mockup đã duyệt. Ý nghĩa thật
  (`thiếu N/M kỹ năng`) nằm ở `/analyze`. Trên Home nó hơi khó hiểu.
- `Meter` chỉ cho bấm nút nhỏ "Gồm những gì?"; `CompletenessBar` cũ cho bấm cả
  dòng — vùng bấm nhỏ hơn.
- File font chỉ lấy subset `vietnamese` (11,5 KB + 12 KB). Đủ dùng; xem lại nếu
  thiếu glyph Latin mở rộng.

**Lỗi có sẵn, không phải hồi quy của nhánh này:**
- `/print` thừa hưởng root layout nên `TopNav` và `DegradeBanner` nằm trong HTML
  in ra PDF. Không phần tử nào mang class `.no-print` dù rule đã có trong
  `globals.css`. Kế hoạch 1 làm nav nặng hơn nên vấn đề rõ hơn — **đáng mở issue
  riêng**, D9 tuyên bố `/print` ngoài phạm vi.

---

## 4. Một mẫu đáng nhớ về chất lượng test

Trong 16 task, phần lớn phát hiện Important **không phải code sai mà là test
không canh được thứ nó tuyên bố canh**. Ba lần test xanh giả bị bắt, cả ba đều
bằng cùng một cách:

> Tạm phá thứ đang được canh → xác nhận test chuyển ĐỎ → khôi phục.

Trường hợp rõ nhất: trước khi thêm một dòng test, đổi lối vào `featured` của
`IntentRouter` sang `Card variant="ai"` cho **0/751 test đỏ** — nguyên tắc cốt
lõi "teal-gradient = máy tham gia" hoàn toàn không có lưới.

Nên áp dụng phép thử phủ định này cho mọi test khoá quy tắc thiết kế ở kế
hoạch 2. Lưu ý thêm: các test đó assert lên quy ước tự nguyện (`data-*`), nên
chúng chỉ bắt được người đã opt-in — ai tô màu bằng `className` thẳng thì vẫn
lọt.
