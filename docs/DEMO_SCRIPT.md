# Demo para el jurado

Duración objetivo: 3–5 minutos. Usar datos sintéticos; no activar Glimmer hasta tener un endpoint y una key configurados.

## Recorrido principal

1. Ejecutar `npm run dev` y abrir `http://localhost:5173`.
2. En `Caso de benchmark`, dejar `KeyError · columna`.
3. Mostrar el código con `revenue` y el traceback.
4. Presionar `Analizar localmente`: señalar `missing-column`, contexto mínimo, flags y nivel 0.
5. Presionar `Aplicar y verificar`: señalar el diff y los checkers verdes.
6. Presionar `Ejecutar Python`: Pyodide se carga en un Web Worker; si el runtime captura un traceback, usar `Usar traceback y analizar`.
7. Ejecutar `QA del producto`: mostrar `5/5 aprobados`.
8. Ejecutar `Benchmark A–D`: mostrar `20` tareas, las reparaciones verificadas y que Glimmer/Spark quedan `sin configurar`, sin inflar la métrica.

## Escalamiento

1. Activar `Modo benchmark Meta` sólo con datos sintéticos o públicos.
2. Seleccionar `Merge · alineación` y analizar.
3. Mostrar `Contexto que viajaría` antes de escalar.
4. Escalar a Glimmer y mostrar llamadas, tokens y latencia.
5. Si un checker rechaza el patch, mostrar `Reintentar con feedback`: el segundo intento recibe el diff y los checkers rojos, pero tiene límite de 2 llamadas y 1.024 tokens adicionales.

## Cierre verificable

La frase de cierre es: “BrowserMind no aplica código sólo porque un modelo lo generó: selecciona contexto mínimo, registra la llamada, corre checkers independientes y conserva el código original si la reparación no queda verificada”.

Antes de grabar o entregar:

```bash
npm run qa
```

La demo debe reportar el resultado real de ese comando y no una cifra escrita a mano.
