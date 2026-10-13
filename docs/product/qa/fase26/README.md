# QA visual · Fase 26 (QA SYNTHETIC: motor real en el navegador, cartas reales, sin servidor)

Generadas con `npx tsx scripts/_fase26-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase26?scene=…`.
La partida se simula con el motor puro de `domain/cardgame` (dos bots) y se proyecta con `buildMatchView`, la misma función del servidor.
Movimiento activado salvo en `21-*` y `22-*` (prefers-reduced-motion). La selección de carta y eje de `05-*` y `20-*` es un clic real sobre la mano.

| captura | ancho | escena |
|---|---|---|
| `01-prematch-1440.png` | 1440 | prematch |
| `01-prematch-1024.png` | 1024 | prematch |
| `01-prematch-390.png` | 390 | prematch |
| `02-prematch-invalid-1440.png` | 1440 | prematch-invalid |
| `02-prematch-invalid-390.png` | 390 | prematch-invalid |
| `03-match-intro-1440.png` | 1440 | intro |
| `03-match-intro-390.png` | 390 | intro |
| `04-arena-1440.png` | 1440 | arena |
| `04-arena-1024.png` | 1024 | arena |
| `04-arena-390.png` | 390 | arena |
| `05-card-selected-1440.png` | 1440 | arena (carta y eje elegidos) |
| `05-card-selected-390.png` | 390 | arena (carta y eje elegidos) |
| `06-defending-required-1440.png` | 1440 | defending |
| `06-defending-required-390.png` | 390 | defending |
| `07-stat-reveal-1440.png` | 1440 | reveal |
| `07-stat-reveal-390.png` | 390 | reveal |
| `08-round-win-1440.png` | 1440 | round-win |
| `08-round-win-390.png` | 390 | round-win |
| `09-round-loss-1440.png` | 1440 | round-loss |
| `09-round-loss-390.png` | 390 | round-loss |
| `10-round-draw-1440.png` | 1440 | round-draw |
| `10-round-draw-390.png` | 390 | round-draw |
| `11-history-1440.png` | 1440 | history |
| `11-history-390.png` | 390 | history |
| `12-pvp-searching-1440.png` | 1440 | pvp-lobby |
| `12-pvp-searching-390.png` | 390 | pvp-lobby |
| `13-pvp-waiting-1440.png` | 1440 | pvp-waiting |
| `13-pvp-waiting-390.png` | 390 | pvp-waiting |
| `14-reconnect-1440.png` | 1440 | reconnect |
| `14-reconnect-390.png` | 390 | reconnect |
| `15-match-win-1440.png` | 1440 | win |
| `15-match-win-390.png` | 390 | win |
| `16-match-loss-1440.png` | 1440 | loss |
| `16-match-loss-390.png` | 390 | loss |
| `17-post-match-1024.png` | 1024 | win |
| `18-pvp-outcome-1440.png` | 1440 | pvp-outcome |
| `18-pvp-outcome-390.png` | 390 | pvp-outcome |
| `19-help-sheet-1440.png` | 1440 | help |
| `19-help-sheet-390.png` | 390 | help |
| `20-mobile-arena-390.png` | 390 | arena (carta y eje elegidos) |
| `21-reduced-motion-arena-390.png` | 390 | arena (prefers-reduced-motion) |
| `22-reduced-motion-reveal-390.png` | 390 | round-win (prefers-reduced-motion) |
| `23-duel-hub-needs-account-1440.png` | 1440 | /duelos sin sesión |
| `24-home-cta-1440.png` | 1440 | / (CTA) |
| `24-home-cta-390.png` | 390 | / (CTA) |

Errores de consola no relacionados con fotos ausentes (`/players/<nick>.png`, preexistente): 2.
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
