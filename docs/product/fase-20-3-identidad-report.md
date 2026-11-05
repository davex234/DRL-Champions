# FASE 20.3 — IDENTIDAD ACTUAL / HISTÓRICA — AUDITORÍA + DISEÑO DEL MODELO

**Estado: DISEÑO. Sin código, sin migración, sin escrituras.** Solo auditoría del modelo actual
y propuesta. Base verificada contra la VPS en la Fase 20.2 (212.95.40.144, `supabase_db_DRLCards`,
773 content_cards / 379 content_players / 20 pools).

---

## A. Modelo actual de identidad

Hay **dos planos de "equipo" que no se tocan entre sí**:

### Plano de CONTENIDO (el que usan cartas, pools y Team Packs)
- **`content_players.team`** — un **`text` libre** (`Fnatic`, `FNC`, `Gen.G`, `GEN`, `TL`…). Es el
  mismo valor que `Player.team` en `src/data/players.ts`.
- Se **materializa desde el código**, no desde el circuito en vivo: `content-catalog:migrate`
  hace `upsert content_players` con el roster de `buildRoster()` (semilla editorial + VLR 2026,
  **gana la semilla**). `vlr-sync` **no escribe aquí**.
- **La carta NO guarda equipo.** `content_cards` tiene `player_id`, no `team`. Y
  `content_card_versions` **tampoco** snapshotea el equipo (columnas: player_id, variant_id, ovr,
  combat, stats, rarezas, source, checksum, ventana de vigencia — ningún `team`).
- Por tanto **el equipo de una carta se deriva SIEMPRE en vivo**: `getPlayer(c.playerId).team`.
  No existe en ninguna parte "el equipo con el que se creó esta carta".

### Plano de ESPORTS (el circuito real; NO lo usan las cartas)
- **`teams`** (`0002_data_engine`) con `team_id` estable (`vlr-t-XXXX`), más `standings`,
  `team_stats`, `player_event_stats`, `roster_changes`, `tournament_teams`, `team_ratings`.
- Lo alimenta `vlr-sync` → `vlrSnapshotSource` (resuelve `teamId(name)` por nombre/tag).
- **Tiene identidad por ID y hasta un histórico de cambios de plantilla (`roster_changes`).**

### El puente que NO existe
`content_players` **no tiene `team_id`** ni ninguna FK al plano de esports. El roster VLR 2026
importado (`players-vct-2026.json`) trae `team`/`teamTag` como **strings**, sin `team_id`. Los dos
planos solo coinciden por coincidencia de texto.

**Resumen:** la identidad de equipo del contenido jugable es un string libre, derivado en vivo,
sin ancla a la identidad canónica que el plano de esports sí tiene.

---

## B. Todos los puntos donde `team` significa a la vez "actual" e "histórico"

Un único string hace los dos trabajos en todos estos sitios:

| # | punto | fichero | qué "team" significa ahí |
|---|---|---|---|
| 1 | elegibilidad de carta→equipo | `progression/achievements.ts:27`, `packs/packIdentity.ts:184` | `getPlayer(c.playerId).team` — **actual**, aplicado a cartas **históricas** |
| 2 | conjuntos de maestría | `collection/mastery.ts:118-128` `equipo:${slug(team)}` | agrupa cartas históricas por el team **actual** del jugador |
| 3 | logro `completa-heretics` | `achievements.ts:34,98` | "Team Heretics" (identidad **editorial/histórica**) |
| 4 | filtro de equipo del mercado | `mercado/page.tsx:60,557,560` | lista `distinct p.team` — mezcla actual e histórico, y duplica `Gen.G`/`GEN` |
| 5 | sesgo de Team Pack (pools) | `content-pools-boost.ts:118` `registry.player().team === pack.team` | el sesgo se calcula sobre el team **actual** del `content_players` |
| 6 | escudo/monograma del sobre | `packIdentity.ts:166`, `TeamLogo.tsx` | `teamMonogram(pack.team)` — string, sin canónico |
| 7 | ficha de carta | `CardViewer.tsx:88,102,222`, `CardRenderer.tsx:280` | `getTeam(player.team)` — el equipo que se pinta ES el actual del jugador |
| 8 | búsqueda/orden de colección | `collection/filter.ts:36`, `collection/sort.ts:17,41` | string actual |
| 9 | índices del catálogo | `catalog-builder/catalog.ts:63` `byTeam[p.team]` | string actual |
| 10 | referencia de mercado (sync) | `api/market/sync-reference/route.ts:40`, `services/market.ts:121` | `player.team` actual escrito en la vista de referencia |

**El caso que lo demuestra:** Derke tiene 8 cartas con `player.team = "Fnatic"` (identidad
editorial), pero VLR 2026 lo sitúa en **VIT**. Hoy esas 8 cartas son "de Fnatic" a todos los
efectos (maestría, sesgo del sobre Fnatic, filtro de mercado, escudo pintado) **y** se
comportarían como "de VIT" en el instante en que alguien pusiera `content_players.team = "VIT"`.
El mismo campo decide las dos cosas y no se puede separar.

---

## C. Propuesta de modelo canónico

Dos conceptos **explícitos y distintos**, ninguno de los cuales borra al otro:

```
CURRENT_TEAM_IDENTITY   = a qué equipo canónico pertenece el JUGADOR hoy (roster VLR 2026)
HISTORICAL_TEAM_CONTEXT = con qué equipo se creó/acuñó una CARTA concreta (no cambia nunca)
```

### C.1 Registro canónico de equipos (capa de DATO, como `data/teams.ts`)
Un `TeamIdentity` explícito y verificable, **sin fusionar datos**:

```
TeamIdentity {
  canonicalId   // slug estable, p.ej. "gen-g"
  displayName   // "Gen.G"
  tag           // "GENG"
  region
  currentAliases[]     // valores de Player.team que HOY son este equipo (roster actual)
  historicalAliases[]  // valores que fueron este equipo en el pasado
  status: "verified" | "unverified"
}
```

Regla de la decisión de producto: **un alias NO entra en `currentAliases` hasta que la identidad
actual es verificable**. Mientras no lo sea, se queda como `historical` o `unverified`, y
`Gen.G`/`GEN` se mantienen **separados** (dos entradas, o una con el alias marcado unverified),
sin ningún `UPDATE` de `content_players.team`.

### C.2 Resolución por concepto
- **Team Pack / elegibilidad de pool** → resuelve por `CURRENT_TEAM_IDENTITY` (el jugador está
  hoy en el equipo). Una carta histórica de un jugador que ya no está en el equipo **puede seguir
  existiendo** y, según se decida, entrar o no en el sesgo — pero la elegibilidad la manda la
  identidad actual, no el string histórico.
- **Ficha de carta / colección / maestría de una carta concreta** → `HISTORICAL_TEAM_CONTEXT`:
  la carta conserva el equipo con el que nació.

### C.3 Dónde vive `HISTORICAL_TEAM_CONTEXT`
Hoy es **implícito** (= `player.team` actual), que es justo el bug. Dos opciones:
- **Mínima (esta fase / la siguiente sin tocar producción):** capa de código que, para las
  cartas ya existentes, define el contexto histórico = el `team` con el que se materializaron
  (el valor actual del seed), y para las nuevas lo **snapshotea al crearlas**.
- **Completa (futura, aditiva):** columna nullable `team_context` en `content_cards` (y, si se
  quiere trazabilidad por versión, en `content_card_versions`), rellenada solo en altas nuevas y
  hacia atrás por un backfill auditado. **No en esta fase.**

**Idea central:** separar "quién es el equipo hoy" (mutable, del roster actual) de "de qué equipo
es esta carta" (inmutable, del momento de acuñación). Hoy son la misma casilla.

---

## D. Migración mínima necesaria (NO ejecutar en esta fase)

Estrictamente **aditiva**, sin reescribir nada:

1. **Registro de identidad como DATO en código** (`src/data/teamIdentities.ts`) — no requiere
   cambio de esquema, igual que `data/teams.ts`. Es lo único imprescindible para desbloquear
   Team Packs por identidad actual.
2. **Resolución en la capa de dominio**: helpers `currentTeamIdentity(playerId)` y
   `historicalTeamContext(cardId)` que todo consumidor use en lugar de leer `player.team` crudo.
3. (Opcional, fase posterior) columna `content_cards.team_context text NULL` — additiva,
   backfill auditado, sin tocar `card_id` ni seriales.

**Ninguna de las 3 toca `content_players.team`, ni hace merge de `Gen.G`/`GEN`.** El warning de
20.2 se resuelve por **resolución explícita**, no por `UPDATE`.

---

## E. Qué datos NO deben tocarse

`user_cards` · `card_mints` · `card_id` · seriales · `content_card_versions` · `market_listings`
· y **`content_players.team` (sin `UPDATE` masivo)**. Todos van por `card_id` (`player__variant`),
que no lleva equipo, así que la identidad histórica ya está preservada por diseño en el id — lo
que falta es **exponerla**, no reescribirla.

---

## F. Impacto sobre Team Packs
- La elegibilidad pasa a resolverse por `CURRENT_TEAM_IDENTITY`. Los 15 equipos PARTIAL con
  identidad única quedan claros; los 6 BLOCKED se desbloquean **en cuanto su identidad actual sea
  verificable** en el registro (no antes).
- `PackDef.team` (string) pasaría a ser un `canonicalId`; `content-pools-boost` resolvería las
  cartas del equipo por identidad, no por igualdad de string. Es un cambio de **resolución**, no
  del motor (sigue siendo pool `RULE` + `pickWeighted`).

## G. Impacto sobre Gen.G / GEN
- **Se mantienen separados** (decisión 4). El registro los declara como dos identidades, o una
  canónica con `GEN` en `currentAliases` (verificable: VLR 2026) y `Gen.G` en
  `historicalAliases` — **pero solo si se verifica que son la misma entidad**; hasta entonces,
  `status: unverified` y sin unir.
- **Cero escrituras.** Ni `content_players`, ni `user_cards`, ni maestría. El "warning" deja de
  ser una anomalía y pasa a ser un estado declarado (`unverified`).

## H. Impacto sobre Heretics / Fnatic
- Hoy `team-heretics`→"Team Heretics" y `team-fnatic`→"Fnatic" sesgan la plantilla **editorial**
  (benjy/wo0t; Derke/Boaster/Alfajer/Chronicle), no la actual (`TH`: riens/boo/koshmaras; `FNC`:
  kaajak/crashies/…). Bajo identidad actual, **deberían** sesgar el roster actual.
- Corregirlo = re-apuntar `boost-team-heretics`/`boost-team-fnatic` (una **escritura** a pools
  activos). **Deferido**: se documenta como deuda, no se toca en esta fase.

## I. Impacto sobre achievements / mastery
- **Riesgo de huérfanos.** Los escalones reclamados se guardan como `masteryRef(setId, at)` en
  `user_achievements` (4 filas en la VPS hoy). El `setId` es `equipo:${slug(team)}`. Si la
  canonicalización **cambia el slug**, esas filas quedan huérfanas y el jugador "pierde" premios
  ya reclamados.
- **Regla de diseño:** el registro debe mantener **estables los `setId` existentes** (mapear
  canónico → slug ya usado, o conservar los conjuntos históricos). La maestría es
  `HISTORICAL_TEAM_CONTEXT` por naturaleza (colecciono cartas, no fichajes).
- `completa-heretics` (8.000 créditos) cuenta "Team Heretics": es identidad histórica; no debe
  cambiar su conjunto sin decisión explícita.

## J. Impacto sobre mercado
- `market_listings` guarda solo `card_id` (0 riesgo de datos). En la VPS hay **1** listado.
- El **filtro** de `mercado/page.tsx` construye la lista con `distinct p.team`, así que hoy
  enseña `Gen.G` **y** `GEN` como dos equipos, y arrastra el mojibake `KRÜ`. La capa canónica
  colapsa el **display** del filtro sin tocar ningún listado.
- `market/sync-reference` escribe `player.team` (actual) en la vista de referencia: pasaría a
  escribir el canónico; es una vista derivada, regenerable, no historia.

## K. Tests necesarios
1. `resolve(alias)` → canonicalId, para todos los alias declarados; alias desconocido → no
   resuelve (no inventa).
2. `currentTeamIdentity` ≠ `historicalTeamContext` cuando difieren (caso Derke/Fnatic/VIT).
3. Team Pack: la elegibilidad usa identidad **actual**; una carta histórica no la ensancha.
4. **Gen.G/GEN siguen separados** mientras `status=unverified`; ningún helper los fusiona.
5. **No-merge:** el modelo no produce ningún `UPDATE` de `content_players.team` (test de que la
   capa es solo lectura sobre ese campo).
6. **Estabilidad de `setId` de maestría:** los slugs existentes no cambian → cero huérfanos en
   `user_achievements`.
7. Filtro de mercado deduplica por canónico sin alterar listados; `KRÜ` normalizado en display.
8. Carta histórica conserva su contexto aunque cambie el team actual del jugador (simulado).
9. Cobertura del registro: todo `content_players.team` con cartas resuelve a una identidad
   (actual o histórica declarada); ninguno queda sin clasificar.

## L. Riesgo P0 / P1 / P2
- **P0:** ninguno. Nada en producción cambia en esta fase (solo diseño).
- **P1 — el más importante:** el vínculo carta→equipo es **derivado en vivo** y no hay snapshot.
  Cualquier `UPDATE` futuro de `content_players.team` (p. ej. para "actualizar el roster")
  **reescribe la historia** de todas las cartas de ese jugador de golpe: maestría, sesgo de
  sobres, filtros, escudos. El modelo de identidad **debe existir antes** de cualquier
  actualización de roster.
- **P1 — huérfanos de recompensa:** canonicalizar sin preservar los `setId` de maestría orfana
  premios ya reclamados (`user_achievements`).
- **P2:** (a) los sobres Heretics/Fnatic sesgan plantilla editorial, no actual; (b) filtro de
  mercado con `Gen.G`/`GEN` duplicados y `KRÜ` roto; (c) `content_players` y el plano de esports
  no comparten `team_id` — la identidad canónica del contenido no está anclada a la del circuito,
  que sí la tiene (`teams`/`roster_changes`); (d) `players-vct-2026.json` no trae `team_id`, así
  que el ancla habría que construirla por nombre.

---

## Conclusión
El bloqueo no es de infraestructura ni de datos: es que **una sola casilla (`team`) codifica dos
verdades distintas**. La salida es una capa de identidad explícita (actual vs. histórica) que se
**resuelve**, no que **reescribe** — respetando que `Gen.G`/`GEN` sigan separados hasta ser
verificables, y sin tocar `card_id`, seriales, `user_cards`, `card_mints`, `market_listings` ni
`content_players.team`.

**Siguiente paso recomendado (no ejecutado):** implementar §D.1–D.2 (registro `teamIdentities.ts`
+ helpers de resolución) con los tests de §K, dejando §D.3 (columna `team_context`) y el
re-apuntado de pools (§H) como fases posteriores auditadas.

**FASE 20.3 — DISEÑO ENTREGADO.** Sin migraciones, sin escrituras, sin commit.
