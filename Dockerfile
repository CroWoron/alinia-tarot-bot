FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV DATA_DIR=/app/data \
    PYTHONUNBUFFERED=1

COPY . .

CMD ["python3", "bot/vk_bot.py"]
