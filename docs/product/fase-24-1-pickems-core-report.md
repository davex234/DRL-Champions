# FASE 24.1 — PICK'EMS CORE · Predicciones de torneos

**Estado:** completada · **Fecha:** 2026-09-13
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** (cambios en árbol de trabajo)

> Auditoría previa: el sistema de Pick'ems **ya está construido de extremo a extremo**
> (backend, lock, scoring, idempotencia, RLS, recompensas, XP, UI, clasificación por torneo).
> El único paso del bucle que no era visible desde la pantalla de Pick'ems era la
> **CLASIFICACIÓN**. Esta fase la trae ahí, reutilizando la vista server-authoritative
> existente, sin crear un segundo sistema de nada.

---

## 1. Qué se ha construido

Un componente **`TournamentLeaderboard`** que muestra la clasificación del torneo activo
**dentro de `/pickems`**: posición, jugador, puntos y aciertos, con tu fila resaltada. Cierra
el último paso visible del bucle (TORNEO → PREDICCIÓN → LOCK → RESULTADO → PUNTOS →
**CLASIFICACIÓN** → RECOMPENSAS) sin salir de la pantalla donde predices. **No** reconstruye
nada: lee la misma vista que `/ranking`.

## 2. Torneos utilizados (fuente de verdad)

Los datos vienen de la fuente canónica ya existente: `pickem_events.event_id → events`, que se
puebla desde el importador de esports real (VLR/VCT, `src/lib/esports/sync/*`). El usuario solo
predice sobre eventos que existen. **No se inventó** ningún torneo, equipo, partido, resultado
ni fecha. Los eventos `source = "demo"` se marcan como tales en la UI.

## 3. Modelo de predicción (reutilizado, migración 0012)

- `pickem_events` (id, título, `event_id`→events, `locks_at`, `status` draft/open/locked/scored).
- `pickem_questions` (`kind` **match_winner**/champion/advance, `points`, `locks_at`,
  `correct_option`, `order_idx`).
- `pickem_submissions` — **unique (user_id, pickem_event_id)**: una submission por usuario y evento.
- `pickem_answers` — **unique (submission_id, question_id)**: una respuesta por pregunta.
- `pickem_scores` — por (user, evento): `points`, `correct`, `total`; RLS de lectura pública,
  índice por `points desc`. Vista `ranking_pickem_event` para la clasificación por torneo.

El tipo de predicción de esta fase (**ganador de partido**) es `kind = match_winner`, ya
soportado. No se tocó el esquema.

## 4. Lock (server-authoritative)

`app_submit_pick` comprueba `now() >= locks_at` **con el reloj de la base de datos** y responde
409 si el plazo pasó — da igual la hora del navegador (§5/§6/§19). El `correct_option` no es
visible antes del cierre (vista `pickem_questions_public` lo oculta hasta `locks_at`). Antes del
lock se puede cambiar (upsert sobre la unique constraint: una sola predicción válida por
usuario+pregunta). Nada de esto se modificó.

## 5. Scoring

Ya existente y server-authoritative: cada pregunta vale sus `points` (`match_winner`: +N si el
`correct_option` coincide, +0 si no — la primera versión recomendada del §10 ya es la vigente).
`app_score_pickem_event` corrige **de forma idempotente**: recalcula desde cero y ajusta
`profiles.points` **por diferencia**, así que procesar dos veces no concede puntos dos veces
(§12). `profiles.points` es columna protegida (SEC-02: solo la escribe el servidor). No se
cambió la fórmula.

## 6. Leaderboard

- **Existente**: vista `ranking_pickem_event` (points/correct/total por evento), consumida por
  `/ranking` (pestaña «torneo») y por la ficha `/torneos/[id]`.
- **Nuevo (esta fase)**: `TournamentLeaderboard` la trae a `/pickems` para el evento activo —
  top 10 + tu fila si quedas por debajo—, mostrando posición, avatar, nick, puntos y aciertos.
  Tu fila se marca con «tú» (texto, no solo color, §29) y enlaza a la clasificación completa.
  **No** calcula, ordena ni suma puntos: pinta el orden que ya trae el servidor.

## 7. Integración con rewards / XP

**Ya integradas, no se crea nada** (§21/§22). `scorePickemEvent` reparte recompensas por
escalón de puntos (`REWARD_TIERS`: participación/acertante/analista/oráculo) vía el sistema
server-authoritative `app_grant_reward` (`award`), y cada escalón concede **créditos, XP y
packs** reales. No se conceden recompensas desde el frontend; no hay dinero real ni apuestas
(§23). El punto de integración de XP de Pick'ems **ya existe** dentro de esos tiers; no se
duplicó el sistema de XP.

## 8. Seguridad / idempotencia

Sin cambios en el modelo, todo lo garantiza el backend (0012 + RLS):
- El usuario sale del Bearer, nunca del cuerpo (`/api/pickems`).
- RLS: cada usuario solo ve sus submissions/answers; scores y events son de lectura pública;
  `correct_option` oculto hasta el lock.
- No se puede predecir tras el lock (409), ni modificar puntos/resultados (columnas protegidas,
  RPC solo `service_role`), ni duplicar predicción (unique constraints), ni reclamar dos veces
  (scoring idempotente por diferencia).
- El nuevo componente **solo lee** la vista pública y no expone dato privado (ni `user_id`, ni
  email): únicamente nick/avatar públicos, puntos y aciertos.

## 9. Resultado de la prueba REAL

Navegador real (`next start`, `/pickems`, 1440×960):
- La pantalla **carga sin errores de consola**, con su cabecera y estética de modo de juego.
- Con el backend no accesible, **degrada con elegancia**: muestra «Algo ha fallado» + botón
  **Reintentar** (no crashea, no deja la consola con excepciones).

**Limitación honesta (documentada, no un defecto):** Pick'ems lee los torneos/partidos reales
desde Supabase, cuya fuente de verdad es la VPS; en esta máquina el Supabase local
(`127.0.0.1:54521`) está **caído** (Docker desinstalado) y no hay, en esta sesión, un mecanismo
autorizado para operar el backend remoto con cuentas de prueba. Por eso **no se pudo ejecutar el
flujo real** (login → torneo real → predecir → persistir → cambiar → leaderboard poblado), y
**no se finge** (§32). Tampoco se corrió `scripts/pickems-integration-test.ts` (cubre crear
predicción, lock tras cierre, scoring acierto/fallo, no reclamar dos veces, ranking derivado de
datos reales) porque **requiere Supabase vivo**. El nuevo componente queda cubierto por **6
pruebas** que sí corren sin backend, más `typecheck` y `build`; el lock, scoring, idempotencia,
RLS y ranking están garantizados por la migración 0012 y sus pruebas de integración.

## 10. Tests

Nuevo `src/components/pickems/tournamentLeaderboard.test.tsx` — **6 pruebas**: server-authority
(lee `fetchTournamentRanking`, no ordena/suma puntos en cliente, la posición es el orden
recibido), privacidad (no filtra `user_id` ni datos privados), presentación
(posición/jugador/puntos/aciertos), tu-fila marcada con «tú» (no solo color), top 10 + tu fila
si quedas por debajo, accesibilidad (lista `<ol>` con nombre accesible).

Mapa §31 → cobertura: 1/2 (torneos/partidos reales: fuente `events` existente), 3–9 (predicción,
cambio, lock, fuera de plazo, no duplica: `app_submit_pick` + constraints + `scripts/pickems-
integration-test.ts`), 10–12 (resultado real, scoring, idempotencia: `app_set_correct_option` +
`app_score_pickem_event`), **13 (leaderboard: componente nuevo + tests)**, 14 (no ver/modificar
ajenas: RLS), 15 (resultado no manipulable: columnas protegidas), 16 (countdown: ya en
`PickemPanel`), 17 (FINISHED/scored: estados existentes), 18 (responsive: componente fluido).

**Ejecución:**
- `npm test` → **974/974** ✓ (968 previos + 6 nuevos)
- `typecheck` ✓ · `build` ✓ (`/pickems` y `/api/pickems` compilan) · `security:verify` ✓ ·
  `pack:verify` ✓ · `content:verify` ✓ · `distribution:verify` ✓ (30/0)
- `scripts/pickems-integration-test.ts` (`test:pickems`) — **no ejecutable** (necesita Supabase
  vivo). Limitación de entorno, documentada.

**No se modificó ningún test para forzar verde.**

## 11. Validación visual

`/pickems` con estética de modo de juego (no formulario): cabecera «PICK'EMS», estado del
evento, panel de predicción (`PickemPanel`, reutilizado) y, debajo, la nueva **clasificación del
torneo** con placas de podio, avatares, puntos en `tabular-nums` y tu fila resaltada.
Responsive por construcción (filas fluidas, sin overflow) y accesible (`<ol>`, foco, texto para
los estados). Regresión: `/pickems`, `/ranking`, `/torneos`, `/coleccion`, `/inventario`,
`/packs`, `/duelos`, `/progresion`, `/tienda`, `/mercado` → **200**.

## 12. P2 reales restantes

- **Validación viva del bucle** (predecir sobre un torneo real, cambiar antes del lock, ver
  FINISHED con scoring, leaderboard poblado): pendiente de un entorno con Supabase operativo.
- **Ejecutar `test:pickems`** contra la BD real para confirmar en vivo lock/scoring/idempotencia/
  ranking.
- **Más tipos de predicción** (champion, advance ya existen en el esquema; marcador exacto,
  mapas, MVP quedan para fases posteriores, §4).
- **Recompensas ampliadas / ranking global de Pick'ems**: los sistemas existen; ampliarlos es
  fase posterior (§14/§21).

## 13. Archivos modificados

- `src/components/pickems/TournamentLeaderboard.tsx` — **(nuevo)** clasificación del torneo en la
  pantalla de Pick'ems (presentación + carga de la vista existente).
- `src/app/pickems/page.tsx` — **(modificado)** monta `TournamentLeaderboard` bajo el evento
  activo. Sin tocar la carga de predicciones ni el backend.
- `src/components/pickems/tournamentLeaderboard.test.tsx` — **(nuevo)** 6 pruebas.
- `docs/product/fase-24-1-pickems-core-report.md` — **(nuevo)** este informe.

Sin `git commit`, sin `push`, sin `deploy`. Cambios en el árbol de trabajo.
