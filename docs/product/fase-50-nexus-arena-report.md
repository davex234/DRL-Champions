# FASE 50 — NEXUS ARENA / MATCH BOARD 4.0 · Informe

Fecha: 2026-09-22 · Rama: `arch/stabilization` · Sin commit, sin push, sin deploy.

## 1. Baseline
`npm test` antes de tocar nada: **4613/4613** (confirmado). Túnel a la BD cerrado durante todas las comprobaciones.

## 2. Componentes encontrados
- Página: `src/app/duelos/jugar/page.tsx` (etapas, `Arena`, `ArenaBar`, revelación, golpe final, resultado).
- Tablero: `components/duel/MatchBoard.tsx` (+ cajón del historial).
- Piezas: `arena/ArenaEnvironment` (recinto), `arena/ArenaSurface` (mesa, bandas, raíles, huecos, bandeja), `arena/HandFan` (mano y dorsos), `arena/PlayedRow` (lo jugado), `arena/ClashBanner` (ejes), `experience/MatchHud` (cinta del turno y línea de 10), `Scoreboard.TurnTrack`, `DuelCard`, `DuelMoment` (resolución), `MatchComplete`, `ResultScreen`, `FullscreenToggle`, `TurnHistory`.
- CSS: `src/app/game-experience.css` (sección F45 del escenario y del recinto).

## 3. Qué se ha cambiado
Solo presentación. Motor, reglas, IA, dificultades, economía, catálogo, recompensas y mercado sin tocar (contratos D1/D2/98–101/119 verdes).

## 4. Arquitectura del Arena System
`src/lib/duel/arenas.ts` (datos puros): `ArenaTheme { arenaId, name, tagline, background{wide,narrow}, accentPlayer, accentOpponent, ambient{motes,beams,haze,crowd}, branding? }`, `ARENAS`, `arenaFor(mode)`, `ARENA_ACCENT`, `ARENA_MODE_LABEL`. Una arena nueva = una entrada en `ARENAS` + imágenes en `public/game/arenas/<id>/`. Hoy: **NEXUS Champions** para los cuatro modos. `MatchBoard arena={mode}` y `ArenaEnvironment variant={mode}` la leen.

## 5. Assets creados
`public/game/arenas/nexus-champions/stage-1920.webp` (139 KB) y `stage-960.webp` (50 KB). Generados en local con Z-Image-Turbo (Apache-2.0), semilla 47, elegido entre 6 candidatos; sin texto, logos ni assets de terceros. Procedencia completa: `docs/product/qa/fase50/arena-asset-provenance.json`. Dorso NEXUS de carta rival: CSS + `branding/icon/icon-mono.svg` (sin raster nuevo).

## 6. Background
`ArenaEnvironment` es `fixed inset-0` (llena el viewport, también en pantalla completa) con z-index −1: aire → estadio (imagen, parallax lento `nx-a50-drift` 46 s) → grada que late → luz rival → luz tuya → 4 focos contados → suelo cian → horizonte → paredes → bruma → baño del atacante / golpe del turno → 12 motas → viñeta. El centro de la imagen se oscurece para leer las cartas. Móvil usa la imagen de 960.

## 7. Iluminación rival / jugador
Acentos únicos: rival `#ff2e63`, jugador `#2fe0ff` (antes verde). Arriba: techo rojo/magenta, plataforma trapezoidal con filo rojo, dorsos con aura roja. Abajo: suelo cian, plataforma cian, raíl de la mano cian, botón de jugada cian. El bando que ataca lava la escena desde su borde; el golpe del turno tiñe del color de quien lo gana.

## 8. HUD
`arena/MatchTopBar.tsx`: marca NEXUS · modo (Partida rápida / Road to Champions / Draft Gauntlet) · «vs rival · dificultad» · TURNO n/10 animado · pista de 10 · fase de ataque/defensa · último turno / punto de partida (de `turnHeader`) · marcador cian–rojo · ayuda, sonido, pantalla completa y Salir (los monta la página con los mismos textos y tamaños). La cinta del tablero pasa a lectores de pantalla a partir de `sm` (`compact`) y la tira de la mesa se retira con la barra encima; en la arena PvP todo sigue como estaba.

## 9. Timeline
10 segmentos (`TurnSegments`, sobre `buildTimeline`): cian = punto tuyo, rojo = rival, ámbar = empate, blanco = en juego, oscuro = pendiente; cada uno con su etiqueta accesible. La línea tocable de turnos sigue en móvil y en el cajón del historial.

## 10. Duel Zone
Sin caja: línea de energía roja→blanca→cian, charco de luz, sello **VS** itálico con degradado rojo/cian, anillo de energía que gira despacio y late; al estar las dos cartas se enciende. Marcadores en hexágonos con filo del bando. Cartas del duelo ×2,3 posiciones (≈190–250 px de ancho en escritorio), entrada desde su lado con escala y rotación 3D, aura del bando y sombra. Eje del duelo (p. ej. STRONGHOLD 60 VS ENTRYFRAG 91) bajo el VS.

## 11. Hand
Arco real (±12° con 10 cartas, caída cuadrática), cartas hasta 108 px, hover sube 16 px y crece 7 %, vecinas se apartan, la elegida sube 24 px, se endereza y brilla en cian; brillo por rareza (paleta de la variante). El envoltorio no se transforma y reenvía el clic de su hueco: sin zonas muertas al levantarse. Móvil: carril desplazable, toque = elegir (como siempre).

## 12. Animaciones
Entrada de carta rival (460 ms) y tuya (440 ms); resolución en 4 tiempos (0/260/520/760 ms) con onda de choque de 620 ms en la comparación; golpe final 1,2 s saltable. Todo sobre `transform`/`opacity`. La resolución ya no es un modal opaco con desenfoque: velo radial que deja ver el estadio.

## 13. Fullscreen
El recinto es `fixed inset-0`, así que en pantalla completa llena el monitor sin márgenes; la barra es sticky e integrada. `--pos = 13vh − 33px` (medido) hace que el tablero y la mano quepan sin scroll: a 1920×1080 la mano acaba en 1061 px. (La API real de pantalla completa no se puede disparar en Chrome sin cabeza: la captura «fullscreen» es el viewport 1920×1080 sin cromo del navegador, que es lo que se ve en pantalla completa.)

## 14. Mobile
390×844: barra compacta (modo, rival, marcador, ?, pantalla completa, Salir), cinta del turno visible, plataformas, duelo grande con VS, placa de ejes debajo, botón de jugada a todo el ancho, mano desplazable 10/10 visible, línea de 10 turnos debajo.

## 15. Reduced motion
`MotionConfig reducedMotion="user"` intacto; toda animación nueva vive bajo `no-preference` y el bloque `reduce` apaga estadio, focos, bruma, grada, línea, anillo, VS, huecos, pista y onda (test F50 06). Capturas `*-reduced.png`.

## 16. Performance
Imagen WebP ≤ 139 KB; ningún `backdrop-filter`, `mix-blend-mode`, grano ni `filter: blur` en las capas nuevas (test F50 07); focos con gradientes suaves en vez de desenfoque; 12 motas y 4 focos contados. Corrección encontrada en la QA real: el aura de las cartas del duelo pasa de `filter: drop-shadow` sobre la transformación 3D a `box-shadow` en su propia capa (en Chrome con GPU la carta se capturaba sin imagen).

## 17. QA de partida completa
Tres partidas PvE reales en `localhost:3005` contra la BD del VPS con la cuenta demo, jugadas desde la UI (carta, eje, «Declarar y atacar»/«Responder», revelación, siguiente turno, resultado). Evidencia: `docs/product/qa/fase50/real-matches.json`.

## 18. Easy / Normal / Hard
| Dificultad | Turnos | Revelaciones | UI | Servidor | Decidido por | Discrepancias |
|---|---|---|---|---|---|---|
| Normal | 10 | 10 | 3–5 derrota | 3-5 RIVAL | SCORE | 0 |
| Fácil | 10 | 10 | 6–5 victoria | 6-5 YOU | OVR_TIEBREAK | 0 |
| Difícil | 10 | 10 | 2–8 derrota | 2-8 RIVAL | SCORE | 0 |

## 19. El motor produce los mismos resultados
Cada veredicto y marcador de cada revelación coincide con `history[n]` del servidor (0 discrepancias en 30 turnos) y el final coincide con `result`. Ningún fichero de `domain/cardgame`, `server/` ni reglas se ha tocado; los contratos del motor (`duel-turns-2`, `duel-combat-2`, bots 0/0,5/0,85, alternancia, eje del defensor) siguen verdes.

## 20. Capturas
`docs/product/qa/fase50/before/` (30, build anterior, arnés F45) y `docs/product/qa/fase50/after/` (68): escenas start, rival-played, selecting, both, turn-win, turn-loss, mid, t10, complete-win, result-win en 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024 y 390×844, más 8 con movimiento reducido. Arnés: `/design-system/fase50?scene=…`; instrumento: `scripts/_fase50-shots.ts` (`--measure` da las cajas y si la mano cabe: 10/10 en todas).

## 21. Tests
**4628/4628** (4613 + 15 nuevos en `components/duel/arena50.render.test.tsx`).

## 22. Types
`npm run typecheck` (web + scripts): PASS.

## 23. Lint
`npm run lint`: **0 errores**, 28 avisos preexistentes (ninguno en ficheros de esta fase).

## 24. Build
`npm run build`: PASS (`prerender-manifest.json` presente). Servida en `http://localhost:3005`.

## 25. Catálogo final
331 cartas (sin cambios; ni catálogo ni imágenes de carta tocados). Las cartas diseñadas ya no llevan el nombre/OVR duplicados encima de su cromo impreso: solo se añade el trío de combate.

## 26. Migration head
`0054_tactical_compositions.sql` (esta fase no crea migraciones).

## 27. Marketplace flag
`GLOBAL_MARKET_ENABLED = false`.

## 28. Archivos
Nuevos: `src/lib/duel/arenas.ts`, `src/components/duel/arena/MatchTopBar.tsx`, `src/components/duel/arena50.render.test.tsx`, `src/app/design-system/fase50/page.tsx`, `scripts/_fase50-shots.ts`, `public/game/arenas/nexus-champions/*.webp`, `docs/product/qa/fase50/**`, este informe.
Modificados: `app/duelos/jugar/page.tsx`, `components/duel/{MatchBoard,DuelCard,DuelMoment,MatchComplete,ResultScreen,Scoreboard}.tsx`, `components/duel/arena/{ArenaSurface,ArenaEnvironment,HandFan,PlayedRow,ClashBanner}.tsx`, `components/duel/experience/MatchHud.tsx`, `app/game-experience.css`, `lib/duel/duel.test.ts` (UI_FILES). Copias previas de cada uno en el scratchpad de la sesión.

## Deudas y observaciones
- La QA en el Chrome del usuario se hizo con la pestaña en segundo plano (`visibilityState: hidden`, 958×428): sin `requestAnimationFrame` las animaciones de salida no terminan hasta volver a primer plano. Las capturas a tamaño real salen del Chrome sin cabeza.
- La arena PvP comparte el tablero nuevo, pero su barra superior sigue siendo la de siempre (fuera del alcance).
- Las tres partidas de QA dieron sus recompensas normales de PvE a la cuenta demo (juego normal, sin tocar la economía).

## 29. GO / NO-GO
**GO.** El tablero real es una arena 2.5D con estadio propio, bandos rojo/cian, HUD y pista de 10, Duel Zone con VS, cartas grandes, resolución y resultado dentro del estadio, mano en abanico, responsive y movimiento reducido; motor intacto (0 discrepancias en 30 turnos reales) y todas las comprobaciones en verde.

FASE 50 — CERRADA
