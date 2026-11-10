# Reemplazo total del catálogo de cartas — NO-GO antes del borrado

**Fecha:** 2026-09-21. **Estado de la BD:** intacta. No se ha borrado, insertado ni modificado
ninguna carta, jugador, pool, propiedad ni mazo. **Originales de `Cartas\`:** intactos (solo
lectura; ni renombrados, ni movidos, ni convertidos).

La regla del encargo (§22) se aplica: *si quedan cartas AMBIGUOUS o INVALID que impidan construir
correctamente el catálogo, no se borra la base actual.* Además, el análisis ha encontrado que el
reemplazo **no es un cambio de datos**: el catálogo vive en el código. Este documento dice
exactamente qué bloquea y qué hace falta decidir.

Manifiesto completo: `docs/product/catalog-replace/NEW_CATALOG_MANIFEST.json` (una entrada por
imagen) y resumen `NEW_CATALOG_MANIFEST.csv`.

---

## 1 · La carpeta `Cartas\`

| Medida | Resultado |
|---|---|
| Ficheros | **343**, todos PNG, carpeta plana, sin subcarpetas |
| Dimensiones / modo | 343 × **1288×1800 RGBA** (proporción 0,7156) |
| Peso | 1,36–3,05 MB (mediana 1,86 MB), **683 MB** en total |
| Corruptos | **0** (`PIL.verify()` + carga completa) |
| Duplicados exactos (SHA-256) | **0** |
| No-imagen | **0** |
| Equipos (prefijo del nombre) | **41**, de 5 a 20 cartas cada uno |
| Patrón de nombre | `EQUIPO JUGADOR[ (EDICIÓN)].png` — 343/343 lo cumplen |
| Ediciones (paréntesis) | sin paréntesis **180** · `MASTERSsdc` **60** · `MASTERSl` **60** · `Future Star` **20** · `ChampionsS` **20** · `Record Breaker` **2** · `zMoments` **1** |
| Datos impresos en cada carta | OVR, código de rol, bandera, logo de equipo, nombre, **DMG · SCR · FKS · HS · AST · CLU**, icono de circuito |
| Roles impresos | `DLT` 73 · `FLX` 72 · `SEN` 67 · `INT` 66 · `SMO` 65 (Duelista, Flex, Centinela, Iniciador, Controlador) |
| OVR | **70–95** |

**Cómo se ha leído cada carta.** Equipo, jugador y edición salen del nombre de fichero. OVR, rol y
las 6 estadísticas salen de la imagen, leídos **dos veces con dos modelos de visión distintos**
(qwen3-vl 8b y 4b, locales): coinciden exactamente en **342 de 343**; la discrepante (NRG MADA,
«DLT» frente a «DRT») se revisó a ojo. Muestra aleatoria de 8 SAFE revisada visualmente: **8/8
exactas** (más 5 de la prueba inicial).

**Identidad del jugador.** Contra `content_players` (379, BD real): 293 por nick exacto y 37 por
equivalencia «leet» **única** (`SOPP` → `s0pp`, `DAVAI` → `d4v41`, `WOOT` → `wo0t`…). 48 cartas
llevan un equipo distinto del que tiene el jugador en datos (fichajes); se conserva el de la carta.
No se ha deduplicado por jugador: 90 jugadores tienen varias cartas (hasta 4), todas legítimas.

| Estado | Cartas |
|---|---|
| **SAFE** | **330** (196 jugadores) |
| **AMBIGUOUS** | **0** |
| **INVALID** | **13** |

Ids propuestos: `playerId__edición` (p. ej. `s0pp__future-star`), **únicos**; el contrato
`playerId__variantId` y la CHECK `content_cards_identity` de 0037 siguen valiendo.

## 2 · El sistema actual (medido, no supuesto)

### 2.1 El catálogo NO está en la base de datos: se GENERA en el código

- `src/data/catalog.ts:189` → `CARDS = buildCatalog(PLAYERS)`, calculado **al importar el módulo,
  en el navegador y en el servidor**, a partir de `src/data/players.ts` (26 jugadores editoriales)
  + `src/data/vlr/players-vct-2026.json` (371 jugadores con métricas VLR reales).
- `content_cards` (773 filas: 772 `PUBLISHED` + 1 `RETIRED` legado) es una **materialización** de
  ese cálculo (`scripts/content-catalog-migrate.ts`).
- El **servidor** lee `content_cards` (`src/server/catalog/index.ts:225-258`); el **cliente** usa su
  catálogo calculado y sólo AÑADE lo que no conoce (`registerServerCards`, `catalog.ts:236-256`).

**Consecuencia:** vaciar `content_cards` e insertar 343 filas nuevas dejaría al navegador enseñando
las 772 antiguas mientras el servidor sirve otras → estado corrupto. El reemplazo exige cambiar la
FUENTE del catálogo en el código (de «generado desde jugadores» a «manifiesto de cartas»).

### 2.2 Qué necesita una carta para funcionar en el juego

| Campo | De dónde sale hoy | ¿Lo dan las cartas nuevas? |
|---|---|---|
| `combat` {stronghold, gamesense, entryfrag} — **lo usa el duelo** (`cardgame/resolve.ts` falla con `CARD_NO_COMBAT`) | métricas VLR reales del jugador + boost de la variante | **No** (no está impreso). Derivable sólo para jugadores con métricas, y sin boost de edición (no hay regla para las ediciones nuevas) |
| `ovr` — desempate del duelo y presentación | `computeCombatOvr(combat)` | **Sí, impreso**; pero NO coincide con la fórmula (SOPP: impreso 79) → dos OVR distintos |
| `stats` 6 de presentación | `dmg/scr/com/hs/ast/clu` | **Sí, impresos**, pero el modelo nuevo es `DMG/SCR/FKS/HS/AST/CLU`: **FKS ≠ COM** |
| `role` en el duelo (mazo = 2 por rol) | del **jugador**, no de la carta | **Sí, impreso en la carta**, y a veces distinto del jugador (MARTEEN y PATMEN = FLX) |
| `variantId` + `rank` → rareza, boost, serie, sobre | unión cerrada de 37 variantes (`types.ts:126-171`) | **Ediciones nuevas no modeladas** (7) |

### 2.3 Dependencias en BD (esquema real, conteos reales)

- Catálogo, con FK reales: `content_cards` ⇄ `content_card_versions` (RESTRICT en los dos
  sentidos), `content_cards.player_id → content_players` (RESTRICT),
  `content_pool_entries.card_id → content_cards` (RESTRICT, **10.794 filas**),
  `content_card_market_anchor` (CASCADE, 0), `content_pools` 50 / `content_pack_pools` 50,
  `content_catalog_version` / `content_distribution_version`.
- Instancias **sin FK** (`card_id text`, el riesgo de huérfanos): `user_cards` **213** (9 cuentas),
  `card_mints` 51, `card_reference` 13, `market_listings` 1, `transactions` 1, `card_price_*`,
  `market_audit` 595; arrays de uid: `duel_decks.card_uids` (5 mazos, 3 activos),
  `player_profile_customization.showcase_card_uids` (2). `user_card_favorites`, `inventory`,
  `collection_items`: 0.
- **Propiedad:** las 213 copias son de cuentas demo/QA/test (`NEXUSDemo` 76 y ocho cuentas
  `qa_*`/`econ*` en `@example.invalid`/`@nexus.test`). Ningún usuario real.

### 2.4 Código y pruebas que dependen del catálogo anterior

- 31 sobres (`src/data/packs.ts`) filtran por grupo de variante, región y equipo; 50 pools en BD
  listan los ids antiguos.
- Road to Champions: 15 rivales construidos del roster real, cada uno exige ≥3 jugadores y 2
  cartas por rol (`domain/campaign/opponent.ts`).
- Ids fijos: recompensas de eventos (`derke__masters-mvp`, `wo0t__ewc-mvp`,
  `aspas__champions-mvp`), logro «primer-icon» (`*__icon-series`), simulador de economía.
- > 60 pruebas unitarias y ~30 verificadores de CI fijan `772`, `773`, variantes concretas,
  ids concretos, distribuciones de rareza (`packStats.ts` generado) y la suma de control.

## 3 · Bloqueos (en orden de gravedad)

### B1 · 13 cartas de jugadores que NO existen en los datos del juego (INVALID)

| Fichero | Jugador |
|---|---|
| `100T CRYO.png` | CRYO |
| `BBL ROSÉ.png`, `BBL ROSÉ (MASTERSsdc).png` | Rosé (existe en `players` como `vlr-p-5565`, pero no en `content_players`, sin métricas) |
| `EDG JIENI (MASTERSl).png` | JIENI |
| `ENVY CANEZERRA.png`, `ENVY INSPIRE.png`, `ENVY ION.png` | CANEZERRA, INSPIRE, ION |
| `FUT BAHA.png`, `FUT MRFALIN.png` | BAHA, MRFALIN |
| `KC SHEYDOS.png` | SHEYDOS |
| `LOUD PANCADA.png` | PANCADA |
| `NAVI SHAO.png` | SHAO |
| `RRQ XFERRO.png` | XFERRO |

Una carta necesita su jugador (`content_cards.player_id → content_players`, RESTRICT) y, para
poder jugarse, métricas VLR para su `combat`. Crearlos sin datos sería inventar jugadores.

### B2 · El catálogo vive en el código (ver § 2.1)

No se puede reemplazar sólo en la BD sin dejar al cliente con las 772 antiguas. Hace falta cambiar
la fuente del catálogo, el render (tres renderizadores) y regenerar pools: es un cambio de
arquitectura, no de datos, y toca gameplay (combate, OVR, rol) y economía (sobres, rarezas).

### B3 · El modelo de la carta nueva no encaja con el del juego (ver § 2.2)

FKS en lugar de COM; OVR impreso distinto del calculado; rol impreso distinto del del jugador en
**122 de 330**; 7 ediciones sin rareza, rango, boost ni serie definidos; `combat` no impreso.

### B4 · Sobres, campaña, eventos y logros apuntan al catálogo anterior (ver § 2.4)

Decisión de producto por sobre y por rival; no se improvisa.

## 4 · Decisiones de producto que hacen falta (no se pueden inventar)

1. **Rareza por edición.** ¿Qué rareza (y qué `rank`, que decide boost, serie y sobres) tiene cada
   edición: base, Future Star, MASTERS l, MASTERS sdc, Champions S, Record Breaker, Moments?
   ¿Y qué significan `l`, `sdc` y `S`?
2. **Estadísticas.** ¿Las 6 impresas sustituyen a las de presentación (cambiando COM por FKS)?
3. **OVR.** ¿Manda el OVR impreso (también en el desempate del duelo) o el calculado del combate?
4. **Combate de las ediciones especiales.** ¿Sin boost (igual que la base del jugador) o con uno por
   edición? Hoy el boost sale del `rank` de la variante.
5. **Rol.** ¿Manda el rol impreso en la carta (DLT/SEN/FLX…) o el del jugador? Hoy manda el del
   jugador, y en varias cartas no coinciden.
6. **Propiedad y mazos antiguos (213 copias, 5 mazos, todas de cuentas demo/QA).** ¿Se borran (con
   copia de seguridad) o se conservan como `RETIRED` (el modelo ya tiene ese estado)? Borrarlas
   cumple «0 cartas antiguas»; retirarlas cumple «0 activas» sin tocar propiedad.
7. **Sobres.** ¿Qué entra en cada sobre con 343 cartas y 7 ediciones? ¿Se mantienen los 31
   (inicial, estándar, premium, regionales, equipos…)?
8. **Campaña.** Con 5-6 cartas por equipo, varios rivales de Road to Champions no llegan a 2 cartas
   por rol. ¿Se ajusta la campaña o se mantiene con menos rivales?
9. **Los jugadores sin datos** (ver § 3): ¿se añaden con datos reales (y de qué fuente), o se dejan
   fuera del catálogo?

## 5 · Plan propuesto una vez decidido (nada de esto se ha ejecutado)

1. **Assets.** Derivados WEBP en `public/cards/<card_id>.webp` (≈1288×1800 → 750×1048, ~150 KB);
   maestros intactos en `Cartas\`. Manifiesto `cardId → imagen` (patrón de `src/data/packArtwork.ts`).
2. **Fuente del catálogo.** `src/data/catalog.ts` pasa a leer el manifiesto (una carta por imagen,
   id `playerId__edición` — el contrato `playerId__variantId` y la CHECK de 0037 siguen valiendo) y
   los jugadores siguen en `content_players` (la identidad no se borra con las cartas).
3. **Render.** `PlayerCard` (≈30 pantallas), `DuelCard` y `CardThumb` pintan la imagen por `cardId`;
   el renderizado por capas queda como respaldo.
4. **BD, en una transacción:** backup `pg_dump` verificado de las tablas de § 2.3 → según la
   decisión 6, retirar o borrar propiedad/mazos antiguos → borrar pools, versiones y cartas antiguas
   → insertar las nuevas + versiones + pools regenerados → verificar 0 referencias rotas → COMMIT
   (o ROLLBACK).
5. **Pruebas:** reescribir las que fijan el catálogo anterior por las invariantes equivalentes del
   nuevo (tamaño = manifiesto, ids únicos, cada carta con imagen, etc.), sin debilitarlas.
