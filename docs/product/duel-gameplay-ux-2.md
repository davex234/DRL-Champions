# DUEL GAMEPLAY UX 2.0 — sin reloj contra bots · carta rival oculta · rol del jugador · recompensas obtenidas

Fecha: 2026-10-06. Release final en producción: **`drl-0.1.1-1-d80d9f57`** (sobre `drl-0.1.1-1-510f9e22`). Sin migración
(cabeza **0073**). Sin commit ni push.

## A. Resumen
Las cuatro piezas están implementadas, probadas y desplegadas: (1) contra un bot no hay reloj de decisión, ni en el
servidor ni en la interfaz; (2) el rol canónico se ve en el reverso de las cartas del rival, en texto mientras no lleguen
los iconos; (3) la carta que el rival compromete atacando viaja y se pinta boca abajo hasta que respondes, y se revela con
un giro corto; (4) el resultado mínimo enseña «Recompensas obtenidas» con el recibo del servidor.

## B. Alcance
Solo duelos PvE (partida rápida, campaña, Draft Gauntlet) para el reloj; PvE y PvP para la carta oculta y los roles;
resultado mínimo de partida rápida para las recompensas. Fuera de alcance y sin tocar: ver BO.

## C. Auditoría previa (hallazgos)
1. El servidor enviaba la carta rival COMPLETA (`pendingRival.card` + valor) antes de que el defensor respondiera.
2. La proyección PvP dejaba ver la carta declarada en el snapshot y su uid en el `draft`.
3. El resultado enseñaba `award` recalculado con la tabla, no lo concedido (con el tope diario agotado mentía).
4. Las pistas de tipo ROL nunca se veían (no hay iconos).
5. El bot defensor conocía `attackerValue` (el valor de la carta del atacante).
6. El reloj F72.8 corría también contra el bot (plazo, sondeo al vencer y jugada automática).

## D. Decisión: información oculta simétrica
Si el humano defiende a ciegas, el bot también: `attackerValue: null` en el contexto de decisión del bot. Nadie gana
información prohibida en ninguna dirección.

## E. Reloj contra bot: diseño
`decisionDeadline(vsBot, m, now)` (`lib/duel/turnClock.ts`): contra bot → `null`; contra personas → `deadlineFor` de
siempre. Una sola función decide; el PvE la llama siempre con `true`.

## F. Reloj: servidor (`server/services/duels.ts`)
Sin plazo al crear ni al persistir; `withVersion` siempre `turnDeadlineAt: null`; `settleClock` es un no-op; fuera la rama
`TURN_EXPIRED` de `playTurn` y el ayudante `msOf`. Ninguna jugada se rechaza por tiempo.

## G. Reloj: cliente (`app/duelos/jugar/page.tsx`)
Fuera `TurnTimer`, `TimeoutNotice`, `useDecisionClock` y el sondeo al vencer. TURNO X/10 se mantiene.

## H. Reloj PvP intacto
Ranked, amistoso y torneo siguen con el reloj F72.8 exacto (`duelsPvp.ts` sin cambios; S10–S13 sin tocar y en verde).

## I. Partidas heredadas
Una fila PvE con `turn_deadline_at` guardado de antes se ignora: leerla no juega nada (probado con plazos vencidos hace 10 min).

## J. Reloj: pruebas
`turnClock.service.test.ts` UX2 S1–S7 (sin plazo; esperar 20× el plazo antiguo no mueve versión, turno, mano ni
historial; jugada manual después; partida entera a mano; doble envío = una transición; versión vieja 409; multipestaña)
+ S14 (PvE sin `autoDecision`, página sin reloj). F73: una partida desatendida ni termina ni suma.

## K. Carta oculta: PvE
`pendingRival: { committed: true, stat } | null`: ni carta, ni valor, ni uid. `MatchBoard` pinta `DuelCardBack` en la
ranura del rival (`data-testid="rival-committed"`, `data-hidden="true"`, `aria-label` genérico).

## L. Carta oculta: PvP
`projectMatchFor`: lo visible del rival = solo lo jugado; el `draft` redacta `attackerCardUid` cuando ataca el rival y
`defenderCardUid/defenderStat` cuando defiende; `leakedUids` también revisa el `draft`.

## M. Bot sin información prohibida
`controller.ts`: fuera `attackerValue()`; `buildContext` → `attackerValue: null`. Atacando, el bot nunca vio la carta del
humano. Las dos direcciones quedan cubiertas.

## N. UI de la carta comprometida
`RivalStats` con estado `declared-hidden` (SH/GS/EF con «?», sin cifras). La estadística declarada se lee en la mesa
(«RESPONDES CON ENTRYFRAG») y en tu panel (EF «OBLIGADA»); en el panel del rival no destaca visualmente (mejora opcional).

## O. Revelación
`DuelMoment`: el bando rival entra con giro `rotateY 180 → 0` (≈0,5 s, cara y dorso con `backface-visibility`).
Movimiento reducido: fundido, sin giro (`reveal-flip` ausente; medido en 1440/1024/390).

## P. Atomicidad
El compromiso es la misma transición atómica de siempre (`state_version` + `expectedVersion`): F5, dos pestañas, doble
envío (una aplicada, otra 409) y versión vieja (409) probados en servicio y en producción.

## Q. Sin fugas
Probado en payload (servicio + API de producción), DOM, árbol accesible (CDP `Accessibility.getFullAXTree`) y
`localStorage`/`sessionStorage` (navegador real en producción): uid, id de carta, id de jugador y nick de la carta que
luego se revela, ausentes antes de responder en los 5 turnos comprometidos de cada partida.

## R. Pistas y roles: sin fuga por diferencia
La carta comprometida sigue contando en la mano oculta del rival con su pista y su rol: si desaparecieran al
comprometerla, se deducirían por resta. Test «comprometer NO cambia pistas ni roles del reverso».

## S. Declaración pública
La estadística declarada por el atacante sigue siendo pública (`pendingRival.stat`), como pide la regla.

## T. Impacto en el juego (punto de decisión para ti)
Laboratorio `scripts/balance/simulate.ts` (bots, escala 0,25): EASY no cambia (heurística 0; aleatorio vs EASY 0,504 →
0,504). NORMAL/HARD pierden la ventaja de defender viendo la carta. Como ahora defienden a ciegas los DOS lados (el humano
por diseño), el simulador cambia también la política del «jugador»: OVR_MAX con política HARD vs bot HARD 32,5 % → 19,9 %;
vs bot NORMAL 74,3 % → 60,8 %; casi todo lo demás ±0–4 pp. No se tocó el balance de cartas ni las dificultades; si quieres
compensar, se ajustaría `DIFFICULTY_PROFILE` en otra fase.

## U. Rol: datos canónicos
`card.role` del catálogo (el rol de la carta manda), calculado en servidor (`rivalRolesFor`) y alineado 1:1 con las
pistas (misma pasada y mismo orden por hash). Nunca uid, jugador, OVR ni estadísticas.

## V. Rol: mapa de iconos
`lib/duel/roleIcons.ts`: `ROLE_ICON_SRC` (Duelista, Iniciador, Centinela, Controlador, Flex) todo `null`. Para activar:
dejar `public/roles/<id>.svg|png` y poner su ruta en el mapa.

## W. Rol: respaldo
`RoleMark`: sin asset → abreviatura canónica `ROLE_ABBR` (DUE/INI/CEN/CON/FLX), la misma del renderizador de cartas; con
asset que falla → vuelve al texto. Sin emojis, sin Lucide.

## X. Composición
Reverso: `[bandera/logo]` arriba y `[rol]` abajo, sin solaparse. El rol va ANTES de la pista en el DOM: la pista sigue
siendo lo último que se pinta (contrato F72.8 C3).

## Y. Accesibilidad
`aria-label` del reverso: «Carta oculta · pista …; rol Iniciador». La carta comprometida no lleva rol.

## Z. Estado
**ROLE DATA IMPLEMENTED · ROLE ICON MAPPING READY · REAL ROLE ICON ASSETS PENDING USER ASSETS.**

## AA. Recompensas: auditoría
La concesión ya era server-side e idempotente por clave (`app_grant_reward`, `duel:<id>`, tope diario de 20 por cupos).
Lo único falso era lo que se ENSEÑABA.

## AB. Recibo del servidor
`withReceipt` (en `duels.ts`) lee el asiento real del libro mayor (`user_id` + `ref`), interpreta el motivo
`duel_(capped_)?(win|draw|loss)` y devuelve `result.rewards = { matchId, grants[], capped }`. XP y puntos salen de la misma
tabla con la que se concedieron. Si la lectura falla: `rewards: null` y `award: null` (ninguna cifra mejor que una falsa).

## AC. `award`
Conserva su significado: lo que pagó LA PARTIDA (grant `MATCH`), o `null`. La primera victoria de campaña va en
`rewards` y la enseña su propio aviso; sumarla en `award` la contaba dos veces en `ResultScreen` (corregido en la release
final, ver BA).

## AD. Tipos soportados
`RewardDisplay` (F62): créditos (DrlCoin), XP de cuenta, sobre (arte real `packArtwork` ×N), carta (`CardArt`), insignia
(cosmético en texto), puntos de rango. Una partida rápida real solo concede créditos/XP/puntos.

## AE. Cero recompensas
Sin recibo, recibo vacío o partida topada → la sección no existe (sin «Sin recompensa»).

## AF. Idempotencia
F5, URL directa y 20 lecturas simultáneas = el mismo recibo; leer no concede ni mueve el saldo (servicio + producción).

## AG. Acceso ajeno
Otra cuenta: 404 uniforme, sin recibo (servicio + producción).

## AH. Campaña
`firstClearRefForMatch` (en `campaign.ts`, solo lectura): la clave exacta de la primera victoria si el intento de ESTA
partida la consiguió y se pagó; `duels.ts` lee ese asiento. T48/T112 respetados (campaña no lee el libro; duelos no conoce
`campaign_id`).

## AI. Draft
Sin pago por partida: recibo vacío, `award: null` en las dos proyecciones (G02).

## AJ. Tope diario
Partida 21 del día: `capped: true`, sin concesiones, `award: null` (R4, partidas reales en MemSupabase).

## AK. Economía
Sin cambios: ni tablas de premio, ni tope, ni claves, ni precios. Huella real idéntica antes y después (BM).

## AL. Ficheros modificados (36)
`lib/duel/{turnClock,types,matchView,qaSimulation}.ts`, `server/services/{duels,campaign}.ts`,
`domain/cardgame/{hints,pvp/projection,opponent/controller,opponent/types}.ts`,
`components/duel/{MatchBoard,DuelMoment,DuelCard,QuickMatchResult}.tsx`, `components/duel/arena/{RivalStats,HandFan}.tsx`,
`app/duelos/jugar/page.tsx`, `app/design-system/{fase26,fase33,quick-result}/page.tsx`,
`scripts/{deck-strategy-verify,duel-gameplay-verify}.ts` y 14 tests (AN).

## AM. Ficheros nuevos (5)
`lib/duel/roleIcons.ts`, `components/duel/RoleMark.tsx`, `server/services/duelReceipt.service.test.ts`,
`components/duel/quickResultRewards.render.test.tsx`, `components/duel/roleMark.render.test.tsx`.

## AN. Tests actualizados (contrato nuevo, no relajado)
arena50, strategy.matrix, duel.test, experience 23, f71.statHints (V1/V6/V7/P1), gameplay.contract A7, pvp SECRETO,
f862 Q1, draftDuels G02, turnClock S1–S9→UX2 + S14, f73 PvE AFK, f61 MOTOR 01, campaign.service, quickMatchResult (cabecera).

## AO. Tests nuevos
Recibo R1–R6; QRR-1…5 (+4 variantes de cero); ROLE-1…4; roles alineados + sin fuga por diferencia; información PvE
(compromete → no viaja → responde → revelada con sus cifras); recibo de campaña por clave.

## AP. Huella dorada F61
`9a93fd52…` (antes `590d2997…`). Cambio deliberado y aislado: con el controlador anterior la huella vieja se reproduce
intacta (32/32). Reglas, reparto y desempates del motor no cambian.

## AQ. Suite
**6152/6152 PASS.**

## AR. Lint
**0 errores** (26 avisos previos, ninguno nuevo).

## AS. Typecheck
**PASS** (app + scripts).

## AT. Build
**PASS** (único aviso: el de `instrumentation.ts` de siempre).

## AU. QA visual A–G (`docs/product/qa/duel-ux-2/`, 216/216)
Tablero (fase50 = la arena de `/duelos/jugar`) y resultado (quick-result) en 1440/1024/390 × normal/reducido:
A PvE sin reloj · B carta comprometida boca abajo + stats `declared-hidden` · C revelación con giro (reducido sin giro) ·
D rol en texto en los reversos · E victoria con recibo FIXTURE (+ todos los tipos) · F derrota · G cero recompensas.
E2 (los seis tipos a la vez, solo sintético) se pasa 22 px del pliegue en 1024×768: informativo.

## AV. Arnés fase26
Sus mazos QA ya eran inválidos antes de esta fase («No se pudieron construir los mazos QA»): deuda previa, igual que
`scripts/duel-balance.ts`. Se le añadieron pistas y roles, pero las capturas usan fase50.

## AW. Instrumentos (fuera de CI y de la release)
`scripts/_duelux2-shots.ts`, `_duelux2-prod-qa.mts`, `_duelux2-prod-browser.mts`, `ops/_duelux2-stage.sh`.

## AX. Frontera de la release
Staging en el VPS = fuente de `510f9e22` + overlay: añadidos 5, modificados 36, borrados 0 = overlay exacto. F78 = producción.

## AY. Secretos
Escaneo del overlay: sin claves, JWT ni credenciales (solo cadenas de prueba ya existentes).

## AZ. Release
`drl-0.1.1-1-d80d9f57` activa. Rollback: `bin/deploy.sh --activate drl-0.1.1-1-510f9e22`.

## BA. Deploy intermedio y corrección
Primero se desplegó `853416e0`; durante la verificación se vio que `award` sumaba la primera victoria de campaña (doble
cifra en el resultado de campaña). Se corrigió (`award` = grant `MATCH`), con test R6, puertas completas otra vez y
release final `d80d9f57` sobre la MISMA base `510f9e22`.

## BB. Salud
`/api/health` 200 · `/api/ready` `ready`, cabeza `0073_pickems_launch_guard` · arneses `/design-system/*` 404.

## BC. production:check
**27 PASS · 1 WARN (F77) · 4 FAIL (F78 off-site)**, igual que F87.2. Sin fallos nuevos.

## BD. Smoke
**80/80** (en `853416e0` y otra vez en la final).

## BE. QA en producción (API, persona QA)
**32/32** en la final: nace sin plazo; 40 s sin tocar nada → nada se mueve; jugada manual; doble envío; versión vieja 409;
5 cartas comprometidas sin fuga (4 claves cada una); recibo = subida real del saldo (6000 → 6220); F5 y 20 lecturas iguales;
otra cuenta 404.

## BF. QA en producción (navegador real)
**22/22** en la final: login real, «Comenzar duelo», sin reloj, 40 s quieto, carta boca abajo (sin imagen ni texto), sin fuga
en DOM/a11y/almacenamiento, «Recompensas obtenidas +220 créditos +110 XP de cuenta +14 puntos de rango», F5 igual, 390
sin desbordamiento, consola limpia.

## BG. Regresiones (sobre `853416e0`, misma interfaz que la final)
F81.2 72/0 · F82 74/0 · F83 40/0 · F84 49/0 · F85 92/0 · F86 66/0 · F86.1 37/0 · F86.2 146/0. La diferencia con la final
es solo cómo se compone `award` del PvE (smoke y QA PvE repetidos en la final).

## BH. F86.2
Primera pasada 142/1: su comprobación «el resultado rápido no enseña créditos ni XP» contradecía el requisito nuevo. Se
actualizó el instrumento (fuera de la release): fuera del bloque «Recompensas obtenidas», nada; dentro, solo lo del recibo.
Segunda pasada 146/0.

## BI. Logs
App: 0 reinicios, 0 errores (solo el aviso de configuración opcional). Postgres: solo los rechazos esperados de las
pruebas negativas (REST sin permiso, `NOT_ADMIN`, `STALE_CUP`, `REASON_REQUIRED`).

## BJ. Cuentas QA
14 (primera tanda: 9 personas + las que registran F82/F86.2) + 9 (verificación final). Todas `@example.invalid`, ninguna
admin, ninguna davex/ValoRosters. Borradas con guardas: ensayo ROLLBACK → COMMIT, dos veces.

## BK. Backups (solo locales, NO off-site)
`pre-duelux2-qa-cleanup/20261006T200330Z` y `pre-duelux2-qa-cleanup/20261006T201920Z`.

## BL. Usuarios
**2 usuarios · 2 admins · 0 QA · 0 amistades.**

## BM. Economía real
davex y ValoRosters: créditos, XP y libro mayor idénticos antes del deploy y al final.

## BN. Migraciones
Ninguna. Cabeza 0073.

## BO. No tocado
Pick'ems, F87, Mercado, Pagos, Forge, precios y probabilidades de sobres, balance de cartas, rating ranked, recompensas de
temporada y social, Closed Alpha, F77, F78.

## BP. Deudas
1. Arnés fase26 y `scripts/duel-balance.ts` con fixtures caducados (previas).
2. `scripts/deck-strategy-verify.ts` cae en la línea 90 (fixture sin `combat`, previa).
3. `scripts/duel-gameplay-verify.ts` necesita BD local con JWT válido (no ejecutable aquí).
4. El abanico del rival cuenta también la carta comprometida (a propósito: ver R).

## BQ. Pendiente tuyo
Iconos reales de rol: deja los ficheros y se activan en `ROLE_ICON_SRC` sin tocar nada más.

## BR. Riesgos
NORMAL/HARD defienden peor (T). Cliente viejo en caché: no ve reloj PvE (el servidor ya no manda plazo) y sigue
funcionando.

## BS. Rollback
`ssh … 'cd /opt/nexus/projects/valorosters && bin/deploy.sh --activate drl-0.1.1-1-510f9e22'`. Sin datos que deshacer.

## BT. Siguiente
Iconos de rol; decidir si se compensa la dificultad (T).

## BU. Veredicto
DUEL GAMEPLAY UX 2.0 = GO

---

## Ajuste posterior (2026-10-06) · pista en la carta rival oculta — release `drl-0.1.1-1-10d1022c` (sobre `d80d9f57`)
- **Qué:** la carta comprometida del rival (boca abajo en la mesa) muestra, en el pie del reverso, la MISMA pista
  (bandera/región/logo) y el MISMO rol que esa carta tiene en la fila superior. Al revelar desaparece y entra la carta real.
- **Payload mínimo del defensor:** `pendingRival = { committed: true, stat, hint: { type, value } | null, role }`.
- **Una sola fuente:** `committedRivalHint` (`domain/cardgame/hints.ts`) llama a `hintForCard(match.id, carta, …)`, la
  misma función y la misma clave con que `hintRows` pinta la fila superior; PvE (`toPublicView`), PvP (`projectMatchFor`)
  y arneses (`qaView`) la usan. La UI reutiliza `DuelCardBack` (capa limpia F72.8, `RoleMark`) con `layout="committed"`.
- **Sin cambios:** commit/reveal, reloj, recompensas, IA (el bot no recibe nada nuevo), economía, fila superior.
- **Pruebas:** test crítico PvE + PvP (pista/rol centrales = los de esa carta arriba; uid, carta, jugador, nick, cifras,
  OVR y arte ausentes; revelación limpia), render de la mesa R1/R2, contratos actualizados. Suite **6156/6156**, lint 0
  errores, typecheck y build PASS, capturas 222/222.
- **Producción:** ready/0073, `production:check` 27/1/4 (igual), smoke 80/80, API 37/37 (pista central = arriba en los 5
  turnos), navegador 27/27 (primera pasada 26/27: falso positivo del instrumento — nick de 3 letras «ara» buscado como
  subcadena dentro de texto como «para»; corregido a palabra completa y repetido). Logs limpios. 9 QA borradas tras backup
  `pre-hintfix-qa-cleanup/20261006T205110Z`; 2 usuarios / 2 admins. davex +40/+25 por una partida PvE real suya (20:24 UTC).

## Ajuste visual (2026-10-06) · pista más grande en la carta oculta — release `drl-0.1.1-1-404b1945` (sobre `10d1022c`)
- Solo `DuelCard.tsx` (`layout="committed"`): bandera 46 % → **80 %** del ancho del reverso (×1,74); logo/icono 34 % →
  **64 %** (×1,88). Emblema más pequeño y arriba (`top 7 % · bottom 66 %`). Rol debajo (3 px), mismo tamaño de texto.
- Proporciones: cada forma en su caja con la proporción de su FICHERO (bandera 4:3, logo cuadrado 200×200) y
  `object-fit: contain`: logos anchos (NRG 4,2:1, MIBR 2,5:1), cuadrados (Sentinels) y altos (FUT 0,53:1) enteros, sin
  deformar ni recortar. Bandera: marco fino neutro (F72.8); logo: halo oscuro radial sin bordes en vez del cuadrado.
- Medido (arnés temporal, borrado): tarjeta 86/120/150 px → bandera 66×49 / 93×70 / 117×88, logo 52 / 74 / 93 px; todo
  dentro del reverso. Capturas fase50 222/222 (1440/1024/390 × normal/reducido).
- Producción: ready/0073, smoke 80/80, navegador 27/27 (1.ª pasada 26/27: falso positivo del instrumento — el id de catálogo
  de la carta rival estaba en la caché de inventario porque la persona QA POSEÍA esa misma carta; ahora se excluyen los ids
  de carta propios; uid, jugador y nick se siguen exigiendo). 9 QA borradas tras backup
  `pre-hintsize-qa-cleanup/20261006T211540Z`; 2 usuarios / 2 admins; economía real sin cambios.
