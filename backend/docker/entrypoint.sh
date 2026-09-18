#!/usr/bin/env sh
# Konteyner start — DB jadval + 3 FAQ seed (idempotent), so'ng server.
# (Alembic yo'q — jadvallar create_all bilan; seed idempotent.)
set -e

echo "[entrypoint] DB seed (jadval + 3 FAQ)..."
python -m app.seed

echo "[entrypoint] uvicorn ishga tushmoqda :8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
