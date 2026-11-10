# Fase 44 — Game Experience 4.0 «From website to videogame» · Informe

Fecha: 2026-09-17 · Rama `arch/stabilization` · sin commit, sin push, sin deploy, sin migración (última 0053), sin Docker local.
Contrato: [`game-experience-contract.md`](game-experience-contract.md) · QA: [`qa/fase44/README.md`](qa/fase44/README.md) · Arnés: `/design-system/fase44`.

1. **Estado inicial.** F43 cerrada con GO: 3.702/3.702 tests. Build de producción de F43 intacta en `.next` (usada como BEFORE). BD real en el VPS por túnel; cuenta QA `8c326e52` (6.750 créditos, 40 cartas, 2 equipos, c1-n1).
2. **Recorrido inicial como jugador.** Login → Home → Jugar → PvE (preparación) → Ranked → Campaña → Draft → Tienda → Inventario → Colección → Ficha → Equipos → Temporada → Logros → Objetivos → Eventos → Pick'ems → Perfil → Cuenta → Social → Recompensas → 404, más 35 momentos de arnés (partida, sobre, campaña, draft, colección), a 1440 y 390.
3. **Problemas web-like encontrados.** JUGAR = enlace de 13 px entre cinco iguales (móvil: una pestaña); Home abría con «Reclamar» sin JUGAR a la vista; 404 de Next en inglés; sin error boundary; spinners genéricos en ~60 cargas; acciones del resultado bajo la historia; XP estática (y falsa al subir de nivel); ABRIR OTRO bajo el pliegue; inventario con cajas discontinuas y enlace al Mercado cerrado; Mercado en el menú; Ranked con placa de métricas; varios CTA rojos compitiendo (Pick'ems, Equipos); fake live de un evento DEMO; sin acceso móvil a Temporada/Eventos/Social.
4. **Game Experience Map.** `qa/fase44/game-experience-map.json` (23 filas: propósito, acción principal/secundaria, problema, objetivo, nivel de movimiento, cambio; fuente `src/design/gameExperienceMap.ts`).
5. **Screenshots BEFORE.** 118 en `qa/fase44/before/` (59 pantallas × 1440/390) sobre la build de F43.
6. **Design System antes.** Tokens (`tokens.ts`), 6 momentos de movimiento (`motion.ts`), `NxButton`, superficies, `Meter`, `Badge`; estados genéricos (`States.tsx` con spinner y emoji), `Toast` con «✓/✕».
7. **Design System después.** Mismo sistema extendido (no paralelo): `MOTION`, `MOTION_LEVELS` 0–4, `SPRING`, familias de transición; primitivas `ui/game`: `PlayButton` (GameCTA), `GameLoader`, `GameSkeleton`, `GameError/GameEmpty/GameOffline/GamePanelState`, `GameSheet/GameModal`, `GameMoment` (toast de juego), `XpProgress` (GameProgress), `AudioSettingsPanel`; `States.tsx`/`Toast.tsx` delegan en ellas.
8. **Game Shell.** Barra de juego (`nx-gamebar`), logo «NEXUS Lobby», secciones altas de toda la barra, cartera, «Más», **JUGAR**; dock móvil con JUGAR hexagonal elevado; hoja «Menú»; aviso global sin conexión; saltar al contenido; `MotionConfig reducedMotion="user"`.
9. **Navegación global.** Colección · Equipos (sección nueva) · Sobres · Temporada · Mundo + «Más» (modos, duelos, competitivo, social, eventos, Pick'ems, entrenador). Móvil: Inicio · Cartas · JUGAR · Sobres · Perfil + Menú con todo y el sonido. Mercado fuera del menú.
10. **JUGAR global.** `PlayButton` en barra (46 px), dock (72 px) y lobby (76 px); 1 clic al selector de modos; `data-game-cta`, nombre accesible.
11. **Continue Match.** `GET /api/game/play-status` (solo GET, sin parámetros, Bearer, lectura pura) → `readActiveMatches` + `primaryResume` (misma lectura y orden que el vestíbulo). Verificado en real: partida abierta → «CONTINUAR PARTIDA» en `/temporada` → entra en ESA partida → al terminar vuelve a JUGAR.
12. **Play CTA motion.** Barrido de luz lento (6 s, único bucle), halo estático que se intensifica, hover +2,5 %, press 96,5 %, icono se desplaza; todo apagado con movimiento reducido.
13. **Page transitions.** 4 familias: gameplay 180 ms (sube), collection 240 ms (profundidad), season 300 ms (luz), default 200 ms; reducido 120 ms fundido; solo transform/opacity.
14. **Background system.** Se conserva `DynamicGameBackground` (luz por sección, rejilla, partículas acotadas, viñeta); nuevo tinte de sección «equipos»; escenario del lobby con líneas de energía.
15. **Ambient motion.** Partículas ya existentes (paradas con pestaña oculta y quietas con reducido) + barrido de JUGAR; nada más en bucle.
16. **Home antes.** Héroe «2 niveles del pase · 1 logro por reclamar», JUGAR ausente del primer pantallazo (también en móvil), bloques de igual peso.
17. **Home después.** Escenario **TU PRÓXIMA PARTIDA** con equipo real, JUGAR grande y 4 modos; debajo la acción del Live Service («Reclamar») en nivel contexto; un único dominante (medido en real: `primaries: 1`).
18. **Lobby Hero.** `DailyHero tier`: «stage» si la acción del día ya es jugar/continuar (botón de juego) y «context» si no; mismo contenido, cero decisiones nuevas.
19. **Play Area.** `LobbyPlayStage`: Partida rápida, Road to Champions (x/15 nodos real), Competitivo (rating real), Draft (estado real de la run).
20. **Mode Selector.** `/jugar` conserva Road to Champions como héroe; fichas de modo grandes con arte propio (SVG de la casa), respuesta al apuntar/enfocar, CTA de 52 px y estado real.
21. **PvE selection.** «Partida rápida» → preparación (PvE fácil/normal/difícil de F33), 2 clics desde Home; verificado en real.
22. **Ranked selection.** Ficha «Competitivo» del lobby y del selector → `/duelos/competitivo` con **JUGAR RANKED** como botón de juego.
23. **Campaign selection.** Ficha del lobby (1 clic) → mapa; verificado en real («tile del lobby»).
24. **Draft selection.** Ficha del lobby (1 clic) → landing de Draft; verificado en real.
25. **Match loading.** Spinner sustituido por `GameLoader` (marca NEXUS, barras de carga, frase real «Preparando duelo…»), sin porcentaje; PvE no finge búsqueda.
26. **PreMatch.** Se conserva el de F33/F43 (tu equipo, VS, rival conocido o carta a carta, perfil estratégico).
27. **Combat entrance.** `MatchIntro` de F33 intacto (sin cambios de motor).
28. **Turn transitions.** F33 intactas (cabecera de turno, momento de duelo, punto de partida derivado).
29. **Stat comparison.** `DuelMoment` de F33 intacto (eje, valores, ganador; números ya decididos).
30. **Score feedback.** Marcador de F33 intacto (pulso por punto, sin celebración por punto).
31. **Victory.** Nivel 3: titular con impacto, corona, **barrido de luz una vez**, recompensa del servidor, XP que sube, acciones en el primer pantallazo (medido en real: `actionsTop 560 px`).
32. **Defeat.** Presentación propia sin barrido de celebración, progreso y REVANCHA / VOLVER AL LOBBY; lectura estratégica debajo.
33. **Draw.** Nivel 2, titular «Empate» dorado, misma estructura de acciones.
34. **Ranked result.** `RatingDelta`: antes → flecha → después (impacto) → delta; solo cifras reales (test: ninguna intermedia).
35. **XP feedback.** `xpTimeline` + `XpProgress`: del XP anterior real al nuevo real, tramo por nivel, ≤ 1,2 s, accesible.
36. **Level Up.** «SUBIDA DE NIVEL · Nivel 7 → 8» solo si cambia el nivel; varios niveles resueltos por tramos; momento «Subida de nivel» visto en real (nivel 7 al abrir el sobre).
37. **Mission Complete.** `momentsFromProgress` → rótulo «OBJETIVO COMPLETADO · Gana un duelo» (visto en real tras la PvE), una vez por hecho.
38. **Achievement Unlock.** Mismo mecanismo («Logro desbloqueado», clave `achievement:<id>`); solo con evento real entre dos lecturas.
39. **Packs antes.** Tienda ya de escaparate (F9.6/F41); inventario con cajas discontinuas, «Abrir →» diminuto y Mercado anunciado.
40. **Packs después.** Inventario «MIS SOBRES»: escenario del sobre + ABRIR SOBRE; vacío con CONSEGUIR SOBRES / JUGAR; sin Mercado.
41. **Pack inventory.** Rejilla de sobres con botón «Abrir» de 44 px y escenario del primero.
42. **Pack object.** `PackOpenStage`: `SealedPack` canónico inclinado, halo de su acento, respuesta al apuntar (nivel 1), sin WebGL.
43. **Open Pack CTA.** «Abrir sobre» 60 px dominante (`data-cta="primary"`) → `/abrir/<id>`; verificado en real.
44. **Pack ceremony.** Secuencia de F38 intacta (listo → petición → rotura → mano → revelados → resumen); verificado en real con un Sobre Estándar.
45. **Anticipation.** Heraldo/corona de F38 solo con el resultado del servidor (fuzzer: 0 cartas antes de `OPEN_SUCCEEDED`).
46. **Card backs.** Mano boca abajo de F38 intacta.
47. **Common reveal.** Nivel 2 (F38, `rarityCeremony` basic).
48. **Uncommon reveal.** Nivel 2 (metallic).
49. **Rare reveal.** Nivel 3 ligero (premium).
50. **Epic reveal.** Nivel 3 (extended, rayos).
51. **Legendary reveal.** Nivel 4: sala apagada + rayos + **luz de sala** nueva tras girar (1,1 s, sin bucle; halo fijo con reducido).
52. **Serial #1.** Nivel 4 con luz dorada + heraldo «Serial #1» (F38); sin efecto económico.
53. **New Card.** «Nueva / Nueva variante» en verde (F38).
54. **Duplicate.** «Duplicada ×N» secundario, sin valor ni venta.
55. **Skip.** «Saltar» + teclas S/Esc (F38); fuzzer: SALTAR siempre llega al resumen (10.000 secuencias, 0 fallos).
56. **Open Another.** «Abrir otro sobre · N» dominante en dock pegado; doble clic = 1 petición.
57. **Pack Summary.** Cinco cartas, nuevas/duplicadas/rareza/serial, colección X→Y, dock ABRIR OTRO · VER EN MI COLECCIÓN · JUGAR (medido en real: dock visible sin desplazar, 1 dominante, 5 cartas).
58. **Collection antes.** Sala de F37 (cabecera con carta, libro, álbum paginado de 48); cartas sin respuesta al apuntar.
59. **Collection después.** Igual estructura + carta que se eleva al apuntar/enfocar; estados de carga/vacío de juego.
60. **Collection entrance.** Escalonado acotado ya existente (≤ 0,28 s) y paginación de 48; nunca 772 animaciones.
61. **Card hover.** `nx-card-lift` (−5 px, 140 ms, solo transform; quieto con reducido); rareza visual sin implicar poder.
62. **Card Detail.** Ficha de F37 intacta (carta grande, OVR, stats, rol, colección, uso en equipos, comparar); verificada en real desde el resumen del sobre.
63. **Decks antes.** Hub con tres botones rojos (JUGAR, NUEVO EQUIPO, ACTIVAR).
64. **Decks después.** Loadout con **JUGAR** (52 px) como único dominante; nuevo equipo/activar secundarios.
65. **Active Deck.** Chip «Equipo activo» (F32) + escenario del lobby «Equipo listo · Equipo 2 · 813 OVR».
66. **Legal Deck feedback.** Momento **PLANTILLA LISTA** solo al pasar de incompleto a legal (o nuevo legal), sin recompensa.
67. **Activate Deck.** Momento **EQUIPO ACTIVO** con el nombre real tras `set_active` del servidor.
68. **Strategy Lab.** F43 intacto (laboratorio en el constructor); verificado en real.
69. **Swap motion.** Vista previa de F43 (impacto antes → después sin guardar); no se añadió animación de «sale/entra» (P2).
70. **Campaign antes.** Mapa con ruta y nodos (F35).
71. **Campaign después.** Sin cambios de mapa; entrada 1 clic desde el lobby.
72. **Campaign progression.** Real: nodo c1-n2 superado, 1→2 nodos, siguiente c1-n3; la ruta avanza por datos del servidor, sin desbloqueos falsos.
73. **Draft antes.** Landing con identidad propia (F39).
74. **Draft después.** Sin cambios de pantalla; entrada desde el lobby y estado real de la run en la ficha.
75. **Draft Pick.** Elección de F39 (3 opciones, vista previa, confirmar) verificada en arnés; fuzzer de `pickUiReducer` 10.000 sin bloqueos.
76. **Draft Run.** Mapa de 5 fases de F39 intacto; Draft sigue sin economía.
77. **Ranked antes.** Cifra 1000 en placa, botón estándar, cajas discontinuas.
78. **Ranked después.** Emblema hexagonal con el rating real, **JUGAR RANKED** como botón de juego, título grande, vacíos como notas de juego.
79. **Season antes.** Héroe de temporada de F34 ya de juego.
80. **Season después.** Sin cambios de contenido; transición de familia «temporada»; JUGAR/CONTINUAR siempre en la barra.
81. **Battle Pass.** Carril de recompensas de F34 intacto (sin cambios de recompensas ni «reclamar todo»).
82. **Missions antes.** Tarjetas de objetivos de F42 (hoy/semana).
83. **Missions después.** Igual + momento OBJETIVO COMPLETADO al cumplirse por una partida.
84. **Daily.** «Hoy» de F42 (reset, progreso, recompensa real).
85. **Weekly.** «Esta semana» de F42.
86. **Achievements.** Colección de logros de F34/F36 intacta + momento al desbloquear.
87. **Events.** Eventos reales con estado; **fake live corregido**: el DEMO dice «Partido de demo», nunca «En directo» (verificado en real).
88. **Pick'ems.** Predicción de F24/F30 con un único dominante («N predicciones pendientes»); sin fuga de respuestas.
89. **Profile.** Perfil de F31 intacto; ajustes separados en Cuenta con **Sonido**.
90. **Empty states.** `GameEmpty`: título, pista y siguiente acción real; `EmptyState` añade JUGAR; sin emoji.
91. **Error states.** «NO SE HA PODIDO CARGAR» + REINTENTAR + VOLVER AL LOBBY; `playerMessage` traduce errores técnicos; `error.tsx`/`global-error.tsx` sin traza.
92. **Offline.** «ESTÁS SIN CONEXIÓN · Los datos mostrados pueden estar desactualizados.», un aviso por pantalla (las que ya tenían el suyo no lo duplican).
93. **Skeletons.** `GameSkeleton` hero/cards/deck contextuales; esqueleto del lobby de F36 conservado.
94. **Toasts.** Placa de juego con glifo, sin «✓/✕», errores filtrados; momentos para hitos (plantilla lista, equipo activo, objetivo, logro, nivel).
95. **Copy audit.** Verificador: 0 «Success/Updated/Saved/No data/Failed to fetch» en pantallas; 404 en español; textos técnicos filtrados.
96. **Button hierarchy.** PRIMARY GAME CTA (`PlayButton`), primary contextual (`NxButton` primary/accento), secondary, tertiary, ghost, danger.
97. **Microinteractions.** Botones/JUGAR/modos/cartas/sobre: 120–180 ms, solo transform/opacity.
98. **Motion tokens.** `MOTION.fast/normal/game/celebration/exceptional`, `SPRING.card/button/sheet`, `MOTION_LEVELS`, `pageMotion`, `boundedStagger`.
99. **Sound decision.** Existía síntesis Web Audio (`lib/sound.ts`): se añadieron eventos con nombre (`ui.hover … level.up`) y ajustes general/efectos/silencio en `localStorage`; sin ficheros ni descargas; nada suena sin gesto.
100. **Reduced Motion.** `MotionConfig user` global, transiciones a fundido, CSS de juego bajo `no-preference`; 59 capturas con reducido; laboratorio lo detecta (`data-reduced=true`).
101. **Performance before.** Build F43, 1440×900, mediana de 3: 0 fotogramas lentos; CLS sobre 0,63/0,45; bundle JS 8,12 MB.
102. **Performance after.** Bundle JS 8,04 MB (−1,1 %); 0 fotogramas lentos en todas; CLS sobre 0,0006; Home +25,2 % JS transferido por prefetch (justificado); resto +2–13 %.
103. **Collection performance.** JS +13,1 %; tareas largas 64 → 54 ms; CLS 0,108 → 0,0006; DOM 4.115 → 4.147; 0 fotogramas lentos.
104. **Pack performance.** Legendaria y resumen: CLS 0,625/0,447 → 0,0006; 0 tareas largas; 0 fotogramas lentos.
105. **Combat performance.** 0 fotogramas lentos; 1 tarea larga de 72 ms en el arnés (simulación del motor en cliente), bajo el umbral.
106. **Mobile.** 103 capturas 390; dock con JUGAR, menú completo, 0 desbordamientos.
107. **Tablet.** 50 capturas 1024; bug de JUGAR recortado a 1024 px corregido (0 bloqueos).
108. **Desktop.** 103 capturas 1440 + 24 a 1920.
109. **Ultrawide.** Matriz a 1920 y 2560: 0 bloqueos.
110. **Touch.** JUGAR 46/72/76 px; NxButton md/lg ≥ 44; controles de hojas 44 px.
111. **Keyboard.** Matriz real 18/18: saltar contenido, JUGAR, modos, PvE, sobres, colección, equipos, menú móvil y diálogo.
112. **Focus.** Contorno visible en todo el recorrido; JUGAR con contorno blanco de 3 px; ↓ abre desplegables (de 26 a 10 Tab hasta JUGAR, medido).
113. **Accessibility.** Diálogos modales con foco atrapado/devuelto, `aria-live` en momentos/toasts/cargador, barras con valor y etiqueta, rareza anunciada.
114. **FTUE Welcome.** Guía de F40 manda (sin escenario encima); «Abrir mi primer sobre» intacto.
115. **FTUE First Pack.** Ceremonia de F38 con resumen y dock.
116. **FTUE First Legal Deck.** «PLANTILLA LISTA» (F40) + momento del constructor.
117. **FTUE First Match.** «JUGAR MI PRIMER COMBATE» como botón de juego grande (76 px).
118. **Returning Player.** «De vuelta» de F42 integrado encima del escenario (sin modal).
119. **Live Service integration.** Contenido y orden 100 % de `orderToday`; la presentación solo decide tier y escenario; `play-status` reutiliza sus lecturas.
120. **Before/After comparison.** BEFORE 118 · AFTER 341 (mismos ids de pantalla); ver `before/` y `after/`.
121. **Design Harness.** `/design-system/fase44`: 70 escenas en las 28 secciones del encargo (nativas + arneses reales enlazados).
122. **QA screenshots.** 496 en total: 118 BEFORE + 341 AFTER (escritorio 103, panorámico 24, móvil 103, tablet 50, reducido 59, especiales 80) + 37 reales.
123. **Real QA account.** `8c326e52`; escrituras legítimas por API normales: 2 PvE Fácil, nodo c1-n2, compra y apertura de 1 Sobre Estándar.
124. **Real Home.** Escenario JUGAR + héroe contexto, 1 dominante.
125. **Real Play.** JUGAR → selector (1 clic) → Partida rápida → preparación.
126. **Real PvE.** Fácil jugada entera por la interfaz (victoria 6-4), y una segunda retomada con CONTINUAR PARTIDA.
127. **Real Result.** Acciones antes de la historia, XP de juego, REVANCHA, VOLVER AL LOBBY; momento OBJETIVO COMPLETADO real.
128. **Real Pack.** Compra 750 créditos → inventario ABRIR SOBRE → ceremonia → resumen (+5 cartas, sobre consumido, SUBIDA DE NIVEL real).
129. **Real Collection.** Colección 40 → 45 y ficha de la carta destacada.
130. **Real Deck.** Laboratorio de «Equipo 2» y JUGAR con este equipo → preparación.
131. **Real Campaign.** Nodo c1-n2 «Presión alta» ganado 8-2, +50 primera victoria, mapa avanza.
132. **Real Draft.** Landing real con NUEVA RUN (no iniciada, para no dejar una run abierta).
133. **Real Ranked.** JUGAR RANKED como botón de juego.
134. **Real Season.** Temporada desde la barra; con partida abierta la barra dijo CONTINUAR PARTIDA.
135. **Player Path A.** HOME → JUGAR → PvE → RESULT → JUGAR OTRA: OK.
136. **Player Path B.** HOME → SOBRES → ABRIR → COLECCIÓN → CARTA → EQUIPOS: OK.
137. **Player Path C.** HOME → EQUIPO → ESTRATEGIA → JUGAR: OK.
138. **Player Path D.** HOME → CAMPAÑA → NODO → RESULTADO → SIGUIENTE NODO: OK.
139. **Player Path E.** HOME → DRAFT → (PICK en arnés) → RUN: OK con la elección en arnés.
140. **Player Path F.** HOME → TEMPORADA → OBJETIVO → JUGAR: OK.
141. **Dead End Detector.** 21 pantallas core, 0 sin salida (`dead-end-report.json`).
142. **Click Depth.** Jugar 1 · PvE 2 · Ranked 2 · Campaña 1 · Draft 1 · Abrir sobre propio 1 · Colección 1 · Equipos 1.
143. **Play Visibility.** 154 capturas core AFTER: JUGAR (o CONTINUAR) visible en todas (`play-visibility.json`, 0 fallos).
144. **Web-like Detector.** Heurísticas por captura (tablas, spinners, CTA, textos técnicos, Mercado, errores de carga) + verificador de copy; 393 filas, 0 incidencias.
145. **Navigation Fuzz.** 100.000 secuencias · 749.128 pasos · 32 nodos · 0 violaciones.
146. **Motion Fuzz.** 40.000 secuencias (momentos, ceremonia, draft, XP) · 0 violaciones.
147. **Responsive Matrix.** 119 mediciones en 320–2560 · 0 bloqueos (tras corregir 1024 px).
148. **Reduced Motion Matrix.** 59 capturas reales y de momentos con `prefers-reduced-motion: reduce` + test CSS.
149. **Accessibility Matrix.** 18/18 con teclas reales, 0 bloqueos.
150. **Security.** Sin cambios de autoridad: `play-status` solo lectura y sin parámetros; la UI no calcula recompensa, rareza, rating ni XP (test); `security:verify` verde.
151. **Pack Opening regression.** `pack-opening:verify` ×3 verdes; idempotencia y servidor primero intactos.
152. **Collection regression.** `collection-room/content/security/performance/presentation` verdes.
153. **Deck regression.** `deck:verify` y tests del constructor verdes.
154. **Strategy regression.** `deck-strategy` ×7 verdes.
155. **Combat regression.** `combat:verify` verde; motor sin cambios.
156. **PvE regression.** Tests de duelo/gameplay verdes; PvE real jugada.
157. **PvP regression.** `social:verify`, `competitive:verify`, privacidad de rival intacta.
158. **Ranked regression.** `competitive:verify` verde.
159. **Campaign regression.** `campaign` ×4 verdes; nodo real jugado.
160. **Draft regression.** `draft-gauntlet` ×5 verdes.
161. **Season regression.** `season` ×5 y `battlepass` verdes.
162. **Live Service regression.** `live-service` ×6, `daily-loop` ×3, `pack-objective` ×3, `player-journey` ×4 verdes.
163. **Economy regression.** `economy` ×7 verdes; libro real coherente.
164. **Tests nuevos.** +383 (3.702 → **4.085**): `design/gameExperience.test.ts` 163, `lib/gameExperience` 34, `ui/game/gameExperience.render.test.tsx` 186.
165. **Verifiers nuevos.** `game-experience:verify` + navigation, motion, packs, play, accessibility, responsive, performance, copy (9, verdes).
166. **Gates finales.** `npm test` 4.085/4.085 · `tsc` web 0 · `tsc` scripts 0 · `next build` 0 · eslint 0 errores (2 avisos previos ajenos) · verificadores 73/78: los 5 restantes (`economy-market`, `content-catalog`, `content-version`, `content-pools`, `content-e2e`) requieren BD viva y dieron `fetch failed` con el túnel CERRADO a propósito; no formaban parte del conjunto de la Fase 43.
167. **Bugs encontrados.** 10 (ver 168) + 4 defectos de instrumento.
168. **Bugs corregidos.** Fake live DEMO; JUGAR recortado a 1024 px; barra de XP falsa al subir de nivel; ABRIR OTRO bajo el pliegue; momento tapando «VICTORIA»; 26 Tab hasta JUGAR; 404 en inglés y sin error boundary; varios dominantes (Pick'ems, Equipos); Mercado en menú e inventario; spinners genéricos.
169. **Cambios de gameplay.** 0.
170. **Cambios económicos.** 0.
171. **Migración sí/no.** No.
172. **DB changes.** 0 de esquema; escrituras solo de la QA real legítima.
173. **Archivos creados.** `src/design/{gameShell,gameExperienceMap,gameExperience.test}.ts`; `src/components/ui/game/*` (9); `src/components/dailyLoop/LobbyPlayStage.tsx`; `src/components/packs/PackOpenStage.tsx`; `src/lib/gameShell/playStatus.ts`; `src/lib/gameExperience/{xp,moments,deckMoments,gameExperience.test}.ts`; `src/server/services/playStatus.ts`; `src/app/api/game/play-status/route.ts`; `src/app/{game-experience.css,not-found,error,global-error}.tsx`; `src/app/design-system/fase44/*`; `scripts/game-experience-verify.ts`; `scripts/_fase44-{shots,perf,responsive,a11y,real-qa,real-nav}.ts`, `_fase44-gates.mjs`; docs (contrato, informe, QA).
174. **Archivos modificados.** `design/{motion,nav}.ts`; `layout/{GameShell,PageTransition,HydrationGate}`; `ui/{States,Toast}`; `dailyLoop/{DailyHero,DailyLobby}`; `modes/GameModesHub`; `duel/{ResultScreen,MatchSummary,pvp/PvpOutcome,deck/TeamHub,gameplay.contract.test}`; `packs/{PackSummary,CardReveal}`; `competitive/{CompetitiveHero,CompetitiveHub,Leaderboard,MatchHistoryList,RatingChart,CompetitiveRewards}`; `pickems/live/EventSummary`; `liveEvents/{bits,EventCard,EventHero}`; `progression/PostMatchProgress`; `album/AlbumGrid`; `journey/JourneyMissionControl`; `app/{layout,inventario,duelos/mazos,cuenta}`; `server/services/{dailyLoop,loop}.ts`; `domain/dailyLoop/index.ts`; `lib/sound.ts`; `package.json`.
175. **P2 restantes.** Prefetch de Home (+JS transferido tras pintar); 5 verificadores con BD no ejecutados; animación «sale/entra» del cambio de carta y continuidad colección→ficha no hechas; `ui.hover/ui.confirm` no conectados a todos los controles; Draft real no iniciado; 429 con QA en paralelo; aviso de tipos de hooks previo en Cuenta.
176. **Marketplace.** OFF (`GLOBAL_MARKET_ENABLED=false`), fuera de toda navegación; 0 capturas lo muestran.
177. **Worker/infra.** Sin tocar worker, cron, importer, Caddy, Cloudflare, Kong, Auth, Storage, Realtime, firewall ni SSH; túnel cerrado al terminar; app parada.
178. **Revisión visual final.** Revisadas BEFORE/AFTER de Home (escritorio/móvil/tablet), Jugar, Ranked, Inventario, Resumen de sobre, Legendaria, Resultado (real y arnés), CONTINUAR PARTIDA real, Equipos, Eventos, FTUE y 404.
179. **¿Sigue pareciendo una web?** No en las pantallas core: el armazón es un menú de juego con JUGAR dominante, el lobby enseña qué jugar, los momentos tienen impacto y los estados hablan como el juego. Quedan superficies secundarias densas en información (Objetivos, Recompensas, Social) que se leen más «panel» que «juego».
180. **GO / NO-GO.** **GO** con las salvedades de 166 y 175: ningún criterio de NO-GO se cumple, 4.085/4.085 tests, build y typecheck verdes, 73/73 verificadores ejecutables verdes, fuzzers y matrices a 0.
