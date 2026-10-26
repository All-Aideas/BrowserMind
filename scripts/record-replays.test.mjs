// Grabador de replays de Muse Spark (T2 + T7). No corre en `npm test`: sólo con `npm run replays:record`.
//
//   npm run replays:record      (con MODEL_API_KEY en .env.local o en el entorno)
//
// Llama a Meta Model API desde Node (la key no se escribe en ningún archivo del repo), aplica
// cada patch con los checkers y escribe public/replays/muse-spark.json para la demo sin key.
// Antes de commitear el JSON, revisalo: contiene el contexto enviado (ya redactado).
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { describe, expect, it } from "vitest";
import { runDiagnosticSession } from "../src/core/engine.ts";
import { MetaModelApiAdapter } from "../src/core/metaModelApi.ts";
import { recordingFetch, toReplayFile } from "../src/core/replay.ts";
import { repairWithRetry } from "../src/core/retry.ts";
import { SAMPLE_CASES } from "../src/core/samples.ts";

// npm define npm_lifecycle_event en todas las plataformas (Windows incluido).
const enabled = process.env.npm_lifecycle_event === "replays:record";
const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
const BASE_URL = env.META_BASE_URL || "https://api.meta.ai/v1";

// Errores reales sin firma en las reglas locales: el plan los manda al nivel 3 (Spark).
export const SPARK_CASES = [
  {
    id: "rolling-window",
    traceback: "ValueError: min_periods 1 must be <= window 0",
    code: [
      "import pandas as pd",
      "result = pd.Series([10, 20, 30]).rolling(window=0).mean()",
      "print(result)",
    ].join("\n"),
  },
  {
    id: "datetime-format",
    traceback: "ValueError: time data \"2024/13/01\" doesn't match format \"%Y/%m/%d\"",
    code: [
      "import pandas as pd",
      "dates = pd.to_datetime([\"2024/13/01\", \"2024/14/01\"], format=\"%Y/%m/%d\")",
      "print(dates)",
    ].join("\n"),
  },
  {
    id: "groupby-agg",
    traceback: "AttributeError: 'SeriesGroupBy' object has no attribute 'average'",
    code: [
      "import pandas as pd",
      "sales = pd.DataFrame({\"region\": [\"a\", \"b\"], \"total\": [1, 2]}).groupby(\"region\")[\"total\"].average()",
      "print(sales)",
    ].join("\n"),
  },
  {
    id: "dataframe-append",
    traceback: "AttributeError: 'DataFrame' object has no attribute 'append'",
    code: [
      "import pandas as pd",
      "rows = pd.DataFrame({\"id\": [1]}).append({\"id\": 2}, ignore_index=True)",
      "print(rows)",
    ].join("\n"),
  },
  {
    id: "numpy-float-alias",
    traceback: "AttributeError: module 'numpy' has no attribute 'float'",
    code: [
      "import numpy as np",
      "weights = np.array([1, 2, 3], dtype=np.float)",
      "print(weights.sum())",
    ].join("\n"),
  },
  {
    id: "sort-ascending-string",
    traceback: "ValueError: For argument \"ascending\" expected type bool, received type str.",
    code: [
      "import pandas as pd",
      "ranked = pd.DataFrame({\"score\": [3, 1, 2]}).sort_values(by=\"score\", ascending=\"False\")",
      "print(ranked)",
    ].join("\n"),
  },
];

describe.skipIf(!enabled)("grabar replays reales de Muse Spark", () => {
  it("graba y verifica cada caso de nivel 3", async () => {
    const key = env.MODEL_API_KEY;
    expect(key, "Falta MODEL_API_KEY en el entorno").toBeTruthy();
    const records = [];
    const authorized = (url, init) => fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${key}` },
    });
    const adapter = new MetaModelApiAdapter({
      endpoint: `${BASE_URL}/chat/completions`,
      fetchImpl: recordingFetch(authorized, records),
    });

    const cases = [...SAMPLE_CASES, ...SPARK_CASES];
    const rows = [];
    for (const item of cases) {
      const session = runDiagnosticSession(item.code, item.traceback, [adapter]);
      if (session.escalation.level !== 3) continue;
      try {
        const result = await repairWithRetry(session, adapter, { maxAttempts: 2 });
        rows.push({
          caso: item.id,
          resultado: result.stoppedBy,
          intentos: result.attempts.length,
          tokens: result.session.metrics.generativeTokens,
          razonamiento: adapter.lastReasoningTokens,
          ms: result.session.metrics.modelLatencyMs,
        });
      } catch (error) {
        rows.push({ caso: item.id, resultado: `error: ${error.message}` });
      }
    }
    console.table(rows);

    mkdirSync("public/replays", { recursive: true });
    writeFileSync("public/replays/muse-spark.json", `${JSON.stringify(toReplayFile(records), null, 2)}\n`);
    const serialized = JSON.stringify(records);
    expect(serialized.includes(key)).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
  }, 300_000);
});
