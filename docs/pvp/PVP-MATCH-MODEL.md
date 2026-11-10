# NEXUS — PvP Match Model

> BLOQUE 7.2. Modelo de partida de dos jugadores: identidad, concurrencia, ciclo de vida y
> estado privado. **Sin matchmaking, sin transporte, sin UI, sin recompensas nuevas.**
> 2026-09-07 · rama `arch/stabilization`

---

## 1. Qué había antes

`duel_matches` nació (migración 0014) para **una persona contra un bot**:

| pieza | qué significaba |
|---|---|
| `user_id` | el único jugador. También el dueño de la fila. |
| `deck_id` | su único mazo. El del rival no existe: se **genera** con `buildOpponentDeck()`. |
| `difficulty` | `EASY\|NORMAL\|HARD` — un concepto de **bot**, `NOT NULL` con CHECK. |
| `state` | el `DuelMatch` entero, **con los dos snapshots**: contiene el mazo secreto del rival. |
| `rng` | estado de los generadores del bot. Secreto de servidor. |
| `winner` | copia desnormalizada de `state` (0016), para índices de misiones. |
| `updated_at` | lo sella el trigger `touch_updated_at` en **cada** escritura. |

Respuestas a las preguntas de la auditoría del modelo actual:

- **¿Dónde se guarda el rival?** En ningún sitio como identidad. El rival es `snapshotB`
  dentro de `state`, un mazo fabricado en el momento; no hay usuario detrás.
- **¿Dónde se guarda el estado?** En `state` (jsonb). Es el `DuelMatch` plano del motor.
- **¿Contiene información que solo debería conocer uno?** **Sí.** `snapshotB` lleva las cartas
  que el rival no ha jugado. Hoy es inocuo porque nadie puede leer la fila.
- **¿Puede el cliente leer `duel_matches`?** **No.** RLS activado y **cero políticas**, más
  `revoke all ... from anon, authenticated`. Deniega por defecto.
- **¿Hay un endpoint que devuelva la fila completa?** **No.** `/api/game/duel` responde
  siempre `toPublicView()`, que redacta el mazo oculto del rival, el `rng` y las semillas.

**Conclusión:** el motor ya era PvP-capaz; lo que no lo era es la fila.

---

## 2. Qué se ha reutilizado (y qué no)

Lo primero que se hizo fue buscar en `src/online/` para no construir una arquitectura paralela.

### `src/online/` NO es reutilizable para esto, y conviene decir por qué

`src/online/` es el netcode **del otro juego**. Conduce `@/sim` + `@/match`: el partido táctico
5v5 con rondas, ticks, posiciones y spike. Su vocabulario lo dice (`RoundSnapshot`, `RoundDelta`,
`PlayerDelta`, `TimedCommand{round, tick}`). El duelo de cartas es `src/domain/cardgame/`, por
turnos y sin reloj.

Se revisó pieza a pieza lo que parecía aprovechable:

| pieza de `src/online/` | ¿sirve aquí? | por qué |
|---|---|---|
| `events.ts` → `acceptSeq`, `OutboundQueue` | **No** | Es dedupe **de transporte**, por conexión y en memoria: `seq` monotónico de un socket vivo. No sobrevive a un proceso, ni identifica una acción de forma persistente. `action_id` es otra cosa. |
| `protocol.ts` → `PROTOCOL_VERSION` | **No** | Versiona el **protocolo de red**, no el estado de una fila. |
| `lobby.ts` | **No** | Es el lobby del 5v5, con `members` y ready-check: eso es matchmaking. |
| `session.ts`, `connection.ts`, `heartbeat.ts` | **No** | Transporte. Explícitamente fuera de este bloque. |

**Por tanto:** `state_version` y `action_id` NO existían en el proyecto y se han creado aquí.
No hay duplicación; hay dos problemas distintos con el mismo aire.

### Lo que SÍ se ha reutilizado, sin reimplementar nada

| necesidad del bloque | pieza existente | dónde |
|---|---|---|
| **expected_player** | `actingSide(match)` | `opponent/controller.ts` — ya deriva el bando que debe decidir de `status` + `attacker` + `phase`. `authority.ts` solo lo traduce a id de usuario. |
| **humano vs humano** | `DuelParticipant` / `createController` | El dominio ya declara *«NO asume que A sea siempre humano»* y *«Humano vs Humano, Humano vs Bot y Bot vs Bot usan exactamente las mismas reglas»*. |
| **propiedad del mazo** | `validateDuelDeck` + `makeDeckResolver` + `ownershipFromList` | La misma frontera que usa PvE. Cero segundas implementaciones. |
| **snapshot congelado** | `takeDeckSnapshot` | Igual que PvE. |
| **reglas y legalidad** | `startDuelMatch`, `selectAttacker*`, `selectDefender*`, `confirmTurn` | El motor decide; el servicio no valida ni una carta a mano. |
| **idempotencia de recompensa** | clave `duel:<matchId>` | Intacta. Ver §8. |

**El motor de duelo no se ha tocado.** Cero diffs en `src/domain/cardgame/{match,combat,opponent}/`.

---

## 3. El modelo nuevo

### Identidad de bando

```
user_id      ─── es el jugador A          (y sigue siendo el dueño en PvE)
player_b_id  ─── es el jugador B          (NULL en PvE: el rival es un bot)
deck_id      ─── mazo de A
deck_b_id    ─── mazo de B
mode         ─── 'PVE' | 'PVP'            (default 'PVE')
```

No se añadió un `player_a_id` redundante: dos columnas para el mismo hecho es exactamente cómo
se desincronizan las cosas. La ambigüedad que el encargo quería evitar se cierra con una
**restricción**, no con un comentario:

```sql
constraint duel_matches_mode_shape check (
  (mode = 'PVE' and player_b_id is null and deck_b_id is null)
  or
  (mode = 'PVP' and player_b_id is not null and deck_b_id is not null
                and player_b_id <> user_id)
)
```

`player_b_id <> user_id` hace **imposible** una partida contra uno mismo, aunque un fallo de
servidor lo intentara. Y la rama `PVE` impide convertir una partida PvE en una PvP falsa.

La traducción identidad → bando vive en **un solo sitio**, `sideForPlayer()`. Nadie más compara
ids con bandos.

### Concurrencia — `state_version`

```
        versión 10
            │
   A actúa ─┼─ B actúa          ambos leyeron la 10
            │
   UPDATE ... WHERE state_version = 10
            │
      ┌─────┴─────┐
   1 fila       0 filas
   → 11         → STALE_VERSION
```

La exclusión la impone **Postgres**, no TypeScript: la segunda escritura no encuentra ya la
versión 10 y afecta a cero filas. `guardAction()` además rechaza antes cualquier acción cuya
`expectedVersion` no sea la actual, para no llegar siquiera a calcular.

### Idempotencia — `action_id`

Tabla `duel_match_actions` con `primary key (match_id, action_id)`. El segundo envío de la
misma acción **choca contra la clave** y no se aplica.

Se eligió una tabla y no una columna `last_action_id` porque una columna solo recuerda la
última acción —solo protege del reintento inmediato— y porque el proyecto ya usa este patrón:
el libro mayor de economía garantiza «una partida, un pago» con un índice único. Reutilizar el
patrón es mejor que inventar otro. Como efecto secundario deja rastro auditable (`state_version`
antes y después), que es lo que hará falta para resolver una disputa.

El orden de escritura es deliberado: **primero el `UPDATE` condicionado, después el registro
de la acción.** Si se reservara la acción antes y el `UPDATE` fallara, quedaría una acción
marcada como aplicada que no lo está, y el reintento devolvería un éxito falso. En este orden
el peor caso es el contrario y es seguro: si el registro falla con el estado ya avanzado, el
reintento no encuentra la acción, ve la versión nueva y responde `STALE_VERSION`. **Se pierde
la comodidad de la respuesta idempotente, nunca la corrección: la transición no puede aplicarse
dos veces.** Hacer ambas cosas atómicas exige una función de Postgres → deuda **P2**, §11.

### Ciclo de vida

```
  MatchStatus (reglas)   +   closed_reason (sesión)   ⇒   PvpLifecycle (efectivo)
```

| efectivo | de dónde sale | ¿acepta acciones? |
|---|---|---|
| `CREATED` | `status = WAITING` | no |
| `IN_TURN` | `status = IN_PROGRESS` | **sí** |
| `FINISHED` | `COMPLETED` · `DRAW` · `UNRESOLVED` | no |
| `ABANDONED` | `closed_reason = 'ABANDONED'` | no |
| `EXPIRED` | `closed_reason = 'EXPIRED'` | no |

**Se deriva, no se guarda**, para no tener un tercer sitio donde el estado se desincronice.
El cierre **gana**: una partida abandonada en el turno 4 sigue diciendo `IN_PROGRESS` en sus
reglas —eso es cierto y no se falsea— pero su ciclo de vida efectivo es `ABANDONED`.

**Estados del encargo que NO se han creado, y por qué:**

- **`READY`** pertenece a un ready-check, que es matchmaking → fuera de este bloque (§18).
- **`TURN`** ya lo expresa `TurnPhase` en el motor (`ATTACKER_CARD`, `DEFENDER_STAT`, …). Un
  segundo enum lo duplicaría, y el encargo pide explícitamente no duplicar. `STARTED` y `TURN`
  colapsan en `IN_TURN`.

Transiciones prohibidas declaradas en tabla (`lifecycle.ts`), no deducidas:
`FINISHED → IN_TURN`, `ABANDONED → IN_TURN`, `EXPIRED → IN_TURN` son todas ilegales.

### Reloj de turno

`turn_started_at` y `turn_deadline_at`, ambos escritos por el servidor. `guardAction` recibe
`now` **por parámetro**: el modelo no puede consultar el reloj por su cuenta, y el cliente no
lo negocia. `PVP_TURN_MS = 90 000`.

Este bloque deja el reloj **representado y comprobado**, no **barrido**: nadie marca todavía
`EXPIRED` automáticamente. El índice parcial `duel_matches_pvp_deadline_idx` está puesto para
que ese barrido, cuando llegue, no escanee la tabla.

### Estado privado

```
SERVER STATE (DuelMatch completo, los dos snapshots)
   ├── projectMatchFor(match, "A") → mazo de A entero + de B solo lo ya jugado
   └── projectMatchFor(match, "B") → mazo de B entero + de A solo lo ya jugado
```

`projectMatchFor` devuelve un `DuelMatch` legítimo —el mismo tipo— con el snapshot del rival
ya recortado. La forma se conserva: quien lo recibe sigue sabiendo **cuántas** cartas quedan
(eso es público, se cuentan sobre la mesa) pero no **cuáles**.

Regla de visibilidad, que es la del juego y no una invención: tus cartas todas; del rival, las
que ya jugó y la que **acaba de declarar atacando**, porque declarar es hacerla pública.

`leakedUids()` es la comprobación inversa y existe para los tests: dado un estado que se va a
enviar, devuelve los uids que no deberían ir. Enviar el estado crudo se delata.

**La frontera es server-side.** Ningún camino del servicio devuelve `rec.match` sin proyectar:
`viewFor()` es el único constructor de respuesta y proyecta siempre, también al crear y al
abandonar.

> **Nota sobre `toPublicView`.** El `toPublicView` de PvE sigue cableado a `snapshotA`
> (R11 de la auditoría). **No se ha tocado**: es el modelo de vista de la pantalla PvE, otra
> capa y otro propósito, y parametrizarlo sin una UI PvP que lo consuma sería cambiar código
> vivo sin red. `projectMatchFor` no lo sustituye ni lo duplica: uno construye una vista de
> interfaz, el otro redacta estado. **R11 quedó resuelta en el bloque 7.5**, que sacó esa
> proyección a `lib/duel/matchView.ts` y la parametrizó por bando: PvE la llama con `A` y la arena
> PvP con el suyo. Ver `PVP-ARENA.md` §8.

---

## 4. Abandono — el cambio de fondo

**PvE (sin cambios):** `abandonMatch()` hace `DELETE`. Es defendible allí: sin fila no hay
recompensa, y así se corta el «empiezo, voy perdiendo y me salgo».

**PvP:** borrar sería destruir la partida de **otra persona** — se llevaría por delante su
resultado, su acreditación y cualquier posibilidad de auditar la disputa.

`abandonPvpMatch()` es por tanto una **transición persistente**:

```
IN_TURN  ──abandonPvpMatch(playerId)──▶  ABANDONED
                                         closed_reason = 'ABANDONED'
                                         closed_by     = quien abandona
                                         closed_at     = reloj del servidor
                                         state_version = +1
```

La fila **se queda**. El estado de juego **no se falsea**: no se inventa un ganador dentro del
motor. Quién cobra lo decidirá la capa de resultado del bloque correspondiente, leyendo
`closed_by` — que por eso se guarda.

El cierre está condicionado igual que una acción (`eq("state_version", …)` + `is("closed_reason", null)`):
dos abandonos simultáneos no pueden ganar los dos, y **el primer motivo manda**.

Los dos ciclos quedan **separados**: `mode` es la frontera, y una partida PvE ni siquiera se
puede leer por la puerta PvP (`NOT_PVP`).

---

## 5. Autoridad del servidor

El cliente no decide **nada** de esto:

| dato | quién lo decide |
|---|---|
| `player_a` / `player_b` | argumentos de servidor a `createPvpMatch` |
| bando propio | `sideForPlayer()`, desde la fila |
| `expected_player` | `actingSide()`, desde el motor |
| turno y legalidad | el orquestador |
| `winner` | el Combat Resolver, copiado a la columna desde `m.result` |
| `state_version` | el servidor, `+1` por transición |
| reloj de turno | el servidor, `now` inyectado |
| cartas, OVR, estadísticas | el catálogo y el inventario real |

Lo único que el cliente aporta es `deckId`, `cardUid`, `stat` (solo atacando), `actionId` y
`expectedVersion`. Ninguno le da autoridad: los dos primeros se revalidan contra la propiedad
real, `stat` la impone la tabla cuando defiende, `actionId` solo sirve para reconocer su propio
reintento y `expectedVersion` solo puede hacer que le rechacen.

`playerId` **nunca** sale del cuerpo de la petición: entra ya autenticado.

---

## 6. Compatibilidad PvE

Requisito duro del bloque, verificado:

- Todas las columnas nuevas son opcionales o con default → **ninguna fila existente se toca**.
  Las 4 partidas de la base local siguieron intactas y quedaron etiquetadas `PVE`.
- `duel_matches_mode_shape` **impide** que una fila PvE lleve jugador B.
- `startMatch()` (PvE) no se modificó. Sigue creando `mode = 'PVE'`, `player_b_id = NULL`.
- Reglas, stats, OVR, roles, dificultad, desempate, empate, recompensas y economía: **sin
  cambios**. El bot sigue funcionando.
- El nuevo modelo es una **extensión**, no una sustitución.

---

## 7. Telemetría (solo documentación — no se ha creado ni un evento)

Datos que una futura telemetría **podrá derivar** de este modelo sin añadir eventos nuevos,
porque ya quedan persistidos:

| dato derivable | de dónde |
|---|---|
| duración real de un turno | `turn_started_at` → `created_at` de la siguiente acción |
| turnos jugados antes de abandonar | `count(duel_match_actions)` + `closed_at` |
| tasa de abandono y en qué turno | `closed_reason` + `state_version` al cerrar |
| expiraciones por reloj | `closed_reason = 'EXPIRED'` |
| reintentos de red | acciones con `action_id` repetida (chocan, no se insertan) |
| conflictos de concurrencia | rechazos `STALE_VERSION` |
| resultado y ganador | `status` + `winner`, ya existentes |

**No se ha tocado** la taxonomía de telemetría ni analytics (§20/§21).

---

## 8. Recompensas y economía — intactas

- La clave de idempotencia **sigue siendo `duel:<matchId>`**, y por eso la partida PvP vive en
  la **misma tabla**: un solo espacio de ids de partida mantiene esa garantía para los dos modos.
- **`action_id` NO es clave de recompensa** y nunca debe serlo: una partida contiene muchas
  acciones y pagar por acción sería pagar diez veces. La recompensa es del **resultado**.
- `awardMatchOutcome` no se ha modificado ni se invoca desde el camino PvP: **no hay recompensa
  PvP todavía**, por diseño.
- `credits`, `economy_ops`, `credit_transactions`, misiones, pase, logros y mercado: sin tocar.

## 9. Competitive y Pick'ems — intactos

- **`profiles.points` sigue siendo exclusivamente Pick'ems.** Ni el modelo ni el servicio PvP
  lo leen ni lo escriben.
- **Competitive MMR/Elo sigue separado**: `src/competitive/` mantiene su propio
  `CompetitiveProfile` reutilizando el Elo de `@/domain/esports/predict/elo`, sin relación con
  la tabla `profiles`.
- No se ha implementado MMR, ranking ni temporadas.

---

## 10. Lo que este bloque NO implementa (explícito)

Matchmaking · cola · emparejamiento · WebSocket · Supabase Realtime · SSE · polling · UI PvP ·
lobby PvP · reconexión · MMR nuevo · ranking · recompensas PvP · economía nueva · eventos de
telemetría · barrido automático de `EXPIRED`.

`src/matchmaking/` **no se ha conectado** al modelo. Sigue congelado.

---

## 11. Deudas que este bloque deja anotadas

| id | deuda | prioridad |
|---|---|---|
| **D-PVP-5** | `UPDATE` de estado y registro de la acción no son atómicos. Un fallo entre medias hace que el reintento devuelva `STALE_VERSION` en vez de la respuesta idempotente. **Nunca aplica dos veces.** Se cierra con una función de Postgres. | P2 |
| ~~**D-PVP-6**~~ | ~~Nadie marca `EXPIRED` todavía~~ → **RESUELTO** por el bloque 7.4.3, que reutiliza el `EXPIRED` que esta migración dejó reservado. Ver `PVP-TIMEOUT.md`. | — |
| **D-PVP-3** *(heredada)* | `difficulty` sigue `NOT NULL` con CHECK de bot. En PvP se escribe `'NORMAL'` como relleno **sin significado** —nada lo lee, no hay bot que graduar—. Hacerla nullable es una migración de su propio bloque. | P2 |
| ~~**R11**~~ | ~~`toPublicView` cableado a `snapshotA`~~ → **RESUELTO** por el bloque 7.5: `buildMatchView` recibe el bando. | — |
| **D-PVP-7** | El abandono guarda `closed_by` pero **no acredita** al rival. Deliberado: las recompensas PvP son de otro bloque. | P1 |

Las deudas **D-PVP-1** (verify roto) y **R5** las cerró el Bloque 7.1. Las migraciones
**0026–0028** siguen sin aplicar: deuda ajena, no tocada aquí.

---

## 12. Verificación

| capa | dónde | qué cubre |
|---|---|---|
| unidad, pura | `src/domain/cardgame/pvp/pvp.test.ts` (19 tests, en `npm test`) | ciclo de vida, transiciones, `expected_player`, guard completo, versión, secreto |
| integración real | `scripts/pvp-model-verify.ts` (`npm run pvp:verify`, 41 comprobaciones, en `verify:all`) | dos cuentas reales, restricciones de la BD, propiedad, concurrencia, idempotencia, abandono, compatibilidad PvE, RLS |

`npm run pvp:verify` crea sus propias cuentas, cartas, mazos y partidas, y lo borra todo al
terminar (`on delete cascade` desde la cuenta).
