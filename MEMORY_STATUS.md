# Memory status de BrowserMind Data

Última revisión: 26 de octubre de 2026.

## Estado actual

La memoria persistente está implementada con IndexedDB versionado. El MVP guarda tres categorías separadas bajo la clave `current`:

- `source`: código, traceback, caso seleccionado y modo benchmark;
- `session`: diagnóstico, patch, checkers, flags, métricas y QA de producto;
- `benchmark`: último reporte A–D.

La app restaura ese estado al abrirse y muestra el estado `GUARDADA` en el panel lateral. `Borrar memoria` elimina las tres categorías. No se guarda un dataset separado, un historial de sesiones ni ninguna credencial.

## Privacidad actual

- Sin el modo benchmark activo no hay conexión a un modelo externo.
- Con el modo benchmark activo, sólo al presionar `Escalar a Muse Glimmer` se envía el contexto redactado al endpoint de `.env.local`. No es privacidad total: usar datos sintéticos o públicos.
- No se envían filas del dataset.
- No se usa localStorage ni cookies propias; la persistencia usa sólo IndexedDB local.
- El único servidor actual es el servidor de desarrollo local de Vite.
- El contexto visible en la interfaz se arma desde el código y el traceback de la sesión, con rutas locales y correos redactados.
- Las llamadas, tokens y latencia del modelo quedan dentro de la sesión persistida local; nunca incluyen la API key.
- La ejecución local con Pyodide tampoco persiste código, variables ni paquetes: el worker se crea por corrida y se termina al finalizar.
- La primera ejecución de Python descarga Pyodide desde un CDN versionado; el código del usuario se mantiene en la pestaña y no se envía a Glimmer por esa acción.

Esto es una garantía del estado actual del MVP, no una promesa para futuras integraciones remotas.

## Límites y migración

El esquema actual es `version: 1`, con límite de 500.000 caracteres para la fuente y 100.000 para el traceback. Si IndexedDB no está disponible, el contrato cae a un backend en memoria y la interfaz muestra `NO DISPONIBLE`; no se finge persistencia.

Una futura migración deberá conservar las tres categorías, validar tamaños antes de escribir y mantener el borrado explícito. La persistencia local no cambia la regla de redacción: antes de escalar, el endpoint recibe sólo `session.context` ya filtrado.

## Cómo comprobar el estado hoy

1. Ejecutá un análisis, recargá la página y verificá que código, diagnóstico y benchmark reaparezcan.
2. Ejecutá un `.py`: la salida aparece sólo en la interfaz de esa pestaña; el Web Worker no conserva estado al terminar.
3. En Application/Storage debería aparecer `browsermind-data-memory` con stores `source`, `session` y `benchmark`.
4. En Network puede aparecer la descarga de Pyodide al presionar `Ejecutar Python`; no debería aparecer un endpoint de modelo. La única llamada de modelo posible es `POST /api/glimmer/chat/completions`, al escalar con el modo benchmark.

Los tests de `src/core/memory.test.ts` comprueban persistencia, borrado y límite usando un backend en memoria, sin depender de un navegador real.
