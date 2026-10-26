# Estado de avance

Fecha de arranque: 25 de octubre de 2026.

## Hecho

- Especificación funcional del MVP relevada desde `BrowserMind_Data_MVP_v3.pdf`.
- Estructura inicial React + TypeScript + Vite.
- Núcleo local con parser, clasificador, selector de contexto, patches y checkers.
- Cinco casos semilla reproducibles.
- Flags de función y popup de estado/error.
- Pruebas de regresión del núcleo y del adaptador (33 casos, incluidos flujos de punta a punta y fetch simulado).
- Adaptador de Muse Glimmer (nivel 2) en modo benchmark con consentimiento explícito, proxy con key del lado servidor, métricas de llamadas/tokens/latencia y checkers de merge, shape y alcance del patch (25 oct).
- Revisión de buenas prácticas (25 oct): `npm run check` ahora compila de verdad; dependencias fijadas; checkers independientes del patch; limpieza de NaN insertada antes de `fit`; alias de columna sólo si es único; redacción real de rutas y correos; la edición del código invalida el análisis; plan de escalamiento a Meta visible.
- Cierre de auditoría: completadas las métricas `generativeTokens`/`modelLatencyMs`, agregado el `origin` obligatorio de los patches de prueba y sincronizado el lockfile con versiones exactas.
- Prácticas de vibecoding incorporadas: `npm run qa`, `AGENTS.md`, registro de fuentes, checklist de diff y `ModelHarness` para tokens, latencia y validación estructural de respuestas de modelos.
- QA de producto visible y ejecutable: cinco contratos semilla con verificación de diagnóstico, patch/checkers, revisión manual y regresión sin API.
- Correcciones de seguridad de patches generados (25 oct): fragmento único y un solo reemplazo; definiciones lejanas enviadas como sólo lectura; el editor conserva el código si un checker rechaza el patch.

## Próximo orden

1. Ejecutar código real con Pyodide en Web Worker y capturar traceback real.
2. Agregar lector de `.py` y `.ipynb` con memoria de sesión IndexedDB.
3. Agregar selector progresivo de contexto y presupuesto de tokens más fino.
4. Reintentos con diff y traceback cuando un checker rechaza el patch generado; Spark (nivel 3) opcional.
5. Ejecutar contra un proveedor real de Glimmer y comparar tokens/latencia/calidad.
6. Benchmark de 15-30 tareas y modo replay.

## Decisión de diseño

El sitio Jev Mini Bench compartido refuerza una regla útil para BrowserMind: las decisiones cerradas y de baja ambigüedad deben resolverse con salidas tipadas y rápidas; el modelo generativo se reserva para acciones que realmente requieren código nuevo. En este MVP eso se expresa como reglas locales + checker antes de cualquier escalamiento.
