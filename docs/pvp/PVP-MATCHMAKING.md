# NEXUS — PvP Matchmaking

> BLOQUE 7.4. Cola de emparejamiento persistente para los duelos de cartas: alta, emparejamiento
> atómico, cancelación, caducidad y guarda de partida activa.
> **Sin arena, sin UI, sin WebSocket, sin recompensas, sin MMR.**
> 2026-09-08 · rama `arch/stabilization`

Ubicación: este documento vive en `docs/pvp/` junto a `PVP-MATCH-MODEL.md` (7.2) y
`PVP-SYNCHRONIZATION.md` (7.3), que es donde el repositorio guarda la documentación de PvP.

---

## 1. Qué había antes de este bloque

| pieza | estado real |
|---|---|
| `duel_matches` | Sabe representar A contra B desde 0031. **Pero solo nace llamando a `createPvpMatch()` con los dos ids ya decididos**, y no había nadie que los decidiera. |
| `duelsPvp.ts` | Crea, sincroniza, aplica acciones y abandona. Su cabecera dice literalmente «No es matchmaking». |
| `/api/game/duel/pvp` | Sincroniza una partida que ya existe. |
| Cola persistente | **No existía.** Ni tabla, ni endpoint, ni servicio. |
| Rating PvP persistente | **No existe.** Ver §5. |

Es decir: el 7.2 dejó la partida y el 7.3 dejó la conversación entre los dos jugadores. Faltaba
exactamente lo de en medio.

---

## 2. Auditoría — qué se miró antes de escribir una línea

### `src/matchmaking/` — auditado y **NO reutilizado**

Es la cola del **juego táctico 5v5**, no la del juego de cartas. Está **congelado**
(`docs/FROZEN.md`) y su condición de descongelación escrita es «Online descongelado».

Se revisó pieza a pieza, no por el nombre:

| pieza | ¿sirve aquí? | por qué |
|---|---|---|
| `Queue` (`queue.ts`) | **No** | Es un `Map<string, QueueTicket>` **en memoria de proceso**. No sobrevive a un refresco, ni a un reinicio, ni a un segundo proceso Node — y dos procesos con dos `Map` emparejarían al mismo jugador dos veces sin enterarse. Cero líneas de persistencia en todo el módulo. |
| `Matchmaker` (`matchmaker.ts`) | **No** | Empareja `QueueTicket` con `PlayerProfile{mmr, skill, level, region, rolePrefs, roster}`. Un duelo de cartas no tiene roster, ni región, ni rol. |
| `readycheck.ts` | **No** | Ready-check con aceptar/rechazar y `deadlineAt` sobre un **reloj lógico**. No es este flujo y traería un estado más que no se pide. |
| `region.ts`, `server.ts`, `botfill.ts`, `balance.ts` | **No** | Ping por regiones, selección de nodo dedicado, relleno con bots y equilibrio de composición 5v5. Nada de eso existe en el duelo. |

**Comparten la palabra «cola» y nada más.** Integrarlo habría exigido descongelarlo, cambiar su
modelo de datos y darle persistencia — es decir, reescribirlo — y además habría roto la regla del
propio `FROZEN.md`. **No se ha tocado ni un byte de `src/matchmaking/`**, y su verify sigue en
verde.

### `src/competitive/` — auditado; **es el BLOQUEADOR del rating**. Ver §5.

### Lo que SÍ se ha reutilizado, sin reimplementar nada

| necesidad | pieza existente | dónde |
|---|---|---|
| propiedad y legalidad del mazo | `resolveDeckSnapshot` (era `snapshotFor`, del 7.2) → `validateDuelDeck` + `makeDeckResolver` + `ownershipFromList` | **La misma frontera exacta que usan PvE y la creación de partida.** No hay una segunda implementación de las reglas de mazo en este bloque. |
| creación de la partida | `createPvpMatch` (7.2) | Se le ha añadido `opts.matchId`; no se ha duplicado. |
| snapshot congelado y reglas | `takeDeckSnapshot`, `startDuelMatch` | Intactos. |
| autoridad de sesión | `getSession(req)` | El `userId` sale del Bearer, igual que en todas las rutas. |
| convención de ruta | `/api/game/*` plano + `action` en el cuerpo | La misma que audita y documenta `/api/game/duel/pvp`. |

**El motor de duelo no se ha tocado.** Cero diffs en `src/domain/cardgame/{match,combat,opponent}/`.

### Qué está muerto o no conectado (y se ha dejado como estaba)

- `src/matchmaking/`, `src/competitive/`, `src/online/`, `src/social/`: congelados, sin
  consumidores de producto. **Sin tocar.**
- `usePvpSync` (7.3) no se montaba en ninguna pantalla (D-PVP-8) — **resuelto en el bloque 7.5**.
- Migraciones 0026–0028 siguen pendientes por decisión ajena. **No se han tocado.**

---

## 3. Arquitectura

```
CLIENTE
  │  POST /api/game/duel/matchmaking { action: "enqueue", deckId }
  ▼
RUTA        getSession(req) → userId          ← del Bearer, NUNCA del cuerpo
  ▼
SERVICIO    duelsMatchmaking.enqueue()
  │  1. resolveDeckSnapshot()  ← validación COMPLETA reutilizada del 7.2
  │  2. rpc duel_pvp_enqueue   ← propiedad + guarda + INSERT, en UNA transacción
  │  3. attemptMatch()         ← se intenta emparejar ya mismo
  ▼
POSTGRESQL  duel_pvp_queue  (índice único parcial · for update skip locked)
```

Y el emparejamiento, que son tres pasos por una razón concreta:

```
duel_pvp_claim_pair()      reserva A y B  +  RESERVA el id de la partida     [transacción 1]
        │                  for update skip locked  →  otro emparejador SALTA estas filas
        ▼
createPvpMatch(…, matchId) resuelve los 2 mazos, congela, inserta duel_matches con ESE id
        │                  (es TypeScript: el motor no vive en la base de datos)
        ▼
duel_pvp_commit_pair()     las 2 entradas → MATCHED, contra la partida ya existente [transacción 2]
        │
        └─ si falla ─────▶ duel_pvp_release_pair()  culpable → CANCELLED, inocente → QUEUED
```

**Por qué no es una sola transacción:** el `state` inicial de una partida son dos mazos
resueltos contra el inventario real, validados y congelados por `takeDeckSnapshot`. Reescribir
eso en plpgsql sería un **segundo motor de duelo**, que es exactamente lo que no se puede hacer.
La ventana entre las dos transacciones está cubierta por el arrendamiento (§8).

### Quién dispara el emparejador

**El propio tráfico.** No hay `cron`, ni worker, ni temporizador: `enqueue` y el `GET` de estado
de quien está en cola ejecutan un intento. Como el transporte ya definido es HTTP + sondeo
(7.3), los jugadores que buscan partida están, por definición, generando esas peticiones. Un
scheduler solo añadiría una pieza que puede caerse en silencio.

**No existe una acción `attempt` pública, y es deliberado:** sería una palanca que cualquiera
podría accionar en bucle.

### Ficheros

| fichero | qué es |
|---|---|
| `supabase/migrations/0032_pvp_matchmaking.sql` | Tabla, invariantes, índices, RLS y las 9 funciones. **Aquí está la atomicidad.** |
| `src/domain/cardgame/matchmaking/` | Vocabulario puro (estados, códigos, vista) y la política escrita. No empareja. |
| `src/server/services/duelsMatchmaking.ts` | Encadena las funciones SQL con `createPvpMatch`. |
| `src/app/api/game/duel/matchmaking/route.ts` | El endpoint. |
| `scripts/pvp-matchmaking-verify.ts` | **110** comprobaciones contra PostgreSQL y HTTP reales (84 sin servidor). |

---

## 4. La cola y sus estados

```sql
duel_pvp_queue (
  id, user_id, deck_id,
  state              QUEUED | PAIRING | MATCHED | CANCELLED | EXPIRED,
  rating_snapshot    -- siempre NULL hoy. Ver §5.
  pair_token, pairing_expires_at,   -- reserva de pareja
  match_id, matched_at,
  closed_reason      USER | EXPIRED | DECK_INVALID | MATCH_FAILED,
  created_at, updated_at, expires_at
)
```

```
                 ┌──────────── cancel ────────────▶ CANCELLED
                 │                                      ▲
   enqueue ──▶ QUEUED ──── claim_pair ──▶ PAIRING ──────┘ (mazo ilegal)
                 │                          │
              (TTL)                    commit_pair
                 ▼                          ▼
              EXPIRED                    MATCHED ──▶ Bloque 7.3
```

`PAIRING` es el único estado no obvio y existe por el motivo de §3: es la reserva mientras el
motor de TypeScript construye la partida. Es efímero (arrendamiento de 20 s) y se recupera solo.

**`duel_matches.status` NO se reutiliza para esto**, y no por gusto: una entrada de cola existe
*antes* de que haya rival, y una fila de partida sin jugador B está prohibida por
`duel_matches_mode_shape` (0031). Son dos ciclos de vida y son dos tablas.

### Un usuario = como mucho una búsqueda viva

```sql
create unique index duel_pvp_queue_active_uniq
  on duel_pvp_queue (user_id) where state in ('QUEUED','PAIRING');
```

No es un `SELECT` previo al `INSERT` —eso tiene carrera— sino una **imposibilidad**. Cinco altas
simultáneas del mismo usuario dejan **una** fila; las cuatro perdedoras leen la ganadora y
responden `ALREADY_QUEUED`, que es la semántica correcta de un doble clic.

### Forma de cada estado

`duel_pvp_queue_state_shape` prohíbe en la base de datos los tres estados inconsistentes que el
encargo enumera: `MATCHED` sin `match_id`, `PAIRING` sin testigo, y terminal-no-`MATCHED` con
partida asociada.

---

## 5. Rating / MMR — **D-MM-1 RESUELTO** (bloque 7.4.1)

> **Este apartado describía un BLOQUEO. Ya no lo es.** Cuando se cerró el bloque 7.4 no existía
> ninguna fuente de rating PvP persistente y autoritativa, así que el emparejamiento era FIFO puro
> y `rating_snapshot` se quedaba en `NULL` a propósito, antes que inventarse un MMR. El bloque
> **7.4.1** creó esa fuente. Lo que sigue es el estado actual; el detalle completo está en
> **`docs/pvp/PVP-RATING.md`**.

### La fuente: `duel_pvp_ratings` (migración 0033)

Rating Elo por jugador, persistente y server-authoritative, con libro de auditoría
(`duel_pvp_rating_events`). Rating inicial **1000**, K **40** provisional / **24** asentado.

Sigue sin usarse nada de lo que se descartó en la auditoría, y por las mismas razones:

| descartado | por qué |
|---|---|
| `profiles.points` | Es Pick'ems (0015 construye sobre él índices y vistas de ranking públicas). Sigue intacto. |
| `src/competitive/` | Motor **en memoria** y **congelado** del juego táctico 5v5. No se ha tocado. |
| `team_ratings` (0005) | Elo de **equipos de esports reales** para predicciones. Ni habla de usuarios. |

De `src/domain/esports/predict/elo.ts` se reutiliza **solo la matemática**, y además como
**oráculo de pruebas**: la fórmula de liquidación vive en SQL (tiene que ser atómica con el libro)
y el verificador comprueba que devuelve exactamente lo mismo que `expectedScore`/`updateElo`.

### El snapshot

`duel_pvp_queue.rating_snapshot` es ahora **`NOT NULL`**. Lo sella `duel_pvp_enqueue` dentro de su
propia transacción leyéndolo de `duel_pvp_ratings`, y **la función no tiene ningún parámetro de
rating**: no es que se ignore el que mande el cliente, es que no existe el camino.

No se recalcula mientras se espera: «mi rating ahora» y «el rating con el que entré» son cosas
distintas. Ver `PVP-RATING.md` §9.

### Criterio de emparejamiento

Ya no es FIFO puro. Son dos pasos:

1. **El buscador** es el que más ha esperado — la prioridad FIFO se conserva intacta.
2. **Su rival** es, de entre los compatibles, el de **menor diferencia de rating**; a igualdad,
   el que más ha esperado.

Ventana por tiempo en cola: ±150 (0–15 s) · ±300 (15–45 s) · ±600 (45–90 s) · libre (90 s+).
Calibrada para una población casi inexistente y documentada en `PVP-RATING.md` §10.

Con todos los ratings iguales (población nueva) la diferencia es 0 para todos y el desempate por
antigüedad reproduce **exactamente** el FIFO de este bloque.

### Cuándo cambia el rating (bloque 7.4.2)

**Emparejar no lo mueve. Entrar en cola no lo mueve. Cancelar no lo mueve.** El rating cambia
únicamente cuando un duelo llega a un estado terminal:

- **final normal** — el motor resuelve la partida en `applyPvpAction`; tras el `UPDATE`
  condicionado por `state_version`, se liquida.
- **abandono explícito** — `abandonPvpMatch` escribe `closed_reason = 'ABANDONED'` y `closed_by`;
  el que se va pierde y el rival gana.
- **vencimiento del turno** (7.4.3) — el barrido escribe `closed_reason = 'EXPIRED'` y `closed_by`
  con el jugador que debía mover; ese pierde y el rival gana. Ver `PVP-TIMEOUT.md`.

El resultado lo decide siempre el servidor leyendo `duel_matches`; no hay ningún parámetro por el
que un cliente pueda declarar ganador, delta ni rating. Detalle completo en `PVP-RATING.md` §11
y §12.

---

## 6. Seguridad

| vector | qué lo impide |
|---|---|
| `user_id` en el cuerpo | La ruta **no lo lee**. `getSession(req)` → Bearer. Verificado enviando `userId`, `playerId` y `user_id` de otra cuenta: la entrada se crea a nombre del token. |
| `user_id` en la query | Igual. Verificado con `?userId=<otro>`. |
| rating/MMR del cliente | Ninguna capa lo lee. Verificado enviando `rating`, `mmr`, `elo`, `skill` y `rank`: `rating_snapshot` sigue `NULL`. |
| elegir al rival | **No hay ningún parámetro para nombrarlo.** Verificado enviando `opponentId`/`playerB`: se ignora y el servidor empareja por FIFO. |
| elegir el mazo del rival | Idem: el mazo de B sale de **su** entrada de cola. |
| cancelar la cola de otro | `cancel` **no acepta parámetros**: cancela la del token. Verificado. |
| encolarse con mazo ajeno | Doble red: `resolveDeckSnapshot` filtra por `user_id` (404, no 403) y `duel_pvp_enqueue` lo comprueba otra vez dentro de la transacción del `INSERT`. |
| enumerar la cola | RLS activo y **cero políticas** + `revoke all`. Ni `anon`, ni `authenticated`, ni el propio dueño pueden leer la tabla. Las funciones son `security definer` y solo se conceden a `service_role`. |
| emails, tokens, mazos | La vista de cola devuelve `entryId`, `deckId` propio, estado, `matchId` y tiempos. `userId` se cae en la traducción a vista: lo que no sale, no se puede filtrar. |
| self-match | Tres redes independientes: el índice único parcial (dos filas vivas ⇒ dos usuarios), `a.user_id <> b.user_id` en `claim_pair`, y `duel_matches_mode_shape` (0031) en el `INSERT`. |
| doble partida | `for update skip locked` + guarda de partida activa + reconciliación por id reservado. |

**Oráculo de enumeración:** un mazo ajeno responde **404, no 403**, igual que en el 7.3.

---

## 7. Concurrencia

El caso obligatorio del encargo, probado contra PostgreSQL:

```
Worker 1: claim_pair  ──┐
Worker 2: claim_pair  ──┼── 4 simultáneos, 2 candidatos
Worker 3: claim_pair  ──┤
Worker 4: claim_pair  ──┘

Resultado:  1 × PAIRED   ·   3 × NO_CANDIDATES
```

El segundo emparejador **no espera** a que el primero suelte las filas: las **salta**
(`skip locked`), así que no puede reservar a los mismos jugadores. No hay «leer, comprobar,
escribir» en ninguna parte; hay bloqueo de fila.

Y con cuatro candidatos y dos emparejadores simultáneos: **dos parejas disjuntas**, ningún
jugador repetido en ambas.

Nada de esto se resuelve con un mutex de JavaScript, y no podría: dos procesos Node tienen dos
mutex distintos. La exclusión vive donde vive el dato.

---

## 8. Atomicidad y recuperación

La ventana entre «reservar la pareja» y «crear la partida» es la única costura del sistema, y
está cerrada por dos decisiones:

1. **El id de la partida se RESERVA en la transacción que empareja**, no se descubre después.
   Por eso `duel_pvp_queue.match_id` no tiene clave foránea: apunta a una fila que nacerá una
   transacción más tarde. Es una decisión escrita en la migración, no un olvido.
2. **`_duel_pvp_sweep` reconcilia preguntando por ese id exacto.** Si el proceso muere en medio:
   - la partida **existe** → las entradas pasan a `MATCHED`. Devolverlas a la cola crearía una
     segunda partida para alguien que ya está jugando.
   - la partida **no existe** → vuelven a `QUEUED` (o a `EXPIRED` si su TTL ya venció).

   Sin id reservado, esa pregunta solo se podría responder por heurística de tiempo.

**Los dos casos están probados matando el proceso a propósito** (familia 3b del verificador): se
reserva la pareja, se vence el arrendamiento sin confirmar ni liberar, y se comprueba el estado
final en la tabla. Sin partida creada, los dos vuelven a `QUEUED`; con partida creada, los dos
acaban `MATCHED` sobre esa misma partida y **no aparece una segunda**.

Los tres estados prohibidos —`A=MATCHED` con `B=QUEUED`, dos `MATCHED` sin `match_id`, y dos
partidas— son **imposibles**: los dos primeros por `duel_pvp_queue_state_shape` y por el
`commit_pair` que exige actualizar exactamente 2 filas o ninguna; el tercero por el bloqueo.

---

## 9. Idempotencia

| operación | qué la hace idempotente |
|---|---|
| `enqueue` × 3 | El índice único parcial. Tres POST → **una** entrada; la 2.ª y 3.ª responden `ALREADY_QUEUED` con la misma `entryId`. |
| `cancel` × 2 | La segunda no encuentra entrada viva y devuelve la última conocida con su estado real. Ni error destructivo, ni mentira: si en realidad se emparejó, lo dice. |
| `attempt` × N | Cada intento reserva o no reserva. Un segundo intento sobre los mismos jugadores no encuentra candidatos. |

**No se ha introducido un `operation_id`.** La clave de idempotencia natural es «este usuario ya
está buscando», y ya la impone la base de datos. Un testigo que el cliente tuviera que recordar
entre recargas sería una pieza más que puede perderse — y el objetivo del bloque es justo que el
estado no dependa del navegador.

---

## 10. Cancelación

`QUEUED → CANCELLED` es un `UPDATE` con `state = 'QUEUED'` en el `WHERE`. Si un emparejador ya
reservó la entrada, afecta a **cero filas** y la cancelación **pierde**: se responde `PAIRING` y
el desenlace se verá en el siguiente sondeo. Es la única forma de garantizar que nunca coexistan
`CANCELLED` y `MATCHED`, y por eso la decisión no se toma en TypeScript.

**Nunca se crea una partida después de una cancelación confirmada:** una entrada `CANCELLED` ya
no es elegible, y el emparejador solo mira `QUEUED`.

---

## 11. Caducidad

TTL de **10 minutos**. El mecanismo es **oportunista**, no un `cron`:

- `_duel_pvp_sweep()` corre al principio de cada `enqueue`, `cancel`, `status` y `claim_pair`.
- Y —esto es lo que lo hace **garantizado** y no solo probable— `duel_pvp_claim_pair` filtra
  además por `expires_at > now()`. **Aunque el barrido no llegara a correr nunca, una entrada
  caducada no puede emparejar.** El barrido solo la etiqueta; la elegibilidad no depende de él.

No se ha construido un scheduler para esto, tal y como pedía el encargo. Si nadie usa el
matchmaking, no hay nada que caducar.

---

## 12. Guarda de partida activa

Antes de emparejar se comprueba, **en SQL y dentro de la misma transacción**, que ninguno de los
dos tenga una PvP viva (`mode='PVP'`, `closed_reason is null`, `status in ('WAITING','IN_PROGRESS')`).
También al entrar en cola, donde responde `409 ACTIVE_MATCH`.

No se confía en el navegador ni en que el cliente «recuerde» salir de la partida anterior. El
índice `duel_matches_pvp_active_a_idx` (nuevo) y `duel_matches_pvp_b_idx` (0031) evitan que esa
comprobación sea un recorrido secuencial.

---

## 13. Integración con `duel_matches` (7.2) y con la sincronización (7.3)

La partida creada es **exactamente** la del 7.2, porque la crea `createPvpMatch` sin
modificaciones de comportamiento:

```
mode = 'PVP'   user_id = A   player_b_id = B   deck_id = mazo A   deck_b_id = mazo B
state_version = 0            state = DuelMatch del motor        closed_reason = null
```

El único cambio en `createPvpMatch` es `opts.matchId`: con él, el id se decide antes y se inserta
explícitamente. Eso **elimina** el `UPDATE` extra que antes reescribía `state` con el id que
hubiera puesto la base de datos, y cierra la ventana en la que `state.id` no coincidía con la
fila. Sin `opts.matchId` el comportamiento es idéntico al anterior.

Después, el 7.3 sigue tal cual: el `matchId` que devuelve el matchmaking se usa sin traducción en
`GET /api/game/duel/pvp?matchId=…`. Verificado con los dos jugadores reales.

**Reglas de combate: cero diffs.** Comparación de stats, desempates, turnos, bots y reglas de
mazo, intactos.

---

## 14. API

`/api/game/duel/matchmaking` — ruta **plana** bajo `/api/game/*` con discriminador `action`,
igual que el resto de `src/app/api` (donde no existe ni un segmento dinámico).

| método | cuerpo | respuesta |
|---|---|---|
| `GET` | — | estado de **mi** búsqueda; ejecuta un intento de emparejamiento si estoy en cola |
| `POST` | `{ action: "enqueue", deckId }` | entra en cola (+ intento inmediato) |
| `POST` | `{ action: "cancel" }` | sale de la cola |

Respuesta:

```jsonc
{
  "code": "OK | ALREADY_QUEUED | NOT_QUEUED | PAIRING | IDLE",
  "entry": {
    "entryId": "…", "deckId": "…",
    "state": "QUEUED | PAIRING | MATCHED | CANCELLED | EXPIRED",
    "matchId": "…"   // solo con state = MATCHED → puerta al 7.3
    "reason": "USER | EXPIRED | DECK_INVALID | MATCH_FAILED | null",
    "createdAt": 0, "updatedAt": 0, "expiresAt": 0, "matchedAt": 0
  },
  "position": 0,      // cuántos llevan esperando MÁS que yo
  "serverNow": 0      // reloj del SERVIDOR: la espera se calcula con este
}
```

**`position` es lo único agregado que sale**, y es exactamente el significado del criterio FIFO:
un entero que no nombra a nadie. **No sale**: la lista de la cola, su tamaño, el rating de nadie,
el mazo de nadie ni el id de ningún otro usuario.

Errores: `401` sin token · `400` mazo mal formado · `404` mazo ajeno o inexistente ·
`409 ACTIVE_MATCH` con una PvP viva.

---

## 15. Rendimiento

Medido por el verificador contra PostgreSQL local (10 muestras donde aplica):

| operación | tiempo |
|---|---|
| alta en cola (RPC) | 5–11 ms |
| reserva de pareja (`claim_pair`) | 3–9 ms |
| emparejamiento **completo** (reserva + 2 mazos + partida + confirmación) | 25–51 ms |
| consulta de estado | 3,6–5,1 ms de media (10 muestras) |

(El extremo alto de cada rango es con el servidor de desarrollo levantado compitiendo por la
máquina; el bajo, contra PostgreSQL a solas.)

Decisiones que lo sostienen:

- La selección de candidatos es `order by created_at, id limit 2` sobre un **índice parcial**
  (`where state = 'QUEUED'`): no recorre entradas emparejadas, canceladas ni caducadas.
- La guarda de partida activa usa índices parciales por los dos lados (A y B).
- **No hay N+1**: el emparejamiento son 3 llamadas de ida y vuelta, fijas, independientemente del
  tamaño de la cola.
- No se carga nunca la tabla de jugadores ni la cola entera en Node.
- El barrido de reservas huérfanas usa `skip locked`: no bloquea a nadie.

50 ms de emparejamiento contra un arrendamiento de 20 s deja un margen de ~400×, que es lo que
hace que la recuperación del §8 sea un caso patológico y no el caso normal.

---

## 16. Cómo ejecutar los verificadores

```bash
# Requisitos: Supabase local levantado (54521). El servidor (:3005) solo para las familias 5 y 7.
npm run pvp-matchmaking:verify     # este bloque — 110 comprobaciones (84 sin servidor)
npm run pvp:verify                 # modelo PvP (7.2)
npm run pvp-sync:verify            # sincronización (7.3) — necesita servidor
npm run matchmaking:verify         # cola 5v5 CONGELADA — debe seguir verde e intacta
npm run competitive:verify         # MMR 5v5 CONGELADO — debe seguir verde e intacto
```

Sin servidor, las familias 5 (seguridad HTTP) y 7 (continuidad con el 7.3) se declaran
**omitidas en voz alta** y **no se cuentan como correctas**.

---

## 17. Deudas

| id | deuda | prioridad |
|---|---|---|
| ~~**D-MM-1**~~ | ~~BLOQUEADOR: no existe rating PvP persistente~~ → **RESUELTO** por el bloque 7.4.1 (`duel_pvp_ratings`, migración 0033). Ver §5 y `PVP-RATING.md`. | — |
| **D-MM-4** *(nueva, 7.4.1)* | El emparejador se serializa con un cerrojo consultivo: el criterio de rating necesita dos consultas bloqueantes y sin él dos emparejadores se roban la pareja. Medido en 4 ms; techo de cientos de emparejamientos/segundo. | P3 |
| ~~**D-RAT-1**~~ | ~~La liquidación no está enganchada~~ → **RESUELTO** por el bloque 7.4.2. | — |
| **D-MM-2** *(nueva)* | El emparejador lo mueve el tráfico. Con **un solo** jugador en cola y nadie más sondeando, nada ocurre hasta que llegue el segundo — que es el comportamiento correcto, pero significa que **no hay barrido de fondo**: una cola sin tráfico no caduca sus entradas hasta la siguiente petición. Inocuo (la elegibilidad ya filtra por `expires_at`), pero deja filas `QUEUED` visualmente vencidas en la tabla. | P3 |
| **D-MM-3** *(nueva)* | Cancelar durante `PAIRING` responde `PAIRING` y obliga a volver a sondear. Ventana ≤20 s y en la práctica ~25 ms. Sin UI todavía no se nota; con UI conviene que el botón muestre «terminando de emparejar…». | P3 |
| ~~**D-PVP-9**~~ *(heredada)* | Sin límite de peticiones. Se hereda tal cual: este endpoint tampoco tiene rate limiting. — **RESUELTA en el BLOQUE 7.6**: `mm_status` 90/min y `mm_write` 20/min. El límite **no sustituye** al índice único parcial, que sigue siendo lo que impide dos entradas vivas. | ~~P2~~ |
| ~~**D-PVP-6**~~ | ~~Nadie marca `EXPIRED` en las partidas~~ → **RESUELTO** por el bloque 7.4.3. Una partida vencida deja de bloquear la cola: `enqueue` barre antes de comprobar la guarda. | — |
| ~~**D-PVP-8**~~ | ~~No hay UI de PvP~~ → **RESUELTO** por el bloque 7.5 (`/duelos/pvp`). Ver `PVP-ARENA.md`. | — |
| **D-PVP-5**, **D-PVP-3**, **R11** *(heredadas)* | Sin cambios. | P2 |

---

## 18. Lo que este bloque NO implementa

Arena PvP · lobby visual · animaciones · chat · emotes · WebSocket · Supabase Realtime · SSE ·
ranking · leaderboard · recompensas PvP · XP/créditos PvP · ganancias y pérdidas de MMR ·
temporadas · battle pass · logros · torneos · espectadores · Pick'ems · mercado ·
**y ningún cambio en el motor de combate ni en las reglas del juego**.

`src/matchmaking/`, `src/competitive/`, `src/online/` y `src/social/` siguen **congelados y sin
tocar**. `profiles.points` sigue siendo exclusivamente Pick'ems. No se ha creado ni un evento de
telemetría nuevo.
