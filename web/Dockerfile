# Web image: production React build served by nginx. Data bundles are NOT baked in --
# compose mounts the exporter's volume at /usr/share/nginx/html/data, so the engine can
# refresh data without rebuilding this image.
FROM node:22-slim AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# typecheck + vite build (same as `npm run build` locally)
RUN npm run build


FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 80
