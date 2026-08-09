# Spec — Chat chuyển sang workspace CV sống

| | |
|---|---|
| **Ngày** | 2026-08-09 |
| **Trạng thái** | Đã triển khai trong `frontend/apps/web` |
| **Phạm vi** | `/builder/:cvId` và luồng trợ lý gắn với CV |

## Staging route

`/builder-preview/:cvId?assistant=1` chạy cùng `BuilderShell`, database, auth và
API contract thật như production `/builder/:cvId`. Route này là điểm smoke test
cho visual redesign; không import hoặc bundle app Vite mock. Sau khi QA viewport
16:9, auth, load CV, inline edit, chat SSE, proposal apply và export PDF đạt,
route production có thể được chuyển sang cùng implementation rồi xoá route
preview.

Chạy local:

```bash
cd frontend
npm --workspace @hr/web run dev:staging
```

Staging dùng port `3310` và proxy API tới `http://localhost:8080`.

## Visual direction

Workspace builder dùng visual neo-brutalist từ reference
`hr-agent---ai-cv-builder-&-job-matcher`: nền vàng, accent pink/blue/green,
viền đen 2–4px, offset shadow và các control có cảm giác tactile. Lớp này được
scope dưới `.builder-neo`, nên không làm thay đổi token hoặc visual của
dashboard, report và các route khác.

Builder không xếp chồng global navigation cũ lên header reference. Ở viewport
chuẩn 16:9 Full HD (1920×1080), workspace dùng header 58px, control rail 320px,
AI panel 320px và phần CV ở giữa; đây là layout chuẩn cho laptop 15.6 inch.

Các vùng đã port: topbar, mục lục, theme picker, vùng CV, header chat, model
selector, message bubbles, loading state, suggestion links và composer. Nội
dung CV vẫn dùng renderer thật của frontend mới; không copy mock A4 hoặc dữ
liệu giả từ reference.

## Mục tiêu

Đưa giao diện tham chiếu `hr-agent---ai-cv-builder-&-job-matcher` vào frontend
đang chạy mà không thay đổi API, SSE, proposal review hoặc model fallback.
Người dùng bắt đầu bằng cuộc trò chuyện tự nhiên; sau câu hỏi đầu tiên, CV xuất
hiện cạnh chat để thấy ngay tác động của quá trình chỉnh sửa.

## Trạng thái và tiêu chí chấp nhận

| State | Điều kiện | Hành vi |
|---|---|---|
| `idle` | Chưa có user message, drawer là chat | Chat nằm trong canvas trung tâm; CV thu gọn khỏi vùng nhìn |
| `active` | Có user message đầu tiên | CV trượt vào, chat co về panel bên phải; lịch sử không mất |
| `active` | Chat đóng hoặc có `focus` path | Hiện builder CV bình thường, phục vụ inline edit/focus |

- Chỉ user message mới kích hoạt transition; assistant message cũ không tự mở
  CV sớm.
- Submit bắt đầu transition trước khi request `/api/chat` hoàn tất.
- `ChatPanel` tiếp tục dùng `useChat`, `/api/chat`, SSE và `/api/chat/proposals`.
- CV tiếp tục dùng `FieldProvider`, `editableRenderer`, `getTemplate` và
  `useEditor`; không tạo renderer thứ hai.
- Khi AI chết, UI degrade hiện tại vẫn giữ nguyên: người dùng vẫn sửa CV, đổi
  mẫu và tải PDF.
- Có reduced-motion fallback và layout dọc trên màn hình nhỏ.

## Kiểm thử

Test bắt buộc nằm tại:

- `frontend/apps/web/test/assistant-workspace.test.ts` — state transition.
- `frontend/apps/web/test/chat-panel.ui.test.tsx` — API, SSE, proposal,
  clarify, giữ lịch sử khi unmount.

Không thêm mock API mới cho transition; test state thuần giúp tránh làm thay
đổi contract backend chỉ vì kiểm tra UI.
