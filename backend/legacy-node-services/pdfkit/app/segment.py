"""
Chia CV thành các mục theo tiêu đề — THUẦN CODE, không dùng LLM. TDD §8.1.2.

Vì sao cần: model 4B parse chính xác từng mục riêng lẻ (3/3 lần đúng trên đoạn
EDUCATION cô lập) nhưng BỎ SÓT NGUYÊN MỤC khi đưa cả CV 3000 ký tự vào một lượt.
Đây là mất chú ý theo độ dài, không phải lỗi schema.

Làm bằng code chứ không bằng LLM vì: rẻ, deterministic, test được, và tiêu đề
mục trong CV là tín hiệu rất mạnh.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

SectionKind = Literal[
    "introduce",
    "education",
    "work",
    "projects",
    "skills",
    "activities",
    "certifications",
    "languages",
    "awards",
    "unknown",
]

# Thứ tự quan trọng: khớp cụ thể trước. Song ngữ Việt/Anh trong cùng một bảng
# vì CV thị trường VN hay trộn hai ngôn ngữ ngay trong một file.
HEADINGS: list[tuple[SectionKind, re.Pattern[str]]] = [
    # `professional summary` phải nằm ở ĐÂY chứ không phải mục work: mục work
    # có từ khoá `professional`, mà HEADINGS duyệt theo thứ tự nên introduce
    # phải bắt trước. Ngược lại `professional experience` không khớp mẫu này
    # (không có "summary") nên vẫn rơi đúng về work.
    ("introduce", re.compile(
        r"^((professional|career|personal|executive)\s+)?"
        r"(summary|profile|objectives?|about( me)?|introduction)\b"
        r"|^(giới thiệu|mục tiêu( nghề nghiệp)?|tóm tắt|sơ lược|bản thân)\b", re.I)),
    ("education", re.compile(
        r"^(education|academic|qualifications?"
        r"|học vấn|trình độ( học vấn)?|quá trình học tập|bằng cấp)\b", re.I)),
    # Mọi từ khoá phải nhận CẢ hai dạng số. `\b` sau một từ số ít không khớp
    # dạng số nhiều — `^experience\b` trượt "EXPERIENCES" và CV-33 mất hẳn mục
    # kinh nghiệm. Cùng lỗi với `^work\b` trượt "WORKING EXPERIENCE".
    ("work", re.compile(
        r"^(work(ing)?|experiences?|employment|professional|career|internships?"
        r"|kinh nghiệm( làm việc)?|quá trình công tác|thực tập)\b", re.I)),
    ("projects", re.compile(r"^(projects?|portfolio|dự án|sản phẩm|đồ án)\b", re.I)),
    # Từ bổ nghĩa đứng trước `skills` là chuyện thường: "KEY SKILLS",
    # "SOFT SKILLS", "CORE SKILLS". `^skills?\b` trượt hết, và mục kỹ năng bị
    # nuốt vào mục ngay phía trên nó.
    ("skills", re.compile(
        r"^((key|soft|core|hard|main|technical|professional|other|additional)\s+)?"
        r"skills?\b"
        r"|^(technical|technologies|competenc|expertise)\b"
        r"|^(kỹ năng|công nghệ|chuyên môn)\b", re.I)),
    ("certifications", re.compile(
        r"^(certifications?|certificates?|licen[cs]es?|chứng chỉ|chứng nhận)\b", re.I)),
    ("languages", re.compile(r"^(languages?|ngoại ngữ|ngôn ngữ)\b", re.I)),
    ("awards", re.compile(
        r"^(awards?|honou?rs?|achievements?|giải thưởng|thành tích|khen thưởng)\b", re.I)),
    ("activities", re.compile(
        r"^(activit(y|ies)|volunteer|extracurricular|clubs?"
        r"|hoạt động|tình nguyện|câu lạc bộ|ngoại kho[áa])\b", re.I)),
]

# Tập ký tự đầu dòng rộng có chủ đích: CV-04 dùng ● (U+25CF), không phải •
# (U+2022). Bỏ sót một ký tự làm cả mục mất ranh giới mục con.
BULLETS = "•▪▫◦●○◆◇■□▸▶►‣⁃➢✦✔✓*·"
BULLET_PREFIX = re.compile(rf"^[{re.escape(BULLETS)}\-–—\s]+")
TRAILING_COLON = re.compile(r"[:：]\s*$")

# Dòng bắt đầu bằng dấu đầu dòng — KHÔNG bao giờ là tiêu đề mục lạ (xem
# heading_kind). Gạch ngang phải có khoảng trắng theo sau để không bắt "STK-ENG".
BULLET_LINE = re.compile(rf"^\s*(?:[{re.escape(BULLETS)}]|[-–—]\s)")

# Dòng liên hệ. Bắt email và URL để chúng không bị đọc thành tiêu đề mục: mọi
# mẫu trong HEADINGS neo `^…\b`, mà dấu chấm là ranh giới từ, nên
# `work.<tên>@gmail.com` hay `profile.example.com` khớp ngay từ khoá đầu.
CONTACT_LINE = re.compile(r"[@]|^(https?://|www\.)", re.I)

# Tên mục KHÁC — không parse được nhưng vẫn phải tách ra để không lẫn vào mục
# trước. Danh sách tên mục là tập HỮU HẠN và ổn định; danh sách tên công ty thì
# không, nên nhận diện theo tên mục (whitelist) chứ không loại theo tên công ty.
OTHER_SECTION = re.compile(
    r"^(references?|referees?|interests?|hobbies|publications?|patents?"
    r"|memberships?|affiliations?|leadership|seminars?|workshops?|conferences?"
    r"|training|courses?|coursework|research|portfolio|declaration|reference"
    # `personal` PHẢI đi kèm danh từ chỉ mục. Từ khoá trần bắt luôn chức danh:
    # "PERSONAL ASSISTANT" của CV-34 nằm ngay dưới tên ứng viên, bị coi là tiêu
    # đề mục rồi nuốt 459 ký tự liên hệ và giới thiệu vào `unknown` — mục không
    # có task parse nên mất trắng.
    r"|additional|miscellaneous|contact|misc"
    r"|personal\s+(information|details|data|particulars|profile)"
    r"|người tham chiếu|sở thích|xuất bản|nghiên cứu|liên hệ|cam kết"
    r"|khoá học|khóa học|đào tạo|thông tin (thêm|khác|cá nhân)|người giới thiệu)\b",
    re.I,
)

# Dấu hiệu dòng là TIÊU ĐỀ MỘT CHỖ LÀM (công ty, dự án) chứ không phải tên mục.
# Kiểm trước OTHER_SECTION để "TRAINING CENTER JSC" không bị hiểu thành mục.
ENTRY_SIGNALS = re.compile(
    r"\d"                       # năm, phiên bản, mã số
    r"|_"                       # STK_ENG
    r"|[|/@]"
    r"|\s[–—-]\s"               # "ZALO - VNG CORPORATION"
    r"|,"
    r"|\b(corp|corporation|company|co|ltd|inc|jsc|group|holdings?"
    r"|university|college|school|institute|academy|center|centre"
    r"|vietnam|viet nam|solutions?|technolog\w*|software|systems?|labs?"
    r"|studio|agency|bank|hospital|factory|foundation"
    r"|công ty|cty|tnhh|cổ phần|tập đoàn|nhà máy|trường|đại học)\b",
    re.I,
)


@dataclass
class CvSection:
    kind: SectionKind
    heading: str
    body: str

    def to_dict(self) -> dict:
        return {"kind": self.kind, "heading": self.heading, "body": self.body}


def heading_kind(line: str) -> SectionKind | None:
    """
    Một dòng là tiêu đề mục khi: ngắn, không kết thúc bằng dấu câu, ít từ,
    và (khớp từ khoá đã biết HOẶC là tên mục khác viết hoa toàn bộ).

    ── Vì sao KHÔNG coi mọi dòng VIẾT HOA là tiêu đề ──
    Luật cũ ("ALL CAPS không khớp từ khoá nào → mục lạ") cắt CV thật ở giữa mục.
    Đo trên CV-06 (5 chỗ làm):

        EXPERIENCE                  → work,    giữ được chỗ làm thứ nhất
        STK_ENG – KANEKO SANGYO     → unknown, MẤT chỗ làm thứ ba
        ZALO - VNG CORPORATION      → unknown, MẤT chỗ làm thứ tư
        REALTIME ROBOTIC VIETNAM    → unknown, MẤT chỗ làm thứ năm

    Tên công ty trong CV thường VIẾT HOA. Mục `unknown` không có task parse nên
    bị bỏ hẳn → app chỉ thấy 1 trong 5 chỗ làm.

    Nên đảo lại: dòng viết hoa chỉ mở mục mới khi TÊN NÓ trông như tên mục
    (OTHER_SECTION). Còn lại coi là thân của mục đang mở. Nhận sai theo hướng này
    chỉ làm mục hiện tại có thêm nhiễu — prompt đã dặn bỏ nội dung lạ — trong khi
    nhận sai theo hướng cũ làm MẤT DỮ LIỆU.
    """
    raw = line.strip()
    t = TRAILING_COLON.sub("", BULLET_PREFIX.sub("", raw))
    if len(t) < 3 or len(t) > 46:
        return None
    if re.search(r"[.;,]$", t):
        return None
    if len(t.split()) > 5:
        return None
    # Dòng liên hệ KHÔNG bao giờ là tiêu đề mục. Các mẫu dưới neo `^…\b`, mà
    # dấu chấm là ranh giới từ — nên `work.<tên>@gmail.com` khớp `work` và mở
    # mục kinh nghiệm ngay dòng đầu CV, kéo cả phần giới thiệu vào đó.
    if CONTACT_LINE.search(t):
        return None

    for kind, pattern in HEADINGS:
        if pattern.match(t):
            return kind

    # Dòng có dấu đầu dòng chỉ là tiêu đề khi khớp từ khoá ở trên. Nếu không,
    # "• GPA: 7.18/10" thành tiêu đề và cắt mục học vấn làm hai (CV-06).
    if BULLET_LINE.match(raw):
        return None

    letters = "".join(c for c in t if c.isalpha())
    if len(letters) < 3 or letters != letters.upper():
        return None
    if ENTRY_SIGNALS.search(t):
        return None
    if OTHER_SECTION.match(t):
        return "unknown"
    return None


def segment_cv(text: str) -> list[CvSection]:
    lines = text.split("\n")
    sections: list[CvSection] = []
    current: CvSection | None = None
    preamble: list[str] = []

    for line in lines:
        kind = heading_kind(line)
        if kind:
            if current:
                sections.append(current)
            current = CvSection(kind=kind, heading=line.strip(), body="")
        elif current:
            current.body += line + "\n"
        else:
            preamble.append(line)

    if current:
        sections.append(current)

    # Phần đầu trước tiêu đề đầu tiên (tên, chức danh, liên hệ) → introduce
    head = "\n".join(preamble).strip()
    if head:
        sections.insert(0, CvSection(kind="introduce", heading="(đầu trang)", body=head))

    out = []
    for s in sections:
        s.body = s.body.strip()
        if s.body:
            out.append(reclassify(s))
    return out


# ── Phân loại lại theo NỘI DUNG ────────────────────────────────────────────

# Tên ngôn ngữ và thước đo trình độ — dấu hiệu của mục ngoại ngữ THẬT
LANG_SIGNALS = re.compile(
    r"\b(english|vietnamese|japanese|chinese|korean|french|german|spanish"
    r"|mandarin|cantonese|russian|thai"
    r"|tiếng\s+(anh|việt|nhật|trung|hàn|pháp|đức|nga)"
    # Dạng rút gọn hay gặp trong CV Việt: "Anh văn", "Nhật (N2)"
    r"|(anh|nhật|trung|hàn|pháp|đức)\s*(văn|\(|:)"
    r"|ielts|toeic|toefl|jlpt|hsk|topik|delf|dele|n[1-5]\b|[abc][12]\b"
    r"|native|fluent|conversational|intermediate|beginner|proficien"
    r"|bản ngữ|thành thạo|giao tiếp|cơ bản|khá)\b",
    re.I,
)

def reclassify(section: CvSection) -> CvSection:
    """
    Sửa lại loại mục khi TIÊU ĐỀ nói một đằng, NỘI DUNG một nẻo.

    Trường hợp bắt buộc phải xử lý: trong CV ngành IT, "Languages" thường là
    NGÔN NGỮ LẬP TRÌNH, không phải ngoại ngữ. Đo trên CV-07 thật: cả tech stack
    (811 ký tự — PHP, TypeScript, Laravel, MySQL, Vite…) rơi vào `languages`,
    và `skills` ra RỖNG. Kỹ năng là trường mà đối chiếu JD phụ thuộc nhất, nên
    mất nó là mất phần lớn giá trị của sản phẩm.

    CV-07 còn có cả hai mục cùng lúc — "Languages" (tech) và "Language"
    (English) — nên không thể quyết định bằng tiêu đề, chỉ nội dung mới phân
    biệt được.
    """
    if section.kind != "languages":
        return section

    body = section.body
    if LANG_SIGNALS.search(body):
        return section  # có tên ngôn ngữ / thước đo trình độ → đúng là ngoại ngữ

    # KHÔNG có tên ngôn ngữ nào → không phải mục ngoại ngữ.
    #
    # Quy tắc đảo ngược có chủ đích: một mục ngoại ngữ thật LUÔN nêu tên ít
    # nhất một ngôn ngữ. Nếu tìm dấu hiệu "trông giống tech" thì phải duy trì
    # một danh sách công nghệ không bao giờ đầy đủ, và mỗi framework mới ra đời
    # lại là một lần bỏ sót. Nhận diện tên ngôn ngữ thì tập hữu hạn và ổn định.
    section.kind = "skills"
    return section


def merge_by_kind(sections: list[CvSection]) -> dict[str, str]:
    """Gộp mục cùng loại — CV hay tách 'Work Experience' và 'Internships'."""
    out: dict[str, str] = {}
    for s in sections:
        chunk = f"{s.heading}\n{s.body}"
        out[s.kind] = f"{out[s.kind]}\n\n{chunk}" if s.kind in out else chunk
    return out
