# VALOROSTERS — WALKOUT 0.4: NEXT-GEN ESPORTS ARENA

2026-10-08 · ruta interna `/design-system/pack-walkout` (404 en producción) · sin commit, sin push, sin despliegue, sin migración. Nada de RNG, probabilidades, economía, compras, inventario, recompensas, BD, apertura real, mercado, pagos, usuarios ni temporadas.

**Veredicto: NO se declara «READY FOR VISUAL REVIEW» todavía.** Todo lo que puedo comprobar yo está hecho y en verde (§13–§14). Quedan **dos comprobaciones obligatorias que no puedo hacer**: **escuchar** el audio (lo he renderizado y medido, no oído) y **medir en una GPU real** (el Chrome automatizado de este PC solo da WebGL por software). En cuanto se escuche y se mire con GPU, 0.4 queda lista para la revisión visual.

Referencia estudiada: `puente.png` (túnel profundo con cerchas de celosía, pancartas LED verticales con bandera, código «TUR» y retratos, público a los lados tras vallas con LED, humo de CO2 en la base del portal, portal blanco con escalinata, pantalla gigante, suelo de pista brillante, cabezas móviles). **Nunca se usa como fondo**: todo se construye en 3D.

## 1 · Identidad única de la carta — `WalkoutCardIdentity`
- `walkoutIdentityFromCard(card, player)` (`src/domain/walkout/input.ts`) es la ÚNICA fuente de la escena: `playerId`, nombre, `nationality {iso, name, code alfa-3, status}`, bandera, equipo (siglas impresas + logo real), rol, edición, OVR, arte.
- `status`: **country** (bandera local) · **noflag** (país real sin bandera: su código y su nombre, nunca otra bandera) · **unknown** (p. ej. VLR «UN» → tema REGIONAL rotulado) · **missing**.
- Tabla ISO 3166-1 completa (249 códigos, `iso3166.ts`), no solo los del catálogo.
- **DEV**: los ajustes del panel pasan por `applyDevOverrides`, que los anota en `overrides`; la escena muestra «DEV · forzado: …» (`data-testid="walkout-dev-forced"`). En modo normal la carta manda.
- **Auditoría del catálogo** (`scripts/_walkout-nation-audit.ts`): 331 cartas · 379 jugadores · 53 países. Los 18 jugadores con país real sin bandera local tienen **0 cartas**; la única carta sin nacionalidad es `suygetsu__base` («UN») → tema «Región EMEA». Test I04 recorre las 331.
- **En ejecución** (`scripts/_walkout-identity-runtime.ts`, una pestaña, cambio por el selector del panel sin recargar): TR → JP → UN → US → TR → JP, la arena pinta TUR/JPN/EMEA/USA/TUR/JPN (código leído del lienzo, `canvas.dataset.arenaCode`), memoria estable (23 geometrías / 29 texturas tras cada cambio), y DEV «ES» → rótulo + arena ESP → al quitarlo, vuelve JPN.
- **Bug encontrado y arreglado**: cambiar SOLO país/equipo/arte (misma pieza) recreaba la escena en el MISMO lienzo, cuyo contexto `dispose()` había perdido a propósito → `getContext` null → caía al 2D. Ahora cada escena tiene su propio lienzo (`key`). Importa para la apertura real (varias cartas seguidas en el mismo componente).

## 2 · Arena (`src/components/walkout/arena3d.ts`)
Pista de suelo brillante (rugosidad 0,36 — con 0,16 devolvía el contraluz como mancha blanca) con líneas LED y franjas blancas · vallas con LED · cabezas móviles con haces · **público instanciado** (atlas de siluetas en 4 poses × 2 fotogramas animado en el shader; se levanta con el impacto y la celebración) · **pancartas LED instanciadas** de tres clases: bandera con código, **retrato** (el arte de la propia carta teñido) y chevrones · cercha de celosía (alphaMap) con destellos y haces cenitales · **portal** de cercha con su boca de listones LED (ya no un rectángulo blanco plano) y escalinata · **pantalla gigante** 13 × 6,5 m (bandera → equipo → bandera) · humo de CO2 en la base del portal **teñido de la luz del país** (rojo en Turquía, como la referencia) · bruma del recinto casi negra con un poso del color del país · anillos de la plataforma.
Pantallas LED: matriz de puntos, encendido escalonado, ondulación, golpe en el impacto y **rodilla en las luces** (el blanco de una bandera —Japón— ya no quema la pantalla bajo el bloom; los colores saturados quedan intactos).

## 3 · Persona — evaluación y elección
| Candidata | Licencia (verificada) | Resultado |
|---|---|---|
| Quaternius Universal Base Characters (0.2/0.3) | CC0 (License.txt del zip) | estilizada; se queda de **respaldo** (`?avatar=quaternius`) |
| **Microsoft Rocketbox — Male_Adult_10** | **MIT**, «Copyright (c) 2020 Microsoft» (LICENSE.md del repositorio) | **elegida**: proporciones reales, cara y ropa fotográficas, capturas de movimiento reales |

Procedencia exacta y texto MIT íntegro en `public/walkout/human/LICENSE-ASSETS.txt`. Construcción: `scripts/_walkout-rocketbox-build.mjs` (FBX → GLB con FBX2glTF 0.9.7; chaqueta roja original recoloreada a grafito; las franjas de las mangas son una máscara que el shader tiñe del color del país). Peso servido ≈ 1,8 MB (glTF 23 KB + bin 0,79 MB + texturas WebP). Clips: paso «cool» real (zancada 1,505 m / 1,125 s), **frenada capturada con su curva de raíz**, reposo, y FoldArms/Jump de Quaternius **retargeteados** al Biped (`scripts/_walkout-retarget.ts`).

## 4 · Celebraciones
| | Cómo | Comprobado |
|---|---|---|
| **SHUSH** | IK del brazo a los labios + mano de canto + índice extendido y resto en puño | primer plano 1440: índice vertical delante de la boca, dedos cerrados (H16) |
| **HYPE** | agachada · salto (física h = gT²/8) · puño arriba · aterrizaje con amortiguación | puño cerrado visible en el vuelo |
| **ARMS** | Idle_FoldArms_Loop retargeteado | lectura clara |
| **POINT** | IK al cielo + índice | brazo extendido, índice arriba |

Dos fallos de fondo encontrados al revisar SHUSH de cerca, ambos arreglados:
1. **El mixer de three solo escribe un hueso si su valor cambió** (`PropertyMixer.apply`). Con el tiempo quieto (pausa, seek, QA) la IK del fotograma anterior se quedaba y el puño se ACUMULABA (el dedo alternaba 87° ↔ 147°). Ahora la pose del clip se reescribe siempre (`forceApply`) — H15.
2. **Puño procedural**: el eje se medía por falange; tras doblar la primera, degeneraba y las otras se doblaban hacia atrás. Ahora una bisagra por dedo.

## 5 · Cámara (secuencia)
Plano general del túnel → figura al fondo → cámara baja que acompaña de frente y algo de lado → leve giro a las banderas en su beat → bandera y escudo → llegada centrada → plano de la celebración (SHUSH cerca, HYPE abierto, brazos medio) → OVR → reveal. Móvil (390): mira más alta (más pantalla gigante, menos suelo) y más distancia.

## 6 · Luz
Contraluz BLANCO que sigue a la persona por detrás, casi horizontal y con alcance 3,6 m (su cono nunca llega al suelo brillante de delante: era la mancha blanca a cámara), luz frontal-lateral fría que modela cara y ropa, relleno que sube con la celebración, laterales del color del país, borde (rim) del color de la edición, bloom con umbral 0,88 que sube con el impacto y el clímax.

## 7 · Audio
Sintetizado en WebAudio (sin ficheros ni licencias de terceros): drones y barrido de la arena, público con envolvente que sigue la escena (crece al entrar, sube con el escudo, **calla con el SHUSH** o **ruge con el HYPE**), «shhh», golpe del aterrizaje, pasos.
- **Pasos**: antes salían de la zancada de Quaternius; con Rocketbox no caían donde apoya el pie. Ahora usan los apoyos **medidos** del clip (`scripts/_walkout-contacts.ts` → `ROCKETBOX_STEPS`: crucero L 0,375 / R 0,917 s del ciclo de 1,125 s; frenada L 0,367 · R 0,792 · L 1,017 s) — test V07.
- **Render sin altavoces** (`scripts/_walkout-audio.ts` → `window.__walkoutAudioRender` en la página interna: OfflineAudioContext, cada cue en su beat con los MISMOS parámetros que la escena): `docs/product/qa/walkout-0.4/audio/walkout-turkey-WALKOUT-SHUSH.wav` y `…-HYPE_JUMP.wav` (17 s, 44,1 kHz, estéreo) + `audio-report.json`.
- **Medido** (no escuchado): pico **−11,5 dBFS**, sin saturación. Ventana 9,0–9,5 s: **−54 dBFS con SHUSH** frente a **−30,8 con HYPE** (el silencio del público y el rugido están en la señal). Picos de RMS en el impacto del escudo (−27,3 dBFS, 5,5–6 s) y el flash (−24,4, 10,5–11 s). Apagón en silencio (a propósito).
- **No validado de oído.** Además el nivel medio es bajo (≈ −38 dBFS RMS): puede que haya que subir la mezcla tras escucharla.

## 8 · Rendimiento (medido; **sin GPU real**)
`scripts/_walkout-runtime.ts` (informe en `docs/product/qa/walkout-0.4/runtime-report.json`):
| | 1440 px (calidad alta) | 390 px (baja) |
|---|---|---|
| Triángulos por fotograma | 24.376 | 23.354 |
| Llamadas de dibujo | 175 | 125 |
| Geometrías / texturas | 26 / 42 | 26 / 42 |
| Memoria JS | ≈ 165 MB | ≈ 163 MB |
| Carga de la persona | 1,5 s (local) | 1,1 s |

El contador antes decía «1 triángulo, 1 llamada»: el compositor (bloom) reinicia `renderer.info` en cada pasada y solo medía la última. Corregido (`info.autoReset = false` y reinicio por fotograma).
**Ritmo de fotogramas: SIN GPU REAL.** Las dos pasadas usan render por software — SwiftShader (p50 16,7 ms con picos) y «Microsoft Basic Render Driver» (WARP; p50 66,6 ms a 1440, 33,3 ms a 390) —; esas cifras **no** representan una GPU y no se usan como rendimiento. Falta medirlo en el Chrome normal con la RTX 3060.

## 9 · Móvil (390 px)
Composición propia: la pantalla gigante con la bandera ocupa el tercio de arriba, las piezas (bandera, rol, escudo) en fila arriba, la persona centrada de cuerpo entero, la media entra sobre la pantalla. Rótulo de edición con sombra (antes la primera letra se perdía sobre el blanco de la bandera). Capturas `*-390.png`.

## 10 · Lo que se conserva
Timeline, SALTAR (teclado), REPETIR, SILENCIAR, respaldo 2D (contexto perdido, persona que no carga, asset roto), movimiento reducido (2D, ≈3,3 s), limpieza WebGL (un lienzo y un contexto vivo tras 5 repeticiones y 3 cambios de edición), controles DEV. Todo en `_walkout-runtime.ts` (§8).

## 11 · Antes / después
`docs/product/qa/walkout-0.4/compare-0.3-vs-0.4-1440.png` y `-390.png`: 0.3 a la izquierda, 0.4 a la derecha, beats 1 (figura al fondo), 3 (bandera), 5 (impacto del escudo), 6 (deteniéndose), 7b (celebración), 8 (OVR). Japón, WALKOUT.

## 12 · Vídeos — `docs/product/qa/walkout-0.4/`
| Fichero | Qué |
|---|---|
| `video-japan-WALKOUT-motion-1280.mp4` | Japón (Absol, ZETA) completo · POINT_SKY |
| `video-usa-WALKOUT-motion-1280.mp4` | EE. UU. (trent, G2, logo real en pantallas) completo · ARMS_CROSSED |
| `video-turkey-WALKOUT-motion-1280.mp4` | Turquía (Lar0k, BBL; la referencia) completo · HYPE_JUMP |
| `video-turkey-WALKOUT-motion-1280-shush.mp4` | SHUSH, 7,6–11,4 s |
| `video-japan-WALKOUT-motion-390-hype.mp4` | HYPE en móvil (390 px), 7,6–11,4 s |

Vídeos por fotogramas deterministas (`window.__walkout.seek`, la misma timeline), con render por software. Revisados fotograma a fotograma: continuos, sin remontajes. El primer lote se cortó por memoria baja del sistema tras los tres primeros; SHUSH e HYPE se generaron después, de uno en uno.

## 13 · Tests
`npm test`: **6308 / 6308** (línea base verificada 6290 + 18 nuevos), 0 fallos.
- `human3d.test.ts` H13–H16: Rocketbox por defecto (recursos externos, Biped de 80 huesos, clips, zancada y frenada de los extras, ≤ 2,5 MB), licencia MIT íntegra, **el puño no se acumula entre fotogramas**, SHUSH real (índice vertical delante de la boca, corazón cerrado). H05 pasa a presupuesto por persona.
- `walkout04.test.ts` (14): I01–I07 identidad (JP/US/TR reales, «UN» → región, país sin bandera → su código, **auditoría de las 331 cartas**, cambios seguidos TR→JP→UN→US→TR, DEV rotulado, ISO 3166-1 completo) · V01–V07 (arena, contraluz que no toca el suelo, Rocketbox, mixer reescrito y bisagra única, ruta cerrada y three solo en los tres módulos de escena, **un lienzo por escena**, pasos audibles = asset).

## 14 · Comprobaciones
| Comprobación | Resultado |
|---|---|
| `npm run lint` | 0 errores · 29 avisos «eslint-disable sin uso», todos ya existentes (3 en `Reveals.tsx` vienen de 0.1) |
| `npm run typecheck` (app + scripts) | verde |
| `npm run build` | verde (184 páginas). Aviso de Turbopack por `process.exit` en `instrumentation.ts`: **ya existía** antes del arreglo local (build de las 10:24, línea 22 del original) |
| Producción (`next start -p 3011`, propio, parado después) | `/design-system/pack-walkout` (también con `?fx=…&cele=…` y `?panel=1&flag=ES`), `/design-system` y `/design-system/fase26` → **404**; `/` → 200 |
| Identidad en ejecución | 6 cambios de carta + DEV forzado/quitado: OK (§1) |
| Runtime | play, saltar con teclado, sin dibujar tras saltar, ninguna petición /api durante la escena, repetir ×5, cambiar edición ×3, contexto perdido → 2D, asset roto → respaldo, reducido → 2D en 3,3 s, persona que no carga → 2D: todo OK |

Nota: los ficheros de `public/walkout/*` (persona MIT/CC0, banderas) se sirven en producción como cualquier fichero estático; no llevan datos ni están enlazados, pero se pueden descargar.

## 15 · Pendientes / límites honestos
1. **Escuchar el audio** (los WAV de `qa/walkout-0.4/audio/` o la escena con sonido): mezcla, nivel medio bajo, sincronía de pasos. No está hecho.
2. **Rendimiento en GPU real** (Chrome normal con la RTX 3060, DevTools → Performance): no medido.
3. **SHUSH a 1280** queda en plano medio-corto, no en primer plano: el gesto se lee, pero la cámara podría acercarse más.
4. **Público** = siluetas instanciadas animadas (no personas 3D); de lejos funciona, de cerca se nota.
5. **Ropa**: chándal grafito con franjas del color del país, sin camiseta de equipo ni logos (a propósito: sin marcas). La cara es la del avatar de la librería.
6. La persona de respaldo (Quaternius) mantiene las celebraciones de 0.3; no se ha retocado para 0.4.
7. `next dev` con Turbopack sigue fallando en este Windows (`0xc0000142`, entorno, no código): usar `npm run dev -- --webpack`.
8. El nombre «Lar0k» se ve «LAR0K» con un cero que, en la fuente de la escena, se parece a una O.

## 16 · Cómo probarlo
- `npm run dev -- --webpack` y abrir `http://localhost:3000/design-system/pack-walkout?reduced=0`.
- Fixtures: `?fx=turkey` (Lar0k, BBL), `japan` (Absol, ZETA), `usa` (trent, G2), `unknown` (suygetsu, «UN» → región).
- Celebración: `&cele=SHUSH|HYPE_JUMP|ARMS_CROSSED|POINT_SKY` (si no, al azar en cada reproducción, solo visual).
- Persona de respaldo: `&avatar=quaternius`.
- DEV: `&panel=1` (forzar país/equipo/rol/OVR; sale el rótulo «DEV · forzado»).
- Instrumentos (fuera de CI): `_walkout-seq.ts` (hoja con la cámara real), `_walkout-cliplab.ts` (cámara libre), `_walkout-identity-runtime.ts`, `_walkout-runtime.ts`, `_walkout-video.ts`, `_walkout-human-shots.ts`, `_walkout-contacts.ts`, `_walkout-nation-audit.ts`.
