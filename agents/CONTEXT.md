# Contexto compacto (leer primero, ~2 minutos)

Este archivo reemplaza leer todos los docs al arrancar. El estado vivo (tareas, quién hace qué y por qué) está en el canal: `npm run agents -- status --as <A|B>`. Los demás docs se leen **sólo si la tarea los toca**.

## Objetivo

Ganar el **Meta Global AI Developer Hackathon**. Entrega: **4 nov 2026, 21:00 ET**; jurado del 4 al 8 nov. Track indie: se evalúa *creatividad, ambición técnica y que funcione*. Hay que usar modelos o herramientas de Meta (Muse Spark vía Meta Model API, modelos open-weight como Glimmer, Muse Code).

## Producto en una línea

BrowserMind Data: agente local-first que diagnostica y repara errores de Python data science, resuelve con reglas cuando puede, escala a modelos de Meta sólo cuando hace falta, envía el contexto mínimo y verifica cada patch con checkers independientes. Tesis medible: **misma tasa de resolución con menos tokens y menos código expuesto**.

## Estado vs. criterios de aceptación del PDF (26 oct)

| # | Criterio | Estado |
| --- | --- | --- |
| 1 | Carga y ejecuta un script/notebook en el navegador | **No** (sin Pyodide ni carga de archivos) → T1, T5 |
| 2 | Reproduce ≥5 errores | Parcial: 5 casos sintéticos, traceback pegado, no ejecutado → T1 |
| 3 | Corrige automáticamente ≥1 clase | Sí: 3 clases (columna, tipos, NaN) |
| 4 | Checker después del patch | Sí: 7 checkers, incluido alcance del patch del modelo |
| 5 | Muestra el contexto enviado | Sí, redactado, con definiciones de sólo lectura |
| 6 | Registra tokens, llamadas y tiempo | Sí en la sesión; harness sin integrar → T4 |
| 7 | Escala de reglas a Glimmer y opcionalmente Spark | Código listo; **ningún modelo real probado** → T2 |
| 8 | Demo reproducible con datos sintéticos | Local sí; falta deploy y video → T7 |

## Mapa del código (`src/core/`)

`parser` índice y sentencias · `diagnostics` clasificación, contexto y redacción · `patches` reglas locales y aplicación · `checkers` verificación independiente · `escalation` niveles 0-3 y contrato `ModelAdapter` · `glimmer` adaptador compatible con OpenAI · `engine` orquestación (`runDiagnosticSession`, `escalateSession`, `applySessionRepair`) · `harness` registro de llamadas (B) · `productQa` QA de los 5 casos (B) · `flags` trazabilidad. UI: `src/App.tsx`.

## Comandos

`npm run qa` (puerta obligatoria: tests + typecheck + build) · `npm run dev` · `npm run agents -- help`.

## Reglas de convivencia (resumen)

1. Antes de editar: `npm run agents -- status --as <vos>`; si marca conflictos o un archivo cambió hace menos de 5 minutos, coordiná por el canal.
2. Tomá la tarea con `claim` y un `--why`; cerrala con `done` y la evidencia de `npm run qa`.
3. No reviertas ni reescribas trabajo del otro: preguntá con `say --type question`. En `App.tsx`, `styles.css` y `types.ts`, sólo reemplazos puntuales.
4. Nada se sube a GitHub sin pedido del usuario; el repo es público: revisá secretos y rutas locales.
5. Las decisiones que cambian el producto son del usuario: anotalas como `question` con `--to user`.
