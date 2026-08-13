# Deploy HR-Agent: backend trên Server AI, frontend trên VPS2

Ngày: 2026-08-13

## Mục tiêu

Đưa HR-Agent lên `https://cvguide.site`. Frontend chạy trên một VPS có IP
public; backend, worker và toàn bộ dữ liệu ở lại Server AI. Hai máy nối nhau
bằng NetBird, không mở cổng nào ra internet ngoài 80/443 trên VPS.

Ràng buộc dẫn dắt thiết kế: CV và JD là dữ liệu cá nhân (TDD §15, đã phản ánh
trong `.gitignore`). Chúng không được rời khỏi Server AI.

## Hiện trạng hạ tầng

Ba máy, đều đã khảo sát trực tiếp chứ không phải giả định.

| | Server AI (`staging-master`) | VPS2 | VPS1 |
|---|---|---|---|
| Vai trò | backend + dữ liệu | frontend + TLS | NetBird management |
| Public IP | không | `116.118.3.113` | `103.75.183.34` |
| NetBird IP | `100.82.195.220` | `100.82.161.60` | — |
| Khác | Tailscale `100.68.50.41`, LAN `192.168.1.87` | | |
| CPU / RAM | 56 core / 62GB (trống 31GB) | 2 vCPU / 1.9GB + swap 2GB | 1 vCPU / 981MB |
| Disk trống | 365GB | 36GB | 9.9GB |
| GPU | RTX 3060 12GB, **llama.cpp đã chiếm 11.4GB** | — | — |
| Đang gánh | k8s control-plane, ~30 container `neura`, 8 cloudflared tunnel | trống | NetBird server, 6 container |

Đường VPS2 → Server AI: **P2P, RTT 4.5ms**, đã đo `HTTP 200` xuyên tunnel tới
`100.82.195.220:18090`. Policy NetBird hiện tại đã cho phép, không cần thêm rule.

VPS1 **không thay đổi gì** trong lần deploy này.

## Kiến trúc

```
trình duyệt
    │ https://cvguide.site
    ▼
VPS2  nginx (TLS)  →  127.0.0.1:3000  container hr-web-spa
                                            │ /api/*  (proxy.ts)
                                            ▼
                                  NetBird  100.82.195.220:18090
                                            │
                                            ▼
Server AI   backend ──┬── postgres   (không publish)
                      ├── redis      (không publish)
                      └── pdfkit     (không publish)
            worker ───┘
            MODEL_HOST → 100.68.50.41 (chính máy này)
```

`/print/:cvId/pdf` chạy Chromium **trên VPS2**, trong cùng container frontend.
Đo được: container idle 20.7MB RAM, lên 147MB sau khi Chromium khởi động và giữ
mức đó (browser dùng chung, `print.tsx:99-108`). Trên 1.9GB RAM và 2 vCPU của
VPS2 thì thoải mái, và quan trọng là **VPS2 không chạy NetBird management** nên
Chromium chiếm CPU cũng không ảnh hưởng VPN của mạng.

### Vì sao frontend nằm trên VPS2 chứ không phải VPS1

VPS1 chỉ còn 469MB RAM trống và 1 vCPU, đồng thời là management server của
NetBird. Chromium thường trú 147MB ở đó là 31% RAM còn lại, và một lần render
chiếm gần trọn core duy nhất — hệ quả không phải app chậm mà là **VPN giật cho
mọi peer**. VPS2 gỡ bỏ hoàn toàn ràng buộc này.

### Bí mật không nằm trên máy có IP public

`web-spa` chỉ đọc ba biến: `PORT`, `BACKEND_URL`, `NODE_ENV` (xác minh bằng
`grep process.env.` trên `server.ts` và `src/`). Mọi biến khác mà
`docker-compose.yml` đang truyền cho nó — `DATABASE_URL`, `REDIS_URL`,
`AUTH_SECRET`, `MODEL_HOST`, `PDFKIT_URL`, `HR_CONFIG_PATH`, `STORAGE_ROOT` —
là cấu hình chết, sót lại từ thời còn Next API.

Nên `.env` của VPS2 **không chứa một secret nào**: không mật khẩu DB, không
`AUTH_SECRET`, không Google client secret. Máy hứng internet là máy biết ít
nhất. Đây là tính chất phải giữ, không phải tình cờ.

## Thay đổi trong repo

### 1. `backend/docker-compose.yml` — tham số hoá và cắt bớt

Bốn thay đổi, mỗi cái vì một lý do khác nhau:

**a. Bind mount viết cứng.** Bốn chỗ đang ghi thẳng
`/home/hailt/Desktop/HR-agent/data-deploy/...`, tức chỉ chạy được trên laptop.
Thay bằng `${DATA_ROOT:-../data-deploy}`.

**b. `postgres`, `redis`, `pdfkit` publish có tham số — không xoá hẳn.** Ý định
ban đầu là bỏ hẳn `ports:` vì chỉ `backend` và `worker` gọi chúng qua compose
network. Nhưng làm vậy sẽ **phá workflow dev**: `README.md` hướng dẫn chạy
`go run ./cmd/api` trên host, và `.env.example` trỏ `localhost:5433` /
`localhost:6380` — bỏ publish là mất đường đó.

Thay vào đó tham số hoá cả IP lẫn cổng, mặc định giữ nguyên hành vi dev:

```
postgres  ${PG_BIND:-0.0.0.0}:${PG_PORT:-5433}:5432
redis     ${REDIS_BIND:-0.0.0.0}:${REDIS_PORT:-6380}:6379
pdfkit    ${PDFKIT_BIND:-0.0.0.0}:${PDFKIT_PORT:-8100}:8000
```

Production đặt `*_BIND=127.0.0.1` (không ra khỏi máy, kể cả qua NetBird) và
cổng khác vì trên Server AI `5433` (neura-settings-db), `6380`, `8100`
(neura-mcp-server) và `8000` **đều đã bận**. Cổng production đã kiểm tra trống:
`15433`, `16380`, `18100`.

Comment ở đầu file hiện giải thích cách chọn 5433/6380 để tránh xung đột *trên
máy dev* — phải sửa lại cho khỏi gây hiểu nhầm khi đọc trên Server AI.

**c. `backend` publish có tham số.** `8080` cũng đã bận trên Server AI. Đổi
thành `${BACKEND_BIND:-0.0.0.0}:${BACKEND_PORT:-8080}:8080`, để production đặt
`BACKEND_BIND=100.82.195.220` và `BACKEND_PORT=18090`. Bind đúng IP NetBird
nghĩa là backend không nhìn thấy được từ LAN `192.168.1.0/24` lẫn internet.

**d. Bỏ mount `uploads` khỏi `web-spa`.** `src/server/` không hề đụng `fs`
(chỉ có `app.ts`, `print.tsx`, `proxy.ts`). Mount này thừa từ đầu, và khi tách
máy thì nó sai hẳn về mặt khái niệm.

### 2. `deploy/docker-compose.vps2.yml` — file mới

Chỉ một service `web-spa`, publish `127.0.0.1:3000:3000` (chỉ nginx gọi được),
với đúng ba biến nó thật sự đọc. Không `build:` — VPS2 chạy image dựng sẵn.

### 3. `.env` production

Hai file khác nhau, không dùng chung.

**Server AI** — `APP_BASE_URL=https://cvguide.site`, `PG_PASSWORD` và
`AUTH_SECRET` sinh ngẫu nhiên, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` lấy từ
`credential/cvguide_client_secret_*.json`, `MODEL_HOST=http://100.68.50.41`,
`NODE_ENV=production`, `BACKEND_BIND=100.82.195.220`, `BACKEND_PORT=18090`,
`DATA_ROOT=/srv/hr-agent/data`, và `PG_BIND`/`REDIS_BIND`/`PDFKIT_BIND` đều
`127.0.0.1` với cổng `15433`/`16380`/`18100`.

**Tuyệt đối không đặt `MAGIC_LINK_DEV`.** Cổng này hỏng-đóng (chỉ chuỗi `"true"`
mới mở), nhưng nếu mở thì bất kỳ ai gọi `/api/auth/request` cũng đăng nhập được
vào **bất kỳ tài khoản nào** — repo không có mailer nên endpoint trả thẳng token
ra response. Cũng để trống `GOOGLE_OAUTH_BASE`.

**VPS2** — `BACKEND_URL=http://100.82.195.220:18090`, `NODE_ENV=production`,
`PORT=3000`. Hết.

## Cấu hình ngoài repo (đã làm)

nginx trên VPS2 đã dựng xong, vhost tự viết chứ không để certbot sinh. Ba tuỳ
chọn không mặc định, mỗi cái vá một lỗi thật:

- `proxy_buffering off` cho cả `/api/`. Ba nhóm route trả `text/event-stream`:
  `/api/chat`, `/api/jobs/`, `/api/analyze/`. Còn buffer thì trình duyệt không
  nhận được sự kiện nào cho tới khi stream đóng — mà stream chat không tự đóng.
- `client_max_body_size 25m`. Mặc định 1MB chặn CV PDF và trả 413, trông như
  lỗi ứng dụng.
- `proxy_read_timeout 300s` cho `location /`, vì `/print/:cvId/pdf` chạy Chromium.

Cert Let's Encrypt phủ `cvguide.site` + `www.cvguide.site`, hạn 2026-11-11,
`certbot renew --dry-run` đã xác nhận gia hạn tự động chạy được.

Lưu ý vận hành: `certbot --nginx` có xu hướng tạo vhost mới trong
`sites-available/default` thay vì thêm tên vào vhost sẵn có — nó đã làm đúng
như vậy một lần và khiến `www` rơi vào trang mặc định của nginx. Sau mỗi lần
chạy certbot, kiểm tra lại `server_name`.

## Cách đưa image sang VPS2

VPS2 có 2 core; build Chromium ở đó chậm và tốn. Server AI có 56 core.

**Chọn: build trên Server AI, chuyển bằng `docker save | gzip | ssh | docker load`
qua NetBird.** Không cần credential registry, không đẩy artifact ra dịch vụ bên
ngoài. Image 2.08GB, nén lại còn khoảng 700MB–1GB.

Phương án thay thế khi số lần deploy tăng: đẩy lên Docker Hub (tài khoản
`vanhoadotbui2628` đã có sẵn và đang dùng cho các image `neura`). Nhanh hơn và
có versioning, đổi lại artifact nằm trên hạ tầng bên thứ ba. Ghi lại đây như
bước nâng cấp, không làm trong lần này.

## Rủi ro đã biết

**Tunnel NetBird là SPOF của cả trang.** Tunnel đứt thì nginx trả 502 cho mọi
thứ, kể cả trang login. Uptime của app bị chặn trên bởi uptime của NetBird — mà
NetBird management lại chạy trên VPS1, một máy 1 vCPU / 981MB đang gánh 6
container khác. Đây là mắt xích yếu nhất của toàn hệ thống.

**Session expiration của peer.** Peer đăng nhập bằng SSO mặc định hết hạn sau
~24h; hết hạn là VPS2 rớt khỏi NetBird và trang chết. Đã tắt cho VPS2. Bất kỳ
peer nào thêm sau này đều phải tắt tương tự.

**GPU đã bão hoà.** RTX 3060 12GB, llama.cpp đang chiếm 11.4GB. HR-Agent gọi
các model đã chạy sẵn (`config.yml` khai port 5011/5014/8003) nên không nạp
thêm trọng số, nhưng hàng đợi inference sẽ phải chia sẻ. `config.yml` đã ghi
`per_model_limits` với ghi chú "1 GPU 3060 dùng chung cho 5 model".

**Server AI đang gánh nhiều.** k8s control-plane, ~30 container, 8 cloudflared
tunnel. Thêm 5 container nữa. RAM còn 31GB nên dư, nhưng đây là máy production
của một hệ thống khác — sự cố ở HR-Agent có thể lan sang.

**Dữ liệu PII chưa có chính sách backup.** Postgres chứa CV thật, nằm ở
`${DATA_ROOT}/postgres` trên Server AI. Lần deploy này không giải quyết; phải
có kế hoạch riêng.

## Không làm trong phạm vi này

- **Giới hạn số render PDF song song.** `print.tsx:136-139` gọi
  `browser.newContext()` không qua cổng nào; một loạt request đồng thời sẽ mở
  bấy nhiêu context. Là lỗ hổng thật nhưng là thay đổi mã ứng dụng, tách spec riêng.
- **Cache PDF theo hash nội dung CV.** Giảm tải nhiều hơn bất kỳ tinh chỉnh nào
  khác trong vùng này, cũng để spec riêng.
- **Hàng đợi render bất đồng bộ.** Chỉ đáng làm khi có tính năng xuất hàng
  loạt; worker hiện là Go nên sẽ phải dựng thêm một service Node chuyên render.
- **Bản build slim không kèm Chromium.** Tiết kiệm ~1.4GB disk nhưng đẻ ra hai
  build target phải giữ đồng bộ. VPS2 còn 36GB, chưa cần.

## Tiêu chí hoàn thành

1. `https://cvguide.site` trả 200 và render được SPA.
2. `GET /api/health` qua domain trả 200 — chứng tỏ chuỗi nginx → container →
   NetBird → Go backend thông suốt.
3. Đăng nhập Google thành công, cookie phiên có cờ `Secure`.
4. Upload một CV PDF, job chạy xong, kết quả parse hiện ra.
5. Chat trả lời theo kiểu streaming — chứng tỏ SSE không bị nginx buffer.
6. Tải PDF từ `/print/:cvId/pdf` ra file có text layer.
7. `docker compose ps` trên Server AI: 5 service khoẻ; trên VPS2: 1 service khoẻ.
8. Không cổng nào của Server AI lộ ngoài NetBird: `ss -tln` không có
   `0.0.0.0:18090`.
