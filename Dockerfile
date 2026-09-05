FROM oven/bun:1.4.1 AS builder
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1.4.1 AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=bun:bun /app/.output ./.output
RUN mkdir -p /app/irminsul-data && chown bun:bun /app/irminsul-data

USER bun
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
