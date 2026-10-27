# Mini tutorial de BrowserMind Data

## 1. Instalar y levantar

Desde la carpeta del proyecto:

```bash
npm install
npm run dev
```

Abrí `http://localhost:5173`.

Para validar el código sin abrir la interfaz:

```bash
npm test
npm run check
npm run build
```

Los tres comandos deben terminar con código 0.

## 2. Probar el caso feliz: columna ausente

1. En `Caso de benchmark`, elegí `KeyError · columna`.
2. Verificá que el editor muestra `df["revenue"]` y el traceback `KeyError: 'revenue'`.
3. Presioná `Analizar localmente`.

La pantalla correcta debe mostrar:

- etiqueta `missing-column`;
- título `Nombre de columna inexistente`;
- una confianza cercana al 90%;
- contexto seleccionado con líneas y tokens estimados;
- `ESCALAMIENTO · NIVEL 0` con `Reglas locales` y `0 llamadas`;
- patch `Usar la columna existente «revenue_total»`;
- flags exitosos para `parsePython`, `classifyError`, `selectContext`, `proposeRepair` y `runCheckers`.

4. Presioná `Aplicar y verificar`.

El resultado correcto es:

- estado `Checker aprobado`;
- patch aplicado en el editor;
- checkers en verde;
- popup `Patch aplicado y aprobado por los checkers.`;
- el botón pasa a `Patch aplicado` y queda deshabilitado.

Si editás el código o el traceback después de analizar, el resultado se borra y hay que volver a analizar: así un patch viejo nunca pisa tus cambios.

## 2b. Ejecutar una fuente real en Python

1. Presioná `Cargar fuente` y elegí un `.py`, `.txt` o `.ipynb`.
2. Para un notebook, las celdas de código se unen en un editor Python y el markdown se conserva como comentarios; revisá el resultado antes de ejecutarlo.
3. Presioná `Ejecutar Python`. La primera vez se descarga Pyodide desde un CDN versionado dentro de un Web Worker.
4. Revisá el panel `RUNTIME LOCAL · PYODIDE`:
   - `Ejecución aprobada` muestra stdout, imports detectados y duración;
   - `Traceback capturado` muestra stderr/traceback sin convertirlo automáticamente en un patch;
   - `Tiempo agotado` significa que el worker fue terminado por superar 30 segundos;
   - `Runtime no disponible` significa que el navegador no pudo crear el worker o cargar Pyodide.
5. Presioná `Usar traceback y analizar` para encadenar el error capturado con el diagnóstico y pasar por los checkers existentes sin copiar/pegar.

La ejecución y el análisis son pasos separados: que Python corra no demuestra que el resultado sea correcto, y que haya traceback no autoriza a aplicar un patch sin checker.

Si un patch generado por Glimmer falla un checker, aparece `Reintentar con feedback`. El segundo intento recibe el diff y los checkers rojos, pero queda limitado a dos llamadas y 1.024 tokens adicionales; si no alcanza, se conserva el código original.

## 3. Probar un caso sin reparación automática

Con el modo benchmark apagado, elegí `ValueError · shape` y analizá. El comportamiento correcto no es inventar un patch: debe aparecer `Revisión manual requerida`, explicar que hay que comparar la cantidad real de features contra el contrato del modelo y mostrar `ESCALAMIENTO · NIVEL 2` con `Muse Glimmer · no conectado`.

Eso demuestra que el agente distingue entre detectar un problema y tener evidencia suficiente para modificar código.

## 3b. Escalar a Muse Glimmer (modo benchmark)

Requiere `.env.local` configurado (ver README).

1. Activá `Modo benchmark Meta` en el panel 01. El texto aclara que se usa sólo con datos sintéticos o públicos.
2. Elegí `Merge · alineación` y analizá. Debe aparecer `ESCALAMIENTO · NIVEL 2 · Muse Glimmer` (sin `no conectado`) y el botón `Escalar a Muse Glimmer`.
3. Antes de presionarlo, revisá `Contexto que viajaría`: es exactamente lo que se envía.
4. Presioná el botón. Si responde, aparece `PATCH GENERADO · VERIFICAR`, y la fila de escalamiento suma llamadas, tokens y latencia.
5. Presioná `Aplicar y verificar`. El patch se aprueba sólo si pasan `Claves de merge presentes en ambos lados` y `Cambios dentro del contexto enviado`.

Si el endpoint no está levantado, el popup dice `No se pudo conectar con Glimmer` o el código HTTP; el flag `escalateToModel` queda en rojo.

## 4. Probar los cinco casos semilla

| Selector | Debe clasificar como | Resultado esperado |
| --- | --- | --- |
| `KeyError · columna` | `missing-column` | patch de alias y checker |
| `TypeError · tipos` | `type-mismatch` | patch con `pd.to_numeric` y checker |
| `ValueError · shape` | `shape-mismatch` | revisión manual |
| `ValueError · NaN` | `invalid-values` | limpieza insertada antes de `fit` y checker |
| `Merge · alineación` | `merge-alignment` | diagnóstico estructural y revisión manual |

## 4b. Ejecutar la QA del producto

1. Bajá hasta `QA del producto`.
2. Presioná `Ejecutar QA completa`.
3. El resultado esperado es `5/5 aprobados`.

La QA no llama a Glimmer ni necesita key. Comprueba el flujo completo con los datos sintéticos: diagnóstico correcto, reparación local cuando existe, checkers verdes y escalamiento manual para shape/merge. Si cambiás una muestra o una regla y el contrato se rompe, la tarjeta del caso queda roja y muestra en qué etapa falló.

## 4c. Ejecutar el benchmark A–D

1. Bajá hasta `Benchmark A–D` y presioná `Ejecutar benchmark`.
2. El reporte genera 20 tareas: cinco casos semilla para cada configuración.
3. `A` cuenta reglas locales verificadas; `B` mide el mismo flujo con el contexto estimado; `C` (Glimmer) y `D` (Spark) aparecen como `sin configurar` mientras no exista un adaptador real.
4. Una tarea sólo aparece como `resuelta` si el patch se aplica y todos los checkers pasan. `manual` y `sin configurar` no inflan la tasa.

## 4d. Comprobar la memoria local

1. Ejecutá un análisis o un benchmark y recargá la página.
2. El caso, el código, el diagnóstico y el reporte deben reaparecer; el panel lateral debe mostrar `Memoria local · GUARDADA`.
3. Presioná `Borrar memoria` y recargá: la app vuelve a la fuente semilla inicial.
4. La memoria usa IndexedDB local, no guarda credenciales y tiene límites de 500.000 caracteres para la fuente y 100.000 para el traceback.

## 5. Cómo leer los flags

En `Flags de ejecución`, cada función publica su resultado:

- punto azul: función iniciada;
- tilde verde: función terminada correctamente;
- signo rojo: función falló;
- tiempo a la derecha: duración registrada cuando existe.

Si una función falla, el popup explica la causa. El orden de flags indica hasta dónde llegó la sesión. Por ejemplo, si aparece `classifyError` pero no `selectContext`, el problema ocurrió antes de seleccionar el contexto.

## 6. Cómo leer el contexto

`Contexto que viajaría` muestra solamente las líneas seleccionadas alrededor del error y el traceback, con rutas locales y correos reemplazados por `<ruta>` y `<email>`. Las filas del dataset no se leen.

Con el modo benchmark apagado el contexto no viaja a ningún modelo. Con el modo benchmark activo, ese bloque es exactamente lo que se envía al proxy de Glimmer.

## 7. Señales de que algo no funciona

- El botón no responde: revisar la consola del navegador y correr `npm run check`.
- Aparece `Revisión manual requerida`: no es un crash; significa que no hay evidencia suficiente para un patch seguro.
- Un checker rojo después del patch: el patch fue aplicado pero no cumple la condición; conservar el código anterior y revisar el diff.
- No aparecen flags: la corrida no llegó al orquestador; revisar el popup y el primer error de consola.
- `npm run dev` no inicia: revisar que el puerto 5173 esté libre.

## 8. Qué todavía no hace

Este tutorial cubre el MVP de análisis determinista, ejecución local con Pyodide, memoria local y escalamiento benchmark a Glimmer mediante un endpoint compatible con OpenAI. Todavía falta probar con un proveedor real y agregar Spark.
