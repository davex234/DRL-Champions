# QA visual · Fase 35 — Card Game Modes 2.0 · Road to Champions

QA SYNTHETIC: definición REAL (`rtc-1`, 3 capítulos, 15 nodos), rivales REALES (equipos verificados y mazos del catálogo calculados con `buildOpponentPlan`, el mismo del servidor) y partidas del motor canónico (`qaSimulate`). Inventado: el progreso de cada escena, los equipos del jugador y los objetivos. Sin servidor, sin Supabase, sin Docker.
Generadas con `npx tsx scripts/_fase35-visual-qa.ts` contra la app en :3005. `63-*` con prefers-reduced-motion; `64*` rutas reales; `65–67` desafíos del día (objetivos diarios existentes).
Leyenda de nodos visibles: ✓ completado · ◉ disponible · 🔒 bloqueado.

| captura | ancho | escena | comprobaciones |
|---|---|---|---|
| `01-game-modes-hub-1440.png` | 1440 | scene=hub-full |  |
| `01-game-modes-hub-1024.png` | 1024 | scene=hub-full |  |
| `01-game-modes-hub-390.png` | 390 | scene=hub-full |  |
| `02-hub-new-player-1440.png` | 1440 | scene=hub-new-player |  |
| `02-hub-new-player-390.png` | 390 | scene=hub-new-player |  |
| `03-hub-no-valid-deck-1440.png` | 1440 | scene=hub-no-deck |  |
| `03-hub-no-valid-deck-390.png` | 390 | scene=hub-no-deck |  |
| `04-hub-in-match-1440.png` | 1440 | scene=hub-in-match |  |
| `05-hub-ranked-provisional-1440.png` | 1440 | scene=hub-provisional |  |
| `06-hub-signed-out-1440.png` | 1440 | scene=hub-signed-out |  |
| `06-hub-signed-out-390.png` | 390 | scene=hub-signed-out |  |
| `07-hub-campaign-unavailable-1440.png` | 1440 | scene=hub-campaign-unavailable |  |
| `08-hub-offline-390.png` | 390 | scene=hub-offline |  |
| `09-hub-campaign-complete-1440.png` | 1440 | scene=hub-campaign-complete |  |
| `10-campaign-map-new-player-1440.png` | 1440 | scene=map-fresh | nodos 0✓ 1◉ 14🔒 |
| `10-campaign-map-new-player-1024.png` | 1024 | scene=map-fresh | nodos 0✓ 1◉ 14🔒 |
| `10-campaign-map-new-player-390.png` | 390 | scene=map-fresh | nodos 0✓ 1◉ 14🔒 |
| `11-campaign-map-in-progress-1440.png` | 1440 | scene=map-mid | nodos 7✓ 1◉ 7🔒 |
| `11-campaign-map-in-progress-1024.png` | 1024 | scene=map-mid | nodos 7✓ 1◉ 7🔒 |
| `11-campaign-map-in-progress-390.png` | 390 | scene=map-mid | nodos 7✓ 1◉ 7🔒 |
| `12-chapter-complete-1440.png` | 1440 | scene=map-chapter1-complete | nodos 5✓ 1◉ 9🔒 |
| `13-final-boss-available-1440.png` | 1440 | scene=map-near-end | nodos 14✓ 1◉ 0🔒 |
| `14-campaign-complete-1440.png` | 1440 | scene=map-complete | nodos 15✓ 0◉ 0🔒 |
| `14-campaign-complete-390.png` | 390 | scene=map-complete | nodos 15✓ 0◉ 0🔒 |
| `15-migration-not-applied-1440.png` | 1440 | scene=map-unavailable | nodos 0✓ 0◉ 15🔒 |
| `15-migration-not-applied-390.png` | 390 | scene=map-unavailable | nodos 0✓ 0◉ 15🔒 |
| `16-map-signed-out-1440.png` | 1440 | scene=map-signed-out | nodos 0✓ 1◉ 14🔒 |
| `17-map-offline-1440.png` | 1440 | scene=map-offline | nodos 7✓ 1◉ 7🔒 |
| `17-map-offline-390.png` | 390 | scene=map-offline | nodos 7✓ 1◉ 7🔒 |
| `18-backend-error-1440.png` | 1440 | scene=map-backend-error |  |
| `19-backend-error-with-last-snapshot-1440.png` | 1440 | scene=map-stale-error | nodos 7✓ 1◉ 7🔒 |
| `20-node-in-progress-1440.png` | 1440 | scene=map-active-attempt | nodos 7✓ 1◉ 7🔒 |
| `21-no-deck-1440.png` | 1440 | scene=map-no-deck | nodos 0✓ 1◉ 14🔒 |
| `22-first-node-lost-390.png` | 390 | scene=map-first-loss | nodos 0✓ 1◉ 14🔒 |
| `23-chapter-locked-1440.png` | 1440 | scene=chapter-locked | nodos 5✓ 1◉ 9🔒 |
| `24-node-locked-1440.png` | 1440 | scene=node-locked | nodos 7✓ 1◉ 7🔒 · CTA LOCKED |
| `24-node-locked-390.png` | 390 | scene=node-locked | nodos 7✓ 1◉ 7🔒 · CTA LOCKED |
| `25-node-available-1440.png` | 1440 | scene=node-available | nodos 7✓ 1◉ 7🔒 · CTA PLAY |
| `26-node-completed-replay-1440.png` | 1440 | scene=node-completed | nodos 7✓ 1◉ 7🔒 · CTA REPLAY |
| `27-node-elite-1440.png` | 1440 | scene=node-elite | nodos 7✓ 1◉ 7🔒 · CTA REPLAY |
| `28-node-boss-1440.png` | 1440 | scene=node-boss | nodos 14✓ 1◉ 0🔒 · CTA PLAY |
| `28-node-boss-390.png` | 390 | scene=node-boss | nodos 14✓ 1◉ 0🔒 · CTA PLAY |
| `29-node-invalid-deck-edit-team-1440.png` | 1440 | scene=node-invalid-deck | nodos 7✓ 1◉ 7🔒 · CTA EDIT_TEAM |
| `30-node-no-deck-1440.png` | 1440 | scene=node-no-deck | nodos 0✓ 1◉ 14🔒 · CTA CREATE_TEAM |
| `31-node-unavailable-1440.png` | 1440 | scene=node-unavailable | nodos 0✓ 0◉ 15🔒 · CTA UNAVAILABLE |
| `32-node-offline-390.png` | 390 | scene=node-offline | nodos 7✓ 1◉ 7🔒 · CTA OFFLINE |
| `33-node-resume-1440.png` | 1440 | scene=node-resume | nodos 7✓ 1◉ 7🔒 · CTA RESUME |
| `34-other-node-in-progress-1440.png` | 1440 | scene=node-busy-elsewhere | nodos 7✓ 1◉ 7🔒 · CTA BUSY_ELSEWHERE |
| `35-node-signed-out-1440.png` | 1440 | scene=node-signed-out | nodos 0✓ 1◉ 14🔒 · CTA SIGN_IN |
| `36-node-bottom-sheet-390.png` | 390 | scene=node-mobile-sheet | nodos 7✓ 1◉ 7🔒 · CTA PLAY |
| `37-campaign-prematch-1440.png` | 1440 | scene=prematch-available |  |
| `37-campaign-prematch-1024.png` | 1024 | scene=prematch-available |  |
| `37-campaign-prematch-390.png` | 390 | scene=prematch-available |  |
| `38-prematch-replay-1440.png` | 1440 | scene=prematch-replay |  |
| `39-prematch-boss-1440.png` | 1440 | scene=prematch-boss |  |
| `39-prematch-boss-390.png` | 390 | scene=prematch-boss |  |
| `40-prematch-invalid-deck-1440.png` | 1440 | scene=prematch-invalid-deck |  |
| `41-prematch-no-decks-1440.png` | 1440 | scene=prematch-no-decks |  |
| `42-prematch-locked-1440.png` | 1440 | scene=prematch-locked |  |
| `43-prematch-active-match-error-1440.png` | 1440 | scene=prematch-error |  |
| `44-match-intro-campaign-1440.png` | 1440 | scene=match-intro |  |
| `44-match-intro-campaign-390.png` | 390 | scene=match-intro |  |
| `45-match-board-campaign-rival-1440.png` | 1440 | scene=match-board |  |
| `45-match-board-campaign-rival-390.png` | 390 | scene=match-board |  |
| `46-result-node-completed-1440.png` | 1440 | scene=result-first-clear | resultado win |
| `46-result-node-completed-1024.png` | 1024 | scene=result-first-clear | resultado win |
| `46-result-node-completed-390.png` | 390 | scene=result-first-clear | resultado win |
| `47-result-try-again-1440.png` | 1440 | scene=result-loss | resultado loss |
| `47-result-try-again-390.png` | 390 | scene=result-loss | resultado loss |
| `48-result-draw-1440.png` | 1440 | scene=result-draw | resultado draw |
| `49-result-replay-win-1440.png` | 1440 | scene=result-replay-win | resultado win |
| `50-result-chapter-complete-1440.png` | 1440 | scene=result-chapter-complete | resultado win |
| `51-result-campaign-complete-1440.png` | 1440 | scene=result-campaign-complete | resultado win |
| `52-result-pending-sync-390.png` | 390 | scene=result-pending-sync | resultado pending |
| `53-progress-x-of-y-1440.png` | 1440 | scene=hero-progress |  |
| `53-progress-x-of-y-390.png` | 390 | scene=hero-progress |  |
| `54-first-clear-economy-1440.png` | 1440 | scene=economy |  |
| `55-empty-and-error-states-1440.png` | 1440 | scene=notices |  |
| `55-empty-and-error-states-390.png` | 390 | scene=notices |  |
| `56-own-profile-integration-1440.png` | 1440 | scene=profile-badge |  |
| `56-own-profile-integration-390.png` | 390 | scene=profile-badge |  |
| `57-home-nextup-secondary-1440.png` | 1440 | scene=home-nextup |  |
| `57-home-nextup-secondary-390.png` | 390 | scene=home-nextup |  |
| `58-navigation-1440.png` | 1440 | scene=navigation |  |
| `59-rival-real-team-composition-1440.png` | 1440 | scene=rival-composition |  |
| `60-boss-node-visual-1440.png` | 1440 | scene=boss-node | nodos 7✓ 1◉ 7🔒 |
| `61-energy-lines-1024.png` | 1024 | scene=energy-lines | nodos 7✓ 1◉ 7🔒 |
| `62-keyboard-focus-node-1440.png` | 1440 | scene=keyboard | foco en c1-n1 · nodos 0✓ 1◉ 14🔒 |
| `63-reduced-motion-1440.png` | 1440 | scene=reduced-motion · reduced-motion | nodos 0✓ 1◉ 14🔒 |
| `63-reduced-motion-390.png` | 390 | scene=reduced-motion · reduced-motion | nodos 0✓ 1◉ 14🔒 |
| `64-real-route-jugar-1440.png` | 1440 | ruta real /jugar sin Supabase local |  |
| `64-real-route-jugar-390.png` | 390 | ruta real /jugar sin Supabase local |  |
| `64b-real-route-road-to-champions-1440.png` | 1440 | ruta real del mapa sin Supabase local |  |
| `64b-real-route-road-to-champions-390.png` | 390 | ruta real del mapa sin Supabase local | nodos 0✓ 1◉ 14🔒 |
| `65-daily-pve-challenges-1440.png` | 1440 | scene=daily-challenges |  |
| `65-daily-pve-challenges-390.png` | 390 | scene=daily-challenges |  |
| `66-daily-pve-none-1440.png` | 1440 | scene=daily-none |  |
| `67-daily-pve-unavailable-1440.png` | 1440 | scene=daily-error |  |

Capturas con desbordamiento horizontal: 0. Errores de consola propios (sin 404 de fotos ni Supabase ausente): 0.
