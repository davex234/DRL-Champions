# FASE 20.5 — OLA 2 — CREACIÓN DE TEAM PACKS (9)

**Estado: 9 Team Packs creados como DRAFT.** Producto en código + pools (base + sesgo) en la VPS.
Ninguno ACTIVE, ninguno comprable, sin artwork. Ola 1, los 4 Team Packs vivos y los pools
existentes, **intactos**. Motor de distribución y economía sin tocar.

## Los 9 productos

| # | packId | name | identity | team (alias actual) | región | lifecycle | precio | pesos |
|---|---|---|---|---|---|---|---|---|
| 1 | `team-tyl` | Sobre TYL | tyl | TYL | China | **DRAFT** | 3000 | 35/40/18/0/0 |
| 2 | `team-karmine` | Sobre Karmine Corp | karmine-corp | KC | EMEA | **DRAFT** | 3000 | 35/40/18/6/1 |
| 3 | `team-m8` | Sobre M8 | m8 | M8 | EMEA | **DRAFT** | 3000 | 35/40/18/6/1 |
| 4 | `team-fut` | Sobre FUT | fut | FUT | EMEA | **DRAFT** | 3000 | 35/40/18/6/1 |
| 5 | `team-100t` | Sobre 100T | 100t | 100T | Americas | **DRAFT** | 3000 | 35/40/18/6/1 |
| 6 | `team-prx` | Sobre Paper Rex | paper-rex | PRX | Pacific | **DRAFT** | 3000 | 35/40/18/6/1 |
| 7 | `team-ns` | Sobre NS | ns | NS | Pacific | **DRAFT** | 3000 | 35/40/18/6/1 |
| 8 | `team-ge` | Sobre GE | ge | GE | Pacific | **DRAFT** | 3000 | 35/40/18/6/1 |
| 9 | `team-xlg` | Sobre XLG | xlg | XLG | China | **DRAFT** | 3000 | 35/40/18/0/0 |

`identity` = `canonicalId` de `teamIdentities.ts`; `team` = alias de **roster actual** (VLR 2026).
Economía **heredada del regional** (`teamPackEconomics`), sin inventar. Ninguno declara
`guaranteedMin`/`guarantees`: el sesgo no es garantía.

## Pools (VPS · `supabase_db_DRLCards`) — RPCs y convención existentes

| pack | pool base (EXPLICIT, prio 100) | entradas base | pool sesgo (RULE, prio 50) | entradas sesgo @5 |
|---|---|---|---|---|
| team-tyl | `pack-team-tyl` ACTIVE | 189 | `boost-team-tyl` ACTIVE | 12 |
| team-karmine | `pack-team-karmine` ACTIVE | 204 | `boost-team-karmine` ACTIVE | 10 |
| team-m8 | `pack-team-m8` ACTIVE | 204 | `boost-team-m8` ACTIVE | 10 |
| team-fut | `pack-team-fut` ACTIVE | 204 | `boost-team-fut` ACTIVE | 10 |
| team-100t | `pack-team-100t` ACTIVE | 182 | `boost-team-100t` ACTIVE | 10 |
| team-prx | `pack-team-prx` ACTIVE | 197 | `boost-team-prx` ACTIVE | 10 |
| team-ns | `pack-team-ns` ACTIVE | 197 | `boost-team-ns` ACTIVE | 10 |
| team-ge | `pack-team-ge` ACTIVE | 197 | `boost-team-ge` ACTIVE | 10 |
| team-xlg | `pack-team-xlg` ACTIVE | 189 | `boost-team-xlg` ACTIVE | 10 |

Convención real: base `pack-<id>` + sesgo `boost-<id>`, peso **5** (medido), modo **RULE**
(repondera sin restringir). `content_distribution_version`: **860** · **48 pools** (30 + 18) ·
**10.602 entradas** · **18 pools `boost-team-*`** en total (4 originales + 5 Ola 1 + 9 Ola 2).

## Rarezas disponibles / NO disponibles (P2, registrado — no corregido)
El sistema económico/catalográfico no se ha tocado. Los pesos declarados por región incluyen
rarezas que estos equipos **no tienen en el catálogo**; el motor las renormaliza (nunca las
reparte), pero la declaración las nombra:

| pack | rarezas con cartas | rarezas DECLARADAS sin cartas elegibles |
|---|---|---|
| team-tyl (China) | común, poco común | — (China declara 0 épica/legendaria) |
| team-xlg (China) | poco común, común | — |
| team-karmine (EMEA) | común, poco común | **épica (6%), legendaria (1%)** declaradas, 0 cartas |
| team-m8 (EMEA) | común, poco común | **épica, legendaria** |
| team-fut (EMEA) | común, poco común | **épica, legendaria** |
| team-100t (Americas) | común, poco común | **épica, legendaria** |
| team-prx (Pacific) | común, poco común | **épica, legendaria** |
| team-ns (Pacific) | común, poco común | **épica, legendaria** |
| team-ge (Pacific) | común, poco común | **épica, legendaria** |

Es el mismo P2 de la Ola 1: los pesos 6/1 de épica/legendaria heredados del regional apuntan a
rarezas que la plantilla actual de estos equipos no tiene. El motor NO se ha cambiado para
esconderlo; `packStats`/`guidance`/`TeamNote` ya advierten estas ausencias cuando un sobre es
público (estos son DRAFT, aún no públicos). A resolver antes de pasar a ACTIVE.

## Validación VPS (por pack) — todo ✅
Medido por SELECT directo en la VPS:
- **existe / ID / región / DRAFT / precio:** ✅ (código) — los 9 en `PACKS`, DRAFT, 3.000, región correcta.
- **pool base + pool boost + vínculo:** ✅ ambos ACTIVE, bind, `enabled`, prioridades 100/50.
- **entradas:** ✅ base 189/204/204/204/182/197/197/197/189 · sesgo 12/10×8.
- **entradas PUBLISHED:** ✅ **0 no-PUBLISHED** en base y sesgo.
- **0 RETIRED · 0 de otro equipo:** ✅ los 9 sesgos con `otro_equipo = 0`.
- **peso:** ✅ sesgo todo 5.0; base todo 1.
- **no comprable / no abrible / no en tienda:** ✅ `buyPack`/`openPackForUser` → 404 server-side
  (test dinámico sobre los 14 Team Packs DRAFT); `isStoreVisible = false` (los 9).

## Tests
- `npm test` **897/897 ✅** (el test de servidor de DRAFT se generalizó a todos los Team Packs
  DRAFT — cubre Ola 1 + 2 sin fijar ids; no se añadió recuento).
- `typecheck` ✅ · `build` ✅ · `security:verify` ✅ · `pack:verify` ✅ · `content:verify` ✅ ·
  `distribution:verify` ✅ (30/0).
- `content-pools:verify` ⛔ no ejecutable aquí (Supabase local caído); sus invariantes se validaron
  por SQL directo en la VPS (arriba).

## Cambios realizados
| archivo | cambio |
|---|---|
| `src/data/packs.ts` | **+9 PackDef DRAFT** (Ola 2) |
| `src/data/teamPackCatalog.ts` | 9 entradas: blocker → `ARTWORK_PENDING` (Leviatán intacto) |
| `src/data/teamPackCatalog.test.ts` | lista de economía heredada +7 (los EMEA/Americas/Pacific de Ola 2) |
| `src/server/services/packLifecycle.test.ts` | test DRAFT generalizado a todos los Team Packs DRAFT |
| `scripts/team-packs-ola1-pools.ts` | acepta ids por CLI (reusado para Ola 2); reasons wave-agnósticos |
| **VPS** | +18 pools, +1.855 entradas, +18 vínculos (RPCs existentes) |

No se tocaron filtros de artwork/packStats/guidance de nuevo: los de la Ola 1 ya excluían DRAFT.

## Confirmaciones
- ✅ 9 Team Packs creados · ✅ todos **DRAFT** · ✅ ninguno ACTIVE · ✅ ninguno comprable · ✅ sin artwork.
- ✅ **Ola 1 intacta** (verificado en BD: boost-team-loud/blg/te/jdg/liquid con sus 16/16/14/14/14
  entradas, revisión sin cambios).
- ✅ **Fnatic / Heretics / G2 / NAVI no modificados** (boost-team-fnatic sigue en 25 entradas).
- ✅ No se creó Ola 3 ni los 6 BLOCKED. · ✅ Gen.G/GEN sin resolver · ✅ roster sin cambios.
- ✅ `content_players.team`, `content_cards`, `content_card_versions`, `user_cards`, `card_mints`,
  `market_listings`, achievements y mastery **no modificados**.
- ✅ Sin migración de esquema · ✅ Sin commit/push/deploy.

Team Packs vivos ACTIVE: `team-heretics`, `team-fnatic`, `team-navi`, `team-g2`.
Team Packs DRAFT: 14 (5 Ola 1 + 9 Ola 2). Pendientes de crear: Leviatán (READY) + 6 BLOCKED.
