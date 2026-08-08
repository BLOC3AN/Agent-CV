# Testcase — Go cutover

## Gate bắt buộc trước khi tắt Node

| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| CUT-01 | `go test ./...` | Pass, không test flaky |
| CUT-02 | Frontend typecheck/build | Pass |
| CUT-03 | Auth request → verify → logout | Session tạo/xoá đúng; token dùng lại bị từ chối |
| CUT-04 | Upload cùng PDF hai lần với hai `uploadId` | Hai job ID khác nhau; storage không ghi đè sai |
| CUT-05 | Upload PDF sai magic bytes | 415; không tạo job |
| CUT-06 | Upload vượt 12 MB | 413; không tạo job |
| CUT-07 | Job GET/DELETE/SSE | Trạng thái queued → cancelled hoặc terminal đúng contract |
| CUT-08 | Profile create/get | JSON và `language` giữ nguyên |
| CUT-09 | Profile patch/revision/undo | Dữ liệu quay đúng snapshot trước patch |
| CUT-10 | CV create/get/patch/delete | Snapshot, metadata và cascade xoá đúng |
| CUT-11 | Restart Go container giữa job | Job không mất trong PostgreSQL |
| CUT-12 | Redis restart | Không tạo job trùng; hệ thống báo queued/degraded rõ ràng |
| CUT-13 | Model server timeout | Job failed có mã lỗi; không kẹt running vô hạn |
| CUT-14 | PDF không có text layer | `NO_TEXT_LAYER`/manual rõ ràng; OCR/image branch ngoài phạm vi |
| CUT-15 | CV tiếng Anh | Prompt/result giữ `language=en`, không tự dịch sang tiếng Việt |
| CUT-16 | Patch AI chứa field cấm/PII | Bị reject, profile không đổi |
| CUT-17 | Hai request patch đồng thời | Không mất update; revision order xác định |
| CUT-18 | Canary lỗi 5xx/timeout | Routing fallback về Node, không mất session/job |
| CUT-19 | Rollback sau khi có job đang chạy | Không có job chạy song song hoặc bị tạo bản sao |
| CUT-20 | Đối soát dữ liệu sau cutover | Count/checksum profiles, CV, jobs, revisions khớp trước cutover |
| CUT-21 | Profile verify với path hợp lệ | `_meta.verified` cập nhật đúng, không tạo revision rỗng |
| CUT-22 | Profile revert tới revision | Profile quay về snapshot của revision, API trả lỗi rõ nếu revision không tồn tại |
| CUT-23 | Import complete khi job chưa done | 409, không tạo CV |
| CUT-24 | Import complete gọi lặp | Lần sau trả cùng CV, không tạo bản ghi thứ hai |
| CUT-25 | KB activate thiếu author | 422, nguồn vẫn không active |
| CUT-26 | KB citations chunk active | Trả source/author/text đúng language |
| CUT-27 | Xoá account sai confirmEmail | 400, dữ liệu không bị xoá |
| CUT-28 | Xoá account đúng email | Cascade users/profile/CV/session đúng, cookie bị xoá |
| CUT-29 | Analyze JD ngắn | 400, không tạo JD/job |
| CUT-30 | Analyze với CV không thuộc user | 404, không tạo job |
| CUT-31 | Analyze JD hợp lệ | Lưu JD, tạo `match_analysis` job, trả jobId ngay |
| CUT-32 | GET analyze chưa có kết quả | 200 với `ready=false` |
| CUT-33 | GET analyze đã có kết quả | Giữ nguyên score/matched/gaps/degraded |
| CUT-34 | Go worker parse PDF text layer | Job done, profile có name/email, language giữ theo CV |
| CUT-35 | Go worker PDF thiếu file | Job failed có `FILE_MISSING`, không chạy vô hạn |
| CUT-36 | Go worker match không có embedder | Job done, `degraded=true`, score keyword có thể giải thích |
| REAL-CV-01 | `var/storage/b8/...` — Le Thanh Hai | `done`, `language=en`, name/email nhận đúng |
| REAL-CV-02 | `var/storage/c3/...` — Quan Pham | `done`, `language=en`, name/email nhận đúng |
| REAL-CV-03 | `var/storage/cf/...` — Sơn Trịnh | `done`, `language=en`, name/email nhận đúng |
| REAL-CV-04 | `var/storage/d9/...` — Y Yen Nhi | `done`, `language=en`, name/email nhận đúng |
| REAL-CV-05 | Aptis/boarding/database-model trong storage | `failed/NO_CV_SECTIONS`, không tạo profile |
| CUT-37 | Proposal accept một phần | Chỉ op được chọn áp dụng, status `partial`, tạo revision `ai` |
| CUT-38 | Proposal reject toàn bộ | Profile không đổi, status `rejected` |
| CUT-39 | Proposal có index ngoài phạm vi | 422, proposal/profile không đổi |
| CUT-40 | Match job với embedding + reasoner + reranker | `go-semantic+reasoner`, `degraded=false`, advice chỉ dùng gapId hợp lệ |
| CUT-41 | Restart worker khi job đang running | Reaper đưa job về queued tối đa 3 attempts, không kẹt vô hạn |
| CUT-42 | Frontend với `GO_API_CUTOVER=true` | `/api/health`, auth, upload/job đi qua Go; UI vẫn render được |

## Lệnh kiểm tra tối thiểu

```bash
cd backend
go test ./...
./scripts/build-go-image.sh
cd ..
BUILDX_BUILDER=default ./backend/scripts/build-all.sh
docker compose -f backend/docker-compose.yml --env-file .env config --quiet
curl -fsS http://localhost:8080/api/health

# frontend cutover smoke test
GO_API_CUTOVER=true BUILDX_BUILDER=default docker compose -f backend/docker-compose.yml --env-file .env --profile full up -d --build web
curl -fsS http://localhost:3000/api/health
```

Không tắt Node chỉ vì các lệnh build pass; phải chạy hết CUT-03 đến CUT-36
trên database staging hoặc bản snapshot có thể khôi phục.
