# Kết quả đo model chat — Qwen3.5-4B, prompt_v1

**Ngày đo:** 2026-08-14 · **Model:** `local.reasoner` (Qwen3.5-4B-Q8_0, llama.cpp)
**Bộ đo:** `TestChatModelEval` trong `backend/internal/api/chat_eval_test.go`
**Cỡ mẫu:** 18 lượt (6 kịch bản × 3 lần lặp), chạy hai vòng cho kết quả tương đương.

Lệnh tái lập:

```
CHAT_EVAL=1 CHAT_EVAL_REPS=3 \
  HR_CONFIG_PATH=/đường/dẫn/config.yml MODEL_HOST=http://... \
  CHAT_EVAL_DUMP=/thư/mục/dump \
  go test ./internal/api/ -run TestChatModelEval -v -timeout 30m
```

## Câu hỏi cần trả lời

Output hỏng vì **bị cắt ngắn** hay vì **model không theo luật**? Hai nguyên nhân đòi hai
cách chữa trái ngược — nâng trần token, hay tách prompt thành hai lượt — nên đoán sai là
làm sai kiến trúc.

## Kết quả

| Chỉ số | Kết quả |
|---|---|
| JSON hỏng / cắt ngắn | **0/18** |
| Bị `validateChatProposalDocuments` từ chối | **1/18** |
| Vượt trần 20 ops | 0/18 |
| Độ trễ trung bình | **5,8 giây** |
| Output dài nhất | 3398 byte |

**Format không phải vấn đề.** Không một lượt nào hỏng JSON. Điều này khớp với việc
`postLocalChat` gửi `response_format: json_schema`, tức grammar ràng buộc bộ giải mã —
model *không thể* sinh token phá hình JSON. Mọi lo lắng về "prompt dài làm loãng format"
đều không có cơ sở trên đường local.

## Bốn lỗi thật, tất cả đều thuộc tầng ngữ nghĩa

### 1. Model nói dối là đã cập nhật hồ sơ — 12/18

Prompt viết rõ: *"do NOT say you have updated it. Return a proposal for the user to review."*
Model vẫn trả `summary` mở đầu bằng "Đã cập nhật…", "Đã viết lại…" ở 12/18 lượt.

Đây **không** phải lỗi vô hại: khi `kind == "patch"`, `server.go` gán
`assistantContent = modelOutput.Summary` rồi lưu vào `chat_messages` và bắn ra giao diện.
Nghĩa là người dùng đang được thông báo hồ sơ đã thay đổi trong khi nó mới chỉ là đề xuất
chờ duyệt. Lỗi này đang chạy trên production.

### 2. `grounding` là trường chết — 29/29 op đều khai `user_message`

Không một op nào khai `existing_field` (kể cả khi viết lại chính câu đang có) hay
`inference` (kể cả khi bịa hẳn nội dung mới). Trường này hiện không mang thông tin gì,
nhưng nó vẫn nằm trong `chatResponseSchema` và vẫn tốn token ở mọi op.

### 3. Model bịa dữ kiện và tự khai nguồn là lời người dùng

Kịch bản `thieu-du-lieu` — người dùng nói *"Làm phần giới thiệu của tôi nổi bật hơn hẳn
các ứng viên khác"* mà không cung cấp thêm dữ liệu. Cả 3/3 lần model **không hỏi**, mà
viết thẳng:

> "Kỹ sư Backend chuyên sâu với kinh nghiệm xây dựng và tối ưu hóa các hệ thống API hiệu
> suất cao, giúp giảm chi phí vận hành… khả năng kết hợp kiến trúc Go với cơ sở dữ liệu
> NoSQL để giải quyết các bài toán phức tạp về xử lý dữ liệu thời gian thực…"

Hồ sơ gốc không có một chữ nào về hiệu suất cao, chi phí vận hành, hay dữ liệu thời gian
thực. Op đó khai `grounding.type: "user_message"` — trong khi tin nhắn người dùng cũng
không chứa gì trong đó.

### 4. Nhánh `clarify` không bao giờ chạy — 0/18

Kể cả ở kịch bản dựng riêng cho nó. Năm trục hỏi (Strengths, Working style, Career
direction, Candidate branding, Evidence) vừa thêm vào prompt hiện **chưa từng được dùng
một lần nào** — chúng đang là token chết, và tệ hơn, mục 3 cho thấy model chọn bịa thay
vì hỏi.

### 5. Luật ngôn ngữ thua ngữ cảnh — 3/3

Kịch bản `nguoi-dung-go-tieng-anh`: người dùng gõ *"Rewrite my project bullets so they
show impact."* Cả 3/3 lần `summary` trả về tiếng Việt. Luật *"reply in the same language
as the user's latest message"* thua trước một hồ sơ đầy tiếng Việt trong ngữ cảnh.

### 6. Chỉ số ngoài lề: 1/18 trỏ sai chỉ số mảng

`replace /sections/projects/0/highlights/2` trong khi dự án chỉ có 2 gạch đầu dòng
(chỉ số 0 và 1). Validator chặn đúng. Tần suất thấp, chưa đáng xử lý riêng.

## Kết luận cho câu hỏi tách prompt hai lượt

**Tách một lượt riêng để "đảm bảo đúng format" không giải quyết gì** — format đã đạt
18/18 nhờ grammar, không nhờ prompt.

Nhưng dữ liệu lại ủng hộ việc tách vì một lý do khác: **mọi lỗi đều là luật ngữ nghĩa bị
bỏ qua**, và bốn trong số đó (nói dối đã cập nhật, bịa dữ kiện, không hỏi lại, sai ngôn
ngữ) là những luật nằm chung một prompt với nhau. Đó đúng là hình dạng của quá tải mệnh
lệnh trên model 4B.

**Đính chính một ước lượng cũ:** tôi từng ước lượng một lượt mất 11-23 giây nên tách hai
lượt sẽ tốn 20-45 giây. Đo thật cho **5,8 giây trung bình**, tức hai lượt vào khoảng 12
giây. Cái giá độ trễ nhỏ hơn tôi nói nhiều, nên nó không còn là lý do để bác phương án
tách.

**Nhưng có một cách chữa rẻ hơn nhiều cần thử trước.** Ba trong bốn lỗi nặng nhất có thể
chặn ở phía máy chủ, nơi kết quả là tất định thay vì phụ thuộc vào việc model có nghe lời
hay không:

- Lỗi 1 — không dùng `summary` của model làm câu thông báo, hoặc chặn tiền tố "Đã …".
- Lỗi 2 — bỏ `grounding` khỏi schema, hoặc bắt buộc `existing_field` khi path đã tồn tại.
- Lỗi 3 — đối chiếu nội dung đề xuất với hồ sơ và tin nhắn trước khi cho qua.

Chỉ nên tách prompt hai lượt sau khi đã thử những cái đó, vì tách lượt là đổi kiến trúc
để mong model nghe lời hơn, còn kiểm phía máy chủ thì không cần model hợp tác.

---

# Vòng 2 — sau khi thêm hai chốt phía máy chủ

Cùng bộ đo, cùng cỡ mẫu 18 lượt, chạy lại sau khi thêm `chat_proposal_guard.go`.

| Chỉ số | Vòng 1 | Vòng 2 |
|---|---|---|
| Model tự nhận "Đã cập nhật…" | 12/18 | 10/18 |
| **Lọt tới người dùng** | **12/18** | **0/18** |
| Op bị xếp `inference` | 0/29 | **21/27** |
| JSON hỏng | 0/18 | 0/18 |
| Bị validator từ chối | 1/18 | 0/18 |
| Độ trễ trung bình | 5,8s | 5,8s |

## Lỗi 1 đã chặn hết

`neutralizeProposalSummary` đổi tiền tố khẳng định thành dạng đề xuất trước khi câu đó
được lưu vào `chat_messages`. Model vẫn tự nhận đã xong ở 10/18 lượt, nhưng **không lượt
nào lọt tới người dùng**. Bảng tiền tố lấy từ output thật, không phải nghĩ ra, và bộ đo
dùng chung bảng đó nên nó không thể "đạt" bằng cách hiểu lỏng hơn phần đang chạy.

## Lỗi 2 và 3: 78% op là bịa, không phải chốt quá tay

Nghi ngờ đầu tiên khi thấy 21/27 là ngưỡng đặt quá nghiêm. Soi từng op thì ngược lại —
model bịa **số liệu cứng** ở gần như mọi lần viết lại:

| Model đề xuất | Hồ sơ gốc |
|---|---|
| "giảm 30% số cuộc gọi hỗ trợ" | "Xây dựng chức năng đặt lịch và nhắc lịch." |
| "onboarding giảm 50%" | "Viết tài liệu API cho nhóm." |
| "giảm thời gian xử lý từ 5s xuống 1.5s" | "Phát triển API cho hệ thống quản lý đơn hàng." |
| "giúp nhóm frontend nhanh hơn 2 tuần" | — không có gì tương ứng |

Đây là kiểu bịa nguy hiểm nhất trong CV: nó đọc như thành tích kiểm chứng được, và người
dùng mang nó đi phỏng vấn. Trước bản vá, **mọi op như vậy đều tới tay người dùng ở trạng
thái đã tick sẵn**, chỉ cách một cú bấm là vào hồ sơ.

Chốt phân loại đúng cả chiều ngược lại: thêm "Docker" theo yêu cầu người dùng ra
`user_message`, và câu viết lại trung thành *"Viết tài liệu API chi tiết và chuẩn hóa, hỗ
trợ việc phát triển và bảo trì bởi các thành viên trong nhóm"* ra `existing_field`.

## Còn lại

- **Nhánh `clarify` vẫn 0/18.** Năm trục hỏi vẫn chưa chạy lần nào. Model chọn bịa thay vì
  hỏi, và giờ ta biết chính xác nó bịa cái gì.
- **Ngôn ngữ vẫn thua ngữ cảnh** — 2/3 lượt trả lời tiếng Việt cho tin nhắn tiếng Anh.
- **Giao diện chưa nói cho người dùng biết vì sao op bị bỏ tick.** `ChatPanel.tsx` bỏ tick
  op `inference` nhưng không hiện lý do; giờ nhãn đó đã đáng tin thì nó nên hiện thành một
  cảnh báo đọc được.
