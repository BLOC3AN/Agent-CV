"""
Test cho pdfkit — TDD §8.1.1, §8.1.2.

Chạy trên CV thật trong eval/cv (gitignored). Nếu không có file thì skip,
không fail: CI công cộng sẽ không có dữ liệu chứa PII.

    cd services/pdfkit && python -m pytest tests -v
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.extract import (  # noqa: E402
    _has_type3,
    join_wrapped_email,
    extract_pdf,
    render_pages,
    strip_page_runners,
)
from app.segment import CvSection, heading_kind, merge_by_kind, reclassify, segment_cv  # noqa: E402

# `legacy-eval`, KHÔNG phải `eval`. Đường cũ trỏ `backend/eval/cv` — thư mục
# không tồn tại — nên MỌI test chạy trên CV thật đều skip lặng lẽ và bộ test
# trông như đang xanh. Dữ liệu thật nằm ở `backend/legacy-eval/cv/`; hằng số
# này không đổi theo khi thư mục được đổi tên.
CV_DIR = Path(__file__).resolve().parents[3] / "legacy-eval" / "cv"


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
        for name in ["CV-01", "CV-06", "CV-07", "CV-10", "CV-30"]:
            r = extract_pdf(str(cv(name)))
            merged = merge_by_kind(segment_cv(r.text))
            assert "skills" in merged, f"{name}: không tách được mục kỹ năng"


# ── CV bố cục hai cột ───────────────────────────────────────────────────────


class TestCvHaiCot:
    """
    HỒI QUY CV-30: CV hai cột, tiêu đề mục bị đọc SAU nội dung của chính nó.

    `extract_pdf` NHẬN RA bố cục (columns=2, quality="suspect") nhưng vẫn xuất
    text theo thứ tự tự nhiên của PyMuPDF, tức đan xen hai cột. Đo trên CV-30:

        dòng 13  FOREIGN TRADE UNIVERSITY (FTU),
        dòng 16  Administration (2009 - 2012)
        dòng 17  EDUCATION            ← tiêu đề nằm SAU nội dung của nó
        dòng 48  WORKING EXPERIENCE

    Hệ quả: mục `education` mở ở dòng 17 rồi nuốt 7330 trên 8540 ký tự còn lại.
    Toạ độ khối đã có sẵn trong ExtractResult.blocks — thiếu là bước sắp xếp.
    """

    def test_tieu_de_muc_dung_truoc_noi_dung_cua_no(self):
        r = extract_pdf(str(cv("CV-30")))
        lines = [l.strip() for l in r.text.split("\n")]
        assert "EDUCATION" in lines
        i_tieu_de = lines.index("EDUCATION")
        i_truong = next(i for i, l in enumerate(lines) if "UNIVERSITY" in l.upper())
        assert i_tieu_de < i_truong, (
            f"EDUCATION ở dòng {i_tieu_de} nhưng tên trường ở dòng {i_truong}"
        )

    def test_hoc_van_khong_nuot_phan_con_lai(self):
        """
        Lỗi gốc: `EDUCATION` bị đọc sau nội dung của nó nên mở muộn rồi nuốt
        7330 trên 8551 ký tự (86%) của cả CV.

        Không dùng luật "không mục nào quá X%": CV này 12 năm kinh nghiệm với 6
        chỗ làm, mục `work` chiếm 78% là ĐÚNG. Ngưỡng chung sẽ báo động giả trên
        chính kết quả tốt. Chốt thẳng vào mục đã hỏng.
        """
        r = extract_pdf(str(cv("CV-30")))
        merged = merge_by_kind(segment_cv(r.text))
        tong = sum(len(v) for v in merged.values())
        assert tong > 0
        ti_le = len(merged.get("education", "")) / tong
        assert ti_le < 0.2, {k: len(v) for k, v in merged.items()}

    def test_tach_duoc_ca_hoc_van_lan_kinh_nghiem(self):
        r = extract_pdf(str(cv("CV-30")))
        merged = merge_by_kind(segment_cv(r.text))
        assert merged.get("education", "").strip(), "mất mục học vấn"
        assert merged.get("work", "").strip(), "mất mục kinh nghiệm"
        assert "UNIVERSITY" in merged["education"].upper()

    def test_cot_phu_khong_cat_ngang_mach_kinh_nghiem(self):
        """
        Cột phụ CHỈ có ở trang 1 (columns: 2/1/1); mục kinh nghiệm ở cột chính
        chạy tiếp sang trang 2-3. Đọc "trang 1 trái rồi trang 1 phải" chèn cả
        sidebar vào giữa mạch đó, nên mục cuối của sidebar (SOFT SKILLS) nuốt
        4943 ký tự kinh nghiệm của hai trang sau.

        CV này có 6 chỗ làm — mục kinh nghiệm phải dài hơn danh sách kỹ năng.
        """
        r = extract_pdf(str(cv("CV-30")))
        merged = merge_by_kind(segment_cv(r.text))
        assert len(merged["work"]) > len(merged.get("skills", "")), {
            k: len(v) for k, v in merged.items()
        }


# ── Tiêu đề mục vs. dòng liên hệ ────────────────────────────────────────────


class TestTieuDeVsEmail:
    """
    Regex tiêu đề neo `^…\\b`, mà dấu chấm là ranh giới từ. Nên một địa chỉ
    email bắt đầu bằng từ khoá mục sẽ mở nhầm mục đó ngay dòng liên hệ đầu CV.

    HỒI QUY CV-30: dòng `work.<tên>@gmail.com` mở mục `work` ở dòng 1, kéo cả
    phần giới thiệu vào mục kinh nghiệm.
    """

    @pytest.mark.parametrize("line", [
        "work.nguyen@example.com",
        "career.trang@example.com",
        "profile.hai@example.com",
        "skills@example.com",
    ])
    def test_email_khong_phai_tieu_de(self, line):
        assert heading_kind(line) is None


class TestBienTheTieuDe:
    def test_working_experience_la_muc_kinh_nghiem(self):
        """`^work\\b` trượt trên "WORKING" vì sau `work` là chữ cái."""
        assert heading_kind("WORKING EXPERIENCE") == "work"

    def test_professional_summary_la_gioi_thieu(self):
        """Khớp `professional` của mục work, dù đây là phần tóm tắt bản thân."""
        assert heading_kind("PROFESSIONAL SUMMARY") == "introduce"

    def test_professional_experience_van_la_kinh_nghiem(self):
        """Chốt chặn: sửa cho SUMMARY không được kéo theo EXPERIENCE."""
        assert heading_kind("PROFESSIONAL EXPERIENCE") == "work"

    @pytest.mark.parametrize("line", [
        "KEY SKILLS",
        "SOFT SKILLS",
        "TECHNICAL SKILLS",
        "CORE SKILLS",
    ])
    def test_ky_nang_co_tu_bo_nghia_dung_truoc(self, line):
        """
        `^skills?\\b` trượt khi tiêu đề có từ bổ nghĩa: CV-30 dùng "KEY SKILLS"
        và "SOFT SKILLS" ở cột phải, cả hai bị nuốt vào mục học vấn phía trên.
        """
        assert heading_kind(line) == "skills"


class TestThuTuKhoiMotCot:
    """
    Trang MỘT cột cũng bị PyMuPDF trả khối sai thứ tự, không riêng trang hai cột.

    `get_text()` trả theo thứ tự content stream chứ không theo vị trí. Đo:

        CV-31  40 khối, 8 lần y giảm; 'Education' (y=342) đứng SAU nội dung
               học vấn ở y=417-494
        CV-34  20 khối, 7 lần y giảm; tên ứng viên (y=39) nằm ở vị trí thứ 7

    Hệ quả giống hệt CV-30: tiêu đề mở mục sau nội dung của chính nó, thân mục
    rỗng, và `segment_cv` loại bỏ mục rỗng — mục học vấn biến mất.

    Cả hai CV này `_columns` báo 1 cột (CV-31 có 0 khối bên phải), nên nhánh
    sắp lại theo cột không chạm tới. Việc sắp theo y phải áp dụng cho MỌI trang.
    """

    @pytest.mark.xfail(
        reason=(
            "Chưa sửa. Sắp theo y cho trang một cột ĐÃ THỬ và đo ra net âm: "
            "được CV-31 education 323 + CV-34 education 79 = 402 ký tự, "
            "mất CV-33 work 822 ký tự. Vì `_columns` chia theo đường giữa "
            "trang nên CV-33 (hai cột ở x≈35 và x≈193) bị báo 1 cột, và sắp "
            "theo y đặt EXPERIENCES ngay cạnh SKILLS làm mục work rỗng. "
            "Sửa đúng cần gom cụm toạ độ x0 thay vì so với đường giữa."
        ),
        strict=True,
    )
    @pytest.mark.parametrize("name", ["CV-31", "CV-34"])
    def test_muc_hoc_van_khong_rong(self, name):
        r = extract_pdf(str(cv(name)))
        merged = merge_by_kind(segment_cv(r.text))
        assert merged.get("education", "").strip(), {
            k: len(v) for k, v in merged.items()
        }


class TestTieuDeTiengViet:
    """
    HỒI QUY CV-32 (CV designer, 9 mục nhìn thấy được trên trang): bốn tiêu đề
    tiếng Việt không có trong HEADINGS, nên nội dung của chúng dồn vào mục đang
    mở. Mục `work` phình lên 2653 ký tự vì gánh cả năng lực, hoạt động và điểm
    mạnh — nhìn trên giao diện thì tưởng mất thông tin, thực ra là gộp nhầm.

    Bảng đã có `kỹ năng`, `công nghệ`, `chuyên môn` nhưng thiếu bốn cái dưới.
    """

    @pytest.mark.parametrize("line,kind", [
        ("KỸ THUẬT", "skills"),
        ("Kỹ thuật", "skills"),
        ("ĐIỂM MẠNH", "skills"),
        ("NĂNG LỰC & HOẠT ĐỘNG", "activities"),
        ("NĂNG LỰC VÀ HOẠT ĐỘNG", "activities"),
        ("HOẠT ĐỘNG", "activities"),
        ("ĐỊNH HƯỚNG PHÁT TRIỂN", "introduce"),
        ("ĐỊNH HƯỚNG", "introduce"),
    ])
    def test_tieu_de_tieng_viet(self, line, kind):
        assert heading_kind(line) == kind


class TestEmailNgatDong:
    """
    HỒI QUY CV-32: địa chỉ email bị xuống dòng NGAY GIỮA tên miền vì khung chứa
    nó hẹp:

        pvnha2@gmail.
        com

    Text layer có đủ chữ, nhưng regex email của worker (main.go:188) khớp 0 kết
    quả nên CV vào hệ thống không có email.

    Không nối thô cả text: `text.replace('\\n','')` làm regex bắt ra
    `tảng.pvnha2@gmail.com` — dính luôn chữ cuối của dòng phía trên. Luật phải
    hẹp: chỉ nối khi dòng CHỨA '@' và KẾT THÚC bằng dấu chấm.
    """

    def test_noi_lai_email_bi_ngat_dong(self):
        text = "PHAM VO NGAN HA\npvnha2@gmail.\ncom\n0795 281 270"
        assert "pvnha2@gmail.com" in join_wrapped_email(text)

    def test_khong_dinh_chu_cuoi_dong_truoc(self):
        text = "thiết kế giữa các nền tảng.\npvnha2@gmail.\ncom"
        out = join_wrapped_email(text)
        assert "pvnha2@gmail.com" in out
        assert "tảng.pvnha2" not in out

    def test_khong_dong_vao_dong_khong_lien_quan(self):
        """Dòng kết thúc bằng dấu chấm nhưng KHÔNG có '@' thì để yên."""
        text = "Tôi là designer.\nTốt nghiệp Văn Lang."
        assert join_wrapped_email(text) == text

    def test_email_da_tron_ven_thi_giu_nguyen(self):
        text = "lien he: a.b@example.com\nHÀ NỘI"
        assert join_wrapped_email(text) == text

    def test_cv32_lay_duoc_email(self):
        r = extract_pdf(str(cv("CV-32")))
        assert re.search(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", r.text), (
            "không tìm được email nào trong text đã trích"
        )


class TestChucDanhVsMucCaNhan:
    """
    `OTHER_SECTION` có từ khoá TRẦN `personal`, nên mọi chức danh bắt đầu bằng
    "Personal" đều bị coi là tiêu đề mục lạ.

    HỒI QUY CV-34: dòng `PERSONAL ASSISTANT` là CHỨC DANH của ứng viên, nằm
    ngay dưới tên. Nó mở một mục `unknown` nuốt 459 ký tự gồm dòng liên hệ và
    cả đoạn giới thiệu. Mục `unknown` không có task parse nên bị bỏ hẳn —
    đúng kiểu mất dữ liệu mà docstring heading_kind cảnh báo từ CV-06.
    """

    @pytest.mark.parametrize("line", [
        "PERSONAL ASSISTANT",
        "Personal Trainer",
        "PERSONAL BANKER",
    ])
    def test_chuc_danh_khong_phai_tieu_de(self, line):
        assert heading_kind(line) is None

    @pytest.mark.parametrize("line", [
        "PERSONAL INFORMATION",
        "PERSONAL DETAILS",
        "THÔNG TIN CÁ NHÂN",
    ])
    def test_muc_thong_tin_ca_nhan_that_van_tach_duoc(self, line):
        assert heading_kind(line) == "unknown"


class TestSoItSoNhieu:
    """
    Mỗi từ khoá trong HEADINGS phải nhận CẢ dạng số ít lẫn số nhiều.

    Bảng viết mỗi từ theo đúng một dạng, nên CV dùng dạng còn lại trượt sạch.
    Đo trên 7 CV thật:

        EXPERIENCES        → None   (CV-33 mất hẳn mục kinh nghiệm)
        CAREER OBJECTIVES  → work   (CV-33, lẽ ra là introduce)
        ACTIVITY           → None

    Danh sách dưới đây cố ý liệt kê cả những cặp ĐANG ĐÚNG: nó là lưới chặn
    hồi quy khi ai đó sửa regex sau này, chứ không chỉ là test cho ba ca hỏng.
    """

    @pytest.mark.parametrize("line,kind", [
        ("EXPERIENCE", "work"),
        ("EXPERIENCES", "work"),
        ("INTERNSHIP", "work"),
        ("INTERNSHIPS", "work"),
        ("EMPLOYMENT", "work"),
        ("CAREER OBJECTIVE", "introduce"),
        ("CAREER OBJECTIVES", "introduce"),
        ("QUALIFICATION", "education"),
        ("QUALIFICATIONS", "education"),
        ("ACADEMIC", "education"),
        ("ACTIVITY", "activities"),
        ("ACTIVITIES", "activities"),
        ("VOLUNTEER", "activities"),
        ("CLUB", "activities"),
        ("CLUBS", "activities"),
        ("PROJECT", "projects"),
        ("PROJECTS", "projects"),
        ("PORTFOLIO", "projects"),
        ("CERTIFICATE", "certifications"),
        ("CERTIFICATES", "certifications"),
        ("LICENSE", "certifications"),
        ("LICENSES", "certifications"),
        ("LANGUAGE", "languages"),
        ("LANGUAGES", "languages"),
        ("HONOR", "awards"),
        ("HONORS", "awards"),
    ])
    def test_ca_hai_dang_so_deu_nhan_ra(self, line, kind):
        assert heading_kind(line) == kind


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
