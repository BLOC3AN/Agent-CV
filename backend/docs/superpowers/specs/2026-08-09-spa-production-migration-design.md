# Spec — Đưa SPA mới lên production, thay Next.js

| | |
|---|---|
| **Ngày** | 2026-08-09 |
| **Trạng thái** | Đã duyệt thiết kế, chưa triển khai |
| **Phạm vi** | Toàn bộ frontend runtime + schema dữ liệu + các endpoint Go phụ thuộc schema |
| **Thay thế** | [2026-08-09-chat-to-cv-workspace.md](./2026-08-09-chat-to-cv-workspace.md) — spec đó port giao diện tham chiếu **vào** Next; spec này đi hướng ngược lại |
| **Liên quan** | [TDD.md](../../TDD.md) · [FRONTEND.md](../../FRONTEND.md) · [USECASES.md](../../USECASES.md) · [TESTCASES.md](../../TESTCASES.md) · [config.yml](../../../../config.yml) |

---

## 0. Bối cảnh và quyết định

Hai frontend đang chạy song song trên máy dev:

| | `:3000` production | `:3001` bản mới |
|---|---|---|
| Code | `frontend/apps/web` — Next 15 App Router | `frontend/FRONTEND_NEW` — Vite + React 19 SPA, Express |
| Gọi backend | `middleware.ts` rewrite toàn bộ `/api/*` sang Go `:8080` | Chỉ proxy `/api/ai/*`; phần còn lại gọi thẳng Gemini trong `server.ts` |
| Dữ liệu | Postgres + phiên đăng nhập + hàng đợi job | `useState` + `src/mockData.ts`, mất sạch khi tải lại trang |
| Test | 25 file vitest | 0 |

Chủ sản phẩm đã kiểm chứng và duyệt giao diện bản mới. Ba quyết định đã chốt:

1. **SPA mới trở thành runtime production.** `frontend/apps/web` bị gỡ bỏ sau cutover.
2. **Giữ renderer của UI mới.** `frontend/packages/templates` bị gỡ bỏ. Bản in dựng bằng SSR chính các component của UI mới, Playwright chụp thành PDF.
3. **Đổi schema backend sang kiểu dữ liệu của UI mới** (CV v2), kèm migration và backfill, thay vì dựng lớp adapter ở biên.

Phạm vi là **parity đầy đủ UC-01…UC-72**. Các màn hình bản mới chưa có (rà soát import, duyệt diff patch, KB curator, guided flow, chuyển ngữ vi/en) được vẽ mới theo ngôn ngữ thiết kế của UI mới.

### 0.1 Cái giá phải trả, nói rõ từ đầu

Ba quyết định trên đều chọn phương án **đắt hơn nhưng đúng ý đồ sản phẩm hơn**. Ghi lại để sau này không ai phải đoán:

- Bỏ `packages/templates` nghĩa là phải **viết mới biến thể `ats` và `thumbnail`** — chúng không phải là "modern/classic/professional đổi màu", mà là hai yêu cầu kỹ thuật khác hẳn (§5.3).
- Đổi schema nghĩa là **động vào dữ liệu đang có**. Đường lùi migration là bắt buộc và phải được test, không phải tuỳ chọn (§7).
- Thay Next nghĩa là **mất 25 file test đang xanh**. Phần test là hàm thuần được port sang; phần test component phải viết lại (§6).

---

## 1. Kiến trúc đích

```
                            :3000  (production sau cutover)
frontend/apps/web-spa/            ← đổi tên từ FRONTEND_NEW, gia nhập npm workspace
  src/routes/                     react-router, deep-link thật, mỗi màn hình một URL
  src/cv/templates/               renderer UI mới: modern · classic · professional
                                  + ats + thumbnail (viết mới)
  src/lib/api.ts                  client gọi Go, thay toàn bộ mockData
  src/lib/auth.ts                 đọc/ghi cookie phiên, guard route
  server.ts                       CHỈ còn ba việc:
                                    1. phục vụ file tĩnh
                                    2. SSR route /print cho Playwright
                                    3. proxy /api/* → Go :8080
                                  (gỡ sạch @google/genai)
                                        │
                                        ▼
backend/ (Go)               :8080  giữ nguyên đường dẫn của 25 endpoint,
                                   đổi payload sang CV v2,
                                   viết lại export PDF
frontend/apps/web/                gỡ bỏ sau cutover
frontend/packages/templates/      gỡ bỏ
frontend/packages/schema/         giữ, viết lại thành CV v2
```

### 1.1 Ranh giới trách nhiệm

| Đơn vị | Làm gì | Phụ thuộc vào |
|---|---|---|
| `src/lib/api.ts` | Một hàm cho mỗi endpoint Go. Nơi duy nhất biết đường dẫn HTTP. | kiểu CV v2 |
| `src/lib/auth.ts` | Trạng thái phiên, chuyển hướng khi 401. | `api.ts` |
| `src/cv/templates/*` | Nhận CV v2 + `variant`, trả React tree. **Hàm thuần, không fetch, không state.** | kiểu CV v2 |
| `src/routes/*` | Bố cục màn hình, gọi `api.ts`. Không tự dựng URL API. | `api.ts`, templates |
| `server.ts` | Tĩnh + SSR `/print` + proxy. **Không có logic nghiệp vụ, không gọi model.** | — |

Ràng buộc quan trọng nhất: **template là hàm thuần**. Đó là điều kiện để cùng một component chạy được ở trình duyệt (xem trước) và ở Node (SSR để in), và là lý do bản xem trước khớp file PDF.

### 1.2 Thư mục và workspace

`frontend/FRONTEND_NEW` được `git mv` sang `frontend/apps/web-spa`, thêm vào `workspaces` của `frontend/package.json` (đã có sẵn pattern `apps/*`). Hai file zip `frontend/FRONTEND_NEW.zip` và `frontend/hr-agent---ai-cv-builder-&-job-matcher (1).zip` bị xoá khỏi cây làm việc — chúng là bản tải về, không phải nguồn.

---

## 2. Schema CV v2

### 2.1 Hình dạng

`packages/schema` được viết lại quanh kiểu của UI mới, cộng thêm những gì backend bắt buộc phải có:

```ts
CVSchema = {
  schemaVersion: 2,
  id, title, lastModified,
  language: 'vi' | 'en',
  sections: {
    intro:          IntroSection,
    experience:     ExperienceItem[],
    projects:       ProjectItem[],
    education:      EducationItem[],
    skills:         SkillItem[],
    activities:     ActivityItem[],
    certifications: CertificationItem[],
    languages:      LanguageItem[],
  },
  design:         { template, accentColor, font, fontSize, spacing },
  activeSections: { intro, experience, projects, education,
                    skills, activities, certifications, languages },  // bool
  _meta:          { verified: Record<JSONPointer, boolean>, source },
}
```

`design` và `activeSections` trước đây nằm rải ở `cv_documents.theme` / `cv_documents.layout`; v2 gom chúng vào chính tài liệu CV.

### 2.2 Ba thứ bắt buộc phải thêm vào kiểu `CV` của UI mới

Kiểu `CV` trong `FRONTEND_NEW/src/types.ts` **không đủ** để làm schema chính thức. Ba chỗ dưới đây nếu bê nguyên sẽ làm vỡ nguyên tắc sản phẩm, không phải chỉ gây bất tiện.

**(1) `_meta.verified` — xương sống chống bịa.**
`ProfileSchema._meta.verified` là map JSON Pointer → bool. Mọi nội dung do AI sinh ra là `false` cho tới khi người dùng xác nhận. Đây là thứ khiến UC-22 (rà soát bắt buộc) và UC-53 (duyệt đề xuất) có ý nghĩa; bỏ nó đi thì hệ thống không còn phân biệt được dữ kiện người dùng khai với dữ kiện model đoán. Kiểu `CV` mới không có khái niệm này, phải thêm.

**(2) `PII_PATHS` phải viết lại theo đường dẫn v2.**
Hiện là `/basics/name`, `/basics/email`, `/basics/phone`, `/basics/location`, `/basics/dob`, `/basics/photo`. `redact_pii` trong `config.yml` khai `required_local: true` và không bao giờ được fallback ra cloud — cơ chế đó bám vào đúng danh sách này. V2 phải khai:

```
/sections/intro/fullName
/sections/intro/email
/sections/intro/phone
/sections/intro/location
/sections/intro/avatarUrl
```

Quên bước này thì PII đi thẳng tới provider cloud và **không có lỗi nào được ném ra** — hỏng im lặng, đúng loại lỗi tệ nhất.

**(3) `description: string` phải đổi thành `highlights: string[]`.**
Đây là sửa ở UI, không phải ở schema. Chat sinh JSON Patch nhắm vào một gạch đầu dòng cụ thể (`/sections/experience/0/highlights/2`). Nếu kinh nghiệm và dự án chỉ là một chuỗi văn bản như `ExperienceItem.description` và `ProjectItem.description` hiện nay, mọi đề xuất của AI biến thành ghi đè nguyên khối, và màn hình duyệt diff không còn gì đáng để duyệt — người dùng chỉ thấy "toàn bộ đoạn cũ" đổi thành "toàn bộ đoạn mới".

Hệ quả cụ thể: các ô `<textarea>` mô tả trong `CVEditorView.tsx` trở thành danh sách bullet sửa được từng dòng, thêm/xoá/kéo thả từng dòng. Đây là thay đổi giao diện duy nhất của spec này chạm vào bản đã được duyệt, và nó là bắt buộc.

### 2.3 Ánh xạ v1 → v2

| ProfileSchema v1 | CV v2 | Ghi chú |
|---|---|---|
| `basics.name` | `sections.intro.fullName` | |
| `basics.headline` | `sections.intro.title` | |
| `basics.introduce` | `sections.intro.summary` | |
| `basics.email/phone/location/photo` | `sections.intro.email/phone/location/avatarUrl` | PII |
| `basics.links[]` | `sections.intro.website` | v1 là mảng, v2 là một chuỗi → **lấy link đầu, ghi phần còn lại vào `_meta.droppedLinks`** để không mất dữ liệu |
| `basics.dob` | — | v2 không hiển thị ngày sinh; giữ trong `_meta.droppedFields` |
| `work[]` | `sections.experience[]` | `org→company`, `role→title`, `highlights→highlights` |
| `education[]` | `sections.education[]` | `major→fieldOfStudy` |
| `projects[]` | `sections.projects[]` | `url→link`, `tech[]` gộp vào `highlights` đầu |
| `skills[]` (phẳng, có `group`) | `sections.skills[]` (gộp theo `category`) | gom theo `group`; `canonical` giữ trong `_meta.canonical` vì **lớp đối chiếu JD vẫn dùng nó** (BR-57.1) |
| `activities[]`, `certifications[]`, `languages[]` | tương ứng | đổi tên field |
| `_meta.verified` | `_meta.verified` | **phải dịch cả key JSON Pointer**, không chỉ copy |

Hai chỗ mất mát dữ liệu (`links[]` và `dob`) được ghi vào `_meta` thay vì vứt đi. Đó là điều kiện để đường lùi v2→v1 khôi phục được nguyên trạng.

### 2.4 Migration

- `backend/db/migrations/010_cv_schema_v2.sql` — thêm cột/ràng buộc, không xoá gì ở bước này.
- Script backfill `profiles.data` và `cv_documents` v1→v2: **idempotent**, chạy lại nhiều lần cho cùng kết quả.
- Đường lùi v2→v1 viết cùng lúc, không để sau.
- Golden test: một tập bản ghi thật (đã ẩn danh) chạy v1→v2→v1 phải khớp byte-for-byte trừ các field đã khai là mất mát có chủ đích.

---

## 3. Backend Go phải sửa những gì

| Việc | Vị trí | Vì sao |
|---|---|---|
| Viết lại prompt `propose_patch` và `parse_cv_to_profile` | `internal/api/server.go:1688` | Prompt đang dạy model sinh pointer `/basics/introduce`; ở v2 mọi pointer đó đều sai |
| Viết lại export PDF | `internal/api/server.go:262-285` | Hiện dựng PDF bằng `gofpdf` **đổ thẳng JSON hồ sơ ra giấy** — UC-31/32 coi như đã hỏng sẵn. Thay bằng: gọi Playwright render `SPA /print/:cvId?variant=…` |
| Sửa matching + KB citation | `cmd/worker/matching.go`, KB | Đang đọc `profile.work[].highlights`; đổi sang `sections.experience[].highlights` |
| Xoá `internal/api/compat_ai.go` | | Ba endpoint `/api/ai/{chat,quick-action,match-job}` chỉ là cầu tạm cho SPA khi còn dùng mock. SPA production dùng `/api/chat` SSE thật để có clarify và patch review. `lexicalMatch()` bị thay bằng `/api/analyze` thật. |
| Cập nhật `server_test.go` và test Go | | Theo v2 |

Backend hiện khai 28 endpoint (`server.go:74-102`). Ba endpoint compat bị xoá, 25 endpoint còn lại **giữ nguyên đường dẫn và động từ HTTP**; chỉ payload đổi.

### 3.1 Xác thực

Giữ nguyên magic link: `POST /api/auth/request` → email → `GET /api/auth/verify` → cookie `hr_session`. SPA không tự quản lý token; nó chỉ đọc trạng thái qua `GET /api/health` + lỗi 401, và chuyển hướng tới `/login`. Cờ `ALLOW_DEV_USER` giữ nguyên ngữ nghĩa.

---

## 4. Config, môi trường và bảo mật

**Gỡ `@google/genai` và `GEMINI_API_KEY` khỏi `server.ts`.** Hai vi phạm hiện tại biến mất theo:

1. Gemini không có trong `providers` của `config.yml` — mọi lời gọi model phải đi qua `routing`, có timeout, circuit breaker và ghi log theo `observability.log_per_call`.
2. `server.ts` đang gửi nguyên `cvData` (chứa tên, email, số điện thoại) lên cloud, trái `redact_pii.required_local: true` và `knowledge_base.guardrails` / `anthropic.guardrails.never_send_raw_pii`.

Biến môi trường của SPA:

| Biến | Ý nghĩa |
|---|---|
| `PORT` | 3000 ở production |
| `BACKEND_URL` | mặc định `http://backend:8080` trong compose |
| `NODE_ENV` | `production` bật nhánh phục vụ file tĩnh |
| `STORAGE_ROOT` | dùng chung volume `uploads` với worker Go |

`docker-compose.yml`: service `web` đổi `dockerfile` sang `frontend/apps/web-spa/Dockerfile`, giữ nguyên `ports: 3000:3000`, giữ healthcheck `GET /api/health`, giữ `depends_on` và volume `uploads`.

---

## 5. Phân rã: năm sub-project

Phạm vi này quá lớn cho một plan. Mỗi sub-project có spec riêng nếu cần, plan riêng, và **kết thúc ở trạng thái chạy được** — không có sub-project nào để lại hệ thống nửa vời.

| | Sub-project | Nội dung | Xong khi |
|---|---|---|---|
| **SP-1** | Nền tảng SPA production | `git mv` vào workspace; react-router + deep-link; `lib/api.ts` thay mockData; `lib/auth.ts` + guard; Dockerfile; gỡ `@google/genai`; dựng bộ test | SPA chạy `:3002`, đăng nhập thật, liệt kê CV thật từ Postgres |
| **SP-2** | Schema v2 | `packages/schema` viết lại; `_meta` + PII paths + `highlights[]`; migration 010 + backfill + đường lùi + golden test; sửa prompt, matching, test Go | `go test ./...` xanh trên v2; backfill chạy được cả hai chiều |
| **SP-3** | Dữ liệu thật | CV CRUD; upload PDF + polling job; **màn hình rà soát bắt buộc**; danh sách/xoá; settings; xoá tài khoản | UC-11/12/13/21/22/23/24/34 chạy được đầu-cuối |
| **SP-4** | AI | chat SSE; clarify form; **duyệt diff patch**; analyze JD thật; trích dẫn KB; degrade banner | UC-41/42/51…57/63/71/72 chạy được, và tắt model server thì UI vẫn dùng được |
| **SP-5** | Xuất bản & cutover | SSR `/print`; biến thể `ats` + `thumbnail`; Playwright; KB curator; i18n vi/en; guided flow; cutover 3001→3000 + rollback | UC-01…05/31/32/33/61/62 xong; `:3000` là SPA; Next đã gỡ |

### 5.1 Bản đồ màn hình mới

`FRONTEND_NEW` hiện chuyển màn hình bằng `useState<ViewTab>`, không có URL. Bản đồ URL đích, giữ tương thích với `FRONTEND.md` §2 để link cũ không chết:

| URL | Nguồn | Trạng thái |
|---|---|---|
| `/` | `DashboardView` | có, cần nối 3 trạng thái Home (UC-01/02/03) |
| `/login` | — | **vẽ mới** |
| `/cv` | `MyCVsView` | có |
| `/cv/new` | — | **vẽ mới** (UC-23) |
| `/builder/:cvId` | `CVEditorView` | có, cần đổi textarea → bullet |
| `/analyze/:cvId` | `JobMatchView` | có, cần nối `/api/analyze` thật |
| `/diagnose/:cvId` | — | **vẽ mới** (UC-04) |
| `/import`, `/import/:jobId/review` | `UploadModal` (giả) | **vẽ mới**, review là bắt buộc (UC-21/22) |
| `/start/guided` | — | **vẽ mới** (UC-05) |
| `/templates` | `TemplatesView` | có |
| `/settings` | `SettingsView` | có, cần nối xoá tài khoản |
| `/kb` | — | **vẽ mới** (UC-61/62) |
| `/print/:cvId?variant=` | — | **vẽ mới**, SSR, không hiện với người dùng |

`AIAssistantView` không thành một URL riêng: nó trở thành panel chat gắn với `/builder/:cvId`, đúng như `FRONTEND.md` §3.1 và spec workspace ngày 2026-08-09 mô tả. Trợ lý tách rời khỏi CV thì không đề xuất patch có ngữ cảnh được.

### 5.2 Suy giảm khi AI chết (UC-71)

Mọi màn hình phải dùng được khi model server tắt. Cụ thể: sửa CV, đổi mẫu, xuất PDF, xem CV cũ đều **không** phụ thuộc model. Chỉ chat, gap analysis và đối chiếu JD hiện trạng thái suy giảm. Không có màn hình lỗi trắng.

### 5.3 Biến thể bản in

Bỏ `packages/templates` nghĩa là phải viết mới hai biến thể, và chúng không phải là đổi màu:

- **`ats`** — một cột, không màu nền, không icon, không bảng, không chữ trong ảnh; heading dùng đúng từ khoá mà máy quét CV tìm. Mục tiêu là **máy đọc được**, không phải đẹp.
- **`thumbnail`** — render nhỏ, không chữ đọc được, dùng cho thẻ CV ở `/cv`. Sinh phía server và cache, không dựng lại mỗi lần mở danh sách.

---

## 6. Kiểm thử

### 6.1 Di sản test hiện có

25 file test của `apps/web` không chạy lại trực tiếp được vì chúng dựng component Next. Nhưng phần **logic** thì port gần như nguyên vẹn, vì đó là hàm thuần: `home-state`, `intent`, `guided`, `health`, `editor-store`, `assistant-workspace`. Phần test component (`*.ui.test.tsx`) viết lại theo component mới.

### 6.2 Tầng test của hệ mới

| Tầng | Nội dung | Chạy bằng |
|---|---|---|
| Unit | ánh xạ v1↔v2, `home-state`, `intent`, `health`, chuẩn hoá kỹ năng | vitest |
| Component | mỗi màn hình trong bản đồ §5.1, gồm trạng thái rỗng, đang tải, lỗi và suy giảm | vitest + testing-library |
| Golden | migration v1→v2→v1 trên tập bản ghi thật đã ẩn danh | vitest |
| Contract | mỗi endpoint Go còn lại: SPA gửi gì, nhận gì, mã lỗi nào | vitest (integration) |
| Visual | `/print` × 3 template × 2 biến thể (`presentation`, `ats`) | Playwright |
| E2E | năm luồng chính (§6.3) | Playwright |
| Go | `go test ./...` sau khi đổi schema | go |

### 6.3 Năm luồng E2E bắt buộc

1. Đăng nhập magic link → dashboard rỗng → tạo CV tay → xuất PDF.
2. Upload PDF → chờ job → **màn hình rà soát** → xác nhận → builder.
3. Builder → chat hỏi → AI đề xuất patch → **duyệt diff** → áp dụng → hoàn tác.
4. Nhập JD → báo cáo đối chiếu → tạo bản CV riêng cho JD đó.
5. Tắt model server → mọi màn hình vẫn mở được, chat hiện trạng thái suy giảm, xuất PDF vẫn chạy.

### 6.4 Điều kiện chấp nhận toàn cục

- UC-01…UC-72 đều có ít nhất một test tự động phủ.
- `redact_pii` có test khẳng định không field nào trong `PII_PATHS` v2 rời khỏi máy chủ khi provider là cloud.
- Golden test migration xanh cả hai chiều.
- Bộ test cũ đã port sang vẫn xanh.

---

## 7. Cutover và đường lùi

1. SPA lên `:3002`, Next vẫn giữ `:3000`. Chạy song song trên **hai cơ sở dữ liệu tách biệt**: Next giữ DB v1, SPA dùng một bản sao đã backfill sang v2.
2. Chạy đủ bộ E2E §6.3 trên `:3002`.
3. Cửa sổ cutover: dừng ghi, backfill DB production v1→v2, đổi ánh xạ cổng để SPA nhận `:3000`, mở lại ghi.
4. Theo dõi.
5. Chỉ sau khi ổn định mới xoá `frontend/apps/web` và `frontend/packages/templates`.

Hai DB tách biệt ở bước 1 chứ không dùng chung: chạy song song trên cùng một DB thì hoặc Next phải biết đọc v2 — công sức đổ vào thứ sắp bị xoá — hoặc hai app ghi hai định dạng vào cùng một bảng.

**Rollback ở bước 4 là rollback cả frontend lẫn dữ liệu.** Trỏ lại container Next chỉ có tác dụng nếu chạy được migration lùi v2→v1 trên dữ liệu đã sinh ra trong lúc SPA phục vụ. Đường lùi đó phải tồn tại và phải được golden test phủ (§2.4) **trước** khi bước 3 bắt đầu — đây là điều kiện tiên quyết, không phải việc dọn dẹp sau.

---

## 8. Ngoài phạm vi

- Sửa driver NVIDIA và bật lại `local.ocr` (`config.yml` → `risks.gpu_driver_mismatch`). Luồng import vẫn chỉ xử lý PDF có text layer.
- Bật provider cloud. `cost_mode` giữ `local_only`.
- Đổi mật khẩu yếu trên staging-master (`risks.weak_credentials`) — việc hạ tầng, theo dõi riêng.
- Chuyển KB sang `hybrid_retrieval`. Giữ `context_injection` cho tới khi vượt ngưỡng token.
