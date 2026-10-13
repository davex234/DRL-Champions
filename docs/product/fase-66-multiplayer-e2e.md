# FASE 66 · MULTIPLAYER E2E 5.0 — Network resilience / Concurrency / Server authority

**Veredicto: GO.**

Dos clientes reales (dos Chrome, dos sesiones) juegan RANKED por la interfaz: cola → emparejamiento → 10 turnos → resultado. Terminan con el mismo estado autoritativo en todas las comprobaciones:
- 5 partidas consecutivas con «Buscar otro rival».
- 1 partida caos, que incluye:
  - latencia de 0 a 1.500 ms;
  - doble clic;
  - F5 en la cola, a mitad de partida, con la acción en vuelo y en el resultado;
  - 20 s sin red;
  - pestaña vieja.

Números de la fase:
- **Soak:** 100 partidas PvP reales con 644 eventos de caos, 100/100 invariantes.
- **Bugs:** 12 arreglados, cada uno con su test (rojo antes de arreglar).
- **Esquema:** 0 migraciones, BD de producción sin cambios.
- **Balance:** 0 cambios de balance, reglas, motor, economía, cartas o agentes.
- **Evidencia:** `docs/product/qa/fase66-multiplayer/`.

## 1–8 · Línea base y arquitectura REAL

1. **Línea base** (`baseline.json`):
   - Tests: 5.298.
   - Catálogo: 331 cartas y 29 agentes.
   - Migraciones: cabeza `0057`.
   - Flags: mercado OFF, pagos OFF.
   - Runtime: :3005 con 200 y el túnel abierto.
   - Árbol de trabajo muy sucio: cada fichero se leyó y se parcheó quirúrgicamente.
2. **Arquitectura:**
   - Transporte: HTTP + sondeo. No hay WebSocket, Realtime ni SSE (0 `.channel(` en `src`).
   - Estado: `duel_matches.state` (jsonb) + `state_version` (0031) + libro `duel_match_actions` (PK `match_id, action_id`).
   - Cola: `duel_pvp_queue` + RPC 0032/0033 (índice único parcial, `for update skip locked`, advisory lock, arrendamiento, barrido oportunista).
   - Rating: `duel_pvp_settle_match`, una vez por partida gracias al índice único.
   - PvE: `playTurn`, con el bot en servidor.
3. **Máquina de estados** (`state-machine.json`), con los nombres reales:
   - Cola: sin entrada → `QUEUED` → `PAIRING` → `MATCHED`, o bien `CANCELLED`/`EXPIRED`.
   - Partida: `CREATED` → `IN_TURN` → `FINISHED` | `ABANDONED` | `EXPIRED`.
   - Turno: `ATTACKER_CARD` → `ATTACKER_STAT` → `DEFENDER_CARD` → `DEFENDER_STAT` → `READY_TO_CONFIRM`.
   - Todas las transiciones las decide el servidor con `UPDATE` condicionados. El cliente no puede saltar a `FINISHED`.
4. **Cola:**
   - La cola vive en Postgres; el emparejador lo mueve el propio tráfico (sin cron).
   - «Ya en partida» → 409 `ACTIVE_MATCH`.
5. **Creación de partida:**
   - `claim_pair` reserva los dos jugadores y el `match_id`.
   - `createPvpMatch` inserta con ESE id.
   - `commit_pair` confirma; si falla, `release_pair`, o el barrido al vencer el arrendamiento.
   - Nunca queda un jugador MATCHED sin partida ni dos partidas para una pareja.
6. **Snapshot del equipo:**
   - Al empezar, el mazo se revalida contra `user_cards` (paginado desde F65) y se congela con checksum en `state`.
   - Editar el equipo después no toca la partida.
   - Las cartas van congeladas: identidades, trío y OVR. La partida es reproducible aunque cambie el CMS.
7. **Concurrencia de turno:**
   - PvP: `UPDATE … WHERE state_version = esperada AND closed_reason IS NULL`.
   - PvE (F66): el mismo mecanismo sobre la misma columna, sin migración.
8. **Idempotencia** (`idempotency.json`):
   - PvP: `actionId` por gesto + PK del libro.
   - PvE: versión + carta de un solo uso (un reintento de una jugada ya aplicada nunca se aplica dos veces).
   - Cola: índice único por usuario.
   - Rating: índice único.
   - Recompensa: ref `duel:<id>` + cupo atómico.
   - No se añadieron claves decorativas.

## 9–19 · Carreras, reintentos y resincronización

9. **Reproducción de la carrera PvE de F65** (`pve-race-BEFORE.txt`):
   - Dos `play` simultáneos del mismo turno → **los dos 200**, y el segundo pisaba al primero.
   - Diez simultáneos → varios 200.
   - Abandonar una partida TERMINADA la borraba (se perdía la repetición).
10. **Arreglo PvE:**
    - `persist()` exige y sube `state_version`; el perdedor recibe **409 `STALE_STATE` con la vista real**.
    - Abandonar solo borra partidas `IN_PROGRESS`; una terminada responde 409 `MATCH_FINISHED`.
    - En la BD real: 10 jugadas concurrentes → **1×200 + 9×409 con vista**, historial +1.
11. **PvP, mismo turno** (BD real):
    - 10 jugadas concurrentes → **1×200 + 9×409, todas con estado**; la versión avanza +1.
    - Test unitario equivalente, y 290 duplicados en el soak.
12. **Cola duplicada:** 10 JOIN simultáneos → 10×200, **1 sola entrada** (`ALREADY_QUEUED`/`OK`).
13. **Dos pestañas:**
    - La segunda sesión recibe la misma entrada.
    - 9 s sondeando las dos: nunca `MATCHED` consigo mismo.
14. **Autopartida:** imposible por tres redes independientes:
    - el índice único por usuario;
    - `SAME_PLAYER` en `createPvpMatch`;
    - el CHECK `duel_matches_mode_shape`.
    Nunca se observó en la prueba de dos pestañas ni en el soak.
15. **Doble partida:**
    - Tres usuarios a la vez → 1 partida para 2; el tercero sigue en `QUEUED`.
    - Encolarse con una partida viva → 409 `ACTIVE_MATCH`, también con una privada viva (soak).
16. **Cliente viejo:**
    - Otra sesión con la versión anterior → **409 con `sync`** en la versión actual.
    - El poller lo adopta al momento (F66). Antes esperaba al siguiente sondeo.
17. **Reintento tras respuesta perdida:**
    - PvP: la misma `actionId` ×5 concurrente → 1 transición; el reintento tardío → **200 idempotente**. F66: antes, un reintento que coincidía con el original recibía 409.
    - PvE: se abortó el fetch y se leyó el estado. Como mucho una vez.
18. **Fuera de orden:** la acción con versión futura → 409; después, la actual → 200.
19. **Resync del cliente:**
    - El 409 trae el estado, en PvP y en PvE.
    - Un 4xx de jugada rechazada ya no se muestra como «Reconectando» (antes era `SERVER` reintentable); resincroniza.
    - PvE, ante un fallo de red, relee la partida antes de decir nada.
    - Copia: «Reconectando… sincronizando partida con el servidor».

## 20–36 · Latencia, recargas, desconexión y abandono

20. **Latencia** (0 / 100 / 300 / 800 / 1.500 ms, CDP en el cliente A, `latency.json`):
    - Botón bloqueado al instante en «Resolviendo…».
    - Ningún ganador optimista.
    - 10/10 turnos correctos.
21. **F5 en la cola:** la misma entrada; no se crea ticket nuevo.
22. **F5 en partida** (turno 3, cliente B): vuelve a la arena en el turno correcto.
23. **F5 con la acción pendiente:** aplicada como mucho una vez (versión antes = después = 9; se repitió y contó una vez).
24. **F5 en el resultado:**
    - Se ve el resultado y el rating no se mueve.
    - **Bug F66 arreglado:** `?buscar=` nunca se limpiaba y esta recarga volvía a encolar al jugador.
25. **Desconexión** (`disconnect.json`):
    - No hay presencia. «Desconectado» significa dejar de sondear o de actuar.
    - Lo único que corre es el reloj del turno (90 s, en Postgres).
    - Cerrar la pestaña no depende de `beforeunload` (no existe).
26. **Desconexión temporal:**
    - A pasó 20 s offline mientras B jugaba.
    - A mostró «Reconectando… sincronizando partida».
27. **Reconexión:** recuperado; la partida siguió hasta el final con el mismo estado en los dos clientes.
28. **Los dos se desconectan:** el turno vence en el siguiente contacto de cualquiera de los dos, en el alta en cola o en el barrido oportunista. Antes de eso la partida no bloquea a nadie más.
29. **Limpieza de colgadas:**
    - Existe y basta: `expireTurnIfDue` + `sweepExpiredPvpTurns`, sin cron nuevo.
    - Nuevo chequeo **Multijugador** en `/admin/system`: colgadas, doble asignación, autopartida, cola huérfana, emparejamiento atascado.
30. **Abandono:**
    - PvP: derrota; ranked mueve el rating una vez; privado sin rating; la fila se conserva.
    - PvE: sin pago.
    - 10 abandonos concurrentes → 1 cierre.
    - Abandonar una partida terminada → 409 (×10 en la BD real).
31. **Jugar contra abandonar:** siempre gana uno de los dos.
    - Unit ×8.
    - Soak ×5 en la BD real (`[200, 409]` o `[409, 200]`).
    - PvE ×6 sin cobro a medias.
32. **Finalizar contra abandonar:** tras terminar, 10 abandonos → 10×409; el resultado y el rating no cambian.
33. **Logout / caducidad** (`session.json`):
    - Un token de sesión cerrada → 401 en todo; el otro dispositivo sigue.
    - Volver a entrar recupera la partida.
    - Cada petición pide el token vigente (autorefresco).
34. **Dos dispositivos:** los dos ven el estado autoritativo. Si uno actúa, el otro recibe 409 + estado. No hay doble acción.
35. **Privacidad:** 0 cartas no jugadas del rival, 0 correos y 0 ids del rival en el cable.
36. **Información oculta:** la mano rival está vacía en el sondeo y en el cuerpo del 409 (unit + BD real).

## 37–44 · Seguridad y exactamente-una-vez

37. **IDOR:** un tercero recibe 404 al leer, pedir el resultado, jugar, abandonar o pedir la repetición. Sin sesión → 401.
    - **Bug F66 arreglado:** el cuerpo del 404 delataba la existencia (`NOT_A_PLAYER` frente a nada). Ahora es idéntico byte a byte para una partida ajena y para una inventada.
38. **Manipulación del cliente:**
    - winner / score / reward / ratingDelta / OVR / combat / turn / opponent / playerId / side en el cuerpo → ignorados (versión +1, sin resultado).
    - Versión futura → 409.
    - Carta del rival → 409.
    - Eje falso → 400.
    - Turno ajeno → 409.
39. **Autoridad del resultado:** lo calcula el motor desde los turnos; el cliente no envía marcador.
40. **Recálculo desde el historial:** coincide en **100%**.
    - API: 1/1.
    - E2E: 5/5 (+1).
    - Soak: 100/100.
41. **Resultado exactamente una vez:**
    - 10 lecturas de `outcome` idénticas.
    - 10 abandonos tras el final → 409.
    - Soak: versiones monótonas en 100/100.
42. **Elo exactamente una vez:**
    - API: −18/+18, suma cero, `games` +1.
    - E2E: 5/5 `once=true`.
    - La recarga del resultado no lo mueve.
    - El soak privado deja los ratings intactos.
43. **Recompensa exactamente una vez:**
    - PvE: Δ créditos = +120 = premio, pese a 5 lecturas, 5 jugadas y 3 abandonos tras terminar.
    - PvP: no paga créditos ni XP (código comprobado).
    - Soak: créditos intactos.
44. **Progreso exactamente una vez:**
    - El progreso de PvE cuelga del mismo pago idempotente (`duel:<id>`).
    - El competitivo cuelga de `duel_pvp_rating_events` (índice único).

## 45–60 · E2E, soak, red y suites

45. **E2E de dos clientes** (`e2e-two-clients.json`): A en Chrome a 1.440 px, B en Chrome a 390 px con movimiento reducido. Todo por la interfaz.
46. **Ranked:** 5/5 partidas de 10 turnos, hechos públicos iguales en A y B tras cada turno, Elo una vez, recálculo correcto.
47. **Casual:** es el duelo privado entre amigos (`PVP_PRIVATE`). 100 partidas en el soak, más la doble aceptación simultánea (1 partida).
48. **PvE E2E** (BD real): partida completa, carrera arreglada, respuesta perdida, F5 y pago una vez.
49. **Partida caos:** cola F5, F5 en el turno 3, F5 con la acción en vuelo, 20 s offline, pestaña vieja, latencias 0–1.500 ms y doble clic.
    - Resultado: 10 turnos, estado consistente, Elo una vez, recálculo correcto.
    - Verificada también en la build final (`e2e-final-check.json`).
50. **Soak de 100 partidas** (`soak.json`):
    - Real, contra Postgres, con 2 parejas QA en paralelo, en 19 min.
    - Duelos privados: no conceden rating ni recompensa (dos redes).
    - Caos: 290 duplicados, 217 reintentos con la misma id, 128 versiones viejas, 4 abandonos y 5 carreras jugar-contra-abandonar.
51. **Invariantes del soak** (100/100):
    - 0 errores y 0 respuestas 5xx.
    - 0 partidas huérfanas o sin cerrar: 92 `FINISHED` y 8 `ABANDONED`.
    - 0 marcadores imposibles y 0 resultados duplicados.
    - 0 autopartidas y 0 jugadores en dos partidas (guardia 409).
    - 0 transiciones inválidas (versiones monótonas).
    - Recálculo 100/100.
    - Rating y créditos sin cambios.
52. **Límites de frecuencia:**
    - Una partida normal no ve **ningún 429**.
    - 60 sondeos de cola simultáneos → 60×200 (cubeta de 90/min).
    - El abuso sostenido se corta con `Retry-After`.
53. **Sondeo y tiempo real:**
    - Partida: 1,2 s en turno rival, 2,5 s en turno propio, 15 s con la pestaña oculta; una petición en vuelo; al volver a la pestaña, resync inmediato.
    - Cola: 2 s / 6 s.
    - No hay Realtime que auditar, ni se introdujo.
    - F66: la cola ya no se detiene para siempre ante un fallo de red o un 5xx (backoff).
54. **Peticiones por partida** (clientes A y B, partidas 2–5):
    - 39–47 peticiones de API por partida (~32 sondeos PvP, 3–10 de cola, 3 de competitivo, 1 de daily-loop).
    - Todo 200, 0×404.
    - **0 peticiones** en los 8 s posteriores al resultado (sin sondeo vivo).
55. **Memoria y listeners** a lo largo de 5 partidas seguidas:
    - Heap: 18,7 → 14,2 → 16,2 → 12,9 → 12,0 MB.
    - Listeners: 402–525, estables.
    - Sin crecimiento.
56. **Play Again** («Buscar otro rival»): vuelve a la cola con un `match_id` nuevo cada vez y sin ticket duplicado.
57. **Cinco partidas seguidas:** 5/5 limpias.
58. **`/admin/system`:** nuevo chequeo mínimo **Multijugador**, de solo lectura, acotado a 500 filas, sin datos personales. Tiene tests unitarios. No se probó en vivo: no hay cuenta QA administradora y la del usuario no se usa.
59. **Suite de seguridad** (automatizada): IDOR, resultado / recompensa / eje / turno falsos, mazo inválido (F65), repetición, petición vieja, sin sesión, acción entre usuarios.
60. **Suite de concurrencia** (automatizada, unit + BD real): cola en paralelo, jugadas en paralelo, finalizar en paralelo, abandonos en paralelo, jugar contra abandonar, recarga contra jugada y dos pestañas.

## 61–72 · Regresiones y cambios

61. **F61:** huella dorada `F61 MOTOR 01` verde; final, desempate y recarga del resultado verificados.
62. **F62:** pago único (+120 = premio); PvP sin pago.
63. **F63:** la primera partida PvE usa el mismo `playTurn` (ahora con versión); `/api/game/onboarding` 200.
64. **F64:** 0 errores de consola nuevos (solo los `ERR_INTERNET_DISCONNECTED` provocados) y 0×404 en la arena; loaders, transiciones y audio sin tocar.
65. **F65:** huella del motor intacta; `lab.test` verde; ninguna propuesta aplicada.
66. Reglas de balance cambiadas: **NO**.
67. Reglas del motor cambiadas: **NO** (`duel-turns-2` / `duel-combat-2` intactos).
68. Economía cambiada: **NO**.
69. Cartas cambiadas: **NO**.
70. Agentes cambiados: **NO**.
71. Migración de BD: **NO**. Se reutilizaron las columnas `state_version` y el libro de acciones de 0031.
72. BD de producción modificada: **NO** en esquema ni en configuración. Solo las filas propias del juego de las cuentas QA (partidas, colas, rating QA, amistades QA).

## 73–85 · Cuentas, gates y cierre

73. Mi cuenta modificada: **NO**. Todos los instrumentos abortan con `2f86cbe8`. No se hizo ninguna petición con ella.
74. **Cuentas QA usadas:**
    - A `1ff2c0ef`, B `8c326e52`: E2E ranked.
    - C `40a1e10d`: API y PvE.
    - D `a9a86124`, E `344349b7`, F `0692cbd0`, G `772cf6f1`: soak privado.
75. **Residuos QA** (se conservan; borrarlos rompería libro mayor y series):
    - Rating: A pasó de 3 a 29 partidas ranked (891); B de 3 a 28 (1083); C +1 (998).
    - Filas: 26 partidas ranked QA (todas con A: E2E, diagnosis, abandonadas y expiradas; 1 contra C), 101 partidas privadas D–G y 1 PvE completa de C (+120 créditos).
    - Amistades D–E y F–G.
    - Entradas de cola históricas.
76. **Tests:** 5.298 → **5.321** (+23).
    - Carreras PvE: 5.
    - Carreras y seguridad PvP: 8.
    - Resincronización del cliente: 4.
    - Salud: 2.
    - Entrada `?buscar`: 4.
77. tsc web: **0 errores**.
78. tsc scripts: **0 errores**.
79. eslint src: **0 errores** (27 avisos previos, sin cambios).
80. `npm run build`: **verde**.
81. HTTP :3005: **200** (build final de F66, proceso real identificado por puerto).
82. Túnel: abierto (54521/54522). Se cerró durante los gates.
83. **Ficheros:**
    - **Modificados:**
      - `server/services/duels.ts` (versión PvE, abandono solo en curso, código de conflicto).
      - `app/api/game/duel/route.ts` (409 con código y vista).
      - `server/services/duelsPvp.ts` (409 con estado, reintento idempotente concurrente).
      - `app/api/game/duel/pvp/route.ts` (404 uniforme, `sync` en el 409).
      - `lib/duel/pvpTransport.ts` (4xx → CONFLICT, `sync`).
      - `lib/duel/pvpPoller.ts` (adopta el estado del 409).
      - `lib/duel/usePvpQueue.ts` (backoff en red y 5xx).
      - `lib/duel/gameplayUx.ts` (copia honesta).
      - `app/duelos/pvp/page.tsx` (cerrojo por ref, `?buscar` retoma la partida viva y se consume).
      - `app/duelos/jugar/page.tsx` (resync PvE).
      - `server/admin/overview.ts` (chequeo Multijugador).
      - `server/services/testing/memSupabase.ts` (fidelidad de PostgREST).
      - `lib/duel/gameplayUx.test.ts` (pin reescrito: el texto de ERROR ya no promete reintento).
    - **Nuevos:**
      - `domain/cardgame/pvp/health.ts` + test.
      - `lib/duel/autoSearch.ts` + test.
      - `lib/duel/f66.resync.test.ts`.
      - `server/services/{duels,duelsPvp}.concurrency.service.test.ts`.
      - Instrumentos `scripts/multiplayer/_*.ts`.
84. **Límites:**
    - Sin presencia real: la desconexión se infiere por el reloj del turno (90 s).
    - Deuda INT-2: cuerpos de ruta no estrictos (sin efecto sobre el resultado).
    - La primera corrida del E2E dio dos falsos «cliente atascado» por la presión del propio instrumento sobre `mm_status`; se corrigió el instrumento. Esa corrida también destapó los bugs 11/12 de la lista de abajo.
    - El chequeo de `/admin/system` no se ejercitó en vivo.
    - La telemetría real sigue bloqueada (psql por ssh denegado, F65).
    - F5 exactamente durante VS / presentación / desempate: no automatizado aparte. Se cubre por la regla «todo sale de GET» y por F61.
85. **GO.** Se cumplen todos los criterios del punto 114 con evidencia en BD real.

### Bugs encontrados y arreglados en F66

1. PvE: dos jugadas del mismo turno se pisaban.
2. PvE: abandonar borraba partidas terminadas, con un posible híbrido jugar/abandonar.
3. PvP: el 404 era un oráculo de existencia.
4. PvP: un reintento con la misma `actionId` que coincidía con el original recibía 409.
5. PvP: el 409 no traía estado.
6. Cliente: un 4xx se mostraba como «Reconectando» y se reintentaba.
7. Cliente: el doble clic en el mismo tick esquivaba el `busy`.
8. Cliente: la cola moría para siempre tras un fallo de red.
9. Cliente: la copia de ERROR prometía un reintento que no existe.
10. Cliente PvE: sin resync ante un conflicto o un fallo de red.
11. **`?buscar=` + F5 al emparejar:** el jugador quedaba fuera de su partida viva y la perdía por tiempo. Grave, destapado por el E2E real.
12. **`?buscar=` nunca se limpiaba:** cada F5 volvía a encolar, también en la pantalla de resultado.
