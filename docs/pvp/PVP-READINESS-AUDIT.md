# NEXUS — PvP Readiness Audit

> BLOQUE 7. **Auditoría. No se ha modificado ni una línea de código.**
> 2026-09-06 · rama `arch/stabilization`

---

## 1. Executive Summary

**Veredicto: 🟡 PARCIALMENTE PREPARADO. Score 64/100** (metodología en §16).

Tres conclusiones, en orden de importancia:

**1. El motor de duelo ya es PvP-capaz sin tocarlo.** `DuelMatch` no sabe que juega contra
un bot: tiene `snapshotA`/`snapshotB`, un `Side` explícito, `attacker` guardado en vez de
deducido, y es plano, serializable y determinista. El bot no vive en el estado — vive en
`src/domain/cardgame/opponent/`, que es un *consumidor* del orquestador. **Cambiar el
segundo jugador de bot a persona no requiere tocar el motor.**

**2. Existe un núcleo multijugador completo, verificado y deliberadamente congelado.**
`src/online/` (18 ficheros: servidor autoritativo, lockstep, replicación, predicción,
heartbeat, reconexión), `src/matchmaking/` (colas, búsqueda, balance, ready-check),
`src/competitive/` (MMR Elo, ligas, temporadas, decay). El propio proyecto lo documenta en
`docs/FROZEN.md` con su criterio de descongelación escrito. **Esto no es terreno virgen.**

**3. Lo que falta no es el juego: es el transporte, la identidad de dos bandos y la
concurrencia.** En concreto: `duel_matches` no puede representar dos jugadores; no existe
control de versión en la escritura de turno; y los adapters de WebSocket/Realtime
**lanzan `throw`** — están preparados, no cableados.

**Hallazgo de riesgo P1 encontrado durante la auditoría:** `npm run matchmaking:verify`
**estaba roto** (§17). Era bit-rot en un módulo congelado y su propia red de seguridad lo
detectó; nadie la había mirado. **Reparado en el BLOQUE 7.1** (solo tooling: el arreglo vive
en `src/lib/match/roster.ts`; la arquitectura PvP congelada NO se tocó).

---

## 2. Current Architecture

```
CLIENTE  (src/lib/duel/client.ts)
   │  POST /api/game/duel  { action, deckId | matchId, cardUid, stat }
   ▼
RUTA     (src/app/api/game/duel/route.ts)
   │  getSession(req) → userId  ← del Bearer, NUNCA del cuerpo
   ▼
SERVICIO (src/server/services/duels.ts)
   │  ownership · validación · snapshot · seeds de servidor
   ▼
DOMINIO  (src/domain/cardgame/)
   │  orchestrator (turnos) → resolver (quién gana)  ← PUROS, sin reloj ni azar
   │  opponent/ (bot + RNG serializable)             ← consumidor, no parte del motor
   ▼
duel_matches (state jsonb + rng jsonb)
   ▼
awardMatchOutcome → app_grant_reward (ref `duel:<matchId>`)
```

**Transporte actual: petición/respuesta HTTP.** Ni WebSocket, ni Supabase Realtime, ni
SSE, ni polling. Evidencia: `src/lib/duel/client.ts` solo usa `fetch`; búsqueda de
`.channel(`, `postgres_changes`, `EventSource`, `text/event-stream` en `src/` → **0
coincidencias**.

---

## 3. Duel Engine Audit

Ficheros: `src/domain/cardgame/{match,combat,opponent}/`.

| pregunta | respuesta | evidencia |
|---|---|---|
| **A. Qué recibe** | `snapshotA`, `snapshotB`, `firstAttacker`, `rules` | `startDuelMatch()` en `match/orchestrator.ts` |
| **B. Qué calcula** | Fases del turno, legalidad, marcador, desempate, ganador | orquestador + `combat/resolver.ts` |
| **C. Qué manipula el cliente** | **Solo `cardUid` y `stat`** (y solo cuando ataca) | `route.ts` — el cuerpo no acepta nada más |
| **D. Determinismo** | Total. El resolver prohíbe explícitamente `Date.now`, `Math.random`, red, Supabase y `localStorage`, **verificado por tests** | `combat/resolver.ts` líneas 23+ |
| **E. ¿Hay RNG?** | Sí, **solo para el bot** | `opponent/rng.ts` |
| **F. Dónde vive** | `opponent/rng.ts` — mulberry32 como **valor serializable**, no cierre | *«el estado es un objeto plano, así que una partida se guarda, se carga y continúa exactamente igual»* |
| **G. ¿Hay seed?** | Sí: `seedA`, `seedB`, y una tercera para el mazo rival | `duels.ts:476-478` |
| **H. ¿La controla el cliente?** | **No.** `randomInt` de `node:crypto`, en servidor | `import { randomInt } from "node:crypto"` |
| **I. ¿Puede fabricar un resultado?** | **No.** No existe ningún campo de entrada para estado, marcador ni ganador | §12 |
| **J. ¿Puede el servidor reconstruir?** | **Sí.** `DuelTurn` guarda decisiones + `ResolvedEncounter` completo + marcador tras el turno | `match/types.ts` |
| **K. ¿Depende de datos falsificables?** | **No.** El snapshot se toma en servidor desde la propiedad real | §5 |

### La pieza que importa para PvP

`DuelMatch` **no contiene ningún concepto de bot**. La dificultad vive en la columna
`duel_matches.difficulty`, no en el estado; el bot es `runBot()` en el servicio, que llama
a `advanceBots` del módulo `opponent`. El estado tiene `Side` (`A`/`B`) y `attacker`
explícito, con este comentario en el propio código:

> *«Se guarda EXPLÍCITAMENTE en vez de deducirlo de la paridad del turno: si mañana el
> orden deja de ser alterno, el modelo no cambia.»*

**🟢 El motor está listo. Sustituir `runBot()` por «esperar la jugada del otro humano» no
toca ni una línea de `domain/cardgame/`.**

### Estados que ya existen

`MatchStatus`: `WAITING` · `IN_PROGRESS` · `COMPLETED` · `DRAW` · `UNRESOLVED`.
`TurnPhase`: `NOT_STARTED` · `ATTACKER_CARD` · `ATTACKER_STAT` · `DEFENDER_CARD` ·
`DEFENDER_STAT` · `READY_TO_CONFIRM`.

El propio motor documenta que **no inventó `ABANDONED`**: *«El PDF no define abandono ni
rendición, así que NO se inventa un estado ABANDONED: una partida sin terminar sencillamente
no tiene result.»*

---

## 4. `duel_matches` Audit

Migración base `0014_duels.sql`, ampliada por `0016_progression.sql` y `0018_game_loop.sql`.

| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid → `auth.users` cascade | **UN solo jugador** |
| `deck_id` | uuid → `duel_decks` set null | **UN solo mazo** |
| `difficulty` | text CHECK `EASY\|NORMAL\|HARD` | concepto de **bot** |
| `status` | text | |
| `state` | jsonb | `DuelMatch` completo — **incluye las cartas que el rival no ha jugado** |
| `rng` | jsonb | «secreto de servidor» |
| `rules_version` | text | reglas congeladas al empezar |
| `winner` | text CHECK `A\|B` | **columna DERIVADA** (0016), desnormalizada para índices |
| `created_at` / `updated_at` | timestamptz | `touch_updated_at` sella **cada turno** |

Índices: `(user_id)`, `(user_id, status)`, `(user_id, status, winner)`,
`(user_id, updated_at desc)`.

### ¿Puede representar A vs B sin modificar el modelo?

**NO.** Cinco razones, cada una con su evidencia:

| # | impedimento | evidencia |
|---|---|---|
| 1 | **Un solo `user_id`.** No hay `opponent_id`, `player_a_id`/`player_b_id`. Búsqueda de `opponent_id` en `src/`: **0 coincidencias** | esquema |
| 2 | **Un solo `deck_id`.** El mazo del rival no se puede referenciar | esquema |
| 3 | **`state` contiene información secreta de ambos bandos.** Hoy da igual porque el rival es un bot; con dos personas, una fila que ambos puedan leer filtra el mazo del otro | `state` = `DuelMatch` con `snapshotB` completo |
| 4 | **`difficulty` es obligatorio y `NOT NULL` con CHECK de bot.** Una partida humano-humano no tiene dificultad | `check (difficulty in ('EASY','NORMAL','HARD'))` |
| 5 | **Sin control de versión.** El `UPDATE` es `.eq("id").eq("user_id")` sin `state_version` ni `turn_number` | `persist()` en `duels.ts:406-422` |

**Además:** `toPublicView(m, difficulty)` está **cableado a un lado** —
`const mySnap = m.snapshotA` — así que hoy solo puede servir la vista del jugador A.
Necesitaría un parámetro `side`.

---

## 5. Auth & Ownership

| # | pregunta | respuesta | evidencia |
|---|---|---|---|
| 1 | ¿Cómo sabe el servidor quién juega? | `getSession(req)`: Bearer → GoTrue → `userId` | `server/services/session.ts` |
| 2 | ¿Puede el cliente enviar otro `user_id`? | **No.** El cuerpo no lo acepta; el comentario del servicio lo dice: *«El cliente NUNCA envía su userId — se deriva del token, porque un userId en el body es exactamente el vector que permite operar en nombre de otro»* | `session.ts` |
| 3 | ¿Se valida la propiedad? | **Sí, dos veces** | ↓ |
| 4 | ¿El mazo es del jugador? | **Sí.** `.eq("id", deckId).eq("user_id", userId)` → un mazo ajeno da 404 | `duels.ts:454-458` |
| 5 | ¿Las cartas son suyas? | **Sí.** `validateAgainstOwnership(deck, owned)` re-valida contra `user_cards` REAL | `duels.ts:467` — *«se vuelve a validar contra la propiedad REAL, no contra lo que guardó el cliente»* |
| 6 | ¿Se puede usar un mazo ajeno? | **No** (por #4) | |
| 7 | ¿Se puede cambiar el mazo a mitad? | **No.** `takeDeckSnapshot()` congela las cartas al empezar; el estado usa el snapshot, no el mazo | `duels.ts:471` |
| 8 | ¿Se puede cambiar el usuario de una partida? | **No.** Todas las lecturas y escrituras llevan `.eq("user_id", userId)` | `loadMatch`, `persist` |

**🟢 Esta capa está lista para PvP tal cual.** El modelo de identidad es correcto y la
validación de propiedad se repite en la frontera, no se confía en lo guardado.

---

## 6. Match State — qué falta para PvP

| estado | ¿existe? | necesario para PvP |
|---|---|---|
| `WAITING` | ✅ | sí (reutilizable) |
| `IN_PROGRESS` | ✅ | sí |
| `COMPLETED` / `DRAW` / `UNRESOLVED` | ✅ | sí |
| `matchmaking` / `queued` | ❌ | **sí** — vive fuera de la partida (cola) |
| `matched` / `ready_check` | ❌ | **sí** — ambos deben aceptar |
| `turn_player` / `turn_opponent` | ⚠️ parcial | `attacker: Side` ya existe; falta el mapeo `Side → user_id` |
| `abandoned` | ❌ | **sí** — hoy abandonar **borra la fila** (§8) |
| `disconnected` | ❌ | **sí** — distinto de abandono |
| `expired` (turno sin jugar) | ❌ | **sí** — sin reloj, una partida PvP se cuelga para siempre |

**Ninguno se ha implementado.**

---

## 7. Matchmaking

**Existe un módulo completo y congelado.** `src/matchmaking/` — 12 ficheros: `queue`,
`search`, `balance`, `matchBuilder`, `matchmaker`, `readycheck`, `botfill`, `region`,
`server`, `profile`.

Su propia cabecera declara: *«Player → Queue → Search → Match Builder → Lobby → Session →
Server → Gameplay. Búsqueda BUCKETED (sin O(n²)). DETERMINISTA (reloj lógico). Seguridad:
anti doble-cola, timeouts, cancelación, sin lobbies/sesiones huérfanas.»*

| pregunta | respuesta | evidencia |
|---|---|---|
| A. ¿Existe algo? | **Sí, mucho** | 12 ficheros |
| B. ¿Parcialmente? | Está **completo pero desconectado** | ↓ |
| C. ¿Identificador de oponente? | En el módulo sí (`MatchProposal`); en la BD **no** | `opponent_id` → 0 coincidencias en `src/` |
| D. ¿Existe cola? | Sí, en **memoria** | `queue.ts` — 0 referencias a Supabase en todo `src/matchmaking/` |
| E. ¿Sistema de emparejamiento? | Sí | `search.ts` + `balance.ts` |
| F. ¿MMR? | Sí, en `src/competitive/mmr.ts` (Elo, ligas, temporadas, decay) | módulo congelado |
| G. ¿Reutilizar ranking actual? | **Parcialmente.** `domain/progression/rank.ts` es la escalera VIVA de 8 escalones sobre `profiles.points`, **compartida con Pick'ems**. `src/competitive/` es un MMR de verdad pero tiene **0 consumidores** | §14 |

**Lo que la auditoría obliga a distinguir:**

| categoría | módulo | prueba |
|---|---|---|
| **Preparado y verificado** | `src/online/`, `src/competitive/`, `src/replay/` | sus verifies pasan (§21) |
| **Preparado con bit-rot** | `src/matchmaking/` | **su verify ROMPE** (§17) |
| **Preparado pero inoperante** | adapters WS/Realtime de `platform/cloud` | **lanzan `throw`** |
| **Sin cablear a producto** | los cinco | 0 importaciones desde `src/app/` |
| **Sin cobertura de test** | los cinco | 0 de los 721 tests los tocan |

> El registro `docs/FROZEN.md` lo dice sin rodeos: *«0 consumidores de producto hoy, valor
> de roadmap»*, y para `src/matchmaking/` la condición de descongelación es **«Online
> descongelado»**.

**Recomendación (H):** no rehacer nada. **Descongelar en el orden que el propio registro
fija** — `online` primero (necesita transporte real + auth + UI), luego `matchmaking`, y
`competitive` solo si se quiere ladder PvP separada del rango actual.

---

## 8. Synchronization — la conclusión explícita

> ### **El PvP REQUIERE una nueva capa de sincronización.**

Evidencia: `src/lib/duel/client.ts` solo usa `fetch`. Cero WebSocket, cero
`supabase.channel`, cero `postgres_changes`, cero `EventSource`. El modelo actual funciona
porque **el rival es un bot que se mueve dentro de la misma petición** (`runBot()` avanza
al bot antes de responder). Con dos personas, nadie avisa al otro.

Los adapters existen y **no funcionan**:

```ts
// src/platform/cloud/transport.ts
serverBus(): ServerBus { throw new Error("WebSocketAdapter: el bus de servidor vive en el servidor dedicado (no en-proceso)"); }
serverBus(): ServerBus { throw new Error("RealtimeAdapter: preparado, aún no cableado"); }
```

### Opciones, para NEXUS en concreto

| opción | a favor | en contra | encaje |
|---|---|---|---|
| **Supabase Realtime** | Ya está en la pila; sin servidor nuevo; `postgres_changes` sobre `duel_matches` avisaría solo; el adapter ya está escrito y solo dice «no cableado» | Requiere que el cliente pueda **leer** la fila, y hoy `duel_matches` tiene **RLS sin políticas** (§13) — habría que exponer una **proyección** por jugador, nunca la fila; latencia de replicación | **Recomendada.** Es la de menor superficie nueva |
| **WebSocket dedicado** | Control total, latencia mínima, encaja con `src/online/` (lockstep) | **Servidor nuevo** que desplegar, escalar y autenticar. NEXUS es hoy Next.js + Supabase, sin proceso de larga vida | Solo si el turno pasa a ser en tiempo real |
| **SSE + POST** | Unidireccional pero suficiente (el cliente ya escribe por POST); sin dependencias | Next.js en serverless corta conexiones largas; reconexión a mano | Alternativa razonable si Realtime no encaja |
| **Polling 2-3 s** | Cero infraestructura; funciona hoy mismo | Latencia perceptible; carga proporcional a partidas × jugadores | **Válido para un MVP** de turnos por cartas, que no es un shooter |

**Un duelo NEXUS es por turnos y sin reloj de milisegundos.** Polling corto o Realtime son
suficientes; un servidor dedicado sería sobre-ingeniería para el primer PvP.

---

## 9. Turns & Concurrency — **el punto más crítico**

### Cómo se guarda un turno hoy

```ts
// duels.ts:406-422
async function persist(sb, row, m, rng) {
  await sb.from("duel_matches")
    .update({ status, state, rng, winner })
    .eq("id", row.id).eq("user_id", row.user_id);   // ← sin versión, sin turno
}
```

**No hay control de concurrencia.** Búsqueda de `state_version`, `for update`, `lock`,
`optimistic` en `duels.ts`: **0 coincidencias**.

### Qué protege hoy y qué no

| ataque | ¿protegido? | por qué |
|---|---|---|
| Acción fuera de turno | 🟢 | `if (m.phase !== "ATTACKER_CARD") return fail(409)` |
| Acción tras el resultado | 🟢 | `if (row.state.status !== "IN_PROGRESS") return fail(409)` |
| Carta ya usada | 🟢 | `usedA`/`usedB` en el estado, validado por el orquestador |
| Estadística ilegal | 🟢 | lista blanca + la del defensor **la impone la tabla**, no el cliente |
| Acción de otra partida | 🟢 | `loadMatch` filtra por `user_id` |
| **Doble envío simultáneo** | 🔴 | Dos peticiones leen la misma fila, ambas ven la fase válida, ambas escriben. **Gana la última**: un turno se pierde |
| **Repetición de una acción** | 🟡 | Sin `action_id`. Un reintento tras timeout puede aplicarse dos veces si la primera sí llegó |
| **Recompensa duplicada** | 🟢 | Clave de idempotencia `duel:<matchId>` con **índice único** en el libro mayor |

**Hoy el impacto es bajo** (un jugador, un cliente, contra un bot). **En PvP es
inaceptable:** dos personas escriben en la misma fila.

### Modelo seguro propuesto (conceptual, NO implementado)

```
duel_matches
  + state_version   int not null default 0
  + turn_number     int
  + expected_user   uuid          ← de quién es el turno, no un Side abstracto
  + turn_deadline   timestamptz

UPDATE ... SET state_version = state_version + 1
 WHERE id = $1 AND state_version = $2       ← bloqueo optimista
   AND expected_user = $3                   ← el turno es tuyo

duel_actions (nueva)
  match_id, turn_number, user_id, action_id uuid,
  UNIQUE (match_id, turn_number, user_id)   ← idempotencia por acción
```

**Piezas que YA existen:** `match_id`, número de turno (`currentTurn` dentro de `state`),
fase, validación de legalidad, idempotencia de recompensa.
**Piezas que faltan:** `state_version`, `expected_user`, `action_id`, `turn_deadline`.

---

## 10. Reconnection

| requisito | ¿existe hoy? | evidencia |
|---|---|---|
| Estado persistente suficiente | **🟢 Sí, completo.** `state` jsonb tiene la partida entera; `rng` tiene el generador serializable | `duel_matches` |
| ¿Solo en memoria? | **No.** El motor es explícitamente serializable: *«Guardar, cargar y continuar desde currentTurn no pierde información»* | `match/types.ts` |
| ¿Se puede reconstruir? | **Sí**, y ya se hace: `action: "active"` devuelve la partida en curso | `route.ts` |
| Timeout de turno | **❌ No existe** | sin `turn_deadline` |
| Heartbeat | ❌ en producto (existe en `src/online/heartbeat.ts`, **congelado**) | |
| Última acción | 🟡 `updated_at` por trigger, pero no *quién* la hizo | |

**Contra un bot, reconectar ya funciona hoy** — la Fase 13 lo verificó: el paso «Retoma tu
duelo» del ciclo lee `status='IN_PROGRESS'` y devuelve la partida.

**Para PvP falta lo que depende de que haya OTRA persona esperando:** reloj de turno,
detección de caída, y decidir qué pasa con el rival mientras tanto.

---

## 11. Abandonment

### La implementación actual es incompatible con PvP

```ts
export async function abandonMatch(sb, userId, matchId) {
  const { error } = await sb.from("duel_matches").delete()   // ← BORRA la fila
    .eq("id", matchId).eq("user_id", userId);
}
```

Y es **deliberado y correcto para PvE**, con su motivo escrito:

> *«abandonar no paga nada, porque `abandonMatch` BORRA la fila: no hay partida que cobrar.
> Eso cierra la vía de "empiezo, veo que voy perdiendo y abandono".»*

**En PvP, borrar la fila destruiría la partida del rival.** Habría que sustituirlo por una
transición de estado que conserve la fila y conceda la victoria al que se quedó.

### La inferencia derivada (Fase 13/14) sigue siendo válida… a medias

`status='IN_PROGRESS'` + `updated_at` antiguo funciona porque `touch_updated_at` sella
**cada turno**. Pero en PvP no distingue quién se fue.

| caso | cómo debería resolverse |
|---|---|
| **A. Desconexión temporal** | Reloj de turno con margen (p. ej. 60 s). Reconectar dentro del margen no penaliza |
| **B. Abandono real** (pulsa «abandonar») | Estado `ABANDONED`, victoria al rival, **sin borrar la fila** |
| **C. Timeout** (turno agotado) | Turno perdido o derrota tras N turnos consecutivos. Requiere un proceso que cierre partidas colgadas — **no existe** |
| **D. Rage quit** | Idéntico a B: es un abandono explícito |
| **E. Cierre de navegador** | Indistinguible de A hasta que vence el reloj. Se trata como A y luego como C |
| **F. Pérdida de red** | Igual que E |

**Los seis casos colapsan en dos mecanismos que no existen: un reloj de turno y un cierre
por vencimiento.**

---

## 12. Results & Rewards

```
partida terminada → m.result (del Combat Resolver)
   → duelAward(outcome, difficulty)      ← tabla PURA del dominio
   → capDuelAward (tope diario)
   → app_grant_reward(ref = `duel:<matchId>`)
   → credit_transactions (índice único user_id+ref)
   → profiles.{credits, xp, points} → rankProgress
```

| pregunta | respuesta | evidencia |
|---|---|---|
| ¿Idempotente? | **🟢 Sí.** `duel:<matchId>` con índice único: *«Lo garantiza el índice único del libro mayor, no este código»* | `duels.ts:625` |
| ¿Se puede duplicar? | **No**, ni con reintento ni con carrera | ídem |
| ¿Quién llama al endpoint? | Nadie: se paga **dentro** de `playTurn` cuando la partida termina. No hay endpoint de «cobrar» | `duels.ts:605` |
| ¿El cliente declara ganador? | **No.** No existe campo de entrada | §3 |
| ¿Quién lo calcula? | El Combat Resolver. `winner` en la tabla es una **copia desnormalizada**: *«No decide nada —quién gana lo sigue diciendo el Combat Resolver— y por eso se escribe desde el resultado que él produce, nunca al revés»* | `persist()` |
| ¿Cobrar dos veces? | **No** | |
| ¿Empate? | Paga menos, no mueve rango | tabla `duelRewards` |
| ¿Abandono? | **No paga nada** (la fila desaparece) | §11 |

**Tope diario:** existe (`DAILY_DUEL_AWARD_CAP`), cuenta partidas **ya pagadas** por
asientos `duel_` del día. Motivo escrito: *«conectarlo a la economía sin tope sería abrir
una granja de créditos y de rango»*.

**Riesgo PvP nuevo:** con dos jugadores reales aparece el **colusión / boosting** — dos
cuentas alternando victorias. El tope diario lo limita pero **no lo detecta**. `market_flags`
tiene precedente de detección (`wash_trade`) pero no cubre duelos.

---

## 13. Database Security

| tabla | RLS | políticas | `anon`/`authenticated` |
|---|---|---|---|
| **`duel_matches`** | ✅ activo | **0** | **ningún privilegio** |
| `duel_decks` | ✅ activo | 1 (`SELECT` propio) | SELECT + `TRUNCATE` |
| `user_cards` | ✅ activo | 1 | — |
| `credit_transactions` | ✅ activo | 1 | SELECT + `TRUNCATE` |

### Respuestas a las preguntas fundamentales

| pregunta | hoy | en PvP |
|---|---|---|
| ¿Leer una partida ajena? | **No.** RLS activo, **cero políticas** → el cliente no ve nada | ✅ el modelo aguanta |
| ¿Escribir acciones de otro? | **No.** Sin privilegios de escritura; todo pasa por el servidor | ✅ |
| ¿Modificar el resultado? | **No.** Ni el cliente escribe, ni el endpoint acepta un ganador | ✅ |
| ¿Borrar una partida? | Solo la suya, y **solo por el endpoint** (`abandonMatch`, service_role) | ⚠️ ese comportamiento hay que cambiarlo (§11) |

**🟢 `duel_matches` con RLS y sin políticas es exactamente el modelo correcto para PvP.**
El problema aparece si se elige Supabase Realtime, que necesita que el cliente **lea** la
fila: habría que exponer una **vista/proyección por jugador** que oculte `snapshotB` y
`rng`, nunca la fila cruda.

**Deuda heredada (D-SEC-1, ya documentada, no tocada):** `TRUNCATE` sigue concedido a
`anon`/`authenticated` sobre `duel_decks` y `credit_transactions`, y **TRUNCATE se salta
RLS**.

---

## 14. Telemetry

Siguiendo la filosofía de los bloques 2-5: **derivar antes que almacenar**.

| concepto | clasificación | fuente |
|---|---|---|
| `pvp_match_started` | **DERIVED** | fila de la partida con dos jugadores |
| `pvp_match_completed` | **DERIVED** | `status` + `winner` |
| `pvp_match_abandoned` | **DERIVED** | estado `ABANDONED` (cuando exista) |
| `pvp_turn_played` | **DERIVED** | `state->>'turns'` |
| `matchmaking_started` | **STORED** | La cola vive en memoria: si no se registra, se pierde |
| `matchmaking_found` | **STORED** | Sin él no hay tiempo de espera ni tasa de emparejamiento |
| `matchmaking_cancelled` | **STORED** | Es la señal de que la espera es demasiado larga |
| `reconnect` | **STORED** | Un reintento de conexión no deja rastro en ninguna tabla |
| `timeout` | **DERIVED** | del vencimiento del turno, si se persiste |

**Regla aplicada:** lo que la base de datos ya sabrá (una partida PvP dejará fila) se
deriva; lo que ocurre **fuera** de una transacción —esperar en cola, cancelar, reconectar—
se almacena, porque no deja huella en ningún sitio.

**Tres eventos nuevos, no nueve.** Y ninguno se ha añadido: `EVENT-TAXONOMY.md` sigue con
sus cuatro.

---

## 15. Economy Integration

| sistema | impacto | riesgo |
|---|---|---|
| **Créditos** | La tabla `duelRewards` es por resultado × dificultad. **PvP no tiene dificultad** → falta una entrada | 🟡 decisión de balance, no técnica |
| **XP** | Igual | 🟡 |
| **Rango** (`profiles.points`) | 🔴 **`points` es una moneda COMPARTIDA con Pick'ems.** El propio dominio lo documenta: *«restar ahí significaría que perder un duelo contra un bot borra puntos ganados acertando predicciones»*. Un PvP con descenso reabre esa decisión | **P1** |
| **Tope diario** | Existe, cuenta pagos. En PvP hay **dos** beneficiarios por partida | 🟡 |
| **Misiones / logros** | Leen `duel_matches` por `count` (`progression.ts:62-65`). Con PvP, una partida generaría dos filas o una compartida — **cambiaría el recuento** | 🟡 |
| **Pase** | El carril de pago **prohíbe** por diseño lo que da ventaja competitiva | 🟢 sin impacto |
| **Mercado** | Sin relación directa | 🟢 |
| **Colusión / boosting** | Riesgo **nuevo** que PvE no tenía. Sin detección | **P1** |

---

## 16. Readiness Matrix

**Metodología del score.** Dieciséis áreas, cada una vale hasta 100 según su clasificación:
🟢 READY = 100 · 🟡 PARTIAL = 50 · 🔴 NOT READY = 0. Se **ponderan** porque no todas
bloquean igual: sin sincronización no hay PvP; sin UX, sí lo hay (feo). El score es la
media ponderada, redondeada. Todas las clasificaciones salen de las secciones anteriores.

| # | área | estado | peso | pts |
|---|---|---|---|---|
| 1 | Game engine | 🟢 READY | 10 | 1000 |
| 2 | Server authority | 🟢 READY | 10 | 1000 |
| 3 | Auth | 🟢 READY | 8 | 800 |
| 4 | Deck ownership | 🟢 READY | 8 | 800 |
| 5 | Match state | 🔴 NOT READY | 10 | 0 |
| 6 | Turn synchronization | 🔴 NOT READY | 10 | 0 |
| 7 | Matchmaking | 🟡 PARTIAL *(existe, congelado, verify roto)* | 8 | 400 |
| 8 | Reconnection | 🟡 PARTIAL *(estado sí, reloj no)* | 6 | 300 |
| 9 | Abandonment | 🔴 NOT READY *(borra la fila)* | 6 | 0 |
| 10 | Result validation | 🟢 READY | 8 | 800 |
| 11 | Rewards | 🟡 PARTIAL *(idempotente; falta tabla PvP)* | 6 | 300 |
| 12 | Economy | 🟡 PARTIAL *(puntos compartidos, colusión)* | 5 | 250 |
| 13 | Telemetry | 🟢 READY *(3 eventos por añadir)* | 4 | 400 |
| 14 | Database security | 🟢 READY | 8 | 800 |
| 15 | Client security | 🟢 READY | 8 | 800 |
| 16 | UX | 🔴 NOT READY | 5 | 0 |
| | **TOTAL** | | **120** | **7650** |

### **PvP Readiness Score: 7650 / 12000 = 64/100**

**Lectura:** todo lo difícil de hacer bien —motor determinista, autoridad de servidor,
propiedad, seguridad de base de datos, idempotencia— **ya está**. Lo que falta es
fontanería conocida: modelo de dos jugadores, versión de estado, transporte y reloj.

---

## 17. Risks

| id | riesgo | prioridad | evidencia |
|---|---|---|---|
| ~~**R1**~~ | ~~**Sin control de concurrencia.**~~ **RESUELTO EN PvP (BLOQUE 7.2)**: `state_version` + `UPDATE ... WHERE state_version`. PvE sigue sin él (rival bot, un solo escritor) | ~~P0~~ | migración 0031 |
| ~~**R2**~~ | ~~**`abandonMatch` BORRA la fila.**~~ **RESUELTO EN PvP (BLOQUE 7.2)**: `abandonPvpMatch` persiste `ABANDONED` con autor y momento. PvE conserva su `DELETE` a propósito | ~~P0~~ | `duelsPvp.ts` |
| ~~**R3**~~ | ~~**`state` contiene el mazo secreto del rival.**~~ **CERRADO (BLOQUE 7.3)**: verificado por HTTP con dos cuentas reales — barrido del JSON: 0 cartas ocultas, 0 ids de terceros, 0 emails. La fila sigue completa, y debe serlo | ~~P2~~ | `pvp/projection.ts`, `pvp-sync:verify` |
| **R4** | **Sin reloj de turno.** **PARCIAL (BLOQUE 7.2)**: `turn_started_at`/`turn_deadline_at` existen y `guardAction` rechaza fuera de plazo. **RESUELTO (BLOQUE 7.4.3)**: el barrido cierra la partida con `EXPIRED`, escribe el perdedor en `closed_by` y liquida el rating. Ver `PVP-TIMEOUT.md` | ~~P1~~ | migraciones 0031, 0035 |
| ~~**R5**~~ | ~~**`matchmaking:verify` ROTO.**~~ **RESUELTO (BLOQUE 7.1)** — `buildRivalRoster` excluía a los jugadores sin cartas | ~~P1~~ | `lib/match/roster.ts` + `roster.test.ts` |
| **R6** | **Adapters WS/Realtime lanzan `throw`.** Sin cambios — y ya **no bloquea** PvP: el BLOQUE 7.3 sincroniza por HTTP+polling sin tocarlos | **P2** | `platform/cloud/transport.ts:64,75` |
| **R7** | **Colusión / boosting.** Dos cuentas alternando victorias | **P1** | sin detección |
| **R8** | **`profiles.points` compartido con Pick'ems** | **P1** | `duelRewards.ts` |
| ~~**R9**~~ | ~~**Sin `action_id`.**~~ **RESUELTO (BLOQUE 7.2)**: `duel_match_actions` con `primary key (match_id, action_id)` | ~~P2~~ | migración 0031 |
| **R10** | **0 tests cubrían `online`/`matchmaking`/`competitive`.** El BLOQUE 7.2 añade 19 tests puros + 41 comprobaciones contra BD para el **modelo PvP**; los tres módulos congelados siguen sin cobertura en `npm test` | **P2** | `pvp.test.ts`, `pvp:verify` |
| **R11** | `toPublicView` cableado a `snapshotA` | **P2** | `duels.ts:296-297` |

---

## 18. Technical Debt

| id | deuda |
|---|---|
| ~~**D-PVP-1**~~ | ~~`matchmaking:verify` roto → `verify:all` falla hoy~~ — **saldada en el BLOQUE 7.1** |
| **D-PVP-2** | Cinco módulos congelados (`online`, `matchmaking`, `competitive`, `social`, `custom`) sin cobertura en `npm test` |
| **D-PVP-3** | `difficulty` sigue `NOT NULL` con CHECK de bot. **No bloquea** ya (BLOQUE 7.2 escribe `'NORMAL'` como relleno sin significado en PvP), pero hacerla nullable es una migración pendiente |
| ~~**D-PVP-4**~~ | ~~`duel_matches` sin `state_version`~~ — **saldada en el BLOQUE 7.2** (migración 0031). `turn_number` sigue sin columna: el turno vive en `state` y no ha hecho falta |
| ~~**D-PVP-8**~~ | (BLOQUE 7.3) La sincronización PvP no estaba montada en ninguna pantalla → **RESUELTO (BLOQUE 7.5)**: la monta `/duelos/pvp`. Ver `PVP-ARENA.md` |
| ~~**D-PVP-9**~~ | (BLOQUE 7.3) El endpoint de sincronización no tiene rate limiting; el ritmo lo pone el cliente por buena fe — **RESUELTO (BLOQUE 7.6)**: contador compartido en PostgreSQL (`api_rate_limits` + `app_rate_take`, migración 0036), sujeto = `user_id` del Bearer, 429 con `Retry-After`. Ver `PVP-RATE-LIMIT.md` |
| **D-RL-1** | (BLOQUE 7.6) No hay límite por IP: no existe una IP fiable sin cadena de proxies, y contar anónimos sería un amplificador. Pertenece al borde |
| **D-RL-2** | (BLOQUE 7.6) El límite va **detrás** de `getSession`, que valida el token contra GoTrue con una llamada de red por petición: una inundación autenticada sigue costando una validación cada una |
| **D-RL-3** | (BLOQUE 7.6) El fallo abierto del contador implica que bajo saturación el límite se afloja justo cuando más apretaría |
| **D-SEC-1** | (heredada) `TRUNCATE` concedido sobre `duel_decks` y `credit_transactions` |

---

## 19. Proposed Architecture

```
CLIENTE
   │  ya existe: fetch + Bearer                                  🟢 reutilizar
   ▼
AUTH — getSession(req) → userId                                  🟢 reutilizar tal cual
   ▼
MATCHMAKING — cola persistente + emparejamiento
   │  existe: src/matchmaking/ (congelado, verify roto)          🟡 descongelar y arreglar
   │  falta:  persistencia (hoy la cola vive en memoria)         🔴 construir
   ▼
MATCH — duel_matches con DOS jugadores
   │  falta: player_a_id, player_b_id, expected_user,
   │         state_version, turn_deadline, estado ABANDONED      🔴 construir (migración)
   ▼
SERVER GAME STATE — DuelMatch en jsonb
   │  existe y es PvP-capaz sin tocarlo                          🟢 reutilizar
   ▼
ACTION VALIDATION
   │  existe: fase, legalidad, propiedad, carta usada            🟢 reutilizar
   │  falta:  expected_user + action_id + bloqueo optimista      🔴 construir
   ▼
TURN RESOLUTION — orchestrator + resolver, puros                 🟢 reutilizar
   │  cambio: sustituir runBot() por «esperar al otro humano»    🟡 adaptar el servicio
   ▼
SYNCHRONIZATION
   │  falta entera. Recomendado: Supabase Realtime sobre una
   │  PROYECCIÓN por jugador (nunca la fila cruda), o polling    🔴 construir
   ▼
RESULT — Combat Resolver, autoridad matemática                   🟢 reutilizar
   ▼
ECONOMY — app_grant_reward, idempotente por ref                  🟢 reutilizar
   │  falta: entrada PvP en la tabla de recompensa               🟡 decisión de balance
   ▼
TELEMETRY — 3 eventos nuevos, el resto derivado                  🟢 reutilizar
```

**Reutilizable tal cual: 6 de 10 capas.**

---

## 20. Future Implementation Plan

Ordenadas por **dependencia**, no por deseo. Ninguna se ha empezado.

### FASE A — Modelo de partida de dos jugadores
- **Objetivo:** que `duel_matches` pueda representar A vs B.
- **Afecta:** migración nueva; `server/services/duels.ts`; `toPublicView` con `side`.
- **Riesgo:** medio. Toca una tabla viva con 4 índices y datos reales.
- **Tests:** compatibilidad hacia atrás de las partidas PvE existentes.
- **NO tocar:** `domain/cardgame/` — el motor no cambia.

### FASE B — Concurrencia y autoridad de turno *(depende de A)*
- **Objetivo:** cerrar R1 y R9. `state_version`, `expected_user`, `action_id`.
- **Afecta:** la misma migración; `persist()`; `playTurn()`.
- **Riesgo:** **alto** — es el corazón de la integridad.
- **Tests:** doble envío simultáneo, acción fuera de turno, reintento idempotente.
- **NO tocar:** la tabla de recompensa ni el libro mayor.

### FASE C — Ciclo de vida: abandono, timeout, reconexión *(depende de B)*
- **Objetivo:** cerrar R2 y R4. `ABANDONED`, `turn_deadline`, cierre de colgadas.
- **Afecta:** `abandonMatch` (dejar de borrar); un proceso de vencimiento.
- **Riesgo:** alto. **Cambia el comportamiento de abandono de PvE**, que hoy es una
  decisión antifarmeo deliberada.
- **NO tocar:** el tope diario.

### FASE D — Sincronización *(depende de A)*
- **Objetivo:** que el rival se entere. Empezar por **polling**; Realtime después.
- **Afecta:** `lib/duel/client.ts`; si Realtime, una **proyección** que oculte `snapshotB`
  y `rng` (R3).
- **Riesgo:** alto si se elige Realtime — hay que abrir lectura donde hoy no hay ninguna.

### FASE E — Emparejamiento *(depende de A y D)*
- **Objetivo:** descongelar `src/matchmaking/`. ~~Primero arreglar su verify (R5).~~ *(hecho: BLOQUE 7.1)*
- **Afecta:** el módulo congelado + persistencia de cola.
- **NO tocar:** `src/competitive/` todavía — es una decisión de producto aparte.

### FASE F — Economía y rango PvP *(depende de C)*
- **Objetivo:** entrada PvP en la tabla de recompensa; decidir si `points` se comparte.
- **Riesgo:** **cambio de balance competitivo.** Requiere decisión explícita.

### FASE G — Anti-cheat y colusión *(depende de F)*
- **Objetivo:** detectar boosting. Reutilizar el patrón `market_flags`.

### FASE H — Telemetría PvP *(depende de E)*
- Tres eventos STORED. Todo lo demás derivado.

### FASE I — UX
- Pantalla de cola, ready-check, espera del rival, reconexión, resultado PvP.

### FASE J — Carga y producción
- Prueba con partidas concurrentes; medir escritura sobre `duel_matches`.

---

## 21. Verification Results

Ejecutado **sin modificar ningún test**.

| suite | resultado |
|---|---|
| `npm test` | **721 / 721** |
| `typecheck` | limpio |
| `build` | OK |
| `duel-gameplay:verify` | PASA |
| `duel:e2e` | PASA |
| `security:verify` | PASA |
| `audit:stability` | sin fallos bloqueantes ni importantes |
| `telemetry:verify` | 35 / 35 |
| `analytics:verify` | 48 / 48 |
| `operations:verify` | 33 / 33 |
| `online:verify` | **PASA** |
| `competitive:verify` | **PASA** |
| `replay:verify` | **PASA** |
| **`matchmaking:verify`** | **❌ FALLABA** → ✅ **PASA** tras el BLOQUE 7.1 |

### El fallo — documentado aquí, reparado en el BLOQUE 7.1

```
16 comprobaciones ✓, después:
TypeError: Cannot read properties of undefined (reading 'id')
    at src/lib/match/roster.ts:101:82
    at buildRivalRoster (src/lib/match/roster.ts:98:45)
    at defaultRosterProvider (src/matchmaking/matchBuilder.ts:21:90)
```

**Causa:** en `roster.ts:100`, `cards.reduce((best, c) => …, cards[0])` usa `cards[0]` como
valor inicial. Si `cardsForPlayer(player)` devuelve un array vacío, el acumulador es
`undefined` y la línea 101 revienta al leer `card.id`.

**Impacto:** `matchmaking:verify` es uno de los `scripts/*-verify.ts` que `verify:all`
descubre escaneando el directorio, así que **`npm run verify:all` falla hoy**. Es
exactamente el bit-rot contra el que `docs/FROZEN.md` dice que la red protege
—*«Mantiene su verify en verify:all — protege contra bit-rot»*— y nadie la ha mirado.

**Reparado en el BLOQUE 7.1** (bit-rot de tooling, no de arquitectura). El pool del rival
solo admite ya jugadores CON cartas —`cardsForPlayer` devuelve `[]` para los no elegibles,
26 de 379 en el catálogo—, así que el `reduce` ya no necesita acumulador inicial. Cubierto
por `src/lib/match/roster.test.ts`. `verify:all` vuelve a tener red en este módulo y la
arquitectura PvP congelada (`src/online/`, `src/matchmaking/`, `src/competitive/`) sigue
intacta: `profiles.points` continúa siendo Pick'ems y el MMR/Elo competitivo, separado.

---

*Auditoría sin modificaciones de código (2026-09-06). Evidencia: rutas de fichero y líneas
citadas. Anotada el 2026-09-07 con el resultado del BLOQUE 7.1 (reparó R5/D-PVP-1) y del
BLOQUE 7.2 (modelo de partida de dos jugadores — ver `PVP-MATCH-MODEL.md`) y del BLOQUE 7.3
(sincronización por HTTP+polling — ver `PVP-SYNCHRONIZATION.md`). **Realtime y WebSocket
siguen SIN implementar**; la reconexión completa, tampoco.*
