# QA visual · Fase 36 — Daily Game Loop 2.0 (vestíbulo)

**QA SYNTHETIC**: cada escena del arnés `/design-system/fase36` renderiza el vestíbulo REAL (`DailyLobby`) con la acción decidida por el dominio REAL (`buildDailyLoop` → `orderToday`) sobre hechos INVENTADOS (`src/app/design-system/fase36/fixtures.ts`). Nada de estas capturas es un dato de un jugador. La evidencia con datos reales está en el informe de la fase (smoke local contra la BD del VPS con la cuenta QA).
Generadas con `npx tsx scripts/_fase36-visual-qa.ts` contra `next start` en :3005, sin túnel (la home real `41-*` enseña la degradación sin backend).
Comprobaciones por captura: desbordamiento horizontal, un solo `h1`, acción principal (`data-action`), insignias del circuito, controles del vestíbulo por debajo de 44 px.

| captura | ancho | escena | comprobaciones |
|---|---|---|---|
| `01-active-player-campaign-primary-1440.png` | 1440 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `01-active-player-campaign-primary-1024.png` | 1024 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `01-active-player-campaign-primary-390.png` | 390 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `02-full-lobby-1440.png` | 1440 | scene=normal · página completa | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `02-full-lobby-1024.png` | 1024 | scene=normal · página completa | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `02-full-lobby-390.png` | 390 | scene=normal · página completa | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `03-fresh-account-1440.png` | 1440 | scene=fresh | acción open-first · circuito EN CURSO/PRÓXIMAMENTE |
| `03-fresh-account-1024.png` | 1024 | scene=fresh | acción open-first · circuito EN CURSO/PRÓXIMAMENTE |
| `03-fresh-account-390.png` | 390 | scene=fresh | acción open-first · circuito EN CURSO/PRÓXIMAMENTE |
| `04-no-deck-1440.png` | 1440 | scene=no-deck | acción create-team · circuito EN CURSO/PRÓXIMAMENTE |
| `04-no-deck-1024.png` | 1024 | scene=no-deck | acción create-team · circuito EN CURSO/PRÓXIMAMENTE |
| `04-no-deck-390.png` | 390 | scene=no-deck | acción create-team · circuito EN CURSO/PRÓXIMAMENTE |
| `05-invalid-deck-1440.png` | 1440 | scene=invalid-deck | acción edit-team · circuito EN CURSO/PRÓXIMAMENTE |
| `05-invalid-deck-1024.png` | 1024 | scene=invalid-deck | acción edit-team · circuito EN CURSO/PRÓXIMAMENTE |
| `05-invalid-deck-390.png` | 390 | scene=invalid-deck | acción edit-team · circuito EN CURSO/PRÓXIMAMENTE |
| `06-active-match-pve-1440.png` | 1440 | scene=match-pve | acción resume-pve · circuito EN CURSO/PRÓXIMAMENTE |
| `06-active-match-pve-1024.png` | 1024 | scene=match-pve | acción resume-pve · circuito EN CURSO/PRÓXIMAMENTE |
| `06-active-match-pve-390.png` | 390 | scene=match-pve | acción resume-pve · circuito EN CURSO/PRÓXIMAMENTE |
| `07-active-match-ranked-1440.png` | 1440 | scene=match-ranked | acción resume-ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `07-active-match-ranked-1024.png` | 1024 | scene=match-ranked | acción resume-ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `07-active-match-ranked-390.png` | 390 | scene=match-ranked | acción resume-ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `08-active-match-private-1440.png` | 1440 | scene=match-private | acción resume-private · circuito EN CURSO/PRÓXIMAMENTE |
| `09-active-match-campaign-1440.png` | 1440 | scene=match-campaign | acción resume-campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `10-incoming-challenge-1440.png` | 1440 | scene=challenge | acción challenge · circuito EN CURSO/PRÓXIMAMENTE |
| `10-incoming-challenge-1024.png` | 1024 | scene=challenge | acción challenge · circuito EN CURSO/PRÓXIMAMENTE |
| `10-incoming-challenge-390.png` | 390 | scene=challenge | acción challenge · circuito EN CURSO/PRÓXIMAMENTE |
| `11-claimable-pass-objective-1440.png` | 1440 | scene=claim | acción claim · circuito EN CURSO/PRÓXIMAMENTE |
| `11-claimable-pass-objective-1024.png` | 1024 | scene=claim | acción claim · circuito EN CURSO/PRÓXIMAMENTE |
| `11-claimable-pass-objective-390.png` | 390 | scene=claim | acción claim · circuito EN CURSO/PRÓXIMAMENTE |
| `12-claimable-achievement-1440.png` | 1440 | scene=claim-achievement | acción claim · circuito EN CURSO/PRÓXIMAMENTE |
| `13-pickem-pending-1440.png` | 1440 | scene=pickem | acción predict · circuito EN CURSO/PRÓXIMAMENTE |
| `13-pickem-pending-1024.png` | 1024 | scene=pickem | acción predict · circuito EN CURSO/PRÓXIMAMENTE |
| `13-pickem-pending-390.png` | 390 | scene=pickem | acción predict · circuito EN CURSO/PRÓXIMAMENTE |
| `14-objective-near-completion-1440.png` | 1440 | scene=near-objective | acción objective · circuito EN CURSO/PRÓXIMAMENTE |
| `14-objective-near-completion-1024.png` | 1024 | scene=near-objective | acción objective · circuito EN CURSO/PRÓXIMAMENTE |
| `14-objective-near-completion-390.png` | 390 | scene=near-objective | acción objective · circuito EN CURSO/PRÓXIMAMENTE |
| `15-packs-available-1440.png` | 1440 | scene=packs | acción open · circuito EN CURSO/PRÓXIMAMENTE |
| `15-packs-available-1024.png` | 1024 | scene=packs | acción open · circuito EN CURSO/PRÓXIMAMENTE |
| `15-packs-available-390.png` | 390 | scene=packs | acción open · circuito EN CURSO/PRÓXIMAMENTE |
| `16-no-packs-collection-1440.png` | 1440 | scene=no-packs | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `17-campaign-not-started-1440.png` | 1440 | scene=campaign-start | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `18-campaign-completed-ranked-primary-1440.png` | 1440 | scene=campaign-complete | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `18-campaign-completed-ranked-primary-1024.png` | 1024 | scene=campaign-complete | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `18-campaign-completed-ranked-primary-390.png` | 390 | scene=campaign-complete | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `19-ranked-provisional-1440.png` | 1440 | scene=ranked-provisional | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `19-ranked-provisional-1024.png` | 1024 | scene=ranked-provisional | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `19-ranked-provisional-390.png` | 390 | scene=ranked-provisional | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `20-ranked-established-1440.png` | 1440 | scene=ranked-established | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `20-ranked-established-1024.png` | 1024 | scene=ranked-established | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `20-ranked-established-390.png` | 390 | scene=ranked-established | acción ranked · circuito EN CURSO/PRÓXIMAMENTE |
| `21-live-event-real-live-1440.png` | 1440 | scene=live-event | acción campaign · circuito EN DIRECTO/PRÓXIMAMENTE |
| `21-live-event-real-live-1024.png` | 1024 | scene=live-event | acción campaign · circuito EN DIRECTO/PRÓXIMAMENTE |
| `21-live-event-real-live-390.png` | 390 | scene=live-event | acción campaign · circuito EN DIRECTO/PRÓXIMAMENTE |
| `22-next-event-upcoming-1440.png` | 1440 | scene=next-event | acción campaign · circuito PRÓXIMAMENTE |
| `23-no-live-events-1440.png` | 1440 | scene=no-live | acción campaign |
| `24-season-ending-soon-1440.png` | 1440 | scene=season-ending | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `25-season-ended-no-next-1440.png` | 1440 | scene=season-ended | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `26-offline-last-snapshot-1440.png` | 1440 | scene=offline | acción open · circuito EN CURSO/PRÓXIMAMENTE · red offline |
| `26-offline-last-snapshot-1024.png` | 1024 | scene=offline | acción open · circuito EN CURSO/PRÓXIMAMENTE · red offline |
| `26-offline-last-snapshot-390.png` | 390 | scene=offline | acción open · circuito EN CURSO/PRÓXIMAMENTE · red offline |
| `27-server-error-last-snapshot-1440.png` | 1440 | scene=error-stale | acción campaign · circuito EN CURSO/PRÓXIMAMENTE · red error |
| `28-loading-skeleton-1440.png` | 1440 | scene=loading | esqueleto |
| `28-loading-skeleton-390.png` | 390 | scene=loading | esqueleto |
| `29-partial-subsystem-failure-1440.png` | 1440 | scene=partial | acción campaign |
| `29-partial-subsystem-failure-1024.png` | 1024 | scene=partial | acción campaign |
| `29-partial-subsystem-failure-390.png` | 390 | scene=partial | acción campaign |
| `30-all-subsystems-down-1440.png` | 1440 | scene=all-down | acción play-hub · red error |
| `31-anonymous-1440.png` | 1440 | scene=anonymous | acción sign-in · circuito EN CURSO/PRÓXIMAMENTE |
| `31-anonymous-1024.png` | 1024 | scene=anonymous | acción sign-in · circuito EN CURSO/PRÓXIMAMENTE |
| `31-anonymous-390.png` | 390 | scene=anonymous | acción sign-in · circuito EN CURSO/PRÓXIMAMENTE |
| `32-anonymous-live-390.png` | 390 | scene=anonymous-live | acción sign-in · circuito EN DIRECTO |
| `33-reduced-motion-1440.png` | 1440 | scene=reduced-motion · reduced-motion | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `34-long-labels-1440.png` | 1440 | scene=long-labels | acción challenge · circuito EN DIRECTO |
| `34-long-labels-1024.png` | 1024 | scene=long-labels | acción challenge · circuito EN DIRECTO |
| `34-long-labels-390.png` | 390 | scene=long-labels | acción challenge · circuito EN DIRECTO |
| `35-today-section-1440.png` | 1440 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `35-today-section-1024.png` | 1024 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `35-today-section-390.png` | 390 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `36-season-and-xp-bars-1440.png` | 1440 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `36-season-and-xp-bars-390.png` | 390 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `37-play-block-1440.png` | 1440 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `37-play-block-1024.png` | 1024 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `37-play-block-390.png` | 390 | scene=normal | acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `38-stash-block-1440.png` | 1440 | scene=packs | acción open · circuito EN CURSO/PRÓXIMAMENTE |
| `38-stash-block-1024.png` | 1024 | scene=packs | acción open · circuito EN CURSO/PRÓXIMAMENTE |
| `38-stash-block-390.png` | 390 | scene=packs | acción open · circuito EN CURSO/PRÓXIMAMENTE |
| `39-keyboard-focus-1440.png` | 1440 | scene=normal | foco en daily-primary-cta · acción campaign · circuito EN CURSO/PRÓXIMAMENTE |
| `40-local-mode-1440.png` | 1440 | scene=local | acción sign-in |
| `41-real-route-home-no-backend-1440.png` | 1440 | ruta real `/` con el túnel CERRADO: vestíbulo degradado en ≤ 8 s (sin los ~20 s de reintentos) | acción sign-in · listo en 11.1 s |
| `41-real-route-home-no-backend-390.png` | 390 | ruta real `/` con el túnel CERRADO: vestíbulo degradado en ≤ 8 s (sin los ~20 s de reintentos) | acción sign-in · listo en 11.1 s |

Capturas: 90. Con desbordamiento horizontal: 0. Con controles < 44 px: 0. Errores de consola propios (sin 404 de fotos ni backend ausente): 0.

## Notas

- `41-*`: «listo en 11.1 s» es la ESPERA FIJA del instrumento (`settle`), no el tiempo de degradación: el cliente corta a los 8 s y cada subsistema del servidor a los 4 s.
- `26-*`, `27-*`, `30-*` se recapturaron sobre la build final (CTA desactivado sin acento dorado).
- Capturas `real-*.png`: vestíbulo y rutas con **datos reales** de la cuenta QA contra la BD del VPS (no son QA SYNTHETIC). Evidencia, huella de BD y hallazgos: [`real-smoke.md`](real-smoke.md).
