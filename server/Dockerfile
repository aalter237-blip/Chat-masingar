# Masingar server image (Node.js 22, SQLite built in)
# Build from the repository root:
#   docker build -f server/Dockerfile -t masingar-server .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/src ./src
COPY web ./web

RUN mkdir -p /app/data /app/uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000
CMD ["node", "src/index.js"]
