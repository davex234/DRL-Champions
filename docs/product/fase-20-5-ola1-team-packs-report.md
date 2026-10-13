# FASE 20.5 — OLA 1 — CREACIÓN DE TEAM PACKS (LOUD, BLG, TE, JDG, Team Liquid)

**Estado: 5 Team Packs creados como DRAFT.** Producto en código + pools (base + sesgo) en la VPS.
Ninguno ACTIVE, ninguno comprable, sin artwork. Motor de distribución y economía intactos.

## Los 5 productos

| # | packId | name | identity (teamIdentities) | team (alias actual) | región | lifecycle | precio | cartas | pesos |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `team-loud` | Sobre LOUD | loud | LOUD | Americas | **DRAFT** | 3000 | 5 | 35/40/18/6/1 |
| 2 | `team-blg` | Sobre BLG | blg | BLG | China | **DRAFT** | 3000 | 5 | 35/40/18/0/0 |
| 3 | `team-te` | Sobre TE | te | TE | China | **DRAFT** | 3000 | 5 | 35/40/18/0/0 |
| 4 | `team-jdg` | Sobre JDG | jdg | JDG | China | **DRAFT** | 3000 | 5 | 35/40/18/0/0 |
| 5 | `team-liquid` | Sobre Team Liquid | team-liquid | TL | EMEA | **DRAFT** | 3000 | 5 | 35/40/18/6/1 |

`team` = alias de **roster actual** (VLR 2026) de `teamIdentities.ts`, para que el sesgo seleccione
solo la plantilla de hoy (los 5 tienen 0 cartas históricas fuera de lugar). El motor no lee `team`.
Economía **heredada del regional** (`teamPackEconomics`): EMEA/Americas 3.000/5/35-40-18-6-1;
China 35-40-18-**0-0** (sin épicas/legendarias, Fase 13). Precio final = decisión de producto abierta.

## Pools (VPS · `supabase_db_DRLCards`) — creados con las RPC existentes

| pack | pool base (EXPLICIT, prio 100) | entradas base | pool sesgo (RULE, prio 50) | entradas sesgo @5 |
|---|---|---|---|---|
| team-loud | `pack-team-loud` ACTIVE | 182 | `boost-team-loud` ACTIVE | 16 |
| team-blg | `pack-team-blg` ACTIVE | 189 | `boost-team-blg` ACTIVE | 16 |
| team-te | `pack-team-te` ACTIVE | 189 | `boost-team-te` ACTIVE | 14 |
| team-jdg | `pack-team-jdg` ACTIVE | 189 | `boost-team-jdg` ACTIVE | 14 |
| team-liquid | `pack-team-liquid` ACTIVE | 204 | `boost-team-liquid` ACTIVE | 14 |

Convención real del proyecto: base `pack-<id>` + sesgo `boost-<id>`, iguales a los 4 Team Packs
de la Fase 20. Peso **5** (medido, leído de `content-pools-boost.ts`). Modo **RULE**: repondera
sin restringir — **no es una garantía** (ningún pack declara `guaranteedMin`/`guarantees`).

`content_distribution_version`: 788 · **30 pools** (20 previos + 10 nuevos) · **8747 entradas**
(7720 + 953 base + 74 sesgo).

## Validación (1–15)

| # | comprobación | resultado |
|---|---|---|
| 1 | existen | ✅ 5 en `PACKS` + 10 pools en BD |
| 2 | lifecycle = DRAFT | ✅ los 5 |
| 3 | identidad correcta | ✅ `team` = alias actual de `teamIdentities` |
| 4 | región | ✅ Americas/China/China/China/EMEA |
| 5 | precio | ✅ 3000, heredado del regional |
| 6 | pool | ✅ base + sesgo, ACTIVE |
| 7 | vínculo pack→pool | ✅ ambos `bind`, `enabled` |
| 8 | nº de entradas | ✅ base 182/189/189/189/204 · sesgo 16/16/14/14/14 |
| 9 | entradas PUBLISHED | ✅ **0 no-PUBLISHED** en base y sesgo (SQL) |
| 10 | ninguna RETIRED | ✅ 0 RETIRED |
| 11 | ninguna de otro equipo | ✅ **0 `otro_equipo`** en los 5 sesgos (SQL) |
| 12 | pesos | ✅ sesgo todo 5.0; base todo 1 |
| 13 | DRAFT no comprable | ✅ `buyPack` → 404 sin tocar BD (test) |
| 14 | DRAFT no en tienda | ✅ `isStoreVisible` = false (test) |
| 15 | API rechaza compra directa | ✅ guarda server-side en el servicio (Fase 20.4) |

Comprobaciones 9–12 medidas por SELECT directo en la VPS; 13–15 por test de servicio.

## Distribución — sesgo sin garantía
El motor sigue siendo el mismo: pool base (pertenencia) + pool RULE (peso 5) aplicados por
`composeDistribution` + `pickWeighted`. Sin `if/else` por pack. La calibración de la Fase 20.5A
(motor real) ya midió estos 5: cuota del equipo ×3,5–4, ~1 carta/sobre, y **siempre quedan sobres
sin ninguna carta del equipo** (no hay garantía).

## Pruebas
- `npm test` **897/897 ✅** (896 + 1 test nuevo de la Ola 1).
- `typecheck` ✅ · `build` ✅ · `security:verify` ✅ · `pack:verify` ✅ · `content:verify` ✅ ·
  `distribution:verify` ✅ (30/0).
- `content-pools:verify` ⛔ **no ejecutable en este entorno**: apunta a `127.0.0.1:54521` (Supabase
  local, Docker desinstalado). Sus invariantes se validaron **equivalentemente por SQL directo** en
  la VPS (pertenencia PUBLISHED, equipo correcto, pesos, vínculos, versión de distribución).

### Ajustes de test (no artificiales)
Los DRAFT son la primera aparición de sobres «en preparación». Tres invariantes de **producto
público** se hicieron conscientes del ciclo de vida (excluyen DRAFT), porque un DRAFT no se vende
ni tiene aún artwork:
- `packStats.test` / `guidance.test`: `PAID` = `price>0 && !isDraft` (RETIRED sigue incluido).
- `packs.test` (manifiesto de artwork): cubre solo productos no-DRAFT.
- `teamPackCatalog.ts` (+ su test): los 5 pierden `PRODUCT_NOT_CREATED`/`POOL_PENDING_DB` (ya
  existen), conservan `ARTWORK_PENDING`; el test de precio suma `team-loud`/`team-liquid` a la lista
  de economía heredada. Es la auditoría 20.2 quedando veraz tras crear los productos.
Nada se debilitó para pasar en verde: los invariantes siguen vigilando los productos públicos.

## Cambios realizados
| archivo | cambio |
|---|---|
| `src/data/packs.ts` | **+5 PackDef DRAFT** (Ola 1) |
| `src/domain/packs/lifecycle.ts` | **+`isDraft()`** |
| `src/data/teamPackCatalog.ts` | 5 entradas: blocker → `ARTWORK_PENDING` (producto creado) |
| `src/data/packStats.test.ts`, `guidance.test.ts`, `packs.test.tsx`, `teamPackCatalog.test.ts` | filtros conscientes de DRAFT |
| `src/server/services/packLifecycle.test.ts` | **+test** de los 5 DRAFT (rechazo server-side) |
| `scripts/team-packs-ola1-pools.ts` | **nuevo** — genera el SQL de pools (reusa RPCs/pesos) |
| `scripts/_fase20-5a-audit.ts` | instrumento de la auditoría previa (ya existía) |
| **VPS** | +10 pools, +1027 entradas, +10 vínculos (RPC existentes) |

## Problemas encontrados
- **Entorno:** `content-pools:verify`/`distribution` locales apuntan a Supabase local (caído); se
  validó por SQL en la VPS. Sin impacto en el trabajo.
- **Rareza baja (P2 conocido):** los 5 solo dan común/poco común (China) o casi (LOUD/TL declaran
  6/1 épica/legendaria pero **no tienen** esas cartas → el motor renormaliza; la tienda ya lo
  avisaría vía `TeamNote`). Es propiedad del catálogo, no un fallo; pendiente para su paso a ACTIVE.

## Confirmaciones explícitas
- ✅ Team Packs 1–5 creados. · ✅ Todos **DRAFT**. · ✅ Ninguno **ACTIVE**. · ✅ Ninguno comprable.
- ✅ Ningún artwork generado. · ✅ Ningún Team Pack adicional creado (los otros 10 READY y los 6
  BLOCKED, intactos).
- ✅ **Fnatic no modificado** (`boost-team-fnatic` sin tocar). · ✅ Equipos BLOCKED no modificados.
- ✅ `content_players.team`, `content_cards`, `content_card_versions`, `user_cards`, `card_mints`,
  `market_listings`, achievements y mastery **no modificados**. · ✅ Pools `boost-team-*` existentes
  (fnatic/heretics/g2/navi) no modificados.
- ✅ Sin migración de esquema. · ✅ Sin commit/push/deploy.
