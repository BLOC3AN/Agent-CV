# HR-Agent — Thiết kế sản phẩm: từ "trình soạn CV" sang "người đồng hành"

> Tài liệu BA/PM. Trả lời câu hỏi **người dùng đang ở đâu** và **hệ thống dẫn họ
> đi đâu tiếp**. Chi tiết màn hình nằm ở [FRONTEND.md](./FRONTEND.md), luật
> nghiệp vụ ở [USECASES.md](./USECASES.md), kỹ thuật ở [TDD.md](./TDD.md).

---

## 1. Vấn đề

Home hiện tại có đúng một nút: **"Tải CV lên"**.

Nút đó giả định người dùng (a) đã có CV, (b) biết mình cần sửa gì, và (c) hiểu
rằng tải lên là bước đầu của một quy trình dài. Cả ba giả định đều sai với phần
lớn người sinh viên và người mới ra trường — đúng nhóm sản phẩm này phục vụ.

Người chưa từng viết CV bấm vào đó thì không có gì để tải. Người có CV nhưng
hoang mang tải lên xong bị quăng thẳng vào một trình soạn thảo, và câu hỏi thật
của họ — *"CV của tôi dở ở chỗ nào?"* — không được trả lời ở bất kỳ đâu.

**Người dùng phải hiểu cấu trúc sản phẩm trước khi dùng được sản phẩm.** Đó là
lỗi thiết kế, không phải lỗi của họ.

---

## 2. Bốn tình trạng người dùng

Không phải bốn tính năng. Bốn **tình trạng**, và mỗi tình trạng có một câu hỏi
khác nhau trong đầu.

| # | Tình trạng | Câu hỏi trong đầu họ | Thứ họ cần trước tiên |
|---|---|---|---|
| **A** | Có CV, biết muốn sửa gì | *"Sửa chỗ này thế nào?"* | Trình soạn + trợ lý |
| **B** | Chưa từng viết CV | *"Bắt đầu từ đâu?"* | Người dẫn từng bước |
| **C** | Có CV, **không biết dở ở đâu** | *"CV tôi có ổn không?"* | Một bản chẩn đoán |
| **D** | Có việc cụ thể muốn ứng tuyển | *"Tôi có hợp việc này không?"* | Đối chiếu JD |

**C là nhóm bị bỏ rơi nặng nhất và cũng là nhóm đông nhất.** Họ không cần một
Word đẹp hơn. Họ cần hệ thống nói *"đây là 3 thứ nên sửa trước"*. Đây là chỗ
sản phẩm khác biệt so với Canva, Novoresume, hay bất kỳ trình soạn CV nào.

### Điều kiện KHÔNG ĐƯỢC PHÁ

Bốn lối vào, **một `Profile` duy nhất**.

```
A ─┐
B ─┤
C ─┼──►  Profile  ──►  CVDocument  ──►  PDF
D ─┘     (dữ liệu)     (trình bày)
```

Bốn lối vào là bốn **cửa**, không phải bốn hệ thống. Người vào bằng cửa B rồi
muốn đối chiếu JD phải dùng được luôn, không phải làm lại từ đầu. Nếu vi phạm
điều này, sản phẩm biến thành bốn sản phẩm nhỏ dùng chung một logo — và mọi
tính năng về sau phải làm bốn lần.

---

## 3. Hai màn hình Home

Đây là quyết định trung tâm của bản thiết kế này.

| | Lần đầu | Quay lại |
|---|---|---|
| **Câu hỏi** | *"Bạn cần giúp gì?"* | *"Bạn nên làm gì tiếp?"* |
| **Dạng** | Bộ định tuyến ý định | Bảng việc cần làm |
| **Sai lầm cần tránh** | dashboard SaaS rỗng | bắt onboarding lại từ đầu |

Một dashboard rỗng với người chưa có dữ liệu là màn hình vô dụng nhất trong
thiết kế phần mềm: nó khoe cấu trúc sản phẩm cho người còn chưa biết mình muốn
gì. Ngược lại, bắt người quay lại phải chọn "Tôi đã có CV" lần thứ năm là hỏi
một câu mà hệ thống **đã biết câu trả lời**.

### 3.1 Chọn Home nào — theo TRẠNG THÁI THẬT

Không dùng cookie "đã xem onboarding". Dùng dữ liệu:

```
chưa có Profile nào                    → Home lần đầu (bộ định tuyến)
có job import đang chạy / chờ rà soát  → Home tiếp tục dở dang  ★
có Profile                             → Home quay lại
```

★ **Trạng thái thứ ba dễ bị bỏ sót.** Người tải CV lên rồi đóng tab giữa màn
rà soát: họ đã có `job` nhưng chưa có `Profile`. Chiếu Home lần đầu cho họ là
xoá sạch công họ vừa bỏ ra và bắt bắt đầu lại. Đây là kiểu lỗi chỉ lộ ra khi có
người dùng thật.

---

## 4. Home lần đầu — bộ định tuyến ý định

```text
Tạo một CV thật sự hợp với bạn

Bắt đầu từ chỗ bạn đang đứng.

┌──────────────────────────────┐  ┌──────────────────────────────┐
│ Tôi đã có CV                 │  │ Tôi chưa có CV nào           │
│ Tải lên và cải thiện         │  │ Làm từ đầu, có người dẫn     │
└──────────────────────────────┘  └──────────────────────────────┘

┌──────────────────────────────┐  ┌──────────────────────────────┐
│ Tôi không biết CV mình dở    │  │ Tôi có việc muốn ứng tuyển   │
│ ở đâu ★                      │  │ Chỉnh CV cho khớp tin đó     │
│ Nhận bản chẩn đoán           │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘
```

**Quy tắc soạn nhãn.** Nhãn phải là **câu người dùng tự nói về mình**, không
phải tên tính năng. *"Đối chiếu JD"* là từ của người làm sản phẩm. *"Tôi có
việc muốn ứng tuyển"* là từ của người đi xin việc. Người dùng nhận ra mình
trong nhãn thì mới bấm đúng.

Không có nút "Đăng nhập" nổi bật ở đây. Bắt đăng ký trước khi thấy giá trị là
cách nhanh nhất để mất người dùng ở màn hình đầu tiên.

---

## 5. Bốn luồng

### 5.1 A · "Tôi đã có CV"

```
Tải lên → AI đọc → RÀ SOÁT (bắt buộc) → Hồ sơ → Trình soạn
```

Đã chạy được. Màn rà soát là bắt buộc và không bỏ qua được (UC-22) — model đọc
sai thì người dùng phải thấy trước khi nó thành CV của họ.

### 5.2 B · "Tôi chưa có CV nào" — luồng có người dẫn

**Không được quăng người dùng vào một form 30 ô.** Đây là chỗ Agent có giá trị
nhất, và cũng là chỗ dễ làm ẩu nhất.

```text
Bước 1 — Bạn đang ở đâu?
   ○ Sinh viên   ○ Mới ra trường   ○ Đang đi làm   ○ Chuyển ngành

Bước 2 — Bạn nhắm vị trí nào?
   [ Computer Vision Engineer                    ]

Bước 3 — Bạn đã đi làm ở đâu chưa?
   [ Rồi ]   [ Chưa ]
```

Chọn **"Chưa"** thì trợ lý **tự đổi hướng**:

> *Không sao. Mình sẽ tập trung vào Dự án, Học vấn và Kỹ năng — với sinh viên
> thì đó mới là phần nhà tuyển dụng đọc kỹ.*

Đây là chi tiết UX quan trọng nhất của luồng B. Sinh viên nhìn thấy mục "Kinh
nghiệm làm việc" trống trơn sẽ kết luận mình *không đủ tư cách*, rồi bỏ. Câu
trên chuyển "bạn thiếu" thành "phần của bạn nằm chỗ khác".

**Ràng buộc.** Mỗi bước hỏi **một cụm**, có nút quay lại, và hồ sơ được lưu sau
mỗi bước — người bỏ giữa chừng vẫn còn phần đã làm (nối vào trạng thái "dở dang"
ở §3.1).

### 5.3 C · "Tôi không biết CV mình dở ở đâu" — chẩn đoán

```
Tải lên → AI đọc → RÀ SOÁT → ★ CHẨN ĐOÁN → chọn hành động
```

Điểm khác biệt: **không đi thẳng vào trình soạn**.

```text
Sức khoẻ CV của bạn

Rõ ràng, dễ đọc      ●●●●○   Tốt
Sức nặng (số liệu)   ●●○○○   Cần sửa
Bám sát vị trí       ●○○○○   Yếu
Chi tiết kinh nghiệm ●●●●○   Tốt
Kỹ năng phù hợp      ●●●○○   Tạm được


3 thứ nên sửa trước

1. Phần giới thiệu đang chung chung, ai đọc cũng thấy giống mình
2. 4 gạch đầu dòng mô tả VIỆC ĐÃ LÀM, chưa nói KẾT QUẢ
3. CV chưa nói rõ bạn nhắm vị trí nào

[ Sửa cùng trợ lý ]      [ Mở trình soạn ]
```

#### Quy tắc cứng cho màn này

- **BR-P.1 · Mỗi thanh phải đo một thứ CÓ THẬT.** Điểm lấy từ `scoreRubric()`
  (`packages/matching/src/rubric.ts`) — đã chạy được **không cần JD**. Cấm vẽ
  thanh bằng số bịa. Cùng luật với BR-52.1, và dự án này đã trả giá cho việc
  vẽ thanh đo sai thứ (TDD §8.2).
- **BR-P.2 · Mỗi việc trong "3 thứ nên sửa trước" phải TRỎ ĐƯỢC vào một chỗ cụ
  thể** trong CV. "Hãy làm CV chuyên nghiệp hơn" là lời khuyên vô dụng. "4 gạch
  đầu dòng ở mục Kinh nghiệm" thì bấm vào là tới đúng chỗ.
- **BR-P.3 · Tối đa 3 việc.** Liệt kê 12 lỗi khiến người ta đóng tab. Ba việc
  là số người ta còn làm được trong một buổi tối.
- **BR-P.4 · Không có tiêu chí nào chấm được thì NÓI THẲNG**, không hiện thanh
  rỗng giả vờ đã đo.

### 5.4 D · "Tôi có việc muốn ứng tuyển"

```
Tải lên / Làm mới  +  Dán tin tuyển dụng  →  Hồ sơ  →  Đối chiếu  →  CV riêng cho tin đó
```

Không bắt đi qua dashboard rồi tự tìm *Jobs → Analyze*. Người vào bằng cửa này
đã nói rõ mục đích rồi; hỏi lại là bắt họ nói hai lần.

Mỗi lần đối chiếu tạo một **bản hồ sơ riêng** (D12, UC-33) — CV cho Bosch không
đè lên CV cho NVIDIA.

---

## 6. Home quay lại — bảng việc cần làm

```text
Chào buổi chiều, Hải

Hồ sơ đã đầy đủ 82%

Tiếp tục chỗ đang dở
┌──────────────────────────────────────────┐
│ CV Computer Vision Engineer              │
│ Sửa 2 giờ trước           [ Tiếp tục ]   │
└──────────────────────────────────────────┘

Việc nên làm tiếp
CV của bạn có 3 gạch đầu dòng chưa có kết quả đo được.
[ Sửa cùng trợ lý ]

Tin tuyển dụng gần đây
Bosch CV Engineer      81%
NVIDIA AI Engineer     74%
```

### 6.1 "82%" phải là một con số THẬT

Đây là chỗ dễ nhất để bịa, và bịa thì hỏng cả niềm tin.

Dự án đã có luật cấm AI bịa số (BR-52.1) và một chuỗi lỗi vì đo sai thứ
(TDD §8.2). Con số này phải theo cùng chuẩn đó: **tính từ danh sách tiêu chí
cụ thể, và người dùng bấm vào phải xem được nó gồm những gì.**

Định nghĩa (giai đoạn 1):

| Thành phần | Trọng số | Đủ khi |
|---|---|---|
| Thông tin liên hệ | 10% | có tên + ít nhất một cách liên hệ |
| Giới thiệu | 15% | `basics.introduce` không rỗng |
| Kinh nghiệm **hoặc** Dự án | 30% | ít nhất một mục có gạch đầu dòng |
| Học vấn | 15% | ít nhất một mục |
| Kỹ năng | 15% | ít nhất 5 kỹ năng |
| Gạch đầu dòng có số liệu | 15% | ≥ 30% số gạch đầu dòng có số đo được |

Bấm vào "82%" hiện đúng bảng này, đánh dấu phần còn thiếu. **Không có phần trăm
nào mà người dùng không tra được nguồn.**

### 6.2 "Việc nên làm tiếp" chọn thế nào

Một việc, không phải danh sách. Ưu tiên theo thứ tự:

1. Còn việc dở dang (import chưa rà soát xong) → dẫn về đó
2. Có tiêu chí rubric điểm thấp nhất và **sửa được bằng trợ lý** → đề xuất việc đó
3. Chưa đối chiếu tin tuyển dụng nào → mời dán một tin vào
4. Không còn gì → nói thẳng *"CV của bạn đang ổn"*, đừng bịa việc

Điểm 4 quan trọng: bịa việc để lấp chỗ trống làm người dùng mất tin vào ba mục
trên nó.

---

## 7. Ưu tiên triển khai

Xếp theo **số người bị chặn** chia cho **công bỏ ra**.

| Đợt | Việc | Trạng thái |
|---|---|---|
| **P1** | Home lần đầu (4 lối vào) + Home quay lại + chọn theo trạng thái thật | ✅ xong |
| **P1** | Trạng thái "dở dang" | ✅ xong |
| **P2** | Màn chẩn đoán (luồng C) — `/diagnose/:cvId` | ✅ xong |
| **P2** | Luồng D nối thẳng từ Home | ✅ xong (`lib/intent.ts`) |
| **P3** | Luồng B có người dẫn — `/start/guided` | ✅ xong |
| **P3** | Bảng chi tiết "82%" | ✅ xong (bấm vào con số) |

**Không làm ở giai đoạn này:** gợi ý việc làm thật (cần nguồn dữ liệu tuyển
dụng), so sánh với người khác (cần dữ liệu tổng hợp), chấm điểm bằng người thật.

---

## 8. Đo bằng gì

Không đo bằng "người dùng thấy đẹp hơn".

| Chỉ số | Ý nghĩa |
|---|---|
| Tỉ lệ rời ở Home | Bao nhiêu người vào rồi đi mà không bấm gì |
| Phân bố 4 lối vào | Nếu C thật sự đông như giả định thì phải thấy ở đây |
| Tỉ lệ hoàn tất luồng B | Bỏ ở bước nào — bước đó soạn sai |
| Từ chẩn đoán → sửa thật | Bao nhiêu người bấm "Sửa cùng trợ lý" rồi áp dụng ít nhất một thay đổi |
| Quay lại trong 7 ngày | Home quay lại có thật sự dẫn được việc tiếp theo không |

---

## 9. Rủi ro đã nhận diện

| Rủi ro | Vì sao đáng lo | Cách chặn |
|---|---|---|
| Bốn lối vào thành bốn sản phẩm | Mọi tính năng sau phải làm bốn lần | Một `Profile`, kiểm bằng test: vào cửa B rồi đối chiếu JD phải chạy |
| "82%" là số bịa | Mất niềm tin vào toàn bộ phần còn lại | Bảng tra nguồn (§6.1), có test |
| Thanh sức khoẻ đo sai thứ | Đã xảy ra một lần rồi (TDD §8.2) | Mỗi thanh nối vào một tiêu chí rubric có thật, có test |
| Luồng B hỏi quá nhiều | Người dùng bỏ giữa chừng | Một cụm mỗi bước, lưu sau mỗi bước, xem được tiến độ |
| Chẩn đoán làm người ta nản | Nói CV họ yếu ở 5 chỗ là một cú đấm | Tối đa 3 việc, câu chữ hướng hành động, luôn nêu điểm mạnh trước |

Rủi ro cuối cần nói rõ: **giọng của bản chẩn đoán quyết định người dùng ở lại
hay bỏ đi.** Cùng một sự thật, *"CV của bạn yếu"* và *"đây là 3 thứ sửa xong sẽ
khác hẳn"* cho hai kết cục khác nhau.
