# Spec: Multi-model chat providers

## Mục tiêu

Cho phép người dùng chọn model ngay trong thanh tin nhắn của trợ lý CV, với
`Neura flash` giữ nguyên local model hiện tại, `Neura Pro` dùng OpenAI GPT-5.6
Luna và `Neura Plus` dùng DeepSeek V4 Flash.

## Mapping

| Tên trong UI | Model ref | Provider/API model | Mặc định |
|---|---|---|---|
| Neura flash | `local.reasoner` | llama.cpp / Qwen local | Có |
| Neura Pro | `openai.luna` | OpenAI `gpt-5.6-luna` | Không |
| Neura Plus | `deepseek.v4` | DeepSeek `deepseek-v4-flash` | Không |

OpenAI và DeepSeek đều được gọi qua adapter OpenAI-compatible ở
`packages/ai/src/providers/openai-compatible.ts`. Không đưa SDK hoặc API key vào
frontend; lựa chọn chỉ đi qua API route và server validate bằng allow-list.

## Luồng

1. UI chọn `modelRef` và gửi cùng request `POST /api/chat`.
2. API chỉ chấp nhận `local.reasoner`, `openai.luna`, `deepseek.v4`.
3. `runChatTurn` truyền model đã chọn vào Gateway bằng `forceModel`.
4. Gateway vẫn áp dụng redaction PII, retry, circuit breaker và schema validation.

Nếu key cloud thiếu hoặc provider lỗi, lượt chat trả lỗi theo cơ chế hiện tại;
không tự động gửi dữ liệu sang provider khác ngoài model người dùng đã chọn.

## Cấu hình và secret

`config.yml` là nguồn sự thật cho endpoint/model. Secret nằm trong `.env`:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY` (tên chuẩn)
- `DEEPSEAK_API_KEY` vẫn được hỗ trợ tương thích với `.env` hiện tại

Không commit `.env`. Nên đổi/thu hồi key nếu key đã từng bị ghi vào log, issue
hoặc chia sẻ ngoài môi trường triển khai.

DeepSeek V4 dùng `response_format: { type: "json_object" }`; OpenAI dùng JSON
Schema mode. Cloud token budget hiện dùng ước lượng bảo thủ vì API không có
endpoint tokenizer local; usage từ response vẫn được ghi nhận khi provider trả
về.

DeepSeek V4 Flash được cấu hình `thinking: disabled` cho chat tương tác để ưu
tiên tốc độ; có thể bật lại trong `config.yml` nếu cần suy luận sâu.

## Tiêu chí nghiệm thu

- Chọn từng model trong selector không reload trang.
- Request chat gửi đúng model ref; local là giá trị mặc định.
- API từ chối model ref không nằm trong allow-list.
- Key không xuất hiện trong bundle client hoặc payload gửi từ client.
- `npm run typecheck:core` và `npm run typecheck:web` pass.

## Huỷ lượt đang sinh

Khi đang chờ model, nút `Gửi` đổi thành `Dừng`. Bấm `Dừng` sẽ huỷ
`AbortController` của request SSE; signal được truyền tới API, Gateway và
provider. Lượt huỷ không retry, không fallback sang model khác, không làm mở
circuit breaker và không ghi một tin nhắn lỗi giả vào lịch sử. Sau khi huỷ,
người dùng có thể sửa câu hỏi hoặc chọn model khác rồi gửi lại.

## Hint từ gợi ý trong chat

Các gợi ý UI gửi thêm hint có cấu trúc, không chỉ gửi câu chữ hiển thị:
`enrich_content`, `tighten_bullets`, `strong_verbs`, `rewrite_summary`. Hint được
đưa vào cả bước planning và propose patch. Với `enrich_content`, model được
khuyến khích bổ sung bối cảnh, mục tiêu, cách tiếp cận và giá trị dựa trên fact
đã có; không được tự tạo số liệu hoặc công nghệ. Patch gần như sao chép nội dung
cũ sẽ bị guard loại và yêu cầu model sinh lại.
