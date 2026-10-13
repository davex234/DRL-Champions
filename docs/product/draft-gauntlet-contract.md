# DRAFT GAUNTLET — contrato (Fase 39, `draft-gauntlet-1`)

> **CONSTRUYE. ADÁPTATE. SOBREVIVE.** Nombre visible único: **DRAFT GAUNTLET**.

Modo PvE: el jugador entra **sin su equipo**, el servidor crea una **run**, ofrece **10 elecciones de 3 cartas reales**
y, con la plantilla legal de 10, se juegan **5 combates** consecutivos con el **motor canónico**. Ganar avanza; perder
o empatar termina la run. **Recompensa v1: ninguna.**

## 1. Identidad

| Cosa | Valor | Dónde |
|---|---|---|
| Nombre / lema | `DRAFT GAUNTLET` / «Construye. Adáptate. Sobrevive.» | `src/domain/draft/rules.ts` |
| Reglas de la run | `draft-gauntlet-1` (`draft_runs.rules_version`) | `DRAFT_RULES_VERSION` |
| Modo de partida | `duel_matches.mode = 'DRAFT_GAUNTLET'` (0053) | `DRAFT_MATCH_MODE`, `DRAFT_GAUNTLET_MODE` |
| Motor | `duel-combat-2` (reglas) + `duel-turns-2` (orquestador) | `launchPve` en `services/duels.ts` |
| Ruta | `/jugar/draft-gauntlet`; arena `/duelos/jugar?draft=1` | |
| API | `GET` / `POST /api/game/draft-gauntlet` | `src/app/api/game/draft-gauntlet/route.ts` |

## 2. Invariantes del mazo (confirmados en el código, no en el brief)

`validateDuelDeck` (`src/domain/cardgame/deck.ts`) + `DUEL_COMPOSITION`: **10 cartas**, **2 Duelista · 2 Controlador ·
2 Iniciador · 2 Centinela · 2 Flex** (Flex es un rol, no comodín), sin carta repetida, sin jugador repetido (variantes
de un mismo jugador cuentan como el mismo), una sola `dataVersion`. Pins: D09, D23, D25, K16.

El draft **no tiene validador propio**: la plantilla pasa por `draftDeckCheck` (`services/duels.ts`), que construye
`OwnedCard` sintéticos con uids UUID derivados de la run (sin serial, sin `user_cards`) y llama a `validateDuelDeck`.

## 3. Run

| Estado | Significado | Transiciones |
|---|---|---|
| `DRAFTING` | eligiendo (pick 1..10) | pick → `DRAFTING` / `READY` (tras el 10.º) · abandon |
| `READY` | plantilla completa, combate `stage` listo | start_match → `IN_MATCH` · abandon |
| `IN_MATCH` | combate `stage` abierto (`current_match_id`) | liquidación → `READY` (stage+1) / `COMPLETED` / `FAILED` · abandon |
| `COMPLETED` | 5/5 victorias | final |
| `FAILED` | derrota o empate | final |
| `ABANDONED` | abandonada con confirmación | final |

Activos = `DRAFTING/READY/IN_MATCH` (máx. **uno por usuario**, índice único parcial). Finales tienen `completed_at`.

**Estado persistido** (`draft_runs.state`, jsonb ≤ 32 KB): `rulesVersion`, `dataVersion`, `roleOrder[10]`, `picks[]`,
`offers[][]` (TODAS las ofertas mostradas), `rivals[5]` (fijados al completar el draft) y `actions[≤40]` (idempotencia).
La **semilla** vive en su columna (`bigint`, 32 bits) y **nunca** sale al cliente.

## 4. Generación (pura, determinista, sin `Math.random`)

- `roleOrderFor(seed)`: barajado Fisher-Yates de los 10 huecos (2 por rol) con el RNG serializable del proyecto.
- `buildDraftPool`: cartas con `combat`, jugador resoluble con rol de duelo y **una** `dataVersion` (la más común).
  **Ofrecibles** = `lifecycle === PUBLISHED`; **resolubles** = además las retiradas de esa versión (una oferta ya
  persistida sigue siendo válida si la carta se retira después). El ciclo de vida de **sobres** no interviene.
- `offerFor(pool, seed, pick, role, picks)`: hasta 3 cartas **del rol del hueco**, **jugadores distintos**, excluyendo
  cartas y jugadores ya elegidos, prefiriendo **equipos distintos**; uniforme (sin rareza ponderada, sin pity).
- Legalidad por construcción: cada hueco pide el rol que falta y excluye lo elegido ⇒ al 10.º el mazo es legal si cada
  rol tiene ≥ 2 jugadores (`poolIsSolvable`; si no, `start` → 503 `POOL_UNAVAILABLE`).
- `rivalDeckFor(pool, seed, stage)`: 2 por rol, jugadores distintos, dentro de la banda de OVR de la etapa
  (percentiles `[0,.6] [.2,.8] [.2,.8] [.4,1] [.5,1]`); no toca stats.
- Sin etiquetas `MEJOR/RECOMENDADA/META`.

## 5. Gauntlet

| Etapa | Etiqueta | Bot | Rival |
|---|---|---|---|
| 1 | 01 | EASY (0) | NEXUS Challenger |
| 2 | 02 | NORMAL (0,5) | NEXUS Contender |
| 3 | 03 | NORMAL (0,5) | NEXUS Vanguard |
| 4 | 04 | HARD (0,85) | NEXUS Elite |
| 5 | FINAL | HARD (0,85) | NEXUS Apex |

Nombres originales NEXUS: no se presentan como equipos reales. Lineal, sin ramas.

**Resultado:** sale SIEMPRE de `duel_matches.state.result` (desempate canónico ya aplicado por el motor).
`WIN` → stage+1 (o `COMPLETED` en la 5) · `LOSS` → `FAILED` · `DRAW` → `FAILED` («en el gauntlet solo avanza quien
gana»). Sin desempate extra.

## 6. API

| Acción | Cuerpo (lista cerrada, ≤ 1 KB) | Respuesta |
|---|---|---|
| `GET` | sin query | `DraftSnapshot` (no-store). Reconcilia una run `IN_MATCH` terminada; en otro estado no escribe |
| `start` | `action, actionId` | crea o devuelve la run activa |
| `pick` | `action, actionId, expectedVersion, choiceId` | una elección de la oferta actual |
| `start_match` | `action, actionId, expectedVersion` | lanza o devuelve el combate de la etapa (`matchId`) |
| `abandon` | `action, actionId, expectedVersion, confirm: true` | `ABANDONED` |

- Usuario **solo del token**. Campo extra → 400 `FIELD_NOT_ALLOWED`. `actionId` UUID; `expectedVersion` entero ≥ 1;
  `choiceId` con forma `jugador__variante`.
- Errores: 401 · 400 · 413 · 404 `NO_RUN` · 409 `STALE_VERSION` / `WRONG_STATE` / `INVALID_PICK` (`reason`) /
  `DECK_INVALID` (con `snapshot` fresca para resincronizar) · 429 · 503 (`MIGRATION_PENDING`, `POOL_UNAVAILABLE`, genérico).
- Rate limit: cubetas `draft_read` y `draft_write` (`services/rateLimit.ts`).

**Concurrencia:** toda mutación es `update … where id and user_id and version = esperada and status = …`. Cero filas →
se relee: mismo `actionId` ya registrado → misma respuesta (idempotente); si no → 409 con foto. `start` concurrente lo
resuelve el índice único (23505 → devuelve la ganadora). `start_match` reclama la run (`READY → IN_MATCH` con
`current_match_id`) **antes** de crear la partida; si el lanzamiento falla vuelve a `READY`; una reclamación huérfana
> 2 min sin partida se libera al leer. Liquidar reclama `STARTED → SETTLED` y la run `IN_MATCH(match) → siguiente`:
dos liquidaciones = una transición.

## 7. Aislamiento (P0)

| No afecta | Cómo |
|---|---|
| Economía (créditos, sobres, cartas, XP, XP de pase, puntos) | `playTurn` no llama a `awardMatchOutcome` en `DRAFT_GAUNTLET`; `DRAFT_REWARD` = 0; servicio sin RPC |
| `user_cards`, seriales, favoritos, vitrina, equipos permanentes | no se escriben; plantilla con uids sintéticos, `deck_id` null |
| Rating / ranked | rating solo `mode = 'PVP'` |
| Road to Champions | campaña solo `mode = 'PVE'`; el draft liquida SU run |
| Misiones / logros / vestíbulo / eventos / `packs_opened` | contadores con `.neq("mode","DRAFT_GAUNTLET")` |
| Partida rápida | `active`/`abandon` de `/api/game/duel` ignoran partidas del draft |
| Información oculta | la foto no lleva semilla, ofertas futuras ni mazos rivales; la arena usa la misma vista redactada |

## 8. Cliente

- Una opción se **elige** (vista previa) y solo **CONFIRMAR ELECCIÓN** envía. Teclado: `1/2/3` eligen, `Enter`
  confirma solo con vista previa y nunca por repetición, `Esc` cancela.
- La vista previa es un pie `fixed` sobre la barra móvil (+ hueco): `sticky` no se pega en DRLCards.
- 3 `Card3D` como máximo (las opciones); plantilla con miniaturas estáticas. `MotionConfig reducedMotion="user"`.
- Sin conexión: última foto, todas las acciones desactivadas; nada en `localStorage`.
- `VER CARTA` → `/coleccion/carta/[id]` (la ficha dice NO CONSEGUIDA si no la tienes). Sin serial, sin «nueva».
- Hub `/jugar`: tarjeta `DRAFT_GAUNTLET` («Construye una plantilla carta a carta y supera cinco rivales.»); sin entrada
  nueva en la navegación; el vestíbulo no cambia de prioridad.
- Final de combate: `ResultScreen` canónico con `mode="DRAFT_GAUNTLET"` («no da créditos, sobres ni XP en esta
  versión») + `DraftResultBanner` leído de la run liquidada.

## 9. Base de datos (0053)

`draft_runs`, `draft_run_matches`, modo `DRAFT_GAUNTLET` en los CHECK de `duel_matches`. RLS activada **sin políticas**,
`REVOKE ALL` a `anon`/`authenticated`, solo `service_role`. Sin funciones ni `SECURITY DEFINER`. Ver
`fase-39-migration-0053-draft-gauntlet.md`.
