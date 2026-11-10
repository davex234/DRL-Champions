# FASE 20.5A — AUDITORÍA DE CANDIDATOS A TEAM PACK

**Solo lectura. Ninguna escritura, migración, artwork, pool ni commit.** Auditoría de los 24
candidatos cruzando tres capas ya testeadas — `teamPackCatalog` (20.2), `teamIdentities` (20.3),
motor de pools (`buildPool`) — y **confirmada contra la VPS** (`supabase_db_DRLCards`, solo SELECT).

Instrumento: `npx tsx scripts/_fase20-5a-audit.ts` (fuera de CI).

## Resultado
**READY-DRAFT 15 · BLOCKED por identidad 6 · ya vivos 3.** Artwork de equipo disponible hoy solo
para `team-heretics`, `team-fnatic`, `team-navi`, `team-g2`.

---

## TABLA

`elegibles` = cartas del equipo que su sobre puede entregar (`buildPool`), con reparto de rareza
(c/u/r/e/l). Todas son **PUBLISHED** (confirmado en BD: la única carta RETIRED del catálogo es
`derke__champions-mvp`, que no es elegible). `hist.NO` = cartas elegibles de un jugador que VLR
2026 sitúa en OTRO equipo (no deberían entrar en un sobre de identidad actual).

| Equipo | Región | Identity | Status | Elegibles (PUBLISHED) | hist.NO | Pack | Pool | Boost | Boost=actual | Ambiguo | Conflicto | DRAFT | Bloqueo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Team Heretics | EMEA | team-heretics | PARTIAL | 11 (c1 u5 r4 l1) | 0 | **sí** | sí | sí | **sí** | no | no | — | ninguno (vivo) |
| Fnatic | EMEA | fnatic | PARTIAL | 25 (c4 u8 r10 e2 l1) | **13** | **sí** | sí | sí | **NO** | sí | sí | — | boost sesga plantilla editorial |
| Team Liquid | EMEA | team-liquid | PARTIAL | 14 (c5 u9) | 0 | no | no | no | — | sí | no | **sí** | artwork + boost + precio |
| Karmine Corp | EMEA | karmine-corp | PARTIAL | 10 (c4 u6) | 0 | no | no | no | — | sí | no | **sí** | artwork + boost + precio |
| Gentle Mates | EMEA | m8 | PARTIAL | 10 (c4 u6) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| FUT | EMEA | fut | PARTIAL | 10 (c5 u5) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| G2 Esports | Americas | g2 | READY | 10 (c4 u6) | 0 | **sí** | sí | sí | **sí** | no | no | — | ninguno (vivo) |
| Leviatán | Americas | leviatan | PARTIAL | 10 (u10) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| NRG | Americas | nrg | **BLOCKED** | 17 (c4 u9 r1 e2 l1) | **7** | no | no | no | — | no | sí | no | identidad (LEGACY_ROSTER) |
| 100 Thieves | Americas | 100t | PARTIAL | 10 (c3 u7) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| LOUD | Americas | loud | PARTIAL | 16 (c7 u9) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| Sentinels | Americas | sentinels | **BLOCKED** | 0 | 0 | no | no | no | — | sí | sí | no | identidad (SPLIT+LEGACY) |
| Paper Rex | Pacific | paper-rex | PARTIAL | 10 (c4 u6) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| T1 | Pacific | t1 | **BLOCKED** | 8 (c3 u5) | 0 | no | no | no | — | no | sí | no | identidad (LEGACY_ROSTER) |
| Nongshim RedForce | Pacific | ns | PARTIAL | 10 (c4 u6) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| Gen.G | Pacific | gen-g | **BLOCKED** | 0 | 0 | no | no | no | — | no | sí | no | identidad (SPLIT+LEGACY) |
| DRX | Pacific | drx | **BLOCKED** | 0 | 0 | no | no | no | — | no | sí | no | identidad (UNPROVEN+LEGACY) |
| Global Esports | Pacific | ge | PARTIAL | 10 (c5 u5) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| Edward Gaming | China | edward-gaming | **BLOCKED** | 0 | 0 | no | no | no | — | sí | sí | no | identidad (SPLIT+LEGACY) |
| TYLOO | China | tyl | PARTIAL | 12 (c3 u9) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| Bilibili Gaming | China | blg | PARTIAL | 16 (c8 u8) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| Xi Lai Gaming | China | xlg | PARTIAL | 10 (c3 u7) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| Trace Esports | China | te | PARTIAL | 14 (c6 u8) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |
| JD Gaming | China | jdg | PARTIAL | 14 (c7 u7) | 0 | no | no | no | — | no | no | **sí** | artwork + boost + precio |

### Notas por punto del encargo (1–16)
- **1–4 (identity/displayName/status/región):** columnas Identity/Status/Región. `status` es la
  definición de identidad de la Fase 20.3 (BLOCKED ⇒ unverified), **no** «tiene jugadores».
- **5 (existe en `content_players`):** **sí, confirmado en BD.** Recuentos por alias idénticos al
  código (p. ej. Fnatic 4 / FNC 5, Gen.G 2 / GEN 7, TL 8, LOUD 8, BLG 8). Los 379 jugadores del
  código == `content_players`.
- **6–7 (elegibles / PUBLISHED):** iguales aquí — la elegibilidad solo sortea PUBLISHED, y la única
  carta RETIRED (`derke__champions-mvp`) no es elegible. Confirmado en BD: de los jugadores de
  roster actual muestreados, 101 PUBLISHED + 1 RETIRED (esa Derke).
- **8 (históricas que NO deben entrar):** columna `hist.NO`. Solo **Fnatic (13)** entre los que
  tienen sobre, y **NRG (7)** si se creara. El resto de READY: 0.
- **9–11 (pack/pool/boost):** solo `team-heretics`, `team-fnatic`, `team-g2`, `team-navi` los
  tienen (Fase 20). Confirmado en BD (20.2): 4 boost ACTIVE, 4 pack-team base, 20 pools totales.
- **12 (boost = identidad actual):** **Heretics sí, G2 sí, Fnatic NO.** Confirmado en BD:
  `boost-team-fnatic` = alfajer(7) + boaster(5) + **chronicle(5) + derke(8)**; Derke y Chronicle
  son **VIT** en VLR 2026 → 13 cartas sesgadas hacia jugadores que hoy no son Fnatic.
- **13 (aliases ambiguos):** `sí` cuando la identidad tiene alias actual + histórico (Fnatic, TL,
  KC, Sentinels, EDG) o dos strings con cartas (Gen.G).
- **14 (conflicto editorial vs VLR 2026):** `sí` cuando hay cartas de jugadores desplazados
  (Fnatic, NRG, Sentinels, T1, Gen.G, DRX, EDG).
- **15 (puede DRAFT):** los 15 PARTIAL sin sobre, con identidad verificada, packTeam decidible y
  ≥10 cartas limpias. Los 6 BLOCKED, no.
- **16 (qué falta para ACTIVE):** para los 15 → **artwork oficial + pool `boost-team-*` + decisión
  de precio**. Para los vivos → G2/Heretics nada; **Fnatic: re-apuntar su boost** a la identidad
  actual. Para los 6 BLOCKED → **resolver identidad** primero (Fase 20.3 lo dejó unverified).

---

## A. READY para crear como DRAFT (15)
Identidad verificada, alias único y limpio (`hist.NO` = 0), 10–16 cartas PUBLISHED elegibles,
sin conflicto editorial/VLR:

`Team Liquid` (14) · `Karmine Corp` (10) · `Gentle Mates`/M8 (10) · `FUT` (10) · `Leviatán` (10)
· `100 Thieves` (10) · `LOUD` (16) · `Paper Rex` (10) · `Nongshim RedForce` (10) ·
`Global Esports` (10) · `TYLOO` (12) · `Bilibili Gaming` (16) · `Xi Lai Gaming` (10) ·
`Trace Esports` (14) · `JD Gaming` (14).

Cada uno crearía como **DRAFT** un `PackDef` con la economía derivada del regional de su región
(20.2/20.3) — **sin ser público** hasta artwork + boost + precio (Fase 20.4 garantiza que un
DRAFT no se compra ni se abre server-side). **13 de los 15 solo tienen comunes/poco comunes**
(Leviatán, solo poco comunes): sobres válidos pero de rareza baja.

## B. Necesitan resolver identidad primero (6)
No crear ni pack ni pool: harían pasar una ambigüedad por resuelta.
- **NRG** — «NRG» incluye a demon1 (7 cartas, épica+legendaria), hoy ENVY en VLR 2026.
- **Sentinels** — «Sentinels» (semilla) + «SEN» (2026); zekken es MIBR.
- **T1** — VLR pone en T1 a Meteor y BuZz, que la semilla guarda en Gen.G y DRX.
- **Gen.G** — «Gen.G» (t3xture, Meteor) vs «GEN» (7 jugadores); decisión 20.3: **separados**.
- **DRX** — VLR 2026 no tiene DRX (mako→KRX, buzz→T1); identidad no probada.
- **Edward Gaming** — «EDward Gaming» (semilla, 21c) + «EDG» (2026); haodong es TEC.

## C. Necesitan datos
**Ninguno con déficit de datos** entre los 24: todos los READY tienen ≥10 cartas. La carencia real
de los 15 es de **producto** (artwork + pool + precio), no de datos. Nota de riqueza: la mayoría
carece de rara/épica/legendaria — es un hecho del catálogo, no un dato que falte.

## D. Ya existen (pack vivo) — 3 de los 24
- **Team Heretics** — boost alineado con identidad actual. Correcto.
- **G2 Esports** — READY; boost alineado. Correcto.
- **Fnatic** — vivo, pero su **boost sesga la plantilla editorial** (incluye 13 cartas de Derke y
  Chronicle, hoy VIT). Deuda, no bug de motor.
- *(NAVI existe como `team-navi` pero no está en la lista de 24 candidatos; boost alineado.)*

## E. Riesgos P0/P1/P2
- **P0:** ninguno.
- **P1 — `boost-team-fnatic` desalineado:** sesga 13 cartas hacia jugadores que hoy no son Fnatic.
  Corregirlo es **re-apuntar un pool activo** (escritura), que esta fase prohíbe → **deuda
  documentada**. Bajo la regla de identidad actual (20.3), el boost debería cubrir solo la
  plantilla FNC.
- **P1 — no crear DRAFT sin resolver identidad:** para los 6 BLOCKED, un pool «provisional»
  fijaría una decisión de producto no tomada. No hacerlo.
- **P2 — rareza baja:** 13 de 15 READY solo dan comunes/poco comunes; Leviatán solo poco comunes.
  La tienda ya lo avisa (`TeamNote`), pero es un producto flojo.
- **P2 — precio:** los 15 heredarían 3.000/5/35-40-18-6-1 del regional (China 0 épicas/legendarias);
  el precio final sigue siendo decisión de producto abierta desde la Fase 20.
- **P2 — artwork:** los 15 son ARTWORK PENDING; no se fabrica sustituto (20.1).

## F. Orden recomendado de creación (como DRAFT)
1. **Ola 1 — más ricos y sin ambigüedad:** `LOUD` (16), `Bilibili Gaming` (16), `Trace Esports`
   (14), `JD Gaming` (14), `Team Liquid` (14). Máximo contenido, identidad limpia.
2. **Ola 2 — 10–12 cartas, identidad limpia:** `TYLOO` (12), `Karmine Corp`, `Gentle Mates`,
   `FUT`, `100 Thieves`, `Paper Rex`, `Nongshim RedForce`, `Global Esports`, `Xi Lai Gaming` (10).
3. **Ola 3 — rareza mínima, revisar antes:** `Leviatán` (solo poco comunes).
4. **Fuera de la creación de DRAFT, en paralelo:** decidir identidad de los 6 BLOCKED (20.3), y la
   deuda de re-apuntar `boost-team-fnatic`.

Cada creación de DRAFT necesita después, para pasar a ACTIVE: **artwork oficial + `content-pools:migrate`/`boost` apuntando a la identidad actual + decisión de precio**, y `content-pools:verify` contra la VPS.

---

**Confirmaciones:** ninguna escritura · sin cambios en BD, `content_players.team`, cartas,
`user_cards`, `card_mints`, pools ni `market_listings` · sin artwork · sin migración · sin commit.
Motor intacto (pools + pesos; sin `if/else` por pack). Ningún Team Pack creado.
