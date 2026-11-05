# FASE 39 — DRAFT GAUNTLET 1.0 · «CONSTRUYE. ADÁPTATE. SOBREVIVE.»

Fecha de cierre: 2026-09-16. Contrato: `docs/product/draft-gauntlet-contract.md`. Migración:
`docs/product/fase-39-migration-0053-draft-gauntlet.md`. QA: `docs/product/qa/fase39/README.md`.

> La fase se construyó en dos sesiones. La primera (2026-09-15) hizo dominio, servicio, API, UI, 0053 (aplicada en el
> VPS con backup y ensayo), tests, verificador e instrumentos. La segunda (2026-09-16) revisó todo, ejecutó por
> primera vez la QA visual y la E2E real, encontró y corrigió 2 fallos de UX, añadió la observación de balance de
> plantillas, re-verificó backup y probes de BD, corrió los gates y escribió esta documentación.

## 1. Estado inicial
Baseline declarado 2617/2617 (Fase 38 GO). Al retomar: código de la fase presente sin documentar ni probar en real;
0053 aplicada en el VPS (0 filas en `draft_runs`); sin `docs/product/qa/fase39/`. `npm test` = 2800/2800 al retomar.

## 2. Arquitectura encontrada
`/jugar` (GameModesHub) → modos; PvE canónico = `services/duels.ts` (`launchPve`, único camino para rápida y campaña),
orquestador `duel-turns-2`, reglas `duel-combat-2`, bots `createDuelBot` EASY/NORMAL/HARD (0/0,5/0,85), mazo validado
por `validateDuelDeck` sobre `OwnedCard` (instancias de `user_cards`), `duel_matches.mode ∈ PVE/PVP/PVP_PRIVATE` con
CHECK. Campaña (0051) = contexto sobre el PvE; vista redactada `toPublicView`; pago por partida `awardMatchOutcome`.
Misiones/eventos/vestíbulo contaban `duel_matches` sin filtrar modo.

## 3. Invariantes de deck confirmados
Código, no brief (`src/domain/cardgame/deck.ts`, `DUEL_COMPOSITION`): 10 cartas; 2 Duelista, 2 Controlador,
2 Iniciador, 2 Centinela, 2 Flex (Flex es rol real); sin carta repetida; sin jugador repetido (variantes cuentan como el
mismo jugador); una sola `dataVersion`. Pins D09, D23, D25, K16.

## 4. Nombre/identidad del modo
Nombre único **DRAFT GAUNTLET**, lema «Construye. Adáptate. Sobrevive.». `rules_version = draft-gauntlet-1`,
`duel_matches.mode = DRAFT_GAUNTLET`. Rivales «NEXUS Challenger / Contender / Vanguard / Elite / Apex».

## 5. Modelo de Run
`draft_runs`: id, user_id, status, stage, version (optimista), seed, rules_version, data_version, state jsonb
(`roleOrder`, `picks`, `offers`, `rivals`, `actions`), current_match_id, created/updated/completed_at.
`draft_run_matches`: (run_id, stage) → match_id, difficulty, status, result, marcador.

## 6. Estados de Run
`DRAFTING → READY → IN_MATCH → READY(stage+1) … → COMPLETED`; `IN_MATCH → FAILED` (derrota/empate); cualquier activo
→ `ABANDONED`. Activos únicos por usuario. Tabla en el contrato §3.

## 7. Persistencia
Servidor (PostgreSQL). Nada de autoridad en React/`localStorage`. Todas las ofertas mostradas quedan en `state.offers`.

## 8. Migración 0053 sí/no
**Sí.** `supabase/migrations/0053_draft_gauntlet.sql` (número real siguiente: 0052 era la última). Aplicada.

## 9. Schema
Dos tablas + 2 CHECK de `duel_matches` ampliados. Índice único parcial de run activa, PK por etapa, `match_id` único con
`on delete set null`, jsonb objeto ≤ 32 KB, seed 32 bits, `completed_at ⇔ final`, `current_match_id ⇒ IN_MATCH`.

## 10. RLS
Activada en ambas tablas, **sin políticas**. Probado con rol `authenticated` + claims del propio dueño: permission
denied en SELECT/INSERT/UPDATE; `anon` igual.

## 11. Grants
`REVOKE ALL` a `anon`/`authenticated`; `GRANT ALL` a `service_role`. Sin funciones ni `SECURITY DEFINER`.

## 12. Server authority
El servidor decide semilla, orden de roles, ofertas, legalidad, cierre del draft, validación, rivales, lanzamiento,
resultado (leído de `duel_matches`) y progresión. El cliente envía `action`, `actionId`, `expectedVersion`, `choiceId`,
`confirm`.

## 13. Seed
`crypto.randomInt(0, 2^32)` en `startDraftRun`; columna `seed`; nunca en la foto (D46, S44).

## 14. Determinismo
Generación pura con RNG serializable y FNV-1a: `(seed)` → orden; `(seed, pick, picks)` → oferta; `(seed, stage)` →
rival. Ofertas y rivales además **persistidos**: recargar/reintentar no regenera (S15, S50, D36, D37).

## 15. Estructura del Draft
10 × «elige 1 de 3».

## 16. Orden de roles
Fisher-Yates de `[D,D,C,C,I,I,S,S,F,F]` por semilla; exactamente 2 por rol; 9.570 órdenes distintos en 10.000 runs.

## 17. Generación de opciones
3 cartas del rol del hueco, jugadores distintos, sin cartas ni jugadores ya elegidos, equipos distintos cuando se puede,
uniforme (sin rareza ponderada ni pity), sin etiquetas de veredicto.

## 18. Elegibilidad
Carta con `combat`, jugador real con rol de duelo, `dataVersion` de la run (la más común: `VCT-2026`) y ciclo de vida
`PUBLISHED` para ofrecerse. Pool actual: **772 cartas** (Duelista 262 / Controlador 179 / Iniciador 171 / Centinela 80 /
Flex 80; 353 jugadores).

## 19. Ownership semantics
No hace falta poseer la carta. Nada entra en `user_cards`, sin serial, sin favoritos/vitrina/equipo permanente. E2E real:
`user_cards` 35 antes y después (hash idéntico).

## 20. Season/version
La run fija `data_version` al crearse; el pool y los rivales salen solo de esa versión; el validador canónico rechaza
mezclas. Las retiradas de esa versión siguen **resolviendo** (una oferta ya persistida no se invalida) pero no se
**ofrecen**. Ciclo de vida de sobres ≠ de cartas: no se usa.

## 21. Diversity
10.000 runs: 9.989 primeras ofertas distintas; 2.000 drafts cubren 772/772 cartas; 9,4 equipos distintos por plantilla
de media (mín. 6); jugador más frecuente en el 6,3 % de las runs.

## 22. Draft UI
`/jugar/draft-gauntlet`: cabecera «DRAFT GAUNTLET · RUN / PICK X/10 / ROL ACTUAL», chips de progreso por rol, 3 cartas
grandes en el centro, plantilla temporal de 10 huecos debajo, vista previa con CONFIRMAR ELECCIÓN anclada al pie.

## 23. Card presentation
Renderer canónico `PlayerCard` dentro de `Card3D` + ficha de texto: jugador, equipo, rol, rareza (variante), OVR,
Stronghold, Gamesense, Entryfrag, «Ver carta». Cara de texto de respaldo si el arte/catálogo cliente falla.

## 24. Compare
Al elegir (vista previa): tabla OVR/Stronghold/Gamesense/Entryfrag de la opción frente a las cartas ya elegidas del
mismo rol. Solo números, sin veredicto.

## 25. Pick UX
Clic/toque o `1/2/3` → vista previa; solo `CONFIRMAR ELECCIÓN` o `Enter` (con vista previa, sin repetición) envía;
`Esc`/Cancelar cierra. Reducer `pickUiReducer` bloquea reenvíos mientras hay uno en vuelo; una oferta nueva cierra la
vista previa.

## 26. Pick API
`POST {action:"pick", actionId, expectedVersion, choiceId}`. Valida: run del token, `DRAFTING`, versión, carta en la
oferta ACTUAL persistida, existe/resuelve, rol del hueco, no elegida, jugador no elegido. Tras la 10.ª: validador
canónico y rivales fijados.

## 27. Idempotencia
`state.actions` (≤ 40): mismo `actionId` → misma respuesta sin segunda escritura (S10, S38). E2E real: triple clic en
confirmar = 1 elección.

## 28. ExpectedVersion
Obligatoria en pick/start_match/abandon (400 si falta). `update … where version = esperada`. Cada mutación +1.

## 29. Concurrencia
Probado en tests con BD en memoria de semántica condicional: 2 start (S06), 2 picks (S11), 2 start_match (S20),
liquidación doble/simultánea (S24, S46), abandon vs pick (S39), abandon vs start_match (S47), abandon con combate en
curso y terminado (S36, S37). En BD real: índice único de run activa y PK de etapa probados en transacción; doble clic en
EMPEZAR = 1 run.

## 30. Stale resync
409 `STALE_VERSION` con `snapshot` fresca; la UI la pinta y avisa «La run cambió en otra pestaña». E2E real: pick con
versión vieja → 409 y BD sin cambios.

## 31. Draft completion
10.ª elección → `READY`, stage 1, rivales fijados; pantalla «PLANTILLA COMPLETA» + mapa. Pick tras completar → 409
`WRONG_STATE`.

## 32. Canonical deck validation
`draftDeckCheck` → `createDuelDeck` + `validateDuelDeck` (canónicos). Sin validador paralelo (contrato K16). 10.000
plantillas simuladas: 0 ilegales. E2E real: la partida se lanzó (el motor re-valida al lanzar).

## 33. Temporary deck adapter
`draftDeckCheck(runId, cardIds)` crea `OwnedCard` en memoria con uids UUID derivados de la run (`draftCardUid`),
sin serial ni `obtainedAt` real, construye el snapshot canónico y lo pasa a `launchPve` con `deckId: null` y
`mode: DRAFT_GAUNTLET`. Nada se inserta en `user_cards` ni `duel_decks`.

## 34. Gauntlet structure
5 combates lineales: 01, 02, 03, 04, FINAL.

## 35. Difficulty
EASY, NORMAL, NORMAL, HARD, HARD con los coeficientes canónicos 0 / 0,5 / 0,85 (D03).

## 36. Opponent generation
`rivalDeckFor`: 2 por rol, jugadores distintos, cartas reales de la banda de OVR de la etapa (percentiles). OVR medio
del rival: 73,0 / 77,3 / 77,3 / 81,1 / 82,0.

## 37. Opponent legality
10.000 mazos rivales (2.000 semillas × 5): 0 ilegales con el validador canónico.

## 38. Opponent determinism
`(seed, stage)` y además persistidos en `state.rivals` al completar el draft (un cambio de catálogo no cambia el rival,
S50). E2E real: mazo B de la partida = rival fijado de la etapa 1.

## 39. PreMatch
Reutiliza la arena canónica `/duelos/jugar?draft=1` con `MatchIntro` (captura real-09). La «pre-partida» de elegir
mazo/rival no aplica (el servidor fija ambos); el mapa del gauntlet cumple ese papel (etapa, rival, dificultad,
plantilla).

## 40. Combat integration
Mismo `launchPve`, `CURRENT_COMBAT_RULES`, eje de defensa impuesto por servidor, 10 turnos, desempate canónico. E2E
real: `rules_version = duel-combat-2`, `orchestratorVersion = duel-turns-2`, 10 turnos persistidos.

## 41. Match mode separation
`mode = DRAFT_GAUNTLET`: sin `awardMatchOutcome`, sin campaña, rating solo `PVP`, contadores de progresión/loop/eventos
con `.neq`, la partida rápida no la retoma ni la abandona (K20–K24; E2E: `/api/game/duel active` no devuelve el combate).

## 42. Match start idempotency
`start_match` repetido (READY o IN_MATCH) devuelve el mismo `matchId`. E2E real en etapas 1 y 2; 1 sola partida.

## 43. Win settlement
`playTurn` al cerrar llama a `settleDraftMatch` con los hechos del motor; la lectura reconcilia si el gancho falló.
Combate `SETTLED WIN` + run `READY stage+1`. E2E real: 6-4 → READY en la etapa 2.

## 44. Loss settlement
`SETTLED LOSS` + run `FAILED` con `completed_at` (S25).

## 45. Draw settlement
Empate canónico = `FAILED` («En el gauntlet solo avanza quien gana»; banner «EMPATE · RUN TERMINADA») (S26).

## 46. Active match recovery
E2E real: recarga con el combate 02 abierto → misma partida y turnos; el gauntlet muestra «Retomar combate».
Reclamación sin partida > 2 min → vuelve a READY (S31); partida desaparecida → FAILED (S32).

## 47. Completed Run
5 victorias → `COMPLETED` (S27); resumen «GAUNTLET SUPERADO», 5/5, plantilla y marcadores en el mapa. Sin recompensa.

## 48. Failed Run
«RUN TERMINADA · Llegaste al combate N de 5», mapa con derrota/empate, plantilla.

## 49. Abandon
Botón → confirmación en pantalla (`alertdialog`) → `confirm:true` en la API → `ABANDONED`; si había combate en curso se
borra SU partida y la etapa queda `ABANDONED`; si ya había terminado se liquida primero. E2E real completo.

## 50. New Run
Tras COMPLETED/FAILED/ABANDONED: «NUEVA RUN» con semilla nueva (S08, S48; E2E real tras abandonar).

## 51. History
Últimas 5 runs terminadas (estado, victorias, fecha) + resumen de la última. Sin página propia.

## 52. Game Modes Hub
Tarjeta `DRAFT_GAUNTLET` en `/jugar` con «Construye una plantilla carta a carta y supera cinco rivales.» y estado
(Nueva run · Draft X/10 con «Continuar draft» · Combate X/5 con «Continuar run» · EN PARTIDA con «Retomar combate» ·
«Última run: completada»; «No disponible» si falta 0053). Sin entrada nueva en la navegación (K35). E2E real.

## 53. Daily Loop/Home
**Sin cambios de prioridad**: el vestíbulo no propone el draft. Sus contadores excluyen `DRAFT_GAUNTLET`.
«Continuar run» en el vestíbulo queda como P2 opcional (el brief lo permitía, no lo exigía).

## 54. Collection integration
«Ver carta» → `/coleccion/carta/[id]`. La colección no cambia (favoritos 0 → 0, `user_cards` idéntico).

## 55. Card Detail
La ficha muestra NO CONSEGUIDA si no la posees; el draft no altera eso; favoritos siguen siendo por definición.

## 56. Serials
No existen: ni en la foto, ni en la UI, ni en el snapshot de la partida (E2E: 0 seriales en `snapshotA`).

## 57. Run versioning
`rules_version` + `data_version` por run; la partida guarda `duel-combat-2` / `duel-turns-2`.

## 58. Catalog stability
Ofertas y rivales persistidos por id; las cartas retiradas después siguen resolviendo en su run (D13, D37, S50).

## 59. Security
Ajena → invisible e intocable (S41, S42); carta no ofrecida/arbitraria → 409 `INVALID_PICK`; sin campo de semilla,
etapa, estado, rival, resultado, recompensa ni usuario (400); partida de otro modo con el mismo id no liquida (S33).

## 60. API
`GET/POST /api/game/draft-gauntlet`, 4 acciones, cuerpo cerrado ≤ 1 KB, UUID/entero/forma de id validados, usuario del
token, 5xx genérico.

## 61. Rate limit
Cubetas propias `draft_read` y `draft_write`.

## 62. Hidden information
La foto no lleva semilla, ofertas futuras ni rivales; la arena usa la misma vista redactada que PvE (sin mano rival).
E2E real: la respuesta de estado no contiene `snapshotB`.

## 63. Replay
Reutiliza `/duelos/replay/[id]` sobre turnos persistidos (la vista `toDraftView` es la redactada PvE sin recompensa).
No se re-ejecuta.

## 64. Ranked isolation
Rating solo `PVP`. E2E: huella `rating` idéntica.

## 65. Campaign isolation
Campaña solo `PVE` y el draft liquida su run. E2E: `campaign` idéntica (1 progreso, 3 intentos).

## 66. Economy isolation
0 créditos, 0 sobres, 0 cartas, 0 XP, 0 XP de pase, 0 rating. E2E: `credit_tx` 7→7, `user_game` idéntico,
`pass_xp` 0, `pass_economy` idéntica, `achievements` 0.

## 67. Pack Objective isolation
`user_game.packs_opened` (dentro de `user_game`) idéntico; el draft no toca sobres ni odds.

## 68. Offline
Última foto recibida en memoria; start/pick/start_match/abandon desactivados; aviso «SIN CONEXIÓN»; nada en el navegador.

## 69. Error isolation
Arte → cara de texto; hub: la tarjeta del draft falla sola; historial/última run no bloquean la run activa; 0053 ausente →
«todavía no disponible» sin romper `/jugar`.

## 70. Recovery
Recarga en pick 2 (real), pick 10/pre-partida (tests), combate activo (real), entre etapas (real, etapa 2), fallida/
completada (tests + arnés).

## 71. Visual identity
Sala táctica oscura con acento dorado, tres cartas grandes, chips de rol y plantilla construyéndose; distinta de la sala
de colección y de la ceremonia de sobres. Sin dashboard de KPIs.

## 72. Gauntlet map
5 nodos 01–04/FINAL con estados Superado / Siguiente / En combate / Bloqueado / Derrota / Empate / Abandonado, marcador y
`aria-current`. Columna en móvil.

## 73. Responsive
1440: 3 cartas; 1024 y 768: 3 columnas; 390: carrusel horizontal con snap y la carta seleccionada centrada. 0
desbordamientos en 151 capturas.

## 74. Accessibility
Opciones como botones con nombre, equipo, rol y OVR en la etiqueta; texto además de color; teclado 1/2/3/Enter/Esc;
`alertdialog` en abandono; `aria-live` en avisos; 0 controles < 44 px en la sala.

## 75. Reduced motion
`MotionConfig reducedMotion="user"`: sin entradas animadas ni tilt; 30 capturas con `reduce`.

## 76. Performance
Máximo 3 `Card3D` (las opciones); plantilla con miniaturas estáticas `CardThumb`. Medido: ≤ 3 en todas las capturas.

## 77. Content integrity
`draft-gauntlet-content:verify`: versión `VCT-2026`, cada carta del pool existe, con combate, jugador real del rol, una
sola versión, stats sin modificar; 500 drafts solo ofrecen cartas reales.

## 78. 10k run solvability
10.000 runs con elecciones aleatorias: **0 callejones**, 0 plantillas ilegales, 0 ofertas con < 3 opciones.

## 79. 10k opponent legality
10.000 rivales: **0 ilegales**, todos 10 cartas y 2 por rol.

## 80. Determinism verifier
1.000 semillas: misma semilla + mismas elecciones → misma run y mismos rivales; reanudar desde el jsonb persistido =
continuar en memoria (300).

## 81. Balance observations (sin ajustes)
- Plantilla (10.000): OVR medio 76,6 (mín 68,9 · p50 76,7 · máx 85,8).
- Rareza de las elegidas: silver 22,6 % · bronze 18,9 % · regionales ~12 % c/u · gold 7,0 % · especiales < 1 %.
- Regiones equilibradas (China 25,9 · Pacific 25,8 · EMEA 24,4 · Americas 23,9 %).
- Tasa de victoria con el jugador simulado como bot NORMAL y elecciones aleatorias (300 runs): etapa 1 95,3 %,
  2 37,7 %, 3 43,7 %, 4 3,0 %, 5 4,0 %, 0 empates. **Observación P2:** las etapas HARD son un muro para un jugador
  «medio»; un humano que elige y juega bien debería rendir más, pero hay que medirlo con datos reales antes de tocar
  nada. No se ajustó.

## 82. Migration preflight
Ausencia de tablas, presencia de 0051/0052, CHECK previo, huella de recuentos/constraints/tablas (91). Ver doc de la
migración.

## 83. Backup
`pre-0053/supabase-drlcards-pre0053-20260915T222534Z.dump`, 2.191.205 bytes, sha256 `03749239…021d71c5d6`,
re-verificado hoy (sha256 coincide, `pg_restore -l` 1.807 entradas, 0 objetos `draft_run*`).

## 84. Rehearsal
`BEGIN → 0053 → probes → ROLLBACK` (sesión 1). Hoy se repitió la batería de probes contra el esquema aplicado dentro de
`BEGIN … ROLLBACK`, con roles reales: 24/24 OK.

## 85. Migration apply
2026-09-15 22:26Z, una transacción, `ON_ERROR_STOP`, sin registrar en `schema_migrations`, sin reinicios.

## 86. Migration postflight
Tablas, RLS, 0 políticas, grants, 6 índices, CHECKs nuevos; 93 tablas públicas. Re-ejecutado hoy
(`qa/fase39/db/postflight-2026-09-16.txt`).

## 87. Real QA pre-fingerprint
`user_cards` 35 · `credit_tx` 7 · `achievements` 0 · `campaign` 1:3 · `pve_matches` 2 · `favorites` 0 + md5 de
`user_game`, `profile`, `user_pass`, `rating`, `decks`.

## 88. Real Draft E2E
Login por formulario → `/jugar` → tarjeta → portada → EMPEZAR (doble clic: 1 run) → draft → plantilla completa →
combate → resultado → mapa. 84/85 en la primera pasada (ver §95) + 33/33 en recuperación y abandono.

## 89. Real 10 picks
10 elecciones reales alternando teclado y ratón; en cada una: oferta en pantalla = oferta persistida, vista previa sin
escribir, +1 versión y +1 carta exacta. Elecciones UI = `state.picks` en BD.

## 90. Real deck validation
READY con 10 cartas; la partida se lanzó con esas 10 (mazo A = elecciones), lo que exige pasar el validador canónico.

## 91. Real match E2E
Combate 01 EASY contra NEXUS Challenger, 10 turnos jugados por la interfaz (0 por API), motor canónico, sin manipular.

## 92. Real settlement
Resultado del motor **WIN 6-4** → `draft_run_matches` SETTLED/WIN/6/4 con el `match_id` correcto → run READY etapa 2 →
mapa `WON,CURRENT,LOCKED,LOCKED,LOCKED`.

## 93. Real refresh
Recarga en el pick 2 (mismas opciones, misma versión) y en pleno combate 02 (misma partida y turnos).

## 94. Real double-click
Doble clic en EMPEZAR = 1 run; triple clic en CONFIRMAR = 1 elección; 409 STALE real con versión vieja.

## 95. Real economy fingerprint
Primera pasada: todo idéntico salvo el md5 de la fila completa de `user_pass`. Causa medida: rotación diaria de misiones
al leer, a las 08:26:21.7Z, al cargar `/jugar` por primera vez en el día, **antes** de cualquier acción del draft (deuda
conocida). `xp: 0`, nada reclamado, `missionsCompleted: 0`, base `duels_played = 2` = partidas PVE (el draft no cuenta).
Se separó la huella en `pass_economy` + `pass_xp`; segunda pasada (etapa 2 + recarga + abandono): **todo idéntico**.

## 96. Visual QA
173 escenas: 151 sintéticas (1440/1024/390 + 768 + apaisado, 30 con movimiento reducido, 7 de interacción) + 22 reales.
0 desbordamientos, 0 errores de consola, ≤ 3 Card3D, 0 controles < 44 px.

## 97. Tests nuevos
**2801** (baseline 2617 → **+184**): dominio 53, servicio 50, contrato 36, render 22, presentación 15, adaptador 8;
además aserciones nuevas en `experience.test.ts`. Matriz de 100 casos cubierta (ver anexo A).

## 98. Verifiers
`draft-gauntlet:verify` (todo), `draft-gauntlet-security:verify`, `draft-gauntlet-economy:verify`,
`draft-gauntlet-content:verify`, `draft-gauntlet-solvability:verify` (`scripts/draft-gauntlet-verify.ts`).

## 99. Gates finales
Con el túnel y la app locales CERRADOS (54521/3005 rechazan), en una sola tanda registrada:

| Gate | Resultado |
|---|---|
| `npm test` | **2801 / 2801** |
| `tsc` web + scripts (`npm run typecheck`) | exit 0 (re-ejecutado tras el último cambio del verificador) |
| `next build` | exit 0 |
| ESLint (ficheros de la fase, `ESLINT_USE_FLAT_CONFIG=false`) | exit 0 (*) |
| security, pack, content, distribution, importer-vlr (69/69), combat, deck, social, replay, competitive | todos ✓ |
| season, season-time, season-pass, season-security, season-recap | todos ✓ |
| campaign, campaign-security, campaign-economy, campaign-content | todos ✓ |
| daily-loop, daily-loop-priority, daily-loop-security | todos ✓ |
| pack-objective, pack-objective-rebase, pack-objective-security | todos ✓ |
| collection, collection-room, collection-content, collection-security, collection-performance | todos ✓ |
| pack-opening, pack-opening-presentation, pack-opening-security | todos ✓ |
| draft-gauntlet (64), -security (15), -economy (21), -content (14), -solvability (14) | todos ✓, 0 fallos |

(*) En la tanda, ESLint dio exit 1 porque coincidió con una edición a medias de `draft-gauntlet-verify.ts` (literal
sin cerrar, corregido al momento); re-ejecutado sobre los mismos ficheros: exit 0. Algunos verificadores anteriores
declaran «RLS reales: NO EJECUTADO — requiere BD de pruebas aislada» (preexistente); para 0053 las sondas RLS/grants
reales se hicieron en el VPS con ROLLBACK (§84).

## 100. Bugs encontrados
1. **Vista previa/CONFIRMAR ELECCIÓN cortada al pie** (1440×900 y otros): era `sticky`, que en DRLCards no se pega
   (`overflow-x:hidden` en html/body).
2. **Final de combate del draft decía «Recompensa no disponible.»**, que sugiere un fallo; el modo no da recompensa por
   diseño.
3. Instrumento: la QA visual contaba como errores los 404 de fotos de jugador ausentes (fallback canónico).
4. Instrumento: la huella E2E mezclaba economía del pase con la rotación diaria de misiones.
5. Verificador: faltaba la observación de balance de plantillas (OVR/rareza/equipos/regiones/jugadores) del PASO 93.

## 101. Bugs corregidos
Los 5. (1) pie `fixed` sobre la barra móvil + hueco, test R22; (2) `MatchMode` acepta `DRAFT_GAUNTLET`,
`rewardPresentation` → «Draft Gauntlet no da créditos, sobres ni XP en esta versión.», `ResultScreen` recibe `mode`,
test; (3) 404 de recurso contados aparte; (4) huella dividida; (5) bloque de observación añadido (con un check real de
degeneración: ningún jugador > 25 % de las runs).

## 102. Archivos creados
`supabase/migrations/0053_draft_gauntlet.sql` · `src/domain/draft/{rules,generate,run,snapshot}.ts` + `draft.test.ts` ·
`src/server/services/draftGauntlet.ts` + `draftGauntlet.service.test.ts`, `draftGauntlet.contract.test.ts`,
`draftDuels.test.ts` · `src/app/api/game/draft-gauntlet/route.ts` · `src/app/jugar/draft-gauntlet/page.tsx` ·
`src/lib/draft/{client,presentation}.ts` + `presentation.test.ts` ·
`src/components/draft/{DraftGauntletScreen,DraftCards,GauntletMap,DraftResultBanner}.tsx` + `draftScreen.render.test.tsx` ·
`src/app/design-system/fase39/{page.tsx,fixtures.ts}` · `scripts/draft-gauntlet-verify.ts` ·
`scripts/_fase39-{visual-qa,real-e2e,real-recovery}.ts` · `docs/product/draft-gauntlet-contract.md` ·
`docs/product/fase-39-migration-0053-draft-gauntlet.md` · este informe · `docs/product/qa/fase39/**`.

## 103. Archivos modificados
`src/server/services/duels.ts` (adaptador, `DRAFT_GAUNTLET_MODE`, `startDraftMatch`, `abandonDraftMatch`,
`toDraftView`, sin pago y liquidación en `playTurn`, exclusión en active/abandon) · `progression.ts`, `loop.ts`,
`events.ts` (`.neq` del modo) · `rateLimit.ts` (cubetas) · `src/app/jugar/page.tsx`, `components/modes/GameModesHub.tsx`,
`lib/campaign/presentation.ts` (tarjeta del hub) · `src/app/duelos/jugar/page.tsx` (`?draft=1`) ·
`components/duel/ResultScreen.tsx`, `lib/duel/experience.ts` + test (modo draft en el final) · `package.json` (5 scripts) ·
pins relajados a propósito: `campaign.contract.test.ts` (T75/T76/T112/T118), `deckBuilder.contract.test.ts` (≤ 53),
`meta.contract.test.ts`, `scripts/pack-opening-verify.ts` («0053 solo draft»).

## 104. P2 restantes
1. Etapas HARD muy duras según la simulación (3–4 % con jugador NORMAL aleatorio): medir con humanos antes de tocar.
2. «Continuar run» en el vestíbulo (opcional en el brief) no añadido.
3. Rotación diaria de misiones y otras escrituras al leer en meta/vestíbulo (deuda previa, afectó a la huella).
4. `schema_migrations` sin registrar 0026–0053 (prohibido tocar en esta fase).
5. Captura real-12 anterior al ajuste de texto del final (cubierto por test; no se jugó otra run solo para recapturar).
6. Sin telemetría específica del draft (sin migración de telemetría, como pide el brief).
7. Stale real con dos pestañas simultáneas no se hizo con dos navegadores; se probó por API real (versión vieja → 409)
   y en tests (doble confirmación concurrente).

## 105. Marketplace/worker/infra
Marketplace OFF (`GLOBAL_MARKET_ENABLED` intacto). Worker de Pick'ems, cron (1 entrada `run-sync`), importador VLR,
Caddy, Cloudflare, Kong, Auth, Storage, Realtime, firewall y SSH sin tocar; sin reinicios. Sin Docker local, sin deploy,
sin commit, sin push. Túnel y app locales cerrados antes de los gates.

## 106. GO / NO-GO
**GO.**

Draft Gauntlet es jugable de punta a punta con datos reales: 10 elecciones de 3 cartas reales con autoridad de servidor,
plantilla legal por construcción validada por el validador canónico, 5 combates con el motor canónico, liquidación
desde la partida persistida, recuperación, abandono y nueva run. Cero callejones en 10.000 runs, 10.000 rivales legales,
0 economía/rating/campaña/colección en tests y en la huella real, 0053 aplicada con backup verificado, RLS sin fuga
(ni el dueño lee con su token), 173 escenas de QA, 2801/2801 tests y todos los gates en verde.

Ninguna condición NO-GO se cumple: no se crean `user_cards` ni seriales, el cliente no elige carta arbitraria ni
controla semilla/etapa/resultado, recargar no cambia opciones, Flex es rol, no hay jugadores duplicados, no hay otro
motor ni otro validador, no hay fuga del rival, la concurrencia no corrompe la run.

Pendiente (P2, §104): balance de las etapas HARD a medir con humanos; «continuar run» en el vestíbulo; deuda de
escrituras al leer en meta/vestíbulo.

**FASE 39 — CERRADA.** No se empieza la Fase 40.

---

## Anexo A · matriz de 100 casos → evidencia

| # | Caso | Evidencia |
|---|---|---|
| 1–3 | start, una activa, reintento | S04, S05, S06; E2E doble clic |
| 4 | semilla de servidor | S08, K12 |
| 5–6 | orden 2/rol, determinista | D09, D10 |
| 7–13 | 3 opciones, rol, reales, combate, sin duplicado de carta/jugador, misma versión | D11–D20; content verify |
| 14–18 | arbitraria, no ofrecida, run/usuario ajeno, elección inválida | S13, D31–D34, S41, S42, K14 |
| 19–24 | expectedVersion, stale, actionId, doble pick, +versión, recarga | route K13, S09–S12, S15; E2E |
| 25–28 | 10 picks, 10 cartas, 2/rol, validador canónico | S16, S17, D23; E2E |
| 29–32 | sin propiedad, no poseída elegible, sin user_card, sin serial | D24, S40, K29; E2E huella |
| 33–34 | completo, no picar tras completar | S14, D35 |
| 35–38 | etapa 1, mismo combate, rival determinista y legal | S18, S19, D26, D27; E2E |
| 39–41 | Easy / Normal / Hard | D03, S27; E2E (EASY, NORMAL) |
| 42–44 | turnos y resultado canónicos, cliente no envía `won` | K17, K19, S30, K12; E2E |
| 45–48 | gana avanza, pierde/empata falla, no saltar etapa | S23, S25, S26, D40–D42 |
| 49–50 | sin combates concurrentes, recuperación | S20, S31; E2E recuperación |
| 51–53 | final completa, completada/fallida no avanzan | S27, D42, S48 |
| 54–59 | nueva run tras fallar/completar, abandono (+UI), abandonada no pica, nueva tras abandonar | S34–S39, S48, K31; E2E abandono |
| 60–68 | créditos/sobres/packs_opened/cartas/XP/XP pase/rating/campaña/logros +0 | S40, K20–K25, economy verify; E2E huella |
| 69–72 | colección, favoritos, vitrina, equipo permanente sin cambios | K25; E2E huella (`user_cards`, `favorites`, `decks`, `profile`) |
| 73–75 | sin mercado, sin venta rápida, sin texto de recompensa | security/economy verify, R19 |
| 76–83 | cuerpo estricto, tamaño, método, token, anon, rate limit, RLS, grants | K12–K15, K04; E2E 401/400; probes BD |
| 84–85 | sin fuga del rival, replay seguro | D46, S44, K21; E2E vista redactada |
| 86–90 | teclado, movimiento reducido, móvil, arte, offline | presentación P*, K30, K33, R*; arnés |
| 91–94 | 10k runs, 10k rivales, determinismo, diversidad | solvability verify |
| 95–96 | run activa en /jugar, sin inflar navegación | K35; E2E hub |
| 97–100 | vestíbulo, combate, sobres, colección estables | gates §99 |
