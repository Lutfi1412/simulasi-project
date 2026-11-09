# Satu image: build UI (Vite) lalu jalankan server Bun yang menyajikan UI + API + WS.
FROM oven/bun:1 AS build
WORKDIR /app
ENV NODE_ENV=development

# dependensi dulu supaya layer cache dipakai ulang saat source berubah
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile

COPY . .
# NODE_ENV=production khusus untuk build UI: kalau tetap development, Vite membundel
# React versi dev (bundel ~2x lebih besar dan lebih lambat di browser).
ENV NODE_ENV=production
RUN bun run --cwd apps/web build

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

COPY --from=build /app /app

# data hasil rekaman live (menit, sinyal, state bot) ditulis ke sini
RUN mkdir -p /app/apps/server/data/minutes /app/apps/server/data/signals /app/apps/server/data/state

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "apps/server/src/index.ts"]
