# BrowserMind Data

MVP local-first para diagnosticar y reparar errores reproducibles de Python en data science. La especificación inicial está en [`BrowserMind_Data_MVP_v3.pdf`](./BrowserMind_Data_MVP_v3.pdf).

## Estado actual

Esta primera vertical ya permite:

- cargar uno de cinco casos reproducibles de benchmark;
- indexar imports, variables y funciones de un script Python;
- clasificar cinco familias de error;
- seleccionar un contexto mínimo, redactar rutas y correos, y mostrar qué se enviaría;
- planificar el escalamiento a modelos de Meta (nivel 0 reglas → 2 Glimmer → 3 Spark);
- en modo benchmark, pedir un patch a Muse Glimmer con el contexto redactado y verificarlo con los mismos checkers;
- proponer y aplicar reparaciones deterministas en los casos seguros;
- ejecutar checkers explícitos y mostrar su resultado;
- ejecutar una QA de producto sobre los cinco casos semilla y mostrar un resultado `N/N`;
- cargar `.py`, `.txt` y `.ipynb`, convirtiendo las celdas del notebook a una fuente revisable;
- ejecutar Python localmente dentro de un Web Worker con Pyodide bajo demanda y capturar stdout, stderr, traceback y timeout;
- ejecutar un benchmark reproducible de 20 tareas (cinco casos × configuraciones A–D) sin contar modelos no conectados como éxitos;
- conservar fuente, sesión, QA y benchmark en IndexedDB versionado, con límite de tamaño y borrado explícito;
- emitir flags de inicio, éxito y error para cada función del núcleo;
- dejar visible un popup cuando una operación falla, con causa y estado.

Todavía no se simula como terminado lo que falta: Muse Spark (nivel 3) y validación contra un proveedor real de Glimmer. Pyodide se descarga desde un CDN versionado sólo cuando presionás `Ejecutar Python`; la primera ejecución requiere conexión y todavía no hay paquetes locales precargados.

## Conectar Muse Glimmer (modo benchmark)

Muse Glimmer es open-weight: Meta no lo sirve en su Model API, así que hace falta un endpoint compatible con OpenAI (vLLM o SGLang propio, Together, NVIDIA).

1. Copiá `.env.example` a `.env.local` y completá `GLIMMER_BASE_URL`, `GLIMMER_API_KEY` (si el proveedor la pide) y `VITE_GLIMMER_MODEL`.
2. Reiniciá `npm run dev`. El navegador llama a `/api/glimmer`; el proxy de Vite agrega la key del lado del servidor, así que nunca entra al bundle.
3. En la app, activá `Modo benchmark Meta`, analizá `Merge · alineación` o `ValueError · shape` y presioná `Escalar a Muse Glimmer`.

El proxy existe en `npm run dev` y `npm run preview`; un deploy estático necesita su propio backend para guardar la key. Están documentados como próximas etapas.

## ¿Por qué TypeScript y no Rust o Go?

Porque este MVP vive primero en el navegador. TypeScript permite construir la interfaz, el orquestador, los flags y los checkers en el mismo entorno que después va a ejecutar Pyodide y Web Workers.

| Opción | Ventaja | Motivo para no usarla como base ahora |
| --- | --- | --- |
| TypeScript | Integración directa con React, navegador, Web Workers y WebAssembly | Es la mejor opción para validar rápido el flujo de producto |
| Rust | Excelente rendimiento y seguridad; puede compilar a WebAssembly | Agrega toolchain y una frontera entre UI y motor antes de tener casos estabilizados |
| Go | Muy bueno para un backend, CLI o servicio de benchmark | No reemplaza la capa de UI del navegador y agrega un proceso separado |

Rust puede entrar más adelante como un motor WASM para parsing o sandboxing. Go puede servir para un runner de benchmark o API. La separación actual del núcleo (`src/core`) permite hacerlo sin reescribir la interfaz.

## Ejecutar

```bash
npm install
npm run dev
```

Abrir `http://localhost:5173`.

## QA

```bash
npm test
npm run check
npm run build
npm run qa
```

`npm run check` compila los proyectos de `tsconfig.app.json` y `tsconfig.node.json` (`tsc -b`). `npm run qa` es la puerta completa. Las reglas de QA y regresión están en [`docs/QA.md`](./docs/QA.md), y las prácticas de vibecoding en [`docs/VIBECODING.md`](./docs/VIBECODING.md). El estado de implementación y la próxima secuencia están en [`docs/PROGRESS.md`](./docs/PROGRESS.md).

## Tutorial rápido

El paso a paso completo está en [`docs/TUTORIAL.md`](./docs/TUTORIAL.md). Para una prueba rápida:

1. Ejecutá `npm run dev`.
2. Abrí `http://localhost:5173`.
3. Dejá seleccionado `KeyError · columna`.
4. Presioná `Analizar localmente`.
5. Confirmá que aparece `missing-column`, una propuesta de `revenue` a `revenue_total` y flags verdes.
6. Presioná `Aplicar y verificar`.
7. El resultado correcto es `Checker aprobado`, checkers en verde y el popup `Patch aplicado y aprobado por los checkers.`

También podés presionar `Ejecutar QA completa` en la sección `QA del producto`. Esa corrida no usa API: comprueba clasificación, existencia de patch, checkers, estado final y escalamiento manual sobre los cinco casos.

Para probar ejecución real, presioná `Cargar fuente` con un `.py` o `.ipynb` y después `Ejecutar Python`. La primera corrida puede tardar porque carga Pyodide en un Web Worker; el resultado muestra estado, duración, imports detectados y salida o traceback. Un timeout o un runtime no disponible se informa como estado distinto de un error de Python.

La memoria local se activa automáticamente en navegadores con IndexedDB. Guarda la fuente, el diagnóstico, la QA y el benchmark sólo en este dispositivo; el panel lateral muestra su estado y permite `Borrar memoria`. No guarda credenciales ni envía nada a un endpoint remoto. El límite es de 500.000 caracteres para la fuente y 100.000 para el traceback.

El panel `Benchmark A–D` ejecuta una comparación reproducible: A usa reglas locales, B mide reglas más contexto, y C/D dejan Glimmer/Spark como `sin configurar` hasta conectar un modelo real. Sólo una reparación que pasa todos los checkers cuenta como resuelta.

Para conocer qué se conserva entre corridas, revisá [`MEMORY_STATUS.md`](./MEMORY_STATUS.md).

El protocolo para trabajar entre dos developers o IA está en [`docs/AI_COLLABORATION.md`](./docs/AI_COLLABORATION.md).

El recorrido recomendado para presentar el producto está en [`docs/DEMO_SCRIPT.md`](./docs/DEMO_SCRIPT.md). La CI ejecuta `npm run qa` en cada push y pull request.
