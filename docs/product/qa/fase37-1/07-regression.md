# 07 · Regresión con la BD real (0052 aplicada)

Instrumento de la Fase 37 `scripts/_fase37-live-smoke.ts` con `SKIP_SHOWCASE=1` (solo lectura: sin vitrina, sin economía) y salida en `docs/product/qa/fase37-1/regression/` (no pisa la evidencia de la Fase 37).

## API
| sonda | resultado |
|---|---|
| `GET /api/game/collection` | 200 `no-store` · 30 copias / 30 únicas / 772 · 3,8 % · 0 duplicadas · 1 serial · **favoritos `[]` (disponibles)** · vitrina vacía v4 · 2 equipos (activo «Equipo 2») |
| fugas | ninguna (correo, admin, origen, `obtained_at`, `user_id`) |
| anónimo · `?userId=` · token falso | 401 · 400 · 401 |
| POST campo extra · `../../etc/passwd` · cuerpo gigante · carta inexistente · anónimo | 400 `FIELD_NOT_ALLOWED` · 400 `INVALID_CARD` · 400 · 404 `UNKNOWN_CARD` · 401 |

## Navegador (cuenta QA)
| área | resultado |
|---|---|
| Collection | sala lista, cabecera = API (30 / 772), 48 cartas montadas, sin desborde a 1440/1024/390 |
| Búsqueda | «aspas» → 8 variantes, 1 propia, `?q=` en la URL |
| Filtros / URL | «Poseídas» → 30 = únicas de la API; `?tener=owned` sobrevive a recargar |
| Ficha (propia) | `#5/500` Top 10, **botón «☆ Favorito» activo** (antes «Favoritos no disponibles»), «Dónde puede salir» con 6 sobres activos |
| Giro | `aria-pressed=true` |
| Compare | tabla de 5 filas, sin veredicto |
| Sets | equipo/región en la ficha; libro presente en la sala |
| Deck | «Usada en 2 equipos, incluido tu equipo activo»; hoja «Añadir al equipo» abierta y cerrada sin guardar (equipo activo intacto) |
| Showcase | solo lectura (vitrina vacía v4, sin cambios) |
| No poseída | «No conseguida», 0 seriales, disponibilidad presente |
| Id inválido | «Carta no encontrada» |
| Anónimo | ficha pública con «Inicia sesión», sin favorito, copias ni seriales; sala en modo `anon` |
| Consola | 0 errores propios · 0 claves de favoritos en `localStorage` |

## Contador de sobres (36.1)
`GET /api/game/meta` → `packsOpened=6` · `GET /api/game/player?me=1` → `packsOpened=6` = `user_game.packs_opened` (6). Legado `profiles.packs_opened` = 0. Baselines sin tocar.

## Huellas
- Global (todas las tablas de producto): POST-apply == FINAL tras E2E + regresión → **0 cambios de datos**.
- Cuenta QA: igual que al cierre de la Fase 37 (salvo la línea `favorites_table`, ahora presente); `user_card_favorites` total = 0 filas.

## Resto de sistemas
Daily Loop, Campaign, Ranked, Season, Marketplace: sin cambios de código ni de datos; sus verificadores en los gates finales (`fase-37-1-…-report.md`).
