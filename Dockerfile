FROM node:20-slim AS frontend-builder
WORKDIR /app/web

COPY web/package.json web/package-lock.json* ./
RUN npm install

COPY web/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY LICENSE ./

COPY --from=frontend-builder /app/web/dist ./web/dist

EXPOSE 8000 8888

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
