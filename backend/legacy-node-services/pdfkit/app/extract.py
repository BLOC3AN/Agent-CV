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


def _columns(page: fitz.Page) -> int:
    """Ước lượng số cột bằng phân bố toạ độ x của các khối text."""
    blocks = [b for b in page.get_text("blocks") if b[6] == 0]
    if not blocks:
        return 1
    width = page.rect.width
    left = sum(1 for b in blocks if b[0] < width * 0.45)
    right = sum(1 for b in blocks if b[0] > width * 0.5)
    return 2 if (left >= 3 and right >= 3) else 1


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
        mu_pages = [p.get_text() for p in doc]
        mu = "\n".join(mu_pages)
        fonts = _fonts(doc)
        pages = doc.page_count
        columns = max((_columns(p) for p in doc), default=1)

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
        text = _norm(stripped)

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
