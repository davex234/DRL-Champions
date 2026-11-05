# QA visual · Fase 29 (QA SYNTHETIC: jugadores, amistades, retos y presencias inventados; motor real en la partida privada; sin servidor)

Generadas con `npx tsx scripts/_fase29-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase29?scene=…` (`fixtures.ts`).
Movimiento activado salvo en `24-*` (prefers-reduced-motion). `25-*` y `26-*` son rutas reales sin sesión.

| captura | ancho | escena |
|---|---|---|
| `01-social-hub-1440.png` | 1440 | hub |
| `01-social-hub-1024.png` | 1024 | hub |
| `01-social-hub-390.png` | 390 | hub |
| `02-social-empty-ftue-1440.png` | 1440 | hub-empty |
| `02-social-empty-ftue-390.png` | 390 | hub-empty |
| `03-friends-list-1440.png` | 1440 | friends |
| `03-friends-list-390.png` | 390 | friends |
| `04-requests-1440.png` | 1440 | requests |
| `04-requests-390.png` | 390 | requests |
| `05-player-search-1440.png` | 1440 | search |
| `05-player-search-390.png` | 390 | search |
| `06-player-search-empty-1440.png` | 1440 | search-empty |
| `07-challenges-1440.png` | 1440 | challenges |
| `07-challenges-390.png` | 390 | challenges |
| `08-challenges-empty-1440.png` | 1440 | challenges-empty |
| `09-recent-opponents-1440.png` | 1440 | hub-after-duel |
| `09-recent-opponents-390.png` | 390 | hub-after-duel |
| `10-activity-1440.png` | 1440 | activity |
| `11-challenge-sheet-1440.png` | 1440 | challenge-sheet |
| `11-challenge-sheet-390.png` | 390 | challenge-sheet |
| `12-challenge-accept-sheet-1440.png` | 1440 | challenge-accept-sheet |
| `12-challenge-accept-sheet-390.png` | 390 | challenge-accept-sheet |
| `13-confirm-unfriend-1440.png` | 1440 | confirm-unfriend |
| `13-confirm-unfriend-390.png` | 390 | confirm-unfriend |
| `14-confirm-block-1440.png` | 1440 | confirm-block |
| `15-profile-friend-actions-1440.png` | 1440 | profile-friend |
| `15-profile-friend-actions-390.png` | 390 | profile-friend |
| `16-profile-stranger-1440.png` | 1440 | profile-stranger |
| `16-profile-stranger-390.png` | 390 | profile-stranger |
| `17-profile-request-sent-1440.png` | 1440 | profile-sent |
| `18-private-arena-1440.png` | 1440 | private-arena |
| `18-private-arena-1024.png` | 1024 | private-arena |
| `18-private-arena-390.png` | 390 | private-arena |
| `19-private-outcome-win-1440.png` | 1440 | private-outcome-win |
| `19-private-outcome-win-390.png` | 390 | private-outcome-win |
| `20-private-outcome-loss-1440.png` | 1440 | private-outcome-loss |
| `21-private-outcome-abandon-1440.png` | 1440 | private-outcome-abandon |
| `22-account-social-summary-1440.png` | 1440 | summary |
| `22-account-social-summary-390.png` | 390 | summary |
| `23-backend-error-1440.png` | 1440 | backend-error |
| `24-reduced-motion-hub-390.png` | 390 | hub (prefers-reduced-motion) |
| `25-social-needs-account-1440.png` | 1440 | /social sin sesión |
| `26-nav-social-entry-1440.png` | 1440 | /duelos/competitivo sin sesión (la entrada Social vive en el desplegable Jugar; sin sesión no hay badge) |

Errores de consola propios (sin 404 de fotos ni Supabase ausente): 0.
