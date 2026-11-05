# FASE 24.2 — PICK'EMS EXPANSION · Torneos, predicciones avanzadas, historial y competición

**Estado:** completada (con limitaciones de entorno documentadas) · **Fecha:** 2026-09-13
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** (cambios en el árbol de trabajo)

> Regla de la fase: ampliar 24.1, no reconstruirla. El modelo (0012/0018/0023), las RPC
> (`app_submit_pick`, `app_score_pickem_event`, `app_grant_reward`), la vista
> `ranking_pickem_event`, `REWARD_TIERS` y `TournamentLeaderboard` se reutilizan tal cual.
> No hay migración nueva, no hay tabla nueva, no hay reward engine nuevo.

---

## 1. Qué existía (mapeo previo, solo Pick'ems)

- **Modelo (0012 + 0018 + 0023):** `pickem_events` → `events` reales; `pickem_questions` con
  `kind ∈ {match_winner, match_score, champion, advance}` (CHECK de la 0023), `options` jsonb,
  `points`, `locks_at` **por pregunta**, `correct_option`, `order_idx`; `pickem_submissions`
  UNIQUE(user, evento); `pickem_answers` UNIQUE(submission, pregunta) con `is_correct` y
  `points_award` **escritos por el corrector**; `pickem_scores`; vista `ranking_pickem_event`.
- **RPC:** `app_submit_pick` (lock con `now()` de PostgreSQL, `selected_option ∈ options`,
  upsert), `app_set_correct_option`, `app_score_pickem_event` (recalcula desde cero y ajusta
  `profiles.points` por diferencia: idempotente; **genérica por tipo**: compara `option_key`
  con `correct_option` y paga `q.points`, sin mirar `kind`).
- **Ciclo de vida** (`server/services/pickemLifecycle.ts`): creaba preguntas `match_winner` y
  `match_score` (Fase 13) por partido real, resolvía solo preguntas con `match_id`.
  `champion`/`advance` solo nacían en `scripts/seed-demo.ts` con una lista escrita a mano.
- **Recompensas:** `REWARD_TIERS` (participación/acertante/analista/oráculo) → `award()` →
  `app_grant_reward` con `ref = pickem:<evento>:<escalón>` (idempotente por libro mayor).
- **UI:** `/pickems` (selector + `PickemPanel`), `PickQuestion` (Fase 9), `PickemResult`,
  `TournamentLeaderboard` (24.1), `Countdown` (un `setInterval` por pregunta).
- **Telemetría:** taxonomía cerrada de 4 eventos (CHECK 0029 + `EVENT_NAMES` + prueba que fija
  el número); flujo `pickem_form` ya contratado con `context` en lista blanca.
- **Tests:** `questions.test.ts`, `tournamentLeaderboard.test.tsx`, `scripts/pickems-integration-test.ts`
  (requiere BD viva).

## 2. Qué se ha añadido

| Capa | Pieza | Qué hace |
|---|---|---|
| Dominio | `domain/pickems/tournament.ts` | Campeón desde partidos reales; corrector de campeón (gran final) y de advance (clasificados). Puro. |
| Dominio | `domain/pickems/progress.ts` | Estados (7), progreso, agrupación, siguiente cierre, fase del torneo, posición. Puro. |
| Servidor | `pickemLifecycle.ts` | `syncChampionQuestion` en la misma pasada; `resolveFinished` corrige champion/advance. |
| Cliente | `lib/game/client.ts` | `fetchPickemEvents`, `fetchPickemEventById`, `fetchMyAnswerDetails` (lee `is_correct`/`points_award`), `fetchMyPickemHistory` (6 lecturas por lote). |
| Hook | `lib/usePickem.ts` | Carga agregada (6 lecturas en paralelo), caché por torneo, `pick` optimista con confirmación, un envío a la vez. |
| Hook | `lib/useNow.ts` | UN reloj compartido para todas las cuentas atrás. |
| UI | `PickemHero`, `PickemBoard`, `PickemResults`, `PickemRewards`, `EventSwitcher` | Héroe, tablero, resultados recientes, recompensas, selector. |
| UI | `PickQuestion` (ampliada) | Logos, variante destacada, 7 estados con texto, puntos potenciales/obtenidos, feedback de guardado, solo lectura. |
| UI | `PickemPanel` (refactor), `TournamentLeaderboard` (+`rows`), `Countdown` (+`useNow`) | Mismas piezas para `/torneos/[id]`. |
| Páginas | `/pickems` (rehecha), `/pickems/historial`, `/pickems/historial/[id]` | Modo completo + historial + detalle solo lectura. |
| Telemetría | `lib/telemetry/pickems.ts` | Seis acciones sobre el flujo `pickem_form` existente. |
| CSS | `globals.css` | Tres microinteracciones (`nx-pick-pop`, `nx-hit-glow`, `nx-reward-glow`). |
| QA | `scripts/_fase24-2-qa.ts` | Instrumento fuera de CI: app real + render estático de diseño. |

## 3. Tipos de predicción soportados

| kind | Estado | Origen de opciones | Se genera solo | Se corrige solo |
|---|---|---|---|---|
| `match_winner` | 24.1, intacto | lados del partido real (`a`/`b`) | sí (partidos futuros) | sí (`winner_team`) |
| `match_score` | Fase 13, intacto (no se amplía ni se retira) | líneas de marcador | sí | sí (`score_a/b`) |
| `champion` | **24.2** | participantes reales del torneo (equipos de sus partidos) | sí, si los datos lo permiten | sí, contra la gran final |
| `advance` | **24.2 (soporte técnico)** | las de la pregunta | **no** | sí, si `standings.status='qualified'` existe |

Fuera de 24.2 (no implementado): ganador de mapa, MVP, kills, ACS, first blood, props, apuestas.
`match_score` ya existía antes de esta fase y se deja como estaba.

## 4. Cómo funciona champion

- **Opciones:** `eventParticipants(matches)` — los equipos con nombre que aparecen en los
  partidos reales del torneo, deduplicados, ordenados por nombre. Clave estable
  `teamOptionKey(nombre)` («team-heretics»), etiqueta = nombre. Ninguna lista en código.
- **Nace solo si:** ≥ 4 participantes, el torneo **no ha empezado** (ningún partido live/
  finished ni hora pasada) y hay una fecha de inicio. Si falta algo → `null`, no se crea.
- **Cierre:** el primer partido del torneo (`tournamentStartsAt`). **Puntos:** `CHAMPION_POINTS = 50`
  (configuración del servidor; el cliente lee `q.points`). `order_idx = -1`: destacada.
- **Refresco:** mientras está abierta, si el origen incorpora equipos, se **añaden** opciones
  (`mergeOptions`); nunca se quita una (podría tener respuestas). Cerrada o corregida, no se toca.
- **Corrección:** solo contra un partido cuya ronda sea gran final (`isGrandFinal`: «grand
  final», «gran final», «final» a secas; **no** semifinal/lower/upper), terminado, con ganador que
  sea uno de sus lados **y** que esté entre las opciones. Si no, queda pendiente. No se infiere el
  cuadro ni se toma «el último partido».
- **Idempotencia:** una por torneo (comprobación por `kind`); `syncChampionQuestion` es parte de
  la misma pasada de `syncQuestions`.

## 5. Cómo funciona advance

- **Corrector real:** `correctAdvanceOption(options, qualifiedKeys)` — se corrige cuando
  **exactamente una** opción está clasificada. `resolveFinished` lee `standings` con
  `status = 'qualified'` (esquema 0003) y `teams(name)`; sin filas, la pregunta queda pendiente.
- **No se genera automáticamente** (y la prueba lo protege): saber quién avanza exige la regla de
  clasificación (cuántos pasan por grupo) y el estado `qualified`, y el importador VLR real **no
  rellena `standings.status`** (solo el origen mock lo hace). Crear la pregunta sería inventar el
  bracket. UI, scoring, lock y estados ya la representan si un administrador/seed la crea.
- **Qué falta exactamente para activarla:** que la sincronización escriba `standings.status`
  por fase (o una regla `slots` por grupo) desde el origen real.

## 6. Locks

- Sin cambios en la autoridad: `app_submit_pick` compara con `now()` de PostgreSQL → 409.
- Cada pregunta tiene su `locks_at`: campeón = inicio del torneo; partido = su inicio.
- Cliente: `isLockedNow(q, now)` apaga el botón al llegar a cero (UN reloj compartido,
  `useNow`, sin peticiones periódicas); `Countdown.onExpire` recarga. Si el servidor responde
  «cerrada», el hook revierte, marca `Cerrada` y recarga (`pickem_locked_seen`).

## 7. Scoring

- `app_score_pickem_event` intacto: genérico por tipo, recalcula desde cero, ajusta por
  diferencia. Ejecutar dos veces no duplica (prueba de contrato SQL + prueba de `scorePickemEvent`
  con cliente falso: misma `p_ref` las dos veces, `p_points = 0` en la recompensa).
- Puntos por tipo = `q.points` de cada pregunta (match: por ronda; champion: 50). Ningún
  componente lleva un valor fijo: la prueba «SERVER-AUTHORITY» lo comprueba sobre el código.

## 8. Progreso

`progressOf(questions, answers, now)` → total, respondidas, **pendientes** (abiertas sin
responder), **cerradas sin responder**, en juego, resueltas, aciertos, fallos, %. Se cuenta; no se
puntúa. El héroe pinta «PREDICCIONES 6 / 9 · 67 % completado» con barra `role="progressbar"`,
desglose textual y CTA «N predicciones pendientes →» que lleva al ancla `#pickems-pendientes`.

## 9. Resultados

`PickemResults`: tu predicción, el resultado y **ACERTADA +N / FALLADA +0 / NO JUGADA**, con
marca dibujada + insignia + texto. Acierto y puntos se **leen** de `pickem_answers.is_correct`
y `points_award` (los escribe el corrector). Si la pregunta ya tiene `correct_option` pero el
corrector aún no pasó, se lee el resultado publicado y la cifra se marca «pendiente de sumar»:
no se afirma un número que el servidor no ha escrito.

## 10. Leaderboard y mi posición

`TournamentLeaderboard` de 24.1 sigue siendo la fuente visual (top 10 + mi fila si estoy fuera,
sin duplicar; nick/avatar/puntos/aciertos). Ahora acepta `rows` ya cargadas por `usePickem` (una
lectura menos). **Mi posición** en el héroe = `positionOf(ranking, userId)` (índice + 1 en el
orden del servidor); sin `pickem_scores` → «Sin clasificar», nunca `#0`; con puntuación pero fuera
de las 100 filas → «+100». En el historial, `positionAmong` = 1 + jugadores con más puntos (mismo
criterio que la vista).

## 11. Rewards

`PickemRewards` deriva de `REWARD_TIERS` (la misma tabla que paga `scorePickemEvent`) y del
asiento real de `credit_transactions` (`ref = pickem:<id>:<tier>`):
**CONSEGUIDA** (asiento del escalón o de uno superior), **ALCANZADA** (puntos sin asiento: «se
abona al corregir») o **PENDIENTE** («te faltan N puntos»). Sin botón «Reclamar»: la concesión es
automática e idempotente; la prueba comprueba que el componente no tiene botones ni llama a
ningún endpoint.

## 12. Historial

- `/pickems/historial`: torneos con submission mía (`fetchMyPickemHistory`: submissions,
  eventos, preguntas, respuestas, puntuaciones y asientos, **6 consultas por lote**). Por torneo:
  nombre, fechas, fase real, respondidas/total, aciertos, puntos, posición, recompensa. Un torneo
  sin participación **no aparece** (ni ceros ni `#0`).
- `/pickems/historial/[id]`: resumen (predicciones, acertadas, falladas, puntos, posición,
  recompensa) + tablero en **solo lectura** (`readOnly`: botones deshabilitados aunque siga
  abierta; para cambiar se vuelve a `/pickems`) + recompensas + clasificación. Mismo hook.

## 13. Seguridad

- `/api/pickems` solo lee `questionId` y `option` del cuerpo (≤ 64 caracteres); usuario del
  Bearer. Prueba de contrato: el cuerpo no puede traer `correct_option`, `points`, `score`,
  `locks_at`, `userId`, `reward`, `result`.
- `selected_option ∈ options` en SQL (`jsonb_array_elements`) → «Opción inválida» → 400; el hook
  ni siquiera intenta una clave fuera de `q.options`.
- Doble envío: bloqueado en cliente (`savingRef`) y absorbido en servidor (UNIQUE + upsert).
- RPC solo `service_role`; `profiles.points` protegida por trigger. Nada nuevo en la BD.

## 14. Privacidad

- `correct_option` sigue oculta hasta el lock por la vista `pickem_questions_public`.
- Respuestas ajenas: RLS «tus respuestas»; ningún endpoint nuevo permite leer la elección de otro.
- Leaderboard/héroe/resultados no pintan `user_id` ni correo (prueba «PRIVACIDAD»).
- La caché del hook es de presentación y no usa `localStorage` (prueba «REFRESH»).

## 15. Telemetría

Las seis acciones (`pickem_viewed`, `pickem_prediction_saved`, `pickem_prediction_changed`,
`pickem_locked_seen`, `pickem_result_seen`, `pickem_leaderboard_seen`) viajan como `context` de
`flow_started` con `flow = pickem_form`, ambos ya contratados (lista blanca 0029/contrato). Sin
identificadores ni datos sensibles; las de «visto» se deduplican por torneo. **No** se ampliaron
`EVENT_NAMES` ni el CHECK: exigiría una migración no aplicable aquí y reescribir la prueba que fija
4 eventos (prohibido por el brief). Promoverlas a eventos de primer nivel = cambiar solo
`trackPickem`. Sin analytics externos.

## 16. Responsive y accesibilidad

- 390/1440: selector en tira desplazable, héroe con marcador en rejilla, campeón en 2/3/4
  columnas, duelos con logo + nombre truncable, botones ≥ 44 px (medido: 0 por debajo), sin
  desbordamiento (medido tras corregir la pista de rejilla a `minmax(0,1fr)`).
- Opciones = `<button aria-pressed>` nativos, foco visible `ring`, estado en región
  `role="status" aria-live="polite"`, progreso con `role="progressbar"`, listas `<ol>`.
- Estados con palabra + marca dibujada + insignia; nunca solo color.
- Animaciones: tres, y todas caen bajo la regla global `prefers-reduced-motion` (0,01 ms);
  transiciones con `motion-reduce:transition-none`.

## 17. Tests

**72 pruebas nuevas** (1046/1046 en verde; 974 previas intactas, ninguna modificada):

- `domain/pickems/tournament.test.ts` (15): opciones de participantes reales, no nace con
  torneo empezado/sin fecha/pocos equipos, idempotencia, gran final, ganador fuera de opciones,
  merge sin quitar, advance exacto-uno, **advance sin generador**.
- `domain/pickems/progress.test.ts` (14): 7 estados, `is_correct` manda, pendiente de sumar,
  reloj cliente, progreso, puntos en juego, agrupación, siguiente cierre, fases, posición.
- `components/pickems/pickemHub.test.tsx` (25): match_winner, champion, advance, opciones del
  servidor, estados con texto/marca, puntos obtenidos y potenciales, lock servidor/reloj, solo
  lectura, feedback aria-live, héroe/progreso/posición/CTA, tablero, resultados, recompensas
  (conseguida/alcanzada/pendiente, sin reclamar), selector, top 10 / mi fila / no duplicar,
  privacidad, teclado, reduced motion, server-authority, guardado (un envío, opciones, optimista,
  cerrada → recarga), refresh desde `pickem_answers`.
- `server/services/pickems.test.ts` (15): 409/400/404, SQL (`now()`, opción ∈ options, upsert,
  scoring por diferencia, genérico por tipo, privacidad), ruta anti-cheat, recompensa con misma
  clave dos veces, lifecycle campeón (nace/no nace/no duplica/añade/no toca cerrada/corrige/
  pendiente) y advance (standings/pendiente).
- `lib/telemetry/pickems.test.ts` (3).

Mapa §37 → 1 match_winner ✓ · 2 champion ✓ · 3 advance ✓ · 4 opciones backend ✓ · 5 inválida ✓
· 6 progreso ✓ · 7-10 estados ✓ · 11-12 puntos ✓ · 13-14 cambio/rechazo ✓ · 15 refresh ✓ ·
16 doble ✓ · 17 idempotente ✓ · 18-20 leaderboard ✓ · 21 privacidad ✓ · 22-23 historial (helpers
puros + página; la lectura por lote no tiene BD aquí) ✓/parcial · 24-25 recompensa/no claim ✓ ·
26-28 responsive/teclado/motion ✓ · 29-30 server-authority ✓.

**Gates:** `npm test` 1046/1046 ✓ · `typecheck` ✓ (web + scripts) · `build` ✓ (`/pickems`,
`/pickems/historial`, `/pickems/historial/[id]`, `/api/pickems`) · `security:verify` ✓ ·
`pack:verify` ✓ · `content:verify` ✓ · `distribution:verify` 30/0 ✓ · lint de los ficheros
tocados: 0 errores, 0 avisos. **`test:pickems`: no ejecutable** — requiere Supabase vivo
(`NEXT_PUBLIC_SUPABASE_URL=127.0.0.1:54521`, nada escuchando; Docker desinstalado a propósito).

## 18. Prueba REAL

**No realizada, y no se finge.** `.env.local` apunta al Supabase local (54521), que no existe;
no hay en este entorno una vía autorizada al Supabase de la VPS ni cuentas de prueba. Por tanto
no se pudo: login → torneo real → elegir → guardar → refresh → cambiar → refresh → progreso →
leaderboard poblado → historial → ACERTADA/FALLADA con puntos reales.

Lo que SÍ se validó con navegador real (`scripts/_fase24-2-qa.ts`, 89 comprobaciones ✓):

- **App real (`next start`)**: `/pickems`, `/pickems/historial`, `/ranking`, `/torneos`,
  `/coleccion`, `/inventario`, `/packs`, `/duelos`, `/progresion`, `/tienda`, `/mercado` → 200,
  con contenido, **0 excepciones de la app** a 1440 y 390, **0 px de desbordamiento**.
  `/pickems` sin backend degrada a «Algo ha fallado · Reintentar» (tarda ~20 s: reintentos de
  supabase-js 2.108 con conexión rechazada; no es un bucle de la pantalla). `/coleccion` y
  `/mercado` registran 2 recursos 404 (imágenes ausentes), anteriores a esta fase.
- **Render estático con datos de muestra** (CSS de la build + logos servidos por la app,
  etiquetado «QA ESTÁTICA · NO ES UNA PRUEBA REAL»): hub e historial a 1440 y 390 sin
  desbordamiento, botones ≥ 44 px, y presentes «#12», «6 / 9», campeón, pendientes, tus
  elecciones, en juego, acertada, fallada, conseguida, te faltan, predicción guardada, bloqueada,
  sin predicción, «tú».

Capturas: `docs/product/qa/fase24-2/` (`app-*` = app real sin backend; `qa-estatica-*` =
diseño con datos de muestra). Nota: en el render estático los logos sin PNG muestran el `alt`
porque no corre el `onError` de `TeamLogo`; en la app real cae al monograma existente.

## 19. Limitaciones reales

1. Flujo vivo y `test:pickems` pendientes de un entorno con Supabase (ver §18).
2. **champion** solo nace en torneos que aún no han empezado cuando la sincronización pasa por
   primera vez; un torneo importado ya en marcha no tendrá pregunta de campeón (por diseño).
3. Si el ganador real no estaba entre las opciones (equipo que no aparecía en el cuadro), la
   pregunta queda **sin corregir** y nadie puntúa por ella; se ve como «En juego». Requiere
   revisión humana (`app_set_correct_option`).
4. Dos pasadas de sincronización estrictamente simultáneas podrían crear dos preguntas de campeón
   (no hay índice único con `match_id` nulo; no se añadió migración). La sincronización real es
   secuencial; se documenta.
5. **advance** no se genera sola (falta `standings.status` desde el origen real).
6. Telemetría: las seis acciones son `context` de `flow_started`, no eventos de primer nivel.
7. `globals.css` era CRLF (HEAD y árbol); el bloque añadido se normalizó a CRLF. El diff frente a
   HEAD incluye trabajo anterior sin commitear, no solo el de esta fase.
8. Posición en el historial derivada de `pickem_scores` en cliente (1 + mejores); una vista
   server-side sería más limpia pero exige migración.

## 20. P2 restantes

- Ejecutar `test:pickems` y el flujo vivo contra una BD autorizada.
- Índice único parcial para `champion` por evento (migración incremental) cuando haya BD.
- `standings.status` desde el importador VLR → activar generación de `advance` por grupo.
- Promover las acciones de Pick'ems a `event_name` propios (migración 0029 + contrato + prueba).
- Vista `pickem_my_positions` para la posición en historial sin cálculo en cliente.
- Mostrar en el selector el número de pendientes por torneo (exige lectura por lote extra).

## Archivos

**Creados:** `src/domain/pickems/tournament.ts`, `tournament.test.ts`, `progress.ts`,
`progress.test.ts`; `src/lib/usePickem.ts`, `src/lib/useNow.ts`; `src/lib/telemetry/pickems.ts`,
`pickems.test.ts`; `src/components/pickems/PickemHero.tsx`, `PickemBoard.tsx`,
`PickemResults.tsx`, `PickemRewards.tsx`, `EventSwitcher.tsx`, `pickemHub.test.tsx`;
`src/app/pickems/historial/page.tsx`, `src/app/pickems/historial/[id]/page.tsx`;
`src/server/services/pickems.test.ts`; `scripts/_fase24-2-qa.ts`; `docs/product/qa/fase24-2/*`;
este informe.

**Modificados:** `src/domain/pickems/questions.ts` (tipo `QuestionKind`),
`src/server/services/pickemLifecycle.ts`, `src/lib/game/client.ts` (añadidos al final),
`src/components/pickems/PickQuestion.tsx`, `PickemPanel.tsx`, `TournamentLeaderboard.tsx`,
`Countdown.tsx`, `src/app/pickems/page.tsx`, `src/app/globals.css`.

**No tocados:** Marketplace, `GLOBAL_MARKET_ENABLED`, packs/RNG/minting, CardVisual, colección,
inventario, Duelos/PvP/rating/settlement, Trainer, `teamIdentities`, Team Packs, rosters, importador
VLR, economía base, XP/level, migraciones.

Sin `git commit`, sin `push`, sin `deploy`. Servidor de la app detenido al terminar.

**FASE 24.2 — CERRADA** (validación viva pendiente de entorno, documentada).
