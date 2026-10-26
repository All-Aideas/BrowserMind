# Entrega al Meta Global AI Developer Hackathon (borrador)

Entrega: **4 nov 2026, 21:00 ET** · track indie · se evalúa creatividad, ambición técnica y que funcione.
Este archivo es un borrador vivo: los datos marcados con **[pendiente]** se completan con evidencia real, no se estiman.

## Nombre y frase

**BrowserMind Data** — un agente que repara errores de Python data science sin mandarle tu código a nadie que no lo necesite.

## Problema

Cuando un notebook de pandas o scikit-learn falla, la reacción habitual es pegar el script entero (y a veces datos) en un chat. Eso expone código y rutas privadas, gasta tokens en contexto irrelevante y devuelve parches que nadie verifica: «desapareció el traceback» no significa «quedó bien».

## Qué hace

1. **Reproduce** el error en el navegador (Pyodide en un Web Worker): el traceback es real, no pegado.
2. **Diagnostica con reglas locales** cinco familias de error (columna inexistente, tipos, shape, NaN/infinito, merge). Si una plantilla segura alcanza, repara sin llamar a ningún modelo (nivel 0).
3. **Escala sólo cuando hace falta**: Muse Glimmer (nivel 2) para errores clasificados sin plantilla, **Muse Spark vía Meta Model API** (nivel 3) para errores sin firma conocida.
4. **Envía el contexto mínimo y redactado**: unas pocas líneas alrededor del error, definiciones de sólo lectura, sin rutas ni correos ni filas del dataset. La UI muestra exactamente qué viajó.
5. **Verifica cada patch con checkers independientes**: sintaxis, el chequeo propio del tipo de error y que el modelo no haya tocado líneas fuera de lo que recibió. Si un checker rechaza, reintenta una vez con el diff y el motivo, dentro de un presupuesto de tokens.
6. **Mide**: llamadas, tokens (incluidos los de razonamiento de Spark), latencia y resultado de cada llamada en un harness.

## Uso de modelos de Meta

- **Muse Spark** (`muse-spark-1.3`) por Meta Model API (`api.meta.ai/v1`, Chat Completions compatible con OpenAI), con `response_format: json_schema` para que el patch llegue con forma fija. La key queda en el servidor (proxy), nunca en el bundle.
- **Muse Glimmer** (open-weight) por cualquier endpoint compatible con OpenAI; si no está configurado, Spark atiende el nivel 2 como respaldo, y la UI lo dice.
- **Modo replay**: las respuestas reales de Spark se graban (`npm run replays:record`) y la demo pública las reproduce sin key ni backend. Si el contexto cambia, el replay no inventa una respuesta: devuelve 404.

## Tesis medible

**Misma tasa de resolución con menos tokens y menos código expuesto.**

| Configuración | % resuelto | % sin generación | Tokens por tarea resuelta | Llamadas | Latencia |
| --- | --- | --- | --- | --- | --- |
| A · todo al modelo grande | [pendiente: T3] | | | | |
| B · reglas + Spark | [pendiente: T3] | | | | |
| C · reglas + Glimmer/Spark + reintento | [pendiente: T3] | | | | |
| D · … | [pendiente: T3] | | | | |

Corrida real de Spark sobre los casos de nivel 3: [pendiente: tabla de `npm run replays:record`].

## Ambición técnica (lo que no es un wrapper)

- Python real en el navegador (Pyodide + Web Worker), sin servidor de ejecución.
- Selección de contexto por índice del script: ventana alrededor del error + definiciones lejanas como sólo lectura.
- Validación en capas: el fragmento a reemplazar debe aparecer exactamente una vez; después, checkers; después, ejecución.
- Reintento con feedback acotado y presupuesto de tokens.
- Replay determinista por hash del pedido: demo reproducible sin exponer la key.
- Dos agentes de IA desarrollando en paralelo con un canal propio (`agents/`): tablero con el porqué de cada tarea, mensajes y detección de conflictos.

## Límites (dichos de frente)

- Cinco familias de error con reglas; el resto depende del modelo y del checker de ejecución.
- En errores sin firma conocida, «verificado» exige ejecutar el patch (Pyodide); sin runtime sólo cubre sintaxis y alcance.
- El proxy de la key existe en `npm run dev`/`preview`; el deploy público usa replay.

## Guion del video (2-3 min)

1. **0:00-0:20 · Problema.** Un notebook falla; la costumbre es pegar todo en un chat. Mostrar el script con rutas privadas.
2. **0:20-0:50 · Nivel 0.** Caso `KeyError · columna`: Ejecutar Python (traceback real) → diagnóstico → patch por reglas → checkers en verde → **0 llamadas, 0 tokens**.
3. **0:50-1:40 · Nivel 3 con Spark.** Un error sin firma (por ejemplo, `rolling(window=0)`): mostrar el panel «contexto enviado» (pocas líneas, rutas redactadas) → Escalar a Muse Spark → patch → checkers + ejecución → tokens, tokens de razonamiento y latencia.
4. **1:40-2:10 · Rechazo y reintento.** Un patch que toca una línea fuera del contexto: el checker lo rechaza, el reintento recibe el diff y el motivo, el segundo intento pasa.
5. **2:10-2:40 · Números.** Tabla de la tesis (T3) y cierre: menos tokens, menos código expuesto, cada patch verificado.

## Checklist hasta la entrega

- [ ] Cargar `MODEL_API_KEY` y correr `npm run replays:record`; revisar y commitear `public/replays/muse-spark.json`.
- [ ] Integrar `createModelAdapters` y `repairWithRetry` en la UI (B, tras pushear T1-T5).
- [ ] Benchmark T3 con números reales en la tabla de arriba.
- [ ] Deploy público en modo replay (T7) y URL acá.
- [ ] Video grabado siguiendo el guion.
- [ ] Licencia (T8, decide el usuario).
- [ ] `npm run qa` en verde en `main` y CI en verde.
- [ ] Revisar el repo público: sin keys, sin rutas locales, sin datos privados.
