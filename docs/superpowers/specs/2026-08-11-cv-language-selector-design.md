# Bộ chọn ngôn ngữ cho CV

Ngày: 2026-08-11 · Trạng thái: đã duyệt thiết kế

## Vấn đề

Trình sửa CV chỉ nói tiếng Việt. Tiêu đề mục (`GIỚI THIỆU BẢN THÂN`, `KINH NGHIỆM
LÀM VIỆC`, …) là hằng số cứng trong `CVBlockRenderer`, và toàn bộ nút, hint, nhãn
cây mục lục cũng vậy. Người dùng cần nộp CV tiếng Anh không có cách nào đổi.

Hai khái niệm ngôn ngữ đã tồn tại sẵn nhưng rời rạc:

| | Thuộc về | Lưu ở | Đang dùng cho |
|---|---|---|---|
| `cv.language` | từng CV | backend, trong schema | chỉ `<html lang>` của trang in |
| `useLocale()` | người dùng | `localStorage` | 10 chuỗi ở Header, Sidebar, Cài đặt |

## Quyết định đã chốt

1. **Một selector đổi cả hai.** Chọn English thì tiêu đề trong CV, hint và button
   đều sang tiếng Anh.
2. **Phạm vi dịch: màn soạn thảo CV.** Không dịch toàn bộ phần mềm.
3. **CV là nguồn sự thật.** Selector luôn hiển thị `cv.language` của CV đang mở;
   giao diện trình sửa đi theo nó. Không có trạng thái thứ hai để lệch nhau.

Đánh đổi đã cân nhắc và chấp nhận: người Việt làm CV tiếng Anh sẽ thấy giao diện
trình sửa chuyển sang tiếng Anh theo. Đổi lại chỉ có một nút và một nguồn sự thật.

## Kiến trúc

Hai loại chữ đi hai đường khác nhau.

### Tiêu đề mục trong CV — hàm thuần, không context

`CVBlockRenderer` còn chạy SSR trong `src/server/print.tsx`, nơi không có React
context nào. Nên tiêu đề suy ra trực tiếp từ `cv.language` đã được truyền sẵn:

```ts
// src/lib/cv-section-titles.ts
export function sectionTitle(type: CVNodeType, language: Locale): string
export function nodeLabel(type: CVNodeType, language: Locale): string
```

Nhờ vậy trình sửa, popup xem trước và file PDF dùng chung một nguồn — không ai
phải nhớ đồng bộ ba chỗ.

### Chữ trên giao diện — qua `t()`

Giữ nguyên cơ chế `useLocale()`. Bảng message tách khỏi file provider:

```
src/lib/i18n/index.tsx        LocaleProvider, useLocale (chuyển từ i18n.tsx)
src/lib/i18n/messages.vi.ts
src/lib/i18n/messages.en.ts
```

Hai bảng phải cùng tập khoá; ràng buộc bằng kiểu, thiếu khoá là lỗi biên dịch.

### Chỗ đặt selector

Selector nằm cạnh nút Xem trước, tức trong `Header`. Nhưng `Header` do `AppLayout`
dựng và nằm **trên** `BuilderRoute` trong cây React nên không đọc được CV — đúng
cái đã làm nút Xem trước chết trước đây.

Giải pháp: `BuilderLocaleProvider` bọc quanh nhóm route builder trong `routes.tsx`,
bao cả `AppLayout hideSidebar`, nên `Header` lẫn `BuilderRoute` đều nằm trong nó.

```ts
interface BuilderLocaleValue {
  language?: Locale                      // vắng mặt = không ở trong trình sửa
  setLanguage: (next: Locale) => void
  register: (language: Locale, onChange: (next: Locale) => void) => void
}
```

- `BuilderRoute` gọi `register(cv.language, setter)` mỗi khi CV đổi, và gỡ đăng ký
  khi rời trình sửa (hàm dọn dẹp của `useEffect`).
- `Header` đọc `language`; **vắng mặt thì không dựng selector**, nên nó tự biến
  mất ngoài trình sửa mà không cần điều kiện riêng.
- `setLanguage` chỉ gọi lại hàm mà `BuilderRoute` đã đăng ký; provider không giữ
  bản sao ngôn ngữ nào của riêng nó. Đây là điều giữ cho "CV là nguồn sự thật"
  đúng theo cấu trúc chứ không nhờ kỷ luật.
- Provider dựng bên trong nó một `LocaleProvider` với `locale` bị ghim bằng
  `language` đã đăng ký. Nhánh builder vì thế thấy `t()` theo ngôn ngữ CV, còn
  dashboard và cài đặt nằm ngoài nên vẫn theo tùy chọn người dùng.

## Bảng tiêu đề

Bản in đang dùng tiêu đề **khác** bản trên màn hình — `KINH NGHIỆM` (print) so với
`KINH NGHIỆM LÀM VIỆC` (trình sửa), tương tự ở Dự án, Học vấn, Kỹ năng. File PDF
lâu nay không khớp thứ người dùng nhìn thấy. Gộp về một bảng, lấy bản dài của
trình sửa làm chuẩn vì đó là thứ đã được duyệt qua popup xem trước.

| Mục | vi | en |
|---|---|---|
| summary | GIỚI THIỆU BẢN THÂN | SUMMARY |
| experience | KINH NGHIỆM LÀM VIỆC | WORK EXPERIENCE |
| projects | DỰ ÁN NỔI BẬT | PROJECTS |
| education | HỌC VẤN & BẰNG CẤP | EDUCATION |
| skills | KĨ NĂNG & CÔNG NGHỆ | SKILLS & TECHNOLOGIES |
| activities | HOẠT ĐỘNG & NGOẠI KHÓA | ACTIVITIES |
| certifications | CHỨNG CHỈ | CERTIFICATIONS |
| languages | NGOẠI NGỮ | LANGUAGES |

Nhãn cây mục lục và `aria-label` dùng cùng bảng ở dạng chữ thường đầu câu, thêm
`header` → Thông tin cá nhân / Personal information và `footer` → Footer / Footer.

## Phạm vi dịch

137 chuỗi trong 7 file:

| File | Số chuỗi |
|---|---|
| `components/CVBlockRenderer.tsx` | 24 |
| `components/CVEditorView.tsx` | 21 |
| `components/InlineCVEditor.tsx` | 15 |
| `components/ComponentTree.tsx` | 18 |
| `components/PreviewModal.tsx` | 5 |
| `components/VersionHistoryPanel.tsx` | 31 |
| `routes/BuilderRoute.tsx` | 23 |

`ChatPanel` (33 chuỗi) **nằm ngoài phạm vi** dù ở cùng màn hình: trợ lý AI trả lời
bằng tiếng Việt, dịch vỏ nút quanh nó sẽ khập khiễng hơn là để nguyên.

## Luồng dữ liệu

```
Đổi selector
  → BuilderRoute cập nhật store.draft.cv.language
  → bản nháp thành "Chưa lưu"
  → tiêu đề trong trang giấy và chữ trên giao diện đổi ngay
  → bản PDF chỉ đổi SAU KHI Lưu
```

Máy chủ dựng PDF đọc CV **đã lưu** từ backend, nên đổi ngôn ngữ mà chưa lưu thì
file tải về vẫn mang ngôn ngữ cũ. Hộp thoại "CV có thay đổi chưa lưu" đã chặn
đúng tình huống này, không cần thêm gì.

Mục đang ẩn khi được bật lên tự mang tiêu đề đúng ngôn ngữ, vì tiêu đề suy ra lúc
render chứ không lưu trong layout. Không có mục tự tạo — tập mục là cố định, panel
chỉ bật/tắt hiển thị.

## Trường hợp biên

- **CV không có `language`, hoặc mang giá trị lạ**: `sectionTitle`/`nodeLabel`
  nhận `Locale | undefined` và lùi về `'vi'`. Đúng bằng cách `print.tsx` đang
  làm hôm nay (`cv.language === 'en' ? 'en' : 'vi'`), nên không đổi hành vi của
  CV cũ.
- **Mở CV `en` khi `localStorage` đang `vi`**: selector hiện English, giao diện
  trình sửa tiếng Anh. CV thắng.
- **Rời trình sửa**: `register` gỡ đăng ký, giao diện trở lại tùy chọn người dùng.
- **Nội dung người dùng nhập** (chức danh, mô tả, tên kỹ năng): giữ nguyên như đã
  gõ. Không dịch tự động.

## Kiểm thử

1. **Ba variant một tiêu đề** — cùng một CV `language: 'en'` render ở editor,
   preview và print đều cho `WORK EXPERIENCE`. Test này khoá luôn lỗi lệch
   print/editor mô tả ở trên.
2. **Selector đổi cả hai** — chọn English thì nhãn cây mục lục và nút trong panel
   đổi theo, và bản nháp chuyển sang trạng thái chưa lưu.
3. **CV thắng localStorage** — đặt `hr-locale=vi`, mở CV `language: 'en'`,
   selector phải hiện English.
4. **Selector chỉ có trong trình sửa** — dashboard không dựng nó.
5. **Không sót tiếng Việt** — render trình sửa với CV tiếng Anh (nội dung fixture
   toàn tiếng Anh) rồi khẳng định `textContent` không chứa ký tự có dấu tiếng
   Việt. Kiểm tra theo hành vi thay vì quét chuỗi trong mã nguồn, vì repo này
   viết chú thích bằng tiếng Việt — quét mã sẽ báo động giả khắp nơi.
6. **PDF theo ngôn ngữ CV** — integration test: CV `en` cho ra PDF mà `pdftotext`
   đọc được `WORK EXPERIENCE`.

## Ngoài phạm vi

- Dịch trợ lý AI, màn rà soát import, dashboard, cài đặt.
- Dịch tự động nội dung người dùng nhập.
- Thêm ngôn ngữ thứ ba. Cấu trúc bảng message không cản việc đó, nhưng không làm
  bây giờ.
