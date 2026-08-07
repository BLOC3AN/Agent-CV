# HR-Agent — Thiết kế Frontend

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 2026-08-06 |
| **Phụ thuộc** | [TDD.md](./TDD.md) — đặc biệt §2 (ràng buộc), §5.5 (degrade), §14 (năng lực) |

---

## 1. Nguyên tắc thiết kế

Ba ràng buộc kỹ thuật quyết định toàn bộ UX, không phải sở thích thẩm mỹ:

| Ràng buộc | Hệ quả UX |
|---|---|
| `gap_analysis` mất **~70 giây** | Không có màn hình chờ. Kết quả phải xuất hiện **từng phần** |
| Model server **có thể chết** | Mọi màn hình phải dùng được khi AI tắt. Không màn hình lỗi trắng |
| AI **không được ghi thẳng** vào Profile | Mọi thay đổi từ AI đi qua UI duyệt diff |

Ba nguyên tắc sản phẩm:

**P1 — Người dùng luôn giữ quyền kiểm soát.** AI đề xuất, không quyết định. Không có thao tác nào của AI diễn ra mà user không thấy và không hoàn tác được.

**P2 — Không bịa, hỏi thay vì đoán.** Khi thiếu thông tin, giao diện hiện câu hỏi chứ không hiện nội dung tự sinh.

**P3 — Nói rõ nguồn.** Lời khuyên từ HR có tên và trích dẫn. Lời khuyên chung của AI hiển thị khác hẳn.

---

## 2. Bản đồ màn hình

```
┌─ Public ──────────────────────────────────────────────────────────┐
│ /                    Landing                                      │
│ /login               Đăng nhập (Google OAuth · magic link)         │
└───────────────────────────────────────────────────────────────────┘

┌─ Onboarding ──────────────────────────────────────────────────────┐
│ /start               Chọn lối vào: Tải CV lên · Nhập tay           │
│ /import              Tải PDF → tiến trình xử lý                    │
│ /import/:jobId/review   ★ MÀN HÌNH RÀ SOÁT (bắt buộc)             │
└───────────────────────────────────────────────────────────────────┘

┌─ Workspace ───────────────────────────────────────────────────────┐
│ /builder/:cvId       ★ Trình soạn CV (màn hình chính)             │
│   ├─ panel: Chat tư vấn        (slide-over bên phải)              │
│   ├─ modal: Duyệt đề xuất      (diff từng thay đổi)               │
│   └─ modal: Xuất file          (chọn bản trình bày / ATS)         │
│ /analyze/:cvId       Nhập JD → Báo cáo đối chiếu                  │
│ /cv                  Danh sách CV của tôi                          │
│ /settings            Tài khoản · ngôn ngữ · quyền riêng tư         │
└───────────────────────────────────────────────────────────────────┘

┌─ Admin (curator) ─────────────────────────────────────────────────┐
│ /admin/kb            Nguồn tri thức                                │
│ /admin/kb/review     Hàng đợi duyệt chunk                          │
│ /admin/health        Trạng thái model server · metric              │
└───────────────────────────────────────────────────────────────────┘

┌─ Nội bộ (không hiện với user) ────────────────────────────────────┐
│ /print/:cvId?variant=presentation|ats   ← Playwright render → PDF  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. Màn hình chính — `/builder/:cvId`

### 3.1 Bố cục

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰  CV Backend Fresher        vi│en   [Điểm khớp JD: 68] [Xuất] [💬 Tư vấn]│ ← Topbar
├────────────────┬─────────────────────────────────────┬───────────────────┤
│                │                                     │                   │
│  MỤC LỤC       │        XEM TRƯỚC (LIVE)             │  CHAT TƯ VẤN      │
│                │                                     │  (slide-over,     │
│  ⠿ Thông tin   │   ┌───────────────────────────┐    │   mặc định đóng)  │
│  ⠿ Giới thiệu  │   │  NGUYỄN VĂN A             │    │                   │
│  ⠿ Học vấn     │   │  Backend Developer        │    │  ┌─────────────┐  │
│  ⠿ Kinh nghiệm │   │  ─────────────────────    │    │  │ AI: Dự án   │  │
│  ⠿ Dự án    ⚠️ │   │  HỌC VẤN                  │    │  │ của bạn... │  │
│  ⠿ Kỹ năng     │   │  ...                      │    │  └─────────────┘  │
│  ⠿ Hoạt động   │   │                           │    │                   │
│                │   │  [click vào = sửa inline] │    │  [Nhập câu hỏi…]  │
│  + Thêm mục    │   └───────────────────────────┘    │                   │
│                │                                     │                   │
│  ─────────     │   Mẫu: [Thanh lịch ▾]  Màu: ●●●●    │                   │
│  ↶ Hoàn tác    │                                     │                   │
│  ↷ Làm lại     │                                     │                   │
└────────────────┴─────────────────────────────────────┴───────────────────┘
   240px                    linh hoạt                      380px (overlay)
```

**Quyết định bố cục — chỉ 2 pane, không phải 3.** Sinh viên Việt Nam phần lớn dùng laptop 1366×768. Ba pane cố định làm vùng xem trước còn ~500px, không đọc được CV. Chat là **slide-over đè lên**, không chiếm chỗ cố định.

**Sửa nội dung ở đâu?** Ngay trên bản xem trước (inline editing), không có form riêng. Click vào một dòng → thành ô nhập tại chỗ. Đây là điểm khác biệt với các CV builder truyền thống dùng form + preview tách đôi, vốn khiến người dùng phải liên tục đối chiếu hai bên.

### 3.2 Breakpoint

| Màn hình | Bố cục |
|---|---|
| ≥1280px | Mục lục + Xem trước (chat overlay) |
| 768–1279px | Mục lục thu thành icon; Xem trước toàn phần |
| <768px | **Chỉ xem + chat**. Sửa nội dung chuyển sang form dạng thẻ, không inline |

Sửa CV trên điện thoại là trải nghiệm tồi ở mọi sản phẩm. Giai đoạn 1 chỉ hỗ trợ **xem + chat** trên mobile, nói rõ với user thay vì làm nửa vời.

### 3.3 Chỉ báo trạng thái trên mục lục

Mỗi mục trong mục lục mang một dấu hiệu:

| Dấu | Nghĩa |
|---|---|
| (trống) | Ổn |
| ⚠️ vàng | Rubric cảnh báo (ví dụ: dự án < 2, bullet thiếu số liệu) |
| 🔴 đỏ | JD yêu cầu nhưng CV không có |
| ✨ tím | AI có đề xuất chưa duyệt |
| ⚪ xám | Nội dung do AI sinh, **chưa được xác nhận** (`_meta.verified = false`) |

Dấu ⚪ là cơ chế chống hallucination hiển thị ra giao diện: người dùng luôn nhìn thấy phần nào là do mình khai, phần nào do AI viết mà mình chưa duyệt.

---

## 4. Màn hình rà soát sau khi parse — `/import/:jobId/review`

Đây là màn hình **bắt buộc**, không có nút "Bỏ qua".

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Kiểm tra lại thông tin đọc được         Đã xác nhận 3/8 mục    [Tiếp →]  │
├────────────────────────────────┬─────────────────────────────────────────┤
│  BẢN GỐC                       │  HỆ THỐNG ĐỌC ĐƯỢC                      │
│                                │                                         │
│  ┌──────────────────────────┐  │  ▸ Thông tin cá nhân        ✓ đã xác nhận│
│  │                          │  │  ▾ Học vấn                  ⚠️ cần kiểm tra│
│  │  [ảnh trang PDF gốc,     │  │     Trường  [ĐH Bách Khoa HN        ]   │
│  │   vùng đang xét được     │  │     Ngành   [Kỹ thuật phần mềm      ]   │
│  │   tô sáng]               │  │     GPA     [3.2                    ]   │
│  │                          │  │     Thời gian [2021 – 2025          ]   │
│  └──────────────────────────┘  │     ┌───────────────────────────────┐   │
│   ◀ Trang 1/2 ▶                │     │ ✓ Đúng rồi   ✎ Sửa lại        │   │
│                                │     └───────────────────────────────┘   │
│                                │  ▸ Kinh nghiệm              ⚠️           │
│                                │  ▸ Dự án                    ⚠️           │
└────────────────────────────────┴─────────────────────────────────────────┘
```

**Chi tiết thiết kế:**

- Click vào một field bên phải → vùng tương ứng trên ảnh PDF bên trái được tô sáng. Người dùng đối chiếu được ngay, không phải nhớ.
- Nút `[Tiếp →]` **bị khóa** cho tới khi tất cả mục được xác nhận hoặc sửa.
- Field mà model không chắc (tự đánh dấu `low_confidence`) hiện viền vàng, đưa lên đầu.
- Có nút **"Đọc sai nhiều quá, để tôi nhập tay"** — luôn phải có đường thoát.

---

## 5. Màn hình đối chiếu JD — `/analyze/:cvId`

### 5.1 Đây là nơi ràng buộc 70 giây được giải quyết

Kiến trúc cho phép chia làm hai lớp có tốc độ khác nhau (TDD §8.2, quyết định D3):

```
t = 0s     User dán JD, bấm Phân tích
           │
t ≈ 1s     ├─ parse_jd xong (LLM, prompt ngắn)
           │
t ≈ 2s     ├─ ★ SCORING ENGINE (thuần code) TRẢ KẾT QUẢ NGAY
           │     → Điểm tổng, breakdown, danh sách matched/gaps
           │     → RENDER LÊN MÀN HÌNH LUÔN
           │
t ≈ 2-70s  └─ gap_analysis streaming, lời tư vấn điền dần vào từng gap
                 (mỗi gap có skeleton, thay bằng nội dung khi tới lượt)
```

**Người dùng thấy kết quả sau 2 giây, không phải 70 giây.** Phần chậm là lời khuyên bằng chữ, điền dần vào khung đã có sẵn. Đây là lý do thực dụng của quyết định "điểm số tính bằng code, LLM chỉ diễn giải".

### 5.2 Bố cục báo cáo

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Đối chiếu với: Backend Developer (Fresher) — Công ty XYZ                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│    ╭─────────╮   Kỹ năng        ████████░░  72                           │
│    │   68    │   Kinh nghiệm    █████░░░░░  55                           │
│    │ /100    │   Học vấn        █████████░  90                           │
│    ╰─────────╯   Từ khóa ATS    ██████░░░░  61                           │
│                                                                          │
├── ĐÃ KHỚP (7) ───────────────────────────────────────────────────────────┤
│  ✓ ReactJS          ← "Xây dựng SPA thương mại điện tử…"  [Dự án 1]     │
│  ✓ PostgreSQL       ← "Tối ưu truy vấn…"                  [Dự án 1]     │
├── CÒN THIẾU (4) ─────────────────────────────────────────────────────────┤
│  🔴 Docker          JD yêu cầu · CV chưa nhắc tới                        │
│      ┌────────────────────────────────────────────────────────────┐     │
│      │ ▓▓▓▓▓░░░░░ đang phân tích…            ← skeleton, điền dần  │     │
│      └────────────────────────────────────────────────────────────┘     │
│  🟠 CI/CD           JD yêu cầu · CV có nhắc gián tiếp                    │
│      💬 Bạn đã dùng GitHub Actions ở dự án 2. Nêu rõ ra sẽ khớp          │
│         được yêu cầu này.                                                │
│         📖 Theo Nguyễn Thị B — HR Lead, 8 năm  [xem trích dẫn]           │
│         [ Sửa giúp tôi ]                                                 │
├── TỪ KHÓA ATS THIẾU (5) ─────────────────────────────────────────────────┤
│  RESTful API · microservice · unit test · Agile · Git flow               │
└──────────────────────────────────────────────────────────────────────────┘
```

Nút `[Sửa giúp tôi]` trên mỗi gap → mở chat với ngữ cảnh đã nạp sẵn, không phải gõ lại.

### 5.3 Hiển thị nguồn tri thức

```
┌── Bình thường ──────────────────────────────────────────────┐
│ 💬 Bullet này nên có con số về quy mô dữ liệu bạn xử lý.    │
│    📖 Theo Nguyễn Thị B — HR Lead, 8 năm  [xem trích dẫn ▾] │  ← nền xanh nhạt
└─────────────────────────────────────────────────────────────┘

┌── Khi không có nguồn ───────────────────────────────────────┐
│ 💬 Có thể cân nhắc thêm phần chứng chỉ.                     │
│    ⚡ Gợi ý chung của AI — chưa có nguồn từ chuyên gia      │  ← nền xám, viền đứt
└─────────────────────────────────────────────────────────────┘
```

Hai kiểu hiển thị phải **khác nhau rõ rệt bằng mắt**, không chỉ khác chữ. Đây là ranh giới tạo niềm tin cho sản phẩm.

---

## 6. Chat & duyệt đề xuất

### 6.1 Luồng hội thoại có câu hỏi làm rõ

```
┌─ Chat ─────────────────────────────────────────────┐
│                                                    │
│                     User: Phần dự án của em yếu   │
│                           quá, sửa giúp em          │
│                                                    │
│  AI: Để viết lại cho mạnh hơn, mình cần vài        │
│      thông tin bạn chưa nêu:                       │
│                                                    │
│      ┌──────────────────────────────────────┐      │
│      │ 1. Dự án có bao nhiêu người?         │      │
│      │    [ 4 người            ]            │      │
│      │                                      │      │
│      │ 2. Bạn phụ trách phần nào?           │      │
│      │    [ Toàn bộ backend    ]            │      │
│      │                                      │      │
│      │ 3. Có số liệu đo được không?         │      │
│      │    (số user, thời gian, %…)          │      │
│      │    [ giảm load 3.2s→0.8s]            │      │
│      │                                      │      │
│      │  [ Gửi ]      [ Không có số liệu ]   │      │
│      └──────────────────────────────────────┘      │
└────────────────────────────────────────────────────┘
```

**Đây là hiện thân của nguyên tắc P2.** AI không tự bịa "500 người dùng" — nó hỏi. Nếu user bấm *"Không có số liệu"*, AI chuyển sang mô tả độ phức tạp/phạm vi theo guideline `g_no_metric_fallback` trong KB.

Câu hỏi hiển thị dạng **form có ô nhập**, không phải văn bản chờ trả lời tự do — giảm ma sát, và câu trả lời được gắn `message_id` làm `grounding` cho patch sau đó.

### 6.2 Modal duyệt đề xuất

```
┌──────────────────────────────────────────────────────────────────────┐
│  AI đề xuất 3 thay đổi                             [Bỏ qua tất cả]   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ☑ 1. Dự án 1 › gạch đầu dòng 2                                     │
│     ┌────────────────────────────────────────────────────────┐      │
│     │ − Làm đồ án website bán hàng bằng ReactJS và NodeJS.    │      │
│     │ + Xây dựng website thương mại điện tử (React +          │      │
│     │   Node.js + PostgreSQL), 12 màn hình, 28 API, quản lý   │      │
│     │   500+ sản phẩm. Tối ưu lazy loading, giảm thời gian    │      │
│     │   tải từ 3.2s xuống 0.8s. Nhóm 4 người, phụ trách       │      │
│     │   toàn bộ backend.                                      │      │
│     └────────────────────────────────────────────────────────┘      │
│     💡 Thêm số liệu bạn vừa cung cấp; đổi "Làm" → động từ mạnh       │
│     🔗 Nguồn: câu trả lời của bạn lúc 14:32                          │
│     📖 Theo Nguyễn Thị B — HR Lead                                   │
│                                                                      │
│  ☐ 3. Kỹ năng › thêm "Docker"                    ⚠️ CẦN XÁC NHẬN    │
│     ┌────────────────────────────────────────────────────────┐      │
│     │ + Docker                                                │      │
│     └────────────────────────────────────────────────────────┘      │
│     💡 JD yêu cầu Docker                                             │
│     🔗 Nguồn: suy luận từ JD — bạn CÓ THẬT SỰ biết Docker không?     │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                          [ Áp dụng 2 mục đã chọn ]  [ Đóng ]         │
└──────────────────────────────────────────────────────────────────────┘
```

**Quy tắc hiển thị theo `grounding.type`:**

| `grounding.type` | Hiển thị | Mặc định |
|---|---|---|
| `user_message` | 🔗 xanh, dẫn tới tin nhắn gốc | ☑ **tick sẵn** |
| `existing_field` | 🔗 xanh, dẫn tới field cũ | ☑ **tick sẵn** |
| `kb` | 📖 xanh, dẫn tới nguồn HR | ☑ **tick sẵn** |
| `inference` | ⚠️ **vàng, cảnh báo** | ☐ **KHÔNG tick sẵn** |

Ô `inference` không tick sẵn là điều kiện then chốt: AI muốn thêm một fact mà nó tự suy ra thì người dùng phải chủ động đồng ý.

---

## 7. Xuất file

```
┌────────────────────────────────────────────────────────────┐
│  Xuất CV                                                   │
├────────────────────────────────────────────────────────────┤
│  Bạn nộp CV bằng cách nào?                                 │
│                                                            │
│  ○ Nộp qua hệ thống tuyển dụng trực tuyến                  │
│     → Bản ATS-safe: 1 cột, không icon, không bảng.         │
│       Máy quét hồ sơ đọc chính xác hơn.                    │
│                                                            │
│  ● Gửi email trực tiếp / in ra                             │
│     → Bản trình bày: giữ nguyên bố cục và màu sắc.         │
│                                                            │
│  ☑ Tải cả hai bản                                          │
│                                                            │
│                              [ Huỷ ]  [ Tạo file PDF ]     │
└────────────────────────────────────────────────────────────┘
```

Câu hỏi đặt theo **tình huống của user**, không theo thuật ngữ kỹ thuật. Người dùng không cần biết "ATS" là gì để chọn đúng.

---

## 8. Trạng thái hệ thống & degrade

### 8.1 Banner khi AI không khả dụng

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚠️  Trợ lý AI đang tạm ngưng. Bạn vẫn sửa CV, đổi mẫu và tải file    │
│    bình thường. Chúng tôi sẽ báo khi hoạt động trở lại.  [Thử lại]   │
└──────────────────────────────────────────────────────────────────────┘
```

Kèm theo: các nút cần AI chuyển sang trạng thái `disabled` + tooltip giải thích, **không** biến mất (biến mất khiến người dùng tưởng mình làm sai).

### 8.2 Degrade một phần

| Tình huống | Hiển thị |
|---|---|
| `embedder` chết | Trên báo cáo: *"Đang đối chiếu bằng từ khóa. Phân tích ngữ nghĩa tạm không khả dụng — điểm có thể thấp hơn thực tế."* |
| Nội dung bị cắt do ngân sách (`truncated`) | *"CV của bạn dài, một phần chưa được đưa vào phân tích. Cân nhắc rút gọn để kết quả chính xác hơn."* |
| KB chưa có cho ngành này | *"Chưa có tri thức chuyên gia cho lĩnh vực này. Các gợi ý dưới đây là gợi ý chung."* |

### 8.3 Hàng đợi

```
┌────────────────────────────────────────────────────┐
│  ⏳ Đang phân tích…                                │
│                                                    │
│  Bạn đang ở vị trí thứ 3 trong hàng đợi            │
│  Ước tính khoảng 2 phút                            │
│                                                    │
│  ☑ Báo cho tôi khi xong (bạn có thể đóng tab)      │
└────────────────────────────────────────────────────┘
```

Job chạy nền. Đóng tab không mất kết quả — TDD §7.2 bảng `jobs` có `idempotency_key`, mở lại là thấy.

---

## 9. Kiến trúc kỹ thuật frontend

### 9.1 Stack

| Lớp | Chọn |
|---|---|
| Framework | Next.js 15 App Router · React 19 · TypeScript strict |
| Style | Tailwind CSS · shadcn/ui (Radix primitives) |
| Server state | TanStack Query v5 |
| Editor state | Zustand (Profile draft, undo/redo stack, selection) |
| Form | React Hook Form + `@hookform/resolvers/zod` — dùng chung schema với backend |
| Streaming | `EventSource` (SSE) |
| Kéo thả | `@dnd-kit/core` (sắp xếp section) |
| i18n | `next-intl` |
| Xem PDF | `pdf.js` (render ảnh trang cho màn hình rà soát) |

### 9.2 Điểm mấu chốt: **thao tác của user cũng là JSON Patch**

```ts
// Sửa tay và AI sửa đi qua CÙNG một đường ống
type ProfileMutation =
  | { source: 'user'; ops: PatchOp[] }
  | { source: 'ai';   ops: PatchOp[]; proposalId: string }

// Zustand store
interface EditorStore {
  profile: Profile
  undoStack: PatchOp[][]
  redoStack: PatchOp[][]
  pendingProposals: PatchProposal[]

  applyUser(ops: PatchOp[]): void        // optimistic → sync ngầm
  applyAccepted(proposalId: string, opIndexes: number[]): void
  undo(): void
  redo(): void
}
```

Lợi ích: **một lịch sử duy nhất**. Undo hoạt động đồng nhất dù thay đổi đến từ tay người hay từ AI. Không cần hai cơ chế song song.

**Lưu ý phân biệt optimistic update:**

| Nguồn | Optimistic? |
|---|---|
| User sửa tay | ✅ Cập nhật UI ngay, đồng bộ server ngầm, rollback nếu lỗi |
| AI đề xuất | ❌ **Không bao giờ.** Chỉ áp dụng sau khi user bấm duyệt |

### 9.3 Render CV — một nguồn duy nhất

```
packages/templates/
├── registry.ts                  templateId → component
├── elegant/
│   ├── index.tsx                nhận (profile, theme, layout, variant)
│   └── styles.css               @media print · @page A4 · break-inside
└── minimal/

Dùng ở 3 nơi, cùng một component:
  1. /builder/:cvId    xem trước live (variant="screen")
  2. /print/:cvId      Playwright render → PDF (variant="presentation" | "ats")
  3. thumbnail         chụp nhỏ cho danh sách CV
```

Đây là cách rẻ nhất để bản xem trước khớp file PDF. Không viết hai renderer.

**`variant="ats"`** không phải template riêng — là cùng component với `layout.columns = 1`, tắt icon/màu nền/bảng, dùng font hệ thống.

### 9.4 Sửa inline

```tsx
// Mỗi field trong template bọc trong Editable — nhận path JSON Pointer
<Editable path="/projects/0/highlights/1" multiline>
  {profile.projects[0].highlights[1]}
</Editable>

// Editable tự lo: click → focus → blur/Ctrl+Enter → phát PatchOp
//                 Escape → huỷ · hiện badge ⚪ nếu _meta.verified = false
```

Template chỉ khai báo `path`. Toàn bộ logic sửa nằm trong `Editable`, không rải rác trong từng template.

### 9.5 SSE và stream từng phần

```ts
// Báo cáo đối chiếu: nhận theo từng sự kiện, không chờ trọn gói
const es = new EventSource(`/api/match/${id}/stream`)

es.addEventListener('score',    e => setScore(JSON.parse(e.data)))      // ~2s
es.addEventListener('gap',      e => upsertGap(JSON.parse(e.data)))     // dần dần
es.addEventListener('citation', e => attachCitation(JSON.parse(e.data)))
es.addEventListener('degraded', e => setDegraded(JSON.parse(e.data)))
es.addEventListener('done',     () => es.close())
es.onerror = () => { es.close(); fallbackToPolling(id) }   // luôn có đường lui
```

### 9.6 Song ngữ — 3 trục độc lập (TDD §9)

```ts
// KHÔNG gộp làm một
const uiLocale       = useLocale()              // giao diện
const contentLang    = profile.language         // ngôn ngữ CV
const jdLang         = jd?.language             // ngôn ngữ JD

// Chuyển ngôn ngữ CV không đổi ngôn ngữ giao diện, và ngược lại
```

Trên topbar có công tắc `vi | en` — công tắc này đổi **ngôn ngữ CV**, không đổi giao diện. Ngôn ngữ giao diện nằm trong `/settings`. Phải nói rõ bằng nhãn để tránh nhầm.

### 9.7 Hiệu năng

| Kỹ thuật | Lý do |
|---|---|
| `debounce` 400ms trước khi phát patch | Gõ inline không tạo một patch mỗi ký tự |
| `useDeferredValue` cho preview | Gõ không giật khi CV dài |
| Virtualize danh sách gap | Báo cáo có thể 30+ mục |
| Cache kết quả theo `(cvRevision, jdId)` | Không phân tích lại khi không có gì đổi (TDD §14.3) |
| Prefetch template khi hover trong picker | Đổi mẫu thấy tức thì |

### 9.8 Khả năng tiếp cận

- Sửa inline phải dùng được bằng bàn phím: `Tab` di chuyển, `Enter` vào sửa, `Escape` huỷ
- Kéo thả section có phương án thay thế bằng phím (`@dnd-kit` hỗ trợ sẵn)
- Màu không phải kênh thông tin duy nhất — mọi trạng thái ⚠️🔴✨ đều kèm icon và text
- Vùng streaming dùng `aria-live="polite"` để trình đọc màn hình thông báo nội dung mới

---

## 10. Thư viện thành phần

```
components/
├── ui/                     shadcn: Button · Dialog · Sheet · Tooltip …
├── editor/
│   ├── Editable.tsx        ★ ô sửa inline theo JSON Pointer
│   ├── SectionOutline.tsx  mục lục + kéo thả + chỉ báo trạng thái
│   ├── ThemePicker.tsx     mẫu · màu · font · giãn dòng
│   └── UndoRedo.tsx
├── review/
│   ├── PdfPageViewer.tsx   ảnh trang + tô sáng vùng
│   └── FieldConfirm.tsx    "Đúng rồi / Sửa lại"
├── analysis/
│   ├── ScoreRing.tsx       vòng điểm + breakdown
│   ├── GapCard.tsx         hỗ trợ skeleton → nội dung streaming
│   └── CitationBadge.tsx   ★ 📖 có nguồn / ⚡ gợi ý chung
├── chat/
│   ├── ChatPanel.tsx       slide-over
│   ├── ClarifyForm.tsx     ★ form câu hỏi làm rõ
│   └── PatchReviewModal.tsx ★ diff + checkbox theo grounding
└── system/
    ├── DegradeBanner.tsx
    ├── QueuePosition.tsx
    └── JobProgress.tsx
```

★ = thành phần đặc thù của sản phẩm này, không có sẵn trong thư viện. Đây là những chỗ cần đầu tư thiết kế kỹ nhất.

---

## 11. Ngôn ngữ giao diện

Đối tượng là sinh viên chưa đi làm. Nguyên tắc viết:

| Không dùng | Dùng |
|---|---|
| "ATS-optimized export" | "Bản dành cho hệ thống tuyển dụng tự động" |
| "Semantic matching unavailable" | "Đang đối chiếu bằng từ khóa" |
| "Schema validation failed" | "Chưa đọc được thông tin này, bạn nhập giúp nhé" |
| "Grounding: inference" | "AI tự suy ra — bạn xác nhận giúp nhé" |
| "Token budget exceeded" | "CV hơi dài, một phần chưa được phân tích" |

Thông báo lỗi phải nói **user làm gì tiếp theo**, không mô tả lỗi kỹ thuật.

---

## 12. Việc chưa làm ở giai đoạn 1

| Hạng mục | Lý do hoãn |
|---|---|
| Sửa CV trên mobile | Trải nghiệm kém; chỉ hỗ trợ xem + chat |
| Template mức B (2 cột) | M6 |
| Cộng tác thời gian thực | Không có nhu cầu ở MVP |
| Chế độ tối | Ưu tiên thấp |
| Chia sẻ CV bằng link công khai | Cần cân nhắc PII trước |
| Import từ LinkedIn | Phụ thuộc API bên thứ ba |
