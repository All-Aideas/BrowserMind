# Fuentes y proveniencia

La proveniencia evita mezclar datos reales, decisiones del equipo y sugerencias de una IA.

## Etiquetas

- **Fuente del usuario:** material entregado por el equipo o incluido explícitamente en la tarea.
- **Propio:** decisión, código o medición producida dentro de este proyecto.
- **Sugerido por IA:** propuesta que todavía requiere revisión humana.
- **Ilustrativo:** ejemplo sintético que no representa una medición real.

## Registro actual

| Elemento | Etiqueta | Uso |
| --- | --- | --- |
| `BrowserMind_Data_MVP_v3.pdf` | Fuente del usuario | Especificación funcional del MVP |
| Charla «Vibecoding» (`charla.html`, archivo local no incluido en el repo) | Fuente del usuario | Prácticas de trabajo colaborativo con IA; no es runtime |
| Cinco casos de `src/core/samples.ts` | Ilustrativo | Benchmark sintético reproducible |
| Reglas locales y checkers | Propio | Código implementado y testeado en este repo |
| `ModelAdapter` / `GlimmerAdapter` | Sugerido por IA + propio | Adaptador implementado y probado con un endpoint simulado; todavía no reproducido contra un Glimmer real |
| Documentación oficial de [Pyodide Web Worker](https://pyodide.org/en/stable/usage/webworker.html) | Fuente técnica externa | Patrón de worker modular usado para la ejecución local; la descarga se fija a Pyodide 0.26.4 en el código |
| Resultados de `npm test`, `npm run check`, `npm run build` | Propio | Mediciones del estado local, fechadas por la corrida |

## Regla

Una cifra experimental, benchmark, endpoint o comportamiento externo debe indicar fuente, fecha y si fue reproducido. Si no puede verificarse, se marca como ilustrativo o pendiente.
