# FASE 20.2 — CIERRE DEL CATÁLOGO REAL DE TEAM PACKS

**Estado: PARTIAL.** Auditoría completa de los 24 equipos, mapeo canónico y detector Gen.G/GEN
en código con tests, economía derivada y sesgo medido con el motor real. **No se ha creado
ningún producto nuevo**: la base de datos no está disponible (Docker Desktop desinstalado en
esta máquina), y sin pools persistidos un Team Pack nuevo se vendería como un regional sin
sesgo. La QA real en tienda (§16) no se ha podido ejecutar.

Resultado por equipo: **READY 1 · PARTIAL 17 · BLOCKED 6.**

Instrumentos (fuera de CI):

    npx tsx scripts/_fase20-2-audit.ts          tabla de los 24 + discrepancias + recuentos de BD
    npx tsx scripts/_fase20-2-distribution.ts   sesgo con el motor real, con y sin pools

---

## TEAM PACK CATALOG AUDIT

`j` = jugadores, `c` = cartas del catálogo de código (772 cartas, 379 jugadores). «Elegibles» =
cartas del equipo dentro del pool del sobre (`buildPool`, restringido a su región).
Pool/vínculo de los cuatro sobres vivos: creados en la Fase 20 (`boost-team-*`, prioridad 50) y
**no re-medidos en esta fase** porque la base no responde.

| TEAM | CANONICAL ID (`Player.team`) | PLAYERS | CARDS | PRODUCT | POOL | PACK LINK | ARTWORK | CAN CREATE? | ESTADO · BLOCKER |
|---|---|---|---|---|---|---|---|---|---|
| Team Heretics | `Team Heretics` + `TH` | 2 + 3 | 11 + 6 | ✅ `team-heretics` | F20 | F20 | ✅ | existe | **PARTIAL** · IDENTITY_SPLIT |
| Fnatic | `Fnatic` + `FNC` | 4 + 5 | 25 + 8 | ✅ `team-fnatic` | F20 | F20 | ✅ | existe | **PARTIAL** · IDENTITY_SPLIT, LEGACY_ROSTER |
| Team Liquid | `TL` (+ `Team Liquid`, 0 cartas) | 8 + 1 | 14 + 0 | ❌ | ❌ | ❌ | ❌ | sí (14 eleg.) | **PARTIAL** · sin BD, ARTWORK PENDING |
| Karmine Corp | `KC` (+ `Karmine Corp`, 0 cartas) | 5 + 1 | 10 + 0 | ❌ | ❌ | ❌ | ❌ | sí (10) | **PARTIAL** · sin BD, ARTWORK PENDING |
| Gentle Mates | `M8` | 7 | 12 | ❌ | ❌ | ❌ | ❌ | sí (10) | **PARTIAL** · sin BD, ARTWORK PENDING |
| FUT | `FUT` | 5 | 10 | ❌ | ❌ | ❌ | ❌ | sí (10) | **PARTIAL** · sin BD, ARTWORK PENDING |
| G2 Esports | `G2` | 5 | 10 | ✅ `team-g2` | F20 | F20 | ✅ | existe | **READY** |
| Leviatán | `LEV` | 5 | 10 | ❌ | ❌ | ❌ | ❌ | sí (10, todas poco comunes) | **PARTIAL** · sin BD, ARTWORK PENDING |
| NRG | `NRG` | 7 | 17 | ❌ | ❌ | ❌ | ❌ | no | **BLOCKED** · LEGACY_ROSTER |
| 100 Thieves | `100T` | 5 | 10 | ❌ | ❌ | ❌ | ❌ | sí (10) | **PARTIAL** · sin BD, ARTWORK PENDING |
| LOUD | `LOUD` | 8 | 16 | ❌ | ❌ | ❌ | ❌ | sí (16) | **PARTIAL** · sin BD, ARTWORK PENDING |
| Sentinels | `Sentinels` + `SEN` | 4 + 6 | 11 + 8 | ❌ | ❌ | ❌ | ❌ | no | **BLOCKED** · IDENTITY_SPLIT, LEGACY_ROSTER |
| Paper Rex | `PRX` | 5 | 10 | ❌ | ❌ | ❌ | ❌ | sí (10) | **PARTIAL** · sin BD, ARTWORK PENDING |
| T1 | `T1` | 4 | 8 | ❌ | ❌ | ❌ | ❌ | no | **BLOCKED** · LEGACY_ROSTER |
| Nongshim RedForce | `NS` | 5 | 10 | ❌ | ❌ | ❌ | ❌ | sí (10) | **PARTIAL** · sin BD, ARTWORK PENDING |
| Gen.G | `Gen.G` + `GEN` | 2 + 7 | 12 + 14 | ❌ | ❌ | ❌ | ❌ | no | **BLOCKED** · IDENTITY_SPLIT, LEGACY_ROSTER |
| DRX | `DRX` | 3 | 7 | ❌ | ❌ | ❌ | ❌ | no | **BLOCKED** · IDENTITY_UNPROVEN, LEGACY_ROSTER |
| Global Esports | `GE` | 5 | 10 | ❌ | ❌ | ❌ | ❌ | sí (10) | **PARTIAL** · sin BD, ARTWORK PENDING |
| Edward Gaming | `EDward Gaming` + `EDG` | 4 + 4 | 21 + 8 | ❌ | ❌ | ❌ | ❌ | no | **BLOCKED** · IDENTITY_SPLIT, LEGACY_ROSTER |
| TYLOO | `TYL` | 6 | 12 | ❌ | ❌ | ❌ | ❌ | sí (12) | **PARTIAL** · sin BD, ARTWORK PENDING |
| Bilibili Gaming | `BLG` | 8 | 16 | ❌ | ❌ | ❌ | ❌ | sí (16) | **PARTIAL** · sin BD, ARTWORK PENDING |
| Xi Lai Gaming | `XLG` | 6 | 10 | ❌ | ❌ | ❌ | ❌ | sí (10) | **PARTIAL** · sin BD, ARTWORK PENDING |
| Trace Esports | `TE` | 7 | 14 | ❌ | ❌ | ❌ | ❌ | sí (14) | **PARTIAL** · sin BD, ARTWORK PENDING |
| JD Gaming | `JDG` | 7 | 14 | ❌ | ❌ | ❌ | ❌ | sí (14) | **PARTIAL** · sin BD, ARTWORK PENDING |

Fuera de la lista: `team-navi` (NAVI, 8 jugadores, 16 cartas, identidad única) sigue vivo y se ha
auditado, pero no se ha tocado.

La tabla completa es **dato con test**: `src/data/teamPackCatalog.ts`. Cada bloqueo declarado se
compara con el que imponen los datos (`derivedBlockers`) y el estado con la regla (`deriveStatus`).
El instrumento da **0 incoherencias**.

### La causa de todos los bloqueos de identidad

`PLAYERS` fusiona la semilla editorial (nombre completo y palmarés) con VLR 2026 (etiqueta). Si un
jugador está en las dos, **gana la semilla, también su equipo**. El detector
`rosterDiscrepancies()` encuentra 17 jugadores con cartas cuyo equipo no coincide:

| jugador | catálogo | VLR 2026 | cartas | efecto |
|---|---|---|---|---|
| benjy, wo0t | Team Heretics | TH | 5, 6 | mismo equipo, otro nombre |
| boaster, alfajer | Fnatic | FNC | 5, 7 | mismo equipo, otro nombre |
| derke, chronicle | Fnatic | **VIT** | 8, 5 | el sobre Fnatic sesga a jugadores de otro equipo actual |
| johnqt | Sentinels | SEN | 5 | mismo equipo, otro nombre |
| zekken | Sentinels | **MIBR** | 6 | otro equipo actual |
| demon1 | NRG | **ENVY** | 7 | otro equipo actual |
| t3xture | Gen.G | GEN | 7 | mismo equipo, otro nombre |
| meteor | Gen.G | **T1** | 5 | T1 pierde un jugador actual |
| buzz | DRX | **T1** | 4 | T1 pierde otro |
| mako | DRX | **KRX** | 3 | no se sabe si KRX es DRX |
| zmjjkk, chichoo, nobody | EDward Gaming | EDG | 6, 5, 5 | mismo equipo, otro nombre |
| haodong | EDward Gaming | **TEC** | 5 | otro equipo actual |

Agrupar por `teamTag` no lo resuelve: `Gen.G` lleva `GENG` y `GEN` lleva `GEN` (no coinciden), y
`G2 Gozen` comparte `G2` con G2 Esports siendo otro equipo (Game Changers). Por eso el mapeo es
una lista explícita con `TEAM_LOOKALIKES`, y no una regla por etiqueta.

---

## CREATED PRODUCTS

**Ninguno.** Hay 15 equipos con datos suficientes (identidad única, 10–16 cartas elegibles, pool
válido, mecanismo existente y precio derivable), pero crear el producto hoy lo haría incorrecto por
tres motivos independientes:

1. **Sin base de datos no hay sesgo.** `content-pools:migrate` y `content-pools:boost` escriben
   por RPC en Supabase. Un `PackDef` con `team` y sin pools se abre como un regional cualquiera:
   un «Sobre LOUD» que no favorece a LOUD. Es exactamente el producto que finge.
2. **Sin artwork no puede ir a la tienda.** §9 prohíbe el sustituto, y hoy un sobre sin fichero
   en `PACK_ART_AVAILABLE` se dibuja con el arte procedimental de `SealedPack`.
3. **No existe una forma de tener un producto «creado pero no a la venta».** `buyPack` solo
   comprueba que el `packId` exista en `PACKS`; no mira `retired` ni ningún otro estado. Añadir
   un sobre a `PACKS` lo hace comprable por API aunque la tienda lo esconda.

Lo que sí queda listo: `proposedTeamPack(entry)` devuelve el `PackDef` exacto que se añadiría
(id, nombre canónico, economía derivada, región, `team`) y los tests comprueban que ninguna
propuesta pisa un id, un nombre o un equipo existentes.

---

## POOLS

**Ni creados ni modificados.** `pack-team-*` y `boost-team-*` de la Fase 20 no se han tocado.

Cuando haya base de datos, crear los de un equipo viable no requiere código nuevo: los dos scripts
recorren `PACKS` y son idempotentes. La secuencia es añadir el `PackDef` →
`content-pools:migrate` → `content-pools:boost` → `content-pools:verify`.

**Observación sobre los pools activos (no corregida):** `boost-team-heretics` sesga las 11 cartas
de «Team Heretics» y deja fuera las 6 de «TH» (riens, boo, koshmaras, la plantilla 2026).
`boost-team-fnatic` sesga las 25 de «Fnatic» (Derke y Chronicle incluidos, hoy en VIT) y deja
fuera las 8 de «FNC». Cambiarlo es modificar pools activos, y la justificación depende de la
decisión de producto de más abajo. Por eso se documenta y no se toca.

---

## DISTRIBUTION

Motor real (`PackEngine.open`), con y sin los pools que crearían los scripts, compuestos con
`composeDistribution`. 2.000 aperturas por sobre. **Es medida del motor, no QA de producto.**

| sobre | estado | equipo/pool | cuota sin → con | cartas del equipo/sobre | P(≥1) sin → con | sobres sin ninguna |
|---|---|---|---|---|---|---|
| team-heretics | vivo | 11/204 | 8,0 → 23,3 % | 0,40 → 1,16 | 34,0 → 73,0 % | 539 |
| team-fnatic | vivo | 25/204 | 24,8 → 43,3 % | 1,24 → 2,16 | 76,3 → 94,7 % | 107 |
| team-g2 | vivo | 10/182 | 4,6 → 18,1 % | 0,23 → 0,91 | 21,1 → 63,6 % | 727 |
| team-navi | vivo | 16/204 | 6,2 → 23,6 % | 0,31 → 1,18 | 27,3 → 74,3 % | 514 |
| team-liquid | propuesta | 14/204 | 5,4 → 21,3 % | 0,27 → 1,06 | 24,3 → 69,4 % | 612 |
| team-karmine | propuesta | 10/204 | 3,8 → 16,2 % | 0,19 → 0,81 | 17,4 → 58,7 % | 827 |
| team-m8 | propuesta | 10/204 | 4,0 → 16,5 % | 0,20 → 0,82 | 18,3 → 59,9 % | 803 |
| team-fut | propuesta | 10/204 | 4,2 → 16,7 % | 0,21 → 0,84 | 20,0 → 60,5 % | 790 |
| team-leviatan | propuesta | 10/182 | 3,9 → 14,3 % | 0,19 → 0,71 | 18,4 → 54,5 % | 909 |
| team-100t | propuesta | 10/182 | 4,1 → 17,2 % | 0,20 → 0,86 | 18,4 → 61,4 % | 772 |
| team-loud | propuesta | 16/182 | 6,6 → 25,1 % | 0,33 → 1,25 | 28,4 → 75,5 % | 490 |
| team-prx | propuesta | 10/197 | 4,1 → 16,6 % | 0,20 → 0,83 | 19,1 → 60,1 % | 799 |
| team-ns | propuesta | 10/197 | 4,1 → 16,7 % | 0,21 → 0,84 | 19,3 → 60,6 % | 788 |
| team-ge | propuesta | 10/197 | 3,9 → 16,6 % | 0,20 → 0,83 | 17,9 → 60,3 % | 795 |
| team-tyl | propuesta | 12/189 | 5,4 → 20,5 % | 0,27 → 1,02 | 24,6 → 68,3 % | 634 |
| team-blg | propuesta | 16/189 | 7,1 → 26,5 % | 0,36 → 1,33 | 30,6 → 78,3 % | 433 |
| team-xlg | propuesta | 10/189 | 4,3 → 18,3 % | 0,22 → 0,91 | 20,0 → 64,8 % | 704 |
| team-te | propuesta | 14/189 | 6,1 → 23,2 % | 0,30 → 1,16 | 26,8 → 73,5 % | 531 |
| team-jdg | propuesta | 14/189 | 6,6 → 23,5 % | 0,33 → 1,18 | 28,4 → 73,5 % | 530 |

- **Mayor probabilidad, sí:** la cuota del equipo se multiplica por 3,5–4 en todos (1,7 en Fnatic,
  que ya partía de 24,8 %).
- **Garantía, no:** en todos quedan sobres sin ninguna carta del equipo (107 de 2.000 en el peor
  caso, Fnatic), y el test exige además que salgan cartas de otros equipos y ninguna fuera del pool.
- **El sesgo no cambia la pertenencia:** `members` del pool compuesto tiene el mismo tamaño que el
  pool del sobre (test).
- **Contraste con la Fase 20:** su calibración dio Heretics 1,13 / 72,3 %, NAVI 1,20 / 74,4 %,
  G2 0,91 / 63,2 % y Fnatic 2,12 / 94,2 %. La medida de hoy coincide, así que el instrumento mide
  lo mismo que el motor.

Sin lógica especial: ningún `if packId`, ningún motor nuevo. El test verifica que el peso lo lee
de `content-pools-boost.ts` y que `pool.ts`/`openPack.ts` siguen sin saber de equipos (test
existente de `packs.test.tsx`).

---

## DATA NORMALIZATION

### Gen.G / GEN

1. **Gen.G** (`teamTag` `GENG`, semilla editorial): **t3xture** (7 cartas) y **Meteor** (5), en
   total 12 cartas con épica y legendaria.
2. **GEN** (`teamTag` `GEN`, VLR 2026): **karon, ash, lakia, raxcal, efina, zynx, kitae**, con
   14 cartas, solo comunes y poco comunes.
3. **Gen.G es el valor heredado.** Viene de la semilla y ganó la fusión. VLR 2026 pone a t3xture
   en GEN y a Meteor en **T1**.
4. **¿Consolidar?** El equipo es el mismo, pero consolidar no es renombrar. Hay que decidir
   **quién es miembro**: si Meteor sigue contando para Gen.G (palmarés) o pasa a T1 (plantilla
   actual). Es una **decisión de producto pendiente**, y afecta igual a T1, que hoy tiene 4 de sus
   6 jugadores.
5. **Impacto medido en código:**

| superficie | impacto de unificar |
|---|---|
| cards | **ninguno en identidad**: `card_id` es `<playerId>__<variante>` y no lleva el equipo |
| `user_cards` / `card_mints` | **referencias intactas** (van por `card_id`). Recuento por equipo: sin medir (BD caída); el instrumento lo calcula |
| catalog | `content_players.team` (indexado) y el índice `byTeam` de `catalog-builder` cambian |
| pools / pack distribution | ninguno hoy: no hay sobre de Gen.G |
| market | el filtro de equipo (`mercado/page.tsx`) enseña hoy **dos** opciones, «Gen.G» y «GEN»; la búsqueda por texto cambia |
| **statistics / maestría** | `equipo:gen-g` (12 cartas) y `equipo:gen` (14) son dos conjuntos. Los escalones reclamados se guardan en `user_achievements` como `masteryRef(setId, at)`: **unificar cambia el id del conjunto y deja huérfanos los reclamados** |
| logros | ninguno para Gen.G. **Sí para Heretics:** `completa-heretics` (8.000 créditos) cuenta las cartas de «Team Heretics», así que unificar con TH le sube el objetivo de 11 a 17 |

### El resto

| pedido | valores en catálogo | situación |
|---|---|---|
| Team Liquid / TL | `TL` (14c), `Team Liquid` (leo, 0c) | sin conflicto de cartas: se usa `TL` |
| Karmine Corp / KC | `KC` (10c), `Karmine Corp` (scream, 0c) | ídem: se usa `KC` |
| Gentle Mates / M8 | `M8` | glyph figura en Americas; `restrictRegion` lo excluye |
| 100 Thieves / 100T | `100T` | único |
| Edward Gaming / EDG | `EDward Gaming` (21c) + `EDG` (8c) | dividido; signed (EDG) figura en EMEA |
| G2 Esports / G2 | `G2` | `G2 Gozen` es otro equipo con la misma etiqueta |
| DRX | `DRX` (solo semilla) | VLR 2026 no tiene `DRX`; mako está en `KRX`. No se asume que KRX = DRX |

**Nombres.** Donde `data/teams.ts` registra el equipo, el canónico es su nombre («Team Liquid»,
«Leviatán», «Paper Rex»). Donde no, es la etiqueta real («M8», «NS», «TE»), igual que los vivos
«Sobre NAVI» y «Sobre G2». Que `TE` sea Trace Esports o `NS` Nongshim RedForce **no está en ningún
dato del repositorio**; lo recoge el informe 20.1 y encaja con la región, pero hay que confirmarlo
antes de poner el nombre completo en un producto.

**No se ha modificado `Player.team`, `data/teams.ts`, `data/players.ts` ni ningún dato.** No hay
migración.

---

## BLOCKED

| equipo | por qué | qué lo desbloquea |
|---|---|---|
| **Gen.G** | dos valores con cartas; t3xture en GEN y Meteor en T1 según VLR 2026 | decidir el canónico y la pertenencia de Meteor |
| **Sentinels** | `Sentinels` (semilla) + `SEN` (2026); zekken figura en MIBR | decidir si el sobre homenajea la plantilla editorial o la actual |
| **Edward Gaming** | `EDward Gaming` + `EDG`; haodong figura en TEC | ídem |
| **T1** | Meteor y BuZz son T1 en VLR 2026, pero cuentan como Gen.G y DRX | la misma decisión que Gen.G/DRX |
| **NRG** | un solo valor, pero incluye a demon1 (ENVY en 2026, con épica y legendaria) | decidir si el palmarés editorial entra en el sesgo |
| **DRX** | no existe en VLR 2026; nada prueba que `KRX` sea DRX | confirmar la identidad con una fuente, no con una suposición |

---

## DEBTS

1. **P0 · Entorno: Docker Desktop no está instalado.** `C:\Program Files\Docker\Docker` solo
   contiene `tmp-delete` (13/09/2026 13:11) con los binarios del instalador. No hay servicio ni
   ejecutable. Bloquea §13, la creación de pools, `content-pools:verify`,
   `content-catalog:verify`, `ux:verify` y la QA de §16.
2. **P1 · Decisión de producto: plantilla editorial o actual.** Una sola decisión desbloquea 6
   equipos y corrige 2 vivos (Heretics, Fnatic). Hay que tomarla con el impacto en maestría y en
   `completa-heretics` delante.
3. **P1 · No hay un estado «creado, no a la venta».** `buyPack` vende cualquier `packId` de
   `PACKS`, incluidos los `retired` (Prime). Hace falta decidir el mecanismo antes de dar de alta
   productos sin artwork. Solo tocaría la tienda y `server/services/packs.ts`, no el motor.
4. **P1 · Artwork de los 15 viables.** ARTWORK PENDING. No se ha fabricado nada.
5. **P2 · Precio.** Los nuevos heredarían la economía del regional de su región
   (`teamPackEconomics`): 3.000 / 5 / 35-40-18-6-1 en EMEA, Americas y Pacific, y
   35-40-18-**0-0** en China, como el regional China. Hoy usan 3.000 / 5 / 35-40-18-6-1
   exactamente `emea`, `americas`, `pacific`, `team-heretics`, `team-fnatic`, `team-navi` y
   `team-g2` (test). El informe de la Fase 20 dejó el precio final como decisión de producto, y
   sigue abierta.
6. **P2 · Rarezas.** 13 de los 15 viables solo tienen comunes y poco comunes. Leviatán, solo poco
   comunes. La tienda ya lo avisa (`TeamNote`), pero es un producto débil.
7. **P2 · Confirmar etiqueta → nombre** de M8, NS, GE, TE, TYL, BLG, XLG, JDG, 100T antes de
   usar el nombre completo.
8. **P2 · Anomalías de región en VLR:** glyph (M8) en Americas y signed (EDG) en EMEA.
9. **P2 · `KRÃœ`**: etiqueta con mojibake en `players-vct-2026.json` (6 jugadores). No es objetivo,
   pero es un nombre de equipo roto en el catálogo y en el filtro del mercado.

---

## QA

| gate | resultado |
|---|---|
| `npm test` | ✅ **865 / 865** (línea base antes de la fase: 855; +10 de `teamPackCatalog.test.ts`) |
| `typecheck` | ✅ exit 0 (app + scripts) |
| `build` | ✅ compilado |
| `security:verify` | ✅ todas las comprobaciones pasan |
| `pack:verify` | ✅ todas las comprobaciones pasan |
| `distribution:verify` | ✅ 30 ✓ / 0 ✗ |
| `content-pools:verify` | ⛔ **no ejecutable**: «No hay pools» (Supabase no responde) |
| `content-catalog:verify` | ⛔ **no ejecutable**: `fetch failed` |
| `ux:verify` | ⛔ no ejecutado: necesita app + Supabase |
| QA real de tienda (§16) | ⛔ **no ejecutada**. No se declara PASS con simulaciones |

Tests nuevos (`src/data/teamPackCatalog.test.ts`), uno por punto de §15:
canonical team mapping (2), Gen.G/GEN detection, declarado = medido, Team Pack existence +
existing data preservation, precio derivado, missing team handling, duplicate prevention, y
weighted distribution + no guarantee + pool linkage con el motor real.

**Para cerrar §16 cuando vuelva la base:** reinstalar Docker Desktop, `npx supabase start`,
`npx tsx scripts/_fase20-2-audit.ts` (recuentos §13 y estado real de los `boost-team-*`),
`content-pools:verify`, y la QA de tienda sobre `team-g2` y `team-navi` con
`scripts/_fase20-qa.ts`, que ya compra y abre sobres reales contra la base.

## FICHEROS

| fichero | cambio |
|---|---|
| `src/data/teamPackCatalog.ts` | **nuevo** — auditoría de los 24, detectores, economía derivada, propuesta de `PackDef` |
| `src/data/teamPackCatalog.test.ts` | **nuevo** — 10 tests |
| `scripts/_fase20-2-audit.ts` | **nuevo** — instrumento de catálogo y BD |
| `scripts/_fase20-2-distribution.ts` | **nuevo** — instrumento de sesgo |
| `docs/product/fase-20-2-team-packs-catalogo-report.md` | este informe |

Nada más. No se han tocado `PACKS`, `Player.team`, pools, motor, tienda, PackOpeningExperience,
CardReveal, CardVisual, Card3D, economía, minting, PvP, duelos, Trainer, telemetría ni analítica.
Sin commit, sin push, sin deploy.

---

## ESTADO

**FASE 20.2 — PARTIAL.**

- **READY (1):** G2 Esports.
- **PARTIAL (17):** Team Heretics y Fnatic (vivos, identidad dividida) y 15 equipos con datos
  suficientes y producto no creado (sin BD, sin artwork).
- **BLOCKED (6):** Gen.G, Sentinels, Edward Gaming, T1, NRG y DRX, por identidad.

Lo que es READY es correcto. Lo demás tiene el bloqueo exacto escrito y verificado por test.
