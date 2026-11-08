FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TEPU_HOST=0.0.0.0 \
    TEPU_PORT=10000 \
    TEPU_DB_PATH=/data/tepu_tracker.sqlite3

WORKDIR /app
COPY server.py index.html app.js ./
RUN mkdir -p /data

EXPOSE 10000
CMD ["python", "server.py"]

