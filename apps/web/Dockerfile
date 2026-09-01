FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
RUN pnpm --filter @trunkscope/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /source/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
EXPOSE 80
