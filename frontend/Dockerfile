# BojxonaAvatar frontend — Vite build → nginx static (ADR-007 deploy)

# --- build bosqichi ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build      # → dist/ (public/avatar.web.glb ham nusxalanadi)

# --- serve bosqichi (yengil nginx) ---
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
