import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Prefijo "" para leer también GLIMMER_API_KEY, que nunca se expone al bundle.
  const env = loadEnv(mode, ".", "");
  const glimmerProxy: ProxyOptions = {
    target: env.GLIMMER_BASE_URL || "http://localhost:8000/v1",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/glimmer/, ""),
    headers: env.GLIMMER_API_KEY ? { Authorization: `Bearer ${env.GLIMMER_API_KEY}` } : {},
  };
  const proxy = { "/api/glimmer": glimmerProxy };

  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy },
    preview: { proxy },
  };
});
