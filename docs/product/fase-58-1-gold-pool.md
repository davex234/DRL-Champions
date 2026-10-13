# F58.1 — Sobre Oro: coherencia de pool (hotfix)

2026-09-24 · **GO.** El comportamiento de apertura NO cambia: 200.000 de 200.000 aperturas son idénticas, con las mismas semillas, antes y después.

Evidencia en `docs/product/qa/fase58-1-gold-pool/`:

| Fichero | Contenido |
|---|---|
| `pool-snapshot-before.json` | Volcado real de la BD, v942 |
| `pool-snapshot-after.json` | Volcado real de la BD, v946 |
| `equivalence-before.json` | Equivalencia sin pool frente al pool propuesto |
| `equivalence-after.json` | Equivalencia de la BD real tras el cambio frente al pool propuesto |
| `gold-pool-APPLIED-by-autocommit.sql` | Lo que se ejecutó |
| `gold-pool-corrected-NOT-RUN.sql` | El generador ya corregido; no se ha ejecutado |

## Causa exacta

- **Todos los sobres llevan un pool de elegibilidad `pack-<id>`.** Es EXPLICIT, con peso 1, prioridad 100 y miembros `buildPool(pack).flat`. Lo crean `content-pools:migrate` y lo mantiene `cartas-db-pools` con las RPC oficiales.
- **En la línea principal ese pool SÍ forma parte del mecanismo.** `openByClass` → `classPool` → `buildPool(pack, dist)` interseca la elegibilidad con los miembros del pool. La tabla por clase F57.3 decide la **probabilidad** y el pool decide **qué cartas entran**.
- **El Sobre Oro se añadió en F57.x, después de provisionar los pools.** Nadie creó su vínculo: `cartas-db-pools` además se niega a crear pools nuevos.
- Sin pool, Oro caía a las reglas del `PackDef`, que hoy son las mismas 331 cartas. Por eso no cambiaba ninguna apertura, pero Oro quedaba **fuera de la administración de pools**: retirar una carta de los pools no la habría sacado de Oro.

**Veredicto: problema de DATOS (opción A).** El panel no malinterpretaba nada. Aun así, se mejora su explicación.

## Cambio

**BD.** `pack-oro` creado con el mecanismo canónico de `content-pools:migrate`, solo para Oro. Son 4 RPC oficiales, con auditoría y subida de la versión de distribución (942 → 946):

1. `app_content_pool_upsert` (EXPLICIT)
2. `app_content_pool_set_entries` (331 entradas, peso 1)
3. `app_content_pack_bind` (prioridad 100)
4. `app_content_pool_publish` (ACTIVE)

**Verificado en la BD:**

- miembros = `pack-estandar` (ni una más ni una menos);
- peso 1, `INCLUDE`;
- un único vínculo;
- 0 entradas rotas.

**Panel.**

- La ficha de cada sobre tiene un bloque «Cómo obtiene sus cartas»: 1. Probabilidad (tabla por clase F57.3 o pesos por rareza) y 2. Elegibilidad (pool `pack-<id>`), y lista cada pool con su papel (elegibilidad o refuerzo de equipo), su número de cartas y su prioridad.
- El check «Sobres y pools» usa la misma regla: `drawSourceOf` / `packsMissingEligibilityPool`.
- Estado actual: verde, «6 por clase F57.3 · 26 por rareza».

**Regresión.** `src/domain/admin/goldPool.test.ts` fija:

- la regla del panel;
- el contrato de datos sobre la foto real tras F58.1 (todos los sobres públicos tienen su `pack-<id>`, y `pack-oro` coincide con los otros 5 y con `buildPool`);
- la equivalencia de 3.000 aperturas con y sin pool.

## Incidencia en la ejecución (declarada)

El «ensayo con ROLLBACK» **se aplicó de verdad**:

- el generador escribía `\set` dentro de un template literal y el backslash se perdió;
- psql unió `set ON_ERROR_STOP on` con `BEGIN;` en una sola sentencia inválida;
- cada RPC se autoconfirmó.

Lo aplicado es exactamente el estado final previsto, y su verificación dentro de la BD pasó. No se ha reejecutado: el generador ya está corregido (`String.raw`). No hubo backup específico previo; el punto de restauración es el backup pre-0055 de esta mañana. Para deshacerlo bastaría `app_content_pack_bind('oro','pack-oro',100,'unbind',…)`.

## Antes / después

| | Antes | Después |
|---|---|---|
| Vínculo de Oro | ninguno | `pack-oro` @100 |
| Cartas elegibles | 331 (reglas del PackDef) | 331 (pool, idénticas) |
| Aperturas iguales (200.000, mismas semillas) | — | **200.000 / 200.000** |
| % por carta (Oro/Masters/Champions/Prime/Icon) | 49,957 / 23,020 / 10,033 / 10,020 / 6,970 | idéntico |
| Tabla F57.3 | 50 / 23 / 10 / 10 / 7 | igual |

## Intacto

- **F57.3:** `packCardClass`, `mainPackDistribution` y probabilidades.
- **F57.6:** precios, cartas por sobre, `marketValue`, desguace e Icon.
- **F58:** rutas y seguridad (tests en verde).
- **Cuentas:** tu cuenta y la cuenta QA no se tocaron. No se compraron ni abrieron sobres.
- **`src/design/tokens.ts`:** no tocado.

## Gates

| Gate | Resultado |
|---|---|
| Tests | 5066 → **5070/5070** |
| tsc web y scripts | 0 errores |
| eslint | 0 errores, 27 avisos (los mismos) |
| build | PASS |
| Migraciones | 0 nuevas (cabeza 0055) |
