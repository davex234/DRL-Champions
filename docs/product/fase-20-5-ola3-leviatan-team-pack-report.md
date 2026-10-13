# FASE 20.5 — OLA 3 — TEAM PACK DE LEVIATÁN

> Nombre de fichero en ASCII (`leviatan`) para evitar un nombre con acento en el repo; el producto
> se llama **Sobre Leviatán**.

## Objetivo
Crear ÚNICAMENTE el Team Pack de Leviatán como **DRAFT**, con el mismo patrón exacto de las Olas 1
y 2: producto en código + pool base (EXPLICIT) + pool de sesgo (RULE, peso 5) en la VPS. Sin tocar
nada más.

## Implementación
Patrón idéntico a Ola 1/2, sin arquitectura nueva ni reglas hardcodeadas. El sesgo lo aporta el
pool `boost-team-lev` (RULE) vía el sistema existente (`composeDistribution` + `pickWeighted`); el
motor **no** lee el equipo. Las entradas se calcularon con `buildPool` (motor real) y se
persistieron con las RPC existentes (`app_content_pool_upsert`/`set_entries`/`pack_bind`/`publish`),
mediante `scripts/team-packs-ola1-pools.ts team-lev`.

## Pack creado
| campo | valor |
|---|---|
| packId | `team-lev` |
| name | Sobre Leviatán |
| team (alias actual) | `LEV` |
| región | Americas |
| precio / cartas / pesos | 3000 · 5 · 35/40/18/6/1 (heredado del regional Americas, `teamPackEconomics`) |
| lifecycle | **DRAFT** |
| guaranteedMin / guarantees | ninguno (el sesgo no es garantía) |

## Identidad utilizada
`teamIdentities.ts` → `canonicalId: "leviatan"`, `currentAliases: ["LEV"]`, `status: verified`.
Se usa la identidad ACTUAL (`LEV`), sin mezclar histórica ni aliases ambiguos, sin merges.
**`teamIdentities.ts` no se ha modificado** (no fue necesario: Leviatán ya estaba resuelto).

## Pool base
`pack-team-lev` · EXPLICIT · prioridad 100 · lifecycle **ACTIVE** · **182 entradas** (todas las
cartas Americas elegibles del sobre, peso 1) · **100% PUBLISHED**, 0 RETIRED. Vinculado a `team-lev`.

## Pool boost
`boost-team-lev` · RULE · weight **5** · prioridad 50 · lifecycle **ACTIVE** · **10 entradas** (las
10 cartas de `LEV`) · **100% PUBLISHED**, 0 RETIRED, **0 de otro equipo**. Vinculado a `team-lev`.
Sin `if (team === …)`: la selección es por el sistema de pools/reglas existente.

## Lifecycle
DRAFT: no aparece en tienda (`isStoreVisible=false`), no comprable, no abrible públicamente. La
protección es **server-side** (`guardPurchase`/`guardPublicOpen` en `server/services/packs.ts`,
Fase 20.4): compra y apertura devuelven 404 **antes de tocar la BD**. Sistema general de lifecycle
sin modificar.

## Validación VPS (1–19) — todo ✅
Medido por SELECT directo contra la VPS (`supabase_db_DRLCards`):

| # | comprobación | resultado |
|---|---|---|
| 1 | existe `pack-team-lev` | ✅ |
| 2 | pack lifecycle DRAFT | ✅ (código) |
| 3 | no existe como ACTIVE | ✅ |
| 4 | pool base existe | ✅ `pack-team-lev` |
| 5 | `boost-team-lev` existe | ✅ |
| 6 | base es EXPLICIT | ✅ |
| 7 | boost es RULE | ✅ |
| 8 | boost weight = 5 | ✅ (5.0–5.0) |
| 9 | prioridades correctas | ✅ base 100 / boost 50 |
| 10 | ambos ACTIVE | ✅ |
| 11 | vinculados al pack | ✅ `team-lev:100/true`, `team-lev:50/true` |
| 12 | boost 100% PUBLISHED | ✅ (no_pub=0) |
| 13 | 0 RETIRED | ✅ |
| 14 | 0 de otro equipo | ✅ (otro=0) |
| 15 | base 100% PUBLISHED | ✅ (182, no_pub=0) |
| 16 | no en tienda | ✅ `isStoreVisible=false` |
| 17 | comprar DRAFT rechazado server-side | ✅ 404, sin tocar BD (test) |
| 18 | abrir DRAFT rechazado server-side | ✅ 404, sin tocar BD (test) |
| 19 | rechazos no modifican la BD | ✅ (fake client que lanza al tocarse) |

`content_distribution_version`: **868** · **50 pools** · **10.794 entradas** · **19 pools
`boost-team-*`** (4 originales + 5 Ola 1 + 9 Ola 2 + 1 Ola 3).

## Tests
- `npm test` **897/897 ✅** · `typecheck` ✅ · `build` ✅.
- `security:verify` ✅ · `pack:verify` ✅ · `content:verify` ✅ · `distribution:verify` ✅ (30/0).
- `content-pools:verify` ⛔ **no ejecutable localmente** (apunta a Supabase local; Docker
  desinstalado). **No se reinstaló Docker ni se tocó el entorno local.** Sus invariantes se
  validaron equivalentemente por SQL directo en la VPS (tabla de arriba).
- Ajustes de test **no artificiales**: la entrada de Leviatán en `teamPackCatalog.ts` pasó su
  packId a `team-lev` y su blocker a `ARTWORK_PENDING` (producto creado); la lista de economía
  heredada del test de precio sumó `team-lev`. El test server-side de DRAFT ya era dinámico (cubre
  Leviatán sin cambios).

## Regresión (solo lo pedido) — ✅
Verificado en BD: `boost-team-fnatic` 25 entradas (rev 4, intacto), `boost-team-g2` 10,
`boost-team-loud` 16 (Ola 1), `boost-team-tyl` 12 (Ola 2) — sin cambios. Sin cambios en cartas,
usuarios, mercado ni mastery.

## Cambios realizados
| archivo | cambio |
|---|---|
| `src/data/packs.ts` | **+1 PackDef DRAFT** (`team-lev`) |
| `src/data/teamPackCatalog.ts` | entrada Leviatán: packId `team-lev`, blocker `ARTWORK_PENDING` |
| `src/data/teamPackCatalog.test.ts` | +`team-lev` en la lista de economía heredada |
| `scripts/team-packs-ola1-pools.ts` | (ya aceptaba ids por CLI desde Ola 2; reusado con `team-lev`) |
| **VPS** | +2 pools (`pack-team-lev`, `boost-team-lev`), +192 entradas, +2 vínculos |

## Cambios explícitamente NO realizados
`content_players.team`, `content_cards`, `content_card_versions`, `user_cards`, `card_mints`,
`market_listings`, `mastery`, `achievements`, `roster_changes`, decks, combat engine, pack draw
engine, economía global, `teamIdentities.ts`, artwork/CardVisual/assets, los 4 Team Packs vivos,
Ola 1, Ola 2, Fnatic. Sin cartas nuevas, sin motor tocado, sin reglas globales, sin migración de
esquema, sin commit/push/deploy, sin Ola 4, sin los 6 BLOCKED, sin resolver Gen.G/GEN.

## P2 restante (registrado, no corregido)
Leviatán tiene **solo cartas poco comunes** (10). El sobre hereda del regional Americas los pesos
de épica (6%) y legendaria (1%), rarezas que su plantilla **no tiene**. El motor las renormaliza
(nunca las reparte) — comportamiento existente, **no modificado**. Como los demás Team Packs de
rareza baja, es una decisión a resolver antes de pasar a ACTIVE (precio/rareza). No se ha tocado el
motor para esconderlo.

## Estado final
`team-lev` creado como **DRAFT**, con pool base (182) y boost (10 @5) ACTIVE y vinculados,
protegido server-side, verificado contra la VPS. **897/897 tests, typecheck, build y verifiers en
verde.** Ola 1/2 y los 4 Team Packs vivos, intactos.

Team Packs: **4 ACTIVE** (heretics, fnatic, navi, g2) · **15 DRAFT** (5 Ola 1 + 9 Ola 2 + Leviatán).
Pendientes: los 6 BLOCKED (identidad sin resolver).
