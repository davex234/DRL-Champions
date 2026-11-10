# QA visual · Fase 34 — Season 1 + Live Service 2.0

QA SYNTHETIC: calendario canónico REAL (`SEASON_CALENDAR`, nexus-s1) y carriles/misiones/logros reales; cifras, eventos y jugadores inventados. Los relojes de servidor de cada escena son fijos (antes, durante, últimos días, último día, última hora, terminada, entre temporadas). La «Temporada 2» de `11-*` es FICTICIA y se etiqueta en pantalla. Sin servidor, sin Supabase, sin Docker.
Generadas con `npx tsx scripts/_fase34-visual-qa.ts` contra la app en :3005. `62-*` con prefers-reduced-motion; `64*` rutas reales.

| captura | ancho | escena | comprobaciones |
|---|---|---|---|
| `01-season-hub-full-1440.png` | 1440 | scene=full | estado ACTIVE |
| `01-season-hub-full-1024.png` | 1024 | scene=full | estado ACTIVE |
| `01-season-hub-full-390.png` | 390 | scene=full | estado ACTIVE |
| `02-anonymous-1440.png` | 1440 | scene=anonymous | estado ACTIVE |
| `02-anonymous-390.png` | 390 | scene=anonymous | estado ACTIVE |
| `03-new-player-1440.png` | 1440 | scene=new-player | estado ACTIVE |
| `03-new-player-390.png` | 390 | scene=new-player | estado ACTIVE |
| `04-upcoming-1440.png` | 1440 | scene=upcoming | estado UPCOMING |
| `04-upcoming-390.png` | 390 | scene=upcoming | estado UPCOMING |
| `05-active-1440.png` | 1440 | scene=active | estado ACTIVE |
| `05-active-390.png` | 390 | scene=active | estado ACTIVE |
| `06-ending-soon-1440.png` | 1440 | scene=ending-soon | estado ACTIVE |
| `06-ending-soon-390.png` | 390 | scene=ending-soon | estado ACTIVE |
| `07-under-24h-1440.png` | 1440 | scene=final-day | estado ACTIVE |
| `07-under-24h-390.png` | 390 | scene=final-day | estado ACTIVE |
| `08-final-hour-1440.png` | 1440 | scene=final-hour | estado ACTIVE |
| `08-final-hour-390.png` | 390 | scene=final-hour | estado ACTIVE |
| `09-ended-1440.png` | 1440 | scene=ended | estado ENDED |
| `09-ended-390.png` | 390 | scene=ended | estado ENDED |
| `10-off-season-1440.png` | 1440 | scene=off-season | estado ENDED |
| `10-off-season-390.png` | 390 | scene=off-season | estado ENDED |
| `11-next-season-known-1440.png` | 1440 | scene=next-known | estado ACTIVE |
| `12-next-season-unknown-1440.png` | 1440 | scene=next-unknown | estado ACTIVE |
| `13-hero-desktop-1440.png` | 1440 | scene=hero | estado ACTIVE |
| `14-hero-mobile-390.png` | 390 | scene=hero | estado ACTIVE |
| `15-countdown-1440.png` | 1440 | scene=countdown | estado ACTIVE |
| `16-server-time-sync-1440.png` | 1440 | scene=server-sync | estado ACTIVE |
| `17-pass-overview-1440.png` | 1440 | scene=pass | estado ACTIVE |
| `17-pass-overview-390.png` | 390 | scene=pass | estado ACTIVE |
| `18-free-track-1440.png` | 1440 | scene=free-track | estado ACTIVE |
| `19-competitive-track-1440.png` | 1440 | scene=competitive-track | estado ACTIVE |
| `20-claimable-reward-1440.png` | 1440 | scene=claimable | estado ACTIVE |
| `21-claimed-reward-1440.png` | 1440 | scene=claimed | estado ACTIVE |
| `22-locked-reward-1440.png` | 1440 | scene=locked | estado ACTIVE |
| `23-pass-xp-1440.png` | 1440 | scene=pass-xp | estado ACTIVE |
| `24-account-xp-distinction-1440.png` | 1440 | scene=account-xp | estado ACTIVE |
| `25-daily-objectives-1440.png` | 1440 | scene=daily | estado ACTIVE |
| `26-weekly-objectives-390.png` | 390 | scene=weekly | estado ACTIVE |
| `27-no-objectives-1440.png` | 1440 | scene=no-objectives | estado ACTIVE |
| `28-competitive-summary-1440.png` | 1440 | scene=competitive | estado ACTIVE |
| `29-provisional-1440.png` | 1440 | scene=provisional | estado ACTIVE |
| `30-no-ranked-games-1440.png` | 1440 | scene=no-ranked | estado ACTIVE |
| `31-recent-ranked-390.png` | 390 | scene=recent-ranked | estado ACTIVE |
| `32-event-live-1440.png` | 1440 | scene=event-live | estado ACTIVE |
| `33-event-upcoming-1440.png` | 1440 | scene=event-upcoming | estado ACTIVE |
| `34-no-events-1440.png` | 1440 | scene=no-events | estado ACTIVE |
| `35-pickems-pending-1440.png` | 1440 | scene=pickems-pending | estado ACTIVE |
| `36-pickems-scored-1440.png` | 1440 | scene=pickems-scored | estado ACTIVE |
| `37-no-pickems-1440.png` | 1440 | scene=no-pickems | estado ACTIVE |
| `38-collection-summary-1440.png` | 1440 | scene=collection | estado ACTIVE |
| `39-cards-obtained-this-season-1440.png` | 1440 | scene=cards-season | estado ACTIVE |
| `40-achievements-1440.png` | 1440 | scene=achievements | estado ACTIVE |
| `41-action-board-1440.png` | 1440 | scene=actions | estado ACTIVE |
| `41-action-board-390.png` | 390 | scene=actions | estado ACTIVE |
| `42-no-actions-1440.png` | 1440 | scene=no-actions | estado ACTIVE |
| `43-calendar-1440.png` | 1440 | scene=calendar | estado ACTIVE |
| `43-calendar-390.png` | 390 | scene=calendar | estado ACTIVE |
| `44-recap-full-1440.png` | 1440 | scene=recap-full | estado ENDED |
| `44-recap-full-1024.png` | 1024 | scene=recap-full | estado ENDED |
| `44-recap-full-390.png` | 390 | scene=recap-full | estado ENDED |
| `45-recap-minimal-1440.png` | 1440 | scene=recap-minimal | estado ENDED |
| `45-recap-minimal-390.png` | 390 | scene=recap-minimal | estado ENDED |
| `46-no-reliable-collection-history-1440.png` | 1440 | scene=ended | estado ENDED |
| `47-archive-1440.png` | 1440 | scene=archive-ended |  |
| `47-archive-390.png` | 390 | scene=archive-ended |  |
| `48-current-season-in-archive-1440.png` | 1440 | scene=archive-current |  |
| `49-invalid-archived-season-1440.png` | 1440 | scene=invalid-season |  |
| `49-invalid-archived-season-390.png` | 390 | scene=invalid-season |  |
| `50-home-integration-1440.png` | 1440 | scene=home-block |  |
| `50-home-integration-390.png` | 390 | scene=home-block |  |
| `51-profile-own-integration-1440.png` | 1440 | scene=profile-block |  |
| `51-profile-own-integration-390.png` | 390 | scene=profile-block |  |
| `52-navigation-1440.png` | 1440 | scene=navigation |  |
| `53-backend-error-1440.png` | 1440 | scene=backend-error |  |
| `53-backend-error-390.png` | 390 | scene=backend-error |  |
| `54-stale-state-1440.png` | 1440 | scene=stale | estado ACTIVE |
| `54-stale-state-390.png` | 390 | scene=stale | estado ACTIVE |
| `55-mobile-pass-390.png` | 390 | scene=pass | estado ACTIVE |
| `56-mobile-objectives-390.png` | 390 | scene=daily | estado ACTIVE |
| `57-mobile-ranked-390.png` | 390 | scene=competitive | estado ACTIVE |
| `58-mobile-event-390.png` | 390 | scene=event-live | estado ACTIVE |
| `59-mobile-recap-390.png` | 390 | scene=recap-full | estado ENDED |
| `60-tablet-1024.png` | 1024 | scene=tablet | estado ACTIVE |
| `61-keyboard-1440.png` | 1440 | scene=keyboard | teclado · estado ACTIVE |
| `62-reduced-motion-1440.png` | 1440 | scene=full · reduced-motion | estado ACTIVE |
| `62-reduced-motion-390.png` | 390 | scene=full · reduced-motion | estado ACTIVE |
| `63-events-unavailable-1440.png` | 1440 | scene=events-down | estado ACTIVE |
| `64-real-route-temporada-1440.png` | 1440 | ruta real /temporada sin Supabase local |  |
| `64-real-route-temporada-390.png` | 390 | ruta real /temporada sin Supabase local |  |
| `64b-real-route-temporadas-1440.png` | 1440 | ruta real /temporadas sin Supabase local |  |
| `64c-real-route-home-1440.png` | 1440 | vestíbulo real (sin Supabase local no hay bloque de temporada) |  |
| `65-no-season-configured-1440.png` | 1440 | scene=no-season |  |

Capturas con desbordamiento horizontal: 0. Errores de consola propios (sin 404 de fotos ni Supabase ausente): 0.
