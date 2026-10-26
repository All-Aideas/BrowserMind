# Colaboración entre developers e IA

Este archivo define cómo trabajan dos developers/IA sobre BrowserMind Data. La conversación puede ocurrir en el chat, pero el estado importante queda escrito en el proyecto para que ninguna sesión dependa de memoria externa.

## Roles

### Developer coordinador

- Mantiene el objetivo del producto y decide prioridades.
- Revisa el plan, el diff y el resultado de QA.
- No acepta frases como “funciona” sin comandos, tests o evidencia.
- Puede pedir una segunda opinión antes de aprobar un cambio.

### Developer implementador / IA colaboradora

- Lee primero `AGENTS.md`, `README.md`, `MEMORY_STATUS.md`, `docs/PROGRESS.md`, `docs/QA.md` y este archivo.
- Inspecciona el código real antes de describirlo.
- Hace cambios pequeños y reversibles.
- No borra ni pisa cambios de otro developer.
- Pregunta sólo cuando falta una decisión que cambia el producto; para detalles menores, elige una opción razonable y la documenta.
- Ejecuta QA antes de declarar terminado.

## Estado confirmado al 26 de octubre de 2026

- `npm run qa` pasa.
- Hay 69 tests aprobados en 10 archivos.
- La QA de producto valida 5/5 casos semilla sin API externa.
- React + TypeScript + Vite están funcionando.
- El núcleo clasifica errores, genera patches locales, ejecuta checkers y muestra flags.
- Existe `GlimmerAdapter` compatible con endpoints OpenAI, proxy Vite y modo benchmark.
- `ModelHarness` ya se finaliza con `accepted`/`rejected` y `checkerPassRate` después de la propuesta.
- Existe un benchmark A–D reproducible de 20 tareas; las configuraciones sin modelo real quedan `not-configured`.
- La API real de Glimmer todavía no está configurada ni debe fingirse como probada.
- Pyodide, ejecución local en Web Worker y carga de `.py`/`.ipynb` están implementados.
- IndexedDB versionado para fuente, sesión y benchmark está implementado con borrado explícito y límites de tamaño.

## Fuente de verdad

Leer estos archivos en este orden:

1. `README.md`: qué es el producto y cómo correrlo.
2. `MEMORY_STATUS.md`: qué se guarda y qué no.
3. `docs/PROGRESS.md`: qué está hecho y qué sigue.
4. `docs/QA.md`: qué significa que un cambio esté correcto.
5. `docs/VIBECODING.md`: reglas de trabajo con IA.
6. `docs/SOURCES.md`: qué datos son fuente, propios, sugeridos o ilustrativos.
7. Código y tests del módulo que se va a modificar.

## Mensaje inicial para una tarea nueva

Usar esta estructura para pedir ayuda a la otra IA:

```text
Estamos trabajando sobre el repositorio BrowserMind Data existente.

Objetivo:
[Una sola mejora concreta]

Contexto:
[Qué comportamiento existe hoy y qué problema observamos]

Archivos que podés inspeccionar:
[Rutas relevantes]

Límites:
- No borres cambios existentes.
- No inventes que probaste una API, un navegador o una dependencia si no lo ejecutaste.
- No envíes secretos, datasets ni código privado a endpoints remotos.
- No cambies el comportamiento de los cinco casos semilla sin actualizar el contrato de QA.

Criterio de terminado:
- [Resultado observable]
- [Test o checker que debe pasar]
- [Qué debe ocurrir si falla]

Proceso obligatorio:
1. Inspeccioná el código real.
2. Proponé un plan corto y los archivos a tocar.
3. Implementá el cambio en pasos pequeños.
4. Agregá o actualizá tests.
5. Ejecutá npm run qa.
6. Leé el diff completo.
7. Informá hechos, comandos ejecutados, resultado y pendientes.
```

## Próxima tarea recomendada

Conectar el adaptador de Muse Spark de la otra IA, comparar su resultado con el replay local y ejecutar la prueba real cuando el usuario entregue la key.

## Formato de respuesta de la IA colaboradora

La respuesta final de cada tarea debe contener:

```text
RESULTADO: [terminado / bloqueado / pendiente]

CAMBIOS:
- [archivo] — [qué cambió]

EVIDENCIA:
- Comando: [comando]
- Resultado: [salida resumida]

RIESGOS O LÍMITES:
- [qué no se probó o qué queda pendiente]

SIGUIENTE PASO:
- [una única recomendación]
```

## Reglas de conversación

- El usuario puede escribir libremente en español; se traduce a criterios técnicos sin cambiar su intención.
- La IA puede razonar internamente en inglés si eso mejora la precisión, pero debe devolver el resultado al usuario en español claro.
- Si hay dos interpretaciones posibles, se muestran las opciones y se elige la más segura para avanzar.
- Un test verde no reemplaza leer el diff.
- Una demo visual no reemplaza un checker.
- La ausencia de un traceback no demuestra que el producto haya resuelto el objetivo.
