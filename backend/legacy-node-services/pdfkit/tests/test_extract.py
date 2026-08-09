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

from app.extract import (  # noqa: E402
    _has_type3,
    extract_pdf,
    render_pages,
    strip_page_runners,
)
from app.segment import CvSection, heading_kind, merge_by_kind, reclassify, segment_cv  # noqa: E402

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

    def test_phan_dau_trang_vao_introduce(self):
        sections = segment_cv("Nguyễn Văn A\nBackend Developer\n\nEDUCATION\nĐH Bách Khoa")
        assert sections[0].kind == "introduce"
        assert "Nguyễn Văn A" in sections[0].body

    def test_gop_muc_cung_loai(self):
        sections = segment_cv(
            "WORK EXPERIENCE\nCông ty A\n\nINTERNSHIPS\nCông ty B"
        )
        merged = merge_by_kind(sections)
        # "INTERNSHIPS" cũng là kinh nghiệm → cùng một mục `work`
        assert "work" in merged
        assert "Công ty A" in merged["work"]
        assert "Công ty B" in merged["work"]


class TestTieuDeGiaMao:
    """
    Dòng VIẾT HOA trong CV phần lớn là TÊN CÔNG TY, không phải tên mục.

    HỒI QUY CV-06: luật cũ coi mọi dòng ALL CAPS là tiêu đề mục → 4 trong 5 chỗ
    làm rơi vào mục `unknown` (không có task parse) và bị bỏ hẳn. App chỉ hiện 1
    kinh nghiệm trên CV có 5.
    """

    @pytest.mark.parametrize("line", [
        "STK_ENG – KANEKO SANGYO",       # gạch nối + dấu gạch dưới
        "ZALO - VNG CORPORATION",        # có "CORPORATION"
        "REALTIME ROBOTIC VIETNAM",      # có "VIETNAM"
        "CÔNG TY TNHH ABC",
        "FPT SOFTWARE",
        "ĐẠI HỌC BÁCH KHOA",
        "LE THANH HAI",                  # header trang lặp lại
        "NGUYEN VAN AN",
        "• GPA: 7.18/10",                # dòng có dấu đầu dòng
        "• Aptis ESOL - B1(05/2026)",
    ])
    def test_khong_coi_ten_cong_ty_la_tieu_de(self, line):
        assert heading_kind(line) is None

    @pytest.mark.parametrize("line", [
        "REFERENCES",
        "INTERESTS",
        "PUBLICATIONS",
        "ADDITIONAL INFORMATION",
        "SỞ THÍCH",
    ])
    def test_van_tach_duoc_muc_la_co_ten_giong_ten_muc(self, line):
        assert heading_kind(line) == "unknown"

    def test_ten_cong_ty_viet_hoa_o_lai_trong_muc_kinh_nghiem(self):
        text = (
            "EXPERIENCE\n"
            "iMESPRO\nAI Engineer\n2025 – Current\n• Làm A\n"
            "ZALO - VNG CORPORATION\nAI Engineer\n2022 – 2023\n• Làm B\n"
            "REALTIME ROBOTIC VIETNAM\nIntern\n2022\n• Làm C\n"
        )
        merged = merge_by_kind(segment_cv(text))
        assert "unknown" not in merged
        for org in ["iMESPRO", "VNG CORPORATION", "REALTIME ROBOTIC VIETNAM"]:
            assert org in merged["work"], f"mất {org}"

    def test_cv06_lay_du_ca_nam_cho_lam(self):
        """
        HỒI QUY, đo trên CV thật 3 trang: mục kinh nghiệm phải chứa CẢ NĂM
        chỗ làm, không phải chỉ chỗ đầu tiên (1079 → 5301 ký tự).
        """
        r = extract_pdf(str(cv("CV-06")))
        merged = merge_by_kind(segment_cv(r.text))
        for org in ["iMESPRO", "bTaskee", "KANEKO", "VNG", "REALTIME"]:
            assert org in merged["work"], f"mất chỗ làm {org}"
        # Không còn nội dung nào bị đẩy vào mục không parse được
        assert "unknown" not in merged

    def test_moi_cv_khong_con_muc_unknown_bi_bo(self):
        """Nội dung rơi vào `unknown` là nội dung BỊ BỎ — phải bằng 0."""
        for name in ["CV-01", "CV-02", "CV-04", "CV-06", "CV-07", "CV-10"]:
            r = extract_pdf(str(cv(name)))
            if r.quality == "none":
                continue
            merged = merge_by_kind(segment_cv(r.text))
            assert "unknown" not in merged, (
                f"{name}: {len(merged['unknown'])} ký tự bị bỏ vào mục unknown"
            )


class TestHeaderFooterLapLai:
    """
    Header lặp lại ở mỗi trang vừa cắt mục làm hai, vừa chèn ngang giữa câu.
    TDD §8.1.1.
    """

    def test_bo_header_tu_trang_hai_tro_di(self):
        pages = [
            "NGUYEN VAN A\n0900000000\n\nEDUCATION\nĐH Bách Khoa\n",
            "NGUYEN VAN A\n0900000000\n\n• Làm việc B\n",
            "NGUYEN VAN A\n0900000000\n\n• Làm việc C\n",
        ]
        text, removed = strip_page_runners(pages)
        assert removed == 4
        # Trang đầu GIỮ tên + liên hệ: đó là nguồn duy nhất để ghép danh tính
        assert text.count("NGUYEN VAN A") == 1
        assert text.count("0900000000") == 1
        assert "Làm việc B" in text and "Làm việc C" in text

    def test_footer_co_so_trang_van_bi_nhan_ra(self):
        pages = [
            "EDUCATION\nĐH Bách Khoa\nTrang 1/3\n",
            "• Làm việc B\nTrang 2/3\n",
            "• Làm việc C\nTrang 3/3\n",
        ]
        text, removed = strip_page_runners(pages)
        assert removed == 2, "số trang khác nhau vẫn phải coi là cùng một footer"
        assert "Trang 2/3" not in text

    def test_mot_trang_thi_khong_doi(self):
        pages = ["NGUYEN VAN A\nEDUCATION\nĐH Bách Khoa\n"]
        text, removed = strip_page_runners(pages)
        assert removed == 0
        assert "NGUYEN VAN A" in text

    def test_dong_cuoi_trang_truoc_trung_dong_dau_trang_sau_thi_giu(self):
        """
        Đầu trang và cuối trang đếm RIÊNG: một dòng ở cuối trang này tình cờ
        trùng dòng ở đầu trang kia không phải runner.
        """
        # Trang phải đủ dài để vùng đầu và vùng cuối không trùng nhau, và nội
        # dung giữa phải khác nhau để không thành runner theo cách khác
        def filler(tag: str) -> str:
            return "\n".join(f"• {tag} việc thứ {i}" for i in range(8))

        pages = [
            f"EDUCATION\n{filler('một')}\nPython, Java\n",
            f"Python, Java\n{filler('hai')}\nSKILLS\n",
        ]
        text, removed = strip_page_runners(pages)
        assert removed == 0
        assert text.count("Python, Java") == 2

    def test_khong_bo_noi_dung_chi_giong_nhau_o_mot_trang(self):
        pages = ["A\nEDUCATION\nX\n", "B\n• khác hẳn\n", "C\n• khác nữa\n"]
        text, removed = strip_page_runners(pages)
        assert removed == 0
        assert "EDUCATION" in text

    def test_cv06_bo_dung_header(self):
        r = extract_pdf(str(cv("CV-06")))
        assert r.runners_removed > 0
        assert r.text.count("LE THANH HAI") == 1, (
            "header lặp 3 lần: giữ trang đầu, bỏ hai trang sau"
        )


class TestReclassify:
    """
    "Languages" trong CV IT thường là NGÔN NGỮ LẬP TRÌNH.

    Đo trên CV-07 thật: cả tech stack (811 ký tự) rơi vào `languages` và
    `skills` ra RỖNG. Kỹ năng là trường mà đối chiếu JD phụ thuộc nhất.
    """

    @pytest.mark.parametrize("body,expected", [
        # Tech stack — không nêu tên ngôn ngữ nào
        ("PHP 8.4, TypeScript\nFrameworks\nLaravel 12, Vue 3\nDatabases\nMySQL", "skills"),
        ("Java, Python, Go", "skills"),
        ("C++, Rust", "skills"),
        # Ngoại ngữ thật — luôn nêu tên một ngôn ngữ hoặc thước đo trình độ
        ("English: Good oral, reading, written communication", "languages"),
        ("Tiếng Anh: IELTS 6.5\nTiếng Nhật: N3", "languages"),
        ("Anh văn: khá", "languages"),
        ("IELTS 7.0", "languages"),
        ("Japanese (JLPT N2)", "languages"),
    ])
    def test_phan_loai_lai_theo_noi_dung(self, body, expected):
        s = reclassify(CvSection(kind="languages", heading="Languages", body=body))
        assert s.kind == expected

    def test_khong_dung_toi_muc_khac(self):
        for kind in ["work", "education", "skills", "projects"]:
            s = reclassify(CvSection(kind=kind, heading="X", body="Java, Python"))
            assert s.kind == kind

    def test_cv07_tach_duoc_ca_hai_muc(self):
        """CV-07 có ĐỒNG THỜI "Languages" (tech) và "Language" (English)."""
        r = extract_pdf(str(cv("CV-07")))
        merged = merge_by_kind(segment_cv(r.text))
        assert "skills" in merged, f"mất mục kỹ năng: {list(merged)}"
        assert "Laravel" in merged["skills"] or "TypeScript" in merged["skills"]
        assert "languages" in merged
        assert "English" in merged["languages"]

    def test_moi_cv_it_deu_co_muc_ky_nang(self):
        for name in ["CV-01", "CV-06", "CV-07", "CV-10"]:
            r = extract_pdf(str(cv(name)))
            merged = merge_by_kind(segment_cv(r.text))
            assert "skills" in merged, f"{name}: không tách được mục kỹ năng"


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
