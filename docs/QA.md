# QA y regresión

Toda modificación funcional debe sumar o actualizar una prueba antes de considerarse terminada.

## Puerta mínima por cambio

1. `npm test`: pruebas de unidad del núcleo.
2. `npm run check`: TypeScript sin errores mediante `tsc -b`.
3. `npm run build`: bundle producible.
4. `npm run qa`: ejecuta los tres pasos anteriores en una sola puerta.
5. Prueba manual de la interacción afectada: acción, resultado visible y popup de error si corresponde.
6. Leer el diff completo y revisar que los checkers no estén aceptando sólo porque desapareció el traceback.
6. Todo caso reparable debe tener un test de punta a punta: falla antes del patch y pasa después.
7. Los tests de modelos usan un `fetch` simulado: nunca dependen de la red ni de una key.

## Matriz semilla

| Caso | Señal | Resultado esperado |
| --- | --- | --- |
| KeyError | nombre de columna ausente | propone alias sólo si encuentra candidato y verifica el acceso |
| TypeError | operación numérica sobre texto | propone `to_numeric` y verifica la normalización |
| shape mismatch | cantidad de features incompatible | clasifica y escala a Glimmer; el checker compara features contra el traceback |
| NaN/inf | valores inválidos | inserta limpieza antes de `fit` y verifica el orden |
| merge/alignment | claves no alineadas | clasifica y escala a Glimmer; el checker exige la clave en ambos DataFrames |

## QA de producto

`src/core/productQa.ts` contiene el contrato ejecutable de los cinco casos. La interfaz también expone `Ejecutar QA completa` para obtener un informe reproducible sin API externa.

Un caso sólo pasa si:

- clasifica el error esperado;
- propone patch local cuando corresponde, o conserva revisión manual cuando no hay evidencia suficiente;
- el patch aplicado deja todos los checkers en verde;
- el caso manual conserva el nivel de escalamiento esperado;
- no se altera el código fuera del flujo declarado.

## Regla de diagnóstico

Un error debe responder siempre: qué función falló, en qué etapa, por qué falló, qué contexto se usó y hasta dónde avanzó la sesión. Si no hay reparación segura, la interfaz lo declara y no altera el código.

## Harness de modelos

Cuando se conecte un `ModelAdapter`, la llamada debe registrar tokens, latencia, modelo, nivel y estado en `ModelHarness`. Una respuesta sin patch, con fragmento inexistente o con cambio sin efecto queda rechazada antes de aplicarse; después debe pasar los checkers.
