FROM node:22-alpine

# ماسنجر لايت — صورة صغيرة جداً: لا قواعد بيانات ولا تجميع native
WORKDIR /app

COPY server/package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server/src ./src
COPY web ./web

ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data

EXPOSE 3000
CMD ["node", "src/index.js"]
