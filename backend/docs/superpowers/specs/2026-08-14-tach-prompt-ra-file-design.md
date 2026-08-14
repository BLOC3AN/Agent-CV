# Tách prompt ra file — Design

## Summary

Đưa toàn bộ văn bản prompt ra khỏi mã Go, vào `backend/prompts/prompt_v1/*.md`, nhúng vào binary bằng `go:embed`. Mã Go chỉ còn giữ cơ chế nạp và thay biến. Đồng thời chuẩn hoá mọi prompt sang tiếng Anh và đổi luật ngôn ngữ trả lời: model bám theo ngôn ngữ người dùng gõ, không xác định được thì rơi về ngôn ngữ hệ thống do client gửi lên.

Hôm nay prompt nằm rải ở ba chỗ dưới dạng string literal — `chatSystemPrompt`/`chatUserPrompt` trong `internal/api/server.go`, `parseJDRequirements` trong `cmd/worker/matching.go`, `runGapAdvice` trong `cmd/worker/main.go`. Không ai sửa được prompt mà không mở mã nguồn, và một thay đổi câu chữ trông giống hệt một thay đổi logic trong diff.

## Vì sao Markdown, không phải YAML

KB (`backend/kb/*.yaml`) là **bản ghi có schema** — field, mảng, id, taxonomy — nên YAML đúng cho nó. Prompt là **văn xuôi gửi thẳng cho model**, không có cấu trúc nào để mô hình hoá ngoài vài dòng metadata. Ép prompt vào YAML mua ba nhược điểm mà không đổi lại được gì:

- Prompt phải sống trong block scalar `|`, tức phụ thuộc thụt lề. System prompt chat chứa dòng trống, `{`, `"`, `:` trong các ví dụ JSON — thừa một space là đổi nội dung mà không ai thấy.
- Gộp nhiều prompt vào một file làm diff lẫn lộn. Prompt là thứ sẽ sửa đi sửa lại và cần soi kỹ từng dòng.
- YAML không cho thêm khả năng nào cho loại nội dung này.

Markdown + YAML frontmatter lấy được cả hai: metadata máy đọc (`name`, `version`, `variables`) parse bằng đúng `go.yaml.in/yaml/v3` mà `config.yml` đang dùng, còn thân file là văn xuôi thuần.

**KB giữ YAML, prompt dùng MD.** Khác nhau vì bản chất khác nhau.

## Vì sao `go:embed`

Prompt là hợp đồng với `chatResponseSchema()`, `parseChatModelOutput` và `validateChatProposalDocuments` — ba thứ nằm trong binary. Để prompt trôi nổi ngoài binary (bind-mount như `config.yml`) là tạo ra khả năng prompt lệch pha với validator mà không cơ chế nào phát hiện.

`go:embed` không đi ra ngoài thư mục package (không có `..`, không theo symlink), và module Go bắt đầu ở `backend/`. Vì vậy thư mục là `backend/prompts/prompt_v1/`, không phải `prompts/` ở gốc repo.

## Bố cục

```
backend/prompts/
  prompts.go                    ← loader; không một chữ prompt nào ở đây
  prompt_v1/
    chat.system.md
    chat.user.md
    chat.user_hint.md
    jd_requirements.system.md
    jd_requirements.user.md
    gap_advice.system.md
    gap_advice.user.md
```

Mỗi file:

```markdown
---
name: chat.system
version: prompt_v1
variables: [reply_in]
---
You are a CV editing assistant...
```

`variables` là danh sách bắt buộc và là chốt an toàn — xem phần Test.

`chat.user_hint.md` là một fragment hai dòng, tách riêng vì phần gợi ý từ giao diện chỉ xuất hiện khi `hint != ""`. Tách file giữ được nguyên tắc "không chữ prompt nào trong code" mà không phải đưa cú pháp điều kiện vào loader.

### Version là hằng số, không phải cấu hình

`prompt_v1` là hằng số trong `prompts.go`, không phải tuỳ chọn trong `config.yml`. Đã chọn `go:embed` thì đổi prompt vốn đã phải build lại; thêm công tắc runtime chọn version chỉ tạo tổ hợp trạng thái không ai kiểm được. Khi thật sự có `prompt_v2` cần chạy song song để so sánh thì thêm công tắc — lúc đó nó mới có việc để làm.

## Loader

```go
package prompts

//go:embed prompt_v1/*.md
var files embed.FS

func Render(name string, vars map[string]string) (string, error)
func MustRender(name string, vars map[string]string) string
```

- **Nạp lúc `init()`**: parse cả 7 file, tách frontmatter, kiểm tra `variables` khớp với `{{...}}` trong thân. Sai bất kỳ điều gì thì panic ngay lúc khởi động. Với tài sản đã nhúng trong binary, đây là điều kiện bất biến kiểm được từ lúc `go test`, không phải lỗi runtime người dùng gặp phải.
- **Thân file bị `TrimSpace` ở đuôi** để dấu xuống dòng cuối file không lọt vào prompt.
- **`Render` trả `error`** khi thiếu biến hoặc truyền biến không khai báo — bắt được lỗi "đổi tên placeholder trong file mà quên sửa call site".
- **`MustRender`** panic trên cùng điều kiện đó, dùng ở call site nơi tập biến là hằng. Cùng khuôn với `regexp.MustCompile`; điều kiện panic được test khoá lại nên không đến được production.
- **Không dùng `text/template`.** Prompt chat đầy `{` và `"` từ các ví dụ JSON. `strings.NewReplacer` trên đúng các key đã khai báo thì không có gì để hiểu nhầm, và người sửa prompt không phải học cú pháp template.

## Call site

Bốn hàm dựng prompt đổi ruột, **giữ nguyên chữ ký**:

| Hàm | File prompt |
|---|---|
| `chatSystemPrompt(language)` | `chat.system.md` |
| `chatUserPrompt(...)` | `chat.user.md` + `chat.user_hint.md` |
| `parseJDRequirements(...)` | `jd_requirements.{system,user}.md` |
| `runGapAdvice(...)` | `gap_advice.{system,user}.md` |

Mọi thứ phía sau — `chatResponseSchema`, `parseChatModelOutput`, `validateChatProposalDocuments`, `callReasonerJSON` — không đổi. Thiết kế này dời chỗ chứa văn bản, không đụng hợp đồng.

**Không đổi:** `redactProfileForModel` vẫn được gọi bên trong `chatUserPrompt`. Comment tại chỗ ghi rõ nó nằm đó để làm chốt chặn PII duy nhất; việc tách prompt không được làm suy yếu chốt đó. `chat.user.md` chỉ chứa `{{profile}}`, còn giá trị truyền vào luôn là bản đã che.

## Ngôn ngữ

Toàn bộ 7 file viết bằng tiếng Anh. Luật trong `chat.system.md`:

```
Reply in the same language as the user's latest message.
If that is unclear, reply in {{reply_in}}.
```

`reply_in` render từ `body.Language`: `"en"` → `English`, còn lại → `Vietnamese`. Giữ fallback tiếng Việt cho client cũ không gửi trường này.

**Đây là đổi hành vi, không chỉ đổi chỗ chứa.** Hôm nay client quyết ngôn ngữ tuyệt đối; sau thay đổi, người dùng gõ tiếng Anh trong giao diện tiếng Việt sẽ nhận trả lời tiếng Anh.

**Rủi ro cần đo:** `config.yml` ghi `vi_generation_quality: good` cho Qwen3.5-4B, nhưng con số đó đo với prompt tiếng Việt. Chỉ thị tiếng Anh mà bắt sinh nội dung CV tiếng Việt là cấu hình chưa từng đo trên model này. Phải chạy thử vài lượt chat thật sau Bước 2. Phương án lùi: ra lệnh cứng theo `reply_in` thay vì để model tự nhận diện ngôn ngữ — chỉ sửa vài dòng trong `chat.system.md`, không đụng code.

## Một lỗi phát hiện khi đọc

`runGapAdvice` hôm nay dựng system prompt bằng `"...JSON only: {\\\"advices\\\":..."`. Trong Go, `\\` cho ra một dấu `\` và `\"` cho ra `"`, nên chuỗi thật gửi tới model chứa `{\"advices\":[{\"gapId\"...` — dấu backslash thừa nằm giữa ví dụ JSON.

Bước 1 chép nguyên văn, kể cả backslash thừa, để giữ tính chất refactor thuần. Bước 2 bỏ backslash như một thay đổi nội dung có chủ ý và ghi rõ trong commit.

## Test

**Loader:**

1. `init()` parse đủ 7 file, frontmatter hợp lệ — chạy như một test riêng, không chỉ dựa vào việc binary khởi động được.
2. Tập `{{...}}` trong thân khớp đúng `variables` khai báo, cho từng file. Đây là test bắt được lỗi phổ biến nhất.
3. `Render` thiếu biến trả `error`, không trả prompt còn nguyên `{{profile}}`.
4. `Render` với biến không khai báo trả `error`.

**Giữ nguyên, không sửa:** `TestChatPromptNeverCarriesPIIToModelForV2` — chốt chặn PII không được yếu đi vì một cuộc refactor.

**Viết lại đúng một test:** `TestChatSystemPromptFollowsRequestedLanguage` đang khoá luật "client quyết tuyệt đối", tức khoá đúng cái Bước 2 thay đổi. Nó phải được thay bằng test khẳng định luật mới, không phải bị xoá.

**Năm test còn lại** (`TestChatPromptUsesIntroduceForCVField`, `TestChatSystemPromptUsesSectionPointers`, `TestChatSystemPromptV2SupportsClarifyWithoutInventingFacts`, `TestChatUserPromptIncludesAnswers`, `TestChatSystemPromptStatesAppendTokenRequiresAdd`) assert ký hiệu kỹ thuật — `/sections/intro/summary`, `"kind":"clarify"`, token `"-"` — độc lập với ngôn ngữ. Chúng phải xanh qua cả hai bước mà không sửa một dòng nào.

## Thứ tự triển khai

Hai bước rời nhau. Đây là điểm quan trọng nhất của kế hoạch.

**Bước 1 — dời chỗ, không đổi một chữ.** Chép nguyên văn tiếng Việt (và tiếng Anh của worker) vào 7 file, viết loader, đổi ruột bốn hàm dựng prompt. Nghiệm thu: **toàn bộ test hiện có xanh mà không sửa một dòng test nào.** Nếu không luật nào rơi rụng thì các assertion cũ không có lý do gì đỏ.

**Bước 2 — dịch sang tiếng Anh, đổi luật ngôn ngữ, bỏ backslash thừa.** Diff chỉ nằm trong file `.md`, chỗ tính `reply_in`, và một test viết lại.

Gộp hai bước thì khi test đỏ không biết do dời sai chỗ hay do dịch sai ý. Tách ra thì mỗi lần đỏ chỉ có một nghi phạm.

## Ngoài phạm vi

- **KB vào prompt chat.** `chatResponseSchema` đã có `kbRefs` và `grounding.type: "kb"`, nhưng `chatUserPrompt` chưa bao giờ gửi KB cho model. Nối tầng retrieval (bge-m3 + reranker đã có trong `config.yml`, chưa nối) là spec riêng.
- **Ingest tài liệu CVPro Mastery** (`var/storage/prompt_evaluate_CV/`). Đó là KB source, không phải prompt — spec riêng, và vướng chốt quyền sử dụng tài liệu bên thứ ba.
- **Đường `hint` từ SPA.** API và prompt đều đã có chỗ cho nó, nhưng `ChatPanel.tsx` đang truyền `undefined`. Spec này giữ nguyên đường đi, không kích hoạt.
- **`prompt_caching`** khai `true` cho Anthropic trong `config.yml` nhưng chưa có breakpoint nào trong code. Không đụng tới.
