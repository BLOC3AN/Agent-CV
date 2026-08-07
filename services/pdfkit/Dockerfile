FROM python:3.12-slim

# poppler-utils: pdftotext dùng làm engine ĐỐI CHIẾU với PyMuPDF (TDD §8.1.1).
# Thiếu nó thì service vẫn chạy nhưng mất khả năng phát hiện text layer hỏng.
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
