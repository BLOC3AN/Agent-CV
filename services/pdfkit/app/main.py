"""
pdfkit — service trích text + chia mục từ PDF. TDD §8.1, §12.1.

Service Python DUY NHẤT của hệ thống. Tồn tại vì pdfplumber/PyMuPDF vượt trội
thư viện JS về trích xuất bố cục, và đó là chỗ chất lượng parse CV được quyết
định (TDD §3.2).

KHÔNG gọi LLM, KHÔNG chạm DB. Chỉ nhận PDF, trả text + metadata.
"""
from __future__ import annotations

import base64
import os
import tempfile
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from .extract import extract_pdf, render_pages
from .segment import merge_by_kind, segment_cv

MAX_BYTES = int(os.getenv("PDFKIT_MAX_BYTES", str(12 * 1024 * 1024)))

app = FastAPI(
    title="HR-Agent pdfkit",
    description="Trích text + chia mục từ PDF, kèm cổng kiểm tra chất lượng",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "pdfkit"}


async def _read_pdf(file: UploadFile) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(400, "File rỗng")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"File vượt {MAX_BYTES // 1024 // 1024}MB")
    # Nhận diện bằng NỘI DUNG, không tin phần mở rộng: CV-09 trong bộ eval là
    # ảnh đổi đuôi thành .pdf — người dùng thật cũng hay làm vậy.
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Không phải file PDF (thiếu chữ ký %PDF)")
    return data


@app.post("/extract")
async def extract(
    file: Annotated[UploadFile, File()],
    include_blocks: Annotated[bool, Query(alias="includeBlocks")] = False,
) -> JSONResponse:
    """
    Trích text kèm cổng chất lượng (TDD §8.1.1).

    `quality` quyết định worker đi nhánh nào:
      · good    → dùng text luôn
      · suspect → nên đi đường ảnh (OCR), text chỉ để đối chiếu
      · none    → BẮT BUỘC đường ảnh
    """
    data = await _read_pdf(file)
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            result = extract_pdf(tmp.name)
        except Exception as e:  # PDF hỏng, mã hoá, cấu trúc lạ
            raise HTTPException(422, f"Không đọc được PDF: {e}") from e

    payload = result.to_dict()
    if not include_blocks:
        payload.pop("blocks", None)
    return JSONResponse(payload)


@app.post("/segment")
async def segment(
    file: Annotated[UploadFile, File()],
) -> JSONResponse:
    """Trích + chia mục trong một lượt — worker thường cần cả hai."""
    data = await _read_pdf(file)
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            result = extract_pdf(tmp.name)
        except Exception as e:
            raise HTTPException(422, f"Không đọc được PDF: {e}") from e

    sections = segment_cv(result.text) if result.text else []
    payload = result.to_dict()
    payload.pop("blocks", None)
    payload["sections"] = [s.to_dict() for s in sections]
    payload["merged"] = merge_by_kind(sections)
    return JSONResponse(payload)


@app.post("/render")
async def render(
    file: Annotated[UploadFile, File()],
    dpi: Annotated[int, Query(ge=72, le=300)] = 200,
    max_pages: Annotated[int, Query(alias="maxPages", ge=1, le=20)] = 10,
) -> JSONResponse:
    """
    Render trang thành PNG base64 — dùng cho:
      · đường OCR khi text layer hỏng (M2-2)
      · màn hình rà soát tô sáng vùng (UC-22)
    """
    data = await _read_pdf(file)
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            pages = render_pages(tmp.name, dpi=dpi, max_pages=max_pages)
        except Exception as e:
            raise HTTPException(422, f"Không render được PDF: {e}") from e

    return JSONResponse(
        {
            "dpi": dpi,
            "pages": [
                {"index": i, "png": base64.b64encode(p).decode("ascii")}
                for i, p in enumerate(pages)
            ],
        }
    )
