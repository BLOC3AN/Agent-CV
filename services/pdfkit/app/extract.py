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
    return re.sub(r"[ \t]+", " ", s).strip()


def extract_pdf(path: str) -> ExtractResult:
    doc = fitz.open(path)
    try:
        mu = "".join(p.get_text() for p in doc)
        fonts = _fonts(doc)
        pages = doc.page_count
        columns = max((_columns(p) for p in doc), default=1)

        pop = _poppler(path)
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
        text = b if use_poppler else a

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
