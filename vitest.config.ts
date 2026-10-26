import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    // La suite es chica y determinista; un solo worker evita que Windows
    // sature el entorno al crecer el número de archivos de regresión.
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
