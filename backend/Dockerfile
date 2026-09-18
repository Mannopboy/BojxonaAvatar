# BojxonaAvatar backend — FastAPI (ADR-007 deploy)
FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Kutubxonalar (manylinux wheels — kompilyatsiya shart emas)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kod
COPY app ./app
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/data

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
