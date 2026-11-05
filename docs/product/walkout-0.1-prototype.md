# VALOROSTERS — PACK WALKOUT CINEMATIC PROTOTYPE 0.1

2026-10-07 · ruta interna `/design-system/pack-walkout` · sin commit, sin push, sin despliegue, sin migración.

**Veredicto: WALKOUT PROTOTYPE 0.1 = READY FOR VISUAL REVIEW** (con los puntos débiles de la sección AX, que hay que mirar a ojo).

## A · Qué es
Un prototipo visual de apertura «walkout» en una ruta interna aislada. Una escena dirigida por una timeline central: sobre → apertura → apagón → se enciende el escenario → silueta que camina → cae la bandera → rol → impacto del escudo → edición → media «9 → 95» → flash → nombre → la carta sustituye a la silueta → carta final.

## B · Cómo abrirlo en local
- `npm run dev` → `http://localhost:3000/design-system/pack-walkout`
- o, tras `npm run build`: `NEXUS_QA_HARNESS=1 npx next start -p 3011`
- **Tu Chrome declara movimiento reducido**: por defecto verás la versión corta en 2D. Para ver el 3D, desmarca «Movimiento reducido» en el panel DEV o añade `?reduced=0`.

## C · Parámetros de la URL
`fx` = base | future-star | champions-s | record-breaker | moments | masters-l | masters-sdc · `i` = STANDARD | RARE | WALKOUT | MEGA_WALKOUT · `t` = segundos (congela ese instante) · `reduced` = 0|1 · `stage` = 2d|3d · `autoplay=1` · `panel=0`

## D · Producción
`/design-system/*` sigue devolviendo 404 en producción. Comprobado con la build real: 404 sin arnés (`pack-walkout` y `fase81`) y 200 con `NEXUS_QA_HARNESS=1`. El VPS no define esa variable. No se ha desplegado nada.

## E · Aislamiento
No toca sobres reales, RNG, probabilidades, economía, compra, inventario, Pack Opening 3.1, recompensas, créditos, propiedad, Forge, Marketplace, Payments, Season ni cuentas. Usa datos DEMO sacados de cartas reales del catálogo. Sin BD, sin grants y sin endpoints.

## F · Prueba de aislamiento
- **Test W20:** ningún fichero del walkout contiene `fetch(`, `/api/`, `useGameStore`, `@/store/`, `economy`, `supabase`, `openPack`, `grant` ni `credits`.
- **Navegador:** 0 peticiones `/api` durante la escena. La única de la página es `/api/telemetry` al cargar, y la hace el armazón global, no el walkout.

## G · Ficheros nuevos
- `src/domain/walkout/timeline.ts` (puro)
- `src/domain/walkout/input.ts` (puro)
- `src/lib/walkout/controller.ts`
- `src/lib/walkout/audio.ts`
- `src/lib/walkout/stageChoice.ts`
- `src/components/walkout/stage3d.ts`
- `src/components/walkout/WalkoutStage.tsx`
- `src/components/walkout/Stage2D.tsx`
- `src/components/walkout/Reveals.tsx`
- `src/components/walkout/WalkoutDirector.tsx`
- `src/components/walkout/walkout.test.tsx`
- `src/app/design-system/pack-walkout/page.tsx`
- Instrumentos locales (fuera de CI): `scripts/_walkout-shots.ts`, `scripts/_walkout-runtime.ts`, `scripts/_walkout-video.ts`

## H · Ficheros existentes tocados
- `package.json` y `package-lock.json`: se añaden `three` y `@types/three`. Copia previa en el scratchpad (`walkout-before/`).
- `src/components/visual/environment.test.tsx`: ENV 62 reapuntado (ver AH). Era un fichero sin seguimiento de una fase anterior; el único cambio es ese pin.

## I · Dependencias
- `three@0.186.1` (MIT, versión exacta) y `@types/three@0.186.0` (dev).
- Al lockfile solo se añaden las dependencias de three. Nada eliminado ni actualizado.
- Sin React Three Fiber: three imperativo basta, y R3F habría añadido dependencias sin aportar nada.

## J · Por qué three
Hacía falta un túnel con profundidad real, suelo reflectante, bruma, conos de luz y una persona articulada que camina hacia cámara con contraluz. Con CSS sería una postal; el 2D existe como respaldo y como versión reducida.

## K · Carga perezosa
- `three` solo entra por `import("./stage3d")` desde `WalkoutStage`.
- En la build está en un único chunk, que la página no referencia de entrada.
- Test ENV 62: `stage3d.ts` es el único fichero de `src` que importa three.

## L · Arquitectura
- Director: `WalkoutDirector`.
- Escenario: `WalkoutStage` → `stage3d` / `Stage2D`.
- Timeline: `timeline.ts` + `WalkoutController`.
- Piezas en `Reveals.tsx`: `PackPiece`, `FlagPiece`, `RolePiece`, `TeamPiece`, `EditionPiece`, `RatingPiece`, `NamePiece`, `CardPiece`, `WalkoutSummary`.
- Persona: `buildHuman` dentro de `stage3d`.
- Audio: `WalkoutAudio`.
- Es una sola escena; los datos entran por `WalkoutInput`.

## M · Timeline
- `BEAT_TABLES` por intensidad: cada beat tiene inicio y duración, como configuración.
- `frameAt(t)` da el progreso 0..1 de cada beat. Es pura, así que el mismo instante produce el mismo fotograma.
- WALKOUT sigue la referencia del encargo: final a los 10,5 s.

## N · Un solo reloj
`WalkoutController` usa un único `requestAnimationFrame` (inyectable en tests) y no hay `setTimeout` sueltos en la escena. API: `play` / `skip` / `reset` / `seek` / `dispose`. Cada beat dispara su cue una sola vez.

## O · Tiempos como configuración
Cambiar un tiempo es cambiar una entrada de `BEAT_TABLES` o de `REDUCED_TABLE`. Las piezas no tienen tiempos propios.

## P · Integración futura
```ts
<WalkoutDirector ref={walkout} input={walkoutInputFromCard(result.hero.card, getPlayer(...))} intensity={...} reduced={...} />
walkout.current.play()
```
La intensidad la decide quien llama; hoy no existe ninguna regla «media → intensidad».

## Q · Intensidades medidas
| Intensidad | Duración | Qué incluye |
|---|---|---|
| STANDARD | 2,6 s | sobre, media, carta |
| RARE | 5,6 s | + bandera y rol |
| WALKOUT | 10,5 s | + persona y escudo |
| MEGA_WALKOUT | 13,0 s | lo mismo, más luz y flash |

Las cuatro están dentro de los rangos pedidos (test W03).

## R · Escenario
- Arcos de luz que se encienden de fondo a frente, pantalla central y tiras LED en el suelo.
- Suelo semirreflectante sobre un reflejo espejado, `FogExp2`, conos aditivos, cinco capas de bruma y polvo determinista con tope.
- Viñeta de cine.
- Identidad propia: no copia IP externa.

## S · Cámara
- Arranca algo alejada, se acerca poco durante el paseo y hace un pequeño push-in en el reveal.
- Va ligeramente de tres cuartos mientras camina (de frente el paso no se leía) y vuelve al eje en el clímax.
- Sin giros ni mareo.

## T · Persona
- Procedural: cápsulas articuladas con sudadera y capucha, sin cara y sin logos.
- Silueta casi negra a contraluz, con borde de luz del color de la edición.
- Camina a velocidad constante, frena, se queda en su marca y hace un idle de respiración.

## U · Licencias del humano
No hay ningún asset con licencia propia, CC0 o compatible en el repo, así que no se ha añadido ninguno.

**Punto de sustitución:** `buildHuman()` en `stage3d.ts`. Un GLB con animación de paso puede ocupar su sitio con la misma API: `setWalk(fase, cantidad)` y `setIdle(t, cantidad)`.

## V · Bandera
- Cae desde arriba con `heavyDrop`: acelera, se pasa un poco y se asienta, sin rebote.
- Al aterrizar hay un destello de luz.
- Usa la bandera real (`flagSrc`, flag-icons MIT) solo si el país es una nacionalidad real; si no, el emblema de región con el rótulo «Región».

## W · Rol
Entra grande, el tracking se va cerrando y lleva su abreviatura canónica (`ROLE_ABBR`: DUE, INI, CEN, CON, FLX). No existen iconos de rol, así que es texto.

## X · Equipo
- Entra en diagonal desde arriba a la derecha con caída pesada.
- El impacto dispara a la vez: golpe grave (sonido), flash, pulso de los arcos, luces y temblor mínimo de cámara.
- Usa el equipo impreso de la carta y su logo si lo hay. Si no hay logo, muestra las siglas impresas; por ejemplo, PRX y no «PAPE».

## Y · Edición
Muestra la variante real (`getVariant().label`). `EDITION_PRESETS` define para las siete ediciones del catálogo diseñado: `light`, `accent`, `particles`, `revealIntensity` y `accentTreatment` (plain, metal, prism o gold). No hay probabilidades en ningún sitio.

## Z · Media
Primero aparece solo el primer dígito («9»), hay una pausa y luego llega el número entero («95») con golpe de escala. Unos 300 px en escritorio y 190 px en móvil, con brillo del color de la edición.

## AA · Clímax
Flash radial del color de la edición. El cuerpo de la silueta sigue en sombra y estalla su borde de luz. Después la carta sale de la luz (brillo y desenfoque que se resuelven) mientras la silueta se funde.

## AB · Carta final
Componente canónico: `Card3D mode="static"` → `CardVisual` → `PlayerCard` (que pinta a través de `CardArt`). Es la misma composición que `PackSummary`.

## AC · Composición final
- **Escritorio:** carril izquierdo con bandera, rol y escudo; media a la derecha; edición arriba; carta centrada; nombre abajo.
- **Móvil:** fila superior con bandera, rol y escudo; la edición debajo; carta centrada; nombre abajo.

## AD · Móvil (390 px)
El encuadre cambia de verdad, no es el escritorio encogido:
- la cámara usa fov 62 y otra altura;
- las piezas se acoplan en la fila superior;
- la media grande cede el centro a la carta, que ya lleva la media;
- la escala de la carta se ajusta al alto disponible.

## AE · Movimiento reducido
- Versión corta de 3,3 s en 2D: bandera, rol, equipo, edición, media, nombre y carta.
- Sin persona, sin sobre, sin flash y sin caídas; solo fundidos.
- Se decide por `prefers-reduced-motion` y se puede forzar desde el panel.

## AF · Respaldo 2D
Mismo túnel en CSS/SVG: marcos en perspectiva, líneas de fuga del suelo, conos y una silueta SVG que camina. También es función del fotograma.

**Se elige 2D cuando:** no hay WebGL, el contexto se pierde, el import falla, el equipo es modesto (≤ 2 núcleos o ≤ 2 GB) o hay movimiento reducido.

## AG · Pérdida de contexto
Comprobado en navegador: forzando `loseContext()` en mitad de la escena, el escenario pasa a 2D y la timeline sigue.

## AH · ENV 62 reapuntado
El pin de F44.1 exigía que `three` no estuviera en `package.json`. Su intención real era que el ambiente global no usara WebGL, y eso se mantiene. Ahora el pin exige que `stage3d.ts` sea el único importador de three en `src`.

## AI · Audio
Hooks para `ambient`, `packOpen`, `footsteps`, `flagDrop`, `roleReveal`, `teamImpact`, `ratingTick`, `revealHit` y `finalSting`.
- Sintetizado con WebAudio: sin ficheros ni audio con copyright.
- Usa el contexto y las preferencias del juego (`lib/sound`: volumen y silencio).
- Sin gesto del usuario no suena nada.
- El panel DEV tiene un interruptor de sonido.

## AJ · SALTAR
- El botón está siempre presente mientras se reproduce y es alcanzable por teclado (Tab + Enter, comprobado); Escape también salta.
- Lleva a un fotograma final con todo revelado, sin reloj y cortando el audio.
- Después de saltar, el lienzo no vuelve a dibujar (medido: 0 llamadas de dibujo en 1,5 s).

## AK · REPETIR
`reset` + `play` sobre el mismo escenario. Repetir cinco veces deja 1 lienzo y 1 contexto vivo. Cambiar de edición tres veces también deja 1 contexto vivo: los anteriores se liberan con `dispose` y `forceContextLoss`.

## AL · Panel DEV
- Ajustes: intensidad, edición (fixture), rol, bandera o región, equipo (con logo, «sin logo» o el de la carta), media, escenario (auto / 3D / 2D), movimiento reducido y sonido.
- Botones: Play, Repetir, Saltar.
- Línea de estado: estado, tiempo, escenario y motivo.
- Rol, bandera, equipo y media cambian solo las piezas; la carta final es la del fixture.

## AM · Fixtures
La carta de mayor media de cada edición real:

| Edición | Carta |
|---|---|
| Base | f0rsakeN 92 |
| Future Star | Lar0k 95 |
| Champions | slowly 95 |
| Record Breaker | marteen 95 |
| Moments | mada 95 |
| Masters Londres | primmie |
| Masters SDC | marteen |

«Icon» es una clase de sobre, no una edición, así que no tiene fixture propio.

## AN · Precarga
- Solo se precargan los tres assets de la escena (bandera, escudo, carta), con un tope de 2,5 s.
- «Preparando…» solo aparece si la carga pasa de 300 ms.
- Un asset que falla nunca para la timeline.

## AO · Asset roto
Comprobado en navegador interceptando `/flags/*` y `/hints/teams/*`: la escena termina igual, con el emblema de región y las siglas del equipo, y sin `<img>` rotas.

## AP · Accesibilidad
- En el estado final hay un `section` `sr-only` con `aria-live`: nombre, media, equipo, rol, edición y país.
- Las piezas son DOM, con alt de bandera y escudo.
- El botón SALTAR es enfocable y tiene foco visible.

## AQ · Rendimiento
- three se carga solo en esta ruta.
- DPR con tope de 1,5, y 1,25 por debajo de 640 px.
- Partículas con tope por intensidad: 30, 60, 110 y 140.
- Un render por fotograma de la timeline y ninguno al terminar.
- Sin RAF tras saltar o salir, y sin fugas al repetir o cambiar de edición.

## AR · Rendimiento medido
Medido solo con SwiftShader (Chrome headless sin GPU, render por CPU): p50 de 16,7 ms y p95 de 100 ms por fotograma. Es una cota pesimista. **No está medido en GPU real**; queda pendiente de tu revisión en el PC (RTX 3060).

## AS · Tests nuevos (W01–W20)
- Timeline determinista y en orden narrativo.
- Rangos de duración; versión reducida corta y sin paseo.
- Cues una sola vez; SALTAR sin reloj; REPETIR con un solo reloj; congelar.
- `dispose` sin nada después.
- Input con cartas reales, siglas sin recorte y bandera solo nacional.
- Respaldo 2D en todos los casos; tope de DPR y equipo modesto.
- `stopAll` del audio corta todo y no hay sonido sin contexto.
- DOM final, asset roto, «9» antes que «95», reducido sin caídas.
- Aislamiento y 404.

## AT · Comprobaciones en navegador
`scripts/_walkout-runtime.ts`: 11/11 OK tanto en dev como contra la build de producción (`runtime-report.json`).

## AU · Capturas
En `docs/product/qa/walkout-0.1/`, beats A–H (más el sobre, la apertura, «9» y el flash):
- 1440 y 390, en movimiento y en reducido, con Future Star en WALKOUT;
- STANDARD, RARE y MEGA a 1440;
- equipo y final de base, record-breaker, moments y champions a 1440 y 390.

## AV · Vídeos de revisión
Generados por fotogramas deterministas (congelando cada instante de la misma timeline) a 24 fps:
- `video-future-star-WALKOUT-motion-1280.mp4`
- `video-future-star-WALKOUT-motion-390.mp4`
- `video-moments-MEGA_WALKOUT-motion-1280.mp4`
- `video-future-star-WALKOUT-reduced-390.mp4`
- `video-base-STANDARD-motion-1280.mp4`

No son una grabación en tiempo real; la fluidez real hay que verla en tu navegador.

## AW · Iteraciones visuales hechas durante la QA
1. El armazón global (cabecera, banner PWA) tapaba la escena: ahora se usa `z-modal`, como la apertura real.
2. Había hotspots enormes en el suelo: menos metal y luces laterales recolocadas.
3. La silueta era un maniquí gris: ahora es oscura con borde de luz, y sigue en sombra durante el flash.
4. Faltaba profundidad: tiras LED en el suelo (y líneas de fuga en el 2D).
5. Los rótulos acoplados eran ilegibles: ahora crecen al acoplarse.
6. El respaldo mostraba «PAPE»: ahora usa las siglas impresas («PRX»).
7. El paso no se leía de frente: cámara de tres cuartos y vaivén de cadera y hombros.
8. Las piezas tapaban al caminante: ahora entran por encima de él y la anterior se retira antes.
9. En el fotograma final el beat `final` quedaba a 0: corregido en `frameAt`.

## AX · Puntos débiles a revisar a ojo (sin maquillar)
- **La persona:** es un maniquí de cápsulas. Se lee como alguien que camina, pero no es AAA; necesita un GLB con licencia y animación de paso (ver U).
- **El audio:** son marcadores sintetizados. No se han escuchado; en headless está silenciado y solo se han verificado su programación y su corte.
- **MEGA frente a WALKOUT:** se distinguen sobre todo por ritmo e intensidad de luz y flash, no por un recurso visual propio.
- **El arte del sobre:** es el arte oficial existente del proyecto (`packArtwork`), que lleva marca de terceros, igual que en la apertura real. Los derechos siguen siendo los ya documentados, sin resolver.
- **El rendimiento:** no está medido en GPU real.
- **En vertical:** la mitad superior del 3D queda en negro, ocupada por la fila de piezas. Funciona, pero conviene validarlo a ojo.

## AY · Gates
| Gate | Resultado |
|---|---|
| Suite completa | 6259/6259 (base 6239 + 20 nuevos) |
| Lint | 0 errores, 9 avisos (los de base; ninguno en el walkout) |
| Typecheck | OK |
| Build | OK (`○ /design-system/pack-walkout`) |

## AZ · Lo que no se ha hecho
- Sin migración, sin cuentas QA, sin tocar la BD ni a los usuarios. Siguen 2 usuarios y 2 admins.
- Sin despliegue, sin commit y sin push.
- F78 sin tocar. Temporada 2 sigue en DRAFT; Marketplace, Payments y recompensas de Pick'ems siguen OFF.
