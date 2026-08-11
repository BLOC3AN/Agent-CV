# CV Typography Design

## Goal

Quy hoạch typography của CV thành font chữ và ba cỡ chữ độc lập, dùng nhất quán ở editor, preview và PDF/print, đồng thời hỗ trợ tốt tiếng Việt và tiếng Anh.

## Design

`CVDesign` giữ các field hiện tại để tương thích revision/API, đồng thời bổ sung:

- `bodyFontSize`: cỡ nội dung, mặc định `10.5pt`.
- `sectionTitleFontSize`: cỡ tiêu đề section, mặc định `11pt`.
- `headerFontSize`: cỡ tên/header, mặc định `20pt`.

`fontSize` cũ vẫn được giữ làm fallback cho CV cũ chưa có ba field mới. Khi đọc dữ liệu:

- body dùng `bodyFontSize ?? fontSize`;
- section title dùng `sectionTitleFontSize ?? 11`;
- header dùng `headerFontSize ?? 20`.

Font catalog trong tab **Thiết kế** gồm `Auto`, `Calibri`, `Arial`, `Times New Roman`, `Roboto`, `Open Sans`, `Lato`. `Auto` được lưu như giá trị `Auto` và render bằng `Calibri, Arial, sans-serif`. Các font còn lại luôn có fallback cùng nhóm để hiển thị tiếng Việt/Anh ổn định.

## UI

Trong tab **Thiết kế**, selector font hiển thị nhãn dễ hiểu và ba control riêng:

- `Cỡ chữ nội dung` — range/select trong khoảng `9–14pt`.
- `Cỡ tiêu đề section` — khoảng `10–16pt`.
- `Cỡ header` — khoảng `16–28pt`.

Giá trị hiện tại và đơn vị `pt` được hiển thị cạnh mỗi control. Mỗi thay đổi cập nhật draft, giữ nguyên flow Save/revision hiện tại.

## Rendering

Renderer đặt bốn CSS custom properties trên root CV:

- `--cv-font-family`;
- `--cv-body-size`;
- `--cv-section-title-size`;
- `--cv-header-size`.

Editor, preview và print dùng cùng các biến này. Print CSS không hard-code lại ba cỡ chữ; các selector tương ứng dùng biến để PDF và preview không lệch nhau. Spacing, khổ A4 và pagination hiện tại không thay đổi.

## Compatibility and validation

- Schema/API không bị breaking; field mới là optional với default khi parse.
- Font không hợp lệ bị schema từ chối.
- Các giá trị cỡ chữ bị giới hạn trong khoảng đã nêu.
- CV cũ vẫn render đúng nhờ fallback.

## Tests

Bổ sung test cho:

1. Schema/default/fallback của typography.
2. Tab Thiết kế hiển thị selector font và ba cỡ chữ.
3. Thay đổi từng cỡ chữ cập nhật draft và CSS variables.
4. `Auto` render thành Calibri fallback.
5. Editor, preview và print cùng nhận typography.

