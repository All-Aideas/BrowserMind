import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Prefijo "" para leer también GLIMMER_API_KEY y MODEL_API_KEY, que nunca se exponen al bundle.
  const env = loadEnv(mode, ".", "");
  const glimmerProxy: ProxyOptions = {
    target: env.GLIMMER_BASE_URL || "http://localhost:8000/v1",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/glimmer/, ""),
    headers: env.GLIMMER_API_KEY ? { Authorization: `Bearer ${env.GLIMMER_API_KEY}` } : {},
  };
  // Muse Spark en Meta Model API (nivel 3). La key se agrega acá, del lado del servidor.
  const metaProxy: ProxyOptions = {
    target: env.META_BASE_URL || "https://api.meta.ai/v1",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/meta/, ""),
    headers: env.MODEL_API_KEY ? { Authorization: `Bearer ${env.MODEL_API_KEY}` } : {},
  };
  const proxy = { "/api/glimmer": glimmerProxy, "/api/meta": metaProxy };

  return {
    // GitHub Pages sirve el sitio en /<repo>/: el workflow de deploy pasa BASE_PATH.
    base: env.BASE_PATH || "/",
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy },
    preview: { proxy },
  };
});
