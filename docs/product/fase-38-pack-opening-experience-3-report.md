# FASE 38 — Pack Opening Experience 3.0 · «The Reveal»

Estado: **CONSTRUIDA** · sin deploy, sin commit, sin push · sin migración (no 0053) · motor de sobres, odds, pools, precios, número de cartas, seriales, OVR, stats y economía **intactos** · Marketplace sigue OFF.

Contrato: `docs/product/pack-opening-presentation-contract.md`. QA visual: `docs/product/qa/fase38/README.md` (+ `real/`).

## Qué había (contrato real encontrado)

- **Antes de abrir** el cliente conoce el catálogo del sobre (nombre, número de cartas, pesos publicados), su inventario (`unopenedPacks`) y la colección.
- **Envía** `POST /api/game/packs {action:"open", packId, ref}` con `Authorization: Bearer`; `ref` = gesto del cliente (`lib/game/sync` lo guarda en `sessionStorage` antes de pedir y lo borra al confirmar).
- **Servidor**: `guardPublicOpen` (DRAFT 404; ACTIVE y RETIRED poseído sí) → precheck de inventario → semilla `randomInt` → `PackEngine.open` (sorteo, pity, anti-duplicado, `Minter` asigna seriales con `card_mints`, orden rareza ↑ y `cardId`) → RPC `app_apply_pack_open` (bloqueo de fila, −1 sobre, inserta `user_cards`, funde `card_mints`, pity, `packs_opened + 1`, XP, guarda `{uids, packId}` en `economy_ops` con la clave `pack:open:<user>:<gesto>`) → devuelve `opened[]` (uid, cardId, serial, isNew del motor, value, bucket).
- **Repetida**: la RPC devuelve lo guardado + `repeated: true` si la clave ya existe.
- **Recarga**: el revelado se guardaba en `sessionStorage` (Fase 21.2) y el gesto pendiente se reutilizaba (Fase 25).
- **Ceremonia previa**: 6 actos (intro, sellado, rotura, mano, revelado por rareza de `ceremony.ts`, resumen), con saltar, teclado y bucle «abrir otro».

## Bugs encontrados y corregidos

1. **P0 · reintento con la misma clave emparejaba cartas de OTRO sorteo.** El servicio sorteaba de nuevo (semilla nueva) antes de llamar a la RPC; la RPC devolvía los `uids` guardados y el servicio los combinaba con las cartas del sorteo nuevo → la UI podía enseñar la carta A con el uid y el serial de la B. **Arreglo**: `storedOpen` consulta `economy_ops` del propio usuario ANTES de sortear y relee `user_cards` por uid; la carrera (`repeated` desde la RPC) también relee lo persistido.
2. **P0 · reintento tras perder la respuesta del ÚLTIMO sobre → 409.** El precheck de inventario (0 sobres) cortaba antes de llegar a la operación guardada. **Arreglo**: la consulta de la operación va antes del precheck.
3. **Lo mostrado no se leía de la BD.** Tras abrir, carta/serial salían del objeto del sorteo y no había `mintedVersion`. **Arreglo**: relectura por uid; DTO con `mintedVersion` y `repeated`.
4. **Economía en la ceremonia**: «Valor total 🪙», valor por carta y «Vender repetidas» (modo local) → eliminados.
5. **Rarezas inventadas en el heraldo** («Cinemática», «Icónica», «Campeón») y **confeti** → el heraldo canta la rareza REAL del catálogo (o «Serial #1»); sin confeti.
6. **Fotosensibilidad / movimiento reducido**: el velo blanco de la rotura (0,7 de opacidad) y la ráfaga de 110 partículas se ejecutaban también con movimiento reducido → velo único ≤ 0,28 en 0,7 s solo sin movimiento reducido; ráfagas ≤ 40.
7. **«Nueva» dependía del motor** y no existía en recuperaciones → se deriva de la colección de ANTES (misma definición dos veces: nueva y luego duplicada ×2).
8. **Cara de la carta legible por lectores de pantalla antes de girar** → `aria-hidden` hasta revelar.
9. **Ruta**: cuerpo sin límite, campos extra ignorados y 5xx con el mensaje interno → cuerpo ≤ 2 KB (413), campos cerrados (400), 5xx genérico.

## Qué se construyó

- **Dominio puro** `src/domain/packs/reveal.ts`: `buildRevealPlan` (rareza real, NUEVA / NUEVA VARIANTE / DUPLICADA ×N, serial `#N/LÍMITE` + prestigio #1/Top 10/Top 100 sin efecto de juego, anticipación por rareza, heraldo, anuncio para lector, enlace a la ficha), resumen (nuevas, duplicadas, variantes, mejor rareza, destacada con criterio rareza → OVR → serial, serial destacado, colección X → Y / TOTAL y % → % con el mismo cálculo que Colección, ≤ 3 sets con avance, sets completados, primera legendaria), `revealReducer` (máquina de estados de presentación) y `classifyOpenFailure`.
- **Servidor**: lectura de operación guardada + relectura por uid (ver bugs 1–3); ruta endurecida (bug 9).
- **Sync**: `openPackOutcome` (resultado + `repeated`), `hasPendingOpen`; «No tienes ese sobre» limpia el gesto pendiente, un fallo de red lo conserva.
- **UI** (piezas con props, las mismas en la ceremonia y en el arnés):
  - `PackStage` — sobre como objeto (nombre y número de cartas reales), espera del servidor sin colores de rareza, rotura, cartas boca abajo con la señal de la mejor rareza REAL.
  - `CardReveal` — controlada por el reducer; insignias de rareza en texto, nueva/variante/duplicada, serial y prestigio, halo fijo del #1, stats de combate del catálogo, anuncio `aria-live`, `data-uid/card-id/serial`.
  - `PackSummary` — cierre con todas las cartas, colección animada X → Y, sets, momentos (primera legendaria, serial, set completado), acciones (abrir otro / mis sobres / ver sobres, ver en mi colección, añadir al equipo, volver a sobres).
  - `PackStatus` — recuperando, error con reintento de la misma operación, sin sobre (otra pestaña), no disponible, no encontrado.
  - `PackOpeningExperience` — orquesta: pestillo + reducer, foto «antes» al pulsar (encadenada al abrir otro), recuperación por revelado guardado o por gesto pendiente, teclado (Enter/Espacio, A, S/Escape) y foco.
- **Receta por rareza** en `ceremony.ts`: común → basic, poco común → metallic, rara → premium, épica → extended, legendaria → legendary (tabla existente sin tocar), heraldo del plan, sin confeti, ráfaga ≤ 40.
- **Arnés** `/design-system/fase38` con fixtures QA SYNTHETIC.
- **Verificadores**: `pack-opening:verify` (presentación, seguridad, economía, rendimiento), `pack-opening-presentation:verify`, `pack-opening-security:verify`.

## Qué no cambia

Motor (`PackEngine`, `openPack`, `Minter`), pesos, pools, precios, número de cartas, pity, orden de cartas, seriales, `mintedVersion`, OVR, stats de combate, rarezas, economía y ledger (`app_buy_pack`, `app_apply_pack_open` sin tocar), contador `packs_opened` (+1 por apertura, +0 por compra), objetivos y logros (servidor), Daily Loop, telemetría (`pack_ceremony` existente). Comprar ≠ abrir (sin apertura automática). Inventario abre la misma ceremonia (`/abrir/[packId]`).

## Resultados

### E2E real (app local → túnel SSH → BD del VPS · cuenta QA `8c326e52…`)

**Huella PRE** (solo lectura): créditos 4 790 · Sobres Estándar 0 · `packs_opened` 6 · cartas 30 (30 únicas) · 8 operaciones · 6 movimientos de créditos · misiones de sobres `d-abrir-1` baseline 5 (1/1, sin reclamar) y `w-sobres-10` baseline 5 (1/10).

**Compra de UN sobre por la ruta real** (autorizada; `POST /api/game/packs {action:"buy"}`, precio del catálogo): 200 · créditos 4 790 → **4 040 (−750)** · Estándar 0 → 1 · `packs_opened` **6 → 6** (comprar ≠ abrir) · +1 movimiento de créditos · +1 operación.

**Apertura en navegador real** (login por `/cuenta` → `/inventario` → `/abrir/estandar` → doble clic en «ABRIR SOBRE»):
- Pantallas reales: sobre sellado con nombre y «5 cartas» → «Abriendo tu sobre…» (sin rareza ni cartas hasta confirmar) → 5 cartas boca abajo con «Revelar».
- BD tras la apertura: **exactamente 1** `open_pack` (5 uids) pese al doble clic · `packs_opened` 6 → **7** · Estándar 1 → 0 · cartas 30 → 35 · créditos **4 040 (sin cambio)** · movimientos de créditos 7 (solo la compra) · XP +130 (XP de cartas del servidor, como antes) · estado del pase intacto (`w-sobres-10` pasa a 2/10 por el contador del servidor; `d-abrir-1` ya estaba completa).
- **Fallo del instrumento, no del producto:** las esperas del script mezclaban `??` con `&&` sin paréntesis (SyntaxError en JS → toda comprobación compuesta daba falso), el espía de `fetch` se instaló antes de la navegación y se perdió, y el paso de BD no protegía una lista vacía. El revelado carta a carta de ESTE resultado real no quedó capturado. Corregido el instrumento (`_fase38-real-e2e.ts`). **No se compró un segundo sobre** (solo había autorización para uno).

**Verificación real sin consumir** (`_fase38-real-recovery.ts`, 19/19 PASS) sobre ESA apertura:
- Recuperación real: gesto pendiente en la pestaña → `/abrir/estandar` → «Recuperando» → misma clave → resumen recuperado («El sobre ya se abrió correctamente… no se ha abierto otro»).
- **UI ↔ BD 5/5** (uid, carta, serial, versión acuñada), mismo orden que `economy_ops`: `bud__bronze`, `life__bronze`, `dgzin__silver`, `kaajak__silver`, `pa1ze__emea` (sin serial, versión 1).
- NUEVA 5/5 = BD (0 copias fuera de la apertura) · colección **30 → 35 / 772** y 3,8 % → 4,5 % = BD · sets ORG 1/14 → 2/14, JL 0/10 → 1/10, EG 0/12 → 1/12 · destacada: PA1ZE (poco común).
- Segunda recarga: mismo resumen, sin abrir · «Ver en mi colección» → `/coleccion/carta/pa1ze__emea` poseída · 0 errores de consola.
- Reintento por la API con la MISMA clave: 200, `repeated`, mismas cartas · campos `cardId/serial/rarity` inyectados → **400** · la clave usada con otro sobre → **409**.
- **Huella QA idéntica** antes/después de recuperación, recargas y reintentos (+0 aperturas, cartas, sobres, créditos, operaciones, XP).
- Capturas: `docs/product/qa/fase38/real/` (`real-01…04` apertura; `recovery-01…06`).

### QA visual (QA SYNTHETIC)
161 capturas del arnés `/design-system/fase38` a 1440/1024/390 (+ apaisado y teclado) y 2 rutas reales sin backend: **0 desbordamientos, 0 controles < 44 px, 0 errores de consola propios**, máx. 629 nodos DOM. Revisión visual → corregido: marca QA SYNTHETIC oculta bajo la escena, rotura invisible en captura (arnés congelado), halo del #1 cruzando la ficha (ahora marco de la carta), criterio con «ovr» en minúsculas, notas de fixtures con cifras que no mostraba la escena y la cinta «NUEVA» tapando el OVR en el resumen. Recaptura dirigida (50 capturas, 0 incidencias).

### Gates finales (túnel cerrado)
| gate | resultado |
|---|---|
| `npm test` | **2617 / 2617** (baseline 2472 → +145) |
| `tsc` web · `tsc` scripts · `next build` | 0 · 0 · OK |
| eslint (ficheros de la fase) | 0 problemas |
| security 201 · pack 42 · content 21 · distribution 30 · importer-vlr 69 · combat 5 · deck 34 · social 33 · replay 25 · competitive 27 | OK |
| season 21 · season-time 4 · season-pass 4 · season-security 4 · season-recap 4 | OK |
| campaign 33 · campaign-security 13 · campaign-economy 11 · campaign-content 9 | OK |
| daily-loop 47 · daily-loop-priority 22 · daily-loop-security 25 | OK |
| pack-objective 31 · pack-objective-rebase 11 · pack-objective-security 8 | OK |
| collection 53 · collection-room 53 · collection-content 23 · collection-security 21 · collection-performance 9 | OK |
| **pack-opening 34 · pack-opening-presentation 11 · pack-opening-security 15** (nuevos) | OK |
| suites destructivas de BD | NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA |

## P2 restantes
- Revelado carta a carta de un resultado REAL no capturado (fallo del instrumento, corregido; comprar otro sobre requiere autorización).
- La cara canónica `PlayerCard` sigue mostrando stats de origen; la ficha del revelado añade las de combate (heredado de Fase 37).
- Concurrencia real de dos pestañas con dos gestos no ejecutada en navegador (cubierta por la RPC con bloqueo, pruebas y estado `no_pack`).
- Sonido: se reutilizan los cues existentes (`playReveal`, `round_win`, `whoosh`); sin cue propio de legendaria/serial.
- Memoria del entorno: builds/capturas en segundo plano mueren por falta de RAM; ejecutar en primer plano.
- RLS/Postgres reales y suites destructivas: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.

**GO.**
