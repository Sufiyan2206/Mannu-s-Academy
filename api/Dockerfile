# Build the React app, then run Flask (gunicorn) which serves both the API and the built app.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ ./
COPY db/ /app/db/
COPY --from=web /web/dist /app/web-dist
ENV MIGRATIONS_DIR=/app/db/migrations PYTHONUNBUFFERED=1
EXPOSE 8000
# migrations run on every start (they only apply what is new), then the server starts
CMD ["sh", "-c", "python -m app.migrate && gunicorn -w 3 -b 0.0.0.0:8000 wsgi:app"]
