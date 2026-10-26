# Arquitectura inicial

## Capas

1. `src/App.tsx`: interfaz, carga de casos, editor, popup y visualización de resultados.
2. `src/core/parser.ts`: índice estructural de imports, variables, funciones y líneas.
3. `src/core/diagnostics.ts`: clasificación local y selección de contexto mínimo.
4. `src/core/patches.ts`: propuestas deterministas, aplicación protegida y error ubicable.
5. `src/core/checkers.ts`: verificaciones independientes del traceback.
6. `src/core/escalation.ts`: plan de escalamiento por niveles (0 reglas · 1 modelo pequeño · 2 Muse Glimmer · 3 Muse Spark) y contrato `ModelAdapter`.
7. `src/core/flags.ts`: trazabilidad de cada función pública del núcleo.
8. `src/core/engine.ts`: orquestación de una sesión completa.

## Contrato de cada función de diagnóstico

El núcleo usa `traced(...)` para emitir tres estados: `start`, `success` y `error`. Acepta un `FlagLog` compartido o un sink externo; el sink recibe los flags también cuando la función falla. Los flags incluyen nombre de función, timestamp, duración, mensaje y detalle de recuperación. La UI consume esos eventos y no oculta fallas silenciosas.

## Clasificación

El traceback tiene prioridad sobre el código: si la firma sólo aparece en el código, la confianza baja de 0,9 a 0,6. Cada regla declara si es reparable; `shape-mismatch` y `merge-alignment` no lo son y van a escalamiento.

## Patches y checkers

Un `RepairPatch` declara `mode: "replace" | "insert"`. Los checkers inspeccionan el código resultante por su cuenta (columnas declaradas vs. accedidas, normalización numérica, orden definición → limpieza → `fit`, claves de merge presentes en ambos DataFrames, cantidad de features contra lo que pide el traceback) y no leen el patch, para que una reparación no pueda aprobarse a sí misma.

## Privacidad

El contexto se deriva localmente del código y traceback. `redactSensitive` reemplaza rutas locales y correos en el payload y en la evidencia. El selector no lee filas del dataset y sólo informa símbolos de las líneas elegidas. Además de la ventana de ±2 líneas alrededor del error, suma (hasta 12 líneas) las definiciones de las variables que usa la línea del error, como `readOnlyLines`: el modelo las ve bajo `# definiciones (sólo lectura)` pero no puede modificarlas.

## Modelos de Meta

`planEscalation` decide el nivel: 0 si hay patch local, 2 (Glimmer) si el error está clasificado sin plantilla y 3 (Spark) si la confianza es baja. El nivel queda `available` sólo si hay un `ModelAdapter` de ese nivel (en la UI, cuando el modo benchmark está activo).

`src/core/glimmer.ts` implementa `GlimmerAdapter` (nivel 2) sobre Chat Completions compatible con OpenAI: `temperature: 0`, `max_tokens: 512`, timeout de 30 s y cancelación con `AbortSignal`. Pide JSON `{before, after, explanation}` y tolera bloques ```json y prefijos de número de línea.

`escalateSession` (en `engine.ts`) envía sólo `session.context`, suma `calls`, tokens generativos y latencia, y descarta el patch si `before` no aparece exactamente una vez en el código (si se repite, el reemplazo podría tocar otras líneas, como la definición de los datos). Un patch del modelo se aplica una sola vez. El patch queda marcado `origin: "model"` y no se aplica solo: al aplicarlo corren los checkers del tipo de error más `within-context`, que rechaza cambios fuera de las líneas editables que el modelo recibió.

La API key vive en `.env.local` y la usa el proxy `/api/glimmer` de `vite.config.ts`; el cliente sólo conoce `VITE_GLIMMER_MODEL`.

## Evolución prevista

La interfaz de adaptador seguirá las operaciones del PDF: `index`, `locate`, `select_context`, `apply_patch`, `verify`. El siguiente adaptador de ejecución será Pyodide dentro de un Web Worker, con un checker independiente del generador.
