# VALOROSTERS — WALKOUT 0.3: NATIONAL ARENA & PLAYER CELEBRATIONS

2026-10-08 · ruta interna `/design-system/pack-walkout` (404 en producción, comprobado con `next start`) · sin commit, sin push, sin despliegue, sin migración.

**Veredicto: WALKOUT 0.3 = READY FOR VISUAL REVIEW** — con los pendientes del final (sin GPU real medida; persona de juego, no fotorrealista).

## Arquitectura del túnel nuevo — `src/components/walkout/arena3d.ts`
Solo lo importa `stage3d.ts` (que entra por import dinámico). La sustituye todo el túnel 0.2: arcos simples, suelo liso, pantalla radial y conos fijos.
- **Muros LED laterales**: 5 por lado en escritorio y 3 en móvil, en un único `InstancedMesh` con un solo `ShaderMaterial`.
  - Matriz de puntos LED, refresco y encendido escalonado de la plataforma al fondo, con un barrido de abajo arriba y su borde brillante.
  - La **bandera "ondea"** dentro de la matriz.
  - Mezcla país → equipo → país.
  - Reflejo de los muros en el suelo (solo calidad alta).
- **Pantalla gigante** al fondo (9,6 × 5,4 m): bandera a toda pantalla con el código. Tras el impacto, el logo real del equipo o sus siglas impresas. En la celebración vuelve a la bandera.
- **Estructura metálica** instanciada (columnas, cerchas, marco de la pantalla) con **marcos LED** en los colores del país, **focos** en el techo y **haces móviles** que barren el pasillo (8, o 4 en móvil).
- **Suelo** oscuro y brillante, con rejilla tenue y **pistas LED** hacia la **plataforma final**: un disco al ras del suelo con dos anillos que laten al llegar y al celebrar. Al ras para que los pies no tropiecen.
- **Luces de la escena con los colores del país**, primero los más saturados (Japón rojo y blanco; España rojo y amarillo; EE. UU. rojo y azul). La persona y la estructura siguen recibiendo contraluz, recortes y sombra.

## Sistema de países — `CountryArenaTheme` (`src/domain/walkout/countryTheme.ts`, puro)
- **Entrada:** la nacionalidad **canónica** de la carta (`walkoutInputFromCard`) y la región.
- **Colores:** salen de los **píxeles de la bandera real**. La bandera se rasteriza a 64×48 y `flagPalette` agrupa tonos, ordena por área y detecta franjas horizontales o verticales, o un campo con emblema.
- **Código:** ISO 3166-1 alfa-3 (tabla de los 40 países del catálogo más ES).
- **Sin país:** tema **«region»** claramente rotulado («Región EMEA», con chevrones y los colores de la edición).
- **Sin nada:** tema **«neutral»**. Si la bandera falla al cargar, se pasa a región o neutro.
- **Acento del equipo:** el color más saturado de los píxeles del **logo real**. Si no hay logo, o el logo no tiene color, el acento es neutro.
  - No se usa `data/teams.ts → color`: no tiene fuente, su propio comentario dice «color para el fallback».
- **Fuera:** símbolos culturales y referencias inventadas. Solo bandera, colores y gráficos.

## Países probados
| País | Cómo | Jugador |
|---|---|---|
| **Japón** | real | `absol__future-star` (ZETA, 87) |
| **EE. UU.** | real | `trent__masters-l` (G2, 93; logo real de G2 en las pantallas) |
| **España** | **vista previa DEV** | Ningún jugador del catálogo es español (0 de 331, comprobado). Se ve con `?flag=ES` en una carta Base y el panel lo rotula «Bandera (DEV)». |

La bandera de España (`public/walkout/flags/es.svg`) es flag-icons 7.5.0 (MIT), copiada sin modificar del mismo tarball que `public/flags/`; sha256 del tarball verificado, el mismo del README. No va a `public/flags` ni a `LOCAL_FLAGS`, porque esa lista debe coincidir con el catálogo (lo fija un test). Test A05: ningún input de carta sale con ES.

## Celebraciones (`WalkoutCelebration` — `src/domain/walkout/celebration.ts`, puro)
| Celebración | Estado | Cómo |
|---|---|---|
| **HYPE JUMP** | ✔ | Carrerilla con el clip `Jump_Start` (empieza agachado), despegue y vuelo, y aterrizaje con el clip `Jump_Land` (amortigua y se levanta). La raíz se eleva **solo en el vuelo**, con una parábola física (30 cm en 0,49 s, h = g·T²/8). En la bajada las piernas se estiran hacia la toma de contacto. El puño sube con IK del brazo. Medido: pies sin deslizar en la carrerilla (pie clavado), aterrizaje sin salto (0,013 m) y en el mismo sitio del despegue; contacto con el suelo en las fases de apoyo. |
| **SHUSH** | ✔ | IK del brazo derecho hasta delante de los labios (meta medida desde el hueso `Head`). La mano gira de canto, con los dedos hacia arriba; el índice queda extendido (de la pose de reposo) y el resto cerrado. Test R02: la punta del índice queda a menos de 9 cm de la boca y el dedo, vertical. `Consume` se descartó porque, medido, adelanta la mano medio metro delante de la cara. |
| **ARMS CROSSED** | ✔ | Clip `Idle_FoldArms_Loop` (UAL2) con fundido desde el reposo; las piernas no cambian. |
| **POINT TO SKY** | ✔ (secundaria) | IK del brazo estirado al cielo con el índice. Revisada en captura, no en vídeo. |
| CHEST TAP | ✘ no implementada | No hay clip adecuado y no se ha forzado. |

- **Forma de la mano:** sale de **datos de animación**. Medido: los clips comparten un «medio cerrado». El puño real prolonga esa curva desde el reposo (×1,8 en los dedos, ×1,2 en el pulgar) y está topado.
- **Transiciones:** PASO → FRENADA (pie clavado + paso en arco, de 0.2) → REPOSO (`Idle_Loop`) → CELEBRACIÓN, con fundidos y tramos de pie clavado → se mantiene en el OVR, el flash y la disolución.
  - Test C03: pesos que suman 1 y capas sin saltos fotograma a fotograma.
  - Si falta un clip, **pose segura** (reposo) y la escena sigue (R04, y `hasClips` en el escenario).
- **Por intensidad:**
  - STANDARD: sin persona.
  - RARE: la persona **ya está en la plataforma**, con una pose breve de brazos cruzados.
  - WALKOUT: celebración completa.
  - MEGA: completa, con un leve giro de cámara y más luz.
- **Selección:** panel «Celebración» o `?cele=` (SHUSH | HYPE_JUMP | ARMS_CROSSED | POINT_SKY | RANDOM).
  - RANDOM se resuelve en el director con `Math.random`: es **visual**, no toca el RNG de sobres, cartas ni recompensas (test C01: el módulo puro no lo lee).
  - La elección **se fija al empezar cada reproducción**. SALTAR y congelar ven la misma; REPETIR vuelve a sortear si es RANDOM.

## Origen y licencia de los clips
Quaternius **Universal Animation Library** 1 y 2, **CC0** (License.txt de cada zip, ya documentados en 0.2):
- `Walk_Loop`, `Idle_Loop`, `Jump_Start`, `Jump_Land` y `Punch_Cross` (de este, solo la mano cerrada): UAL1.
- `Idle_FoldArms_Loop`: UAL2.

Están en `public/walkout/human/LICENSE-ASSETS.txt`. El asset queda en **1,40 MB** con 6 clips (`scripts/_walkout-human-build.mjs`).

## Cámara
- **Paseo:** plano lateral bajo, como en 0.2.
- **Al llegar y celebrar:** se centra y encuadra el gesto (`FRAMING`):
  - SHUSH: cercano, torso y cara con la mano entera.
  - HYPE: abierto, se ve el salto entero con el puño.
  - BRAZOS y SEÑALAR: plano medio frontal.
- **Móvil:** distancias ×1,32 y punto de mira más alto (más pantalla gigante, menos suelo).
- **Clímax:** OVR → flash (vuelve al eje) → carta.
- **Escritorio:** un velo oscuro bajo los carriles laterales hace legibles las pistas sobre los muros LED, sin tocar el centro.

## Audio (sintetizado, WebAudio, sin ficheros)
- **Arena:** zumbido, **pantallas que se encienden** (barrido y chasquidos) y **rumor de público**: ruido filtrado a la banda de voces.
  - El público sigue una envolvente sincronizada con la timeline: crece al entrar, sube con el escudo, **calla con el SHUSH** y **ruge** con la celebración y el clímax.
- Se mantienen los pasos (sincronizados con los apoyos), el impacto del escudo y el golpe final.
- **Celebración:** «shhh» o rugido, y el golpe del **aterrizaje** del salto.
- `stopAll` corta también el bucle del público (T02). Silencio y volumen: los del juego, más el interruptor del panel.
- **No lo he escuchado en esta sesión.**

## Rendimiento
**Solo WebGL por software (SwiftShader, Chrome headless, en dev con webpack).** No hay medida en GPU real. Tu Chrome también usa WebGL por software, el «Microsoft Basic Render Driver» (ver 0.2).
| | 1440 | 390 (DPR 3 → lienzo 487×1055) |
|---|---|---|
| Llamadas de dibujo | **84** (0.2: 116; instanciado) | 67 |
| Triángulos | 55 k | 54,5 k |
| Geometrías / texturas en GPU | 25 / 27 | 25 / 27 |
| Fotograma p50 / p95 (CPU) | 100 / 283 ms | 67 / 133 ms |
| Carga de la persona | 1,1–1,9 s en dev | — |

Un solo contexto WebGL. REPETIR ×5 y cambiar de edición ×3 no dejan contextos vivos de más. `dispose` libera la arena.

## Capturas y vídeos — `docs/product/qa/walkout-0.3/`
- **Beats** `0-arena-vacia` (túnel sin personaje) … `10-carta-final`, a 1440 y 390:
  - `japan-WALKOUT-*` (Japón, HYPE);
  - `usa-WALKOUT-*` (EE. UU., brazos cruzados, logo de G2 en `5b-logo-en-pantallas`);
  - `base-WALKOUT-ES-preview-*` (España de vista previa, SHUSH).
- **Otros:** `japan-RARE-*` (pose breve en la plataforma) y `usa-MEGA_WALKOUT-*` (señalar al cielo).
- **Vídeos** (fotogramas deterministas a 24 fps, de la llegada al clímax), con hoja de contactos `sheet-video-*.png` de cada uno, revisada fotograma a fotograma:
  - `video-japan-WALKOUT-motion-1280-HYPE_JUMP.mp4` y `…-390-HYPE_JUMP.mp4`;
  - `video-base-WALKOUT-motion-1280-SHUSH-ES-preview.mp4`;
  - `video-usa-WALKOUT-motion-1280-ARMS_CROSSED.mp4`.

## Tests
- **Nuevos (18)** en `src/components/walkout/walkout03.test.ts`:
  - A01–A06: países, paletas, temas, acento del logo, España sin atribuir, Japón y EE. UU. reales.
  - C01–C06: elección, intensidades, determinismo y suavidad, física del salto, SHUSH/brazos/señalar, la celebración termina antes del clímax.
  - R01–R04: rig real en Node (clips, índice en los labios, puño, aterrizaje, pose segura).
  - T01–T02: timeline y audio.
- **Reapuntados a la timeline 0.3, sin relajar lo que comprueban:**
  - W02: final 12,6 s y orden con `celebrate`.
  - W03: rangos 10–13,5 s y 12–15,5 s; RARE «stand».
  - W05: ventana del reloj.
  - W17, W18, W19 y W21: instantes nuevos.
  - W20: incluye los ficheros nuevos.
  - H12 y ENV 62: three en stage3d, human3d y arena3d; arena3d solo desde stage3d.
- **Gates:**
  - Suite completa **6290/6290** (baseline real 6272 + 18).
  - Lint 0 errores (los mismos 29 avisos de antes).
  - Typecheck ✔.
  - Build ✔: un aviso que ya estaba, el `process.exit` de instrumentation para edge.
- **Navegador** (`_walkout-runtime.ts`), todo OK:
  - play 3D, SALTAR por teclado y sin dibujar después, 0 `/api`;
  - REPETIR ×5, edición ×3, contexto perdido → 2D, sin errores de consola, asset roto → respaldo;
  - reducido 2D de 3,3 s, persona que no carga → 2D y termina.

## Problemas visuales pendientes
1. **Sin GPU real**: ni el ritmo ni la calidad se han medido en hardware de verdad.
2. La persona sigue siendo un humano de juego (Quaternius, adelgazado). Vista de cerca, la ropa no tiene pliegues.
3. En el HYPE, el brazo que no levanta el puño va abierto, como en el clip. El aterrizaje es una sentadilla profunda, del clip.
4. En el plano abierto (HYPE), el muro LED más cercano entra grande por los bordes.
5. En móvil los muros laterales se ven poco (estrechos). El país lo carga la pantalla gigante y la fila superior de pistas.
6. Equipos sin logo (p. ej. ZETA) muestran sus siglas impresas en las pantallas, sin logo inventado.
7. POINT TO SKY se ha revisado en capturas, no en vídeo. CHEST TAP no existe.
8. Turbopack en este PC sigue con el `0xc0000142` de Windows (ver la sesión anterior). Arranca con webpack.

## Cómo probarlo
```
npm run dev -- --webpack
```
- `http://localhost:3000/design-system/pack-walkout?reduced=0`
- Japón: `&fx=japan` · EE. UU.: `&fx=usa` · España (DEV): `&flag=ES`
- Celebración: `&cele=SHUSH|HYPE_JUMP|ARMS_CROSSED|POINT_SKY|RANDOM` · Intensidad: `&i=RARE|WALKOUT|MEGA_WALKOUT`

## Ficheros
- **Nuevos:**
  - `src/components/walkout/arena3d.ts`, `src/domain/walkout/countryTheme.ts`, `src/domain/walkout/celebration.ts`;
  - `src/components/walkout/walkout03.test.ts`;
  - `public/walkout/flags/{es.svg, LICENSE-flag-icons.txt, README.md}`;
  - instrumentos `scripts/_walkout-cliplab.ts` y `scripts/_walkout-poseprobe.ts`.
- **Tocados:**
  - `stage3d.ts` (reescrito sobre la arena) y `human3d.ts` (capas, IK del brazo, formas de mano, puño);
  - `WalkoutStage.tsx`, `WalkoutDirector.tsx`, `Reveals.tsx`, `timeline.ts`, `walk.ts` (el reposo base pasa a `Idle_Loop`), `audio.ts`;
  - `pack-walkout/page.tsx` (fixtures de Japón y EE. UU., selector y `?cele=` / `?flag=`);
  - el asset `public/walkout/human/*`;
  - los tests del walkout, ENV 62 y los instrumentos `_walkout-human-shots.ts`, `_walkout-video.ts` y `_walkout-footslide.ts`.
- **No tocado:** RNG, probabilidades, economía, inventario, compras, recompensas, BD, apertura real, Marketplace, pagos, usuarios ni temporadas. Tampoco migraciones ni dependencias nuevas.
- **Se conserva** el arreglo de `src/instrumentation.ts`.
