# F76 — Ranked Queue Hardening (MATCHED muerto / cola colgada)

**Fecha:** 2026-10-01 · **Veredicto:** GO (AY) · **Build en producción:** `drl-0.1.1-1-99bda6f0` (VPS)
Evidencia: `docs/product/qa/f76-ranked/` · Test de regresión: `src/server/services/f76.rankedQueue.service.test.ts`
Instrumentos (fuera de CI): `scripts/_f76-lib.ts`, `_f76-repro.ts`, `_f76-live.ts`, `_f76-ui.ts`, `_f76-decks.ts`.

## A. Bug reproducido (en producción, ANTES del arreglo, cuentas QA)
- **API** (`repro-api-prod-before.json`): QA C (`d4133641`, entrada `48b9adff` MATCHED → partida `3aab86d7` COMPLETED)
  y QA G (`00eb4ea1`, MATCHED → `d9ae6004` IN_PROGRESS/ABANDONED). `GET /api/game/duel/matchmaking` respondía
  `200 {code:"OK", entry.state:"MATCHED", matchId:<partida terminal>}`. Las filas de BD no cambian con la lectura.
- **Navegador, entrada directa** (`repro-ui-C-prod-direct-*.json`): QA C abre `/duelos/pvp` (menú, F5, volver atrás) y
  la pantalla muestra «VICTORIA 6–5» de una partida **de hace 3 días** como si fuera la actual, durante 37 s y sin
  salida: sondea esa partida muerta, el sondeo de cola se para, y `cancel` responde `NOT_QUEUED` devolviendo otra vez
  el MATCHED.
- **Navegador, JUGAR con `?buscar=`** (`repro-ui-G-prod-*.json`): la página consulta primero la partida muerta y el
  arreglo de F66 la reencola. Ese camino concreto funcionaba, salvo por la carrera de B2.

## B. Causa raíz
1. **Servidor.** `duel_pvp_status` / `duel_pvp_cancel` (0032/0033) devuelven, por diseño, la **última entrada conocida**
   cuando no hay búsqueda viva. MATCHED es un estado terminal de la cola: la entrada se queda así para siempre como
   historia. `duelsMatchmaking.status/cancel` la reenviaban tal cual, de modo que el servidor presentaba una partida
   terminada como «tu partida» y el cliente (`usePvpQueue.aplicar`) pasaba a `phase:"matched"`, sondeando esa
   partida y parando el sondeo de cola.
2. **Cliente (la QUEUED colgada).** `usePvpQueue` no ordenaba las respuestas. Si un sondeo salía *antes* del
   `enqueue` y volvía *después* con el MATCHED viejo, pisaba la entrada QUEUED recién creada y paraba el sondeo. La
   búsqueda quedaba viva en el servidor sin que nadie la viera ni la moviera (el emparejador solo se mueve con
   tráfico). Hasta que vencía su TTL, podía emparejar con un jugador ausente.

## C. Flujo anterior
JUGAR → `/duelos/pvp?buscar=` → `GET matchmaking` → `status` (viva o, si no, **última**) → MATCHED viejo →
`phase:"matched"` → la página sincroniza la partida muerta → (con `?buscar`) consulta su ciclo de vida y reencola /
(sin `?buscar`) **se queda en el resultado viejo**. `cancel` → `NOT_QUEUED` + MATCHED viejo. Sondeo tardío → pisa
la QUEUED nueva.

## D. Arreglo (autoridad en servidor, sin migración)
- **Una definición canónica de «viva»:** `lifecycleFromStatus(status, closed_reason)` en
  `domain/cardgame/pvp/lifecycle.ts`. `pvpLifecycle` delega en ella (mismo comportamiento) y equivale exactamente a la
  guarda SQL `_duel_pvp_has_active_match` (0048). El test F76·8 recorre las 15 combinaciones y comprueba el texto SQL.
- **`matchedEntryVerdict`** (`domain/cardgame/matchmaking/resume.ts`, puro): una entrada MATCHED es LIVE solo si la
  partida existe, es la misma `id`, es `PVP`, el usuario juega en ella y no es terminal. En cualquier otro caso es STALE.
- **`settle()`** en `duelsMatchmaking.ts` se aplica a `status` (las dos lecturas), al `after` del `enqueue` y a
  `cancel`. Si la entrada es STALE, se responde «sin búsqueda» (`IDLE` / `NOT_QUEUED`, `entry:null`) y el `matchId`
  terminal no viaja. La fila MATCHED **no se reescribe**: es la historia verdadera de esa búsqueda. Si la lectura de
  la partida falla, se propaga el error (503/500 y el cliente reintenta); no se adivina.
- **Idempotencia de JUGAR con partida viva:** el 409 `ACTIVE_MATCH` (contrato de `pvp-matchmaking-verify` y F66) ahora
  **adjunta la vista** con la entrada MATCHED viva. El cliente la **retoma** en vez de mostrar un error. Un duelo
  privado activo sigue dando 409 sin entrada.
- **Cliente:** `usePvpQueue` lleva una época de escritura (`enqueue`/`cancel` la incrementan y el sondeo con época
  vieja se descarta). `autoSearch.ts` y la página usan `isTerminal` canónico (antes, listas locales). Al terminar una
  partida que llegó por la cola, la URL pasa a `?match=<id>`, el mismo camino que el historial, para que **F5 en el
  resultado** lo siga mostrando sin que la cola lo presente como actual.

## E. Ficheros cambiados
Modificados (todos estaban ya sin seguimiento en git; se guardó copia previa y el parche fue quirúrgico):

| Fichero | Líneas |
|---|---|
| `src/domain/cardgame/pvp/lifecycle.ts` | +16 −2 |
| `src/domain/cardgame/pvp/index.ts` | +1 −1 |
| `src/domain/cardgame/matchmaking/index.ts` | +1 |
| `src/server/services/duelsMatchmaking.ts` | +42 −7 |
| `src/app/api/game/duel/matchmaking/route.ts` | +2 −1 |
| `src/lib/duel/usePvpQueue.ts` | +17 −1 |
| `src/lib/duel/autoSearch.ts` | +8 −1 |
| `src/app/duelos/pvp/page.tsx` | +18 −4 |
| `src/components/duel/gameplay.contract.test.ts` | +2 −1 (pin B3: `TERMINALES` → `isTerminal` canónico) |

Nuevos:
- `src/domain/cardgame/matchmaking/resume.ts`
- `src/server/services/f76.rankedQueue.service.test.ts`
- los instrumentos `scripts/_f76-*`
- este informe

Fuera de producto: arreglado un `import()` relativo de mi instrumento `scripts/_f75-smoke-public.ts` (rompía
`tsc` de scripts).

## F–G. BD y migración
Sin cambios de esquema, RLS, funciones ni datos. **No hizo falta 0061:** la invariante «como mucho una búsqueda viva
por usuario» ya la impone el índice único parcial `duel_pvp_queue_active_uniq`. La caducidad de QUEUED ya existe (TTL
`expires_at` de 600 s + `_duel_pvp_sweep`). La de PAIRING es el arrendamiento de 20 s. El doble emparejamiento lo
impide `for update skip locked`. Lo que faltaba era la proyección de lectura, que vive en TS. Cabeza: **0060**.

## H. Estados terminales de partida (reales)
`duel_matches.status` ∈ {WAITING, IN_PROGRESS, COMPLETED, DRAW, UNRESOLVED} + `closed_reason` ∈ {ABANDONED, EXPIRED}.
Ciclo de vida efectivo: el cierre gana. Terminales: **FINISHED** (COMPLETED, DRAW o UNRESOLVED), **ABANDONED** y
**EXPIRED**; en los dos últimos `status` sigue en IN_PROGRESS. Vivas: CREATED (WAITING) e IN_TURN (IN_PROGRESS sin
cierre). Producción hoy: PVP COMPLETED, IN_PROGRESS+ABANDONED e IN_PROGRESS+EXPIRED.

## I. Estados de cola
QUEUED (vivo), PAIRING (vivo, arrendamiento de 20 s), MATCHED, CANCELLED y EXPIRED (los tres terminales; una entrada
no se reutiliza).

## J. MATCHED muerto
Corregido: nunca se presenta. Probado con entradas construidas de verdad (abandono, COMPLETED, EXPIRED, inexistente y
asociación ajena). La partida muerta sigue legible como RESULTADO por `?match=` (historial) y un cliente manipulado no
puede jugarla (`409 MATCH_CLOSED`).

## K. QUEUED colgada
- La semántica de servidor era correcta (TTL + barrido; enqueue repetido = la misma búsqueda; cancelable) y se respeta.
- La causa de las QUEUED colgadas era la carrera de B2, corregida con la época del cliente.
- Una QUEUED **sin latido** puede seguir viva hasta 600 s si el jugador cierra la pestaña: es el diseño actual (no
  existe latido). Introducirlo sería una regla persistente nueva y queda como deuda (AX), sin tocar.

## L. Reconexión a partida activa
F5 ×3 → la misma partida (API). En navegador, F5 durante la partida → misma partida, sin cola nueva, y la otra sesión
también reconecta. JUGAR otra vez → 409 con esa partida, que se retoma.

## M–O. Finalizaciones y cancelación
- **Normal / abandono:** tras abandono (IN_PROGRESS+ABANDONED), COMPLETED o EXPIRED (vía `closed_reason`) la cola queda
  coherente: IDLE y una nueva alta funciona.
- **Victoria, derrota y empate:** comparten la vía COMPLETED/DRAW (FINISHED).
- **Cancel:** `NOT_QUEUED` sin devolver la partida muerta; 10× cancel = una cancelación.

## P–S. Doble clic, varias sesiones y concurrencia
| Prueba | Resultado |
|---|---|
| Doble clic en JUGAR (navegador) | 1 búsqueda |
| Dos sesiones de la misma cuenta (1440 + 390) a la vez | 1 búsqueda, las dos pantallas la ven |
| Cancelar desde otra sesión | la pantalla deja de buscar sola, sin error |
| 10× JUGAR simultáneo (API real) | 1 `OK` + 9 `ALREADY_QUEUED`, 1 fila viva, misma `entryId` |
| 10× cancelar | 1 `OK` + 9 `NOT_QUEUED`, 0 vivas |
| JUGAR después | funciona |

## T–V. Carreras
- **Fin/JUGAR a la vez:** I recibe una cola nueva (o el 409 con la viva) y después nunca la terminada.
- **Cancel contra emparejador:** o cancela o empareja, nunca las dos. En vivo ganó la cancelación; el test de servicio
  cubre el orden que toque y exige «OK ⇔ CANCELLED».
- **Reconexión mientras termina:** devuelve la viva de ese instante o nada, y luego IDLE.

## W. Rematch entre dos usuarios
H+I emparejan → abandonan → vuelven → cola **nueva** y partida **nueva** (`m2 ≠ m1`). En navegador, «Buscar otro
rival» → búsqueda nueva.

## X. Seguridad entre usuarios
- Partida ajena: 404 al leer y 404 al abandonar.
- Equipo ajeno: `DECK_NOT_OWNED`.
- Los campos inyectados (`userId`, `matchId`, `state`, `rating`) se ignoran.
- El cancel de C solo toca SU entrada.
- `duel_pvp_queue` por REST con sesión → 403.
- Las RPC de cola solo son ejecutables con `service_role`.
- Una fila MATCHED que apunte a una partida donde el usuario no juega → STALE (test F76·7).

## Y. Auditoría de datos en producción
- **Antes:** 5 usuarios cuya última entrada era MATCHED → partida terminal, **todos QA** (`@example.invalid`).
  0 MATCHED sin partida, 0 QUEUED vencidas sin barrer, 0 duplicados vivos.
- **Después:** 4 QA con fila MATCHED histórica (inerte: la API responde IDLE), **0 usuarios reales**, 0 vivas,
  0 duplicados, 0 partidas PvP activas.
- **Saneamiento:** no hace falta borrar ni reescribir nada. Las filas son historia verdadera y el servidor ya no las
  presenta.

## Z. Limpieza QA
Todo lo creado se cerró con los mecanismos normales (cancelar / abandonar). Cola global = 0 al terminar. Las QA H, I,
D, F y C jugaron/abandonaron partidas ranked reales (su rating QA cambió). La cuenta del usuario y la del socio no se
tocaron.

## AA–AC. F72.8, autoplay y motor
- **Plazo:** 30 s de servidor (`turnDeadlineAt − turnStartedAt` ≈ 30 000 ms).
- **Al vencer:** el servidor juega solo (la versión pasa de 0 a 1), la partida SIGUE (IN_TURN) y `closed_reason` queda
  nulo.
- **Tests:** `turnClock.service.test` y `duel.test` en verde.
- **Motor:** intacto (`domain/cardgame/match` y `combat` sin cambios; `lifecycle.ts` es la capa de sesión PvP).

## AD. Economía
Sin cambios (ningún fichero de economía, crafting, misiones, sobres, cartas ni agentes).

## AE–AH. Gates
| Gate | Resultado |
|---|---|
| Suite completa | **5638/5638** |
| Tests F76 | 9/9 con el arreglo; **5/9 fallan contra el servicio anterior** (1, 2, 3, 6, 7) |
| Relacionados | 439/439 |
| Tipos web | 0 errores |
| Tipos scripts | 0 errores |
| Lint | 0 errores (27 avisos, ninguno en ficheros F76) |

## AI–AK. Gates contra producción
| Gate | Resultado |
|---|---|
| Smoke (camino público) | **74/74** |
| Browser gate público | **29/29** |
| E2E de cola en vivo | **29/29** (también en la instancia previa al despliegue) |
| E2E de navegador F76 | **17/17** (también en la instancia previa) |
| `production:check --app --vps` | 24 PASS · 1 WARN · 1 FAIL |

El WARN es `auth-email` (SMTP) y el FAIL `backup-offsite`: los dos son bloqueos externos conocidos desde F67/PRE-F70.

## AL–AM. Build y despliegue
- Huella local = VPS = **`drl-0.1.1-1-99bda6f0`**.
- Desplegado **solo** con el flujo F75: tar del working tree → `incoming/` → `bin/deploy.sh`, que compiló en un
  contenedor desechable, verificó que el BUILD_ID coincide y recreó solo `valorosters-app` en unos 3 min.
- Rollback disponible: `bin/deploy.sh --activate drl-0.1.1-1-08943cb7`.
- La QA previa se hizo con una instancia local `:3006` y un túnel SSH temporal a la BD, ambos cerrados antes de los
  gates. No sirvieron tráfico público.

## AN–AU. Producción después del despliegue
| Comprobación | Resultado |
|---|---|
| Dominio | https://valorosters.com 200 (`/`, `/competitivo`, `/duelos/pvp`) |
| Health | 200 |
| Ready | ready, con cabeza **0060_salvage_last_copy_atomic** |
| Login y F5 | OK (browser gate) |
| Ranked | OK (E2E en vivo y navegador) |
| Assets | 0 rotos |
| Catálogo | 331 cartas · 29 agentes |
| Marketplace / Payments | OFF / OFF |
| Admins | 1 |
| RLS | completa |

## AV. Dependencia del PC
Ninguna. Cloudflare muestra un único conector (origen 212.95.40.144, linux_amd64). En el PC no hay nada escuchando
(3005/3006/54521/54522), no hay túneles y las tareas DRLCards siguen deshabilitadas.

## AW. Commit / push
Ninguno.

## AX. Deuda restante
1. **QUEUED sin latido:** quien cierra la pestaña sigue en cola hasta 600 s y puede emparejar ausente (F72.8 jugará por
   él). Arreglarlo exige una regla persistente nueva (latido o arrendamiento por sondeo): **STOP** de diseño; no se tocó.
2. `duel_pvp_status` (SQL) sigue devolviendo la última entrada. La proyección está en el único camino de servidor (las
   RPC son solo `service_role`). Si algún día se expusiera la RPC a clientes, habría que mover la regla a SQL (migración).
3. Carrera cancel-vs-emparejador en vivo: solo se observó el orden «gana la cancelación». El otro está cubierto por el
   test de servicio, pero no se forzó en producción.
4. Quedan 4 filas MATCHED históricas de QA (inertes).
5. Fuera de F76, sin tocar: SMTP, recuperación de contraseña, copia fuera del VPS, licencias, reboot completo del VPS,
   consumo de créditos del browser gate.

## AY. F76 GO / NO-GO
**GO.**
- Causa raíz identificada y reproducida en producción.
- El servidor ya no presenta nunca una partida terminal como activa.
- Las partidas activas se siguen recuperando.
- Las carreras y la concurrencia son seguras.
- Sin migración, gates verdes salvo los bloqueos externos documentados.
- Producción en el VPS con el PC fuera del camino.
