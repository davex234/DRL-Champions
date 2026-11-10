# FASE 37 — Collection & Card Experience 3.0 · «The card is the product»

Estado: **CONSTRUIDA** · sin deploy, sin commit, sin push · Marketplace sigue **NO-GO** (`GLOBAL_MARKET_ENABLED=false`) · migración **0052 creada en local, NO aplicada** en el VPS.

Contrato técnico: `docs/product/collection-contract.md`. Migración: `docs/product/fase-37-migration-0052-collection-favorites.md`. QA visual: `docs/product/qa/fase37/README.md` (+ `real/`).

## Qué había

- `/coleccion` era un álbum con visor modal (`CardViewer`) que enseñaba **valor en monedas, «Vender en Mercado» y venta rápida**, «Recientes · 24 h» basado en `obtained_at` (no fiable), comparación legado que declaraba «mejor» por OVR, cartas no conseguidas **desactivadas** (la definición pública era inalcanzable), favoritos solo en memoria local (`CollectionMeta.favorites`), sin ruta de ficha ni comparador.
- Motor de colección existente reutilizable (`src/collection`: `CardRegistry`, `CollectionEngine.views()`, `applyFilter`, `sortViews`).
- Catálogo real (sonda `scripts/_fase37-catalog-probe.ts`): 772 cartas · 379 jugadores (353 con carta) · ids `playerId__variantId` 100 % válidos · rarezas común 299 / poco común 423 / rara 34 / épica 9 / legendaria 7 · ediciones base 353 / regional 353 / internacional 38 / winner 18 / mvp 4 / exclusiva 6 · roles Duelista 262 / Iniciador 171 / Controlador 179 / Centinela 80 / Flex 80 · regiones EMEA 204 / Americas 182 / Pacific 197 / China 189 · 66 nombres de equipo → 62 identidades (4 fusiones por `teamIdentities`: Team Heretics+TH, Fnatic+FNC, Sentinels+SEN, EDward Gaming+EDG), 0 ambiguos, 36 sin resolver (se quedan con su nombre) · combate 772/772 · 50 serializadas · OVR 56–93 · sobres ACTIVE 15 / RETIRED 1 / DRAFT 15 · toda carta puede salir en algún sobre ACTIVO · sin retirada por carta (solo sobres) · sin foto de jugador en datos (reserva `/players/{id}.png`).

## Qué se construyó

### Modelo
- **Definición vs instancia** (`src/domain/collection/room.ts`): la definición sale del catálogo (pública); la instancia es `{uid, cardId, serial|null, mintedVersion}` (privada). La definición nunca lleva serial ni dueño.
- **CollectionSnapshot** puro y determinista (`buildCollectionSnapshot`): total del catálogo real, únicas, copias, duplicadas, % por definiciones (1 decimal truncado), huérfanas aparte, mejor carta (OVR ↓ → rango ↓ → serial ↑ → id), OVR más alto, seriales (#1, más bajo), sets derivados (equipo/región/rol/rareza/edición) con `near` = ≥ 70 %, < 100 %, ≥ 5 cartas; `byCard` con copias, serial, favorita, vitrina, equipos y equipo activo. Sin recompensas por sets.
- **Consulta y URL** (`src/domain/collection/query.ts`): lista blanca de parámetros (`q, tener, rareza, rol, region, equipo, edicion, dup, fav, min, max, orden`), topes (q ≤ 48, 12 valores, 512 caracteres), orden por defecto OVR ↓ → rareza → jugador; filtra con el motor existente (`applyFilter` ampliado + `sortViewsBy`). Búsqueda sin tildes ni mayúsculas, por jugador/equipo/id, sin regex.
- **Comparación** (`compareCombat`, `src/collection/compare.ts`): OVR + Stronghold/Gamesense/Entryfrag del catálogo (`combat.ts`), `+N / −N / =` y frase accesible, **sin veredicto**.

### Servidor
- `GET /api/game/collection`: sesión obligatoria, cero parámetros, 4 lecturas en paralelo (instancias paginadas por `range` 1 000, tope 20 000; favoritos; vitrina; equipos + activo), `no-store`, `collection_read` 30/60 s. Fallos de favoritos/vitrina/equipos → `null` aislado.
- `POST /api/game/collection` `{action:"favorite", cardId, favorite}`: cuerpo cerrado, id validado por formato y catálogo del servidor, idempotente, tope 200, `collection_write` 40/60 s; sin 0052 → `503 FAVORITES_UNAVAILABLE`.
- P2 de 36.1 cerrado: Meta Hub (`meta.ts`) y perfil propio (`playerIdentity.ts`) leen `user_game.packs_opened`.

### UI
- `/coleccion` → `CollectionRoomScreen` (misma pantalla que el arnés): cabecera (X/Y, %, copias, duplicadas, OVR más alto, serial más bajo, rarezas, carta de mayor OVR en `Card3D`), descubrir (favoritas, mayor OVR, casi completos), libro de sets (pestañas; tocar un set aplica el filtro), álbum (buscar, Todas/Poseídas/No conseguidas, orden, filtros en panel ≥ sm y hoja en móvil, chips activos, rejilla de 48 en 48 con `Card3D` estático, «No conseguida» en texto, ×N, ★/Vitrina/Equipo). Forja, Maestría, Prestigio y objetivos de colección se conservan.
- `/coleccion/carta/[cardId]`: ficha enlazable (también sin sesión), carta grande con giro a un reverso NEXUS original (movimiento reducido: sin animación), rareza/variante/OVR, barras de combate, favorito, añadir al equipo (`AddToDeckSheet`), comparar, copias con serial canónico `#N/LÍMITE` y prestigio (#1 / Top 10 / Top 100, sin efecto de juego), vitrina (API existente, máx. 3) y uso en equipos, variantes del jugador (variantes ≠ copias), sets de equipo/región, «Dónde puede salir» (solo sobres ACTIVOS a la venta, «No es una garantía»).
- `/coleccion/comparar?a=&b=`: comparador; primero tus cartas.
- Sobre → colección: «Ver en mi colección» abre la ficha de la mejor carta del botín.

## Fuera de alcance (a propósito)
Sin mercado, trading, venta rápida, precios, NFT, moneda, crafting nuevo, recompensas por sets, cambios de odds/stats/OVR, bonus por serial, Season 2, segundo renderer/vitrina/constructor/motor de prioridades, `localStorage` para favoritos, deploy, commit ni push. No se tocó infra del VPS ni `content_players.team`.

## Bugs encontrados → corregidos
1. Visor legado con valor en monedas, «Vender en Mercado» y venta rápida en la colección → retirado de `/coleccion` (la ficha no tiene economía).
2. Comparación legado con veredicto «mejor» y stats de origen → `compareCombat` sin veredicto con stats de combate.
3. Cartas no conseguidas desactivadas en la rejilla → se abren (definición pública) con «No conseguida» en texto.
4. «Recientes · 24 h» por `obtained_at` no fiable → eliminado.
5. Meta Hub y perfil propio leían `profiles.packs_opened` (P2 36.1) → `user_game.packs_opened`.
6. `Chip` sin `aria-pressed` ni objetivo táctil de 44 px → corregido.
7. Cabecera anónima con «0 / 772 · 0,0 %» y barras 0/N que parecían progreso propio → catálogo («772 cartas en el catálogo») sin barras.
8. `MemorySupabase` sin `range` (la paginación real no era testeable) → añadido.

## P2 restantes
- La cara canónica de carta (`PlayerCard`) sigue mostrando stats de origen (DMG/SCR/COM/HS/AST/CLU); la ficha y el comparador usan las de combate. Cambiar la cara es rediseñar el renderer (prohibido en esta fase).
- Favoritos reales requieren aplicar 0052 en el VPS (procedimiento documentado). E2E real de favoritos: **NO EJECUTADO — REQUIERE 0052 APLICADA**.
- `PackOpeningExperience` en modo local (sin Supabase) conserva «Vender repetidas» (preexistente, solo offline).
- `/coleccion/equipos` (vista por equipo previa) no se rehízo; la sala enlaza a ella.
- RLS/PostgREST/`app_rate_take` reales y suites destructivas: **NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA**.

## Resultados

### Gates (túnel cerrado)
| gate | resultado |
|---|---|
| `npm test` | **2468 / 2468** (antes de la fase: 2316) |
| `tsc` web · `tsc -p tsconfig.scripts.json` | 0 errores · 0 errores |
| `next build` | OK |
| eslint (ficheros nuevos y modificados, `ESLINT_USE_FLAT_CONFIG=false`) | 0 problemas |
| `collection:verify` (Core Engine + Collection Room 53) · `collection-content` 23 · `collection-security` 21 · `collection-performance` 9 | OK |
| `security` 201 · `pack` 42 · `content` 21 · `distribution` 30 · `importer-vlr` 69 · `combat` · `deck` · `social` · `replay` · `competitive` | OK |
| `season` 21 · `season-time` 4 · `season-pass` 4 · `season-security` 4 · `season-recap` 4 | OK |
| `campaign` 33 · `campaign-security` 13 · `campaign-economy` 11 · `campaign-content` 9 | OK |
| `daily-loop` 47 · `daily-loop-priority` 22 · `daily-loop-security` 25 | OK |
| `pack-objective` 31 · `pack-objective-rebase` 11 · `pack-objective-security` 8 | OK |
| suites destructivas de BD | NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA |

Rendimiento medido (`collection-performance:verify`): foto con 20 000 copias + 200 favoritas + 100 equipos 6,4 ms; buscar+filtrar+ordenar el catálogo entero 0,6 ms; 2 500 copias y 40 equipos = 7 lecturas.

### QA visual (QA SYNTHETIC + rutas reales sin backend)
131 capturas en `docs/product/qa/fase37/` (76 escenas × 1440/1024/390), sobre la build final: **0 desbordamientos horizontales, 0 controles < 44 px, 0 errores de consola propios**, máximo 96 cartas montadas (48 + «Ver 48 más»). La primera pasada detectó 7 capturas con dianas < 44 px (chips del panel de filtros a 32 px en ≥ sm; enlace «Inicia sesión») y la cabecera anónima engañosa; corregidos, recompilado y recapturado.

### Smoke real (app local → túnel → BD del VPS, cuenta QA 8c326e52)
Instrumento `scripts/_fase37-live-smoke.ts`; capturas en `docs/product/qa/fase37/real/`.

- API: `GET` 200 `no-store` · 30 copias / 30 únicas / 772 · 3,8 % · 0 duplicadas · 1 serial · favoritos `null` (0052 no aplicada) · vitrina vacía · 2 equipos (activo «Equipo 2»); sin fugas (correo, admin, origen, `obtained_at`, `user_id`); anónimo 401; `?userId=` 400; token falso 401; campo extra 400 `FIELD_NOT_ALLOWED`; `../../etc/passwd` 400 `INVALID_CARD`; cuerpo gigante 400; carta inexistente 404; POST anónimo 401.
- Sobres abiertos (P2 36.1): Meta Hub `packsOpened=6` y perfil propio (`?me=1`) `packsOpened=6` = `user_game.packs_opened` 6 (el legado `profiles.packs_opened` es 0).
- Navegador (login por formulario real): sala lista en 1,6–2,7 s a 1440/1024/390, cabecera = API (30 / 772), 48 cartas montadas, sin desborde; búsqueda «aspas» → 8 variantes, 1 tuya, `?q=` en la URL; «Poseídas» → 30 = únicas de la API, `?tener=owned` sobrevive a recargar; ficha de la carta de mayor OVR (Aspas Americas Winner 87, `#5/500` Top 10, en «Equipo 2 (activo), Equipo 1», «Favoritos no disponibles» desactivado, 6 sobres activos «No es una garantía»); girar → `aria-pressed=true`; comparar con una carta propia → tabla de 5 filas sin veredicto; uso en equipos «Usada en 2 equipos, incluido tu equipo activo»; hoja «Añadir al equipo» abierta y cerrada sin guardar; carta no conseguida con «No conseguida» y sin serial; id con rutas → «Carta no encontrada»; recargar → 772 en el álbum; 0 claves de favoritos en `localStorage`; 0 errores de consola. Anónimo (perfil limpio): ficha pública con «Inicia sesión», sin favorito, copias ni seriales; sala en modo `anon`.
- Vitrina: añadir desde la ficha → «Añadida a tu vitrina.», tras recargar «EN TU VITRINA» (API 0→1, v2→v3) → revertida por la API existente (200, vitrina vacía, v4). Capturas `real-showcase-*-390.png` (esa pasada quedó a 390 px por un fallo del instrumento, corregido; la segunda pasada, sin vitrina, dejó las de escritorio).
- Huella de BD antes/después (solo lectura): cartas 30 (md5 igual), créditos 4 790, `user_game.packs_opened` 6, sobres 0, 6 movimientos de créditos, equipos (md5 igual), equipo activo, pase (md5 igual), logros 0, rating 1, cosméticos 0 → **idénticos**; única diferencia `player_profile_customization.version` v2 → v4 (añadir + revertir), uids vacíos. `user_card_favorites`: ausente. **Sin mutación económica.**
- Favoritos E2E real (marcar → recargar → persiste → desmarcar): **NO EJECUTADO — REQUIERE 0052 APLICADA** (la API responde 503 honesto y la UI lo dice).
- Túnel cerrado y app parada antes de los gates finales.
