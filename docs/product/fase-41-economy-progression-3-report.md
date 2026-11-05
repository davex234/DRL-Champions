# Fase 41 · Economy & Progression 3.0 — «EARN. CHOOSE. GROW.» · Informe

Contrato: `docs/product/economy-contract.md` · Simulación: `docs/product/qa/fase41/economy-simulation.md` · QA:
`docs/product/qa/fase41/README.md`.

## 1. Estado inicial
Fase 40 cerrada en GO (3.000 tests). El Sobre Inicial era la ruta garantizada al primer equipo: precio 0 y comprable sin
límite. Economía server-authoritative con libro mayor (`credit_transactions`) y operaciones idempotentes (`economy_ops`),
pero sin un mapa canónico, sin simulador de trayectorias y con varias fuentes sin tope.

## 2. Arquitectura económica encontrada
Una moneda (DRL Credits) en `profiles.credits`. Cada variación escribe un asiento, salvo la apertura de sobres (0 créditos).
Hay dos puertas de escritura. `_ledger_apply` tiene bloqueo y suelo 0 y la usan las compras, el reciclaje, el mercado y el
sandbox. `app_grant_reward` es idempotente por `(user_id, ref)` y no tiene suelo; la usan las recompensas. La lógica vive en
Node y la concesión en RPC `security definer` que solo puede ejecutar `service_role`. Además hay economías locales
(entrenador, carrera, pick'em local) que el servidor sobrescribe.

## 3. Economy sources
Alta (6.000 + 3 Iniciales + 1 Estándar) · Sobre Inicial gratis · PvE (25–350, tope 20/día) · campaña (1.350 una vez) ·
misiones diarias/semanales/temporada/hitos · pase libre (15.900 + 6 sobres) y competitivo (26.000 + 6 Premium) · logros
(67.500) · Pick'em (500–6.000 por escalón) · desafíos de evento (500–1.500) · reciclaje (30–1.600 por copia) · tienda de
prueba (1.000–28.000).

## 4. Economy sinks
Sobres (750–20.000) · prestigio (15.000/40.000/100.000) · devolución de la tienda de prueba · comisión del mercado (5 %,
desactivado).

## 5. Transfers
Mercado P2P (carta ↔ créditos con comisión): construido y **cerrado** (`GLOBAL_MARKET_ENABLED=false`, 503).

## 6. Non-economic progression
Apertura de sobres (XP de cuenta 18–138 por carta), XP del pase (solo misiones), rating PvP, puntos de rango, Draft
Gauntlet, maestría (solo cosméticos), carril de pago del pase (cosméticos; sin ruta online).

## 7. Valores económicos canónicos
Ver tabla completa en `economy-contract.md` §2. Todos se leen de sus constantes (`duelRewards`, `data/season`,
`achievements`, `pickems/rewards`, `events/challenges`, `campaign/rewards`, `data/packs`, `salvage`, `prestige`,
`drlCredits`) a través de `src/domain/economy/catalog.ts`.

## 8. Valores duplicados encontrados
- `CAMPAIGN_FIRST_CLEAR_CAP` (1.500) coexiste con el total real de la campaña (1.350): el techo es una cota, no un valor.
  Se documenta; el catálogo usa el total real.
- Los logros de catálogo (servidor) conviven con logros locales de carrera/entrenador (5k–50k) que no llegan al servidor.
- Existe un modelo antiguo (`scripts/economy-simulate.ts`, `economy-model.ts`) con supuestos propios; se conserva y no se
  usa como fuente.

No hay importes contradictorios entre servidor y presentación.

## 9. Economy catalog
`economyFlows()` define 23 flujos: 14 SOURCE, 3 SINK, 1 TRANSFER y 5 NON_ECONOMIC. Cada uno lleva importe, repetición, tope,
clave de idempotencia, ruta y estado. `seasonBudget()` y `dailyRecurringCeiling()` dan un techo diario recurrente de 11.150.

## 10. Economy invariants
Diez invariantes, I1–I10 (`economy-contract.md` §1): saldo ≥ 0; saldo = Σ asientos; una clave, un pago; el cliente no
elige importe ni recompensa; ninguna fuente infinita; GET sin economía; el serial no cuenta; Draft y PvP sin créditos; el
histórico no se reescribe; mercado cerrado.

## 11. Ledger architecture
- `credit_transactions`: índice único `(user_id, ref)`, RLS de lectura propia y sin escritura de cliente.
- `economy_ops`: `ref` es PK global y guarda el resultado de cada operación.
- `_ledger_apply` (0019): `for update` y suelo 0.
- `app_grant_reward` (0026): puerta de idempotencia por asiento, sin suelo.

## 12. Ledger reconciliation real
BD del VPS, en solo lectura y sin PII: 11 cuentas, 0 saldos negativos y 0 cuentas con saldo ≠ Σ asientos. Hay 0 claves
duplicadas y 0 re-cobros de misión en la misma tanda. El máximo de duelos pagados en un día es 2, sin asientos topados.
Hay 2 compras sandbox históricas y un máximo de 3 Sobres Iniciales gratis por cuenta. La única discrepancia del «último
`balance_after`» (cuenta cd7fbe32) se explica por el empate de timestamp entre `market_fee` y `market_sell` en la misma
transacción; la cadena cuadra.

## 13. Idempotency map
- Compra: `pack:buy:<uid>:<gesto>`. Sobre Inicial gratis: `starter-assist-<n>`.
- Apertura: `pack:open:<uid>:<gesto>`, con resultado guardado.
- Duelo: `duel:<matchId>`. Campaña: `campaign:<c>:<nodo>`.
- Misión: `mission:<s>:<id>:<assignedAt>:<baseline>`. Pase: `pass:<s>:<carril>:<nivel>`. Logro: `achievement:<id>`.
- Pick'em: `pickem:<ev>:<escalón>`. Evento: `event:<ev>:<desafío>`.
- Reciclaje: `salvage:<uid>:<gesto>`. Sandbox: `drlc:<uid>:<ref>`.
- Prestigio: antes `prestige:<base>:<escalón>`; **ahora `prestige:<uid>:<base>:<escalón>`**.

## 14. Retry/concurrency map
- Compra y apertura con el mismo gesto: una sola operación (verificado en real).
- `buy_and_open` reintentado: devuelve la apertura guardada.
- Concesión gratis simultánea: la misma clave N-ésima, así que una sola concesión.
- Recompensa: el ref la hace idempotente.
- Reclamo de misión o de nivel concurrente: antes podía duplicar XP del pase. **Ahora hay concurrencia optimista del pase;
  la escritura perdedora recibe 409.**
- Reciclaje con la misma clave: un pago.
- Tope PvE: el recuento no es atómico. P2 acotado, porque hay una partida PvE activa por jugador.

## 15. Read-side effects
Vestíbulo, temporada y starter: lecturas puras. **`GET /api/game/competitive` escribía** (`ensureRating` + `getProgression`):
corregido. `/api/game/meta` y `/api/game/loop` (GET) siguen asentando pase y rating al leer, sin créditos ni XP (P2).

## 16. GET competitive
Snapshot y posición ahora leen la ficha de rating tal cual (sin ficha: 1.000 y 0 partidas, sin crearla) y usan
`peekProgression`. En la QA real, snapshot ×2 + posición → 200 con 0 escrituras.

## 17. Starter actual
El trigger `handle_new_user` da 6.000 créditos, 3 Sobres Iniciales y 1 Estándar. El Sobre Inicial costaba 0 y no tenía
límite.

## 18. Starter exploit antes
Comprar y abrir el Sobre Inicial sin fin daba cartas y XP gratis. Además alimentaba el re-cobro de `d-abrir-1` (+200), de
`w-sobres-10` (+1.500 cada 10) y de los logros de 100 y 1.000 sobres (27.500), y el reciclaje (≈ +241 de EV por sobre).
Resultado: una fuente infinita de créditos. En la línea base, HARDCORE abrió 5.401 gratis en 180 días.

## 19. Starter solvability antes
Con la bienvenida, solo el 33,97 % podía formar plantilla. Las aperturas totales fueron P50 5, P90 9, P99 14, máx. 28, y
el 100 % llegaba solo gracias al grifo.

## 20. Alternativas starter simuladas
A actual · B sobre de rol completo · C1/C2/C3 con 1/2/3 huecos de rol · C2 abriendo primero el Estándar · D elegir carta ·
E bootstrap de 10 cartas · F con asistencia también en el Estándar. 100.000 cuentas cada una con el motor real (tabla en
`economy-simulation.md` §3).

## 21. Starter decisión
**C2: 2 huecos asistidos + gratis solo sin plantilla + tope 8.** Es el mínimo que cumple con margen: C1 queda justo en P90
6. B, C3 y F cambian más de lo necesario, D da autoridad al cliente y E exige migración.

## 22. Starter implementación
- `domain/economy/starter.ts`: política pura.
- `openPack`: `assist` inerte por defecto.
- `server/services/starter.ts`: lectura de hechos.
- `buyPack`: elegibilidad y clave N-ésima.
- `openPackForUser`: asistencia.
- `buyAndOpen`: devuelve la apertura guardada antes de comprar.
- `GET /api/game/starter`.
- La ficha de sobre usa `starterOffer` + `PackPurchaseCta`.
- Copia del recorrido: «Consigue las cartas que te faltan para completar tu plantilla.»

## 23. Starter server authority
El cliente no aporta hechos, rol ni carta. La elegibilidad sale de `user_cards`, `user_packs` y el libro mayor. La
asistencia la calcula el servidor al abrir.

## 24. Starter eligibility
Es elegible si NO hay plantilla posible **y** tiene 0 Sobres Iniciales sin abrir **y** tiene menos de 8 concesiones
históricas. Motivos de rechazo: `DECK_READY`, `HAS_UNOPENED_STARTER`, `CLAIM_CAP`.

## 25. Starter exit
En cuanto `deckReadiness` es verdadero, la compra gratis responde 409 («Ya puedes formar tu plantilla…») y la asistencia
deja de aplicarse. Verificado en real con 409 ×6.

## 26. Existing owned starter packs
Se abren siempre: nada se retira y no hay retroactividad. Con plantilla posible se abren con odds normales.

## 27. Legacy accounts
El tope cuenta las concesiones históricas (máx. real 3 < 8). Cuentas con plantilla: sin gratis. Cuentas sin plantilla:
asistidas. Sin migración, sin reset y sin UPDATE de asientos.

## 28. Starter security
- Ráfagas: una concesión.
- Reintento de `buy_and_open`: sin segunda concesión.
- Precio 0 fuera del Sobre Inicial: rechazado.
- Ruta de estado solo GET; la ruta de sobres sigue solo POST con cuerpo cerrado.
- Fuzzer: 0 violaciones de `tope-starter` y de `starter-tras-plantilla`.

## 29. Starter simulation final
- 100.000 cuentas por alternativa (`starter-simulation.json`).
- `player-journey-starter:verify` con el motor real: 100.000 cuentas, 79,94 % con plantilla tras la bienvenida, gratis
  extra P90 1 / P99 1 / máx. 2.
- `economy-starter:verify`: 20.000 cuentas.

## 30. Starter P50/P90/P99
Aperturas totales: **P50 4 · P90 5 · P99 5 · P99,9 5 · máx. 6**, 100 % con plantilla y 0 cuentas atrapadas (objetivo
4/6/8).

## 31. Starter strength
- OVR medio del equipo autocompletado: 79,4 (80,1 sin asistencia).
- Rareza en los huecos asistidos: 70,0/26,0/3,5/0,5/0, igual a los pesos del Sobre Inicial.
- No hay starter sobredimensionado.

## 32. Credit sources
Medias a 180 días (después):
- REGULAR: PvE 78.141, reciclaje 96.954, misiones 54.961, pase 34.012, logros 16.789, eventos + Pick'em 19.145.
- HARDCORE: PvE 637.952, reciclaje 516.565.
- CASUAL: fuente principal PvE (12.034) y misiones/pase.

## 33. Credit sinks
Sobres: REGULAR 294.124 a 180 días (Estándar 195.866, Premium 98.258); HARDCORE 1.358.616, 88 % en Premium. Prestigio y
mercado no se modelan (sumidero raro / cerrado).

## 34. Source/sink baseline
Ratio gasto/ingreso, línea base: CASUAL 0,98 a 30 días · REGULAR 0,77 · ENGAGED 0,99 · HARDCORE 0,98. El HARDCORE lo
gastaba todo porque ganaba 2,0 M en 30 días.

## 35. Pack prices
Sin cambios: Inicial 0 (asistencia) · Estándar 750 · Premium 2.500 · regionales y de equipo 3.000 · Masters 5.000 · EWC 6.000 ·
Champions 8.000 · Icon 20.000 · Prime 10.000 (RETIRED).

## 36. Pack affordability
Valor esperado por partida: Fácil 95 · Normal 138 · Difícil 177. Solo con PvE:
- Estándar: 8 partidas Fácil (≈ 30 min).
- Premium: 18 Normal.
- Icon: 145 Normal (≈ 7 días al tope).

CASUAL gana ≈ 38.000 en 30 días, un Estándar cada 0,6 días. Nadie necesita 40 horas para un sobre.

## 37. Pack utility
Ningún sobre de pago tiene EV de reciclaje ≥ precio (Estándar ≈ 355 frente a 750; Premium < 1.000 frente a 2.500; Icon ≈ 2.200 frente a 20.000). Los
sobres dan colección y XP; el reciclaje devuelve parte, no imprime.

## 38. Duplicate curve
CASUAL (no recicla), duplicadas P50: 3 / 23 / 58 / 128 / 174 a 1/7/30/90/180 días (antes 3/42/98/221/265). Los arquetipos
que reciclan las mantienen cerca de 0.

## 39. Duplicate utility
Reciclaje por rareza (30–1.600) sin serie. REGULAR recicla 28.490 a 30 días y 104.660 a 180 (P50).

## 40. Account XP
`profiles.xp` sale de sobres (18–138 por carta), partidas y recompensas; es independiente del pase.

## 41. Account levels
P50 a 30/90/180 días: CASUAL 20/27/32 · REGULAR 38/59/78 · ENGAGED 54/92/135 · HARDCORE 78/143/215 (antes HARDCORE
186/333/467). Sin tope y sin recompensas por nivel.

## 42. Pass XP
Solo de misiones. Antes la re-reclamación la inflaba (HARDCORE: 3.912 reclamos en 180 días); ahora 200.

## 43. Season 1 progression
Nivel 30 del pase (P50): REGULAR y ENGAGED ≈ día 30; CASUAL 14 a 30 días y 23 a 90. Se completa rápido (observación de
diseño, sin cambiar importes).

## 44. Late-start Season
Nivel del pase a 90 días según día de entrada (P50; P10–P90):

| Arquetipo | Día 1 | Día 14 | Día 43 | Día 71 (últimas 2 semanas) |
|---|---|---|---|---|
| CASUAL | 30 (25–30) | 28 (23–30) | 20 (15–24) | 11 (4–13) |
| REGULAR | 30 | 30 | 30 | 19 (18–24) |
| ENGAGED | 30 | 30 | 30 | 25 (24–26) |
| HARDCORE | 30 | 30 | 30 | 26 (25–26) |

Quien entra tarde progresa menos, sin bloqueo ni recuperación artificial; con 14 días REGULAR aún llega al 19.

## 45. Daily missions
3 al día (200–400 + XP), una vez por tanda. Real: `d-duelo-1` +250, `d-duelo-win` +400 y `d-abrir-1` +200; tras otra
partida real, el re-reclamo da 409 y +0.

## 46. Weekly missions
2 por semana (1.200–1.800 + XP), una vez por tanda. «Actualizar» ya no re-sortea.

## 47. Pack objective
`packs_opened` = `user_game.packs_opened` (Fase 36.1) intacto. Con el Sobre Inicial acotado deja de ser farmeable
(`pack-objective:verify` en verde).

## 48. Achievements
7 logros de servidor (67.500 en total), una vez cada uno. `sobres-1000` (25.000) ya no se alcanza farmeando: HARDCORE
abre 737 sobres en 180 días.

## 49. PvE economy
Tabla sin cambios (EASY 120/60/25 · NORMAL 220/100/40 · HARD 350/160/60) y tope de 20 al día. Real: `duel_win` +120, un
único asiento `duel:<id>`.

## 50. PvE farming
≈ 2.700–3.500 créditos/hora en Difícil hasta el tope (máx. 7.000/día) y 0 desde la partida 21. Antes, las misiones
re-reclamables daban +650 por victoria sin tope.

## 51. PvP/Ranked economy
Sin créditos (solo rating). No hay incentivo a dejarse ganar: no hay premio por perder ni por el resultado del rival.

## 52. Campaign economy
Primera victoria por nodo: 1.350 en total, una vez en la vida, sin cambios.

## 53. Draft economy
0 créditos, sobres y XP (Fase 39). Sigue igual (`draft-gauntlet-economy:verify`).

## 54. Pick'ems economy
Escalón alcanzado por evento. Al recorregir subiendo se pagan escalones intermedios (≤ 11.000 por evento frente a 6.000
del contrato): P2 documentado. El worker no se toca.

## 55. Live Events economy
Desafíos: 500/1.000/800/1.200 + Estándar/500 (+1.500 en internacionales), una vez por evento.

## 56. Social economy
Amigos y duelos privados: 0 créditos (PVP_PRIVATE sin liquidar).

## 57. Reward stacking
Una partida puede pagar a la vez la tabla PvE, `d-duelo-1`, `d-duelo-win`, las semanales y el desafío de evento. Después,
cada misión una vez por tanda: el apilamiento diario queda por debajo del techo de 11.150 (máx. simulado 10.330).

## 58. Reward traces
Trazas de una acción, antes y después: `economy-simulation.md` §4. Sandbox +28.000 → 403. Victoria +650 sin tope → +350
dentro del tope. «Actualizar» re-cobraba → no-op. Prestigio sin cobro para el 2.º jugador → cobro propio. Recompensa
negativa posible → rechazada.

## 59. Early game
Día 1 (P50): CASUAL gana 16.530 y abre 12 sobres, con 58 cartas distintas y plantilla posible. REGULAR, 19.010. Generoso
por logros y misiones de colección (observación).

## 60. Mid game
30 días (P50): colección CASUAL 31 %, REGULAR 56 %, ENGAGED 60 %, HARDCORE 65 %. Saldos bajos: los jugadores gastan.

## 61. Late game
180 días: colección ENGAGED 95 % y HARDCORE 98 %. Los sumideros restantes son el prestigio y los Premium; el riesgo de
«500.000 créditos sin nada que comprar» aparece en HARDCORE hacia el final (observación para una fase de contenido).

## 62. Economy targets
- Starter P50 ≤ 4 / P90 ≤ 6 / P99 ≤ 8 y 100 %.
- 0 fuentes infinitas.
- Recurrente diario ≤ techo.
- Saldo ≥ 0 y saldo = Σ asientos.
- GET sin escrituras.
- Sin EV positivo sobre–reciclaje.

## 63. Health metrics
12 comprobaciones por simulación (primer equipo el día 1, fuente recurrente acotada, Sobre Inicial acotado por
arquetipo), más el fuzzer (17 invariantes) y la BD real.

## 64. Baseline simulation
`baseline-economy.json`: 1.000.000 de trayectorias con las reglas anteriores. **Salud 6/12**: fuente recurrente sin tope
en ENGAGED (19.900) y HARDCORE (105.650), y Sobre Inicial sin tope en los cuatro arquetipos.

## 65. Baseline 1d
Ganado P50: CASUAL 16.530 · REGULAR 20.730 · ENGAGED 25.280 · HARDCORE 93.420.

## 66. Baseline 7d
CASUAL 31.620 · REGULAR 61.820 · ENGAGED 185.050 · HARDCORE 621.890.

## 67. Baseline 30d
CASUAL 50.840 · REGULAR 228.370 · ENGAGED 496.690 · HARDCORE 2.012.610.

## 68. Baseline 90d
CASUAL 82.325 · REGULAR 415.340 · ENGAGED 964.330 · HARDCORE 4.317.430.

## 69. Baseline 180d
CASUAL 92.285 · REGULAR 517.640 · ENGAGED 1.241.670 · HARDCORE 6.032.470. Sobres Iniciales gratis: HARDCORE 5.401 (P50).

## 70. Problemas P0
1. El Sobre Inicial es un grifo infinito.
2. Las misiones periódicas se pueden re-reclamar dentro de la tanda y «actualizar» las re-sortea.
3. La tienda de créditos de prueba concede sin límite a cualquier sesión.
4. La clave de prestigio no lleva usuario (colisión entre jugadores).
5. `app_grant_reward` no tiene suelo (una recompensa negativa deja saldo negativo).

## 71. Problemas P1
1. Escrituras perdidas en `user_pass` duplican la XP del pase.
2. `GET /api/game/competitive` escribe.
3. Recuento del tope PvE no atómico (acotado).

## 72. Problemas P2
1. Pick'em acumulable al recorregir.
2. `GET /api/game/meta` y `/loop` asientan pase y rating.
3. Carrera del tope PvE.
4. Ritmo del pase y de la colección rápido.
5. Primer día generoso.
6. Sumideros de fin de partida escasos.

## 73. Cambios económicos realizados
5 cambios sustantivos, sin cambiar ni un importe:
1. Sobre Inicial = asistencia de primer equipo.
2. Misiones una vez por tanda y «actualizar» sin re-sorteo.
3. Tienda de prueba cerrada.
4. Prestigio con clave por usuario.
5. Recompensas nunca negativas y pase con concurrencia optimista.

`ECONOMY_VERSION` 3. Arreglo de lectura aparte: GET competitivo puro.

## 74. Cambio 1 before/after
- **Antes:** Sobre Inicial a precio 0, ilimitado; A: P50 5 / P90 9 / P99 14; HARDCORE abría 5.401 en 180 días.
- **Después:** gratis solo sin plantilla, 0 sin abrir, ≤ 8 en la vida, 2 huecos de rol; P50 4 / P90 5 / P99 5 y máx. 2
  gratis extra.
- **Motivo:** P0 y objetivo del encargo.
- **Evidencia:** simulación de 100.000 cuentas, 20.000 + 100.000 en verificadores, QA real con 409 ×6.
- **Impacto simulado:** HARDCORE 30 días de 2,01 M a 335.000 créditos ganados.

## 75. Cambio 2 before/after
- **Antes:** una misión repetible se re-baselineaba y se volvía a cobrar dentro de la tanda; «actualizar» asignaba baseline
  nuevo.
- **Después:** `claimed` hasta la rotación; «actualizar» solo rota ventanas vencidas.
- **Evidencia:**
  - Real: `d-duelo-1` / `d-duelo-win` / `d-abrir-1` devuelven 409 +0 tras otra partida.
  - Matriz M: 16 casos.
  - Mutación: 8 violaciones detectadas.
- **Impacto:** reclamos de misión de ENGAGED a 180 días de 666 a 164; máximo recurrente diario de 19.900 a 7.450.

## 76. Cambio 3 before/after
- **Antes:** `sandboxPurchase` concedía 1.000–28.000 por llamada con una ref nueva.
- **Después:** 403 salvo `NEXUS_SANDBOX_CREDITS=1`; la pantalla dice que está cerrada.
- **Evidencia:** real 403 y `purchasesOpen=false`; matriz C (5); fuzzer.
- **Impacto:** elimina una fuente infinita (no cabe en una distribución).

## 77. Cambio 4 before/after
- **Antes:** `prestige:<base>:<escalón>` con PK global; el 2.º jugador recibía el resultado del 1.º (sin cobro, sin
  cosmético y con el saldo ajeno).
- **Después:** `prestige:<uid>:<base>:<escalón>`.
- **Evidencia:** matriz X (5); fuzzer 0 violaciones; mutación con 478 violaciones detectadas.
- **Impacto:** cobro correcto y fuga de saldo ajeno cerrada.

## 78. Cambio 5 before/after
- **Antes:** `award()` pasaba créditos, XP o sobres negativos a una RPC sin suelo, y dos escrituras del pase se pisaban (XP
  duplicada).
- **Después:** negativos rechazados antes de la RPC; `savePass` exige `updated_at` y la escritura perdedora recibe 409.
- **Evidencia:** matriz R (10); servicio (5 reclamos simultáneos dan XP una vez); fuzzer `xp-pase-sin-pago` 0.
- **Impacto:** saldo ≥ 0 garantizado y XP del pase no inflable.

## 79. Final simulation
`final-economy.json`: 1.000.000 de trayectorias con las reglas de la Fase 41. **Salud 12/12.**

## 80. Final 1d
Ganado P50: CASUAL 16.530 · REGULAR 19.010 · ENGAGED 16.070 · HARDCORE 22.930. 100 % con plantilla el día 1.

## 81. Final 7d
CASUAL 24.280 · REGULAR 35.590 · ENGAGED 75.680 · HARDCORE 109.400.

## 82. Final 30d
CASUAL 37.850 · REGULAR 141.920 · ENGAGED 212.640 · HARDCORE 334.640 (P99 379.350).

## 83. Final 90d
CASUAL 59.175 · REGULAR 239.590 · ENGAGED 422.530 · HARDCORE 766.770.

## 84. Final 180d
CASUAL 71.835 · REGULAR 328.080 · ENGAGED 691.850 · HARDCORE 1.374.190.

## 85. Casual
- 30 días: 59 sobres, colección 31 %, pase 14, cuenta nivel 20, saldo 510.
- 180 días: colección 49 %, pase 23.
- Máximo recurrente diario: 4.510.

## 86. Regular
- 30 días: 133 sobres, colección 56 %, pase 30, cuenta nivel 38, saldo 30.890.
- 180 días: colección 85 %.
- Máximo recurrente: 5.470.

## 87. Engaged
- 30 días: 153 sobres, colección 60 %, pase 30.
- 180 días: colección 95 %.
- Máximo recurrente: 7.450 (antes 19.900).

## 88. Hardcore
- 30 días: 181 sobres (antes 1.734), colección 65 % (antes 100 %).
- 180 días: colección 98 %.
- Máximo recurrente: 10.330 ≤ 11.150 (antes 105.650).

## 89. Source/sink final
Ratio gasto/ingreso a 30 días: CASUAL 0,98 · REGULAR 0,78 · ENGAGED 0,99 · HARDCORE 0,99. Los días de pico no recurrentes
(P99 34.000–43.000) vienen de fuentes de una vez: logros de colección, escalones de Pick'em, niveles del pase y reciclaje
semanal.

## 90. Collection progression
% distinto P50 a 1/7/30/90/180 días:
- CASUAL 7,5/19,8/31,1/43,3/48,7.
- REGULAR 7,1/25,3/55,6/75,1/84,8.
- ENGAGED 5,2/27,9/60,0/84,6/95,2.
- HARDCORE 7,5/33,4/64,9/89,8/98,2.

Legendarias distintas a 180 días: 1 / 4 / 7 / 7.

## 91. Legal deck diversity
Plantillas disjuntas posibles (P50) a 1/7/30/90/180 días: CASUAL 2/6/9/12/13 · REGULAR 2/7/14/17/17 · ENGAGED
2/8/14/17/18 · HARDCORE 2/9/15/18/18. El techo son los jugadores reales por rol (80 Centinela y 80 Flex).

## 92. Pass completion
Nivel 30 a 90 días (P50): REGULAR, ENGAGED y HARDCORE sí; CASUAL 23 (30 si entra el día 1, 11 si entra en las 2 últimas
semanas). Tabla completa en §44.

## 93. Reward concentration
REGULAR a 180 días: PvE 25 %, reciclaje 31 %, misiones 17 %, pase 11 %, logros 5 %, eventos y Pick'em 6 %. Ninguna fuente
recurrente domina sola. El reciclaje es grande porque devuelve parte del gasto.

## 94. Exploit fuzzer
`src/server/services/testing/economyFuzz.ts` sobre `MemSupabase`, con las RPC reproducidas de 0019/0024/0025/0026 y los
servicios reales. 17 invariantes.

## 95. 100k random sequences
100.000 secuencias y 851.178 acciones: **0 violaciones**. Aceptadas, entre otras: 55.865 aperturas, 43.880 compras, 41.902
reclamos, 51.785 ráfagas, 23.652 reintentos y 45.858 compras de prestigio. Con los P0 reintroducidos a propósito detecta 486
violaciones.

## 96. Concurrency
- Ráfagas de compra gratis: 1 concesión.
- Aperturas simultáneas del mismo gesto: mismas cartas.
- 4 compras simultáneas con 1.500 de saldo: 2 cobros y saldo 0.
- 5 reclamos simultáneos: XP una vez.
- Dos jugadores con el mismo prestigio: dos cobros.
- Reciclaje simultáneo: un pago.

## 97. Security
Sandbox cerrada; clave de prestigio por usuario; recompensa negativa rechazada; cuerpos sin importes; el precio lo pone el
servidor; GET sin escrituras; Draft sin economía; serial sin valor; Colección sin venta; mercado cerrado
(`economy-security:verify` 12/12).

## 98. RLS/grants
Sin cambios: RPC de economía revocadas a `public`, `anon` y `authenticated` (solo `service_role`), y asientos sin
escritura de cliente. La ruta nueva es GET con sesión y el usuario sale del token.

## 99. Migration sí/no
**No.** Todo se resuelve en servicio y dominio; la última migración sigue siendo 0053.

## 100. Migration safety
No aplica. Sin cambios de esquema, datos ni `schema_migrations`.

## 101. Real DB read-only analysis
Por SSH con `default_transaction_read_only = on` y agregados sin PII (ver §12). Cuenta de la Fase 40 (64ee0e54)
comprobada intacta: 6.120 créditos, 35 cartas, último asiento de la Fase 40.

## 102. Real QA account
Cuenta existente 8c326e52 (Fase 35.2), con cliente público y credenciales fuera del repo. App local `next start` → túnel →
BD del VPS.

## 103. Real pre-fingerprint
Créditos 4.040 · XP 1.110 · puntos 16 · 7 sobres abiertos · 35 cartas · 3 partidas · rating 1000/0 · 7 asientos (suma
4.040) · 10 ops · 0 pagos.

## 104. Real pack purchase
Estándar: 200 y −750 exactos (4.040 → 3.290). Reintento con el mismo gesto: 200 y +0.

## 105. Real pack opening
5 cartas (35 → 40), +1 sobre abierto y 0 créditos. Reintento: mismas uids, `repeated` y +0.

## 106. Real PvE reward
Partida Fácil real por la API, 10 turnos, COMPLETED: `duel_win` +120 (3.290 → 3.410), un asiento `duel:<id>`.

## 107. Real reward retry
Jugada repetida sobre la partida terminada: 409 y +0. `s-mazo`: +1.000 y re-reclamo 409 +0. Periódicas: 409 +0 tras otra
partida real.

## 108. Real starter-farm probe
`GET /api/game/starter` → `DECK_READY`. `buy inicial` → 409; ráfaga ×5 de `buy_and_open` → 409 ×5; 0 escrituras.
Sandbox → 403, 0 escrituras.

## 109. Real post-fingerprint
Créditos 4.410 (−750 + 120 + 1.000) · XP 1.348 · puntos 24 · 8 abiertos · 40 cartas · 4 partidas · 10 asientos (suma
4.410) · 12 ops · 0 pagos. Saldo = Σ asientos antes y después.

## 110. Journey regression
`player-journey:verify` 41 ✓ (starter ajustado a la política nueva: 100.000/100.000 con ruta gratuita acotada) · security
15 ✓ · priority 8 ✓ · render de la copia nueva.

## 111. Collection regression
`collection`, `collection-room`, `collection-content`, `collection-security` y `collection-performance`: en verde. Sin
valor ni venta.

## 112. Pack Opening regression
`pack-opening`, `presentation` y `security` en verde. Apertura real con reintento correcta.

## 113. Campaign regression
`campaign`, `campaign-security`, `campaign-economy` y `campaign-content` en verde.

## 114. Draft regression
`draft-gauntlet`, `security`, `economy`, `content` y `solvability` en verde.

## 115. Ranked regression
`competitive:verify` en verde; snapshot y posición puros; sin crear fichas.

## 116. Season regression
`season`, `season-time`, `season-pass`, `season-security` y `season-recap` en verde; `battlepass:verify` en verde con
«una vez por tanda».

## 117. Marketplace state
`GLOBAL_MARKET_ENABLED=false`, intacto.

## 118. Visual QA
`/design-system/fase41`: 31 escenas y 76 capturas (1440, 1024 y 390, con movimiento reducido y foco de teclado).
Desbordamiento 0, errores 0 y botones < 44 px 0. Corregido: precio «No disponible» pintado en verde.

## 119. Tests nuevos
**3.241/3.241** (3.000 → +241):
- `starter.test.ts` 37
- `assist.test.ts` 10
- `catalog.test.ts` 12
- `simulator.test.ts` 14
- `starterOffer.test.ts` 9
- `economy41.service.test.ts` 29
- `economy41.matrix.test.ts` 101 (M001–M100 + recuento)
- `economy.render.test.tsx` 29

Actualizados a propósito: `metricRebase.test.ts`, `prestige.test.ts`, `meta.contract.test.ts` y `season.contract.test.ts`.

## 120. Verifiers nuevos
- `economy:verify` 60 ✓
- `economy-ledger` 5
- `economy-starter` 11
- `economy-idempotency` 7
- `economy-progression` 7
- `economy-security` 12
- `economy-simulation` 12

El anterior sigue como `economy-market:verify`. Nuevos también `economy:simulator`, `economy:starter-sim` y
`economy:fuzz`.

## 121. Gates finales
- `npm test`: 3.241/3.241.
- `tsc` web y scripts: exit 0.
- `next build`: exit 0.
- ESLint de los ficheros de la fase: exit 0.
- 7 verificadores de economía, `battlepass` y los 42 existentes: en verde.

Túnel y app cerrados durante los gates.

## 122. Bugs encontrados
- Los 5 P0 y 3 P1 de §70–71.
- En los verificadores de esta fase: comparación antes/después con la foto previa al reclamo, filtro de dobles de prueba
  con la barra de Windows y muestreo del nivel del pase por día de entrada (solo grupos 0 y 2).
- `sed -i` convirtió CRLF en LF en `engine.ts` (restaurado).
- Precio «No disponible» pintado en verde.

## 123. Bugs corregidos
Todos los anteriores. P2 documentados en §128.

## 124. Valores cambiados
**Ningún importe.** Cambian reglas: elegibilidad y asistencia del Sobre Inicial (2 huecos, tope 8), misiones una vez por
tanda y tienda de prueba cerrada. `ECONOMY_VERSION` 3.

## 125. Archivos creados
- `src/domain/economy/{starter,catalog,simulator}.ts` (+ tests)
- `src/domain/packs/assist.test.ts`
- `src/server/services/starter.ts`
- `src/server/services/testing/{memSupabase,economyFuzz}.ts`
- `src/server/services/economy41.{service,matrix}.test.ts`
- `src/app/api/game/starter/route.ts`
- `src/lib/economy/starterOffer.ts` (+ test)
- `src/components/economy/{PackPurchaseCta,CreditsClosedNotice}.tsx` (+ render test)
- `src/app/design-system/fase41/{page,fixtures}`
- `scripts/{economy41-verify,economy-simulator,economy-starter-simulation,economy-exploit-fuzzer,_fase41-real-qa,_fase41-visual-qa}.ts`
- `docs/product/{economy-contract.md,fase-41-economy-progression-3-report.md}`
- `docs/product/qa/fase41/*`

## 126. Archivos modificados
- `src/domain/packs/openPack.ts`, `src/pack/{types,engine}.ts`
- `src/server/services/{packs,progression,credits,competitive,rewards,prestige}.ts`
- `src/battlepass/engine.ts`
- `src/domain/collection/prestige.ts`, `src/domain/journey/index.ts`
- `src/lib/game/client.ts`
- `src/app/packs/[packId]/page.tsx`, `src/app/tienda/creditos/page.tsx`
- Tests: `metricRebase.test.ts`, `prestige.test.ts`, `meta.contract.test.ts`, `season.contract.test.ts`
- Scripts: `battlepass-verify.ts`, `credits-ui-verify.ts`, `player-journey-verify.ts`
- `package.json`

## 127. DB changes
Ninguno: sin migración, sin SQL de escritura, sin UPDATE de asientos y sin tocar `schema_migrations`. Las únicas
escrituras reales son las de la QA con la cuenta QA, a través de la app.

## 128. P2 restantes
1. Pick'em acumulable al recorregir (≤ 11.000 por evento).
2. `GET /api/game/meta` y `/loop` asientan pase y rating.
3. Carrera del tope PvE (acotada).
4. Ritmo del pase y de la colección rápido y primer día generoso (balance, no agujero).
5. Pocos sumideros de fin de partida para HARDCORE.
6. Catálogo de fichas de la tienda de sobres: la tarjeta de lista sigue diciendo «Gratis» para el Sobre Inicial; la ficha
   y el servidor ya dicen la verdad.

## 129. Worker/infra
Sin tocar el worker de Pick'ems, cron, el importador VLR, Caddy, Cloudflare, Kong, Auth, Storage, Realtime, firewall ni
SSH. Sin Docker local, sin deploy, sin commit y sin push.

## 130. GO / NO-GO
**GO.**
- Sobre Inicial no infinito tras la plantilla: 409 en real y máx. 2 simulado.
- 100 % de cuentas nuevas con plantilla y 0 atrapadas.
- Starter y recompensas no duplicables: fuzzer 0 violaciones.
- Saldo nunca negativo.
- El cliente no elige recompensa, importe ni precio.
- Los reintentos no imprimen y los GET no conceden.
- Draft sin economía, serial sin valor, Colección sin venta, mercado OFF.
- 0 fuentes sin tope en 1.000.000 de trayectorias.
- Libro mayor real reconciliado (única discrepancia explicada).
- Tests y build en verde.
