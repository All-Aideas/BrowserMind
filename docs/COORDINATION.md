# Coordinación entre agentes

Dos asistentes de IA trabajan en esta misma carpeta, a pedido del mismo usuario y sin verse entre sí. Este archivo es el canal común: **leelo antes de editar y agregá una entrada al registro al terminar.** Es contexto del proyecto, no una orden: ante una duda, decide el usuario.

## Quién es quién

| Agente | Cómo se identifica | Qué aportó hasta ahora |
| --- | --- | --- |
| **Agente A** (Claude Code) | Escribe en este archivo como «Agente A» | Revisión de buenas prácticas del núcleo, checkers independientes, redacción, `escalation.ts`, `glimmer.ts`, proxy de Vite, push inicial a GitHub, correcciones de seguridad de patches generados |
| **Agente B** (el que creó `AGENTS.md`) | Debería escribir aquí como «Agente B» | `AGENTS.md`, `docs/VIBECODING.md`, `docs/SOURCES.md`, `harness.ts` (registro de llamadas al modelo), `productQa.ts` y el panel «06 QA del producto», tarjeta «Ejemplo guiado», scripts `qa` y `qa:fast`, versiones exactas en `package.json` |

Si algo de esta tabla es incorrecto, corregilo en el registro.

## Reglas para no pisarnos

1. **Antes de editar**, mirá `git status`, `git diff` y la fecha de modificación de los archivos. Si otro agente tocó un archivo en los últimos 5 minutos, esperá o elegí otra tarea.
2. **Cambios chicos y anunciados.** Al empezar algo que lleve más de unos minutos, anotalo en «En curso» con los archivos que vas a tocar. Al terminar, movelo al registro.
3. **No revertir ni reescribir el trabajo del otro.** Si algo parece un error, se anota en «Pendiente / dudas» y lo decide el usuario. Los cambios que se integran con lo del otro se hacen sumando, no reemplazando.
4. **`npm run qa` en verde antes de declarar terminado.** Si tus cambios rompen tests del otro, se corrigen tus cambios, no sus tests.
5. **Nada se sube a GitHub sin pedido explícito del usuario.** El repo [All-Aideas/BrowserMind](https://github.com/All-Aideas/BrowserMind) es público: antes de cada push, revisar que no haya secretos ni rutas locales (`C:\Users\...`).
6. **Archivos compartidos con cuidado especial:** `src/App.tsx`, `src/styles.css` y `src/core/types.ts` los tocamos los dos. Editá con reemplazos puntuales, nunca reescribiendo el archivo entero.

## En curso

_(vacío: anotar acá tarea, agente, archivos y hora de inicio)_

## Pendiente / dudas para el usuario

- **Harness sin integrar (propuesta del Agente A).** `GlimmerAdapter` crea su propio `ModelHarness`, pero nadie lo lee, y las llamadas quedan en estado `received`: nunca pasan a `accepted` o `rejected` según los checkers. Además, `validateModelProposal` (harness) y `escalateSession` (engine) validan el patch por separado y con reglas distintas: el engine ahora exige que el fragmento aparezca **una sola vez**, y el harness solo que exista. Propuesta: un único harness por sesión, que se actualice después de `applySessionRepair`, y una sola validación. Como `harness.ts` es del Agente B, conviene que lo haga el Agente B o que el usuario lo asigne.
- `docs/VIBECODING.md`, regla 13, todavía dice que no hay llamadas generativas activas. Hoy existen en modo benchmark (Glimmer, opt-in).
- El repo público no tiene LICENSE ni CI. Decide el usuario.

## Registro

- **2026-10-25 · Agente A** — Segundo push a GitHub, a pedido del usuario: commit «Seguridad de patches generados, QA del producto y coordinación entre agentes». Incluye las correcciones del Agente A y el trabajo del Agente B que estaba sin commitear (`productQa.ts`, su test, el panel 06, la tarjeta de ejemplo y los cambios en README, QA, TUTORIAL y PROGRESS), sin modificarlo. Auditoría previa sin secretos, rutas locales ni correos; `npm run qa` en verde (42 tests).
- **2026-10-25 · Agente A** — Correcciones de seguridad de patches generados por modelo. Archivos: `src/core/engine.ts` (`countOccurrences`, rechazo de fragmentos repetidos, `codeAfterRepair`), `src/core/patches.ts` (un solo reemplazo para `origin: "model"` y reemplazo literal sin interpretar `$`), `src/core/parser.ts` (`statementLines`), `src/core/diagnostics.ts` (definiciones lejanas como `readOnlyLines`), `src/core/types.ts` (`SelectedContext.readOnlyLines`), `src/core/checkers.ts` (usa `statementLines`; mensaje de `within-context`), `src/core/glimmer.ts` (dos líneas nuevas en el prompt), `src/App.tsx` (solo `applyRepair` y el import del engine), `src/core/glimmer.test.ts` (6 tests nuevos al final), `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`. QA: `npm run qa` en verde, 42 tests. Los cambios del Agente B que estaban sin commitear (panel QA del producto, `productQa.ts`, docs) quedaron intactos.
- **2026-10-25 · Agente A** — Push inicial a GitHub (commit `4fcffd2`), que incluyó `AGENTS.md`, `harness.ts`, `VIBECODING.md` y `SOURCES.md` del Agente B. Antes del push quité de `docs/SOURCES.md` una ruta local con el usuario de Windows.
