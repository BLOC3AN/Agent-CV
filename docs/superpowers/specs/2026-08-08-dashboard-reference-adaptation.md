# Spec đề xuất — Dashboard Agent CV theo mockup tham khảo

| | |
|---|---|
| **Ngày** | 2026-08-08 |
| **Trạng thái** | Đã duyệt; P1/P2 đang triển khai |
| **Nguồn tham khảo** | `ChatGPT Image 08_44_19 8 thg 8, 2026.png` |
| **Ràng buộc** | Giữ nguyên API, function, schema và luồng nghiệp vụ hiện tại |
| **Tài liệu nền** | [`FRONTEND.md`](../../FRONTEND.md), [frontend redesign](2026-08-07-frontend-redesign-design.md) |

## 1. Mục tiêu

Học cách tổ chức thông tin và phân cấp thị giác từ mockup Agent CV:

- Một vùng điều hướng ổn định.
- Một khối CV chính có hành động tiếp tục rõ ràng.
- Các chỉ số hồ sơ được phân rã, không chỉ hiện một con số.
- Một vùng trợ lý AI có đề xuất cụ thể và hành động tiếp theo.
- Danh sách đối chiếu gần đây để quay lại công việc đang làm.
- Một cột hành động nhanh, chỉ chứa các hành động sản phẩm đang hỗ trợ.

Đây là thay đổi presentation của frontend. Không thêm API nghiệp vụ mới ngoài
SSE report đã có trong codebase; không đổi tên route, payload, schema hoặc
function hiện tại.

## 2. Nguyên tắc giữ contract

1. API hiện có là nguồn sự thật. UI không được tạo dữ liệu giả để lấp card.
2. Mỗi CTA phải dẫn tới route hoặc function đang tồn tại.
3. Không hiển thị chức năng chỉ xuất hiện trong mockup nếu backend chưa hỗ trợ.
4. Không đưa logic truy vấn mới vào component client nếu dữ liệu đã có thể lấy ở
   server page hoặc API hiện tại.
5. AI chỉ đề xuất. Mọi thay đổi profile vẫn đi qua diff review và API proposal.
6. Dashboard phải dùng được khi AI tắt; các thao tác không cần AI vẫn hoạt động.

## 3. Ma trận mockup → năng lực hiện có

| Khu vực trong ảnh | Có thể giữ | Nguồn hiện có | Xử lý trong spec |
|---|---|---|---|
| Logo và điều hướng | Home, CV, cài đặt, trợ lý | `TopNav`, `/`, `/cv`, `/settings`, `/builder/:cvId?assistant=1` | Dùng lại route; có thể trình bày thành rail trái trong app shell |
| Lời chào | Tên, lời chào theo giờ | `app/page.tsx`, `greet`, `currentUser` | Giữ |
| Card CV đang chỉnh sửa | Tiêu đề, thời gian sửa, thumbnail, độ đầy đủ, tiếp tục chỉnh | `ReturningHome`, `CvThumbnail`, `profileCompleteness`, query Home | Giữ và làm thành khối chính |
| Gauge hoàn thiện hồ sơ | Phần trăm và phân rã theo section | `profileCompleteness`, `Meter` | Dùng `Meter`; không tự thêm số |
| Trợ lý AI | Đề xuất, chat, clarify, diff, áp dụng có chọn lọc | `/api/chat`, `/api/chat/proposals/[id]`, `ChatPanel`, `PatchReviewModal` | Giữ cấu trúc card; bỏ nội dung giả trong mockup |
| Đối chiếu gần đây | JD title, điểm, CV, thời gian, mở report | `match_analyses`, `/api/analyze/[cvId]`, `ReportView` | Giữ; không thêm company nếu schema chưa có |
| Mức độ phù hợp | Breakdown và gap có bằng chứng | `ReportView`, `matched`, `gaps`, citations | Giữ; điểm match trung tính, không tô màu theo ngưỡng |
| Tạo CV mới | Route và form nhập tay | `/cv/new`, `/api/cv`, `Create CV` flow | Giữ |
| Tải CV lên | Upload, job progress, review bắt buộc | `/api/uploads/cv`, `/api/jobs/[id]/stream`, `UploadBox`, `ReviewShell` | Giữ |
| Chẩn đoán CV | Điểm sức khỏe, tối đa 3 việc nên sửa, deep link vào field | `HealthReport`, `/diagnose/:cvId`, `?focus=` | Giữ |
| Lịch sử phiên bản | Xem, preview, revert, undo | `/api/profiles/:id/revisions`, `revert`, `undo`, `VersionHistory` | Không đưa vào quick action nếu chưa cần; giữ trong builder |
| Mẫu CV | Chọn template và màu | `ThemePicker`, editor store | Có thể đưa vào rail/secondary action |
| Chuông thông báo | Không có notification API | Không có | Loại khỏi spec |
| Việc đã lưu | Không có jobs/saved jobs API | Không có | Loại khỏi spec |
| Nhập từ LinkedIn | Không có integration/API | Không có | Loại khỏi spec |
| Nâng cấp trả phí | Không có billing/subscription API | Không có | Loại khỏi spec |
| Robot/illustration | Chỉ là asset trang trí | Không có UI asset contract | Tùy chọn; không để che dữ liệu và không chặn flow |
| Nút “Xem CV” read-only | Chưa có `/cv/:id` | Không có | Đổi thành “Tất cả CV” hoặc bỏ |

## 4. Cấu trúc dashboard đề xuất

### 4.1 App shell

Mockup dùng sidebar. Đây là một thay đổi presentation có thể áp dụng mà không
đổi API, nhưng cần giới hạn trong khu vực app đã đăng nhập:

```text
┌──────────────┬─────────────────────────────────────────────┐
│ Brand        │ Top bar: breadcrumb / trợ lý / user          │
│ Tổng quan    ├─────────────────────────────────────────────┤
│ Hồ sơ        │                                               │
│ CV của tôi   │ Main dashboard                                │
│ Đối chiếu    │                                               │
│ Trợ lý AI    │                                               │
│              │                                               │
│ Mẫu CV       │                                               │
│ Cài đặt      │                                               │
└──────────────┴─────────────────────────────────────────────┘
```

Điều hướng phải là các route thật:

| Nhãn | Route |
|---|---|
| Tổng quan | `/` |
| CV của tôi | `/cv` |
| Đối chiếu việc làm | `/analyze/:cvId` khi có CV; nếu chưa có thì `/cv` |
| Trợ lý AI | `/builder/:cvId?assistant=1` khi có CV; nếu chưa có thì `/cv` |
| Mẫu CV | `/builder/:cvId` |
| Cài đặt | `/settings` |

Không render “Việc đã lưu”, “Thông báo” hoặc “Nhập từ LinkedIn” dưới dạng link
hoạt động.

### 4.2 Main dashboard

Thứ tự ưu tiên trên desktop:

1. Header chào người dùng.
2. Card CV chính, chiếm khoảng 2/3 chiều rộng.
3. Card hoàn thiện hồ sơ, chiếm khoảng 1/3 chiều rộng.
4. Card trợ lý AI chiếm toàn bộ chiều rộng bên dưới card CV.
5. Danh sách đối chiếu gần đây dạng hàng/card nhỏ.
6. Quick actions chỉ gồm “Tạo CV mới” và “Tải CV lên”.

Trên mobile, xếp thành một cột theo đúng thứ tự trên; không ép dashboard 3 cột
vào màn hình hẹp.

### 4.3 Card CV chính

Nội dung bắt buộc:

- `cv.title`.
- `cv.updatedAt`.
- `CvThumbnail` từ profile thật.
- `profileCompleteness.percent` và `parts` qua `Meter`.
- Link `/builder/:cvId` với nhãn “Tiếp tục chỉnh CV”.
- Link `/cv` với nhãn “Tất cả CV”.

Không có nút read-only `/cv/:id` cho tới khi route đó tồn tại.

### 4.4 Card hoàn thiện hồ sơ

Dùng `Meter` hoặc primitive ring mới nếu cần visual giống mockup, nhưng ring chỉ
là presentation của cùng một giá trị `Completeness`. Danh sách bên cạnh phải
lấy từ `parts`, không hard-code “Thông tin cá nhân / Kinh nghiệm / ...”.

Nếu API không trả breakdown, chỉ hiển thị phần trăm và không dựng danh sách giả.

### 4.5 Card trợ lý AI

Dùng `AiPanel`/`Card variant="ai"` với:

- Một insight lấy từ `nextStepFor` hoặc trạng thái CV thật.
- CTA mở `/builder/:cvId?assistant=1`.
- CTA phụ “Để sau” chỉ dismiss presentation, không ghi DB.
- Nếu AI unavailable: giữ kích thước card, hiện degrade message và vẫn để các
  action không cần AI hoạt động.

Không đưa các câu ví dụ cố định như “Built 12 REST APIs...” nếu không lấy từ
profile hoặc proposal thật.

### 4.6 Đối chiếu gần đây

Mỗi item hiển thị:

- JD title.
- Mốc thời gian.
- Điểm overall trung tính.
- Một dòng sự thật đếm được nếu dữ liệu có: thiếu N kỹ năng, N keyword ATS.
- Link `/analyze/:cvId`.

Không hiển thị company vì `JobDescriptionSchema` hiện chưa có field đó.
Không gắn nhãn “Cần cải thiện / Khá phù hợp” cho điểm overall nếu chưa có
ngưỡng nghiệp vụ được duyệt.

## 5. Visual language học từ ảnh, nhưng theo design system hiện tại

### Giữ lại

- Phân cấp rõ: một card chính, card chỉ số, card AI, danh sách phụ.
- Grid desktop có vùng chính và vùng phụ.
- Thumbnail/visual CV xuất hiện ngay ở Home.
- CTA lớn ở hành động chính, CTA phụ nhẹ hơn.
- Nhóm quick actions tách khỏi nội dung phân tích.
- Các card có khoảng thở, tiêu đề ngắn, dữ liệu dễ quét.

### Không giữ nguyên

- Tím/indigo làm màu thương hiệu: dùng `brand` teal theo design system.
- Sidebar cho mọi route: chỉ dùng app shell; onboarding và review giữ flow riêng.
- Gauge nhiều màu cho điểm JD: dùng mực trung tính theo D8.
- Robot/gradient lớn: chỉ dùng asset nhẹ, không để trang thành landing page.
- Các chức năng không có API: notification, saved jobs, LinkedIn, billing.

## 6. Không đổi API/function

Không đổi các contract sau:

- `/api/cv`, `/api/cv/:id`, `/api/cv/:id/export`.
- `/api/profiles`, `/api/profiles/:id`, revisions, undo, revert, verify.
- `/api/uploads/cv`, `/api/imports/:jobId/*`, `/api/jobs/:id/stream`.
- `/api/analyze`, `/api/analyze/:cvId`, `/api/analyze/:cvId/stream`.
- `/api/chat`, `/api/chat/proposals/:id`.
- `/api/health`, `/api/kb`, `/api/kb/citations`.
- `profileCompleteness`, `nextStepFor`, `decideHome`, `dedupeMatches`.

Được phép thêm component presentation, selector hoặc view model thuần nếu
không thay đổi output contract của các API/function trên.

## 7. Phạm vi triển khai sau khi spec được duyệt

### P1 — Dashboard shell

- Dựng app shell responsive theo layout sidebar của mockup.
- Giữ các page onboarding/review/print ngoài shell nếu việc bọc layout làm đổi
  flow hoặc PDF.
- Bảo đảm `/print` không nhận sidebar/topbar của dashboard.

### P2 — Returning Home

- Dựng dashboard grid bằng dữ liệu `HomeData` hiện có.
- Card CV chính, Meter breakdown, AiPanel, recent matches, quick actions.
- Không thêm query SQL mới nếu dữ liệu hiện tại đủ.

### P3 — Dùng chung visual language

- Tách các khối lặp thành primitive/component nhỏ khi cần.
- Token-only; không quay lại palette thô hoặc `dark:`.
- Test responsive ở 1366x768 và mobile.

### P4 — Xác nhận hành vi

- Các link sidebar đều tới route thật.
- CTA AI giữ context CV.
- Score/gap/citation vẫn dùng cùng API và grounding hiện tại.
- AI down không làm dashboard trắng.

## 8. Tiêu chí nghiệm thu

- Không có chức năng trong mockup mà người dùng bấm vào rồi gặp route/API chưa tồn tại.
- Dashboard hiển thị được bằng dữ liệu thật khi có CV, không có CV và có job dở dang.
- Card CV chính và recent matches không dùng dữ liệu hard-code.
- Điểm hoàn thiện có breakdown nguồn thật.
- Điểm đối chiếu không dùng màu để phán xét ngưỡng.
- Chat mở đúng CV và proposal vẫn qua diff review.
- Layout không tràn ngang tại 1366x768 và mobile.
- `npm run typecheck`, `npm run lint`, `npm test` xanh.

## 9. Ngoài phạm vi

- Thay đổi schema hoặc thêm field `company` vào JD.
- Notification center.
- Saved jobs.
- LinkedIn import.
- Subscription/billing/upgrade.
- Public sharing.
- Realtime collaboration.
- Đổi API payload hoặc business rule hiện tại.
