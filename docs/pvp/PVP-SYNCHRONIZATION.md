# NEXUS — PvP Synchronization

> BLOQUE 7.3. Primera capa real de sincronización entre dos jugadores.
> **HTTP + polling. Sin WebSocket, sin Supabase Realtime, sin SSE.**
> 2026-09-07 · rama `arch/stabilization`

---

## 1. Arquitectura

```
   PLAYER A                    SERVIDOR                     PLAYER B
      │                           │                            │
      │  POST action ───────────▶ │                            │
      │                           │ guardAction()              │
      │                           │ orquestador                │
      │                           │ UPDATE … WHERE version=N   │
      │  ◀──────── PvpSyncResponse│ (estado nuevo, N+1)        │
      │           changed:true    │                            │
      │                           │ ◀──── GET ?since=N ────────│
      │                           │ ───── changed:true ───────▶│
      │                           │        (N+1, proyectado)   │
```

Cuatro capas, y cada una ignora a la de abajo:

| capa | fichero | responsabilidad |
|---|---|---|
| contrato | `domain/cardgame/pvp/sync.ts` | qué viaja por el cable. **Puro.** No sabe de HTTP. |
| servicio | `server/services/duelsPvp.ts` | `syncPvpMatch()` — lee, decide si cambió, proyecta |
| ruta | `app/api/game/duel/pvp/route.ts` | autentica, valida entradas, traduce a HTTP |
| transporte | `lib/duel/pvpTransport.ts` | **la frontera del cliente**: cómo se pide |
| bucle | `lib/duel/pvpPoller.ts` | cada cuánto, qué se admite, qué hacer si falla |
| React | `lib/duel/usePvpSync.ts` | 90 líneas de pegamento con el DOM |

---

## 2. Transporte actual

**HTTP + polling.** Es la decisión correcta para este juego: un duelo NEXUS es por turnos, con
diez turnos y sin nada que animar entre medias. Un socket abierto durante minutos para
transmitir dos docenas de transiciones es infraestructura que hay que mantener, reconectar y
escalar a cambio de una latencia que aquí no se nota.

### La ruta, y por qué no es la que pedía el encargo

El encargo sugería `GET /api/duels/pvp/[matchId]`. La auditoría previa encontró que en NEXUS
**no existe ni un solo segmento dinámico** en `src/app/api`: las 23 rutas son planas bajo
`/api/game/*`, y las que escriben usan un discriminador `action` en el cuerpo. Estrenar un
estilo de enrutado por una sola ruta habría sido peor que seguir la convención. Queda:

```
GET  /api/game/duel/pvp?matchId=<uuid>[&since=<n>]
POST /api/game/duel/pvp   { action: "play"|"abandon", … }
```

### La abstracción, y qué NO tiene

```ts
interface PvpSyncTransport {
  fetchSince(matchId, since, signal): Promise<PvpSyncResponse>;
  play(matchId, input, signal): Promise<PvpSyncResponse>;
  abandon(matchId, signal): Promise<PvpSyncResponse>;
}
```

**No hay `subscribe()`, y es una decisión, no un olvido.** Un `subscribe` que por dentro es un
`setInterval` no abstrae nada: quien sondea necesita decidir *cada cuánto*, y esa decisión
depende del estado de la partida y de si la pestaña se ve. Ese control vive en el poller,
donde se puede razonar sobre él y probarlo. La interfaz es pequeña y honesta sobre lo que hoy
existe.

---

## 3. Polling

### Ritmo

El criterio no es «la partida está viva», sino **«¿puede cambiar algo ahora mismo?»**:

| situación | intervalo | por qué |
|---|---|---|
| turno del **rival** | **1200 ms** | único momento en que el estado cambia sin que hagamos nada |
| turno **propio** | **2500 ms** | no cambiará nada hasta que actuemos, y al actuar recibimos el estado en la respuesta |
| pestaña **oculta** | **15 s** | nadie está mirando |
| **terminal** | *parado* | no habrá más cambios |
| **error no reintentable** | *parado* | un 401 o un 404 no se arreglan insistiendo |

Respeta las bandas del encargo (activo 1000-1500, no activo 2000-3000) y además define qué
significa «activo» en un juego por turnos.

### Un solo bucle

Como mucho **una petición en vuelo** y **un temporizador armado**. `start()` llamado tres veces
arranca un bucle. `syncNow()` durante una petición pendiente no lanza otra — eso cubre el doble
clic del refresco manual y la vuelta de la pestaña al primer plano. Al desmontar, `dispose()`
cancela el temporizador y aborta la petición en curso.

### Retry / backoff

1 s → 2 s → 4 s → 8 s → tope de 10 s. Al recuperar la conexión, el contador vuelve a cero y el
ritmo normal. **Un fallo de red no mata la partida**: mientras se reintenta, el último snapshot
sigue en pantalla y el estado es `STALE`, no `ERROR`.

Los errores no son todos iguales:

| código | trato |
|---|---|
| 401 `AUTH` | para el bucle. La sesión no se arregla insistiendo. |
| 404 `NOT_FOUND` | para el bucle. No existe, o no es tuya. |
| 409 `CONFLICT` | **no cuenta como caída.** Íbamos atrasados: se pide el estado completo en el siguiente ciclo. |
| 429 / 5xx / red | backoff y reintento. |
| abort | no es un error: la cancelamos nosotros. |

---

## 4. `state_version` y no reenviar lo que no cambió

`GET ?since=N`. Si `N` coincide con la versión actual, la respuesta es:

```json
{ "changed": false, "stateVersion": 7, "serverNow": 1757000000000, "terminal": false }
```

**Se eligió `?since=` en vez de ETag / 304.** Un ETag habría exigido pactar la semántica de
caché con Next y con cualquier proxy intermedio para un endpoint que ya va `no-store`, a cambio
de ahorrar los mismos bytes. El encargo pedía explícitamente no micro-optimizar: la regla que
importaba —no reenviar estado que no cambió— se cumple igual y con menos piezas.

**La optimización de verdad está en el servidor, no en el cable.** El sondeo sin cambios lee
siete columnas escalares y **no toca el `state` jsonb**, que es la partida entera con sus dos
mazos:

```sql
-- camino barato
select id, mode, user_id, player_b_id, state_version, closed_reason, status …
-- camino completo (solo si hay algo nuevo)
select …, state, …
```

### Regla de admisión en el cliente

Solo entra estado cuya versión sea **estrictamente mayor** que la conocida. Con eso, una
respuesta que llega tarde es inofensiva por construcción:

```
petición #10 ──────────────────────┐
petición #11 ─────┐                │
                  ▼                ▼
            versión 20        versión 19   ← descartada: 19 ≤ 20
```

No depende del orden de llegada, que no controlamos, sino del contenido. Además cada petición
lleva un número de generación: la respuesta de una generación anterior ni se mira.

---

## 5. `action_id` — idempotencia

Sin cambios respecto al Bloque 7.2: `primary key (match_id, action_id)`. Reenviar la misma
acción **no** produce una segunda transición. Verificado por HTTP: dos POST idénticos devuelven
la misma `stateVersion` (v1=4, v2=4).

---

## 6. Proyección privada

Cada `GET` pasa por `buildSnapshot()` → `projectMatchFor(match, side)`. **Nunca** se serializa
la fila. El objeto se construye campo a campo: lo que no está escrito en el contrato, no sale.

### Dos endurecimientos que encontró el barrido de este bloque

1. **`expectedPlayer` era un id de usuario.** El modelo lo devuelve como `uuid` del jugador que
   debe actuar. Publicarlo habría entregado al rival un identificador interno de otra persona a
   cambio de nada. En el contrato viaja como `expectedSide` (`"A"`/`"B"`) más `isYourTurn`.
2. **El `deckId` y el `deckName` del rival viajaban.** No eran explotables —`duel_decks` deniega
   la lectura ajena por RLS— pero tampoco hacían falta. Se vacían en `redactSnapshot`.

### Barrido del JSON real (no lista negra: se recorren TODAS las cadenas)

| se buscó | resultado |
|---|---|
| cartas ocultas del rival | **0** |
| id de usuario del rival | ausente |
| id de usuario propio | ausente (no hace falta) |
| emails | ausentes |
| id del mazo del rival | ausente |
| tokens / cookies | ausentes |
| `rng`, `seed`, `closed_by`, `user_id`, `player_b_id`, `expectedPlayer` | ausentes |

---

## 7. Autorización

La identidad sale **siempre** de `getSession(req)`, es decir del Bearer. No se lee ningún
`userId`, `playerId` ni `side` del cuerpo ni de la query.

| quién | resultado |
|---|---|
| sin token | **401** |
| jugador A | 200 |
| jugador B | 200 |
| tercero autenticado | **404** |
| partida inexistente | **404** |

**404 y no 403 para el tercero**, deliberadamente: un 403 confirmaría que ese id existe, que es
justo el oráculo de enumeración que el encargo pedía evitar. Un ajeno y una partida inventada
son indistinguibles desde fuera.

---

## 8. Ciclo de vida y estados terminales

El poller para en `FINISHED`, `ABANDONED` y `EXPIRED`. El endpoint **sigue devolviendo** el
resultado final —la partida no se borra— y el cliente conserva el último snapshot para poder
mostrarlo. Un `syncNow()` sobre una partida terminal no revive el bucle.

### Estado de RED, separado del estado de JUEGO

`SyncStatus` (`IDLE` · `SYNCING` · `SYNCED` · `STALE` · `ERROR` · `TERMINAL`) **no se mezcla**
con `MatchStatus` ni con `TurnPhase`. Que la red vaya mal no cambia de quién es el turno, y que
sea tu turno no dice nada de la red. Son dos ejes y se cruzan.

Etiquetas para pantalla (`syncLabel`): *Conectando… · Sincronizando… · Tu turno · Turno rival ·
Reconectando… · Partida terminada · No se pudo sincronizar*.

---

## 9. Reloj

`serverNow` viaja en **todas** las respuestas, también en las que no traen cambios. El cliente
estima `offset = serverNow - clientNow` y pinta la cuenta atrás con
`turnDeadlineAt - (clientNow + offset)`.

**Es solo presentación.** Que la cuenta llegue a cero no vence el turno ni cambia el estado:
hay un test que lo comprueba explícitamente. Quién decide la expiración es el servidor, y ese
barrido **ya existe** desde el bloque 7.4.3 (D-PVP-6 resuelta), y su disparador principal es
precisamente este sondeo: cuando el rival pregunta por el estado, el servidor comprueba el plazo y
cierra la partida si venció. Ver `PVP-TIMEOUT.md`.

---

## 10. Rendimiento (medido, no estimado)

Contra el servidor real, partida de 10 cartas por bando:

| escenario | tamaño | latencia |
|---|---|---|
| sondeo completo (primera lectura) | **4034 B** | 40 ms |
| sondeo **sin cambios** | **76 B** | **32 ms** de media (10 muestras) |
| ahorro | **53× menos bytes** | |

Con el ritmo de 1200 ms en el turno del rival, un sondeo sin cambios cuesta ~63 B/s por jugador
en espera. El caso común —que es esperar— es el barato, que era el objetivo.

No se han hecho más optimizaciones porque no hay medida que las justifique.

---

## 11. Dos clientes reales — la prueba obligatoria

`npm run pvp-sync:verify`, con dos cuentas y dos Bearer de verdad contra el endpoint HTTP:

```
A y B leen           → misma state_version (0)
jugador en turno actúa → recibe v=1 EN LA RESPUESTA (no espera al sondeo)
el rival sondea desde 0 → changed:true, v=1          ✔ A → servidor → B
el rival actúa          → v=2
el primero sondea desde 1 → changed:true, v=2        ✔ B → servidor → A
tras jugar: A ve del mazo de B exactamente 1 carta = las jugadas
```

Y en concurrencia: dos acciones sobre la misma versión, **una gana y la otra recibe 409
`STALE_VERSION`**; la misma `action_id` dos veces devuelve la misma versión.

---

## 12. Migración futura a Supabase Realtime

Lo que habría que tocar, y lo que no:

**No cambia nada de:** el modelo (`duel_matches`, `duel_match_actions`), la proyección, el
contrato `PvpSyncResponse`, `state_version`, `action_id`, la autorización ni las reglas del
motor.

**Cambiaría:** se añade `subscribe(matchId, cb)` a `PvpSyncTransport`, se escribe un
`RealtimeTransport` que escuche `postgres_changes` sobre `duel_matches`, y el poller pasa a ser
el camino de respaldo para cuando el socket se caiga.

**Y hay un problema que resolver antes, no después:** hoy `duel_matches` **deniega toda lectura**
a `authenticated` (RLS sin políticas). Realtime entrega cambios respetando RLS, así que abrir el
canal exige abrir la lectura de la fila — y la fila **contiene los dos mazos**. Habría que
publicar solo columnas no secretas, o notificar por una tabla-señal (`match_id` + `state_version`)
y seguir pidiendo el estado proyectado por HTTP. Esa segunda vía conserva la frontera del secreto
intacta y es la que recomienda este documento.

---

## 13. Deudas

| id | deuda | prioridad |
|---|---|---|
| ~~**D-PVP-6**~~ | ~~Nadie marca `EXPIRED`~~ → **RESUELTO** por el bloque 7.4.3: `syncPvpMatch` es, de hecho, el disparador principal del barrido — el sondeo del rival cierra la partida. Ver `PVP-TIMEOUT.md`. | — |
| **D-PVP-7** *(heredada)* | El abandono no acredita al rival. Las recompensas PvP son de otro bloque. | P1 |
| ~~**D-PVP-8**~~ | ~~`usePvpSync` no está montado en ninguna pantalla~~ → **RESUELTO** por el bloque 7.5: lo monta `/duelos/pvp`. Y montarlo destapó un fallo real en el propio hook —`subscribe` con `[]` no se suscribía si `matchId` empezaba en `null`—, corregido allí. Ver `PVP-ARENA.md` §8. | — |
| ~~**D-PVP-9**~~ *(nueva)* | Sin límite de peticiones en el endpoint. Un cliente puede sondear tan rápido como quiera; el ritmo lo pone el cliente por buena fe. Falta rate limiting server-side. — **RESUELTA en el BLOQUE 7.6**: `pvp_sync` 150/min y `pvp_action` 40/min, contados en PostgreSQL contra el `user_id` del Bearer. Ver `PVP-RATE-LIMIT.md`. | ~~P2~~ |
| **D-PVP-5** *(heredada)* | `UPDATE` y registro de acción no son atómicos. Nunca aplica dos veces. | P2 |
| **D-PVP-3** *(heredada)* | `difficulty` sigue `NOT NULL` con CHECK de bot. | P2 |
| **R11** *(heredada)* | `toPublicView` de PvE cableado a `snapshotA`. PvP no lo usa. | P2 |

---

## 14. Lo que este bloque NO implementa

Matchmaking · lobby · WebSocket · Supabase Realtime · SSE · reconexión completa · MMR ·
recompensas PvP · economía · eventos de telemetría · barrido de `EXPIRED` · pantalla de PvP ·
rate limiting.

`src/matchmaking/` y `src/competitive/` siguen congelados y sin tocar. `profiles.points` sigue
siendo exclusivamente Pick'ems.
