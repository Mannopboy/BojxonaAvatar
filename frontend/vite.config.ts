import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Backend manzili — standart :8000. Port band bo'lsa (masalan boshqa loyiha ishlayotgan bo'lsa),
  // frontend/.env.local (git'ga kirmaydi) ga yozing:  BACKEND_ORIGIN=http://127.0.0.1:8010
  const backend = loadEnv(mode, process.cwd(), "").BACKEND_ORIGIN || "http://127.0.0.1:8000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // Backend'ga proxy — kalit frontend'ga chiqmaydi (ADR-003)
        "/api": {
          target: backend,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
        // Gemini Live real-time audio (WebSocket)
        "/ws": {
          target: backend.replace(/^http/, "ws"),
          ws: true,
        },
      },
    },
  };
});
