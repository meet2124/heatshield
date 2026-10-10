# ─── HeatShield Backend ──────────────────────────────────────────────────────
# Multi-stage build to keep the final image lean.
# Runs as a non-root user (appuser) on the port provided by the platform.
# AWS App Runner injects PORT; default to 8000 for local docker run.

FROM python:3.12-slim AS builder

WORKDIR /app

# Install dependencies into a separate prefix so we can copy only them
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Create a non-root user and switch to it
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

# Port: App Runner sets PORT; local docker run can override with -e PORT=xxxx
ENV PORT=8000
EXPOSE 8000

# Health check (App Runner also polls /health)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/health')"

# Start uvicorn bound to 0.0.0.0 with the platform-provided port.
# --no-access-log keeps logs clean; errors still appear on stderr.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --no-access-log"]
