# HR-Agent — Technical Design Document

| | |
|---|---|
| **Phiên bản** | 1.0 |
| **Ngày** | 2026-08-06 |
| **Trạng thái** | Draft — chờ review |
| **Phạm vi** | Giai đoạn 1 (MVP, chi phí LLM = $0) |
| **Nguồn số liệu** | Đo trực tiếp trên `100.68.50.41` và máy dev, 2026-08-06 |

---

## Mục lục

1. [Bối cảnh & mục tiêu](#1-bối-cảnh--mục-tiêu)
2. [Ràng buộc cứng](#2-ràng-buộc-cứng)
3. [Kiến trúc tổng thể](#3-kiến-trúc-tổng-thể)
4. [Cấu trúc repository](#4-cấu-trúc-repository)
5. [Model Gateway](#5-model-gateway)
6. [Quản lý ngân sách context](#6-quản-lý-ngân-sách-context)
7. [Mô hình dữ liệu](#7-mô-hình-dữ-liệu)
8. [Luồng nghiệp vụ](#8-luồng-nghiệp-vụ)
9. [Thiết kế song ngữ](#9-thiết-kế-song-ngữ)
10. [Knowledge Base](#10-knowledge-base)
11. [API surface](#11-api-surface)
12. [Triển khai](#12-triển-khai)
13. [Quan sát & đánh giá](#13-quan-sát--đánh-giá)
14. [Năng lực hệ thống](#14-năng-lực-hệ-thống)
15. [Bảo mật & PII](#15-bảo-mật--pii)
16. [Rủi ro](#16-rủi-ro)
17. [Milestone & tiêu chí nghiệm thu](#17-milestone--tiêu-chí-nghiệm-thu)

---

## 1. Bối cảnh & mục tiêu

### 1.1 Sản phẩm

Webapp hỗ trợ sinh viên / người mới tốt nghiệp xây dựng CV, đối chiếu với JD cụ thể, và nhận tư vấn dựa trên **kinh nghiệm HR thật** (Knowledge Base) thay vì phán đoán tự do của model.

### 1.2 Giá trị lõi

Không phải "CV builder" — thị trường đã bão hòa. Giá trị nằm ở:

> **Khai thác insight từ trải nghiệm mỏng của sinh viên và biến nó thành bằng chứng khớp với JD, dựa trên tri thức HR có trích dẫn.**

### 1.3 Mục tiêu giai đoạn 1

| Mục tiêu | Chỉ số |
|---|---|
| Chi phí LLM | **$0** (100% local) |
| Chất lượng parse CV | ≥ 90% field đúng sau màn hình review |
| Thời gian phản hồi gap analysis | p95 < 90 giây (có streaming) |
| Song ngữ | Việt + Anh, chọn thủ công + tự nhận diện |
| Cloud-ready | Bật cloud = đổi config, **không sửa code nghiệp vụ** |

### 1.4 Ngoài phạm vi giai đoạn 1

Recruiter portal · Mentor review · Thanh toán · Free canvas editor · Mobile app · RAG đầy đủ trên KB · Đa người dùng đồng thời quy mô lớn

---

## 2. Ràng buộc cứng

> Đây là phần quan trọng nhất của tài liệu. Mọi thiết kế phía dưới đều bắt nguồn từ đây.

### 2.1 Model server — CHỈ ĐỌC, gọi qua API

Server `100.68.50.41` đang chạy 109 container hệ MES/WMS. **Không can thiệp, không restart, không đổi cấu hình.** Ta coi nó là **dependency ngoài không kiểm soát được**.

Hệ quả thiết kế:
- Mọi tham số `ctx-size`, `n-gpu-layers`, số slot đều **cố định**, không thương lượng được.
- Server có thể bị người khác restart bất cứ lúc nào. Do driver NVIDIA đang mismatch, **nếu restart thì cụm LLM nhiều khả năng không lên lại được**. → Ứng dụng phải **degrade gracefully**, không được sập.
- Không có SLA. Circuit breaker + health check là bắt buộc, không phải tùy chọn.

### 2.2 Model đang có (đo 2026-08-06)

| Alias | Port | Model | ctx | Ghi chú đo được |
|---|---|---|---|---|
| `reasoner` | 5011 | Qwen3.5-4B-Q8_0 | **16384** | 4 slot · multimodal (mmproj) · ~35 tok/s |
| `generalist` | 5010 | Bonsai-8B-Q1_0 | **4096** | context ngắn — chỉ task độc lập |
| `ocr` | 5012 | LightOnOCR-2-1B | 8192 | **bắt buộc input ảnh** |
| `classifier` | 5013 | qwen2.5-0.5b | **2048** | chất lượng sinh ngữ yếu |
| `reranker` | 5014 | bge-reranker-v2-m3 | 8192 | `POST /v1/rerank` |
| `embedder` | 8003 | bge-m3-onnx-int8 | — | **API riêng**, `POST /embed` body `{"text": "..."}` |

**Đã kiểm chứng:** đẩy prompt 15,620 token vào `reasoner` → thành công. Vậy 16384 là ngân sách thật cho **một** request.

⚠️ 4 slot dùng chung KV cache. Bốn request đồng thời cùng đòi 15K context sẽ tranh chấp. Thiết kế theo ngân sách **12,000 token/request**, chừa 4,384 làm đệm.

### 2.3 Tokenization tiếng Việt (đo thực tế)

Cùng một nội dung, `reasoner` tokenize:

```
Tiếng Việt : 58 token
Tiếng Anh  : 45 token
Tỷ lệ      : 1.29×
```

(`generalist` và `classifier` cho tỷ lệ 1.38× — vocab nhỏ hơn.)

**Hệ quả:** mọi ngân sách token phải nhân 1.3 khi nội dung là tiếng Việt. Một CV tiếng Việt tốn ~30% context nhiều hơn cùng CV tiếng Anh.

### 2.4 Máy triển khai (máy dev hiện tại)

```
Ubuntu 24.04.4 · 16 core · 30GB RAM (25GB khả dụng) · 353GB trống
Node v20.20.2 · npm 10.8.2 · Python 3.10.20 · Docker 29.6.2 · Compose v5.3.1
psql 16.14 (client) · KHÔNG có GPU
Kết nối tới model server qua Tailscale: 5011/8003/5014 đều 200 OK
```

Không có GPU cục bộ → **mọi inference đều qua Tailscale**. Độ trễ mạng cộng vào mọi lời gọi. Không chạy được model dự phòng tại chỗ.

### 2.5 Bảng ràng buộc tóm tắt

| # | Ràng buộc | Ảnh hưởng thiết kế |
|---|---|---|
| C1 | Context 16384, ngân sách an toàn 12000 | §6 — nén, cắt, ưu tiên |
| C2 | Tiếng Việt tốn 1.29× token | §6, §9 |
| C3 | ~35 tok/s, 4 slot | §14 — streaming bắt buộc, hàng đợi |
| C4 | Server có thể chết vĩnh viễn | §5 — circuit breaker, degrade |
| C5 | Không GPU cục bộ | Không có fallback tại chỗ |
| C6 | `generalist` ctx chỉ 4096 | Không dùng làm fallback cho task context dài |
| C7 | `embedder` API không chuẩn OpenAI | Adapter riêng |
| C8 | **Payload lớn có thể GIẾT tiến trình model, không chỉ lỗi** | §2.6 — trần kích thước bắt buộc |

### 2.6 Trần kích thước payload — ràng buộc học được từ sự cố

> Ghi ngày 2026-08-07, sau khi làm sập `local.ocr`.

GPU RTX 3060 12GB đang gánh 4 model với `--n-gpu-layers 99`. VRAM gần đầy
thường trực. Một request ảnh 417KB (trang A4 ở 150dpi) gửi cho LightOnOCR gây:

```
cudaMalloc failed: out of memory  (xin 522 MiB)
GGML_ASSERT(...) failed → SIGSEGV → container Exited (139)
```

**Không phải lỗi trả về — mà là tiến trình chết.** Và vì driver NVIDIA đang
mismatch (kernel `580.159.03` vs userspace `580.173.02`), container **không
khởi động lại được**:

```
nvidia-container-cli: initialization error: nvml error: driver/library version mismatch
```

Đây chính là rủi ro **R1 (§16)** hiện thực hoá. Khôi phục cần gỡ
`nvidia-driver-550` + reboot — mà máy chạy 109 container khác.

**Quy tắc bắt buộc từ nay:**

| # | Quy tắc |
|---|---|
| P1 | Mọi payload ảnh phải có **trần byte** khai báo trước khi gửi |
| P2 | Dò khả năng của model phải **tăng dần từ nhỏ**, không thử cỡ lớn trước |
| P3 | Model đa phương thức mặc định coi là **mong manh** — retry một lần rồi bỏ, không dồn |
| P4 | Trên GPU dùng chung, **không chạy song song** hai request ảnh |

Trần đề xuất cho đường ảnh khi `local.ocr` hoạt động trở lại: **≤120KB PNG mỗi
trang** (tương đương ~72dpi cho A4), tăng dần và đo lại nếu cần nét hơn.

---

## 3. Kiến trúc tổng thể

### 3.1 Sơ đồ

```
┌──────────────────────── MÁY DEV/DEPLOY (Ubuntu 24.04) ────────────────────────┐
│                                                                               │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────┐   ┌────────────────────┐  │
│  │  Next.js    │   │  Worker      │   │ Postgres  │   │ Redis              │  │
│  │  web + BFF  │◄─►│  BullMQ      │◄─►│ 16        │   │ (queue + cache)    │  │
│  │  :3000      │   │  parse/export│   │ +pgvector │   │ :6379              │  │
│  └──────┬──────┘   └──────┬───────┘   └───────────┘   └────────────────────┘  │
│         │                 │                                                   │
│         └────────┬────────┘                                                   │
│                  ▼                                                            │
│         ┌──────────────────┐        ┌──────────────────┐                      │
│         │ packages/ai      │        │ packages/pdf     │                      │
│         │ Model Gateway    │        │ pdfplumber(py)   │                      │
│         │ routing·budget   │        │ + Playwright     │                      │
│         │ ·breaker·schema  │        │ (render/export)  │                      │
│         └────────┬─────────┘        └──────────────────┘                      │
└──────────────────┼────────────────────────────────────────────────────────────┘
                   │ Tailscale (100.x)
                   ▼
┌──────────────── MODEL SERVER 100.68.50.41 (CHỈ ĐỌC) ──────────────────────────┐
│  :5011 reasoner  :5010 generalist  :5012 ocr  :5013 classifier                │
│  :5014 reranker  :8003 embedder                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                   ┆ (disabled — bật sau gọi vốn)
                   ┄► Anthropic API
```

### 3.2 Nguyên tắc kiến trúc

| # | Nguyên tắc | Lý do |
|---|---|---|
| A1 | **Modular monolith**, không microservices | Team nhỏ, domain chưa ổn định |
| A2 | **Profile (data) tách khỏi CVDocument (presentation)** | AI thao tác trên data, không trên layout |
| A3 | **AI đề xuất patch, user duyệt** — không ghi thẳng | Kiểm soát + audit trail + chống hallucination |
| A4 | **Điểm số tính bằng code**, LLM chỉ diễn giải | Deterministic, test được, giải thích được |
| A5 | **Mọi output LLM đi qua schema validation** | Model 4B sẽ trả JSON sai — đó là bình thường |
| A6 | **Không import SDK model trong code nghiệp vụ** | Điều kiện cần để cloud-ready thật |
| A7 | **Degrade, đừng sập** | Model server không có SLA |

---

## 4. Cấu trúc repository

```
HR-agent/
├── config.yml                      # nguồn sự thật về model & routing
├── docs/
│   ├── TDD.md                      # tài liệu này
│   └── adr/                        # Architecture Decision Records
├── apps/
│   └── web/                        # Next.js 15 (App Router) — UI + BFF
│       ├── app/
│       │   ├── (marketing)/
│       │   ├── (app)/builder/      # editor CV
│       │   ├── (app)/analyze/      # JD matching + gap report
│       │   ├── (admin)/kb/         # curator UI cho Knowledge Base
│       │   └── api/
│       └── components/
├── services/
│   ├── worker/                     # BullMQ: parse, export, embed
│   └── pdfkit/                     # FastAPI nhỏ: pdfplumber/PyMuPDF
├── packages/
│   ├── schema/                     # Zod: Profile, JD, Patch, KB  (dùng chung)
│   ├── ai/
│   │   ├── gateway.ts              # điểm vào DUY NHẤT tới model
│   │   ├── budget.ts               # ngân sách context §6
│   │   ├── providers/
│   │   │   ├── llamacpp.ts         # OpenAI-compatible
│   │   │   ├── bgeEmbed.ts         # API riêng của :8003
│   │   │   ├── bgeRerank.ts        # :5014
│   │   │   └── anthropic.ts        # stub, enabled: false
│   │   ├── tasks/                  # 1 thư mục = 1 task
│   │   │   └── <task>/{prompt.ts,schema.ts,index.ts}
│   │   └── policies.ts             # breaker, retry, timeout
│   ├── templates/                  # React components render CV
│   ├── matching/                   # scoring engine (thuần code)
│   └── kb/                         # selector + citation
├── kb/seed/                        # Knowledge Base khởi tạo (YAML)
├── eval/                           # bộ đánh giá
│   ├── cv/  jd/  golden/
│   └── run.ts
├── db/migrations/
└── docker-compose.yml
```

**Quy tắc phụ thuộc (enforce bằng ESLint `no-restricted-imports`):**

```
apps/web  ──►  packages/ai  ──►  packages/schema
services  ──►  packages/*        (KHÔNG có chiều ngược lại)

apps/**, services/** KHÔNG được import:
  @anthropic-ai/sdk · openai · axios tới 100.68.50.41
Chỉ packages/ai/providers/** được phép.
```

---

## 5. Model Gateway

### 5.1 Interface công khai

Toàn bộ ứng dụng chỉ biết đúng một hàm:

```ts
// packages/ai/gateway.ts
export async function run<T>(
  task: TaskName,
  input: TaskInput<T>,
  opts?: { signal?: AbortSignal; onToken?: (t: string) => void }
): Promise<TaskResult<T>>

export type TaskResult<T> =
  | { ok: true;  data: T; meta: CallMeta }
  | { ok: false; error: GatewayError; meta: CallMeta; degraded?: Partial<T> }

export interface CallMeta {
  task: TaskName
  provider: 'local' | 'anthropic'
  model: string
  latencyMs: number
  promptTokens: number
  completionTokens: number
  schemaValid: boolean
  attempts: number
  escalated: boolean
  truncated: boolean       // §6 — có phần nội dung bị cắt do ngân sách
}
```

Code nghiệp vụ **không bao giờ** biết đang gọi Qwen hay Claude.

### 5.2 Định nghĩa một task

```ts
// packages/ai/tasks/gap-analysis/index.ts
export const gapAnalysis = defineTask({
  name: 'gap_analysis',
  schema: GapReportSchema,              // Zod
  buildPrompt: (i: GapInput) => [...],
  budget: {
    total: 12_000,
    reserveForOutput: 2_000,
    sections: [                         // thứ tự = độ ưu tiên giữ lại
      { key: 'system',  max: 700,  droppable: false },
      { key: 'jd',      max: 900,  droppable: false },
      { key: 'profile', max: 3_200, droppable: false, compactor: 'profileCompact' },
      { key: 'kb',      max: 2_500, droppable: true,  compactor: 'kbTrim' },
      { key: 'history', max: 2_700, droppable: true,  compactor: 'chatCompact' },
    ],
  },
  onSchemaFail: 'retry_then_escalate',
  maxRetries: 2,
})
```

Đổi tuyến model = sửa `config.yml`. Đổi prompt = sửa `prompt.ts`. Không đụng vào code gọi.

### 5.3 Vòng đời một lời gọi

```
run(task, input)
  │
  ├─1. resolveRoute(task)          ← config.yml routing
  ├─2. checkBreaker(model)         ← mở? → fallback / trả degraded
  ├─3. buildPrompt + fitBudget()   ← §6, có thể cắt section droppable
  ├─4. call provider (streaming)   ← timeout theo policies
  ├─5. validate(schema)
  │      ├─ pass → trả ok:true
  │      └─ fail → retry (≤maxRetries)
  │                └─ vẫn fail → escalate | fail theo onSchemaFail
  └─6. log CallMeta                ← luôn luôn, kể cả khi lỗi
```

### 5.4 Adapter — 3 loại API khác nhau

| Provider | Endpoint | Body | Ghi chú |
|---|---|---|---|
| `llamacpp` | `POST /v1/chat/completions` | chuẩn OpenAI | Có `/tokenize`, `/props` để đo ngân sách. Hỗ trợ `response_format: json_schema` → §5.4.1 |
| `bgeEmbed` | `POST /embed` | `{"text": "..."}` | **Số ít.** `{"texts": [...]}` → 422. Batch dùng `/embed-batch` |
| `bgeRerank` | `POST /v1/rerank` | `{query, documents, top_n}` | `relevance_score` là **logit, có thể âm** — chỉ so sánh tương đối |

```ts
// Bẫy đã gặp khi khảo sát — ghi lại để khỏi mắc lại
// ❌ POST :8003/v1/embeddings           → 404 (không phải OpenAI API)
// ❌ POST :8003/embed {"texts":[...]}   → 422 missing field "text"
// ✅ POST :8003/embed {"text":"..."}    → {success, dense_vector[1024], sparse...}
// ❌ POST :5012 chat text-only          → echo lại prompt (OCR cần ảnh)
```

### 5.4.2 Grammar hỏng thì llama.cpp IM LẶNG bỏ qua

> Phát hiện từ log server, không phải từ test. M5.

llama.cpp chuyển JSON Schema thành grammar GBNF để ép model sinh đúng hình
dạng. Gặp cấu trúc nó không dựng được:

```
failed to parse grammar
```

Dòng đó nằm trong **log server**. Về phía gọi: **HTTP 200**, và model sinh tự
do như thể không có `response_format` nào.

**Thiệt hại đo được.** `JsonPointerSchema` (`z.string().regex(...)`) làm hỏng
grammar của ba task:

| Task | Nguyên bản | Bỏ `pattern` |
|---|---|---|
| `propose_patch` | `{"status":"success",…}` — không có `ops` | `{"ops":[…]}` |
| `plan_agent_step` | tương tự | `{"intent":…}` |
| `insight_mining` | tương tự | `{"reason":…}` |
| `gap_analysis` | đúng (không có JSON Pointer) | đúng |

Nghĩa là **toàn bộ trợ lý chat (M4) đã chạy không có constrained decoding**, và
mọi test vẫn xanh — model tình cờ tuân theo prompt là đủ để qua. Nó cũng giải
thích vì sao test "số bịa" lúc đỏ lúc xanh.

**Cách sửa: `stripGrammarHostile`** — lược `pattern` khỏi bản JSON Schema gửi
làm grammar. Đây KHÔNG phải nhượng bộ:

| | |
|---|---|
| `pattern` bảo đảm | "chuỗi trông giống JSON Pointer" |
| `validateOps` bảo đảm | "đường dẫn TỒN TẠI trong hồ sơ này" |

Ràng buộc thứ hai mạnh hơn hẳn, và đã có sẵn. Đổi ràng buộc yếu lấy toàn bộ
constrained decoding là món hời. `pattern` vẫn giữ trong schema Zod và vẫn có
hiệu lực khi validate output cùng khi kiểm dữ liệu vào từ API — chỉ bản dùng
làm grammar mới bị lược.

**Bảo vệ lâu dài: `grammar.int.test.ts`.** Gửi prompt VÔ NGHĨA ("xin chào") cho
từng task rồi kiểm output có bị ép về đúng hình dạng không. Prompt vô nghĩa là
mấu chốt — model không có gợi ý nào từ nội dung, nên nếu output vẫn đúng schema
thì chỉ có thể do grammar.

**Bài học chung.** Đây là lần thứ N của cùng một dạng hỏng: HTTP 200, không lỗi
ở đâu, hành vi sai. Với mọi thành phần bên ngoài, câu hỏi phải là *"làm sao tôi
BIẾT nó đang thật sự làm việc đó"*, không phải *"nó có báo lỗi không"*.

### 5.4.3 `z.unknown()` biến field BẮT BUỘC thành tuỳ chọn trong grammar

> Phát hiện từ test tích hợp chạy trên model thật, sau khi đã sửa §5.4.2. M5.

`PatchOpSchema.value` khai báo `z.unknown().optional()` — hợp lý ở tầng dữ liệu,
vì op `remove` không có giá trị mới (RFC 6902). Nhưng qua `zodToJsonSchema`:

| Khai báo Zod | JSON Schema | Trong `required`? |
|---|---|---|
| `z.unknown().optional()` | `{}` | **không** |
| `z.unknown()` (không optional) | `{}` | **không** |
| `z.any()` | `{}` | **không** |
| `z.union([z.string(), z.number(), …])` | `{"anyOf":[…]}` | **có** |

`z.unknown()` ở mọi dạng đều ra `{}` và **không bao giờ** vào `required` —
Zod coi `unknown` là optional tự thân. Grammar dựng từ đó tự nói với model rằng
`"value"` được phép vắng mặt. Model 4B bỏ đi thật.

**Đo trên model thật:** `propose_patch` sinh 2 op, **cả 2 đều thiếu `value`**,
đường dẫn hợp lệ **0/2**. Người dùng gặp đúng lỗi này ở giao diện:

```
Patch thất bại: Không op nào áp dụng được.
Chi tiết: /work/0/endDate: op "replace" thiếu "value"
```

Điều đáng chú ý: lỗi đó KHÔNG phải model kém. Grammar đã **cho phép** nó, và
model làm đúng thứ grammar cho phép.

**Cách sửa: `WirePatchOpSchema`** — tách dạng gửi model khỏi dạng lưu trữ, khác
đúng một điểm là `value` liệt kê tường minh các kiểu JSON (kể cả `null`) nên
thành bắt buộc trong grammar. Prompt nói rõ: op `remove` điền `null`.

| Schema | Dùng cho | `value` |
|---|---|---|
| `PatchOpSchema` | lưu trữ, validate lúc áp dụng | tuỳ chọn — `remove` không cần |
| `WirePatchOpSchema` | output của model | **bắt buộc** |

`validateOps` đồng thời coi `null` là THIẾU với `add`/`replace`: model bị ép
phải điền gì đó sẽ điền `null` khi bí, và `null` ghi vào hồ sơ làm vỡ
`ProfileSchema` ở tầng dưới.

**Kết quả đo lại:** đường dẫn hợp lệ **2/2**, `runChatTurn` đầu-cuối trả `patch`
thay vì `error`. Qua HTTP thật: 10 op dùng được, 1 op bị loại kèm lý do đọc được.

**Bài học.** Cùng dạng với §5.4.2 và cùng chỗ mù: schema là thứ **sinh ra**
grammar, nên mọi chỗ lỏng trong schema là một chỗ lỏng trong hành vi model. Khi
một field bắt buộc về nghiệp vụ, nó phải bắt buộc trong **JSON Schema đã dịch**,
không chỉ trong ý định của người viết. Kiểm bằng cách in ra `required` — đã có
test cho việc đó trong `grammar.int.test.ts`.

### 5.4.1 Constrained decoding — BẮT BUỘC cho mọi task có schema

> Bổ sung sau khi hiện thực M0. Đây là phát hiện làm thay đổi thiết kế.

Prompt-only không đủ để model 4B trả JSON hợp lệ. Đo thực tế trên `parse_jd`
(schema 12 field):

| | Kết quả |
|---|---|
| Chỉ dùng prompt | Schema hợp lệ = **false**. Retry 2 lần trên `reasoner`, escalate sang `generalist`, retry tiếp → **6 lần thử, 12.3s, vẫn fail** |
| Bật `response_format: json_schema` | **1 lần thử, 2.8s, không escalate** |

llama.cpp (build b8833) dựng GBNF grammar từ JSON Schema và ép sinh token theo
đó, nên output *không thể* sai cấu trúc.

**Hiện thực:**

```ts
// packages/ai/src/gateway.ts — mặc định BẬT cho mọi task
jsonSchema: {
  name: task.name,
  schema: zodToJsonSchema(task.schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',      // nội tuyến hết — grammar builder xử lý $ref kém
  }),
}
```

Task trả văn xuôi tự do đặt `constrainedOutput: false`.

**Ảnh hưởng tới các phần khác:**
- §5.3 bước 5 (retry/escalate) vẫn giữ nguyên — nó là lưới an toàn, không còn là
  đường chạy thường xuyên. Chỉ số `schema_failure_rate` (§13.1) giờ phải gần 0;
  vượt 5% nghĩa là grammar không được áp dụng.
- Khi bật cloud: ánh xạ sang `output_config.format` của Anthropic. Cùng một Zod
  schema, khác cách truyền — đúng tinh thần A6.
- Kiểm chứng server còn hỗ trợ: **TC-INT-06**.

### 5.5 Chống chịu lỗi

```ts
policies = {
  circuitBreaker: { failureThreshold: 5, cooldownSec: 60, halfOpenProbes: 1 },
  healthCheck:    { intervalSec: 30, unhealthyAfter: 3 },
  timeouts:       { connect: 3_000, reasoner: 60_000, classifier: 10_000 },
}
```

**Ma trận degrade** — khi model server chết, ứng dụng vẫn phải dùng được:

| Tính năng | Khi LLM chết |
|---|---|
| Xem / sửa CV thủ công | ✅ Hoạt động bình thường |
| Đổi template, export PDF | ✅ Hoạt động bình thường |
| Matching keyword + ATS score | ✅ Thuần code, không cần LLM |
| Matching semantic | ⚠️ Tắt lớp semantic, chỉ còn keyword — báo cho user |
| Parse CV từ PDF | ⚠️ Chuyển sang nhập tay, hiện thông báo |
| Gap analysis, chat, viết lại | ❌ Vô hiệu hóa nút + banner "AI tạm không khả dụng" |

Nguyên tắc: **không bao giờ hiện màn hình lỗi trắng.** Luôn còn đường đi tiếp thủ công.

---

## 6. Quản lý ngân sách context

> Ràng buộc C1 + C2 khiến đây là phần dễ vỡ nhất của hệ thống. Phải thiết kế tường minh, không để "hy vọng nó vừa".

### 6.1 Ngân sách

```
Context vật lý     : 16,384
Đệm tranh chấp slot:  4,384   (4 slot dùng chung KV cache)
─────────────────────────────
NGÂN SÁCH LÀM VIỆC : 12,000   ← mọi task phải nằm trong đây
```

### 6.2 Phân bổ theo task (tiếng Việt, đã nhân 1.29)

| Task | system | profile | jd | kb | history | output | **tổng** |
|---|---:|---:|---:|---:|---:|---:|---:|
| `parse_cv_to_profile` | 1,200 | — | — | — | raw 3,500 | 2,800 | **7,500** |
| `parse_jd` | 600 | — | raw 1,500 | — | — | 900 | **3,000** |
| `gap_analysis` | 700 | 3,200 | 900 | 2,500 | — | 2,000 | **9,300** |
| `insight_mining` | 800 | 3,200 | 900 | 2,000 | 1,500 | 1,800 | **10,200** |
| `propose_patch` | 900 | 3,200 | 900 | 1,500 | 2,700 | 1,500 | **10,700** |
| `rewrite_bullet` | 600 | 800 | 500 | 1,200 | — | 600 | **3,700** |
| `generate_summary` | 600 | 3,200 | 900 | 1,200 | — | 1,000 | **6,900** |

Task nặng nhất là `propose_patch` — 10,700, còn dư 1,300 trong ngân sách 12,000. Biên an toàn mỏng → §6.4 bắt buộc.

### 6.3 Đo trước khi gửi

Không ước lượng bằng `text.length / 4`. Dùng chính tokenizer của model:

```ts
// packages/ai/budget.ts
export async function countTokens(text: string, model = 'reasoner'): Promise<number> {
  const r = await fetch(`${base(model)}/tokenize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  })
  return (await r.json()).tokens.length
}
```

Cache kết quả theo hash nội dung (Redis, TTL 1h) — Profile và JD không đổi trong một session.

### 6.4 Chiến lược khi vượt ngân sách

Áp dụng **theo thứ tự**, dừng ngay khi đã vừa:

```
1. Nén Profile          profileCompact()  — bỏ field rỗng, rút gọn key,
                                            bỏ section không liên quan tới JD
2. Cắt KB               kbTrim()          — giảm số chunk, giữ rubric bỏ exemplar
3. Nén lịch sử chat     chatCompact()     — tóm tắt N lượt cũ nhất bằng
                                            `compact_chat` (chính reasoner)
4. Bỏ section droppable  theo thứ tự ngược trong budget.sections
5. Vẫn vượt → CHIA NHỎ TASK, không cắt bừa
      gap_analysis → chạy từng section CV riêng, gộp kết quả bằng code
6. Vẫn không được → trả ok:false, UI báo "CV quá dài, hãy rút gọn"
```

**Cấm tuyệt đối:** cắt cụt giữa chừng rồi vẫn gửi. Profile bị cắt mất nửa mục kinh nghiệm sẽ tạo ra lời khuyên sai mà không ai biết. Nếu phải cắt, `CallMeta.truncated = true` và UI phải hiển thị cảnh báo.

### 6.5 Nén Profile — kỹ thuật cụ thể

```ts
// Gửi cho model dạng rút gọn, không phải Profile JSON đầy đủ
// Trước: 3,800 tok   Sau: ~2,100 tok
function profileCompact(p: Profile, jd?: JDRequirements): CompactProfile {
  return {
    edu:   p.education.map(e => `${e.degree}|${e.school}|${e.year}${e.gpa ? `|GPA ${e.gpa}` : ''}`),
    exp:   p.work.map(w => ({ r: w.role, o: w.org, d: w.period, h: w.highlights })),
    proj:  p.projects.map(x => ({ n: x.name, t: x.tech, h: x.highlights })),
    skill: p.skills.map(s => s.name),          // bỏ level nếu JD không yêu cầu
    // BỎ HẲN khi gửi model: photo, address, dob, phone, email  ← §15
  }
}
```

Ba thứ tiết kiệm được nhiều nhất: (a) bỏ PII, (b) rút gọn tên key, (c) bỏ field rỗng.

### 6.6 Tận dụng prefix cache của llama.cpp

llama.cpp tái sử dụng KV cache cho **prefix chung**. Xếp prompt theo độ ổn định:

```
[system + hướng dẫn]      ← không đổi cả session
[compact profile]         ← không đổi cho tới khi apply patch
[jd requirements]         ← không đổi cả session
──────── ranh giới ổn định ────────
[kb chunks]               ← đổi theo câu hỏi
[lịch sử chat]            ← tăng dần
[câu hỏi hiện tại]        ← đổi mỗi lượt
```

Đặt sai thứ tự (ví dụ nhét timestamp vào system) → mất toàn bộ prefix cache, prefill lại từ đầu, chậm gấp nhiều lần. Đây cũng chính là thứ tự Anthropic prompt caching yêu cầu → khi bật cloud không phải sửa gì.

---

## 7. Mô hình dữ liệu

### 7.1 Sơ đồ quan hệ

```
users ─1:1─ profiles ─1:N─ profile_revisions
                 │
                 └─1:N─ cv_documents ─1:N─ export_artifacts
                                 │
job_descriptions ─1:N─ match_analyses ─┘

chat_sessions ─1:N─ chat_messages ─0:N─ proposed_patches

kb_sources ─1:N─ kb_chunks
           ─1:N─ kb_rubrics
           ─1:N─ kb_exemplars
advice_citations ─N:1─ kb_chunks
```

### 7.2 DDL chính

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Người dùng ──────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  locale        text NOT NULL DEFAULT 'vi',       -- 'vi' | 'en'
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- ── Profile: nguồn sự thật duy nhất ─────────────────────────────────────────
CREATE TABLE profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data           jsonb NOT NULL,                  -- ProfileSchema (Zod)
  schema_version int  NOT NULL DEFAULT 1,
  language       text NOT NULL DEFAULT 'vi',
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Lịch sử dạng patch (không lưu snapshot đầy đủ)
CREATE TABLE profile_revisions (
  id          bigserial PRIMARY KEY,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  patch       jsonb NOT NULL,                     -- RFC 6902
  author      text  NOT NULL CHECK (author IN ('user','ai','import')),
  message_id  uuid,                               -- truy vết về lượt chat nào
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON profile_revisions (profile_id, id DESC);

-- ── CV = snapshot profile + template ────────────────────────────────────────
CREATE TABLE cv_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_snapshot jsonb NOT NULL,
  template_id      text  NOT NULL,
  theme            jsonb NOT NULL DEFAULT '{}',
  layout           jsonb NOT NULL DEFAULT '{}',   -- cấu trúc, KHÔNG phải tọa độ
  jd_id            uuid REFERENCES job_descriptions(id),
  language         text  NOT NULL DEFAULT 'vi',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── JD ──────────────────────────────────────────────────────────────────────
CREATE TABLE job_descriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  raw_text     text NOT NULL,
  source_url   text,
  language     text NOT NULL DEFAULT 'vi',
  requirements jsonb,                             -- JDRequirementsSchema
  industry     text,
  role_family  text,
  seniority    text,
  embedding    vector(1024),                      -- bge-m3 dense
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Kết quả matching ────────────────────────────────────────────────────────
CREATE TABLE match_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_id       uuid NOT NULL REFERENCES cv_documents(id) ON DELETE CASCADE,
  jd_id       uuid NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
  score       jsonb NOT NULL,                     -- {overall, breakdown{}}
  matched     jsonb NOT NULL,                     -- [{requirement, evidence, strength}]
  gaps        jsonb NOT NULL,
  citations   jsonb NOT NULL DEFAULT '[]',        -- kbRefs
  model_used  text,
  degraded    boolean NOT NULL DEFAULT false,     -- semantic layer bị tắt?
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Chat & patch ────────────────────────────────────────────────────────────
CREATE TABLE chat_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  jd_id       uuid REFERENCES job_descriptions(id),
  title       text,
  compacted_summary text,                         -- §6.4 bước 3
  compacted_upto_message_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user','assistant','system')),
  content     text NOT NULL,
  token_count int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON chat_messages (session_id, created_at);

CREATE TABLE proposed_patches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  ops         jsonb NOT NULL,                     -- [{op,path,value,rationale,grounding}]
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','accepted','rejected','partial')),
  applied_ops jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Knowledge Base ──────────────────────────────────────────────────────────
CREATE TABLE kb_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  author_name  text NOT NULL,
  author_title text,                              -- "HR Manager, 8 năm, FPT Software"
  file_key     text,
  language     text NOT NULL DEFAULT 'vi',
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','pending_review','active','archived')),
  version      int  NOT NULL DEFAULT 1,
  uploaded_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kb_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('guideline','exemplar','red_flag')),
  text         text NOT NULL,
  breadcrumb   text,
  industry     text[] NOT NULL DEFAULT '{}',
  role_family  text[] NOT NULL DEFAULT '{}',
  seniority    text[] NOT NULL DEFAULT '{}',
  section      text[] NOT NULL DEFAULT '{}',
  language     text NOT NULL DEFAULT 'vi',
  token_count  int,
  priority     int NOT NULL DEFAULT 50,           -- dùng khi phải cắt bớt (§6.4)
  embedding    vector(1024),                      -- NULL ở giai đoạn 1
  tsv          tsvector,
  status       text NOT NULL DEFAULT 'pending_review',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON kb_chunks USING gin (industry, role_family, seniority, section);
CREATE INDEX ON kb_chunks USING gin (tsv);
-- Index vector chỉ tạo khi bật hybrid_retrieval:
-- CREATE INDEX ON kb_chunks USING hnsw (embedding vector_cosine_ops);

-- Rubric là DỮ LIỆU CÓ CẤU TRÚC cho scoring engine, KHÔNG embed
CREATE TABLE kb_rubrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   uuid NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  industry    text NOT NULL,
  role_family text NOT NULL,
  seniority   text NOT NULL,
  criteria    jsonb NOT NULL,
  weights     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'pending_review',
  UNIQUE (industry, role_family, seniority, source_id)
);

CREATE TABLE kb_exemplars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   uuid NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  section     text NOT NULL,
  industry    text[] NOT NULL DEFAULT '{}',
  before_text text NOT NULL,
  after_text  text NOT NULL,
  explanation text NOT NULL,
  language    text NOT NULL DEFAULT 'vi'
);

-- ── Job bất đồng bộ ─────────────────────────────────────────────────────────
CREATE TABLE jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,                      -- parse_cv | export_pdf | embed
  idempotency_key text UNIQUE NOT NULL,           -- hash(input)
  status      text NOT NULL DEFAULT 'queued',
  payload     jsonb NOT NULL,
  result      jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Telemetry ───────────────────────────────────────────────────────────────
CREATE TABLE llm_calls (
  id                bigserial PRIMARY KEY,
  task              text NOT NULL,
  provider          text NOT NULL,
  model             text NOT NULL,
  latency_ms        int,
  prompt_tokens     int,
  completion_tokens int,
  schema_valid      boolean,
  attempts          int,
  escalated         boolean,
  truncated         boolean,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON llm_calls (task, created_at DESC);
```

### 7.3 ProfileSchema (rút gọn)

```ts
// packages/schema/profile.ts
export const ProfileSchema = z.object({
  schemaVersion: z.literal(1),
  language: z.enum(['vi', 'en']),
  basics: z.object({
    name: z.string(),
    headline: z.string().optional(),
    email: z.string().email().optional(),      // PII — không gửi model
    phone: z.string().optional(),              // PII
    location: z.string().optional(),           // PII
    dob: z.string().optional(),                // PII
    links: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
    summary: z.string().optional(),
  }),
  education: z.array(z.object({
    school: z.string(), degree: z.string(), major: z.string().optional(),
    startDate: z.string().optional(), endDate: z.string().optional(),
    gpa: z.string().optional(), highlights: z.array(z.string()).default([]),
  })).default([]),
  work: z.array(z.object({
    org: z.string(), role: z.string(), type: z.enum(['fulltime','parttime','intern','freelance']).optional(),
    startDate: z.string().optional(), endDate: z.string().optional(),
    highlights: z.array(z.string()).default([]),
  })).default([]),
  projects: z.array(z.object({
    name: z.string(), role: z.string().optional(),
    tech: z.array(z.string()).default([]),
    url: z.string().url().optional(),
    highlights: z.array(z.string()).default([]),
  })).default([]),
  skills: z.array(z.object({
    name: z.string(),
    level: z.enum(['beginner','intermediate','advanced']).optional(),
    canonical: z.string().optional(),           // sau khi normalize qua taxonomy
  })).default([]),
  activities: z.array(z.object({                // CLB, tình nguyện, cuộc thi
    name: z.string(), role: z.string().optional(),
    period: z.string().optional(), highlights: z.array(z.string()).default([]),
  })).default([]),
  certifications: z.array(z.object({
    name: z.string(), issuer: z.string().optional(), date: z.string().optional(),
  })).default([]),
  languages: z.array(z.object({
    name: z.string(), level: z.string().optional(),
  })).default([]),

  // Metadata do hệ thống quản lý — không do user nhập
  _meta: z.object({
    verified: z.record(z.boolean()).default({}),  // path -> user đã xác nhận?
    source: z.enum(['manual','pdf_import','ai_generated']).default('manual'),
  }).default({}),
})
```

Field `_meta.verified` là xương sống chống hallucination: mọi nội dung do AI sinh ra đều `verified: false` cho tới khi user bấm xác nhận.

---

## 8. Luồng nghiệp vụ

### 8.1 F1 — Import CV từ PDF

```
User upload PDF
   │
   ├─ Lưu S3/local, tạo job(kind=parse_cv, idempotency_key=sha256(file))
   │
   ▼ Worker
   ├─ [1] pdfkit service: có text layer không?
   │        ├─ CÓ  → pdfplumber trích text + toạ độ block
   │        └─ KHÔNG → render page → PNG 200dpi
   │                    → run('ocr_cv_page', {image})      [model: ocr :5012]
   │
   ├─ [2] Heuristic phát hiện bố cục
   │        Nếu 2 cột / bảng phức tạp → dùng đường ảnh (kể cả khi có text layer),
   │        vì text layer 2 cột hay bị trộn thứ tự.
   │
   ├─ [3] run('redact_pii', {text})        [BẮT BUỘC local — §15]
   │        → tách PII ra bảng riêng, thay bằng placeholder
   │
   ├─ [4] run('parse_cv_to_profile', {text})   [reasoner, ProfileSchema]
   │        → schema fail → retry 2 lần → fail → user nhập tay
   │
   ├─ [5] Ghép PII trở lại, đánh dấu _meta.verified = false toàn bộ
   │
   └─ [6] SSE báo FE → MÀN HÌNH REVIEW BẮT BUỘC
            User duyệt từng section → verified = true
```

**Quyết định thiết kế:** bước [6] không được bỏ qua, kể cả khi model tự tin. Parse sai âm thầm sẽ làm hỏng mọi phân tích phía sau mà không ai phát hiện.

### 8.1.1 Cổng kiểm tra chất lượng text layer

> Bổ sung sau khi khảo sát 6 CV thật. Xem `eval/cv/INVENTORY.md`.

Thiết kế ban đầu ở bước [1] chỉ có hai nhánh — *có text layer* / *không có*.
Thực tế có **nhánh thứ ba: có text layer nhưng không tin được**.

Đo trên CV-02 (dùng Type3 font), hai engine cho kết quả khác nhau:

| Engine | Kết quả |
|---|---|
| PyMuPDF | `IˇMm a business analyst…` — hỏng ký tự, **mất hẳn dòng tên và chức danh** |
| poppler | `I'm a business analyst…` — đúng, lấy được tên mà PyMuPDF bỏ sót |

Mất dòng tên = mất field quan trọng nhất. Và **so sánh độ dài không phát hiện
được** — cả 6 file đều lệch 0%.

**Nhánh mới:**

```
[1] Trích text
     ├─ Không có text layer            → đường ảnh (OCR)
     ├─ Có Type3 font                  → đường ảnh   ← tín hiệu deterministic,
     │                                                  khớp 1:1 với file hỏng
     ├─ Ký tự lỗi (ˇ ˘ ˙ ˚ ﬁ ﬂ, hoa
     │  kẹt giữa thường) vượt ngưỡng   → đường ảnh
     ├─ Hai engine bất đồng > 15%      → đường ảnh
     └─ Còn lại                        → PyMuPDF (có toạ độ, cần cho tô sáng
                                          vùng ở màn hình rà soát UC-22)
```

Chạy cả hai engine là rẻ (đều cục bộ, không tốn LLM), nên luôn chạy cả hai và
so sánh thay vì tin một engine.

**Nhánh khi đường ảnh KHÔNG khả dụng** (hiện tại — `local.ocr` chết, §2.6):

| `quality` | Có OCR | Không có OCR (hiện tại) |
|---|---|---|
| `good` | dùng text | dùng text — **không đổi** |
| `suspect` | đi đường ảnh | dùng text, **kèm cảnh báo** ở màn hình rà soát |
| `none` | đi đường ảnh | **dừng có kiểm soát** → mời user nhập tay |

Nguyên tắc: thiếu OCR làm *giảm chất lượng*, không được làm *sập luồng*. Job kết
thúc `status='failed'` với `error_code='NO_TEXT_LAYER'` — mã máy đọc được để FE
hiện đúng lời mời nhập tay chứ không phải màn hình lỗi trắng (BR-71.1).

Khi `local.ocr` sống lại, chỉ cần bật `routing.ocr_cv_page.enabled: true` trong
`config.yml`; nhánh trong worker đã viết sẵn và có test.

**Ảnh hưởng:** `services/pdfkit` phải expose `quality: 'good' | 'suspect' |
'none'` cùng với text, để worker quyết định nhánh. Trường này cũng đi vào
`jobs.result` để màn hình rà soát (UC-22) biết mà cảnh báo user.

**Phát hiện font phải đọc RESOURCE DICTIONARY, không suy ra từ API text.**
Đo trên CV-02 (có Type3):

| PyMuPDF | `get_text("dict")` → spans → font | Kết quả |
|---|---|---|
| 1.27.2 | `['Type3 (1394 0 R)', …]` | phát hiện đúng, chọn poppler |
| 1.25.1 | `[]` | **bỏ sót**, quality tụt xuống chỉ còn "nhiều cột" |

Cổng chất lượng suy giảm âm thầm theo phiên bản thư viện là điều không chấp
nhận được — nó vẫn trả kết quả, chỉ là kết quả sai. `page.get_fonts()` đọc thẳng
resource dict của PDF nên ổn định qua các phiên bản. Hiện thực gộp cả hai nguồn
(font chỉ dùng để *đánh giá rủi ro*, thừa còn hơn thiếu) và pin
`PyMuPDF==1.27.2`. Test hồi quy khẳng định `fonts` không bao giờ rỗng khi có
text layer.

### 8.1.2 Parse THEO MỤC, không parse cả CV một lượt

> Bổ sung sau khi chạy thật trên 6 CV. Đây là thay đổi thiết kế bắt buộc.

Bước [4] ban đầu gửi toàn bộ text CV cho model và nhận về một Profile. Đo thực
tế trên CV-01 (3.047 ký tự, có mục `EDUCATION` rõ ràng):

| Cách làm | Kết quả |
|---|---|
| Gửi cả CV một lượt | `education: []` — **bỏ sót nguyên mục**, dù text còn nguyên. Các mục nằm *sau* education (`certifications`, `languages`) lại lấy được |
| Gửi riêng đoạn EDUCATION | Parse đúng, **3/3 lần, deterministic** |

Đây là **mất chú ý theo độ dài**, không phải lỗi schema, không phải redaction
cắt nhầm (đã kiểm chứng cả hai). Và nó là kiểu hỏng nguy hiểm nhất: im lặng.
Không có lỗi, không có cảnh báo — chỉ là một mục biến mất.

**Luồng mới cho bước [3]–[4]:**

```
[3] Chia mục — THUẦN CODE (eval/lib/segment.ts)
      Nhận diện tiêu đề song ngữ: EDUCATION/Học vấn, EXPERIENCE/Kinh nghiệm…
      Dòng ALL-CAPS không khớp từ khoá → mục 'unknown', vẫn tách ra
      Làm bằng code vì: rẻ, deterministic, test được

[4] Parse TỪNG MỤC — mỗi mục một lời gọi, schema riêng nhỏ
      education → z.object({ items: EducationSchema[] })
      work      → z.object({ items: WorkSchema[] })
      …
```

**Kết quả sau khi đổi** (6/6 CV, không mục nào bị bỏ sót):

| CV | Trước | Sau |
|---|---|---|
| CV-01 | edu **0** · work 3 · skills 8 | edu **1** · work 3 · skills 8 |
| CV-04 | — | edu 1 · work 4 · activities 2 · cert 3 |
| CV-06 | — | edu 1 · work 1 · skills 4 · activities 4 · cert 3 |
| CV-10 | — | edu 1 · work 2 · projects 4 · skills 44 ⚠ |

Lợi ích kèm theo: schema nhỏ → grammar đơn giản → nhanh và ít hỏng hơn; một mục
hỏng không kéo đổ cả CV; và thời gian tổng **không tăng** (26,4s so với 27,6s).

⚠ Còn tồn: CV-10 ra 44 kỹ năng — model tách danh sách kỹ năng quá mịn. Cần
hậu xử lý gộp/chuẩn hoá ở M3 khi làm skill taxonomy.

### 8.1.2.1 "Languages" trong CV IT là ngôn ngữ LẬP TRÌNH

> Bổ sung sau khi đo chia mục trên 6 CV thật (M2-4).

Chia mục theo tiêu đề chạy tốt cho 5/6 CV. CV-07 hỏng theo kiểu im lặng:

```
Languages                     ← tiêu đề khớp regex `languages`
PHP 8.4, TypeScript, ...
Frameworks
Laravel 12, Vue 3, ...        ← 811 ký tự tech stack
...
Language                      ← mục ngoại ngữ THẬT, cùng file
English: Good oral, ...
```

Toàn bộ tech stack rơi vào `languages`, còn `skills` ra **rỗng**. Kỹ năng là
trường mà đối chiếu JD phụ thuộc nhất — mất nó là mất phần lớn giá trị sản phẩm,
mà job vẫn báo "thành công".

**Cách sửa: phân loại lại theo NỘI DUNG, không chỉ tiêu đề.** Mục `languages`
không nêu tên ngôn ngữ nào (English, Tiếng Nhật, IELTS, N2…) thì được chuyển
thành `skills`.

Quy tắc cố ý viết theo chiều "nhận diện ngôn ngữ" chứ không phải "nhận diện
công nghệ": tập tên ngôn ngữ là hữu hạn và ổn định, còn danh sách framework thì
không bao giờ đầy đủ — mỗi thư viện mới ra đời lại là một lần bỏ sót.

### 8.1.2.2 Nhãn nhóm không phải là kỹ năng

Sau khi chia mục đúng, model lại trả về 8 "kỹ năng" chính là 8 **nhãn nhóm**
(`Languages`, `Frameworks`, `Databases`, `Build Tools`…) thay vì công nghệ bên
trong. JD hỏi "Laravel", không hỏi "Frameworks" — kết quả đó vô dụng.

Sửa bằng luật riêng cho mục `skills` trong prompt (`EXTRA_RULES` ở
`parse-section.ts`): nêu rõ nhãn nhóm không phải kỹ năng, kèm ví dụ, và yêu cầu
bỏ số phiên bản. Sau khi sửa: 52 công nghệ thật, `Laravel 12` → `Laravel`.

**Nguyên tắc rút ra:** hai lỗi trên đều KHÔNG làm job thất bại — job báo
"thành công" với dữ liệu rỗng hoặc vô nghĩa. Chỉ đo trên CV thật mới thấy.
Đây là lý do màn hình rà soát (UC-22) là bắt buộc, và là lý do `eval/run.ts`
(X-3) phải đo `field_accuracy` chứ không chỉ đếm job thành công.

### 8.1.3 Ba lỗi hạ tầng phát hiện khi chạy thật

Ghi lại vì cả ba đều hỏng âm thầm và đã có test hồi quy:

| Lỗi | Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|---|
| Cache JSON Schema theo **tên task** | 4/5 mục fail `SCHEMA_INVALID` | 7 task parse-section dùng chung tên `parse_cv_to_profile` để chia sẻ route → mục sau bị ép sinh JSON hình dạng của mục trước | Cache bằng `WeakMap` khoá theo **chính đối tượng schema** |
| `connect_timeout_ms` áp cho cả cuộc gọi | Mọi task sinh dài đều `TIMEOUT` | 3s là timeout *kết nối*, không phải timeout *toàn cuộc gọi*; task sinh 3.500 token mất ~100s | Provider không đặt timeout cho `chat()`; gateway kiểm soát qua `AbortSignal` |
| `generalist` làm fallback cho task ngữ cảnh lớn | Escalate rồi vẫn fail, tốn thêm ~100s | ctx của `generalist` chỉ 4.096, task cần ~7.500 — không thể thành công | `fallback: null` cho `parse_cv_to_profile`, ghi rõ lý do trong config |

### 8.2 F2 — Phân tích JD & Matching

```
User dán JD (hoặc URL)
   │
   ├─ run('parse_jd', {text})   [reasoner → JDRequirementsSchema]
   │     → {hardSkills[], softSkills[], domain, seniority, yearsRequired,
   │        responsibilities[], atsKeywords[], niceToHave[]}
   │
   ├─ Suy ra (industry, roleFamily, seniority) → dùng để lọc KB
   │
   ▼ packages/matching  (THUẦN CODE — không LLM)
   ├─ Lớp 1: keyword/ATS
   │     normalize qua skill_taxonomy → coverage score
   ├─ Lớp 2: semantic
   │     embed từng requirement + từng bullet CV  [embedder :8003]
   │     cosine → tìm evidence  →  rerank top-N  [reranker :5014]
   ├─ Lớp 3: rule
   │     seniority fit, năm kinh nghiệm, học vấn  ← từ kb_rubrics
   │
   ├─ Điểm tổng = weighted(lớp 1,2,3)     ← DETERMINISTIC, test được
   │
   ▼ run('gap_analysis', {compactProfile, jdReq, matchResult, kbChunks})
   └─ LLM chỉ diễn giải gap + đề xuất, KHÔNG chấm điểm
        → mọi lời khuyên kèm kbRefs (§10.4)
```

Nếu `embedder` chết → bỏ lớp 2, `degraded = true`, UI hiện: *"Đang dùng đối chiếu từ khóa. Phân tích ngữ nghĩa tạm không khả dụng."*

### 8.2.1 Lớp rỗng bị BỎ QUA, không được cho điểm tuyệt đối

> Bổ sung sau khi đo trên 5 JD thật (M3-1).

Điểm tổng là trung bình có trọng số của ba lớp (hard 0.6 · soft 0.2 · ats 0.2).
Bản đầu cho lớp KHÔNG CÓ YÊU CẦU 100 điểm, với lý lẽ "JD không đòi gì thì không
trừ điểm ai". Đo trên JD-04 — một JD cố tình mơ hồ, không nêu kỹ năng cứng nào —
cách đó cho ra **83 điểm**:

| | cũ | mới |
|---|---|---|
| lớp `hard` (0 yêu cầu) | 100 → đóng góp 60 | bỏ qua |
| lớp `ats` (0 từ khoá) | 100 → đóng góp 20 | bỏ qua |
| lớp `soft` (1/4) | 14 → đóng góp 3 | 14, là lớp duy nhất |
| **điểm tổng** | **83** | **14** |

"83% phù hợp" với một tin tuyển dụng chẳng đòi hỏi gì là con số vô nghĩa nhưng
trông đáng tin — dạng sai nguy hiểm nhất. Lớp rỗng nay bị loại khỏi trung bình:
nó không giúp cũng không hại, và điểm chỉ phản ánh những gì thật sự đo được.

Kèm theo: `noHardRequirements` để UI nói rõ *"JD này không nêu yêu cầu kỹ thuật
cụ thể, điểm chỉ mang tính tham khảo"*.

### 8.2.2 Quan hệ cha–con trong phân loại kỹ năng là bắt buộc

Đo trên JD-01 thật: một CV có **cả MySQL lẫn PostgreSQL** vẫn bị báo *"thiếu
SQL"* vì phân loại chưa khai `parent: sql`. Sau khi khai, điểm 35 → 41.

Quy tắc: mọi kỹ năng cụ thể phải trỏ `parent` tới khái niệm bao hàm mà JD hay
hỏi chung chung — `mysql → sql`, `mongodb → nosql`, `nextjs → react → javascript`.
Chiều khớp là MỘT CHIỀU: biết Next.js nghĩa là biết React, nhưng biết React
không có nghĩa là biết Next.js.

Test `mọi \`parent\` đều trỏ tới kỹ năng CÓ THẬT` chặn lỗi gõ sai — parent sai
làm `ancestors` im lặng trả thiếu, không có lỗi nào hiện ra.

### 8.2.3 Không khẳng định ngưỡng điểm tuyệt đối trong test

Test tích hợp từng có `expect(score).toBeGreaterThan(50)` — con số 50 hoàn toàn
bịa ra. Đo thực tế cho 41, và phân tích thành phần cho thấy 41 ĐÚNG: CV mẫu
thiếu thật 4/11 kỹ năng cứng và 8/9 từ khoá ATS.

Hạ ngưỡng cho test xanh là uốn test theo code; chỉnh fixture cho tới khi vượt
ngưỡng còn tệ hơn. Thứ CÓ ý nghĩa là **thứ tự tương đối**: cùng một CV, JD đúng
ngành phải cao điểm hơn JD trái ngành. Đo được: 41 (Fullstack) > 36 (Web) >
30 (Java Backend) — đúng thứ tự.

### 8.3 F3 — Chat editing & Patch

```
User: "Phần dự án của em yếu quá, sửa giúp em"
   │
   ├─ run('plan_agent_step', {msg, context})   → {intent, targetSection, needsInfo[]}
   │
   ├─ Nếu needsInfo không rỗng:
   │     run('insight_mining') → sinh 1-3 câu hỏi làm rõ
   │     → "Dự án này bao nhiêu người? Bạn phụ trách phần nào?
   │        Có đo được số liệu gì không (số user, thời gian, %)?"
   │     → CHỜ user trả lời, KHÔNG tự bịa số
   │
   ├─ Sau khi đủ thông tin:
   │     run('propose_patch', {...})  → PatchProposalSchema
   │
   ├─ Validate từng op:
   │     · path hợp lệ trong Profile?
   │     · op thêm fact mới → có `grounding` trỏ tới message_id / field cũ?
   │       KHÔNG có → đánh dấu needsConfirmation
   │
   ▼ UI hiển thị diff từng op: [trước] → [sau] + lý do + nguồn
   └─ User accept từng op → apply JSON Patch → profile_revisions → re-render
```

**PatchProposalSchema:**

```ts
export const PatchOpSchema = z.object({
  op: z.enum(['add','remove','replace','move']),
  path: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/),
  value: z.unknown().optional(),
  rationale: z.string().min(10),               // bắt buộc — hiển thị cho user
  grounding: z.object({
    type: z.enum(['user_message','existing_field','kb','inference']),
    ref: z.string(),
  }),
  kbRefs: z.array(z.string()).default([]),
})
export const PatchProposalSchema = z.object({
  ops: z.array(PatchOpSchema).min(1).max(20),
  summary: z.string(),
})
```

`grounding.type === 'inference'` → UI tô màu cảnh báo và **mặc định không tick chọn**.

### 8.5 F5 — Bản CV riêng cho từng JD (UC-33)

> Bổ sung sau khi rà lại thiết kế: A2 tách Profile khỏi CVDocument, nhưng
> KHÔNG trả lời được câu "làm gọn mục kinh nghiệm cho JD này mà đừng đụng bản
> đầy đủ".

**Lỗ hổng của bản đầu.** Mọi `cv_documents` trỏ về một `profiles` chung. Sửa
nội dung ở CV này thì CV kia đổi theo. Cột `cv_documents.profile_snapshot` có
trong lược đồ nhưng KHÔNG được dùng để render — câu SQL của builder còn đặt bí
danh `p.data AS profile_snapshot`, đọc như đang dùng snapshot trong khi thực ra
dùng bản sống. Dễ tưởng là đã xong.

**Vì sao "chỉ đổi phần hiển thị" không đủ.** Rút gọn CV có hai loại thao tác:

| Thao tác | Bản chất | Đổi hiển thị đủ chưa? |
|---|---|---|
| Ẩn bớt dự án, đảo thứ tự mục | trình bày | ✔ đủ |
| **Viết lại bullet cho ngắn gọn** | **nội dung** | ✘ phải sửa dữ liệu |
| Đổi headline theo JD | nội dung | ✘ |

Nhu cầu thật nằm ở nhóm thứ hai, nên không thể giải bằng `layout`/`theme`.

**Quyết định D12 — nhân bản hồ sơ khi đối chiếu JD.**

```
profiles(gốc) ──┬── cv_documents "Bản đầy đủ"
                │
   dán JD-A ────┼──► profiles(bản sao A) ── cv_documents "Everlastify — Fullstack"  jd_id=A
   dán JD-B ────┴──► profiles(bản sao B) ── cv_documents "Finhay — Backend"         jd_id=B
```

Nhân bản là **im lặng** (BR-33.1). Người dùng chỉ thấy mình đang sửa CV; họ
không phải hiểu khái niệm "hồ sơ" và "tài liệu CV" — đó là chi tiết cài đặt.

**Đánh đổi đã chấp nhận:** sau khi tách, sửa email ở bản này không lan sang bản
kia. Phương án "một hồ sơ gốc, CV chỉ chọn phần hiển thị" tránh được điều đó
nhưng không làm nổi việc viết lại nội dung — mà đó mới là nhu cầu chính.

**Phiên bản trong một CV.** Mỗi lần thông tin thay đổi đều sinh một
`profile_revisions` — cơ chế này ĐÃ CHẠY từ M1 (`ProfileRepo.patch`, `undoLast`,
`revertTo`). Hai khái niệm khác nhau, đừng lẫn:

| | Sinh ra khi | Dùng để |
|---|---|---|
| **Tài liệu CV** | đối chiếu một JD mới | ứng tuyển nhiều nơi cùng lúc |
| **Phiên bản** | mỗi lần thông tin đổi | xem lại, hoàn tác, khôi phục |

Cái còn thiếu chỉ là GIAO DIỆN lịch sử (UC-34) — API `revisions`, `undo`,
`revertTo` đã có và có test.

**Ảnh hưởng tới lược đồ:** không cần migration. `cv_documents` đã có `profile_id`
và `jd_id`. Cột `profile_snapshot` được dùng đúng mục đích ban đầu: ảnh chụp
tại thời điểm tạo, phục vụ đối chiếu "CV này lúc nộp trông thế nào", KHÔNG phải
nguồn render.

### 8.3.1 Hồ sơ gửi model có HAI dạng, không phải một

> Bổ sung sau khi đo `propose_patch` trên model thật (M4).

`stripPII` rút gọn tên key để tiết kiệm token: `work` → `exp`,
`highlights` → `h`, `startDate`/`endDate` → `d`. Rẻ hơn ~35% token và vô hại
với task chỉ ĐỌC hồ sơ.

Nhưng `propose_patch` phải TRẢ VỀ JSON Pointer. Model viết đường dẫn theo đúng
thứ nó nhìn thấy:

```
model trả:  /exp[0]/h[0]          ← theo hình dạng rút gọn
hồ sơ thật: /work/0/highlights/0
```

Đo trên model thật: **3/3 op đều sai đường dẫn → 0 op áp dụng được**. Không có
lỗi nào ở đâu cả — model trả JSON hợp lệ, task báo thành công, `validateOps`
lặng lẽ loại hết, và người dùng thấy "trợ lý không giúp được gì".

**Quy tắc:**

| Task | Dạng hồ sơ | Vì sao |
|---|---|---|
| `gap_analysis`, `plan_agent_step` | `stripPII` | chỉ đọc, rẻ token |
| `propose_patch` | `redactKeepShape` | phải trả JSON Pointer khớp hồ sơ thật |

`redactKeepShape` giữ nguyên tên field, chỉ bỏ các field PII trong `basics`.

### 8.3.2 Model gán SAI nguồn để làm điều bịa ra trông đáng tin

Đo thật: yêu cầu *"thêm số liệu cho ấn tượng hơn"* lên một hồ sơ KHÔNG có con
số nào, và KHÔNG có câu trả lời nào của người dùng. Model trả về:

```json
{ "path": "/work/0/highlights/0",
  "value": "… giảm 30% thời gian xử lý …",
  "grounding": { "type": "user_message", "ref": "msg-1" } }
```

Con số bịa ra, và được gán nguồn `user_message` — tức là giao diện sẽ **tick
sẵn** op đó (UC-53 bước 2). Đây là kiểu hỏng nguy hiểm nhất: nó làm điều bịa
ra trông như do chính người dùng cung cấp.

**Hai lớp chặn, cả hai đều cần:**

1. **Prompt** — khi không có câu trả lời nào, nói THẲNG rằng
   `grounding.type="user_message"` là không hợp lệ vì không có messageId nào
   để dẫn nguồn. Sau khi thêm, model ngừng bịa số trong phép đo lặp lại.
2. **Code** — `validateOps` kiểm `grounding.ref` có nằm trong tập messageId
   CÓ THẬT của phiên không. Prompt là gợi ý, code mới là ràng buộc.

Test đo đúng tính chất cần đúng: không phải "model không bao giờ bịa" (model 4B
sẽ bịa), mà **"số bịa ra không bao giờ tới tay người dùng dưới dạng có nguồn"**.

### 8.3.3 Kiểm op phải xong TRƯỚC khi hiện lên màn hình

`PatchOpSchema` khai `value: z.unknown().optional()` — bắt buộc không được vì
`remove` vốn không có `value`. Nên schema cho qua một op `replace` thiếu
`value`, nó chạy thẳng lên modal, người dùng tick, bấm Áp dụng, rồi mới vỡ ở
tầng DB:

```
Patch thất bại: /work/0/highlights/0: op "replace" thiếu "value"
```

`applyProfilePatch` CÓ kiểm — nhưng ở cuối đường ống, sau khi người dùng đã ra
quyết định. Quy tắc: **mọi kiểm tra khiến op không dùng được phải chạy ở
`validateOps`**, trước khi op có cơ hội hiện ra. Tầng DB là lưới an toàn cuối,
không phải nơi phát hiện.

### 8.3.4 Chat phải báo TỪNG BƯỚC

Một lượt chat gọi model 2-3 lần, mỗi lần ~5-10 giây. Bản đầu trả một JSON duy
nhất sau khi xong hết, và giao diện chỉ hiện "Đang suy nghĩ…".

Người dùng ngồi im 30-60 giây không có tín hiệu nào, không biết hệ thống còn
sống hay đã treo. Nhiều người sẽ bấm lại — và bấm lại là thêm một lượt vào
hàng đợi vốn đã chậm.

`/api/chat` nay trả SSE, bắn `step` ngay khi bắt đầu mỗi bước:

```
Đang hiểu yêu cầu của bạn   →  Đang soạn câu hỏi làm rõ
                            →  Đang soạn đề xuất chỉnh sửa
                            →  Đang kiểm tra đề xuất
```

Đọc SSE viết tay chứ không dùng `EventSource`: `EventSource` chỉ làm được GET,
mà lượt chat cần gửi hồ sơ và câu trả lời qua body.

**Thông điệp lỗi cũng phải nói rõ.** *"Bạn thử lại sau ít phút nhé"* là câu vô
dụng khi nguyên nhân là yêu cầu mơ hồ hoặc ngữ cảnh quá dài — thử lại y hệt sẽ
hỏng y hệt. Mỗi mã lỗi nay dẫn tới một hành động cụ thể.

### 8.3.5 Câu HỎI phải được trả lời, không bị đá về

> Phát hiện từ người dùng. M5. UC-56.

`plan_agent_step` phân loại được `ask_question` và `explain`. Bản đầu không làm
gì với chúng:

```ts
if (intent === 'ask_question' || intent === 'explain') {
  return { kind: 'reply', text: '', intent }   // ← chuỗi RỖNG
}
```

Tầng API thấy `text` rỗng nên điền vào câu mặc định:

> *"Mình chưa rõ bạn muốn sửa gì. Bạn nói cụ thể hơn giúp nhé."*

Người dùng gõ *"Tôi có insight nào bạn giúp tôi lọc ra với"*, hệ thống **phân
loại đúng** là câu hỏi, rồi vứt đi và trả lời rằng họ nói không rõ. Hiểu đúng
rồi trách ngược — tệ hơn cả không phân loại, vì người dùng không có cách nào
đoán ra mình phải nói khác đi thế nào.

Và đây không phải trường hợp biên: *"CV của tôi yếu chỗ nào?"* chính là **giá
trị cốt lõi** của sản phẩm. Cố vấn, không phải máy sửa văn bản.

**Task `answer_question`** nhận: hồ sơ đã che PII + **kết quả đối chiếu JD gần
nhất** + chunk KB. Kết quả đối chiếu là mấu chốt — thiếu nó thì câu trả lời chỉ
còn nhận xét chung chung, đúng thứ BR-56.2 cấm.

Trả về hai phần:

| Trường | Vì sao |
|---|---|
| `answer` | ≤6 câu, phải NÊU BẰNG CHỨNG từ hồ sơ |
| `nextSteps` | ≤3 việc **gõ lại được vào ô chat**, hiện thành NÚT |

`nextSteps` không phải trang trí. Nhận xét mà không kèm việc làm được chỉ khiến
người ta lo thêm; in ra dạng chữ thì họ phải tự gõ lại y hệt câu đó.

Prompt cấm nhắc tên field JSON (`proj`, `exp`, `/work/0`). Đo lần đầu, model
viết *"mục 'Dự án' (proj) hoàn toàn trống rỗng"* — `proj` là khoá rút gọn của
`stripPII`, người dùng không nhìn thấy JSON nên chữ đó vô nghĩa với họ.

### 8.3.6 Ba không gian tên đường dẫn, và cái thứ ba lọt ra màn hình

> Phát hiện từ người dùng. M5.

`plan_agent_step` đọc `CompactProfile`, nơi key đã rút gọn để tiết kiệm token
(`work` → `exp`, `activities` → `act`, `highlights` → `h`). Nên `targetPath` nó
trả về nằm trong **không gian tên rút gọn**, không phải Profile thật:

| plan trả về | Profile thật |
|---|---|
| `/act` | `/activities` |
| `/exp/0/h/0` | `/work/0/highlights/0` |

Ba hậu quả, cả ba đều **im lặng** — không lỗi ở đâu:

1. `readPath(profile, '/act')` trả rỗng → `insight_mining` soạn câu hỏi mà
   không biết mục đó đang có gì
2. `propose_patch` nhận *"Mục liên quan: /act"* — con trỏ không tồn tại trong
   chính hồ sơ nó được yêu cầu sửa
3. Con trỏ lọt thẳng ra giao diện: *"cần biết đúng hướng đi cho vị trí /act"*

Người dùng không nhìn thấy JSON. Với họ `/act` là một mẩu lỗi kỹ thuật rò ra.

**`paths.ts` — dịch một lần, ngay sau `plan_agent_step`:**

| Hàm | Việc |
|---|---|
| `expandCompactPath` | `/act` → `/activities`; con trỏ vốn đã đúng thì giữ nguyên, nên gọi lên là vô hại |
| `sectionLabel` | `/work/0/highlights/1` → "Kinh nghiệm" — thứ ĐƯA VÀO PROMPT thay cho con trỏ |
| `humanizePointers` | chốt chặn cuối trên mọi chuỗi hiển thị |

`humanizePointers` tồn tại vì prompt đã dặn "không nhắc tên field" mà model vẫn
nhắc — hai lần, ở hai task khác nhau. Dặn không phải là bảo đảm; bảo đảm phải
nằm ở tầng code.

### 8.3.7 Dẫn nguồn sai thì HẠ CẤP, không loại

> Phát hiện từ người dùng. M5.

Op dẫn nguồn `user_message` tới một `messageId` không có thật vốn bị loại hẳn.
Lý do ban đầu đúng: giao diện tick sẵn op "có nguồn từ người dùng", nên nguồn
bịa nguy hiểm hơn nội dung bịa.

Nhưng loại hẳn thì **giết cả lượt**. Đo thật: người dùng gõ một yêu cầu mới
thay vì trả lời form làm rõ, `answers` rỗng, model vẫn gán `user_message` cho
**mọi** op — cả lô bị loại, và họ nhận về:

> *"Trợ lý soạn đề xuất chưa dùng được: dẫn nguồn tới tin nhắn không tồn tại."*

Một lời trách về lỗi của model, phát cho người dùng, kèm gợi ý vô dụng là nói
rõ hơn — họ đã nói rõ rồi.

Điều PHẢI bảo đảm là *"thứ model bịa không bao giờ hiện ra như đã được xác
nhận"*. **Hạ xuống `inference`** làm đúng việc đó: không tick sẵn, viền vàng,
người dùng tự quyết. Loại hẳn không bảo đảm thêm được gì.

Đây cũng đã là cách xử lý số bịa (§8.3.2) — nay hai chỗ nhất quán.

### 8.3.8 `recentMessages` trả về tin nhắn CŨ nhất

> Phát hiện khi kiểm chứng bản sửa §8.3.7 trên phiên chat thật. M5.

```sql
ORDER BY m.created_at
LIMIT $2          -- ← n tin nhắn CŨ NHẤT, không phải mới nhất
```

Tên hàm nói "recent", SQL làm ngược lại. Phiên ngắn hơn `limit` thì hai cách
cho cùng kết quả, nên nó chạy đúng suốt cho tới khi phiên dài ra — không có
lỗi, không có cảnh báo, chỉ là ngữ cảnh sai dần.

**Thiệt hại ở phiên 84 tin nhắn:**

| | |
|---|---|
| Model nhìn thấy | 12 tin nhắn ĐẦU phiên |
| Câu người dùng vừa gõ | **không có trong ngữ cảnh** |
| `messageIds` | thiếu id câu hiện tại → mọi dẫn nguồn tới nó bị coi là bịa |

Điều này còn nuôi §8.3.7: model gán `user_message` cho op dựa trên câu người
dùng vừa gõ — hoàn toàn hợp lý — nhưng id câu đó không nằm trong `messageIds`,
nên guard coi là bịa nguồn.

Sửa: `ORDER BY created_at DESC LIMIT n` rồi `.reverse()` về thứ tự thời gian.

**Bài học.** Cùng dạng với §5.4.2, §5.4.3, §8.3.6: không lỗi ở đâu, hành vi
sai, và sai theo kiểu chỉ lộ ra khi dữ liệu đủ lớn. Test dùng 20 tin nhắn với
`limit=5` — phải vượt `limit` thì mới đo được gì.

### 8.3.9 Chốt chặn cuối: áp thử rồi kiểm bằng chính `ProfileSchema`

> Phát hiện khi kiểm chứng §8.3.6 trên hồ sơ thật. M5.

Sau khi sửa hết ba lỗi trên, model trả về một op trông hoàn toàn hợp lệ:

```json
{ "op": "add", "path": "/activities/-",
  "value": { "name": { "$ref": "/activities/0/name" }, "period": {…} } }
```

Đường dẫn có thật, `value` có mặt, dẫn nguồn hợp lệ — **mọi guard cũ cho qua**.
Nhưng `name` là một object kiểu JSON Schema ở chỗ đáng lẽ là chuỗi, và
`period` không phải field của Profile. Người dùng tick, bấm Áp dụng, rồi mới vỡ.

`typeMismatch` không bắt được vì nó cần giá trị CŨ để so — op `add` thêm phần
tử mới thì không có gì để so.

**Cách duy nhất bao hết mọi hình dạng sai là hỏi chính schema.** `wouldBreakProfile`
áp op lên **bản sao** rồi `ProfileSchema.safeParse`:

| | |
|---|---|
| Chạy trên bản sao | hồ sơ thật không đụng tới (BR-53.1) |
| Mỗi op kiểm ĐỘC LẬP với hồ sơ gốc | người dùng bỏ tick op nào cũng được, nên op này không được dựa vào op kia |
| Lý do loại nêu đúng chỗ sai | `Giá trị không đúng dạng ở "activities/1/name"` |

Hệ quả kèm theo: `remove` xoá mất một field BẮT BUỘC nay cũng bị loại — đúng,
vì kết quả không còn là Profile hợp lệ.

**Bài học.** Bốn guard trước đều kiểm một khía cạnh model có thể làm sai, và
model tìm ra khía cạnh thứ năm. Chỉ có kiểm bằng chính định nghĩa dữ liệu mới
đóng được cả lớp lỗi thay vì từng lỗi một.

### 8.3.10 Có lúc chỉ grammar mới sửa được, prompt thì không

> Phát hiện khi kiểm chứng §8.3.9 trên hồ sơ thật. M5.

Guard §8.3.9 chặn đúng op hỏng, nhưng model **lặp lại đúng lỗi đó 100% số lần**:

```json
add /activities/-  {"name": {"$ref": "/activities/0/name"},
                    "role": {"$ref": "/basics/headline"}, …}
```

Ba cách thuyết phục, đo trên model thật, **không cách nào ăn thua**:

| Cách | Kết quả |
|---|---|
| Cấm hẳn trong prompt, kèm ví dụ đúng | vẫn `$ref` |
| Nói lại lỗi cụ thể ở lượt sửa (`corrections`) | vẫn `$ref` |
| Đưa khuôn mẫu hoàn chỉnh để chép | vẫn `$ref` |

Nguyên nhân nằm ở grammar, không ở prompt. `PatchValueSchema` có nhánh
`z.record(z.unknown())` → `additionalProperties: {}`, nghĩa là grammar **cho
phép object với khoá bất kỳ**. Model Qwen được huấn luyện nhiều trên JSON
Schema, nên trong ngữ cảnh "object chưa biết hình dạng" thì `$ref` là khoá có
xác suất cao. Nó không cãi lời — nó đang đi theo đúng thứ grammar mở ra.

**`CvItemSchema`: liệt kê hết field + `.strict()`** → `additionalProperties:
false`. Grammar không sinh ra nổi khoá `$ref` nữa. Không còn phải thuyết phục
model; nó không có cách nào viết ra thứ đó.

Gộp field của mọi loại mục vào một schema (name/org/role/school/degree/…):
model chỉ điền field hợp với chỗ nó thêm, và §8.3.9 vẫn kiểm lại bằng
`ProfileSchema` nên field thừa không lọt vào hồ sơ.

**Đo lại cùng yêu cầu, cùng câu trả lời của người dùng:**

```
add /activities/- {"name":"Quản lý hệ thống sản xuất 24/7",
                   "period":"Hiện tại",
                   "highlights":["Lãnh đạo nhóm 4 kỹ sư… 3 nhà máy…"]}
→ dùng được 1, loại 0
```

**Bài học.** Với model nhỏ, ranh giới giữa "prompt kém" và "grammar quá rộng"
rất dễ đọc nhầm. Dấu hiệu phân biệt: **lỗi lặp lại 100% và không nhúc nhích dù
prompt đổi thế nào** — khi đó đừng viết lại prompt lần thứ tư, hãy đi xem
grammar đang cho phép cái gì. Prompt là lời khuyên, grammar là luật.

### 8.3.11 Zod LƯỢC BỎ khoá lạ — "đã áp dụng" mà nội dung biến mất

> Phát hiện từ người dùng: *"logs nói trợ lý đã thêm /summary rồi mà sao tôi
> chưa thấy nó trên UI"*. M5.

Hồ sơ chưa có phần giới thiệu, nên model đoán chỗ và đề xuất:

```
add /summary  "AI Engineer chuyên sâu về Edge AIoT và MLOps…"
```

Ba tầng đều cho qua:

| Tầng | Vì sao cho qua |
|---|---|
| `pathExists` | `add` được phép tạo field mới |
| `ProfileSchema.safeParse` | Zod **lược bỏ** khoá lạ chứ không báo lỗi |
| Áp dụng | ghi thành công, trả `applied: 1` |

Người dùng bấm duyệt, hệ thống báo *"Đã áp dụng 1 thay đổi"*, hồ sơ lưu xong —
và `summary` **không có trong đó**. CV trống, log nói là xong.

Đây là kiểu hỏng tệ nhất trong cả nhóm §8.3: mất dữ liệu mà báo thành công thì
không ai đi tìm. Bốn lỗi trước ít nhất còn hiện ra một câu lỗi.

**`safeParse` thành công vẫn chưa đủ.** `wouldBreakProfile` nay kiểm thêm: sau
khi parse, giá trị có CÒN ở đúng chỗ vừa ghi không.

```
add /summary        → "Hồ sơ không có chỗ summary — nội dung sẽ bị mất"  (loại)
add /basics/summary → qua
add /activities/-   → qua, kiểm đúng phần tử VỪA thêm
```

Lý do loại nêu tên chỗ sai, nên lượt sửa (§8.3.7) đưa được nó cho model. Prompt
cũng nói thẳng phần giới thiệu nằm ở `/basics/summary`.

**Bài học.** `safeParse().success` trả lời câu hỏi *"kết quả có hợp lệ không"*,
KHÔNG phải *"thay đổi của tôi có nằm trong đó không"*. Với schema lược khoá lạ
— mặc định của Zod — hai câu đó khác nhau, và chỉ câu thứ hai mới là thứ cần
biết. Cùng dạng với §5.4.2/§5.4.3: hỏi sai câu thì luôn nhận được câu trả lời
đáng tin mà vô nghĩa.

### 8.3.12 Proposal sau validate phải còn là đề xuất thật

> Phát hiện từ người dùng. M5.

Model sinh một proposal có summary nói đã chuyển 3 dự án từ Hoạt động sang
Kinh nghiệm, nhưng 3 op chính đều bị loại vì hồ sơ chưa có `/work/0`, `/work/1`,
`/work/2`. Op còn lại là `replace /basics/summary` với giá trị **giống hệt**
hiện tại. UI vẫn hiện:

```
Trợ lý đề xuất 1 thay đổi
Đã chuyển toàn bộ nội dung chi tiết từ mục Hoạt động sang mục Kinh nghiệm...
```

Đây là hai lỗi khác nhau cùng làm người dùng mất niềm tin:

| Lỗi | Quy tắc mới |
|---|---|
| `replace` không đổi dữ liệu | Loại no-op trước khi hiện modal |
| `summary` mô tả op đã bị loại | Rebuild summary từ op còn hợp lệ sau validate |
| Thêm item bằng `/work/0` khi mảng rỗng | Loại và đưa correction rõ: dùng `add /work/-` |

Summary là chữ người dùng đọc để quyết định có mở/duyệt proposal hay không, nên
không được lấy nguyên văn từ model sau khi danh sách op đã thay đổi. Nếu validate
loại bớt op, summary phải là summary của phần **còn áp dụng được**; nếu không còn
op thật, trả lỗi/hỏi lại thay vì hiện modal rỗng hoặc no-op.

### 8.4 F4 — Export PDF

```
CVDocument ──► Playwright headless ──► /print/:cvId (route nội bộ)
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   ▼                                             ▼
          "Bản trình bày"                              "Bản ATS-safe"
          template mức A/B, có màu,                     1 cột, không table,
          có thể 2 cột                                  không icon, font chuẩn
```

Cùng một component React, khác `themeVariant`. UI hỏi rõ: *"Bạn nộp qua hệ thống tuyển dụng online hay gửi email trực tiếp?"*

Yêu cầu kỹ thuật: font Unicode có dấu đầy đủ (Be Vietnam Pro / Inter), `@page { size: A4; margin: 12mm }`, `break-inside: avoid` trên mỗi entry.

### 8.4.1 Font — yêu cầu triển khai

> Bổ sung sau khi xuất PDF thật lần đầu.

Đo trên máy dev: `Be Vietnam Pro` và `Inter` **không có sẵn**. Chromium rơi
xuống Arial. Tiếng Việt vẫn **đúng dấu** (`pdftotext` trả về "Nguyễn Minh Khôi",
"Kỹ thuật phần mềm" chính xác — Arial nhúng subset Unicode), nên đây không phải
lỗi chức năng. Nhưng CV **không hiển thị đúng font thiết kế**.

| | Trạng thái |
|---|---|
| Máy dev hiện tại | Fallback Arial · tiếng Việt đúng · khác thiết kế |
| Yêu cầu khi đóng gói | Image của `services/worker` (nơi chạy Playwright) **phải nhúng font** |

```dockerfile
# services/worker/Dockerfile — bắt buộc, không phải tuỳ chọn
COPY fonts/BeVietnamPro-*.ttf /usr/share/fonts/truetype/bvp/
RUN fc-cache -f
```

**Vì sao bắt buộc:** nếu image thiếu font, PDF vẫn ra và vẫn đọc được — hỏng
âm thầm, không có lỗi nào báo. Chỉ phát hiện khi nhìn bằng mắt. Đã thêm
**TC-32-09** để kiểm bằng `pdffonts`, không dựa vào quan sát thủ công.

### 8.4.2 Chi tiết hiện thực Playwright

| Điểm | Vì sao |
|---|---|
| Browser dùng lại giữa các lần xuất | Khởi động Chromium mất ~300-800ms; bật/tắt mỗi lần là lãng phí lớn khi có hàng đợi (UC-72) |
| `await document.fonts.ready` trước khi in | Nếu không, chữ có dấu render bằng font fallback rồi mới đổi — PDF giữ nguyên bản sai |
| `waitForSelector('.cv-page')` | HTML sai thì in ra trang trắng. Thà báo lỗi còn hơn giao file rỗng cho user |
| `preferCSSPageSize` + margin 0 | Lề do `.cv-page` quản bằng mm → preview và PDF giống hệt nhau |
| `printBackground` chỉ bật cho bản trình bày | Bản ATS không cần nền; bật lên còn làm một số bộ quét hồ sơ đọc kém |

**Đo được:** ~950ms/lần xuất, PDF 69-83KB, đúng khổ A4 (594.96 × 841.92 pt).

---

## 9. Thiết kế song ngữ

### 9.1 Ba trục ngôn ngữ độc lập

Đừng gộp làm một — đây là lỗi thiết kế phổ biến:

| Trục | Nghĩa | Lưu ở đâu |
|---|---|---|
| **UI locale** | Ngôn ngữ giao diện | `users.locale` |
| **Content language** | Ngôn ngữ nội dung CV | `profiles.language`, `cv_documents.language` |
| **JD language** | Ngôn ngữ của JD | `job_descriptions.language` |

Trường hợp thật hay gặp: giao diện tiếng Việt · CV tiếng Anh · JD tiếng Anh. Hoặc CV tiếng Việt nhưng JD công ty nước ngoài bằng tiếng Anh.

### 9.2 Matching xuyên ngôn ngữ

CV tiếng Việt ↔ JD tiếng Anh là trường hợp phổ biến ở thị trường VN.

- `bge-m3` là model **multilingual** → embedding tiếng Việt và tiếng Anh nằm chung không gian ngữ nghĩa. Cosine giữa *"Xây dựng SPA bằng ReactJS"* và *"Built single-page applications with React"* vẫn cao. **Lớp semantic hoạt động xuyên ngôn ngữ mà không cần dịch.**
- Lớp keyword **không** xuyên ngôn ngữ. Xử lý bằng `skill_taxonomy` có trường `aliases` chứa cả hai ngôn ngữ:

```yaml
- canonical: "react"
  display: { vi: "ReactJS", en: "React" }
  aliases: ["react", "reactjs", "react.js", "react js"]
- canonical: "project_management"
  display: { vi: "Quản lý dự án", en: "Project Management" }
  aliases: ["quản lý dự án", "quan ly du an", "project management", "pm"]
```

Chuẩn hóa bỏ dấu (`quản lý` → `quan ly`) để bắt cả trường hợp người dùng gõ không dấu.

### 9.3 Prompt & KB theo ngôn ngữ

```
packages/ai/tasks/gap-analysis/prompt.vi.ts
packages/ai/tasks/gap-analysis/prompt.en.ts
```

Chọn theo `content language`, không theo UI locale. KB chunk có cột `language`; selector ưu tiên đúng ngôn ngữ, fallback sang ngôn ngữ còn lại nếu chưa có bản dịch (và đánh dấu trong citation).

### 9.4 Chi phí token

Theo §2.3, tiếng Việt tốn 1.29× token. Ngân sách §6.2 đã tính theo tiếng Việt (trường hợp xấu nhất). Nội dung tiếng Anh sẽ dư ~23% ngân sách — dùng phần dư đó để nạp thêm KB chunk.

---

## 10. Knowledge Base

### 10.1 Chiến lược: chọn lọc theo ngữ cảnh, chưa phải RAG

Lý do (đã thống nhất): một CV chỉ ~1-3K token, nhét thẳng vào 16K context là đủ. RAG trên CV chỉ làm mất thông tin do chunking. Vấn đề duy nhất là **KB có thể lớn dần**.

```
Giai đoạn 1  ── strategy: context_injection
   SQL filter (industry, role_family, seniority, section, language)
      → sắp theo `priority`
      → cắt theo ngân sách token (§6.2, mục kb)
      → nhét thẳng vào prompt
   KHÔNG embed, KHÔNG vector search, KHÔNG chunking phức tạp.

Khi KB đã lọc vượt 8,000 token ── auto switch → hybrid_retrieval
   bge-m3 dense + sparse → RRF → bge-reranker → top 6
   Hạ tầng đã sẵn sàng (:8003, :5014). Đổi 1 dòng config.
```

### 10.2 Interface không đổi giữa hai chiến lược

```ts
// packages/kb/selector.ts
export interface KnowledgeSelector {
  select(ctx: KBContext, budgetTokens: number): Promise<SelectedKnowledge>
}

export interface KBContext {
  industry: string; roleFamily: string; seniority: string
  sections: string[]; language: 'vi' | 'en'
  query?: string                     // chỉ hybrid mới dùng
}

export interface SelectedKnowledge {
  rubric: Rubric | null              // LUÔN từ SQL, không bao giờ qua vector
  guidelines: KBChunk[]
  exemplars: Exemplar[]
  tokensUsed: number
  strategy: 'context_injection' | 'hybrid_retrieval'
}

// v1: SqlFilterSelector        ← giai đoạn 1
// v2: HybridRetrievalSelector  ← đổi config, không đổi code gọi
```

### 10.3 Rubric là dữ liệu, không phải văn bản

Đây là điểm dễ làm sai nhất. Rubric đi thẳng vào **scoring engine**, không qua LLM và không qua vector:

```yaml
industry: it_software
role_family: backend_developer
seniority: fresher
criteria:
  - id: project_count
    label: { vi: "Số dự án cá nhân/đồ án", en: "Personal/academic projects" }
    type: count
    path: "$.projects"
    min: 2
    weight: 0.20
    advice_when_below:
      vi: "Bổ sung ít nhất 2 dự án có mô tả tech stack và vai trò cụ thể."
      en: "Add at least 2 projects with tech stack and your specific role."
  - id: quantified_bullets
    label: { vi: "Bullet có số liệu", en: "Quantified bullets" }
    type: ratio
    path: "$..highlights[*]"
    matcher: "contains_number"
    min: 0.3
    weight: 0.25
```

Nếu để rubric trôi trong kho vector, bạn mất khả năng chấm điểm deterministic và model sẽ tùy hứng bỏ qua tiêu chí.

### 10.4 Trích dẫn bắt buộc

```json
{
  "advice": "Bullet này nên có con số cụ thể về quy mô dữ liệu bạn xử lý.",
  "kbRefs": ["kb_chunk_a71f"],
  "confidence": "high"
}
```

UI hiển thị: **"Theo [Tên HR] — [Chức danh]"** kèm trích đoạn gốc.

Lời khuyên **không có `kbRefs`** → gắn nhãn *"gợi ý chung của AI"*, hiển thị khác màu. Ranh giới này vừa tạo niềm tin, vừa là công cụ debug: lời khuyên sai → biết ngay chunk nào sai.

### 10.4.1 Mã trích dẫn phải NGƯỜI ĐỌC ĐƯỢC, không phải UUID

> Đo trên model thật (M5).

`kb_chunks.id` là UUID. Đưa UUID vào prompt và yêu cầu model chép lại vào
`kbRefs` cho kết quả **0/11 lời khuyên có trích dẫn** — chép chính xác 36 ký tự
hex là việc model 4B làm rất tệ, và sai một ký tự thì trích dẫn thành vô nghĩa.

Dùng `breadcrumb` (`g_bullet_formula`) làm mã trích dẫn: ngắn, có nghĩa, model
chép đúng, và người đọc log hiểu ngay lời khuyên đến từ đâu. UUID vẫn là khoá
chính trong DB; `citations()` nhận cả hai dạng.

Kèm theo: `citations()` phải LỌC NGÔN NGỮ. Mỗi đoạn được nạp thành hai bản
(vi + en) cùng breadcrumb, nên thiếu điều kiện đó thì báo cáo hiện trích dẫn
trùng — một bản tiếng Việt, một bản tiếng Anh, cho cùng một lời khuyên.

### 10.4.2 Guard PII không áp lên nội dung ĐÃ QUA DUYỆT

Guard `detectPII` chạy trên mọi section trước khi gửi prompt. Một đoạn KB viết
*"Đổi sang email dạng họtên@gmail.com"* — ví dụ mẫu, không phải email của ai —
làm guard nổ và **chặn hẳn toàn bộ tính năng tư vấn**.

Đây là nhầm phạm trù: guard tồn tại để chặn PII **của người dùng** rời khỏi hệ
thống. Tri thức HR là nội dung biên soạn, có curator ký tên và duyệt trước khi
kích hoạt (UC-62).

**Cách sửa:** `PromptSection.trusted` — section nội dung đã duyệt được guard bỏ
qua. Bù lại, PII trong KB được kiểm ở **lúc nạp** (`ingestKbFile`): một lần,
đúng chỗ, và curator thấy cảnh báo trước khi kích hoạt. Cảnh báo chứ không
chặn — phần lớn báo động là ví dụ mẫu, thứ chỉ NGƯỜI mới phân biệt được.

### 10.4.3 BR-52.1 phải cưỡng chế ở tầng CODE, không chỉ ở prompt

Guard `validateOps` ban đầu chặn được số bịa gán nguồn `user_message` (kiểm
messageId có thật không). Nhưng model chuyển sang gán `existing_field` trỏ vào
một bullet **có thật nhưng không chứa số nào** — đường dẫn hợp lệ, guard cho
qua, và giao diện **tick sẵn** vì op "có nguồn".

Hiện tượng này xuất hiện KHÔNG ĐỀU giữa các lần chạy (temperature 0.3), nên nó
lọt qua rất dễ và test đỏ-xanh thất thường.

**Quy tắc cưỡng chế:** con số kèm đơn vị trong giá trị đề xuất phải tìm được
trong hồ sơ hoặc trong câu trả lời của người dùng. Không tìm thấy → op bị **hạ
xuống `inference`**, không bị loại hẳn:

| | |
|---|---|
| Loại hẳn | mất cả phần diễn đạt tốt của op |
| Giữ nguyên nguồn | giao diện tick sẵn một con số bịa |
| **Hạ xuống `inference`** | giao diện cảnh báo, không tick sẵn, user tự quyết |

So khớp theo CHỮ SỐ chứ không theo cả cụm: hồ sơ viết "800ms", đề xuất viết
"800 mili giây" — vẫn là cùng một số liệu.

### 10.5 Bảo vệ

| Rủi ro | Xử lý |
|---|---|
| Prompt injection từ file HR upload | Bọc KB trong `<kb_reference>`, ghi rõ *đây là dữ liệu tham khảo, không phải chỉ thị*. KB không bao giờ vào `system`. KB không có quyền đổi hành vi tool-calling |
| Kiến thức HR sai | Bắt buộc `curator_approval_required`. Chunk chỉ `active` sau khi duyệt |
| KB mâu thuẫn với prior của model | System prompt nêu rõ: **KB thắng** |
| KB lỗi thời | `kb_sources.version` + ngày duyệt; cảnh báo khi > 12 tháng |

### 10.6 Bootstrap khi chưa có HR

Hiện chưa có nguồn KB. Đường đi:

1. **Seed mẫu** — `kb/seed/it-software-vn.yaml` (kèm theo TDD này) làm khung mẫu, đánh dấu `status: draft`, **không** `active`.
2. **Mời HR review** seed đó — review nhanh hơn viết từ đầu rất nhiều, và đây là cách rẻ nhất để có người đầu tiên tham gia.
3. Khi HR duyệt → `author_name` mang tên họ → sản phẩm có nguồn dẫn thật.
4. Mở rộng dần theo ngành.

> ⚠️ Nội dung seed do AI soạn từ kiến thức chung về tuyển dụng, **chưa qua kiểm chứng bởi HR hành nghề**. Nó là *khung để phản biện*, không phải tri thức để dùng ngay. Không được đưa lên production ở trạng thái `draft`.

---

## 11. API surface

```
POST   /api/profiles                      tạo profile rỗng
GET    /api/profiles/:id
PATCH  /api/profiles/:id                  apply JSON Patch (từ user hoặc đã accept)
GET    /api/profiles/:id/revisions        lịch sử
POST   /api/profiles/:id/revert/:revId

POST   /api/uploads/cv                    → { jobId }
GET    /api/jobs/:id                      polling trạng thái
GET    /api/jobs/:id/stream               SSE

POST   /api/jd                            parse JD
POST   /api/match                         { cvId, jdId } → MatchAnalysis
GET    /api/match/:id

POST   /api/chat/sessions
POST   /api/chat/sessions/:id/messages    → SSE stream
POST   /api/patches/:id/apply             { acceptedOpIndexes: number[] }
POST   /api/patches/:id/reject

POST   /api/cv                            tạo CVDocument từ profile + template
GET    /api/cv/:id/preview                render HTML
POST   /api/cv/:id/export                 { variant: 'presentation'|'ats' } → jobId

# Admin / curator
POST   /api/kb/sources                    upload
GET    /api/kb/chunks?status=pending_review
POST   /api/kb/chunks/:id/approve
POST   /api/kb/rubrics

GET    /api/health                        gồm cả trạng thái model server
```

**Quy ước:** mọi endpoint gọi LLM đều trả `meta` chứa `CallMeta` để FE hiển thị trạng thái degrade.

---

## 12. Triển khai

### 12.1 docker-compose.yml (máy dev)

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment: { POSTGRES_DB: hragent, POSTGRES_PASSWORD: ${PG_PASSWORD} }
    ports: ["5433:5432"]           # 5432 có thể đã bị chiếm
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck: { test: ["CMD-SHELL","pg_isready -U postgres"], interval: 10s }

  redis:
    image: redis:7-alpine
    ports: ["6380:6379"]
    command: ["redis-server","--appendonly","yes"]

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://postgres:${PG_PASSWORD}@postgres:5432/hragent
      REDIS_URL: redis://redis:6379
      MODEL_HOST: http://100.68.50.41
    depends_on: { postgres: { condition: service_healthy }, redis: {} }

  worker:
    build: { context: ., dockerfile: services/worker/Dockerfile }
    environment: { <<: *env }
    depends_on: [postgres, redis, pdfkit]

  pdfkit:
    build: { context: ./services/pdfkit }     # FastAPI + pdfplumber + PyMuPDF
    ports: ["8100:8000"]

volumes: { pgdata: }
```

**Lưu ý cổng:** máy dev đã có `mqtt_broker:1883`, `dozzle:5555`. Postgres/Redis map ra 5433/6380 để tránh xung đột.

**Playwright** chạy trong container `worker` (image `mcr.microsoft.com/playwright` hoặc cài chromium + font tiếng Việt).

### 12.2 Biến môi trường

```bash
DATABASE_URL=postgres://...
REDIS_URL=redis://...
MODEL_HOST=http://100.68.50.41       # Tailscale
AUTH_SECRET=...
STORAGE_DRIVER=local                  # local | s3
ANTHROPIC_API_KEY=                    # để trống ở giai đoạn 1
```

### 12.3 Package manager

Máy chỉ có `npm` (v10.8.2). Dự án monorepo → dùng **npm workspaces** (đủ dùng, không cần cài thêm). Nếu muốn `pnpm` thì phải cài trước — không phải blocker.

---

## 13. Quan sát & đánh giá

### 13.1 Metric bắt buộc

| Metric | Ngưỡng cảnh báo |
|---|---|
| `schema_failure_rate` theo task | > 15% |
| `p95_latency` theo task | > 90s |
| `truncated_rate` (§6.4) | > 5% |
| `model_server_availability` | < 99% |
| `degraded_analysis_rate` | > 10% |
| `cloud_cost_usd_daily` | luôn = 0 ở GĐ1 |

Mọi lời gọi ghi vào `llm_calls`. Dashboard đọc thẳng từ Postgres — không cần thêm hạ tầng.

### 13.2 Bộ đánh giá

```
eval/
├── cv/        50 CV thật đã ẩn danh (30 vi, 20 en)
├── jd/        20 JD thật (12 vi, 8 en)
├── golden/    Profile JSON đúng, do người gán nhãn
└── run.ts     chạy + so sánh + báo cáo
```

**Metric:**

| Task | Đo gì |
|---|---|
| `parse_cv_to_profile` | field-level accuracy (precision/recall theo từng key) |
| `parse_jd` | requirement extraction F1 |
| `score_match` | tương quan Spearman với xếp hạng của HR |
| `gap_analysis` | HR chấm 1-5 trên tính hữu ích + tính đúng |
| `propose_patch` | tỉ lệ op được user accept |

**Cổng đổi tuyến model** (`config.yml → observability.eval.gate`): `field_accuracy ≥ 0.95 × baseline` · `schema_valid ≥ 0.90` · `escalate_rate ≤ 0.10`.

> Bộ eval phải có **trước** M1. Không có nó thì mọi tinh chỉnh prompt là mò mẫm, và không có cơ sở nào để quyết định khi nào cần bật cloud.

---

## 14. Năng lực hệ thống

### 14.1 Tính toán từ số đo thực tế

```
Throughput          : ~35 token/giây (reasoner)
Slot                : 4 (dùng chung KV cache)
gap_analysis output : ~2,000 token  →  ~57 giây sinh
+ prefill ~7,300 token prompt       →  ~10-15 giây
────────────────────────────────────────────────
Một lần gap_analysis: ~70-75 giây
```

| Chỉ số | Giá trị |
|---|---|
| Phân tích/giờ (1 slot) | ~48 |
| Phân tích/giờ (4 slot, lý tưởng) | ~190 |
| Thực tế (tranh chấp KV cache, dùng chung GPU với 109 container) | **~60-100** |
| User đồng thời thoải mái | **3-5** |

### 14.2 Hệ quả sản phẩm

> **Cấu hình hiện tại phục vụ được pilot/demo, KHÔNG phục vụ được ra mắt công khai.**

Phải nói rõ điều này với stakeholder từ đầu. Kế hoạch:

- **GĐ1 (bây giờ):** beta giới hạn, có waitlist, ~50-100 user. Đủ để thu thập eval data và feedback.
- **GĐ2 (sau gọi vốn):** bật `anthropic.enabled: true` cho `gap_analysis` + `rewrite_bullet` → giới hạn throughput biến mất ngay lập tức, vì phần nặng nhất chuyển sang cloud.

Đây chính là lý do kiến trúc cloud-ready phải làm từ đầu chứ không phải làm sau.

### 14.3 Bắt buộc về UX do throughput thấp

1. **Streaming mọi thứ.** 70 giây chờ màn hình trắng là không chấp nhận được. SSE + hiển thị dần.
2. **Hàng đợi có vị trí.** "Bạn đang ở vị trí thứ 3, ước tính 2 phút."
3. **Chạy nền + thông báo.** User đóng tab vẫn phải nhận được kết quả.
4. **Cache mạnh.** Cùng (cvRevision, jdId) → trả kết quả cũ, không chạy lại.

---

## 15. Bảo mật & PII

### 15.1 Phân loại dữ liệu

| Mức | Dữ liệu | Xử lý |
|---|---|---|
| 🔴 PII trực tiếp | Họ tên, SĐT, email, địa chỉ, ngày sinh, ảnh | Mã hóa at-rest · **không gửi model** · xóa được |
| 🟠 PII gián tiếp | Trường học, công ty, năm tốt nghiệp | Lưu bình thường, có trong Profile gửi model |
| 🟢 Không nhạy cảm | Kỹ năng, công nghệ, mô tả dự án | Tự do |

### 15.2 Quy tắc cứng

```
R1. Trước MỌI lời gọi model (kể cả local), Profile phải đi qua stripPII().
    Model không cần biết tên/SĐT/địa chỉ để đánh giá CV.

R2. `redact_pii` có required_local: true — local chết thì FAIL, không fallback
    cloud. Fallback ở đây đồng nghĩa với việc gửi PII thô ra ngoài.

R3. File PDF gốc xóa sau 48 giờ. Chỉ giữ Profile đã chuẩn hóa.
    Hiện thực: `services/worker/src/retention.ts`, chạy mỗi giờ + ngay khi
    worker khởi động. Khoá lưu trữ là sha256 NỘI DUNG nên hai người tải cùng
    một file sẽ trùng khoá — chỉ xoá khi không còn job nào chưa dọn dùng chung.
    Xoá lỗi thì KHÔNG đánh dấu, để lượt sau thử lại.

R4. Có nút xóa tài khoản → xóa cascade toàn bộ, kể cả file storage.

R5. Ghi rõ trong Privacy Policy: dữ liệu không dùng để train model.

R6. llm_calls KHÔNG lưu nội dung prompt/response — chỉ lưu metric.
    Cần debug thì bật sampling có kiểm soát, TTL ngắn.
```

### 15.2.1 Che PII phải được ĐO trên CV thật, không chỉ có test

> Bổ sung sau khi chạy lớp che PII lên 6 CV thật (M2-3).

Bộ regex ban đầu qua hết test tự viết nhưng **để lọt PII trên 2/6 CV thật**.
Ví dụ dưới đây là dữ liệu TỔNG HỢP giữ nguyên hình dạng — không phải PII thật
(chính quy tắc R8 bên dưới cấm ghi PII thật vào tài liệu được commit):

| Trường | Bỏ sót | Nguyên nhân |
|---|---|---|
| `PHONE` | `(+84) 912345678`, `+84 987654321` | regex đòi chữ số mạng đứng NGAY sau mã nước; ngoặc hoặc dấu cách xen vào là trượt |
| `NAME` | `Y THUY LINH TRAN` | `[\p{L}']+` đòi âm tiết ≥2 chữ; tên Việt có âm tiết một chữ ("Y", "Á", "Ý") |

Và **che nhầm** trên 1/6:

| Trường | Che nhầm | Hậu quả |
|---|---|---|
| `LOCATION` | `Q15` trong `Q15ABCDEF0GH` (mã theo dõi LinkedIn) | nuốt luôn 40 ký tự URL kế bên → mất nội dung thật gửi model |

**Quy tắc bổ sung:**

| # | Quy tắc |
|---|---|
| R7 | Mỗi lần sửa regex PII, phải chạy lại trên **toàn bộ** `eval/cv/*.pdf` và đối chiếu bằng mắt |
| R8 | Fixture test dùng dữ liệu **tổng hợp cùng hình dạng**, không bao giờ commit PII thật |
| R9 | **Che thừa cũng là lỗi**, ngang với bỏ sót — nó cắt mất nội dung model cần |
| R10 | Viết tắt mơ hồ (`Q4`, `P3`, `H2`) mặc định KHÔNG coi là địa chỉ; chỉ dạng có dấu chấm (`Q.7`) mới tính |
| R11 | **Lớp che và guard dùng CHUNG một bộ mẫu** (`packages/ai/src/patterns.ts`) |

**Vì sao R11:** guard trong `pii.ts` từng có bản sao regex riêng, yếu hơn —
`(?:\+?84|0)[35789]\d{8}` đòi chữ số mạng đứng ngay sau mã nước. Nó bỏ sót
đúng hai dạng mà lớp che vừa học cách bắt. Một hàng phòng thủ cuối chỉ bắt được
thứ lớp trước đã bắt thì không phòng thủ gì cả.

### 15.3 Đường mạng

Model server chỉ tiếp cận được qua Tailscale. Không expose ra Internet. Ứng dụng deploy trên máy dev → cũng cần Tailscale hoặc VPN khi triển khai thật.

---

## 16. Rủi ro

| # | Rủi ro | Mức | Xử lý |
|---|---|---|---|
| R1 | **Model server chết vĩnh viễn** (driver mismatch, ai đó restart) | 🔴 **ĐÃ XẢY RA** | `local.ocr` (:5012) chết 2026-08-07 do payload ảnh quá lớn, **không khởi động lại được** vì driver mismatch. 5/6 model còn sống. Đường OCR hoãn tới khi có cửa sổ reboot. Xem §2.6 |
| R2 | **Throughput không đủ khi có traffic** | 🔴 | Waitlist ngay từ đầu · hàng đợi minh bạch · cache · kế hoạch bật cloud (§14.2) |
| R3 | **Không có nguồn KB thật** | 🔴 | Seed mẫu để mời HR phản biện (§10.6). Không có HR thật thì sản phẩm mất moat |
| R4 | Context 16384 không đủ cho CV dài | 🟠 | §6.4 nén → chia nhỏ task → báo user. Không cắt âm thầm |
| R5 | Qwen3.5-4B chất lượng gap analysis chưa đạt | 🟠 | Eval trước khi cam kết. Nếu không đạt → bật cloud sớm hơn kế hoạch |
| R6 | Parse CV 2 cột sai | 🟠 | Đường ảnh + LightOnOCR · màn hình review bắt buộc |
| R7 | AI bịa kinh nghiệm | 🟠 | `grounding` bắt buộc · `_meta.verified` · UI không tick sẵn op `inference` |
| R8 | Máy dev là điểm chết duy nhất | 🟡 | Backup DB định kỳ · docker-compose tái tạo được · code trong git |
| R9 | Prompt injection qua KB | 🟡 | §10.5 |

---

## 17. Milestone & tiêu chí nghiệm thu

| M | Nội dung | Tiêu chí nghiệm thu | Ước tính |
|---|---|---|---|
| **M0** | Model Gateway · schema validation · budget manager · health/breaker · eval harness · docker-compose | `run('parse_jd', ...)` chạy được từ CLI, có log `CallMeta`. Tắt Tailscale → breaker mở, không sập. `eval/run.ts` chạy được trên 5 mẫu | 1.5 tuần |
| **M1** | Profile CRUD · template mức A · preview · export 2 bản | Nhập tay → PDF tiếng Việt có dấu đúng, bản ATS-safe 1 cột. Không cần LLM | 2 tuần |
| **M2** | Upload PDF · pdfkit · OCR · redact PII · màn hình review | 20 CV mẫu: ≥90% field đúng sau review. PII không xuất hiện trong `llm_calls` | 2 tuần |
| **M3** | JD parse · matching hybrid · gap report | Score deterministic (chạy 3 lần ra cùng kết quả). Mỗi match có evidence. Tắt embedder → degrade đúng | 1.5 tuần |
| **M4** | Chat · insight mining · propose patch · diff UI | Patch không hợp lệ không apply được. Undo/redo hoạt động. Op `inference` không tick sẵn | 2 tuần |
| **M5** | KB: upload · curator UI · SQL selector · citation | Lời khuyên có kbRefs hiển thị nguồn. Lời khuyên không nguồn gắn nhãn khác. Seed được HR duyệt ≥1 rubric | 1.5 tuần |
| — | **Bản chạy được, chi phí LLM = $0** | | **~10.5 tuần** |
| M6 | Template mức B (2 cột) | Bản trình bày 2 cột + ATS-safe vẫn 1 cột, cùng nguồn dữ liệu | 3 tuần |
| M7 | Bật cloud sau gọi vốn | Đổi `config.yml`, **0 dòng code nghiệp vụ thay đổi**, eval cho thấy chất lượng tăng | 0.5 tuần |

### 17.1 Đường găng

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5
 │                     ▲
 └── eval harness ─────┘   (M3 trở đi cần eval để quyết định)

KB seed → mời HR review  ← chạy SONG SONG từ M0, không chờ M5.
                            Đây là việc dài nhất về mặt con người.
```

**Cảnh báo lịch trình:** tìm và thuyết phục HR đóng góp KB có thể mất nhiều thời gian hơn toàn bộ M5. Bắt đầu từ tuần đầu tiên.

---

## Phụ lục A — Lệnh kiểm tra nhanh model server

```bash
# Danh sách model
for p in 5010 5011 5012 5013 5014; do
  echo "--- :$p"; curl -s -m5 http://100.68.50.41:$p/v1/models | head -c 200; echo
done

# Embedder (API riêng!)
curl -s http://100.68.50.41:8003/model-info
curl -s -X POST http://100.68.50.41:8003/embed \
  -H 'Content-Type: application/json' -d '{"text":"ReactJS"}' | head -c 120

# Reranker
curl -s -X POST http://100.68.50.41:5014/v1/rerank \
  -H 'Content-Type: application/json' \
  -d '{"query":"React developer","documents":["SPA bằng ReactJS","Nấu ăn"],"top_n":2}'

# Đếm token (dùng cho budget)
curl -s -X POST http://100.68.50.41:5011/tokenize \
  -H 'Content-Type: application/json' -d '{"content":"..."}' | python3 -c \
  "import sys,json;print(len(json.load(sys.stdin)['tokens']))"

# Kiểm tra context còn nhận được bao nhiêu
curl -s http://100.68.50.41:5011/props | python3 -m json.tool | head -20
```

## Phụ lục B — Quyết định kiến trúc đã chốt

| # | Quyết định | Ngày |
|---|---|---|
| D1 | Tách Profile (data) khỏi CVDocument (presentation) | 2026-08-06 |
| D2 | AI đề xuất JSON Patch, user duyệt từng op | 2026-08-06 |
| D3 | Điểm matching tính bằng code, LLM chỉ diễn giải | 2026-08-06 |
| D4 | Không RAG ở GĐ1 — SQL filter + context injection | 2026-08-06 |
| D5 | Rubric là structured data, không embed | 2026-08-06 |
| D6 | Model server chỉ đọc — coi như dependency ngoài | 2026-08-06 |
| D7 | Ngân sách context làm việc 12,000 / 16,384 | 2026-08-06 |
| D8 | Template mức A ở MVP, mức B ở M6 | 2026-08-06 |
| D9 | Export 2 bản: trình bày + ATS-safe | 2026-08-06 |
| D10 | Song ngữ = 3 trục độc lập (UI / content / JD) | 2026-08-06 |
| D11 | Constrained decoding (`response_format: json_schema`) bật mặc định cho mọi task có schema — §5.4.1 | 2026-08-06 |
