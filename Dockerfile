FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PIANO_COACH_ROOT=/app PIANO_COACH_DATA_DIR=/tmp/piano-coach \
    PIANO_COACH_VOICE_PROVIDER=google PORT=8080
WORKDIR /app
COPY apps/server/ ./apps/server/
RUN pip install --no-cache-dir -r apps/server/requirements.txt \
    && pip install --no-cache-dir --no-deps ./apps/server
COPY assets/ ./assets/
COPY prompts/ ./prompts/
COPY --from=web /build/dist ./apps/web/dist
RUN useradd --create-home --uid 10001 coach
USER coach
EXPOSE 8080
CMD ["piano-coach-server"]
