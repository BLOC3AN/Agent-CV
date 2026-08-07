"""
Test cho pdfkit — TDD §8.1.1, §8.1.2.

Chạy trên CV thật trong eval/cv (gitignored). Nếu không có file thì skip,
không fail: CI công cộng sẽ không có dữ liệu chứa PII.

    cd services/pdfkit && python -m pytest tests -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.extract import _has_type3, extract_pdf, render_pages  # noqa: E402
from app.segment import heading_kind, merge_by_kind, segment_cv  # noqa: E402

CV_DIR = Path(__file__).resolve().parents[3] / "eval" / "cv"


def cv(name: str) -> Path:
    p = CV_DIR / f"{name}.pdf"
    if not p.exists():
        pytest.skip(f"thiếu {p} (dữ liệu thật, gitignored)")
    return p


# ── Cổng chất lượng ─────────────────────────────────────────────────────────


class TestQualityGate:
    def test_cv_sach_thi_good(self):
        r = extract_pdf(str(cv("CV-01")))
        assert r.quality == "good"
        assert r.reasons == []
        assert len(r.text) > 1000

    def test_type3_bi_danh_dau_suspect(self):
        """
        HỒI QUY: CV-02 dùng Type3 font. PyMuPDF 1.25.1 trả fonts=[] nên bỏ sót,
        1.27.2 thì phát hiện. Cổng chất lượng KHÔNG được suy giảm theo phiên bản
        thư viện — đó là lý do _fonts() đọc resource dict thay vì spans.
        """
        r = extract_pdf(str(cv("CV-02")))
        assert r.has_type3 is True, (
            f"Không phát hiện Type3. fonts={r.fonts}. "
            "Nếu rỗng thì PyMuPDF quá cũ hoặc get_fonts() đổi API."
        )
        assert r.quality == "suspect"
        assert any("Type3" in x for x in r.reasons)

    def test_type3_thi_chon_poppler(self):
        """PyMuPDF làm hỏng ký tự và MẤT dòng tên trên file này."""
        r = extract_pdf(str(cv("CV-02")))
        assert r.engine == "poppler"

    def test_fonts_khong_bao_gio_rong_khi_co_text(self):
        """Bảo vệ chung: có text layer thì phải đọc được font."""
        for name in ["CV-01", "CV-02", "CV-10"]:
            r = extract_pdf(str(cv(name)))
            if r.quality != "none":
                assert r.fonts, f"{name}: fonts rỗng dù có text layer"

    def test_nhieu_cot_bi_danh_dau(self):
        r = extract_pdf(str(cv("CV-02")))
        assert r.columns == 2
        assert any("cột" in x for x in r.reasons)

    @pytest.mark.parametrize("fonts,expected", [
        (["Type3 (1394 0 R)"], True),
        (["Type3"], True),
        (["type3 foo"], True),
        (["TrueType ArialMT", "Type1 Times"], False),
        ([], False),
    ])
    def test_has_type3(self, fonts, expected):
        assert _has_type3(fonts) is expected


# ── Chia mục ────────────────────────────────────────────────────────────────


class TestSegment:
    def test_moi_cv_deu_tach_duoc_education(self):
        """
        TDD §8.1.2: parse cả CV một lượt làm model bỏ sót mục education.
        Chia mục là điều kiện để sửa được — nên bước này không được hụt.
        """
        for name in ["CV-01", "CV-04", "CV-06", "CV-07", "CV-10"]:
            r = extract_pdf(str(cv(name)))
            kinds = {s.kind for s in segment_cv(r.text)}
            assert "education" in kinds, f"{name}: không tách được mục education"

    @pytest.mark.parametrize("line,kind", [
        ("EDUCATION", "education"),
        ("Học vấn", "education"),
        ("HỌC VẤN", "education"),
        ("Kinh nghiệm làm việc", "work"),
        ("WORK EXPERIENCE", "work"),
        ("Dự án", "projects"),
        ("• Kỹ năng", "skills"),
        ("Chứng chỉ:", "certifications"),
        ("Ngoại ngữ", "languages"),
        ("HOẠT ĐỘNG NGOẠI KHÓA", "activities"),
        ("HOẠT ĐỘNG NGOẠI KHOÁ", "activities"),
    ])
    def test_nhan_dien_tieu_de_song_ngu(self, line, kind):
        assert heading_kind(line) == kind

    @pytest.mark.parametrize("line", [
        "Tôi đã xây dựng hệ thống quản lý kho bằng ReactJS và NodeJS.",  # quá dài
        "ab",                                                            # quá ngắn
        "Tối ưu truy vấn, giảm thời gian phản hồi.",                     # có dấu câu
        "",
    ])
    def test_khong_nham_noi_dung_thanh_tieu_de(self, line):
        assert heading_kind(line) is None

    def test_phan_dau_trang_vao_summary(self):
        sections = segment_cv("Nguyễn Văn A\nBackend Developer\n\nEDUCATION\nĐH Bách Khoa")
        assert sections[0].kind == "summary"
        assert "Nguyễn Văn A" in sections[0].body

    def test_gop_muc_cung_loai(self):
        sections = segment_cv(
            "WORK EXPERIENCE\nCông ty A\n\nINTERNSHIPS\nCông ty B"
        )
        merged = merge_by_kind(sections)
        # "INTERNSHIPS" không khớp từ khoá nào nhưng ALL CAPS → unknown
        assert "work" in merged
        assert "Công ty A" in merged["work"]


# ── Render ──────────────────────────────────────────────────────────────────


class TestRender:
    def test_render_ra_png(self):
        pages = render_pages(str(cv("CV-01")), dpi=100, max_pages=2)
        assert len(pages) == 2
        for p in pages:
            assert p.startswith(b"\x89PNG"), "không phải PNG hợp lệ"
            assert len(p) > 5_000

    def test_gioi_han_so_trang(self):
        assert len(render_pages(str(cv("CV-06")), dpi=72, max_pages=1)) == 1
