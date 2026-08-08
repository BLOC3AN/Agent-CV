# Kiểm kê bộ CV đánh giá

> File này **không chứa PII** — chỉ mô tả cấu trúc file. Bản thân file PDF và
> bảng ánh xạ `.filemap.txt` đều gitignored (TDD §15).

Đo ngày 2026-08-06 bằng PyMuPDF + poppler.

## Đã có — 6 CV thật do người dùng cung cấp

| ID | Trang | Cột | Text layer | Ngôn ngữ | Font đặc biệt | Ảnh | Ghi chú |
|---|---:|---:|---|---|---|---:|---|
| CV-01 | 2 | 1 | tốt | en | Arial | 0 | Sạch nhất — dùng làm đường cơ bản |
| CV-02 | 1 | **2** | **KHÔNG TIN ĐƯỢC** | en | **Type3** | 0 | 59 đối tượng vẽ; xem §Type3 bên dưới |
| CV-04 | 2 | 1 | tốt | en | Times/Arial | 5 | Xuất từ DOCX |
| CV-06 | 3 | 1 | tốt | en | 7 font, có SymbolMT | 1 | Dài nhất (7.5K ký tự) → ca ngân sách token |
| CV-07 | 2 | 1 | tốt | en | **FontAwesome5** | 0 | Icon font → ký tự lạ khi trích text |
| CV-10 | 2 | 1 | tốt | en | Arial | 5 | Có ngày sinh → bộ PII đầy đủ nhất |

## Còn thiếu so với TESTCASES §1.1

| ID | Cần gì | Cách bù |
|---|---|---|
| CV-03 | Bản scan, không text layer | Rasterize CV-01 → PDF ảnh (script) |
| CV-05 | Bảng kỹ năng + thanh phần trăm | Sinh tổng hợp từ template |
| CV-08 | **Tiếng Việt không dấu** | Sinh tổng hợp |
| CV-09 | File hỏng / ảnh đổi đuôi .pdf | Script tạo |

## ⚠️ Khoảng trống lớn nhất: không có CV tiếng Việt nào

Cả 6 CV đều là tiếng Anh. Nhưng đối tượng chính của sản phẩm là **sinh viên
Việt Nam**, và ngân sách token (TDD §6.2) tính theo tiếng Việt (1.29× token).

Hệ quả: `field_accuracy` đo trên bộ này **không đại diện** cho ca dùng chính.
Cần bổ sung CV tiếng Việt — hoặc người dùng cung cấp, hoặc sinh tổng hợp.

## Type3 font — phát hiện làm thay đổi thiết kế

CV-02 dùng **Type3 font** (glyph nhúng dạng chương trình vẽ). Hai engine trích
text cho kết quả khác nhau trên cùng file:

| Engine | Kết quả |
|---|---|
| PyMuPDF | `IˇMm a business analyst…` — hỏng ký tự, **mất hẳn dòng tên và chức danh** |
| poppler | `I'm a business analyst…` — đúng, **lấy được tên** mà PyMuPDF bỏ sót |

Mất dòng tên là mất field quan trọng nhất của CV.

**Chênh lệch độ dài không phát hiện được vấn đề** — đo cả 6 file đều lệch 0%.
Tín hiệu đáng tin là:

1. **Có Type3 font** → khớp đúng 1:1 với file bị hỏng (deterministic, rẻ)
2. Ký tự lỗi đặc trưng (`ˇ ˘ ˙ ˚ ˛ ˜ ˝ ﬁ ﬂ`, chữ hoa kẹt giữa chữ thường)

Thiết kế cũ ở TDD §8.1 chỉ có hai nhánh: *có text layer → pdfplumber* / *không
có → OCR*. Thực tế có nhánh thứ ba: **có text layer nhưng không tin được**.

→ Đã bổ sung cổng kiểm tra chất lượng vào TDD §8.1.1.

## Chạy lại kiểm kê

```bash
npx tsx eval/inspect-cv.ts        # in lại bảng này từ file thật
```
