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

## 3. Probar un caso sin reparación automática

Elegí `ValueError · shape` y analizá. El comportamiento correcto no es inventar un patch: debe aparecer `Revisión manual requerida`, explicar que hay que comparar la cantidad real de features contra el contrato del modelo y mostrar `ESCALAMIENTO · NIVEL 2` con `Muse Glimmer · no conectado`.

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

## 5. Cómo leer los flags

En `Flags de ejecución`, cada función publica su resultado:

- punto azul: función iniciada;
- tilde verde: función terminada correctamente;
- signo rojo: función falló;
- tiempo a la derecha: duración registrada cuando existe.

Si una función falla, el popup explica la causa. El orden de flags indica hasta dónde llegó la sesión. Por ejemplo, si aparece `classifyError` pero no `selectContext`, el problema ocurrió antes de seleccionar el contexto.

## 6. Cómo leer el contexto

`Contexto que viajaría` muestra solamente las líneas seleccionadas alrededor del error y el traceback, con rutas locales y correos reemplazados por `<ruta>` y `<email>`. Las filas del dataset no se leen.

En esta versión el contexto no viaja a ningún modelo: se muestra para auditar la futura integración.

## 7. Señales de que algo no funciona

- El botón no responde: revisar la consola del navegador y correr `npm run check`.
- Aparece `Revisión manual requerida`: no es un crash; significa que no hay evidencia suficiente para un patch seguro.
- Un checker rojo después del patch: el patch fue aplicado pero no cumple la condición; conservar el código anterior y revisar el diff.
- No aparecen flags: la corrida no llegó al orquestador; revisar el popup y el primer error de consola.
- `npm run dev` no inicia: revisar que el puerto 5173 esté libre.

## 8. Qué todavía no hace

Este tutorial cubre el MVP de análisis determinista. Todavía falta ejecutar Python real con Pyodide dentro de un Web Worker, cargar `.py`/`.ipynb`, persistir sesiones en IndexedDB y conectar modelos de Meta en modo benchmark.
