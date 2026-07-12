# Módulos FROZEN — Consolidation Fase 1.1 (2026-07-06)

Criterio de esta fase: **"0 consumidores" ya NO significa borrar.** Se borra solo con
`0 consumidores + sin valor de roadmap + sin reutilización prevista`. Todo lo demás se
CONGELA: se conserva tal cual, con su verify como red, y **no crece ni se integra** sin
decisión explícita de producto.

Un módulo FROZEN:
- Mantiene su `scripts/*-verify.ts` en `verify:all` (protege contra bit-rot).
- No recibe features nuevas ni refactors (solo fixes si su verify rompe).
- No debe ser importado por código nuevo de producto sin descongelarlo antes (decisión + plan de wire).

## Congelados (0 consumidores de producto hoy, valor de roadmap)

| Módulo | Verify | Por qué se conserva | Para descongelar hace falta |
|---|---|---|---|
| `src/online/` | online:verify 34/34 | Núcleo del multijugador (server autoritativo + lockstep). | Transporte real (WS/Realtime) + auth + UI. |
| `src/matchmaking/` | matchmaking:verify | Colas/balance para el online. | Online descongelado. |
| `src/competitive/` | competitive:verify | Ranked ladder (MMR/ligas/temporadas). | Online + persistencia servidor. |
| `src/social/` | social:verify | Amigos/party/presencia. | Online + backend. |
| `src/custom/` | custom:verify | Partidas privadas. | Online + UI. |
| `src/tournament/` | tournament:verify | Brackets/series para modos torneo. ⚠️ No confundir con `domain/tournaments` (Supabase, admin). | UI de torneos in-game o wire al mundo. |
| `src/replay/` | replay:verify | Replays por input-log (base F5 online). | UI de replays + spectator wire. |
| `src/platform/cloud/` | platform:verify | Capa de plataforma global (gateway/instances/storage). ⚠️ Sus adapters WS/Realtime/CDN lanzan `throw` — nunca operativos aún. | Backend real. |
| `src/importer/` | importer:verify | Card Generator F1 (modelo canónico). Consumido en solo-lectura por `src/analyzer` (F2/F3), el camino de descongelación previsto. | Fases F4–F7 del Card Generator (features nuevas). |
| `src/battlepass/` + `useBattlePassStore` | battlepass:verify | Pase de temporada data-driven. ⚠️ DUPLICA conceptos del `useEventsStore` legacy que sirve `/eventos` HOY. Descongelar = decidir fusión (sustituir las tripas de eventos por este motor) o matarlo. | Decisión de producto eventos-vs-pase. |
| `src/collection-presentation/` | collection-presentation:verify | Museo/showcase/álbum (proyección read-only). | Pantalla de museo. |
| `src/ui-core/` + `useUiStore` | ui-core:verify | Design system/tema tokens→CSS vars. El DS real hoy es Tailwind+AppShell. Descongelar = inyectar el tema al DOM y adoptar primitivas. | Decisión de DS. |
| `src/navigation/` + `useNavStore` | navigation:verify | Máquina de navegación/ventanas. La nav real es `AppShell` + next/link. | Decisión de shell. |

## Descongelados

- `src/analyzer/` — descongelado el 2026-07-09 por la condición prevista ("Fases F3–F7 del Card
  Generator"): Fase 3 = Performance Analyzer (`analyze()` → `AnalyzerResult`). La API F2
  (`analyzeTournament`) sigue intacta y protegida por analyzer:verify; la F3 la protege
  performance:verify.
- `src/importer/` — consumo en solo-lectura AMPLIADO el 2026-07-11 por decisión explícita
  (Tournament Automation F1/5): `src/importer-vlr/` es el primer `ImportProvider` REAL
  (URL de VLR.gg → `RawSnapshot`). El Importer NO se modificó (cero diffs); importer:verify
  sigue siendo su red y el conector tiene la suya (importer-vlr:verify).

## Parciales (parte viva, parte congelada)

- `src/deck/`: `io` + `types` VIVOS (`useTeamStore`). `engine/analysis/roster/filters/roles` sin
  consumidores — congelados dentro del módulo (el gameplay construye rosters con `lib/match`).
- `src/live/`: consumido solo por `/admin/live`; su único provider es mock. Operativa real
  (providers/cron) pendiente de despliegue.
- `src/spectator/`: `LiveDirector` VIVO (useCoachMatch). `observer/cameras/replayDirector`
  (adiciones Online F5) sin UI — congeladas.
- `src/tactics/economy.ts`: `pistolEconomy` viva (semilla del runtime); la progresión
  (`nextEconomy/applyBuy/buyOf`) solo la usan los reports headless. La economía REAL es `src/economy/`.

## Eliminado en F1.1 (con prueba de 0 consumidores y sin roadmap)

- `src/components/sim/MatchSummary.tsx` — 0 importadores; solapaba con `MatchCeremony` (vivo).
  (Los `MatchSummary` de `src/narrative/*` son un TIPO homónimo, no este componente.)
- `playerHype` (`src/legacy/social.ts`) — 0 consumidores (ni verifies).
- Duplicación de RNG: `src/world/rng.ts` ya no duplica mulberry32 — es adaptador sobre
  `@/sim/rng` (misma secuencia byte a byte, interfaz histórica conservada).
- Duplicación de flash: fórmula única en `sim/attributes.ts::applyBlind` (antes ×3:
  director ×2 + abilities/apply).

## NO eliminado pese a estar en la lista inicial (consumidores demostrados)

- `classifyMarket` (`career/market.ts`) y `coachesFromWorld` (`career/worldBridge.ts`):
  los usa `scripts/career-contracts-verify.ts` — borrarlos habría debilitado un verify.
- `tactics/economy.ts` completo: ver "Parciales".
