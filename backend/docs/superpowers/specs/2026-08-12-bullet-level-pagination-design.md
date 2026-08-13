# Tách trang ở mức bullet & tách đôi `pageMargin`

Ngày: 2026-08-12

## Bối cảnh

Hai vấn đề độc lập, cùng nằm trong nhóm điều khiển "Khoảng cách trang" của trình soạn CV.

**1. Preview nhồi nguyên khối.** `CVPageComposer` đo chiều cao từng block rồi nhồi vào từng tờ A4. Đơn vị nhỏ nhất hiện là một item (một job, một project, một bằng cấp). Item nào không vừa chỗ còn lại thì nhảy nguyên khối sang trang sau, để lại một mảng trắng lớn ở cuối trang trước.

Đường in/PDF lại là một dòng chảy liên tục do trình duyệt tự ngắt, với `.cv-entry{break-inside:auto}` — **PDF vốn đã cắt giữa item**. Nên preview và PDF đang ngắt trang khác nhau. Thay đổi này kéo preview về khớp với PDF chứ không thêm hành vi mới.

**2. `pageMargin` mang hai nghĩa chồng nhau.** Trên preview nó là `marginBottom` của mỗi tờ giấy, tức khe hở giữa các trang trong vùng cuộn. Khi in, `buildPrintCSS` lại cộng nó vào padding để ra `@page margin`, tức nó thành lề giấy thật. Cùng một con số, hai ý nghĩa khác hẳn nhau; và vùng nội dung mà preview dùng để phân trang không trừ `pageMargin`, trong khi PDF thì có — nên hai bên lệch nhau đúng `2 × pageMargin`.

## Phần A — Tách trang ở mức bullet

### Mô hình

Giữ nguyên kiến trúc đo-rồi-xếp. Chỉ hạ đơn vị nhồi xuống một bậc.

Chuỗi `segments` trong `CVPageComposer` hiện là `nodeId`, hoặc `nodeId::itemId` với ba node tách được (`experience`, `projects`, `education`). Thêm bậc thứ ba cho ba node đó:

| Sub-segment | Nội dung |
|---|---|
| `nodeId::itemId::head` | Chức danh, tổ chức, ngày, team size, tech stack, link, contribution, GPA — mọi thứ trong item trừ danh sách gạch đầu dòng |
| `nodeId::itemId::h<i>` | Gạch đầu dòng thứ `i` (0-based) trong `highlights` |

Item không có `highlights` chỉ sinh ra `head`, tương đương hành vi hiện tại.

### Đo chiều cao

Vẫn đo trên khối DOM ẩn `measurementRef`, thêm một bậc truy vấn:

- `head` = `getBoundingClientRect().height` của `[data-cv-item-id]` **trừ** chiều cao của `ul.cv-bullets` bên trong nó (nếu có).
- `h<i>` = chiều cao của `li` thứ `i` trong `ul.cv-bullets` đó.

`getBoundingClientRect` không tính margin, nên tổng các sub-segment nhỏ hơn chiều cao thật của item đúng bằng tổng margin giữa chúng.

> **Sửa spec (2026-08-12, sau review):** đoạn trên ban đầu kết luận "sai số này…
> chấp nhận, không bù trừ". Kết luận đó SAI và đã bị gỡ — xem [Phần C](#phần-c--bù-khung-của-mục-sửa-spec-sau-review).

### Phân trang

Đơn vị nhồi nhỏ hơn thì `pageGroupsForNodes` cho hệ quả tự nhiên: head + k bullet đầu ở trang này, các bullet còn lại ở trang sau.

> **Sửa spec (2026-08-12, sau review):** ràng buộc "`pageGroupsForNodes` **giữ
> nguyên, không sửa một dòng**" đã được GỠ. Hàm nay nhận thêm tham số `chrome`.
> Lý do và số đo ở [Phần C](#phần-c--bù-khung-của-mục-sửa-spec-sau-review).

### Render

`renderPage` gom các sub-segment của một trang thành hai thứ:

- `itemIds: Record<nodeId, itemId[]>` — như hiện tại, để `itemsForNode` lọc.
- `itemSlices: Record<itemId, { head: boolean; highlights: number[] }>` — prop mới của `CVBlockRenderer`.

Trong `renderExperience`, `renderProjects`, `renderEducation`:

- Phần head chỉ render khi `slice.head === true`.
- `RegisteredHighlights` chỉ nhận các phần tử có index nằm trong `slice.highlights`, giữ nguyên thứ tự gốc.

`itemSlices` vắng mặt nghĩa là render đầy đủ. Mọi chỗ gọi `CVBlockRenderer` khác — đường in, thumbnail, khối đo ẩn, view diff — không truyền prop này nên không đổi hành vi.

`data-cv-item-id` vẫn gắn trên khung item ở cả hai mảnh, nên chọn và sửa trực tiếp trên trang vẫn hoạt động ở mảnh nào cũng được.

### Cố ý không làm

Những điều dưới đây là quyết định có chủ đích, không phải thiếu sót:

- **Không có luật widow/orphan.** Trang có thể kết thúc bằng đúng dòng tiêu đề item với 0 bullet; trang mới có thể chỉ chứa 1 bullet lẻ.
- **Không cắt giữa một dòng văn xuôi.** Đoạn `summary` dài, hoặc một bullet dài hơn cả trang, vẫn nhảy nguyên khối và có thể tràn. Muốn cắt tới mức dòng thì phải bỏ mô hình mỗi-trang-một-shell, ngoài phạm vi lần này.
- **Tiêu đề section vẫn lặp lại** ở trang sau khi một section trải qua nhiều trang. Đây là hành vi sẵn có, không đụng tới.
- **Các node khác không tách** (`skills`, `activities`, `languages`, `summary`, `certifications`…). Chỉ ba node đã tách được ở mức item mới xuống mức bullet.

## Phần B — Tách đôi `pageMargin`

`pageMargin` chỉ còn một nghĩa duy nhất: **khe hở giữa các tờ giấy trong preview**. Nó không còn ảnh hưởng gì tới bản in.

| | Trước | Sau |
|---|---|---|
| Default | 0mm | 20mm |
| Preview | `marginBottom` trên mỗi tờ (dư 20mm dưới tờ cuối) | `gap` trên container flex |
| PDF | `@page margin = padding + pageMargin` | `@page margin = padding` |
| Vùng nội dung | preview và PDF lệch `2 × pageMargin` | khớp nhau |

Điểm chạm:

1. `frontend/packages/schema/src/cv.ts` — `pageMargin` default `0` → `20`. Ràng buộc `min(0).max(20)` giữ nguyên.
2. `frontend/apps/web-spa/src/lib/cv-typography.ts` — `design.pageMargin ?? 0` → `?? 20`.
3. `frontend/apps/web-spa/src/lib/print-css.ts` — bỏ phép cộng `+ margin` ở cả bốn cạnh; `@page margin` lấy thẳng từ padding.
4. `frontend/apps/web-spa/src/components/PaginatedA4Document.tsx` — bỏ `marginBottom` trên từng `<section>`, đặt `gap: var(--cv-page-margin, 0mm)` trên container `flex flex-col`. Chỉ áp cho nhánh `pageGroups`; nhánh đo-chiều-cao dùng định vị tuyệt đối, không có khe giữa trang, giữ nguyên.
5. `frontend/apps/web-spa/src/components/CVEditorView.tsx` — chuỗi `'Margin trang'` đang hardcode tiếng Việt giữa các nhãn đã i18n. Đưa vào `messages.vi.ts` / `messages.en.ts` thành khóa mới `pageGap`: "Khe giữa trang (chỉ xem trước)" / "Page gap (preview only)". Đổi khóa `pageMargin` sẵn có — đang là tiêu đề nhóm — thành "Lề trang" / "Page margins" để khỏi trùng tên với slider con.

### Ảnh hưởng tới dữ liệu cũ

CV đã lưu `pageMargin > 0` sẽ in ra với lề hẹp hơn trước đúng bằng giá trị đó (ví dụ `pageMargin: 5` → lề in giảm 5mm mỗi cạnh). Đây là hệ quả có chủ đích của việc tách đôi. Không viết migration; giá trị cũ vẫn hợp lệ và giờ chỉ điều khiển khe preview.

CV đã lưu không có `pageMargin` sẽ nhận default mới 20mm, tức khe preview rộng ra — không ảnh hưởng bản in.

## Phần C — Bù khung của mục (sửa spec sau review)

Spec bản đầu đóng băng `pageGroupsForNodes` và bỏ qua phần chiều cao "không thuộc
đoạn con nào". Phần bỏ sót ấy có sẵn từ trước — bản cũ cộng chiều cao NGUYÊN item
cũng không hề tính tiêu đề mục hay khe giữa các mục. Cái mà nhánh này làm thay đổi
là **biên an toàn**: nhồi nguyên item thì mỗi trang còn thừa cỡ nửa item (~60-120px),
đủ nuốt phần khung bị bỏ sót; nhồi theo bullet thì chỉ còn thừa cỡ nửa bullet
(~10px), nên phần khung ~150-270px lộ nguyên ra thành nội dung tràn qua đáy tờ giấy.
Đo thật: trang 1 dựng ra 1106px trên một trang chứa được 971px — tràn 36mm.

### Cái gì bị bỏ sót

1. `<h3>` tiêu đề mục (`sectionHeading`) — nằm trong node frame nhưng ngoài mọi item.
2. Khe `space-y-4` / `space-y-3` / `space-y-2` giữa các entry trong một mục.
3. Phần dôi của `ul` so với tổng các `li` (padding/margin của danh sách).
4. Khe `mb-6` giữa hai mục — margin đã gộp (collapse) nên `getBoundingClientRect`
   của cả hai node đều không tính.

### Cách bù

Đo, không ghim hằng số. Với mỗi node trong khối đo ẩn:

- `repeated = height(node) − Σ height(các đoạn con của node)` — ôm trọn (1), (2), (3).
- `gapBefore = top(node) − bottom(node liền trước)` — chính là (4), lấy đúng như
  trình duyệt đã dựng, kể cả margin gộp.

`pageGroupsForNodes(segments, heights, capacity, chrome?)` tính thêm:

- `repeated` cho **mọi trang** mà node xuất hiện — vì tiêu đề mục được render lại
  ở mỗi trang (xem "Cố ý không làm": tiêu đề section vẫn lặp).
- `gapBefore` **chỉ khi** node không mở đầu trang — ở đầu trang khe đó không tồn tại.

Hàm vẫn THUẦN trên `(segments, heights, capacity, chrome)`; phần chạm DOM tách
riêng thành `measureNodeChrome`. Nhờ vậy unit test bơm chiều cao giả vẫn kiểm được
logic xếp trang, còn phép đo thì kiểm bằng DOM có stub rect.

### Số đo thật (Chromium, fixture `initialCVs[0]`, layout header+summary+experience+projects+education+skills, padding 20mm → capacity 971px)

| node | nodeHeight | Σ đoạn con | chrome (`repeated`) | `gapBefore` |
|---|---|---|---|---|
| header | 99 | 99 | 0 | — |
| summary | 117 | 117 | 0 | 24 |
| experience | 544 | 483 | 61 | 24 |
| projects | 165 | 113 | 52 | 24 |
| education | 84 | 48 | 36 | 24 |
| skills | 145 | 145 | 0 | 24 |

- Bản cũ cộng được `Σ đoạn con = 1005px` → **2 trang**. Số trang KHÔNG sai.
  Cái sai nằm ở chỗ khác: nó dồn 17 đoạn vào trang 1, mà 17 đoạn ấy dựng ra
  **1106px** trên một trang chứa được 971px — **tràn 134px ≈ 36mm** qua đáy tờ giấy.
- Bản mới: `Σ đoạn con (1005) + Σ chrome (151) + 5 × gap (120) = 1276px` → 2 trang,
  trang 1 cao thật 965px (vừa), trang 2 cao 362px. Không trang nào tràn.
  Lưu ý `Σ đoạn con + Σ chrome = Σ nodeHeight = 1154` theo đúng định nghĩa.
- Chiều cao dựng thật của cả CV là 1299px; chênh 23px so với 1276 là lề `mb-6`
  của mục CUỐI, nằm ngoài dòng chảy nên không tính vào trang nào.

> **Đính chính (2026-08-12):** bản spec đầu tiên của phần này ghi "bản cũ = 957px
> → 1 trang — sai". Con số đó đến từ một probe hỏng: probe coi `skills` là mục
> tách được (các nhóm skill CÓ mang `data-cv-item-id` qua `interactiveProps`) nên
> cộng `skills` theo item ra 97px thay vì 145px. `segmentsForLayout` không bao giờ
> tách `skills`. Đo lại đúng thì bản cũ ra 1005px và 2 trang. Vấn đề thật là TRÀN
> ĐÁY TRANG, không phải sai số trang — và tràn 36mm thì đúng là triệu chứng
> "chỉnh padding dưới không ăn thua" đã khơi ra cả nhánh này.

### Cố ý chấp nhận

`repeated` gồm cả khe giữa các entry của mục, nên khi một mục chỉ có một entry
trên trang thì phần khe đó bị tính dư vài px. Dư là an toàn (cắt sớm hơn), và trừ
đúng theo từng trang sẽ phải đo lại toàn bộ mỗi lần thử nhồi — không đáng.

## Kiểm chứng

Test viết trước theo TDD; mỗi mục dưới đây là một test phải đỏ trước khi sửa mã.

**Phân trang mức bullet**
- `pageGroupsForNodes` với `head` + 5 bullet, capacity vừa đủ `head` + 3 bullet → đúng 2 trang; trang 2 chứa `h3`, `h4` và không chứa `head`.
- Item không có `highlights` → sinh đúng 1 sub-segment, kết quả phân trang không đổi so với trước.

**Bù khung của mục (Phần C)**
- `measureNodeChrome` trên DOM có stub rect → `repeated = nodeHeight − Σ đoạn con`, `gapBefore = top − bottom(node trước)`; node không render gì → `{0, 0}` và không làm mốc cho khe kế tiếp.
- `pageGroupsForNodes` với `chrome.repeated` → khung bị tính LẠI trên mỗi trang mà node trải qua.
- `pageGroupsForNodes` với `chrome.gapBefore` → khe bị tính khi node đứng giữa trang, KHÔNG tính khi node mở đầu trang.
- `CVBlockRenderer` thật: `<h3>` tiêu đề mục nằm trong node frame và ngoài mọi `[data-cv-item-id]` — nếu không thì phép trừ ở trên không còn bắt được tiêu đề.

**Preview và PDF cùng một hộp nội dung**
- Suy `@page{margin}` ra từ `printCSSForDesign`, đối chiếu với `pageContentHeightPx` của preview: lề in phải bằng đúng bốn padding, và sức chứa preview bằng đúng `(297 − trên − dưới)mm`. Đỏ ngay nếu một trong hai nửa cộng lại `pageMargin`.

**Render lát cắt**
- `CVBlockRenderer` với `itemSlices = { 'exp-1': { head: false, highlights: [3, 4] } }` → không render chức danh/công ty/ngày, render đúng 2 `li` cuối theo thứ tự gốc.
- `CVBlockRenderer` không truyền `itemSlices` → render đầy đủ, khớp snapshot hiện tại.

**Lề in**
- `printCSSForDesign` với `paddingTop: 12, paddingBottom: 14, paddingLeft: 16, paddingRight: 18, pageMargin: 2` → `@page{size:A4;margin:12mm 18mm 14mm 16mm}` (cập nhật kỳ vọng cũ ở `test/print.test.ts:58`).
- Schema default: `pageMargin === 20` (cập nhật `packages/schema/test/cv.test.ts:41`).

**Preview**
- `PaginatedA4Document` nhánh `pageGroups`: container có `gap`, các `<section>` con không có `marginBottom`.
