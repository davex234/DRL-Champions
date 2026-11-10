# Contrato de economía (Fase 41 · ECONOMY_VERSION 3)

Fuente de verdad en código: `src/domain/economy/catalog.ts` (`economyFlows()`), que **no define importes**, solo
importa las constantes reales. Si este documento y el código discrepan, manda el código, y `npm run economy:verify` falla.

## 1. Invariantes P0 (no negociables)

| # | Invariante | Dónde se garantiza | Cómo se verifica |
|---|---|---|---|
| I1 | El saldo nunca es negativo | `_ledger_apply` (0019): `for update` + «Saldo insuficiente»; `award()` rechaza importes negativos (la RPC `app_grant_reward` no tiene suelo) | fuzzer (100.000 secuencias), matriz P/R, BD real (`negative_credits = 0`) |
| I2 | `profiles.credits` = Σ `credit_transactions.delta` | toda variación de saldo escribe su asiento en la misma transacción | fuzzer, `economy-ledger:verify`, BD real (`credits_ne_ledger = 0`) |
| I3 | Una clave de idempotencia paga una vez | `credit_tx_ref_uniq (user_id, ref)` + `economy_ops.ref` PK | matriz P/R/V, `economy-idempotency:verify` |
| I4 | El cliente no elige importe, carta, rareza, precio ni recompensa | cuerpos cerrados (`/api/game/packs` solo `action, packId, ref`; `/api/game/credits` rechaza campos económicos); precios del catálogo del servidor | `economy-security:verify` |
| I5 | Ninguna fuente viva es infinita sin tope | tope diario PvE (20), misiones una vez por tanda, Sobre Inicial gratis solo como asistencia, tienda de prueba cerrada | simulador (techo diario recurrente), fuzzer |
| I6 | Un GET no concede ni escribe economía | lecturas puras (`readStarterStatus`, `peekProgression`, competitivo sin `ensureRating`/`getProgression`) | matriz G, QA real (huella sin cambios) |
| I7 | El serial no tiene valor económico | reciclaje por rareza, nunca por serie; sin «valor de colección» ni venta en Colección | `economy-security:verify` |
| I8 | Draft Gauntlet y PvP no dan créditos | sin `award` en sus flujos | `economy-security:verify`, catálogo |
| I9 | El histórico no se reescribe | sin migración ni UPDATE de asientos; el tope del starter cuenta concesiones pasadas | revisión + QA real |
| I10 | Mercado global cerrado | `GLOBAL_MARKET_ENABLED = false` intacto | `economy-security:verify` |

## 2. Mapa de flujos

| Flujo | Clase | Importe (créditos) | Repetición | Tope | Idempotencia |
|---|---|---|---|---|---|
| Alta (trigger) | SOURCE | 6.000 + 3 Iniciales + 1 Estándar | una vez | — | `starter:<uid>` |
| **Sobre Inicial gratis (asistencia)** | SOURCE | 0 (sobre) | solo sin plantilla posible | 0 sin abrir · ≤ 8 en la vida | `pack:buy:<uid>:starter-assist-<n>` |
| Duelo PvE | SOURCE | 25–350 (tabla resultado × dificultad) | por partida | 20 pagadas / día UTC | `duel:<matchId>` |
| Campaña (primera victoria) | SOURCE | 50/100/200 (total 1.350 ≤ 1.500) | una vez por nodo | — | `campaign:<c>:<node>` |
| **Misiones diarias** (3/día) | SOURCE | 200–400 + XP pase | **una vez por tanda** | ventana diaria | `mission:<s>:<id>:<assignedAt>:<baseline>` |
| **Misiones semanales** (2/semana) | SOURCE | 1.200–1.800 + XP pase | **una vez por tanda** | ventana semanal | ídem |
| Misiones de temporada / hitos | SOURCE | 500–5.000 o sobres | una vez | — | ídem |
| Pase · libre | SOURCE | 15.900 + 6 sobres (30 niveles) | una vez por nivel | — | `pass:<s>:free:<l>` |
| Pase · competitivo (Oro) | SOURCE | 26.000 + 6 Premium | una vez por nivel | — | `pass:<s>:competitive:<l>` |
| Logros | SOURCE | 2.500–25.000 (total 67.500) | una vez | — | `achievement:<id>` |
| Pick'em (escalón) | SOURCE | 500–6.000 + sobres | por evento | ≤ 11.000 si se recorrige subiendo (P2) | `pickem:<ev>:<tier>` |
| Desafíos de evento | SOURCE | 500–1.500 | una vez por evento | — | `event:<ev>:<ch>` |
| Reciclaje de duplicadas | SOURCE | 30/70/200/600/1.600 | por copia sobrante | EV < precio de todo sobre de pago | `salvage:<uid>:<g>` |
| **Tienda de créditos de prueba** | SOURCE | 1.000–28.000 | — | **CERRADA** salvo `NEXUS_SANDBOX_CREDITS=1` | `drlc:<uid>:<ref>` |
| Compra de sobre | SINK | −750 … −20.000 | por compra | saldo | `pack:buy:<uid>:<g>` |
| Prestigio | SINK | −15.000 / −40.000 / −100.000 | una vez por escalón | requisito | **`prestige:<uid>:<base>:<tier>`** |
| Mercado (5 % comisión) | TRANSFER | — | — | DESACTIVADO | — |
| Apertura de sobre | NON_ECONOMIC | 0 (XP 18–138 por carta) | por sobre poseído | — | `pack:open:<uid>:<g>` |
| Draft Gauntlet / PvP | NON_ECONOMIC | 0 | — | — | — |

## 3. Starter: asistencia de primer equipo

- **Elegibilidad (servidor):** plantilla NO posible con las cartas propias (`deckReadiness`) **y** 0 Sobres Iniciales sin
  abrir **y** < 8 concesiones gratuitas históricas (asientos `buy_pack:inicial`). Motivos: `DECK_READY`,
  `HAS_UNOPENED_STARTER`, `CLAIM_CAP`.
- **Concesión:** `POST /api/game/packs {buy|buy_and_open, inicial}`; la clave es la N-ésima concesión, así que dos
  peticiones simultáneas solo conceden una. Un reintento de `buy_and_open` con el mismo gesto devuelve la apertura guardada.
- **Asistencia de rol:** mientras no haya plantilla posible, los **2 primeros huecos** de cada Sobre Inicial se sortean
  solo entre jugadores nuevos de roles que faltan (`openPack` con `assist`), con los **mismos pesos de rareza**. Sin
  plantilla posible no hay asistencia; ningún otro sobre la tiene.
- **Estado:** `GET /api/game/starter` (solo lectura). La ficha `/packs/inicial` no ofrece «gratis» si el servidor dice que no.
- **Sin retroactividad:** los Sobres Iniciales ya poseídos se abren siempre; nada se retira.
- **Objetivo medido (100.000 cuentas, motor real):** aperturas de starter P50 4 · P90 5 · P99 5 · máx 6; 100 % con
  plantilla; 0 atrapadas por el tope (`docs/product/qa/fase41/starter-simulation.json`).

## 4. Progresión

- **Misiones periódicas:** «repetible» = vuelve en otra rotación. Dentro de una tanda se cobra una vez (`claimed`).
  «Actualizar misiones» solo asigna si no hay ninguna y rota los tipos con la ventana vencida (igual que la lectura).
- **Pase:** `user_pass.state` se escribe con concurrencia optimista (`updated_at` leído). Si otra escritura ganó, el
  reclamo responde 409 «vuelve a intentarlo»; el pago ya era idempotente y la XP nunca se suma dos veces.
- **XP de cuenta** (`profiles.xp`, sobres + partidas + recompensas) y **XP del pase** (solo misiones) siguen separadas.

## 5. Seguridad

- Tienda de créditos de prueba: conceder exige `NEXUS_SANDBOX_CREDITS=1` en el servidor (entornos de prueba). La
  devolución sigue abierta (solo resta). `GET /api/game/credits` declara `purchasesOpen`.
- Prestigio: clave con usuario (`economy_ops.ref` es global y `app_buy_cosmetic` la busca sin filtrar por usuario).
- `award()` rechaza créditos, XP o sobres negativos antes de la RPC.
- `GET /api/game/competitive` (snapshot y posición): lectura pura; sin ficha de rating se enseña 1.000 sin crearla.

## 6. Deuda documentada (no bloqueante)

- **P2 · Pick'em acumulable al recorregir:** si un evento se corrige varias veces subiendo de escalón, se pagan los
  escalones intermedios (≤ 11.000 por evento frente a 6.000 del contrato «el más alto»). Acotado por eventos reales; el
  worker de Pick'ems no se toca en esta fase.
- **P2 · `/api/game/meta` y `/api/game/loop` (GET) siguen asentando misiones/rating al leer** (sin créditos ni XP).
  El vestíbulo (`/api/game/daily-loop`), la temporada y el competitivo ya son lecturas puras.
- **P2 · Carrera del tope PvE:** el recuento de partidas pagadas no es atómico; el desbordamiento está acotado por una
  partida PvE activa por jugador y por la duración de una partida (10 turnos).
- **Observación de diseño (no es agujero):** el ritmo del pase y de la colección es rápido para REGULAR/ENGAGED
  (ver `economy-simulation.md`); cambiar importes a ojo está prohibido en esta fase.
