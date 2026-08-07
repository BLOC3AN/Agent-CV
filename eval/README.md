# Bộ đánh giá (eval)

TDD §13.2 · TESTCASES §1

## Nguyên tắc thu thập dữ liệu

| Loại | Nguồn | Lý do |
|---|---|---|
| **JD** | Cào từ trang tuyển dụng công khai | Nội dung do công ty đăng để ứng viên đọc. Lấy số lượng nhỏ, ghi rõ `source_url`, tôn trọng tín hiệu chặn của site |
| **CV** | **Tổng hợp (sinh ra), KHÔNG cào** | CV chứa PII của người thật, đăng lên để xin việc chứ không phải để làm dữ liệu kiểm thử. Cào về mâu thuẫn với chính TDD §15 và vướng Nghị định 13/2023 |

### Vì sao CV tổng hợp còn tốt hơn cho mục đích này

1. **Nhãn đúng có sẵn.** `eval/golden/` cần Profile JSON chuẩn để đo `field_accuracy`. CV tự sinh thì nhãn sinh ra cùng lúc, không phải gán tay 50 lần.
2. **Dựng được đúng ca khó.** TESTCASES §1.1 yêu cầu 2 cột, bản scan, 3 trang, không dấu, icon font — tự sinh thì chủ động, cào thì phụ thuộc may rủi.
3. **Không rủi ro PII.** Commit được vào repo.

CV thật do người dùng cung cấp vẫn dùng để **đo**, nhưng không commit
(xem `.gitignore`).

## Cấu trúc

```
eval/
├── jd/          JD-01..JD-05.md   — front-matter chứa nhãn kỳ vọng
├── cv/          CV-01..CV-10      — sinh từ eval/fixtures/
├── fixtures/    Profile JSON nguồn để sinh CV
├── golden/      Profile JSON chuẩn (nhãn đúng)
├── integration.test.ts             TC-INT-01..06
└── run.ts                          harness đo field_accuracy
```

## Bộ JD hiện có

| ID | Nguồn | Ngôn ngữ | Seniority | Phủ ca gì |
|---|---|---|---|---|
| JD-01 | Thật — ITviec/Everlastify | vi + en lẫn lộn | junior | Song ngữ trong cùng một JD |
| JD-02 | Thật — ITviec/Motorist | en | junior | Tách must-have/nice-to-have; **không nêu số năm** |
| JD-03 | Thật — ITviec/Finhay | en | mid | JD dài ~1400 từ (TC-42-16); bẫy "no Node.js expertise required" |
| JD-04 | Tổng hợp | vi | **unknown** | JD mơ hồ — model phải trả `unknown`, không được đoán |
| JD-05 | Tổng hợp | vi | fresher | **TC-SEC-08** chèn lệnh qua JD |

> Còn thiếu so với mục tiêu 20 JD của TDD §13.2. Bổ sung dần; ưu tiên đa dạng
> `roleFamily` (frontend, mobile, data, QA, BA) và `seniority`.

## Chạy

```bash
npm run test:int      # TC-INT-01..06 — chạm model server thật
npm run eval          # đo field_accuracy trên golden set
```
