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
│ /                  ★ HOME — BA màn hình, chọn theo TRẠNG THÁI THẬT │
│                      · chưa có gì      → bộ định tuyến ý định      │
│                      · đang dở dang    → tiếp tục việc đang làm    │
│                      · đã có hồ sơ     → bảng việc cần làm         │
│ /login               Đăng nhập bằng magic link (UC-11)             │
└───────────────────────────────────────────────────────────────────┘

┌─ Onboarding ──────────────────────────────────────────────────────┐
│ /start/guided        Làm CV từ đầu, có người dẫn (UC-05)           │
│ /import?intent=…     Tải CV lên, mang theo ý định từ Home          │
│ /import              Tải PDF → tiến trình xử lý                    │
│ /import/:jobId/review   ★ MÀN HÌNH RÀ SOÁT (bắt buộc)             │
└───────────────────────────────────────────────────────────────────┘

┌─ Workspace ───────────────────────────────────────────────────────┐
│ /diagnose/:cvId      ★ Chẩn đoán sức khoẻ CV (UC-04)              │
│ /builder/:cvId       ★ Trình soạn CV (màn hình chính)             │
│   ├─ panel: Chat tư vấn        (slide-over bên phải)              │
│   ├─ modal: Duyệt đề xuất      (diff từng thay đổi)               │
│   └─ modal: Xuất file          (chọn bản trình bày / ATS)         │
│ /analyze/:cvId       Nhập JD → Báo cáo đối chiếu                  │
│ /cv                  Danh sách CV của tôi                          │
│ /cv/new              Nhập tay (UC-23)                              │
│ /settings            Tài khoản · ngôn ngữ · quyền riêng tư         │
└───────────────────────────────────────────────────────────────────┘

┌─ Curator ─────────────────────────────────────────────────────────┐
│ /kb                  Nguồn tri thức + duyệt chunk (một màn hình)   │
└───────────────────────────────────────────────────────────────────┘
  CHƯA CÓ: /admin/kb/review tách riêng · /admin/health (metric model
  server). Trạng thái model hiện chỉ đọc được ở GET /api/health.

┌─ Nội bộ (không hiện với user) ────────────────────────────────────┐
│ /print/:cvId?variant=presentation|ats   ← Playwright render → PDF  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2.1 Home — ba màn hình, một địa chỉ

Thiết kế và lý do đầy đủ ở [PRODUCT.md](./PRODUCT.md). Tóm tắt phần giao diện:

| Trạng thái | Câu hỏi màn hình trả lời | Thành phần |
|---|---|---|
| Chưa có hồ sơ | *"Bạn cần giúp gì?"* | `IntentRouter` — 4 lối vào |
| Có import dở dang | *"Tiếp tục chỗ đang dở?"* | `ResumeHome` |
| Đã có hồ sơ | *"Bạn nên làm gì tiếp?"* | `ReturningHome` |

Quyết định nằm ở `lib/home-state.ts` — hàm thuần, kiểm được cả ba nhánh mà
không cần dựng React hay Postgres. **Không dùng cookie "đã xem onboarding"**:
cookie nói người dùng đã NHÌN thấy gì, còn thứ cần biết là họ đang ở ĐÂU trong
công việc của mình.

Hai chỗ dễ sai, đã đo trên máy thật và đã có test hồi quy:

- **Chỉ job `parse_cv` mới là "việc dở dang".** Một job `match_analysis` đã
  xong (kết quả không có `profileId`) từng làm Home hiện *"Hệ thống đang đọc CV
  của bạn"* cho một việc chẳng liên quan.
- **Job HỎNG chỉ chặn người CHƯA có hồ sơ.** Người đã có hồ sơ thì đã đi tiếp;
  một lần thử hỏng bỏ dở không được giữ họ ở màn hình lỗi suốt 24 giờ.

Con số "Hồ sơ đã đầy đủ N%" tính bằng `profileCompleteness()` và **bấm vào xem
được nó gồm những gì** (BR-02.1). Không phần trăm nào mà người dùng không tra
được nguồn.

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

Cột **Trạng thái** ghi thứ ĐANG chạy, không phải thứ dự kiến — bảng này từng
liệt kê 6 thư viện chưa hề được cài, và người đọc không có cách nào biết.

| Lớp | Chọn | Trạng thái |
|---|---|---|
| Framework | Next.js 15 App Router · React 19 · TypeScript strict | ✅ đang dùng |
| Style | Tailwind CSS v4 + token `@theme` (xem §12.1) | ✅ đang dùng |
| Component | Tự viết — `components/ui/`, 8 primitive (xem §12.3). Không có shadcn/ui hay Radix | ✅ đang dùng |
| Chữ | Be Vietnam Pro qua `next/font/local`, 2 weight | ✅ đang dùng |
| Server state | `fetch` trần trong Server Component + `useEffect` ở client | ✅ đang dùng |
| Editor state | Zustand — `lib/editor-store.ts` (draft, undo/redo), `lib/chat-store.ts` | ✅ đang dùng |
| Form | Thẻ `<form>` gốc; kiểm dữ liệu bằng Zod ở route handler | ✅ đang dùng |
| Streaming | `EventSource` cho job (`/api/jobs/:id/stream`); chat đọc `ReadableStream` bằng tay vì `EventSource` chỉ làm được GET | ✅ đang dùng |
| Xem PDF | pdfkit render sẵn PNG theo yêu cầu (`/api/imports/:jobId/pages`, 110 dpi), client chỉ hiện `<img>` | ✅ đang dùng |
| Kéo thả | — | ⛔ chưa có (§10 mô tả thiết kế) |
| i18n | — | ⛔ chưa có. Chuỗi giao diện đang viết thẳng tiếng Việt |

**Vì sao không có thư viện server-state.** Màn hình nào cũng là Server Component
đọc thẳng từ repository, phần client chỉ còn vài chỗ polling job. Thêm một tầng
cache nữa thì phải đồng bộ nó với `editor-store`, mà `editor-store` mới là nguồn
sự thật của bản nháp.

**Render trang PDF ở server, không phải pdf.js.** Bản rà soát cần ảnh trang gốc
đúng như pdfkit đọc được — dùng pdf.js ở client là render bằng một engine khác
với engine đã trích text, và hai bên lệch nhau thì vùng tô sáng trỏ sai chỗ.

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

Có **hai** đường stream, dùng cơ chế khác nhau vì ràng buộc khác nhau.

**a) Tiến trình job — `EventSource`, GET.** Dùng cho import CV và phân tích JD.

```ts
// components/import/UploadBox.tsx
const es = new EventSource(`/api/jobs/${jobId}/stream`)

es.addEventListener('status',   e => setStatus(JSON.parse(e.data)))
es.addEventListener('progress', e => setPct(JSON.parse(e.data).pct))
es.addEventListener('done',     e => finish(JSON.parse(e.data).result))
es.addEventListener('failed',   e => showError(JSON.parse(e.data)))
es.addEventListener('timeout',  e => reconnect())
es.onerror = () => {
  // SSE tự kết nối lại; chỉ báo lỗi khi trình duyệt đã bỏ cuộc hẳn
  if (es.readyState === EventSource.CLOSED) showError({ code: 'STREAM' })
}
```

**b) Lượt chat — đọc `ReadableStream` bằng tay, POST.** `EventSource` chỉ làm
được GET, mà một lượt chat phải gửi hồ sơ và câu trả lời qua body. Bộ đọc nằm ở
`lib/chat-store.ts` (`readSse`), phát `step` cho từng bước của `runChatTurn` —
`planning`, `answering`, `asking`, `proposing`, `validating` — rồi tới `result`.

### 9.6 Song ngữ — 3 trục độc lập (TDD §9)

```ts
// KHÔNG gộp làm một
const uiLocale       = useLocale()              // giao diện
const contentLang    = profile.language         // ngôn ngữ CV
const jdLang         = jd?.language             // ngôn ngữ JD

// Chuyển ngôn ngữ CV không đổi ngôn ngữ giao diện, và ngược lại
```

Trạng thái hiện tại — ba trục KHÔNG cùng tiến độ:

| Trục | Trạng thái |
|---|---|
| `profile.language` — ngôn ngữ CV | ✅ có công tắc `vi \| en` trên thanh của `/builder` (`components/editor/CvLanguageSwitch.tsx`) |
| `jd.language` — ngôn ngữ JD | ✅ có trong dữ liệu, chưa có công tắc; hiện `JdForm` gửi cứng `'vi'` |
| `uiLocale` — ngôn ngữ giao diện | ⛔ chưa có. Chuỗi giao diện viết thẳng tiếng Việt — xem §9.1 |

Công tắc ngôn ngữ CV **không dịch nội dung**. Nó đổi ngôn ngữ khai báo, và
tiêu đề mục do template sinh đi theo (`Ngoại ngữ` ↔ `Languages`); chữ người
dùng tự viết giữ nguyên. Nhãn cạnh công tắc nói rõ điều này — không nói thì
người dùng bấm EN rồi chờ CV tự dịch.

### 9.7 Hiệu năng

| Kỹ thuật | Lý do |
|---|---|
| `debounce` 400ms trước khi phát patch | Gõ inline không tạo một patch mỗi ký tự |
| `useDeferredValue` cho preview | Gõ không giật khi CV dài |
| Cache kết quả theo `(cvRevision, jdId)` | Không phân tích lại khi không có gì đổi (TDD §14.3) |

Hai hạng mục "Virtualize danh sách gap" và "Prefetch template khi hover" đã
chuyển xuống §13 — để chúng ở đây khiến người đọc tưởng đã có.

### 9.8 Khả năng tiếp cận

- Sửa inline phải dùng được bằng bàn phím: `Tab` di chuyển, `Enter` vào sửa, `Escape` huỷ
- Kéo thả section: **chưa xây**, chưa có `@dnd-kit` (§10 — `SectionOutline.tsx` "CHƯA có kéo thả"); khi xây phải có phương án thay thế bằng phím ngay từ đầu, không thêm sau
- Màu không phải kênh thông tin duy nhất — mọi trạng thái ⚠️🔴✨ đều kèm icon và text
- Vùng streaming dùng `aria-live="polite"` để trình đọc màn hình thông báo nội dung mới

---

## 10. Thư viện thành phần

Cây dưới đây là `apps/web/components/` THẬT.

```
components/
├── ui/                      8 primitive tự viết, không phụ thuộc ngoài — §12.3
│   ├── Button.tsx · Card.tsx · Section.tsx · Badge.tsx
│   ├── Meter.tsx · Dialog.tsx · Sheet.tsx · Field.tsx
│   └── useFocusTrap.ts      dùng chung bởi Dialog và Sheet
├── ai/
│   └── AiPanel.tsx          ★ chữ ký AI, tầng "bề mặt" — §12.4
├── analyze/
│   ├── JdForm.tsx           dán JD → gửi phân tích
│   └── ReportView.tsx       ★ điểm + breakdown + gap + trích dẫn, hỗ trợ
│                              skeleton → nội dung điền dần (§5.1)
├── chat/
│   ├── ChatPanel.tsx        slide-over
│   ├── ClarifyForm.tsx      ★ form câu hỏi làm rõ (§6.1)
│   └── PatchReviewModal.tsx ★ diff + checkbox theo grounding (§6.2)
├── diagnose/
│   └── HealthReport.tsx     chẩn đoán sức khoẻ CV (UC-04)
├── editor/
│   ├── BuilderShell.tsx     khung 2 pane của /builder
│   ├── Editable.tsx         ★ ô sửa inline theo JSON Pointer (§9.4)
│   ├── RevisionPreview.tsx  xem một mốc trước khi khôi phục (UC-34)
│   ├── SectionOutline.tsx   mục lục + chỉ báo trạng thái (CHƯA có kéo thả)
│   ├── ThemePicker.tsx      mẫu · màu
│   ├── UndoRedo.tsx
│   └── VersionHistory.tsx   danh sách mốc
├── guided/
│   └── GuidedFlow.tsx       luồng có người dẫn (UC-05)
├── home/
│   ├── IntentRouter.tsx     Home lần đầu — 4 lối vào (§2.1)
│   ├── ResumeHome.tsx       Home khi có việc dở dang
│   └── ReturningHome.tsx    Home khi đã có hồ sơ
├── import/
│   └── UploadBox.tsx        tải PDF + theo dõi job qua SSE
├── kb/
│   └── KbCurator.tsx        duyệt chunk (UC-61)
├── nav/
│   └── TopNav.tsx
├── review/
│   ├── OriginalPane.tsx     ★ ảnh trang PDF + tô sáng vùng (thay cho
│   │                          "PdfPageViewer" ở bản thiết kế cũ)
│   ├── ReviewList.tsx       ★ từng mục "Đúng rồi / Sửa lại"
│   └── ReviewShell.tsx      khung 2 cột của màn hình rà soát (§4)
├── settings/
│   └── DeleteAccount.tsx
└── system/
    └── DegradeBanner.tsx    §8.1
```

★ = thành phần đặc thù của sản phẩm này. Đây là những chỗ cần đầu tư thiết kế kỹ nhất.

**Chưa có, và biết là chưa có:** `QueuePosition` / `JobProgress` (§8.3 — hiện
tiến trình nằm trong `UploadBox`), và tách `ScoreRing` / `GapCard` /
`CitationBadge` ra khỏi `ReportView`.

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

## 12. Hệ thiết kế

Nguồn: [spec 2026-08-07](superpowers/specs/2026-08-07-frontend-redesign-design.md).

### 12.1 Token

Khai một chỗ duy nhất trong `apps/web/app/globals.css` bằng `@theme` của
Tailwind v4. Component **không** dùng palette thô (`bg-sky-600`,
`text-neutral-500`) — trước đây cách đó tạo ra 586 lượt màu rải trên 38 file.

| Nhóm | Token | Dùng ở đâu |
|---|---|---|
| Thương hiệu | `brand` `brand-hover` `brand-subtle` `brand-border` `brand-ink` | nút chính, link, **và mọi vùng AI** |
| Mực & nền | `ink` `ink-muted` `ink-subtle` `surface` `canvas` `border` `border-strong` | |
| Trạng thái | `success` `warn` `danger` + bản `-subtle` | |

Ngoài bảng màu, `@theme` còn khai đúng ba mức bo góc (`radius-sm/md/lg`) và
đúng hai mức bóng (`shadow-sm` cho thẻ nổi, `shadow-md` cho lớp phủ) — không
thêm mức thứ tư/thứ ba để tránh trôi dạt tuỳ ý.

**Quy tắc một dòng:** teal chỉ dành cho thương hiệu và AI. Thấy teal là biết
máy đang tham gia. Trạng thái không mượn teal; AI không mượn xanh lá, vàng, đỏ.

**Chỉ có chế độ sáng.** Spec quyết định D4 gỡ hẳn `dark:` khỏi phạm vi —
không phải hoãn sang giai đoạn sau. Lý do: bớt một bảng màu phải chăm, và
`/print` (bản PDF) vốn luôn hiển thị sáng nên chế độ tối không giúp gì ở đó.

### 12.2 Chữ

Be Vietnam Pro nạp bằng `next/font/local` (file `.woff2` trong repo, không gọi
mạng). Hai weight: 400 và 600.

`packages/templates/src/styles.css` tham chiếu qua **cùng biến CSS**
`--font-be-vietnam`, nên bản xem trước và file PDF không lệch font.

Thang chữ nới rộng hơn mặc định vì dấu tiếng Việt chồng cả trên lẫn dưới:
`display 30/38 · h1 24/32 · h2 18/28 · h3 15/22 · body 15/24 · small 13/20 ·
micro 12/16`.

**Cố ý KHÔNG cài font vào `services/worker/Dockerfile`.** Spec §3.2 (bản gốc)
dự tính thêm, nhưng đo bằng Playwright thật (mở `/print/:cvId`, hai `cvId`
khác nhau, hai lần chạy) cho kết quả: `document.fonts` báo `beVietnamPro`
weight 400 và 600 `status=loaded`, và `getComputedStyle('.cv-root').fontFamily`
bắt đầu bằng `beVietnamPro`. Lý do việc này chạy được mà không cần cài font
vào image: `/print` dùng root layout của web app, nên Chromium của Playwright
tải `.woff2` qua HTTP từ chính web app — cùng origin với trang nó vừa mở,
không cần font hệ điều hành, không gọi mạng ra ngoài. Thêm: fontconfig không
xử lý `.woff2` đáng tin, nên cài vào image cũng không chắc có tác dụng.

### 12.3 Primitive

`apps/web/components/ui/` — tám cái, không thêm dependency ngoài.

`Button` · `Card` · `Section` · `Badge` · `Meter` · `Dialog` · `Sheet` · `Field`

(Thư mục còn có `devWarn.ts` và `useFocusTrap.ts` — tiện ích dùng chung, không
tính vào tám primitive.)

Hai cái mang doctrine, ở mức khuyến nghị (thiếu thì cảnh báo ở dev qua
`devWarn`, không chặn build):

- `Button` nhận `disabledReason` — §8.1 yêu cầu nút cần AI phải mờ đi **kèm
  lời giải thích**, không biến mất.
- `Meter` nhận `parts` — BR-02.1 yêu cầu mọi phần trăm phải tra được nguồn.

`Dialog` và `Sheet` dùng chung `useFocusTrap`: Escape đóng, bẫy focus, trả
focus về nơi đã mở, khoá cuộn nền.

### 12.4 Chữ ký AI

`components/ai/AiPanel.tsx` là tầng **bề mặt** của chữ ký AI: nó bọc
`Card variant="ai"` (nền `brand-subtle`, viền `brand-border`, dải gradient 3px
phía trên — khai trong `components/ui/Card.tsx`) và xử lý luôn trạng thái
degrade. Shimmer chỉ chạy khi `streaming`, tắt theo `prefers-reduced-motion`.

Chữ ký AI hoàn chỉnh gồm ba tầng, nhưng chúng **không nằm cùng một file**:

1. **Bề mặt** — `AiPanel.tsx`, mô tả ở trên.
2. **Lối vào** — nút `✦ Trợ lý` ở `components/nav/TopNav.tsx`, luôn dẫn tới
   `/builder/:cvId?assistant=1` (mang theo CV đang mở, không mở chat rỗng).
3. **Chứng cứ** — diff trước/sau và badge nguồn theo `grounding.type` nằm ở
   `components/chat/PatchReviewModal.tsx`; dấu ⚪ cho nội dung chưa xác nhận
   nằm ở `components/editor/Editable.tsx` (§3.3).

**Hiện trạng, chưa xong hết:**

- `AiPanel.tsx` mới được dùng ở đúng **một** màn hình (`ReturningHome.tsx`,
  qua prop `available`). `ChatPanel`, `ReportView`, `PatchReviewModal`,
  `ClarifyForm` là các vùng AI khác nhưng **chưa** chuyển sang dùng
  `AiPanel`/`Card variant="ai"` — "mọi vùng AI đi qua AiPanel" là hướng đích,
  không phải hiện trạng.
- `?assistant=1` trên link "Trợ lý" ở TopNav **chưa được `/builder` đọc** —
  màn builder hiện bỏ qua tham số này. Phần tiêu thụ nó thuộc việc chưa làm.
- `?focus=<path>` cùng bệnh, và đây là CTA chính trong khối AI trên trang chủ
  — hành động nổi bật nhất màn hình. `apps/web/lib/home-state.ts`
  (`nextStepFor`) và `components/diagnose/HealthReport.tsx` cùng dựng
  `href: /builder/${cvId}?focus=${gap.path}`, nhưng
  `app/(app)/builder/[cvId]/page.tsx` không nhận `searchParams` và không chỗ
  nào trong repo đọc param `focus`. Phần tiêu thụ nó cũng thuộc việc chưa làm.

**Trạng thái degrade nằm cùng file với chữ ký**, có chủ ý: chữ ký làm khối AI
to, nên xử lý lúc-model-chết ở nơi khác sẽ có chỗ quên, và chỗ quên hiện ra
thành một ô rỗng giữa màn hình.

Nguồn cho prop `available` là `apps/web/lib/health.ts` (`aiAvailable()`), một
file mới bọc `Gateway.health()` bằng ba lớp: cache 30 giây (tránh dội việc
ping vào model server mỗi lần Home được tải), timeout 1,5 giây (`Promise.race`
với một promise hẹn giờ), và trả `true` (lạc quan) khi lỗi hoặc quá hạn. Cần
lớp bọc này vì `Gateway.health()` ping cả 6 provider qua mạng và không tự
cache — gọi thẳng khi render Home sẽ làm trang chủ phụ thuộc model server,
trái ràng buộc "degrade, đừng sập" (TDD §3.2 A7).

### 12.5 Điểm khớp JD không tô màu

TDD §8.2.3: đo thực tế cho 41 và 41 là **đúng**; thứ có ý nghĩa là thứ tự
tương đối, không phải vạch ngưỡng. Con số để `ink` trung tính; nghĩa nằm ở
dòng sự thật đếm được bên dưới ("Thiếu 4/11 kỹ năng JD yêu cầu") và ở thứ hạng
so với các lần đối chiếu khác của chính người dùng.

---

## 13. Việc chưa làm ở giai đoạn 1

| Hạng mục | Lý do hoãn |
|---|---|
| Dùng thử không đăng nhập (UC-12) | BR-12.1 cấm khách gọi AI, mà AI chính là giá trị ở lần chạm đầu. Bộ định tuyến ý định đã cho người lạ thấy sản phẩm làm gì trước khi đăng ký |
| Đăng nhập bằng Google | Cần đăng ký ứng dụng và khoá bí mật; magic link đã đủ cho giai đoạn này |
| Sửa CV trên mobile | Trải nghiệm kém; chỉ hỗ trợ xem + chat |
| Template mức B (2 cột) | M6 |
| Cộng tác thời gian thực | Không có nhu cầu ở MVP |
| Chia sẻ CV bằng link công khai | Cần cân nhắc PII trước |
| Import từ LinkedIn | Phụ thuộc API bên thứ ba |
| Virtualize danh sách gap | Báo cáo hiện chưa vượt 30 mục trên dữ liệu thật; làm khi đo được là chậm |
| Prefetch template khi hover | Chờ bộ chọn mẫu được dựng lại ở kế hoạch 2 |

**Chế độ tối không nằm trong bảng này** — spec D4 đã **quyết bỏ hẳn**, không
phải hoãn. Xem §12.1.
