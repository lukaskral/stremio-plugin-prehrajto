FROM node:24-alpine

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.ts addon.ts ./
COPY src ./src
COPY run.sh /run.sh

RUN chmod 0755 /run.sh

ENV NODE_ENV=production
ENV PORT=52932

EXPOSE 52932

CMD ["/run.sh"]
