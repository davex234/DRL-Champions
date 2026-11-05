# 06 · E2E REAL de favoritos

Cadena real: **Chrome → app local (`next start` :3005, build de la Fase 37) → `POST/GET /api/game/collection` → servidor (service_role) → PostgreSQL del VPS** por túnel SSH. Sin mocks, fixtures, `localStorage` ni adaptadores en memoria.

- Instrumento: `scripts/_fase37-1-favorites-e2e.ts` (fuera de CI).
- Cuenta: QA existente de las fases 35.2–37 (`8c326e52…`), no admin, login por el formulario real de `/cuenta`.
- Evidencia de BD: tras cada paso, `select count(*) from public.user_card_favorites where user_id = <QA> [and card_id = …]` por SSH (solo lectura).
- Cartas (contenido público): propia **`aspas__americas-winner`** (Aspas · Americas Winner · OVR 87 · `#5/500`); no poseída **`benjy__silver`** (Benjyfishy · Plata · OVR 79).

## Resultado: PASS (34/34)

| # | paso | UI | BD |
|---|---|---|---|
| — | API antes | `favorites: []` (200, ya no 503) | 0 favoritos de la cuenta · 0 filas de la carta |
| 01 | `/coleccion?fav=1` | 0 resultados | 0 |
| 02 | ficha de la carta propia | botón activo, `aria-pressed=false`, «Añadir a favoritos» | 0 |
| 03 | clic «Añadir a favoritos» | `aria-pressed=true`, «★ Favorita», etiqueta «Quitar de favoritos» | **1** |
| 04 | recarga completa | sigue favorita | **1** |
| — | añadir otra vez por la API | 200 | **1** (no 2) · total de la cuenta 1 |
| 05 | `/coleccion?fav=1` | **exactamente** `aspas__americas-winner`; también en «Tus favoritas» | 1 |
| 06 | clic «Quitar de favoritos» | `aria-pressed=false` | **0** |
| 07 | recarga completa | ya no es favorita; filtro Favoritas vuelve a 0 | **0** |
| — | quitar otra vez por la API | 200 | **0** |
| 08 | ficha no poseída → favorita | «★ Favorita», «No conseguida», sin serial | **1** (`benjy__silver`) |
| 09 | recarga completa | sigue favorita, `data-owned=false`, «No conseguida», 0 seriales, «Todavía no tienes ninguna copia» | 1 · `user_cards` 30 → **30** · copias de esa carta **0** |
| 10 | quitar + recarga | no favorita | **0** |
| — | final | API `favorites: []` · 0 claves de favoritos en `localStorage` · 0 errores de consola | 0 favoritos de la cuenta |

## Integridad
Huella de la cuenta QA antes/después del E2E (idéntica): cartas 30 (md5 `4adc43fa…`), créditos 4 790, `user_game.packs_opened` 6, sobres sin abrir 0, 6 movimientos de créditos, equipos (md5 `c527f687…`), equipo activo sin cambio, vitrina vacía v4, pase (md5 `e07f259c…`), logros 0, rating 1, cosméticos 0.
Un favorito cuesta **0 créditos, 0 sobres, 0 cartas, 0 XP** y no crea propiedad ni serial.

## Capturas (reales)
`01-favorites-before.png` · `02-card-detail.png` · `03-favorite-added.png` · `04-after-refresh.png` · `05-favorites-filter.png` · `06-favorite-removed.png` · `07-after-remove-refresh.png` · `08-unowned-favorite.png` · `09-unowned-after-refresh.png` · `10-unowned-removed.png` (1440 px).

## Seguridad «usuario ajeno» y tope
No se usa ningún usuario real ajeno ni se llena la cuenta QA: probado con usuarios sintéticos dentro de BEGIN … ROLLBACK sobre la tabla real (`04-security.md`, `05-postflight.md`) y en los tests de servicio.
