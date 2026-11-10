# VALOROSTERS — WALKOUT 0.5: INTEGRACIÓN REAL EN PACK OPENING

2026-10-08 · rama `arch/stabilization` (árbol con muchos cambios previos) · **sin commit, sin push, sin despliegue, sin migración** · ninguna cuenta ni dato de producción tocados · ningún crédito consumido.

**Veredicto: WALKOUT 0.5 — REAL PACK INTEGRATION = READY FOR CONTROLLED REVIEW**

Se cumple cada criterio: funciona dentro de la apertura real (`/abrir/[packId]`, comprobado en la ruta real), usa solo el resultado canónico ya guardado, las banderas son las de cada carta, soporta varias especiales, SALTAR/REPETIR no tocan nada, el 3D nunca bloquea (frontera de errores, respaldo 2D, OMITIR siempre encima), la economía es byte a byte la misma, la apertura de siempre sigue (es el modo «off»), el interruptor nace **OFF**, 6333/6333 tests, y no hay nada desplegado. Lo que queda abierto está en §13 (sobre todo: medir en GPU real y escuchar el audio, que ya venían de 0.4).

---

## 1 · Arquitectura anterior y nueva

**Antes (F81, intacta):** `PackOpeningExperience` → gesto → `openPackOutcome` (UNA petición, clave de gesto fija, `lib/game/sync`) → `/api/game/packs` → `server/services/packs.ts · openPackForUser` (precomprueba `economy_ops`, sortea con el motor y guarda con la RPC `app_apply_pack_open` en `user_cards`) → resultado persistido → `saveOpenReveal` → máquina pura `revealReducer`: `opening → buildup → hero → hero_hold → rest → summary`. La HERO es la de mayor OVR del catálogo (`selectHero`).

**Ahora:** lo mismo hasta tener el resultado guardado. Después, SOLO si el despliegue lo permite, se calcula con ese resultado qué cartas son especiales y se intercala una fase de presentación nueva:

```
opening → walkout ×N (cada especial, en el orden de presentación) → [hero de siempre, si la hero no salió en su walkout] → rest (sin las ya presentadas) → summary
```

- `domain/walkout/packWalkout.ts` (puro): `walkoutIntensityForCard`, `packWalkoutQueue` (identidad por carta con `walkoutIdentityFromCard`, sin `overrides`), `walkoutFlow`, `packWalkoutAllowed`.
- `domain/packs/reveal.ts`: fase `walkout`, evento `WALKOUT_DONE`, campos `walkouts / walkoutIndex / heroWalked / rest`. Con 0 walkouts el comportamiento es idéntico (los 236 tests de apertura previos pasan sin tocarlos, salvo dos pins de texto, §12).
- `components/packs/PackWalkout.tsx` (nuevo): monta `WalkoutDirector` de 0.4 con controles de jugador (SALTAR del director, REPETIR, SIGUIENTE/CONTINUAR, SONIDO), frontera de errores, capa propia por debajo de OMITIR/CERRAR, franja superior libre en vertical. Se carga con `next/dynamic` (ssr:false).

## 2 · Ficheros

**Nuevos:** `src/domain/walkout/packWalkout.ts` · `src/components/packs/PackWalkout.tsx` · `src/components/packs/walkout05.integration.test.ts` · `scripts/_walkout05-qa.ts` · `scripts/_walkout05-video.ts` · `scripts/_walkout05-realroute.ts` · `docs/product/qa/walkout-0.5/*`.

**Modificados** (diff exacto de MIS cambios, contra la copia previa de cada fichero: `docs/product/qa/walkout-0.5/walkout-0.5.diff`):

| Fichero | Líneas | Qué |
|---|---|---|
| `src/components/packs/PackOpeningExperience.tsx` | +66 −5 | carga diferida, interruptor, cola fijada al recibir el resultado, render del walkout, teclado, resto sin las presentadas |
| `src/domain/packs/reveal.ts` | +35 −8 | fase `walkout` y su flujo (puro) |
| `src/config/features.ts` (versionado) | +16 −0 | `PACK_WALKOUT_3D_ENABLED = "off"` |
| `src/lib/walkout/controller.ts` | +9 −4 | `play(from)` (entrar por el apagón; por defecto 0) |
| `src/lib/walkout/audio.ts` | +11 −0 | `play()` nunca lanza (audio roto = silencio) |
| `src/components/walkout/WalkoutDirector.tsx` | +10 −4 | prop `startAtBeat` |
| `src/design/environment.ts` / `src/lib/audio/music.ts` | +2 / +1 −1 | la sala se apaga y la música se agacha en `walkout` |
| `src/app/design-system/fase81/page.tsx` + `fixtures.ts` | +8 −2 / aditivo | escenas `w-*` y `qaWalkout` (solo el arnés, 404 en producción). De `fixtures.ts` no guardé copia previa: el cambio es solo añadir el tipo, `WALKOUT_SCENES`, un `case` y la lista |
| `src/components/packs/f57.packOpening.test.tsx`, `packOpening.behavior.test.ts` | +4 −1 / +3 −1 | dos pins de texto reescritos con la misma garantía (§12) |

**Intactos (SHA-256 antes/después idéntico):** `server/services/packs.ts`, `app/api/game/packs/route.ts`, `lib/game/sync.ts`, `domain/packs/packClass.ts`, `domain/packs/openPack.ts`, `domain/packs/pool.ts`, `store/useGameStore.ts`. Ni BD, ni migraciones, ni worker esports, ni cron.

## 3 · Punto exacto de integración

`PackOpeningExperience.triggerOpen`, JUSTO DESPUÉS de `setResults(res)` y `saveOpenReveal(packId, res)`: `dispatch({ type: "OPEN_SUCCEEDED", …, ...ceremonyFlow(res) })`. `ceremonyFlow` lee el resultado ya guardado (plan → cola → flujo) y fija la cola en estado; no hace peticiones ni toca `res`. En el render, `phase === "walkout"` monta `<PackWalkout key={uid}>` (una escena por carta: la anterior se desmonta y libera su WebGL antes de la siguiente). Recuperación (F5 / petición pendiente) → resumen directo, sin walkouts.

## 4 · Qué activa cada presentación (decidido contigo: clase de sobre)

| Condición (`packCardClass(card)`) | Ediciones | Presentación |
|---|---|---|
| `base` / `plata` / `oro` / `masters` o sin clase | Base (70–92), Masters L/SDC, edición desconocida | **STANDARD**: la de siempre (hero + resto) |
| `champions` | Champions S | **RARE**: breve (de pie, ≈4,9 s) |
| `prime` | Future Star | **WALKOUT**: entrada humana completa (≈11,2 s) |
| `icon` | Record Breaker, Moments | **MEGA_WALKOUT** (≈13,0 s) |

Nunca el OVR (hay Base de 92 y Champions S de 80), ni la rareza (que ordena Future Star por debajo de Champions S), ni el precio. Duraciones desde el apagón; con movimiento reducido, ≈3,3 s en 2D.

**Frecuencia (exacta, leída de los planes; solo presentación):**

| Sobre | ≥1 RARE | ≥1 WALKOUT | ≥1 MEGA | ≥1 walkout completo | ≥2 especiales | tiempo medio añadido |
|---|---|---|---|---|---|---|
| Bronce (estandar) | 3,0 % | 1,5 % | 0,5 % | 2,0 % | 0,0 % | +0,4 s |
| Plata (premium) | 10,0 % | 5,0 % | 1,5 % | 6,5 % | 0,0 % | +1,2 s |
| Oro | 30,9 % | 15,0 % | 8,0 % | 23,0 % | 5,4 % | +4,4 s |
| Masters | 59,3 % | 26,0 % | 15,0 % | 41,0 % | 32,4 % | +8,8 s |
| Champions | 90,9 % | 56,6 % | 28,0 % | 77,6 % | 92,1 % | +20,8 s |
| Icon | 0,0 % | 96,1 % | 74,1 % | 100,0 % | 100,0 % | +35,5 s |
| EWC | 99,0 % | 0,0 % | 1,0 % | 1,0 % | 0,0 % | +5,0 s |
| Regionales | 2,8–4,0 % | 0,9–1,5 % | 0,3–0,5 % | 1,2–2,0 % | 0,0 % | ≈ +0,4 s |

(Corrección: en la pregunta de la decisión di a mano algunas cifras equivocadas —p. ej. Champions 69 %—; las buenas son estas.)

## 5 · Interruptor y estado

`src/config/features.ts`: `PACK_WALKOUT_3D_ENABLED: "off" | "admins" | "all" = "off"`.
- **off** (estado actual y de producción): nadie; la apertura es la de siempre.
- **admins**: solo cuentas con `profiles.is_admin` (veredicto del servidor vía `useAdminSession`, que falla cerrado); con «off» ese componente ni se monta → 0 peticiones extra.
- **all**: todos.
- Prueba local: en `next dev`, `localStorage["drl:walkout3d"]="1"` lo enciende SOLO en ese navegador; en una build de producción esa vía no existe (`packWalkoutAllowed`, test P23). El arnés (`qaWalkout`) tampoco cuenta en producción.
- Producción: ningún panel DEV, selector, ajuste de país ni rótulo técnico (comprobado en la ruta real: `dev: false`).

## 6 · Identidad

Cada walkout recibe `walkoutIdentityFromCard(card, player)` de la carta del resultado (resuelta en el catálogo por el `cardId` persistido): país, bandera, código, equipo y escudo, rol, edición, OVR y arte, con `overrides: []`.
- Navegador (escenas con cartas reales, código leído en la pieza Y en el lienzo 3D): **TUR** (lar0k), **JPN** (absol), **USA** (trent, reduxx), **KOR** (xross), **CAN** (mada), **CZE** (marteen); cambio consecutivo dentro del mismo sobre CAN → CZE → KOR y US → US.
- **Ruta real** `/abrir/icon` (invitado, motor local): marteen Record Breaker → MEGA, CZE en pieza y arena, escudo real de M8 en las pantallas (`real-route-abrir-icon-1280.png`).
- Sin nacionalidad: en el catálogo real **ninguna carta especial carece de país** (la única «UN» es `suygetsu__base`, clase Plata → presentación normal). El caso queda probado con un jugador sintético (P09): región rotulada o neutro, nunca otra bandera.

## 7 · Economía

- Mismos ficheros de servidor, ruta, sincronización, motor, pools, planes y store (SHA-256 idéntico).
- La apertura sigue haciendo UNA petición con la misma clave y guarda el resultado ANTES de animar (P21, pins F57).
- La cola y el flujo no mutan el resultado ni el plan (P19, objetos congelados); el walkout no conoce red, store, inventario ni servidor (P20).
- `npm run pack-opening:verify`: **34 ✓ · 0 ✗**.
- `npm run economy:verify`: 53 ✓ · 7 ✗ — **los mismos 7 con los ficheros ORIGINALES** (puse los originales, lo ejecuté y restauré los míos, verificados byte a byte). Son pins viejos: «última migración 0053» (vamos por 0073) y saldos absolutos con el precio de Bronce anterior a F80 (750 → 2.500). Las comprobaciones de idempotencia que no dependen del precio pasan: misma clave simultánea = mismas cartas y un sobre; 8 compras gratis simultáneas = 1; reciclaje simultáneo = un pago. No se ha tocado (es instrumentación de economía, fuera del alcance).

## 8 · Varias cartas (QA en navegador, `scripts/_walkout05-qa.ts`)

| Escena | Contenido | Comprobado |
|---|---|---|
| `w-tr` | Oro: Future Star 95 (hero) + 4 Base | 1 walkout TUR; la hero no se repite; resto 4 |
| `w-jp` | Oro: Future Star 87 + Base 90 | walkout JPN y DESPUÉS la hero de siempre (Base 90) |
| `w-us` | Masters: Champions S 92 (hero) + Future Star 90 | RARE → WALKOUT, ambos USA, «Especial 1 de 2» |
| `w-kr` | Masters: Future Star 95 | KOR |
| `w-mega` | Icon (3): Record Breaker, Moments, Future Star | 3 walkouts CAN → CZE → KOR, sin resto |
| `w-dup` | Champions: Champions S ×2 repetida + otra | 3 RARE, uno por instancia |
| `w-std` | Bronce sin especiales | la apertura de siempre (control) |

Resultados: 1280 **74/74**, 390 **32/32**, 1280 reducido **38/38**, 1280 sin WebGL **26/26** (`docs/product/qa/walkout-0.5/qa-*.txt`).

## 9 · SALTAR y REPETIR

- SALTAR (botón del walkout o Enter/Espacio/→ mientras corre): va al final de ESA carta; sigue en el walkout con REPETIR y SIGUIENTE/CONTINUAR. «Aperturas» del arnés = 1, peticiones = 1.
- REPETIR: solo `replay()` del director (misma carta, mismo uid; 1 apertura, 1 petición).
- OMITIR (arriba a la izquierda, «S»): resumen de las MISMAS cartas, desde cualquier walkout.
- Doble clic en ABRIR = 1 petición. F5 a mitad de un walkout → resumen recuperado, 1 apertura. Cerrar nunca pierde nada (el servidor ya guardó).

## 10 · Rendimiento

- Carga inicial de `/abrir/*` en producción: **sin three.js ni el director** (29 trozos, 1,9 MB, 0 coincidencias); el walkout es un trozo diferido que se pide al recibir un resultado con especiales (mientras se rasga el sobre).
- La persona (≈1,8 MB) y three.js solo si llega a montarse el escenario 3D. Un lienzo y un contexto WebGL por walkout; se liberan antes del siguiente (0.4: 5 repeticiones y 3 cambios sin contextos vivos de más).
- 0.4 medido: 24,4 k triángulos / 175 llamadas a 1440; 23,4 k / 125 a 390. **Sin medida en GPU real** (este Chrome automatizado solo da render por software).
- Sin WebGL → 2D automático; persona que no carga → 2D (0.4); cualquier excepción del walkout → frontera de errores → se registra y se CONTINÚA; audio roto → silencio (P26).

## 11 · Capturas y vídeos — `docs/product/qa/walkout-0.5/`

- `video-w-us-1280.mp4` (Masters, 2 especiales: RARE + WALKOUT, ceremonia entera hasta el resumen), `video-w-tr-1280.mp4`, `video-w-jp-1280.mp4` (walkout y luego la hero de siempre), `video-w-mega-390.mp4` (móvil, 3 especiales).
  Grabados en TIEMPO REAL con render por software: ≈2–3 fotogramas por segundo. El ritmo es el real; la fluidez no es la de una GPU.
- `real-route-abrir-icon-1280.png`: la ruta real del juego.
- Capturas por paso de cada escena (mitad, final, resumen) en 1280, 390, reducido y sin WebGL: en el directorio temporal de la sesión; las representativas están en los vídeos.

## 12 · Tests

`npm test`: **6333 / 6333** (línea base real 6308 + 25 nuevos), 0 fallos.
- `walkout05.integration.test.ts` P01–P26: intensidad por clase (todas las cartas del catálogo), identidad TR/JP/US/KR/sin nacionalidad, varias especiales con países distintos y su orden, flujo normal sin cambios, varias especiales, hero dentro/fuera, repetidas, SALTAR, F5, doble clic, el resultado no muta, el walkout no conoce red/store/servidor, petición y guardado intactos, escenas con cartas reales y cartas por sobre, interruptor OFF y su matriz, carga diferida, frontera de errores, audio que falla.
- Pins reescritos con la MISMA garantía: F57 A4 (el resultado se guarda antes de la ceremonia: ahora con `...ceremonyFlow(res)`) y REVEAL (el resto = resultado sin la hero, y sin las ya presentadas en su walkout).
- `npm run lint`: 0 errores (los 29 avisos de siempre). `npm run typecheck`: verde. `npm run build`: verde (aviso de `instrumentation.ts` ya existente).
- Producción (`next start` propio en :3011, parado después por PID): `/design-system/fase81`, `/design-system/pack-walkout`, `/design-system` → **404**; `/abrir/oro`, `/abrir/icon`, `/` → 200.

## 13 · Riesgos pendientes

1. **GPU real sin medir** y **audio sin escuchar** (heredado de 0.4).
2. **Duración en sobres caros**: un Champions trae de media 2,88 especiales (+20,8 s si no se omite) y un Icon 3 (+35,5 s). OMITIR siempre está; si se hace largo, la opción sería presentar con walkout completo solo las dos mejores y el resto en breve (decisión de producto, no tomada).
3. Con movimiento reducido (tu PC lo tiene activado) se ve la versión 2D corta: es lo correcto por accesibilidad; para ver el 3D en tu Chrome, DevTools → Rendering → «prefers-reduced-motion: no-preference».
4. El SALTAR del walkout y el OMITIR de la apertura conviven (uno salta esa animación, otro va al resumen): rotulados distinto, pero conviene validarlo con jugadores.
5. `economy:verify` arrastra 7 comprobaciones viejas (§7), ajenas a esta fase.
6. `public/walkout/*` (persona, banderas) se sirve en producción como cualquier estático (de 0.4).
7. La revisión controlada con cuentas reales («admins») requiere desplegar con el interruptor en «admins»: no hecho (no se despliega sin tu aprobación).

## 14 · Cómo probarlo

1. Arnés (cartas reales, sin servidor ni créditos): `http://localhost:3000/design-system/fase81?scene=w-us&reset=1` — escenas `w-tr`, `w-jp`, `w-us`, `w-kr`, `w-mega`, `w-dup`, `w-std`; `&walkout=0` para comparar con la apertura de siempre.
2. Ruta real del juego en local: en la consola del navegador, `localStorage.setItem("drl:walkout3d","1")`, y abre un sobre en `/abrir/<id>`. **Ojo:** con tu cuenta iniciada la apertura es REAL (servidor del VPS: gasta un sobre tuyo de verdad). Para probar sin gastar nada, como invitado (motor local) o con el arnés.
3. Para ver el 3D con tu Windows en «movimiento reducido»: DevTools → Rendering → emular `prefers-reduced-motion: no-preference`.
4. QA automática: `BASE_URL=http://localhost:3000 npx tsx scripts/_walkout05-qa.ts w-tr,w-us,w-mega 1280` (también `390`, `… reduced`, `WALKOUT05_GL=fail`).

## 15 · Rollback

- Hoy no hay nada que deshacer en producción: no se ha desplegado y el interruptor está en «off».
- Tras un despliegue futuro: `PACK_WALKOUT_3D_ENABLED = "off"` en `src/config/features.ts` y redeploy → la apertura vuelve a ser exactamente la de F81 (con 0 walkouts la máquina de estados es idéntica; lo fijan P11 y los 236 tests previos). O el rollback de build habitual (`bin/deploy.sh --activate <release anterior>`).
- No hay datos que revertir: la integración no escribe nada (ni BD, ni inventario, ni telemetría nueva más allá de `pack_ceremony` con contexto `walkout_shown/replay/failed`).
- Retirada total del código: borrar `PackWalkout.tsx` y `packWalkout.ts` y aplicar al revés `docs/product/qa/walkout-0.5/walkout-0.5.diff`.
