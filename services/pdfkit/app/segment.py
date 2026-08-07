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
    "summary",
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
    ("summary", re.compile(
        r"^(summary|profile|objective|about( me)?|introduction"
        r"|giới thiệu|mục tiêu( nghề nghiệp)?|tóm tắt|sơ lược|bản thân)\b", re.I)),
    ("education", re.compile(
        r"^(education|academic|qualifications?"
        r"|học vấn|trình độ( học vấn)?|quá trình học tập|bằng cấp)\b", re.I)),
    ("work", re.compile(
        r"^(work|experience|employment|professional|career"
        r"|kinh nghiệm( làm việc)?|quá trình công tác)\b", re.I)),
    ("projects", re.compile(r"^(projects?|portfolio|dự án|sản phẩm|đồ án)\b", re.I)),
    ("skills", re.compile(
        r"^(skills?|technical|technologies|competenc|expertise"
        r"|kỹ năng|công nghệ|chuyên môn)\b", re.I)),
    ("certifications", re.compile(
        r"^(certifications?|certificates?|licen[cs]es?|chứng chỉ|chứng nhận)\b", re.I)),
    ("languages", re.compile(r"^(languages?|ngoại ngữ|ngôn ngữ)\b", re.I)),
    ("awards", re.compile(
        r"^(awards?|honou?rs?|achievements?|giải thưởng|thành tích|khen thưởng)\b", re.I)),
    ("activities", re.compile(
        r"^(activities|volunteer|extracurricular|clubs?"
        r"|hoạt động|tình nguyện|câu lạc bộ|ngoại kho[áa])\b", re.I)),
]

BULLET_PREFIX = re.compile(r"^[•▪◦\-–—*·\s]+")
TRAILING_COLON = re.compile(r"[:：]\s*$")


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
    và (khớp từ khoá đã biết HOẶC viết hoa toàn bộ).
    """
    t = TRAILING_COLON.sub("", BULLET_PREFIX.sub("", line.strip()))
    if len(t) < 3 or len(t) > 46:
        return None
    if re.search(r"[.;,]$", t):
        return None
    if len(t.split()) > 5:
        return None

    for kind, pattern in HEADINGS:
        if pattern.match(t):
            return kind

    # ALL CAPS không khớp từ khoá nào → mục lạ, vẫn tách ra để không nuốt mất
    letters = "".join(c for c in t if c.isalpha())
    if len(letters) >= 3 and letters == letters.upper():
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

    # Phần đầu trước tiêu đề đầu tiên (tên, chức danh, liên hệ) → summary
    head = "\n".join(preamble).strip()
    if head:
        sections.insert(0, CvSection(kind="summary", heading="(đầu trang)", body=head))

    out = []
    for s in sections:
        s.body = s.body.strip()
        if s.body:
            out.append(s)
    return out


def merge_by_kind(sections: list[CvSection]) -> dict[str, str]:
    """Gộp mục cùng loại — CV hay tách 'Work Experience' và 'Internships'."""
    out: dict[str, str] = {}
    for s in sections:
        chunk = f"{s.heading}\n{s.body}"
        out[s.kind] = f"{out[s.kind]}\n\n{chunk}" if s.kind in out else chunk
    return out
