ARG BUILD_FROM=ghcr.io/home-assistant/base:latest
FROM ${BUILD_FROM}

WORKDIR /app

RUN apk add --no-cache nodejs npm ca-certificates

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY run.sh /run.sh
RUN chmod 0755 /run.sh

ENV NODE_ENV=production
ENV PORT=52932
EXPOSE 52932

CMD ["/run.sh"]
