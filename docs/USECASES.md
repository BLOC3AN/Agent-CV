# HR-Agent — Đặc tả Use Case

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 2026-08-06 |
| **Phạm vi** | Giai đoạn 1 (MVP) |
| **Liên quan** | [TDD.md](./TDD.md) · [FRONTEND.md](./FRONTEND.md) · [TESTCASES.md](./TESTCASES.md) |

---

## 0. Quy ước

**Tác nhân**

| Ký hiệu | Tác nhân | Mô tả |
|---|---|---|
| `UC` | Ứng viên | Sinh viên / người mới tốt nghiệp — người dùng chính |
| `GU` | Khách | Dùng thử chưa đăng nhập |
| `CR` | Curator | Người quản lý Knowledge Base |
| `SYS` | Hệ thống | Tiến trình nền, worker |
| `LLM` | Model server | Dependency ngoài, có thể không khả dụng |

**Độ ưu tiên:** `P0` bắt buộc cho MVP · `P1` nên có · `P2` để sau

**Mã use case**

```
UC-1x  Tài khoản          UC-4x  Đối chiếu JD
UC-2x  Tạo & sửa Profile  UC-5x  Trợ lý AI
UC-3x  CV & xuất file     UC-6x  Knowledge Base
                          UC-7x  Hệ thống & degrade
```

---

## Sơ đồ tổng quan

```
                    ┌─────────────────────────────────────────┐
                    │              HR-Agent                   │
                    │                                         │
   ┌────┐           │  UC-11 Đăng nhập                        │
   │ GU │──────────►│  UC-12 Dùng thử                         │
   └────┘           │                                         │
                    │  UC-21 Import CV từ PDF ─┐              │
   ┌────┐           │  UC-22 Rà soát kết quả  ◄┘  «bắt buộc»  │
   │ UC │──────────►│  UC-23 Nhập tay                         │        ┌─────┐
   └────┘           │  UC-24 Sửa Profile                      │───────►│ LLM │
      │             │                                         │        └─────┘
      │             │  UC-31 Chọn mẫu   UC-32 Xuất PDF        │
      │             │                                         │
      │             │  UC-41 Nhập JD    UC-42 Xem báo cáo     │
      │             │                                         │
      └────────────►│  UC-51 Chat  UC-52 Trả lời câu hỏi      │
                    │  UC-53 Duyệt đề xuất  UC-54 Hoàn tác    │
   ┌────┐           │                                         │
   │ CR │──────────►│  UC-61 Nạp nguồn  UC-62 Duyệt tri thức  │
   └────┘           │                                         │
                    │  UC-71 Degrade    UC-72 Hàng đợi        │
                    └─────────────────────────────────────────┘
```

---

# UC-1x — Tài khoản

## UC-11 · Đăng nhập / Đăng ký `P0`

| | |
|---|---|
| **Tác nhân** | GU |
| **Kích hoạt** | Bấm "Bắt đầu" hoặc truy cập trang cần đăng nhập |
| **Tiền điều kiện** | Không |
| **Hậu điều kiện** | Có session hợp lệ; `users` có bản ghi |

**Luồng chính**
1. GU chọn "Tiếp tục với Google" hoặc nhập email.
2. Với Google: OAuth → callback → tạo/khớp user theo email.
3. Với email: gửi magic link (hết hạn 15 phút) → GU bấm link.
4. Hệ thống tạo session, đặt `users.locale` theo `Accept-Language`.
5. Chuyển tới `/start` (lần đầu) hoặc `/cv` (đã có CV).

**Luồng thay thế**
- 2a. Email Google đã tồn tại từ magic link → gộp vào cùng tài khoản.
- 3a. Magic link hết hạn → hiện lỗi + nút gửi lại.

**Quy tắc**
- BR-11.1 Email là định danh duy nhất (`citext`, không phân biệt hoa thường).

---

## UC-12 · Dùng thử không đăng nhập `P1`

| | |
|---|---|
| **Tác nhân** | GU |
| **Hậu điều kiện** | Profile lưu ở `localStorage`, chưa vào DB |

**Luồng chính**
1. GU vào `/start`, chọn "Dùng thử ngay".
2. Nhập tay hoặc tải CV lên → Profile lưu tại trình duyệt.
3. Được dùng: sửa CV, đổi mẫu, xem trước.
4. Khi bấm **Xuất PDF** hoặc **Đối chiếu JD** → yêu cầu đăng nhập.
5. Sau đăng nhập → Profile trong `localStorage` được nhập vào tài khoản.

**Quy tắc**
- BR-12.1 Khách không được gọi tính năng AI (bảo vệ tài nguyên LLM có hạn — TDD §14).
- BR-12.2 Dữ liệu khách hết hạn sau 7 ngày.

---

## UC-13 · Xóa tài khoản & dữ liệu `P0`

| | |
|---|---|
| **Tác nhân** | UC |
| **Hậu điều kiện** | Toàn bộ dữ liệu bị xóa, không khôi phục được |

**Luồng chính**
1. UC vào `/settings` → "Xóa tài khoản".
2. Hệ thống hiện danh sách sẽ bị xóa: Profile, CV, JD, lịch sử chat, file gốc.
3. UC gõ email của mình để xác nhận.
4. Xóa cascade DB + xóa file trên storage.
5. Hủy session, chuyển về trang chủ.

**Quy tắc**
- BR-13.1 Xóa cứng, không soft-delete (yêu cầu quyền riêng tư — TDD §15).
- BR-13.2 Bản ghi `llm_calls` giữ lại nhưng không chứa nội dung (TDD §15.2 R6).

---

# UC-2x — Tạo & sửa Profile

## UC-21 · Import CV từ PDF `P0` ⭐

| | |
|---|---|
| **Tác nhân** | UC, SYS, LLM |
| **Tiền điều kiện** | Đã đăng nhập |
| **Hậu điều kiện** | Có `jobs` bản ghi hoàn tất + Profile nháp chờ rà soát |

**Luồng chính**
1. UC vào `/import`, kéo thả file PDF (≤10MB).
2. SYS lưu file, tạo `jobs(kind=parse_cv, idempotency_key=sha256(file))`.
3. SYS gọi `pdfkit`: kiểm tra có text layer không.
4. **Có text layer và bố cục 1 cột** → trích text + tọa độ bằng `pdfplumber`.
5. **Không có text layer, hoặc 2 cột/bảng phức tạp** → render trang thành PNG 200dpi → gọi `ocr` (LightOnOCR :5012).
6. SYS gọi `redact_pii` (**bắt buộc local**) → tách PII sang bảng riêng.
7. SYS gọi `parse_cv_to_profile` → validate `ProfileSchema`.
8. SYS ghép PII trở lại, đặt toàn bộ `_meta.verified = false`.
9. SSE báo FE hoàn tất → chuyển sang **UC-22**.

**Luồng thay thế**
- 3a. File không phải PDF / hỏng → báo lỗi, gợi ý nhập tay (UC-23).
- 5a. `ocr` không khả dụng → thử `reasoner` (multimodal) làm dự phòng.
- 7a. Schema fail → thử lại tối đa 2 lần → vẫn fail → chuyển UC-23, giữ text thô để user tự copy.

**Luồng ngoại lệ**
- E1. `redact_pii` thất bại → **DỪNG toàn bộ**, không đi tiếp. Không được gửi PII thô sang bước sau.
- E2. LLM không khả dụng → job `failed`, thông báo: *"Chưa xử lý được file, bạn nhập tay giúp nhé"* + link UC-23.
- E3. File trùng (`idempotency_key` đã có) → trả kết quả cũ, không xử lý lại.

**Quy tắc**
- BR-21.1 File gốc xóa sau 48 giờ (TDD §15.2 R3).
- BR-21.2 Không lưu nội dung CV vào `llm_calls`.
- BR-21.3 Giới hạn 5 lần import/user/ngày (bảo vệ tài nguyên).

---

## UC-22 · Rà soát kết quả đọc CV `P0` ⭐ «bắt buộc»

| | |
|---|---|
| **Tác nhân** | UC |
| **Tiền điều kiện** | UC-21 hoàn tất |
| **Hậu điều kiện** | Profile được ghi vào DB với `_meta.verified` đầy đủ |

**Luồng chính**
1. Hệ thống hiện màn hình 2 cột: ảnh trang PDF gốc | các field đã đọc.
2. UC bấm vào một field → vùng tương ứng trên ảnh được tô sáng.
3. Với mỗi mục, UC chọn **"Đúng rồi"** hoặc **"Sửa lại"** (mở ô nhập).
4. Field được xác nhận → `_meta.verified[path] = true`.
5. Khi tất cả mục đã xử lý, nút "Tiếp" mở khóa.
6. UC bấm "Tiếp" → ghi Profile vào DB → chuyển tới `/builder`.

**Luồng thay thế**
- 3a. UC bấm **"Đọc sai nhiều quá, để tôi nhập tay"** → hủy Profile nháp, chuyển UC-23.
- 5a. UC rời trang giữa chừng → lưu nháp, quay lại tiếp tục được.

**Quy tắc**
- BR-22.1 **Không có nút bỏ qua.** Không thể vào `/builder` với Profile chưa rà soát.
- BR-22.2 Field mà model đánh dấu độ tin cậy thấp được đưa lên đầu, viền vàng.
- BR-22.3 PII (SĐT, email) phải hiển thị để rà soát nhưng **không** gửi model ở bước sau.

---

## UC-23 · Nhập tay Profile `P0`

**Luồng chính**
1. UC vào `/start` → "Nhập tay".
2. Điền theo từng mục: Thông tin → Học vấn → Kinh nghiệm → Dự án → Kỹ năng.
3. Mỗi mục có thể bỏ qua, bổ sung sau.
4. Ghi Profile, `_meta.source = 'manual'`, `verified = true` toàn bộ.
5. Chuyển tới `/builder`.

**Quy tắc**
- BR-23.1 Chỉ `basics.name` là bắt buộc. Mọi field khác tùy chọn.
- BR-23.2 Không yêu cầu AI để hoàn tất — hoạt động khi LLM chết.

---

## UC-24 · Sửa Profile thủ công `P0`

**Luồng chính**
1. Trong `/builder`, UC bấm vào bất kỳ dòng nào trên bản xem trước.
2. Dòng biến thành ô nhập tại chỗ.
3. UC sửa, bấm ra ngoài hoặc `Ctrl+Enter` để lưu, `Escape` để hủy.
4. FE phát `PatchOp`, cập nhật optimistic, đồng bộ server ngầm.
5. Ghi `profile_revisions(author='user')`.
6. Bản xem trước render lại.

**Luồng thay thế**
- 4a. Đồng bộ server lỗi → rollback UI, hiện toast "Chưa lưu được, thử lại".
- 2a. Kéo thả mục trong mục lục → phát `PatchOp` kiểu `move`.

**Quy tắc**
- BR-24.1 Sửa tay và AI sửa đi qua **cùng một đường ống patch** → một lịch sử undo duy nhất.
- BR-24.2 Sửa một field do AI sinh ra → `_meta.verified` chuyển thành `true`.

---

# UC-3x — CV & xuất file

## UC-31 · Chọn & tùy chỉnh mẫu `P0`

**Luồng chính**
1. UC mở bộ chọn mẫu trong `/builder`.
2. Xem trước 2 mẫu (Thanh lịch, Tối giản).
3. Chọn mẫu → `cv_documents.template_id` cập nhật, xem trước đổi ngay.
4. Điều chỉnh: màu nhấn, font, giãn dòng, kích thước chữ → `cv_documents.theme`.
5. Bật/tắt và sắp xếp lại mục → `cv_documents.layout`.

**Quy tắc**
- BR-31.1 Mức A: chỉ sắp xếp mục + theme token. Không đặt phần tử theo tọa độ.
- BR-31.2 Đổi mẫu **không** làm mất dữ liệu — Profile và presentation tách rời (TDD A2).

---

## UC-32 · Xuất PDF `P0` ⭐

| | |
|---|---|
| **Tác nhân** | UC, SYS |
| **Hậu điều kiện** | File PDF tải về được |

**Luồng chính**
1. UC bấm "Xuất".
2. Hệ thống hỏi: *"Bạn nộp CV bằng cách nào?"* → nộp hệ thống trực tuyến / gửi email.
3. UC chọn (có thể tick "Tải cả hai bản").
4. SYS tạo `jobs(kind=export_pdf)`, Playwright mở `/print/:cvId?variant=...`.
5. Render → PDF → lưu storage → trả link tải.

**Luồng thay thế**
- 3a. Chọn cả hai → sinh 2 file, đóng gói `.zip`.

**Quy tắc**
- BR-32.1 Bản `ats`: 1 cột, không bảng/icon/màu nền, font hệ thống, chữ nằm ngoài header/footer.
- BR-32.2 PDF phải là **text-based** (chọn được chữ), không phải ảnh.
- BR-32.3 Tiếng Việt có dấu phải hiển thị đúng — nhúng font Unicode đầy đủ.
- BR-32.4 Không cần LLM → hoạt động khi model server chết.

---

# UC-4x — Đối chiếu JD

## UC-41 · Nhập & phân tích JD `P0`

**Luồng chính**
1. UC vào `/analyze/:cvId`, dán nội dung JD (hoặc URL).
2. SYS gọi `parse_jd` → `JDRequirementsSchema`.
3. SYS suy ra `(industry, role_family, seniority)` để lọc KB.
4. Ghi `job_descriptions`, sinh embedding qua `embedder`.
5. Chuyển sang UC-42.

**Luồng thay thế**
- 1a. Dán URL → SYS tải trang, trích nội dung chính. Thất bại → yêu cầu dán text.
- 2a. Schema fail sau 2 lần thử → hiện form nhập thủ công các yêu cầu chính.

**Quy tắc**
- BR-41.1 JD > 8000 token → cắt bớt phần phúc lợi/giới thiệu công ty, giữ phần yêu cầu.
- BR-41.2 JD tiếng Anh + CV tiếng Việt là hợp lệ, không ép cùng ngôn ngữ.

---

## UC-42 · Xem báo cáo đối chiếu `P0` ⭐

| | |
|---|---|
| **Tác nhân** | UC, SYS, LLM |
| **Tiền điều kiện** | Có CV và JD đã phân tích |

**Luồng chính**
1. SYS chạy **scoring engine (thuần code)**: lớp từ khóa + lớp ngữ nghĩa + lớp rule.
2. **Trong ~2 giây**, trả điểm tổng, breakdown, danh sách matched/gaps → FE render ngay.
3. SYS gọi `gap_analysis` (LLM) để sinh lời tư vấn cho từng gap.
4. Lời tư vấn stream về qua SSE, điền dần vào từng thẻ gap (đang là skeleton).
5. Mỗi lời khuyên kèm `kbRefs` → hiển thị "📖 Theo [tên HR]".
6. UC bấm "Sửa giúp tôi" trên một gap → mở chat với ngữ cảnh nạp sẵn (UC-51).

**Luồng thay thế**
- 3a. `gap_analysis` quá tải → vào hàng đợi (UC-72). Điểm số và gap vẫn hiển thị.
- 5a. Không có KB cho ngành này → lời khuyên gắn nhãn "⚡ Gợi ý chung của AI".

**Luồng ngoại lệ**
- E1. `embedder` chết → bỏ lớp ngữ nghĩa, `degraded = true`, hiện banner giải thích.
- E2. LLM chết hoàn toàn → **vẫn hiển thị điểm và gap** (thuần code), chỉ thiếu lời tư vấn.

**Quy tắc**
- BR-42.1 Điểm số **deterministic** — chạy 3 lần trên cùng dữ liệu phải ra cùng kết quả.
- BR-42.2 Mỗi mục "đã khớp" phải có `evidence` trỏ tới vị trí cụ thể trong CV.
- BR-42.3 LLM **không được** thay đổi điểm số, chỉ diễn giải.
- BR-42.4 Cache theo `(cv_revision, jd_id)` — không phân tích lại nếu chưa đổi.

---

# UC-5x — Trợ lý AI

## UC-51 · Chat tư vấn `P0`

**Luồng chính**
1. UC mở panel chat trong `/builder` hoặc từ nút "Sửa giúp tôi".
2. UC nhập câu hỏi.
3. SYS gọi `plan_agent_step` → xác định ý định, mục CV liên quan, thông tin còn thiếu.
4. Nếu đủ thông tin → gọi `propose_patch` → chuyển UC-53.
5. Nếu thiếu thông tin → chuyển UC-52.
6. Câu trả lời stream về theo từng token.

**Luồng thay thế**
- 3a. Ngữ cảnh vượt ngân sách token → nén lịch sử chat (`compact_chat`), lưu vào `chat_sessions.compacted_summary`.
- 6a. UC đóng tab → job vẫn chạy, kết quả có khi quay lại.

**Quy tắc**
- BR-51.1 Ngân sách 12.000 token; vượt thì nén theo thứ tự TDD §6.4.
- BR-51.2 PII bị loại khỏi Profile trước khi gửi model.
- BR-51.3 Giới hạn 50 tin nhắn/user/ngày ở giai đoạn 1.

---

## UC-52 · Trả lời câu hỏi làm rõ `P0` ⭐

| | |
|---|---|
| **Tác nhân** | UC, LLM |
| **Mục đích** | Lấy fact từ người dùng thay vì để model bịa |

**Luồng chính**
1. AI phát hiện bullet thiếu số liệu / thiếu ngữ cảnh.
2. AI hiện **form 1–3 câu hỏi** (lấy từ `clarifying_questions` trong KB), mỗi câu có ô nhập.
3. UC điền và bấm "Gửi".
4. Câu trả lời lưu thành `chat_messages`, `message_id` dùng làm `grounding` cho patch.
5. AI sinh đề xuất dựa trên câu trả lời → UC-53.

**Luồng thay thế**
- 3a. UC bấm **"Không có số liệu"** → AI chuyển sang mô tả độ phức tạp/phạm vi theo guideline `g_no_metric_fallback`, **không bịa số**.
- 3b. UC bỏ qua form, gõ tự do → vẫn nhận, coi như câu trả lời chung.

**Quy tắc**
- BR-52.1 **AI không được tự sinh con số không do user cung cấp.** Đây là quy tắc cứng.
- BR-52.2 Tối đa 3 câu hỏi mỗi lượt — hỏi nhiều gây bỏ cuộc.

---

## UC-53 · Duyệt đề xuất thay đổi `P0` ⭐

| | |
|---|---|
| **Tác nhân** | UC |
| **Hậu điều kiện** | Chỉ các op được chọn mới ghi vào Profile |

**Luồng chính**
1. Hệ thống hiện modal với danh sách op, mỗi op gồm: diff trước/sau, lý do, nguồn.
2. Op có `grounding.type` ∈ {`user_message`, `existing_field`, `kb`} → **tick sẵn**.
3. Op có `grounding.type = 'inference'` → hiện cảnh báo vàng, **không tick sẵn**.
4. UC chọn/bỏ chọn từng op.
5. Bấm "Áp dụng N mục đã chọn".
6. SYS validate lại từng op (path hợp lệ, kiểu dữ liệu đúng) → apply JSON Patch.
7. Ghi `profile_revisions(author='ai', message_id=...)`, cập nhật `proposed_patches.status`.
8. Bản xem trước render lại; các field vừa đổi nhấp nháy để UC thấy.

**Luồng thay thế**
- 4a. UC bỏ chọn tất cả → nút "Áp dụng" vô hiệu.
- 5a. UC bấm "Bỏ qua tất cả" → `status = 'rejected'`, không ghi gì vào Profile.
- 6a. Một op không hợp lệ → bỏ riêng op đó, áp dụng phần còn lại, báo cho UC.

**Quy tắc**
- BR-53.1 **AI không bao giờ ghi trực tiếp vào Profile.** Mọi thay đổi qua modal này.
- BR-53.2 Op thêm fact mới mà không có `grounding` hợp lệ → bị chặn ở tầng validate, không hiển thị.
- BR-53.3 Áp dụng một phần được ghi `status = 'partial'`, lưu `applied_ops`.

---

## UC-54 · Hoàn tác / Làm lại `P0`

**Luồng chính**
1. UC bấm ↶ (hoặc `Ctrl+Z`).
2. FE lấy patch gần nhất từ `undoStack`, tính patch nghịch đảo, áp dụng.
3. Đẩy sang `redoStack`. Bản xem trước cập nhật.
4. ↷ (hoặc `Ctrl+Shift+Z`) làm ngược lại.

**Quy tắc**
- BR-54.1 Undo hoạt động **đồng nhất** cho thay đổi từ user và từ AI.
- BR-54.2 Giữ tối thiểu 50 bước trong phiên làm việc.
- BR-54.3 `profile_revisions` cho phép quay về bất kỳ mốc nào (ngoài phiên).

---

## UC-55 · Sinh giới thiệu bản thân `P1`

**Luồng chính**
1. UC bấm "Viết giúp phần giới thiệu".
2. SYS gọi `generate_summary` với Profile đã nén + JD (nếu có) + KB.
3. Sinh 2–3 phương án, stream về.
4. UC chọn một, hoặc chỉnh sửa rồi dùng.
5. Áp dụng qua đường patch (UC-53).

**Quy tắc**
- BR-55.1 Chỉ dùng thông tin đã có trong Profile, không thêm fact mới.
- BR-55.2 Nội dung sinh ra đánh dấu `_meta.verified = false` cho tới khi UC xác nhận.

---

# UC-6x — Knowledge Base

## UC-61 · Nạp nguồn tri thức `P1`

| | |
|---|---|
| **Tác nhân** | CR |

**Luồng chính**
1. CR vào `/admin/kb`, tải lên file (PDF/DOCX/MD/YAML) và điền tên tác giả, chức danh.
2. SYS trích text, chia chunk theo cấu trúc heading.
3. SYS gọi `classifier` lọc chunk rác (mục lục, header/footer).
4. SYS gọi `reasoner` sinh metadata: `industry`, `role_family`, `seniority`, `section`.
5. Chunk lưu với `status = 'pending_review'`.
6. Với file YAML đúng khung (như `kb/seed/`) → nạp thẳng vào `kb_rubrics` / `kb_exemplars`.

**Quy tắc**
- BR-61.1 Chunk mới **luôn** ở `pending_review`, không tự động `active`.
- BR-61.2 Nội dung KB được coi là **dữ liệu tham khảo, không phải chỉ thị** (chống prompt injection).

---

## UC-62 · Duyệt tri thức `P1`

**Luồng chính**
1. CR mở hàng đợi duyệt.
2. Với mỗi chunk: xem nội dung, metadata do AI gán.
3. CR sửa metadata nếu sai, chọn **Duyệt** / **Từ chối** / **Sửa nội dung**.
4. Chunk được duyệt → `status = 'active'`, mới được selector lấy dùng.

**Quy tắc**
- BR-62.1 Chỉ chunk `active` mới xuất hiện trong lời khuyên.
- BR-62.2 Nguồn có `author_name = null` không được duyệt sang `active`.

---

## UC-63 · Xem trích dẫn `P0`

**Luồng chính**
1. UC thấy lời khuyên kèm "📖 Theo [tên HR] — [chức danh]".
2. Bấm "xem trích dẫn" → mở popover hiện đoạn KB gốc + tên nguồn.

**Quy tắc**
- BR-63.1 Lời khuyên **không có** `kbRefs` phải hiển thị khác biệt rõ rệt: "⚡ Gợi ý chung của AI", nền xám, viền đứt.
- BR-63.2 Không được trộn lẫn hai loại trong cùng một khối hiển thị.

---

# UC-7x — Hệ thống

## UC-71 · Suy giảm khi AI không khả dụng `P0` ⭐

| | |
|---|---|
| **Tác nhân** | SYS |
| **Kích hoạt** | Circuit breaker mở, hoặc health check thất bại 3 lần |

**Luồng chính**
1. SYS phát hiện model server không phản hồi.
2. Breaker chuyển sang **mở**, ngừng gọi trong 60 giây.
3. FE nhận trạng thái qua `/api/health`, hiện banner.
4. Các nút cần AI chuyển `disabled` + tooltip giải thích (**không** ẩn đi).
5. Tính năng không cần AI vẫn hoạt động đầy đủ.
6. Sau 60 giây, breaker thử lại 1 lần (half-open). Thành công → đóng lại, ẩn banner.

**Bảng khả dụng**

| Tính năng | AI chết |
|---|---|
| Xem/sửa CV, đổi mẫu, sắp xếp mục | ✅ |
| Xuất PDF cả hai bản | ✅ |
| Đối chiếu JD — điểm & gap (thuần code) | ✅ |
| Đối chiếu JD — lớp ngữ nghĩa | ⚠️ tắt, báo user |
| Đối chiếu JD — lời tư vấn | ❌ |
| Import CV từ PDF | ❌ → chuyển nhập tay |
| Chat, viết lại, sinh summary | ❌ |

**Quy tắc**
- BR-71.1 **Không bao giờ hiện màn hình lỗi trắng.** Luôn còn đường thủ công.
- BR-71.2 `redact_pii` thất bại → không fallback cloud, task fail (TDD §15.2 R2).

---

## UC-72 · Hàng đợi & job nền `P0`

**Luồng chính**
1. Yêu cầu cần LLM vượt số slot khả dụng → đưa vào hàng đợi.
2. FE hiện vị trí và thời gian ước tính.
3. UC tick "Báo cho tôi khi xong" → đóng tab được.
4. Worker xử lý theo thứ tự, cập nhật `jobs.status`.
5. Xong → SSE (nếu còn mở tab) hoặc hiển thị khi UC quay lại.

**Quy tắc**
- BR-72.1 Job có `idempotency_key` — gửi lại cùng input không tạo job mới.
- BR-72.2 Job quá 5 phút → đánh dấu `failed`, báo user, cho thử lại.
- BR-72.3 Ước tính thời gian dựa trên p50 đo được, không phải số cứng.

---

## Ma trận truy vết Use Case → Yêu cầu TDD

| UC | TDD tham chiếu | Ưu tiên |
|---|---|---|
| UC-11, 12, 13 | §15 Bảo mật & PII | P0/P1/P0 |
| UC-21 | §8.1 Luồng import · §15 PII | P0 |
| UC-22 | §8.1 bước [6] · quyết định D-review | P0 |
| UC-23, 24 | §7.3 ProfileSchema · A2 | P0 |
| UC-31, 32 | §8.4 Export · D9 hai bản | P0 |
| UC-41, 42 | §8.2 Matching · D3 điểm bằng code | P0 |
| UC-51, 52, 53 | §8.3 Chat & Patch · A3 | P0 |
| UC-54 | §7.2 profile_revisions | P0 |
| UC-61, 62, 63 | §10 Knowledge Base | P1 |
| UC-71 | §5.5 Ma trận degrade | P0 |
| UC-72 | §14.3 UX do throughput thấp | P0 |
