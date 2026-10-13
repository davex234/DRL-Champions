# QA visual · Fase 28 (QA SYNTHETIC: jugadores, ratings y partidas inventados; motor real en el detalle; sin servidor)

Generadas con `npx tsx scripts/_fase28-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase28?scene=…` (`fixtures.ts`).
Movimiento activado salvo en `25-*` y `26-*` (prefers-reduced-motion). `27-*` y `28-*` son rutas reales sin sesión.

| captura | ancho | escena |
|---|---|---|
| `01-competitive-hub-1440.png` | 1440 | hub |
| `01-competitive-hub-1024.png` | 1024 | hub |
| `01-competitive-hub-390.png` | 390 | hub |
| `02-provisional-1440.png` | 1440 | hub-provisional |
| `02-provisional-390.png` | 390 | hub-provisional |
| `03-unranked-1440.png` | 1440 | hub-new |
| `03-unranked-390.png` | 390 | hub-new |
| `04-ranked-hero-1440.png` | 1440 | hero |
| `04-ranked-hero-390.png` | 390 | hero |
| `05-top-leaderboard-1440.png` | 1440 | leaderboard |
| `05-top-leaderboard-390.png` | 390 | leaderboard |
| `06-around-me-1440.png` | 1440 | around-me |
| `06-around-me-390.png` | 390 | around-me |
| `07-same-rating-tie-1440.png` | 1440 | hub-same-rating |
| `08-match-history-1440.png` | 1440 | history |
| `08-match-history-390.png` | 390 | history |
| `09-history-empty-1440.png` | 1440 | history-empty |
| `10-match-detail-1440.png` | 1440 | match-detail |
| `10-match-detail-390.png` | 390 | match-detail |
| `11-match-detail-timeout-1440.png` | 1440 | match-detail-timeout |
| `12-player-profile-1440.png` | 1440 | player-profile |
| `12-player-profile-390.png` | 390 | player-profile |
| `13-rating-up-1440.png` | 1440 | rating-up |
| `14-rating-down-1440.png` | 1440 | rating-down |
| `15-post-match-1440.png` | 1440 | post-match |
| `15-post-match-390.png` | 390 | post-match |
| `16-post-match-timeout-1440.png` | 1440 | post-match-unranked |
| `17-rewards-1440.png` | 1440 | rewards |
| `17-rewards-390.png` | 390 | rewards |
| `18-rewards-locked-1440.png` | 1440 | rewards-locked |
| `19-matchmaking-1440.png` | 1440 | matchmaking |
| `19-matchmaking-390.png` | 390 | matchmaking |
| `20-small-population-1440.png` | 1440 | hub-small |
| `21-solo-player-1440.png` | 1440 | hub-solo |
| `22-backend-error-1440.png` | 1440 | backend-error |
| `23-top10-hub-1440.png` | 1440 | hub-top10 |
| `24-profile-summary-1440.png` | 1440 | summary |
| `24-profile-summary-390.png` | 390 | summary |
| `25-reduced-motion-hub-390.png` | 390 | hub (prefers-reduced-motion) |
| `26-reduced-motion-post-match-390.png` | 390 | post-match (prefers-reduced-motion) |
| `27-competitivo-needs-account-1440.png` | 1440 | /duelos/competitivo sin sesión |
| `28-duelos-hub-door-1440.png` | 1440 | /duelos (puerta al competitivo) |

Errores de consola propios (sin 404 de fotos ni Supabase ausente): 0.
