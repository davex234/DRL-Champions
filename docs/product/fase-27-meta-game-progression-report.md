# FASE 27 — META GAME 2.0 · Progresión + Objetivos + Temporada + Recompensas

**Estado:** completada (con P2 documentados) · **Fecha:** 2026-09-14 · **Rama:** `arch/stabilization` · **Sin commit/push/deploy** · **Sin VPS, cron, Docker, producción** · **Economía, XP, recompensas, sobres, motor de duelo, PvP, Pick'ems, colección, Marketplace (OFF) y worker esports INTACTOS** · **Migración local creada, NO aplicada**.

> Regla de la fase: el servidor decide (XP, nivel, misión completada, logro, recompensa, créditos,
> sobre, reclamo, progreso persistido); el cliente presenta. Todo lo nuevo es un MODELO DE LECTURA
> (`MetaSnapshot`) y presentación sobre los sistemas que ya existían. Ni una recompensa inventada.

## 1. Estado inicial

- **XP/nivel de cuenta**: `profiles.xp` (escriben solo `app_grant_reward` y `app_apply_pack_open`,
  `security definer`, trigger que bloquea escrituras de `authenticated`); nivel derivado con
  `levelFromXp` (curva `100·(l−1)^1.6`). `profiles.level` existe pero nadie la escribe. Sin recompensa
  por nivel de cuenta, sin «último nivel» persistido.
- **Pase de temporada** (`@/battlepass` + `data/season.ts`): `nexus-s1 · Temporada 1 · Ascenso`, 30
  niveles lineales (1.000 XP de pase), carriles libre (15.900 créditos + 6 sobres), competitivo (26.000
  + 6, se abre en Oro = 400 puntos) y de aspecto (solo cosmética). Estado en `user_pass.state` (jsonb).
  Reclamo MANUAL por nivel (`claimLevel`, ref `pass:<season>:<track>:<level>`). **Sin fechas**: solo
  `durationDays: 84`; la tabla `seasons` no la lee nadie.
- **Misiones**: 14 en el pool (4 diarias, 4 semanales, 3 de temporada, 3 hitos) medidas sobre métricas
  reales (`packs_opened`, `duels_played/won`, `distinct_cards`, `decks_saved`, `region_set`,
  `picks_made`, `points`). Sorteo 3+2 en servidor con semilla `crypto`. **Sin rotación por tiempo**:
  una vez asignadas se quedaban. Reclamo manual (`claimMission`) con `ref` que incluía `Date.now()`
  (no idempotente ante reintento).
- **Logros**: 7 en `ACHIEVEMENTS` (67.500 créditos), reclamo manual, PK `(user_id, achievement_id)`
  + `ref achievement:<id>`. **Solo 3 de 7 tenían progreso en servidor**: `primer-mvp`, `primer-icon`,
  `completa-heretics`, `completa-emea` devolvían 0 → inreclamables.
- **Libro mayor**: `credit_transactions(delta, reason, ref, balance_after, created_at)` con índice
  único `(user_id, ref)`. Reasons: `starter_grant`, `buy_pack:*`, `duel_*`, `duel_capped_*`,
  `pickem_reward:*`, `pass_reward`, `mission_reward`, `achievement`, `event_challenge:*`. `isReward`
  de Pick'ems solo reconocía `pickem_reward` y `starter_grant`.
- **Pantallas**: `/progresion` (nivel + «cómo ganar XP» + 3 enlaces, solo lectura, con test que lo
  exige), `/logros` (pase + misiones + logros con reclamo), `/recompensas` (libro mayor). Home con
  `LoopStrip` (Fase 25) y `NextUp` (pasos del servidor: `getLoop`). Sin toasts globales.
- **Pick'ems**: «N predicciones pendientes» ya se calcula en servidor (`loop.circuit.pendingPicks`).
- **Rating PvP** (`duel_pvp_ratings`, Elo en Postgres) y rango por puntos (`RANKS`: bronce…nexus).
- **Telemetría**: taxonomía cerrada (4 eventos, 4 flujos, CHECK 0029); `/progresion` cae en `other`.
- **Métrica «cartas distintas»** contaba EJEMPLARES (dos copias sumaban 2).

## 2. Sistemas reutilizados

`levelFromXp`/`totalXpForLevel`, `@/battlepass` (`PassEngine.refreshMissions`, `completeMission`,
`trackOf`), `CURRENT_SEASON`, `ACHIEVEMENTS` (+ su `progress(ctx)`), `services/progression`
(`getProgression`, claims), `services/loop` (`getLoop`), `services/rewards` (`award/awardMany` →
`app_grant_reward`), `credit_transactions`, `duelsRating.getRating`, `listDecks`, `describeLedger`/
`packLabel`, `RankBadge`, `PassRail.describeReward`, `Meter`/`Badge`/`Readout`/`Surface`, `NextUp`,
`LoopStrip`, `ResultScreen` (hueco), `PackOpeningExperience` (dos lecturas), `useToast` (no hacía
falta: avisos propios), `scripts/lib/cdp.ts`, patrón de arnés QA.

## 3. Qué se construyó

| Pieza | Fichero | Qué hace |
|---|---|---|
| Ventanas | `src/domain/progression/periods.ts` | `periodWindow` (día UTC / semana ISO), `rotationDue`, `expiresAt`, `remainingLabel`; reloj siempre inyectado |
| Modelo de lectura | `src/domain/progression/meta.ts` | `accountLevel`, `levelsGained`, objetivos (estado, orden, `objectiveDeltas`, `summarizeDeltas`), logros (categoría derivada, estado, secretos=no), recompensas (`describeReward` por `reason`/`ref`, `rewardHistory`), `todayActions` (prioridad pura), `continueCta`, `ftueState`, `progressEvents` (identidad estable) |
| Snapshot | `src/server/services/meta.ts` + `GET /api/game/meta` | UNA lectura agregada: cuenta, nivel, pase, objetivos, bucle (pase ya leído), libro mayor, sobres, mazos, duelos, rating, FTUE, temporada. Solo lectura |
| Rotación | `services/progression.ts` | diaria/semanal evaluada AL LEER con `Date.now()` del servidor (`rotateMissionsFor`); `expiresAt`/`assignedAt`/`metric`/`packId` en la vista; `serverNow` |
| Logros en servidor | `services/progression.ts` | `loadFacts` trae `user_cards.card_id`; `serverProgressFor(def, ctx)` = `def.progress(ctx)` para los 7; `claimedAt` |
| Idempotencia de misión | `services/progression.ts` | ref `mission:<season>:<id>:<assignedAt>:<baseline>` (determinista) |
| Bucle | `services/loop.ts` | paso `objective` («Continúa tu objetivo», prioridad 3,5), `progression {activeObjectives, claimable}`, reutiliza el pase ya leído |
| Cliente | `src/lib/progression/meta.ts` | `fetchMetaSnapshot`, `diffSnapshots`, `useProgressionDelta` (antes/después), `takeProgressEvents` (dedup en memoria) |
| Telemetría | `src/lib/progression/telemetry.ts` + `supabase/migrations/0046_telemetry_flows_progression.sql` (NO aplicada) | 7 contextos con puerta `isFlow("progression")` (hoy no-op) |
| Hub | `src/app/progresion/page.tsx` + `components/progression/MetaHub.tsx` | nivel (hero), primera sesión, HOY, objetivos, recorrido gratuito, temporada + competitivo, logros, recompensas recientes, cómo ganar XP |
| Piezas | `LevelHero`, `TodayPanel`, `ObjectiveList`, `FreeTrack`, `SeasonPanel`, `AchievementGrid`, `RewardHistory`, `ProgressAlerts` (+`LevelUpBanner`), `PostMatchProgress`, `FtueSteps`, `CollectionObjectives` | presentación pura sobre el snapshot |
| Home | `LoopStrip` (+`meta`), `src/app/page.tsx` | tarjeta CONTINUAR (`continueCta`) y tarjeta de nivel con objetivos activos / recompensas por recoger / Pick'ems pendientes |
| Post-partida | `duelos/jugar/page.tsx`, `ResultScreen.extra` | lectura antes de `start`, lectura al terminar, `PostMatchProgress` |
| Sobres | `PackOpeningExperience.tsx` | lectura antes de abrir y al llegar al resumen; feedback de objetivos/logros |
| Colección | `coleccion/page.tsx` + `CollectionObjectives` | objetivos y logros de colección evaluados en servidor |
| QA | `design-system/fase27/{page,fixtures}.tsx` + `scripts/_fase27-visual-qa.ts` | 24 escenas QA SYNTHETIC + capturas 1440/1024/390 |
| Tests | `periods.test.ts` (4), `meta.test.ts` (20), `meta.contract.test.ts` (23) | XP/nivel, objetivos, logros, recompensas, integraciones, seguridad, regresión |

## 4. XP / nivel

Fórmula intacta: `totalXpForLevel(l) = round(100·(l−1)^1.6)`. `accountLevel(xp)` envuelve `levelFromXp`
y añade `toNext`/`nextTotal`; `levelsGained(a, b)` detecta saltos de varios niveles entre dos lecturas
del servidor. La cabecera, la home, el hub y el post-partida usan la misma función (test 1/3/13). No
existe recompensa por nivel de cuenta: no se enseña ninguna (test 7).

## 5. Progression Hub (`/progresion`)

Hero (nivel, XP actual/siguiente, barra, XP restante) → primera sesión (solo cuenta nueva) → HOY →
Objetivos (`#objetivos`) → Recorrido gratuito → Temporada + Competitivo → Logros → Lo último ganado
→ Cómo ganar XP. Sin sesión: hero local + `NeedsAccount`. Sin backend: hero + `ErrorState` con
reintento. **Sin ningún botón de reclamar**: el reclamo es manual y vive en `/logros`, adonde enlazan
los estados «Pendiente de recoger» (el test de solo lectura de la Fase 22.1 sigue verde).

## 6. Today

`todayActions`: partida a medias > recompensa pendiente > Pick'em abierto > objetivo casi completo
(≥50 %) > sobre por abrir > equipo incompleto > jugar > circuito; una por tipo; máximo 4. Los pasos
vienen de `getLoop` (servidor); el objetivo casi completo se elige con `nearObjective` (misma regla en
servidor, paso `objective`). Vacío honesto cuando no hay nada.

## 7. Objectives

Las misiones del pase como objetivos: estado **En progreso / Pendiente de recoger / Recompensa
conseguida** (`objectiveStatus`), barra, cifras del servidor, recompensa REAL de la definición
(créditos, sobre, XP de pase), tipo (Diaria/Semanal/De temporada/Hito) y «caduca en …» derivado de
`expiresAt`. Orden: pendientes de recoger, más avanzados, reclamados al final. No hay misiones
falsas: todo sale de `state.missions` persistido en `user_pass`.

## 8. Daily / weekly

Ya existían como tipos sin rotación. Ahora, **al leer** (`getProgression`), el servidor compara el
`assignedAt` de la tanda con la ventana actual (día UTC / semana ISO desde el lunes 00:00Z) usando SU
reloj y, si pertenece a una ventana anterior, sortea de nuevo solo ese tipo (3 diarias / 2 semanales).
Sin cron, sin VPS, sin reloj del cliente. Lo no reclamado de la tanda anterior caduca con ella
(documentado; ver P2). `expiresAt` viaja al cliente, que solo formatea la cuenta atrás.

## 9. Temporada

Datos reales únicamente: nombre e id de `CURRENT_SEASON`, nivel/XP del pase (lineal), objetivos
completados, carril competitivo (abierto por puntos, lo decide el servidor) y «duración prevista 84
días». **Sin fecha de cierre persistida → `endsAt: null` y texto «sin fecha de cierre publicada»**; el
contador local existe y solo se activa si el servidor mandara `endsAt`. No se inventa ningún nombre.

## 10. Free progression track

`FreeTrack`: los 30 niveles del carril libre real (`CURRENT_SEASON.free`) en fila con snap
(escritorio y móvil), estados por autoridad real: **Bloqueado** (nivel no alcanzado) · **Disponible**
(alcanzado, sin reclamar) · **Conseguido** (reclamado). Recompensa por `describeReward`. Sin premium,
sin pago, sin gemas. Reclamar sigue en `/logros`.

## 11. Achievements

`AchievementGrid`: categorías DERIVADAS del catálogo (solo **Colección** y **Sobres** tienen logros;
Juego/Competitivo/Pick'ems no aparecen), tarjeta con nombre, descripción, progreso/objetivo, recompensa
real, estado (**Bloqueado / En progreso / Pendiente de recoger / Conseguido**) y fecha de reclamo
(`claimed_at`). Sin logros secretos en el catálogo (`isSecretAchievement` = false; si existieran,
se ocultaría la condición). **Bug corregido**: los 4 logros de colección ya tienen progreso en servidor.

## 12. Reward center / historial

`RewardHistory` en el hub: últimas 8 recompensas del libro mayor (`describeReward`): fuente por
`reason` (Duelo, Logro, Objetivo, Pase, Pick'ems, Evento, Bienvenida), créditos del asiento, sobre y
XP solo cuando la definición referida los fija (misión del pool, nivel del carril, escalón). Compras y
«otros» fuera. Enlace al historial completo (`/recompensas`, intacto).

## 13. Reward idempotency

Una sola puerta: `app_grant_reward` comprueba `credit_transactions(user_id, ref)` antes de escribir
(índice único). Refs: `pass:<season>:<track>:<level>`, `achievement:<id>`, `duel:<matchId>`,
`pickem:<id>:<tier>`, y ahora `mission:<season>:<id>:<assignedAt>:<baseline>` (antes llevaba
`Date.now()`: un reintento de red pagaba dos veces). Los logros tienen además la PK de
`user_achievements`. El snapshot y el hub **no conceden nada**; mostrar no re-otorga.

## 14. Post-match integration

`useProgressionDelta`: lectura del servidor **antes** de `startDuel` y **al terminar**; `diffSnapshots`
compara dos verdades del servidor → XP ganada, niveles cruzados, objetivos que avanzaron
(«3/5 → 4/5», barra que recorre la diferencia; sin movimiento con reduced-motion), completados, logros
conseguidos, «+ N progresos más». `ResultScreen` solo recibe un hueco `extra`; no sabe de misiones.
Revancha: la lectura «después» pasa a ser el «antes».

## 15. Pack integration

Misma técnica en la ceremonia: lectura antes de `openPackOnline(packId)` (literal intacto) y al llegar
al resumen; `PostMatchProgress` debajo de las acciones. RNG, pity, precios y `app_apply_pack_open`
intactos; la ceremonia no concede nada (test 35).

## 16. Collection integration

`loadFacts` trae los `card_id` reales → `distinct_cards` cuenta cartas DISTINTAS (bug corregido) y los
logros de colección se evalúan con la MISMA función del catálogo (`def.progress(ctx)`) sobre datos del
servidor. `/coleccion` enseña `CollectionObjectives` (objetivos con métrica de colección + logros de
Colección sin reclamar). Sin recompensas nuevas.

## 17. Pick'ems integration

Solo lectura: paso «Haz tus predicciones · N partidos abiertos» (ya calculado en servidor) en HOY y en
la home («1 Pick'em pendiente»); sus recompensas aparecen en el historial. Motor intacto (test 37).

## 18. Competitive progression

Rango por puntos con los tiers REALES (`RANKS`, `RankBadge`), duelos jugados/ganados (servidor),
rating PvP (`duel_pvp_ratings`, con «provisional · N partidas») si hay ficha. Sin tiers inventados,
sin rachas (no existe racha competitiva persistida; la racha diaria local sigue fuera).

## 19. Home / meta loop

`LoopStrip` recibe `meta`: tarjeta **Continuar** (`continueCta` sobre `todayActions`) y tarjeta
**Nivel N · XP/siguiente** con «M recompensas por recoger · K objetivos activos · P Pick'em
pendientes» (todo del servidor: `loop.progression`, `loop.circuit`). Sin sesión, la tira es la de la
Fase 25. Cero peticiones nuevas en la home (reutiliza `fetchLoop`).

## 20. FTUE

`ftueState`: cuenta nueva = 0 sobres abiertos y 0 duelos. Cuatro pasos con datos reales (abrir el
primer sobre → crear el equipo → jugar el primer duelo → subir de nivel), marcados como hechos por el
servidor. Sin recompensa adicional: la de bienvenida ya la concede el trigger de alta.

## 21. Returning player

Sin `last_seen` persistido no se inventa un «desde tu última visita». El jugador que vuelve ve HOY
(máximo 4 acciones), objetivos con «caduca en …», recompensas por recoger y lo último ganado. Sin
popups: los avisos solo nacen de diferencias observadas en la sesión actual.

## 22. Notifications

`ProgressAlerts` (pila ligera, `aria-live=polite`) + `LevelUpBanner` (`aria-live=assertive`) para
LEVEL UP / OBJECTIVE COMPLETE / ACHIEVEMENT / PACK REWARD. Identidad estable por evento (`level:N`,
`objective:<id>:<tanda>`, `achievement:<id>`), dedup en memoria de módulo (`takeProgressEvents`), sin
acuse en servidor (no se inventa) y sin esconder nunca una recompensa histórica.

## 23. Data model / migraciones

**Sin migración de datos**: rotación, `expiresAt`, logros en servidor y `claimedAt` usan columnas y
campos existentes (`user_pass.state.missions[].assignedAt`, `user_cards.card_id`,
`user_achievements.claimed_at`). Una migración LOCAL y **NO aplicada**:
`0046_telemetry_flows_progression.sql` (amplía el CHECK de flujos con `duel_play` y `progression`;
aditiva, idempotente; exige actualizar `FLOWS` en el mismo cambio). La deuda de `schema_migrations`
no se toca.

## 24. Server authority

- Escrituras de XP/créditos/puntos: solo `app_grant_reward`/`app_apply_pack_open` (`security definer`).
- `/api/game/meta` es GET y `services/meta` no tiene `rpc/insert/update/upsert` ni claims (test 42).
- La ruta de progresión acepta solo `action/level/track/missionId/achievementId/family/cosmeticId`.
- Ninguna pantalla asigna XP ni nivel; `localStorage` no es autoridad (tests 41, 44, 45).
- La rotación y las cuentas atrás nacen del reloj del servidor (`serverNow`, `expiresAt`) (test 48).

## 25. Concurrency

Dos peticiones que completan el mismo objetivo → misma clave `mission:…:assignedAt:baseline` → el
libro mayor paga UNA vez (`applied:false` en la segunda). Logros: PK + ref. Niveles del pase: ref por
nivel/carril; se paga antes de marcar. Rotación concurrente: dos lecturas a la vez pueden sortear dos
tandas y la última guardada gana (sin pago implicado; P2 documentado).

## 26. Telemetry

Contrato investigado: cerrado por CHECK. `trackMeta` (7 contextos) cableado en el hub (`progression_view`,
`continue_action`) y emitiendo SOLO si `isFlow("progression")`: hoy no-op honesto. Migración local
0046 creada y no aplicada; `FLOWS` sin tocar (test).

## 27. Responsive

390: hero → HOY (una columna) → objetivos → recorrido con scroll/snap → temporada → logros →
recompensas; objetivos táctiles ≥44 px (TodayPanel 64, FTUE 56). Sin tablas horizontales en las piezas
nuevas. Capturas a 1440/1024/390.

## 28. Accessibility

`Meter` con `role=progressbar` y etiqueta con cifras; foco visible (`nx-focus`); enlaces y botones
reales; recompensas con texto (créditos/sobre/XP), no solo color; `aria-live` solo en avisos de nivel/
recompensa; la cuenta atrás de temporada no se anuncia; reduced-motion en avisos y post-partida;
navegación por teclado (todo son `Link`/`button`).

## 29. Performance

`GET /api/game/meta` hace las lecturas en paralelo y lee el pase UNA vez (el bucle lo recibe ya
leído). La home no añade peticiones (reusa `fetchLoop`). `cache-control: no-store` en el snapshot;
post-partida y post-apertura releen el snapshot en el momento justo. El hub hace 1 petición.

## 30. QA

25 escenarios del brief cubiertos por escena del arnés o por test: usuario nuevo (`20-*`), con
progreso (`01-*`), casi nivel (`03-*`), subida (`04-*`), objetivo 0 %/parcial/completado (`06/07/08`),
recompensa (`09`), logro bloqueado/parcial/conseguido (`10/11`), track (`12`), temporada activa (`13`;
«sin temporada» no procede: `CURRENT_SEASON` es constante), post-match (`14`), sobre→objetivo (`15`),
colección→objetivo (`16`), Pick'em CTA (`17`), competitivo (`18`), móvil (varias `-390`), reduced
motion (`24/25`), historial (`09`), concurrencia (test 46/47), sin recompensas (`22`), backend caído
(`23`). Capturas: 39 PNG en `docs/product/qa/fase27/` + README (índice generado). Hallazgo de la QA visual: `FreeTrack` desplazaba la página entera al centrar el nivel (`scrollIntoView`) → corregido a `scrollLeft` de la fila.

## 31. Tests / gates

- Nuevos: `periods.test.ts` 4 · `meta.test.ts` 20 · `meta.contract.test.ts` 23 = **47** (XP/nivel 1–7, objetivos 8–18, logros 19–24, recompensas 25–32, integraciones 33–40, seguridad 41–48, regresión 49–60; los números del brief cubiertos por uno o más tests).
- Modificados: ninguno (el test de solo lectura de `/progresion` de la Fase 22.1 sigue intacto y verde).

| Gate | Resultado |
|---|---|
| `npm test` | **1375 / 1375** (1328 previos + 47 nuevos), 0 fallos |
| `tsc -p tsconfig.json` | 0 errores |
| `tsc -p tsconfig.scripts.json` | 0 errores |
| `next build` | OK (`/api/game/meta`, `/progresion`, `/design-system/fase27` compilan) |
| `eslint` (30 ficheros de la fase) | 0 errores (1 aviso preexistente en `coleccion/page.tsx`) |
| `security:verify` · `pack:verify` · `content:verify` · `distribution:verify` · `competitive:verify` · `importer-vlr:verify` | exit 0 |
| Suites de progresión/recompensas (`periods`, `meta`, `meta.contract`, `xpSources`, `duelRewards`, `rank`, `battlepass/tracks`, `lobby`, `packLoop.contract`, `duel`, `gameplay.contract`) | verdes dentro de `npm test` |
| `duel-gameplay:verify`, `pvp-*:verify`, `economy:verify`, `battlepass:verify` (BD) | **no ejecutados**: exigen Supabase local (Docker desinstalado); no se apuntan a producción |
| Capturas | 39 PNG (1440/1024/390) + README, 0 errores de consola propios |

## 32. Bugs reales encontrados y corregidos

1. **Logros de colección inreclamables**: `serverProgressFor` devolvía 0 para 4 de 7 logros → ahora la
   misma función del catálogo sobre `user_cards` reales.
2. **«Cartas distintas» contaba ejemplares** (`count` de filas) → `Set` de `card_id`.
3. **Reclamo de misión no idempotente** (`Date.now()` en el `ref`) → clave determinista por tanda y
   baseline.
4. **Misiones diarias/semanales sin rotación** → ventana evaluada al leer con el reloj del servidor.

Ninguna cantidad de créditos, XP, sobre, umbral de nivel ni pago cambia.

## 33. P2 reales

- **P2 · Telemetría**: `duel_play` y `progression` siguen fuera del CHECK; migración 0046 local sin aplicar.
- **P2 · Caducidad sin reclamar**: una diaria completada y no reclamada antes de las 00:00Z caduca. Alternativa
  (auto-reclamo al rotar o conservar completadas) es una decisión de producto.
- **P2 · Temporada sin fechas**: `CURRENT_SEASON` no tiene `startsAt/endsAt`; la tabla `seasons` está muerta.
- **P2 · `isReward` de Pick'ems** (home/cuenta) sigue ignorando `duel_*`, `pass_reward`, `mission_reward`,
  `achievement` (el hub usa `describeReward`, que sí los cuenta). No se ha tocado para no mover contadores.
- **P2 · Rotación concurrente**: dos lecturas simultáneas pueden sortear dos tandas; gana la última guardada.
- **P2 · Sin acuse de avisos en servidor**: los avisos se deduplican en memoria de la sesión.
- **P2 · Dos `CURRENT_SEASON`** (`data/season.ts` real vs `data/seasons.ts` legado); `scripts/battlepass-verify` verifica el legado.
- **P2 · `profiles.level`** nunca se escribe (`ranking_points.level` siempre 1).
- **P2 · Verificadores con BD no ejecutados** (sin Supabase local).

## 34. Archivos

Creados: `src/domain/progression/periods.ts`, `meta.ts`, `periods.test.ts`, `meta.test.ts`,
`meta.contract.test.ts`; `src/server/services/meta.ts`; `src/app/api/game/meta/route.ts`;
`src/lib/progression/meta.ts`, `telemetry.ts`; `src/components/progression/{LevelHero,TodayPanel,ObjectiveList,FreeTrack,SeasonPanel,AchievementGrid,RewardHistory,ProgressAlerts,PostMatchProgress,FtueSteps,CollectionObjectives,MetaHub}.tsx`;
`src/app/design-system/fase27/{page.tsx,fixtures.ts}`; `scripts/_fase27-visual-qa.ts`;
`supabase/migrations/0046_telemetry_flows_progression.sql` (NO aplicada); `docs/product/qa/fase27/*`; este informe.

Modificados: `src/server/services/progression.ts`, `src/server/services/loop.ts`,
`src/components/loop/NextUp.tsx`, `src/components/lobby/LoopStrip.tsx`, `src/app/page.tsx`,
`src/app/progresion/page.tsx`, `src/app/coleccion/page.tsx`, `src/app/duelos/jugar/page.tsx`,
`src/components/duel/ResultScreen.tsx` (hueco `extra`), `src/components/packs/PackOpeningExperience.tsx`.

No tocados: `domain/cardgame/**`, `domain/progression/{levels,achievements,duelRewards,rank}.ts`,
`data/season.ts`, `@/battlepass/**`, `services/{duels,duelsPvp,packs,pickems,rewards}.ts`, RPCs,
`config/features.ts`, worker esports, importador VLR, `lib/telemetry/**`.
