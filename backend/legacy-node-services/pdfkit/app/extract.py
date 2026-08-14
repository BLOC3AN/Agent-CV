"""
Trích text từ PDF kèm CỔNG KIỂM TRA CHẤT LƯỢNG — TDD §8.1.1.

Chạy CẢ HAI engine (PyMuPDF + poppler) rồi so sánh. Cả hai đều cục bộ, không
tốn LLM, nên luôn chạy cả hai thay vì tin một engine.

Vì sao cần: khảo sát 6 CV thật cho thấy CV dùng Type3 font làm hai engine cho
kết quả khác nhau — PyMuPDF hỏng ký tự và MẤT HẲN dòng tên, poppler thì đúng.
Mất dòng tên là mất field quan trọng nhất của CV. Và so sánh độ dài KHÔNG phát
hiện được: cả 6 file đều lệch 0%.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from typing import Literal

import fitz  # PyMuPDF

Quality = Literal["good", "suspect", "none"]

# Ký tự đặc trưng khi font ánh xạ sai: dấu phụ đứng lẻ, ligature vỡ,
# hoặc chữ hoa kẹt giữa chữ thường ("IˇMm a" thay vì "I'm a")
GARBLE = re.compile(r"[ˇ˘˙˚˛˜˝ﬁﬂ]|(?<=[a-z])[A-Z]{2}(?=[a-z])")

MIN_TEXT_CHARS = 200
ENGINE_DIFF_THRESHOLD = 0.15

# Số dòng ở đầu/cuối mỗi trang được coi là vùng header/footer
RUNNER_ZONE = 5


@dataclass
class PageBlock:
    """Khối text kèm toạ độ — màn hình rà soát (UC-22) dùng để tô sáng vùng."""

    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str


@dataclass
class ExtractResult:
    text: str
    engine: Literal["pymupdf", "poppler", "none"]
    quality: Quality
    reasons: list[str] = field(default_factory=list)
    pages: int = 0
    columns: int = 1
    has_type3: bool = False
    garble_count: int = 0
    engine_diff: float = 0.0
    fonts: list[str] = field(default_factory=list)
    blocks: list[PageBlock] = field(default_factory=list)
    # Số dòng header/footer lặp lại đã bỏ — xem strip_page_runners()
    runners_removed: int = 0

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "engine": self.engine,
            "quality": self.quality,
            "reasons": self.reasons,
            "pages": self.pages,
            "columns": self.columns,
            "hasType3": self.has_type3,
            "garbleCount": self.garble_count,
            "engineDiff": round(self.engine_diff, 4),
            "fonts": self.fonts,
            "runnersRemoved": self.runners_removed,
            "blocks": [
                {
                    "page": b.page,
                    "bbox": [b.x0, b.y0, b.x1, b.y1],
                    "text": b.text,
                }
                for b in self.blocks
            ],
        }


def _fonts(doc: fitz.Document) -> list[str]:
    """
    Lấy font từ RESOURCE DICTIONARY của PDF, không suy ra từ API phân tích text.

    Vì sao: `get_text("dict")` → spans → font phụ thuộc phiên bản PyMuPDF. Đo
    thực tế trên CV-02 (có Type3):
        PyMuPDF 1.27.2 → ['Type3 (1394 0 R)', ...]   phát hiện đúng
        PyMuPDF 1.25.1 → []                          BỎ SÓT
    Cổng chất lượng suy giảm âm thầm theo phiên bản thư viện là điều không chấp
    nhận được. `get_fonts()` đọc thẳng resource dict nên ổn định hơn nhiều.

    Vẫn gộp thêm kết quả từ spans: hai nguồn bù cho nhau, và font chỉ dùng để
    ĐÁNH GIÁ RỦI RO nên thừa còn hơn thiếu.
    """
    names: set[str] = set()

    for page in doc:
        try:
            # (xref, ext, type, basefont, name, encoding)
            for f in page.get_fonts(full=False):
                subtype = f[2] if len(f) > 2 else ""
                base = f[3] if len(f) > 3 else ""
                names.add(f"{subtype} {base}".strip() if subtype else str(base))
        except Exception:
            pass

    try:
        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        names.add(span["font"])
    except Exception:
        pass

    return sorted(n for n in names if n)


def _has_type3(fonts: list[str]) -> bool:
    """Type3 = glyph nhúng dạng chương trình vẽ → text layer hay sai."""
    return any("type3" in f.lower() for f in fonts)


def _text_lines(page: fitz.Page) -> list[tuple[float, float, float, str]]:
    """Mọi dòng text của trang kèm (x0, x1, y0, nội dung)."""
    out: list[tuple[float, float, float, str]] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            text = "".join(s["text"] for s in line["spans"]).strip()
            if text:
                x0, y0, x1, _ = line["bbox"]
                out.append((x0, x1, y0, text))
    return out


def _column_split(page: fitz.Page) -> float | None:
    """
    Toạ độ x của máng phân cách hai cột, hoặc None nếu trang chỉ có một cột.

    ── Vì sao KHÔNG lấy giữa trang ──
    Trên CV-35, dòng "06/2024 – Present" căn phải TRONG cột trái ở x≈338-414,
    tức nằm bên phải đường giữa (306). Cắt ở giữa sẽ đẩy ngày của một chỗ làm
    sang cột phải. Máng thật của trang đó ở x≈417-437.

    ── Cách tìm ──
    Máng là dải dọc mà rất ít dòng cắt qua. Quét mọi vị trí trong khoảng 25%-80%
    khổ trang, chọn nơi ít dòng cắt nhất; hoà thì lấy nơi chia hai bên cân hơn.

    Dòng TRẢI NGANG cả trang bị loại khỏi phép đo: tên, dòng liên hệ và đoạn
    tóm tắt cắt qua MỌI vị trí, nên giữ chúng lại thì không trang nào có máng.

    Ngưỡng chấp nhận không phải 0: CV-30 có đúng một dòng — địa chỉ email ở đầu
    trang — vắt qua máng thật của nó. Đòi tuyệt đối sạch thì trang đó bị coi là
    một cột và mục học vấn của nó lại hỏng như cũ.
    """
    width = page.rect.width
    narrow = [(x0, x1) for x0, x1, _, _ in _text_lines(page) if (x1 - x0) < width * 0.6]
    if len(narrow) < 10:
        return None

    best: tuple[tuple[int, int], float] | None = None
    for step in range(int(width * 0.25), int(width * 0.80) + 1, 2):
        x = float(step)
        crossing = sum(1 for a, b in narrow if a < x < b)
        left = sum(1 for _, b in narrow if b <= x)
        right = sum(1 for a, _ in narrow if a >= x)
        if left < 5 or right < 5:
            continue
        score = (crossing, -min(left, right))
        if best is None or score < best[0]:
            best = (score, x)
    if best is None or best[0][0] > max(1, len(narrow) * 0.03):
        return None
    return best[1]


def _columns_by_block(page: fitz.Page) -> bool:
    """
    Ước lượng hai cột bằng phân bố x của các KHỐI. Thô hơn `_column_split`
    nhưng bắt được trang mà cách kia bó tay.

    Vì sao vẫn giữ: CV-32 chia cột KHÁC NHAU ở hai vùng dọc — hộp kinh nghiệm
    chiếm bên trái tới x≈370, còn hai hộp dưới cùng lại chia đôi ở x≈300. Không
    một đường dọc nào cắt sạch cả trang (vị trí tốt nhất vẫn bị 18/137 dòng cắt
    qua), nên `_column_split` trả None. Bỏ hẳn đường này thì mục học vấn của
    CV-32 lại nuốt cả CV như trước khi sửa.
    """
    blocks = [b for b in page.get_text("blocks") if b[6] == 0]
    if not blocks:
        return False
    width = page.rect.width
    left = sum(1 for b in blocks if b[0] < width * 0.45)
    right = sum(1 for b in blocks if b[0] > width * 0.5)
    return left >= 3 and right >= 3


def _columns(page: fitz.Page) -> int:
    """Số cột của trang. Giữ tên cũ vì `ExtractResult.columns` là API công khai."""
    if _column_split(page) is not None or _columns_by_block(page):
        return 2
    return 1


def _page_text_by_column(page: fitz.Page) -> tuple[str, str]:
    """
    Tách trang hai cột thành (mạch chính, cột phụ), mỗi phần đọc theo y tăng dần.

    ── Vì sao phải sắp lại ──
    `page.get_text()` trả khối theo thứ tự trong content stream của PDF, KHÔNG
    theo vị trí. Đo trên CV-30 trang 1:

        khối 3   x 410-574   y 317   FOREIGN TRADE UNIVERSITY (FTU)…
        khối 4   x 410-486   y 292   EDUCATION

    Tiêu đề `EDUCATION` nằm cao hơn nhưng bị trả về SAU nội dung của nó, nên mục
    học vấn mở muộn và nuốt toàn bộ phần còn lại của CV.

    ── Vì sao TRẢ RIÊNG cột phụ thay vì nối ngay sau cột chính ──
    Sidebar thường chỉ có ở trang đầu, còn mục kinh nghiệm ở cột chính chạy tiếp
    sang các trang sau (CV-30: columns = 2/1/1). Nối "trang 1 chính + trang 1
    phụ" rồi mới tới trang 2 sẽ chèn sidebar vào GIỮA mạch kinh nghiệm — mục
    cuối của sidebar (SOFT SKILLS) nuốt 4943 ký tự của hai trang sau. Gọi hàm
    dồn cột phụ xuống cuối tài liệu để mạch chính liền một dải.

    ── Cách phân loại ──
    Khối trải quá 60% khổ trang VÀ vắt qua đường giữa là khối toàn trang (tên,
    dòng liên hệ, đoạn tóm tắt) — luôn thuộc mạch chính. Còn lại chia trái/phải
    theo đường giữa; bên nào trải hẹp hơn là cột phụ. Đo bề rộng thay vì mặc
    định "phải là phụ" vì sidebar nằm bên trái cũng phổ biến không kém.
    """
    width = page.rect.width
    split = _column_split(page)
    if split is None:
        # Không có máng sạch. Nếu phân bố KHỐI vẫn cho thấy hai cột thì tách ở
        # giữa trang theo khối như bản trước — thô hơn, nhưng vẫn hơn hẳn việc
        # để nguyên thứ tự content stream (xem _columns_by_block).
        if not _columns_by_block(page):
            return page.get_text(), ""
        split = width * 0.5
        items = [
            (b[0], b[2], b[1], b[4].strip())
            for b in page.get_text("blocks")
            if b[6] == 0 and b[4].strip()
        ]
    else:
        items = _text_lines(page)

    full: list[tuple[float, float, float, str]] = []
    left: list[tuple[float, float, float, str]] = []
    right: list[tuple[float, float, float, str]] = []
    for x0, x1, y0, text in items:
        if (x1 - x0) > width * 0.6 and x0 < split < x1:
            full.append((x0, x1, y0, text))
        elif x0 < split:
            left.append((x0, x1, y0, text))
        else:
            right.append((x0, x1, y0, text))

    def extent(items: list[tuple[float, float, float, str]]) -> float:
        return max(i[1] for i in items) - min(i[0] for i in items) if items else 0.0

    if not left or not right:
        main, side = full + left + right, []
    elif extent(right) < extent(left):
        main, side = full + left, right
    else:
        main, side = full + right, left

    def render(items: list[tuple[float, float, float, str]]) -> str:
        return "\n".join(i[3] for i in sorted(items, key=lambda i: (i[2], i[0])))

    return render(main), render(side)


def _poppler(path: str) -> str:
    """pdftotext -layout: giữ được bố cục theo cột tốt hơn chế độ mặc định."""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", path, "-"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return out.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        # Thiếu poppler thì vẫn chạy được, chỉ mất khả năng đối chiếu
        return ""


# Dòng bị ngắt GIỮA một địa chỉ email: có '@' và kết thúc bằng dấu chấm.
# Khung chứa email trong CV thiết kế thường hẹp nên PDF xuống dòng ngay sau
# dấu chấm của tên miền.
WRAPPED_EMAIL = re.compile(r"(?m)^(?P<head>[^\s@]*@[^\s@]*\.)[ \t]*\n[ \t]*(?=\S)")


# Dòng bị ngắt GIỮA một mốc thời gian: kết thúc bằng 1-2 chữ số kèm '.' hoặc
# '/', và dòng kế tiếp mở đầu bằng chữ số. `(?<!\d)` chặn đuôi của một năm bốn
# chữ số ("...năm 2024." không phải ngày bị cắt).
WRAPPED_DATE = re.compile(r"(?m)(?<!\d)(?P<head>\d{1,2}[./])[ \t]*\n[ \t]*(?=\d)")


def join_wrapped_date(text: str) -> str:
    """
    Nối lại mốc thời gian bị PDF xuống dòng giữa chừng.

    HỒI QUY CV-32: khung chứa hẹp nên một khoảng thời gian vỡ thành BA dòng —

        VN | 7.
        2025 - 12.
        2025

    `parseWork` bên worker Go lấy dòng-có-ngày làm mốc cắt từng chỗ làm. Ngày
    vỡ vụn thì không dòng nào là mốc, danh sách mốc rỗng, và CV vào hệ thống
    với experience = 0 — không hiện mục kinh nghiệm nào trên giao diện.

    Điều kiện có HAI vế, và vế thứ hai mới là vế quan trọng: dòng sau phải mở
    đầu bằng CHỮ SỐ. Thiếu nó thì một câu kết thúc bằng "...doanh thu tăng 15."
    sẽ bị dán vào dòng dưới.

    Áp dụng lặp cho tới khi không đổi: một mốc có thể bị cắt hai lần như ví dụ
    trên, và một lượt `sub` chỉ nối được mỗi chỗ một lần.
    """
    for _ in range(4):
        joined = WRAPPED_DATE.sub(lambda m: m.group("head"), text)
        if joined == text:
            break
        text = joined
    return text


def join_wrapped_email(text: str) -> str:
    """
    Nối lại địa chỉ email bị PDF xuống dòng giữa chừng.

    HỒI QUY CV-32: khung chứa email hẹp nên tên miền bị cắt làm đôi —

        pvnha2@gmail.
        com

    Text layer có đủ chữ, nhưng regex email của worker (main.go:188) khớp 0 kết
    quả, và CV vào hệ thống không có email.

    KHÔNG nối thô cả text. `text.replace("\\n", "")` làm regex bắt ra
    `tảng.pvnha2@gmail.com` — dính luôn chữ cuối của dòng phía trên, tạo ra một
    địa chỉ sai mà vẫn hợp lệ về hình thức. Điều kiện ở đây hẹp có chủ đích:
    dòng phải CHỨA '@' và KẾT THÚC bằng dấu chấm. Dòng văn xuôi kết thúc bằng
    dấu chấm không có '@' nên không bị đụng tới.
    """
    return WRAPPED_EMAIL.sub(lambda m: m.group("head"), text)


def _norm(s: str) -> str:
    # Bỏ ký tự rộng-không: CV xuất từ DOCX (CV-04) chèn U+200B sau mỗi dấu đầu
    # dòng và sau tên công ty. Chúng vô hình nhưng làm lệch mọi so khớp chuỗi ở
    # bước chia mục và che PII.
    s = re.sub(r"[​‌‍⁠﻿]", "", s)
    return re.sub(r"[ \t]+", " ", s).strip()


# ── Header/footer lặp lại giữa các trang ────────────────────────────────────


def _runner_key(line: str) -> str:
    """
    Khoá so sánh một dòng giữa các trang: bỏ khoảng trắng, hạ chữ.

    Số bị chuẩn hoá thành '#' CHỈ KHI dòng có chữ, để bắt footer đánh số trang
    ("Trang 1/3" và "Trang 2/3" là cùng một runner). Dòng toàn số thì giữ nguyên:
    chuẩn hoá luôn sẽ làm mọi dòng số khớp nhau, và một dòng "2024" nằm ở đầu
    trang sẽ bị bỏ oan cùng với footer "3".
    """
    flat = re.sub(r"\s+", "", line).lower()
    if re.search(r"[^\W\d_]", flat):
        return re.sub(r"\d+", "#", flat)
    return flat


def _zone_indexes(lines: list[str], zone: int) -> tuple[set[int], set[int]]:
    """
    Chỉ số của `zone` dòng có chữ đầu trang và `zone` dòng có chữ cuối trang.

    Trả về HAI tập riêng, không gộp: một dòng ở cuối trang 1 tình cờ trùng với
    một dòng ở đầu trang 2 không phải runner, và gộp lại sẽ bỏ oan nó.
    """
    idx = [i for i, l in enumerate(lines) if l.strip()]
    return set(idx[:zone]), set(idx[-zone:])


def strip_page_runners(pages: list[str], zone: int = RUNNER_ZONE) -> tuple[str, int]:
    """
    Bỏ header/footer LẶP LẠI ở các trang từ trang thứ hai trở đi.

    Vì sao bắt buộc: đo trên CV-06 thật (3 trang), mỗi trang mở đầu bằng khối
    "LE THANH HAI" + dòng liên hệ. Sau khi ghép trang, khối đó nằm GIỮA mục
    EXPERIENCE, và vì nó VIẾT HOA TOÀN BỘ nên `segment_cv` coi là tiêu đề mục
    mới. Kết quả: mục kinh nghiệm bị cắt tại trang 1 — 4 trong 5 chỗ làm rơi vào
    mục "unknown" và bị bỏ hẳn. 4502/7770 ký tự (58% CV) không tới được model.

    Header còn chèn ngang giữa câu ("...deployed QC stations at" | header |
    "the Tecomen factory..."), làm hỏng cả câu mà model đọc.

    TRANG ĐẦU giữ nguyên: ở đó khối này KHÔNG phải runner mà là tên + thông tin
    liên hệ thật — nguồn duy nhất để `identityFromMap` ghép danh tính trở lại.
    """
    if len(pages) < 2:
        return "\n".join(pages), 0

    has_text = [p for p in pages if p.strip()]
    if len(has_text) < 2:
        return "\n".join(pages), 0

    head_counts: dict[str, int] = {}
    foot_counts: dict[str, int] = {}
    for p in has_text:
        lines = p.split("\n")
        head_idx, foot_idx = _zone_indexes(lines, zone)
        for counts, idx in ((head_counts, head_idx), (foot_counts, foot_idx)):
            # set(): một dòng lặp hai lần trong cùng trang vẫn chỉ tính một trang
            for k in {_runner_key(lines[i]) for i in idx}:
                if len(k) >= 3:
                    counts[k] = counts.get(k, 0) + 1

    # Quá bán số trang (tối thiểu 2) mới coi là runner. Ngưỡng thấp hơn sẽ bỏ
    # mất nội dung thật chỉ vì hai trang tình cờ giống nhau một dòng.
    need = max(2, (len(has_text) + 1) // 2)
    head_runners = {k for k, c in head_counts.items() if c >= need}
    foot_runners = {k for k, c in foot_counts.items() if c >= need}
    if not head_runners and not foot_runners:
        return "\n".join(pages), 0

    out: list[str] = []
    removed = 0
    seen_first = False
    for p in pages:
        if not p.strip():
            out.append(p)
            continue
        if not seen_first:
            seen_first = True
            out.append(p)
            continue

        lines = p.split("\n")
        head_idx, foot_idx = _zone_indexes(lines, zone)
        kept: list[str] = []
        for i, l in enumerate(lines):
            key = _runner_key(l)
            if (i in head_idx and key in head_runners) or (
                i in foot_idx and key in foot_runners
            ):
                removed += 1
                continue
            kept.append(l)
        out.append("\n".join(kept))

    return "\n".join(out), removed


def extract_pdf(path: str) -> ExtractResult:
    doc = fitz.open(path)
    try:
        fonts = _fonts(doc)
        pages = doc.page_count
        columns = max((_columns(p) for p in doc), default=1)
        # Trang `_columns` báo 1 cột giữ nguyên `get_text()`.
        #
        # ĐÃ THỬ sắp lại theo y cho cả trang một cột và ĐO RA LÀ CÓ HẠI:
        #   được  CV-31 education 323 + CV-34 education 79 = 402 ký tự
        #   mất   CV-33 work 822 ký tự
        # Lý do: `_columns` chia trái/phải theo đường giữa trang, nên CV-33
        # (hai cột ở x≈35 và x≈193, CẢ HAI bên trái đường giữa) bị báo 1 cột.
        # Sắp theo y khi đó đặt hai tiêu đề cạnh nhau ở cùng độ cao sát nhau —
        # `EXPERIENCES` rồi ngay `SKILLS` — nên mục work rỗng và bị loại.
        # Muốn sửa phải gom cụm toạ độ x0 thay vì so với đường giữa; xem
        # test TestThuTuKhoiMotCot (đang xfail).
        #
        # Cột phụ của các trang hai cột gom lại rồi nối vào cuối, thành một
        # "trang" ảo. Nhờ vậy mạch chính chạy liền từ trang 1 tới trang cuối và
        # mục kinh nghiệm không bị sidebar cắt ngang.
        mu_pages = []
        sidebars: list[str] = []
        for p in doc:
            if _columns(p) >= 2:
                main, side = _page_text_by_column(p)
                mu_pages.append(main)
                if side.strip():
                    sidebars.append(side)
            else:
                mu_pages.append(p.get_text())
        if sidebars:
            mu_pages.append("\n".join(sidebars))
        mu = "\n".join(mu_pages)

        pop = _poppler(path)
        # pdftotext ngắt trang bằng form feed — dùng để nhận ranh giới trang
        pop_pages = pop.split("\f")
        a, b = _norm(mu), _norm(pop)

        flat_a = re.sub(r"\s+", "", a)
        flat_b = re.sub(r"\s+", "", b)
        diff = abs(len(flat_a) - len(flat_b)) / max(len(flat_a), len(flat_b), 1)

        # ── Không có text layer → đường ảnh (OCR) ────────────────────────
        if len(a) < MIN_TEXT_CHARS and len(b) < MIN_TEXT_CHARS:
            return ExtractResult(
                text="",
                engine="none",
                quality="none",
                reasons=["không có text layer"],
                pages=pages,
                columns=columns,
                fonts=fonts,
            )

        reasons: list[str] = []
        has_type3 = _has_type3(fonts)
        if has_type3:
            reasons.append("có Type3 font")
        if columns >= 2:
            reasons.append("bố cục nhiều cột")
        if diff > ENGINE_DIFF_THRESHOLD:
            reasons.append(f"hai engine lệch {diff * 100:.0f}%")

        g_mu, g_pop = len(GARBLE.findall(a)), len(GARBLE.findall(b))
        garble = min(g_mu, g_pop)
        if garble > 0:
            reasons.append(f"ký tự lỗi (ít nhất {garble})")

        # Chọn engine ít lỗi hơn. Hoà thì lấy PyMuPDF vì nó cho TOẠ ĐỘ —
        # màn hình rà soát (UC-22) cần để tô sáng vùng trên ảnh trang.
        use_poppler = g_pop < g_mu
        engine = "poppler" if use_poppler else "pymupdf"

        # Bỏ header/footer lặp lại TRƯỚC khi chia mục — xem strip_page_runners().
        # KHÔNG thêm vào `reasons`: đây là bước làm sạch bình thường của CV nhiều
        # trang, không phải dấu hiệu text kém. Thêm vào sẽ đẩy `quality` xuống
        # "suspect" và đổi nhánh xử lý ở worker.
        stripped, runners_removed = strip_page_runners(
            pop_pages if use_poppler else mu_pages
        )
        # Nối email bị ngắt dòng SAU khi bỏ header/footer lặp lại: bước đó có
        # thể xoá dòng nằm giữa hai nửa địa chỉ.
        text = join_wrapped_date(join_wrapped_email(_norm(stripped)))

        blocks: list[PageBlock] = []
        if not use_poppler:
            for i, page in enumerate(doc):
                for blk in page.get_text("blocks"):
                    if blk[6] != 0 or not blk[4].strip():
                        continue
                    blocks.append(
                        PageBlock(i, blk[0], blk[1], blk[2], blk[3], blk[4].strip())
                    )

        return ExtractResult(
            text=text,
            engine=engine,
            quality="suspect" if reasons else "good",
            reasons=reasons,
            pages=pages,
            columns=columns,
            has_type3=has_type3,
            garble_count=garble,
            engine_diff=diff,
            fonts=fonts,
            blocks=blocks,
            runners_removed=runners_removed,
        )
    finally:
        doc.close()


def render_pages(path: str, dpi: int = 200, max_pages: int = 10) -> list[bytes]:
    """
    Render trang thành PNG cho đường OCR và cho màn hình rà soát.

    200 dpi là mức cân bằng: đủ nét để OCR đọc chữ nhỏ, chưa làm ảnh quá nặng.
    """
    doc = fitz.open(path)
    try:
        out: list[bytes] = []
        zoom = dpi / 72
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
            out.append(pix.tobytes("png"))
        return out
    finally:
        doc.close()
