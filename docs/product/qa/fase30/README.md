# QA visual · Fase 30 (QA SYNTHETIC: eventos, equipos, jugadores, partidos y cartas inventados con nombres ficticios; motor real del cuadro; sin servidor)

Generadas con `npx tsx scripts/_fase30-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase30?scene=…` (`fixtures.ts`).
Movimiento activado salvo en `40-*` (prefers-reduced-motion). `41-*` es la ruta real sin backend.

| captura | ancho | escena |
|---|---|---|
| `01-events-overview-1440.png` | 1440 | overview |
| `01-events-overview-1024.png` | 1024 | overview |
| `01-events-overview-390.png` | 390 | overview |
| `02-multiple-active-events-1440.png` | 1440 | overview-multi |
| `02-multiple-active-events-390.png` | 390 | overview-multi |
| `03-upcoming-event-1440.png` | 1440 | overview-upcoming |
| `04-completed-event-1440.png` | 1440 | overview-completed |
| `05-event-hub-active-1440.png` | 1440 | hub |
| `05-event-hub-active-1024.png` | 1024 | hub |
| `05-event-hub-active-390.png` | 390 | hub |
| `06-event-hub-upcoming-1440.png` | 1440 | hub-upcoming |
| `06-event-hub-upcoming-390.png` | 390 | hub-upcoming |
| `07-event-hub-completed-1440.png` | 1440 | hub-completed |
| `07-event-hub-completed-390.png` | 390 | hub-completed |
| `08-live-match-1440.png` | 1440 | hub |
| `09-no-live-match-1440.png` | 1440 | hub-no-live |
| `10-multiple-live-matches-1440.png` | 1440 | hub-two-live |
| `10-multiple-live-matches-390.png` | 390 | hub-two-live |
| `11-next-match-390.png` | 390 | hub-no-live |
| `12-match-center-1440.png` | 1440 | match |
| `12-match-center-1024.png` | 1024 | match |
| `12-match-center-390.png` | 390 | match |
| `13-match-completed-1440.png` | 1440 | match-done |
| `13-match-completed-390.png` | 390 | match-done |
| `14-match-tbd-maps-1440.png` | 1440 | match-tbd |
| `14-match-tbd-maps-390.png` | 390 | match-tbd |
| `15-pickems-pending-1440.png` | 1440 | hub |
| `16-pickems-complete-1440.png` | 1440 | hub-pickems-done |
| `16-pickems-complete-390.png` | 390 | hub-pickems-done |
| `17-no-pickems-1440.png` | 1440 | hub-no-pickems |
| `17-no-pickems-390.png` | 390 | hub-no-pickems |
| `18-bracket-1440.png` | 1440 | bracket |
| `18-bracket-1024.png` | 1024 | bracket |
| `19-no-bracket-league-1440.png` | 1440 | hub-league |
| `19-no-bracket-league-390.png` | 390 | hub-league |
| `20-teams-standings-1440.png` | 1440 | hub-completed |
| `21-players-1440.png` | 1440 | hub |
| `22-event-cards-1440.png` | 1440 | hub |
| `23-collection-progress-1440.png` | 1440 | hub |
| `24-team-pack-active-1440.png` | 1440 | hub |
| `25-no-pack-1440.png` | 1440 | hub-no-pack |
| `25-no-pack-390.png` | 390 | hub-no-pack |
| `26-objectives-1440.png` | 1440 | hub |
| `27-no-objectives-1440.png` | 1440 | hub-no-objectives |
| `27-no-objectives-390.png` | 390 | hub-no-objectives |
| `28-reward-available-1440.png` | 1440 | hub-reward |
| `28-reward-available-390.png` | 390 | hub-reward |
| `29-no-cards-no-rewards-1440.png` | 1440 | hub-no-cards |
| `29-no-cards-no-rewards-390.png` | 390 | hub-no-cards |
| `30-event-actions-1440.png` | 1440 | hub |
| `31-sync-stale-1440.png` | 1440 | hub-stale |
| `31-sync-stale-390.png` | 390 | hub-stale |
| `32-backend-error-1440.png` | 1440 | backend-error |
| `33-empty-events-1440.png` | 1440 | overview-empty |
| `33-empty-events-390.png` | 390 | overview-empty |
| `34-overview-stale-1440.png` | 1440 | overview-stale |
| `35-mobile-bracket-390.png` | 390 | bracket-mobile |
| `36-no-session-1440.png` | 1440 | no-session |
| `36-no-session-390.png` | 390 | no-session |
| `37-hub-anonymous-1440.png` | 1440 | hub-anon |
| `38-hub-demo-event-1440.png` | 1440 | hub-demo |
| `39-home-live-event-card-1440.png` | 1440 | home-card |
| `39-home-live-event-card-390.png` | 390 | home-card |
| `40-reduced-motion-hub-390.png` | 390 | hub (prefers-reduced-motion) |
| `41-torneos-real-route-1440.png` | 1440 | /torneos ruta real (sin Supabase: cuenta requerida o error honesto) |

Errores de consola propios (sin 404 de fotos ni backend ausente): 0.
