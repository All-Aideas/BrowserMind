# Memory status de BrowserMind Data

Última revisión: 25 de octubre de 2026.

## Estado actual

La memoria persistente todavía no está implementada. El MVP guarda el estado únicamente en memoria de la pestaña mediante React:

- código actual;
- traceback actual;
- caso seleccionado;
- diagnóstico de la última corrida;
- patch propuesto o aplicado;
- resultado de los checkers;
- flags de la sesión.

Si se recarga o se cierra la pestaña, ese estado se pierde. No se guarda todavía un dataset, un notebook, un historial de sesiones ni credenciales.

## Privacidad actual

- Sin el modo benchmark activo no hay conexión a un modelo externo.
- Con el modo benchmark activo, sólo al presionar `Escalar a Muse Glimmer` se envía el contexto redactado al endpoint de `.env.local`. No es privacidad total: usar datos sintéticos o públicos.
- No se envían filas del dataset.
- No se usa IndexedDB, localStorage ni cookies propias para persistir código.
- El único servidor actual es el servidor de desarrollo local de Vite.
- El contexto visible en la interfaz se arma desde el código y el traceback de la sesión, con rutas locales y correos redactados.
- Las llamadas, tokens y latencia del modelo sólo viven en la sesión de la pestaña.

Esto es una garantía del estado actual del MVP, no una promesa para futuras integraciones remotas.

## Próxima memoria prevista

La siguiente etapa agregará IndexedDB con tres niveles separados:

1. `session`: diagnóstico, flags, métricas y estado de la corrida;
2. `source`: código o notebook elegido por el usuario, con borrado explícito;
3. `benchmark`: casos sintéticos versionados, sin datos personales.

La implementación deberá incluir:

- botón visible para borrar una sesión;
- límite de tamaño y retención;
- versionado de esquema;
- migración segura;
- indicación clara de qué dato se guarda;
- redacción antes de cualquier escalamiento a un endpoint.

## Cómo comprobar el estado hoy

1. Abrí DevTools del navegador y recargá la página: el diagnóstico vuelve a `Esperando análisis`.
2. Ejecutá un caso: los datos aparecen sólo en la interfaz de esa pestaña.
3. En Application/Storage no debería existir una base IndexedDB creada por BrowserMind.
4. En Network no debería aparecer una llamada a un endpoint de modelo al usar `Analizar localmente` o `Aplicar y verificar`. La única llamada posible es `POST /api/glimmer/chat/completions`, al escalar.

Cuando IndexedDB se implemente, este archivo debe actualizarse y los tests deben comprobar persistencia, borrado y redacción.
