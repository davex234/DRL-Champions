# F87 — PICK'EMS 2.0 · cuadros interactivos, cierre por partido y recompensas

Fecha: 2026-10-06 · Release `drl-0.1.1-1-9bfb0e10` · Migración `0071_pickems_bracket` · Evidencia `docs/product/qa/pickems-2/`

> Nota: el encargo menciona dos capturas de referencia (doble eliminación y grupos GSL); **no llegaron imágenes a la
> sesión**. El diseño se hizo con la descripción textual (Upper/Lower/Gran Final; Apertura/Ganadores/Eliminación/
> Decisivo/Clasificados) y el lenguaje visual propio de Valorosters. Nada copiado.

## A. Estado inicial
- Producción `drl-0.1.1-1-7cee7857`, cabeza `0070_alpha_feedback`, 2 cuentas (ambas admin): davex #NB2Z9BM y ValoRosters #H5ND8K7.
- Árbol de trabajo sucio (1.711 entradas, casi todo sin seguimiento). Baseline medida: **6058/6058** tests, tipos OK.
- Worker esports: `/opt/nexus/projects/drlcards-sync`, release `rel-20260914T093113Z-996d06fd` (bundle sha `872f5449…`), cron `*/2`, `ESPORTS_AUTO_SYNC_ENABLED=true`, 0 errores en las últimas 500 líneas.
- Closed Alpha READY sin empezar; Closed Alpha Cup DRAFT/UNLISTED; Open #1 DRAFT; Temporada 2 DRAFT; mercado y pagos OFF.

## B. Arquitectura actual de Pick'ems (auditada)
Pick'ems v1 (fases 9–24.8): **preguntas** (`match_winner`, `match_score`, `champion`, `advance`) sobre partidos con los dos equipos conocidos. Ciclo `runPickemLifecycle` (crear Pick'em por evento → preguntas → resolver con el ganador real → corregir → **pagar escalones**), llamado por el sync (worker cada 2 min y `/api/admin/tournaments`). Guardado `POST /api/pickems` → `app_submit_pick` (cierre por `locks_at` de la pregunta con `now()` de la BD). Lecturas directas por RLS. UI `/pickems` (héroe, tablero, cuadro de solo lectura `TournamentBracket`, clasificación, recompensas) + `/pickems/historial`.

## C. Modelo de datos actual
`events`, `stages(kind group|swiss|playoff|bracket)`, `matches` (equipos por id canónico `vlr-t-*`, `winner_team_id`, `best_of`, `round`, `match_order`, y desde 0045 `winner_to/loser_to(_slot)`, `winner_qualifies`, solo `CONFIRMED`), `teams` (logo vacío en BD; los logos de la UI salen de los 25 locales de F72.3 con caída visual), `standings`. Pick'ems v1: `pickem_events/questions/submissions/answers/scores`, vista `pickem_questions_public`, `ranking_pickem_event`. Tabla `pickems` de 0002 = deprecada.

## D. UI actual
`/pickems`: selector de evento, héroe, resumen vivo, tablero de preguntas o cuadro real (solo lectura, picks solo en partidos con equipos definidos), clasificación del evento, recompensas v1. En el menú «Más» (no en la barra principal) y en el vestíbulo como acción «Haz tu predicción».

## E. Puntuación actual (v1)
Puntos por pregunta según ronda (grupo 10 … gran final 30; resultado exacto ×2; campeón 50; clasificado 10). `app_score_pickem_event` recalcula desde cero y ajusta `profiles.points` por diferencia.

## F. Cierre actual (v1)
Por pregunta: `locks_at` = inicio del partido al CREAR la pregunta; `app_submit_pick` rechaza si `now() >= locks_at` (reloj de la BD). Una reprogramación posterior refresca la pregunta solo mientras está abierta.

## G. Worker actual
Bundle esbuild autocontenido del 14-sep (`scripts/esports-autosync-worker.ts`): política de frescura, `syncTournament` (VLR por HTML), y **`runPickemLifecycle` → `scorePickemEvent` → `award()`**. Es decir: **el worker v1 PAGA recompensas automáticamente** (créditos/sobres por escalón de puntos, a mitad de torneo). Hecho medido: ValoRosters cobró 500 créditos (`pickem:8c7b9a5e…:participacion`) el 2026-10-03 por 1 acierto, antes de F87.

## H. Importador actual
`importer-vlr` (HTML de vlr.gg): partidos, fases, resultados y, desde 24.4, estructura del cuadro (`parseBracketStructure`: aristas de ganador y plazas; nunca perdedores). Correcciones de la fuente detectadas por el sync (`reconcileMatchIds`).

## I. Datos reales disponibles (medidos en producción)
| Evento | Partidos | Terminados | Aristas ganador | Aristas perdedor | Plazas | Fases |
|---|---|---|---|---|---|---|
| `vlr-2766` Champions 2026 | 34 | 20 | 23 | **0** | 8 | Grupos (GSL ×4) + Playoffs (doble a 8) |
| `vlr-2976-emea-stage-2` | 60 | 60 | 0 | 0 | 0 | 3 fases (sin `vlr_url`) |
| `demo-masters-madrid-2026` | 7 | 2 | 0 | 0 | 0 | demo |

Champions 2026: fase de grupos COMPLETA (16 equipos reales con id canónico, marcadores, ganadores); playoffs con los 8 equipos de cuartos ya colocados (NRG–T1, PRX–LOUD, 100T–G2, VIT–NS), cuartos el **7 y 8 oct** (primer cierre **2026-10-07 05:00 UTC**).

## J. Datos reales que faltan
- **Perdedores del cuadro alto** (cuartos → Ronda 1 baja; semis → Ronda 2 baja): VLR no los publica.
- Final alta → Gran Final, Final baja → Gran Final, perdedor de la Final alta → Final baja: no publicados (el formato los determina; se derivan).
- Qué clasificado de grupos ocupa qué hueco del playoff (no hay propagación entre fases).
- Estados `cancelled/void` de la fuente: el normalizador nunca los emite (VOID = acción de admin auditada).
- Logos en BD (`teams.logo` vacío): la UI usa los 25 locales con caída visual (nunca inventa un logo).

## K. Formatos soportados (de verdad, con fixtures y propiedades)
Eliminación simple · Doble eliminación · Grupos GSL · Todos contra todos (partidos independientes). Grupos → playoffs y todos contra todos → playoffs como **ámbitos separados**.

## L. Formatos NO soportados
**Suizo** (los cruces no existen hasta que se publican: no hay grafo; el validador lo rechaza con `FORMAT_UNSUPPORTED`). **Propagación entre fases** (la fuente no publica el sembrado del playoff).

## M. Arquitectura F87
No es un segundo Pick'em: mismos datos reales (`events/stages/matches/teams` + aristas 0045), mismo hub `/pickems`, mismo libro de recompensas (`app_grant_reward`) y mismas insignias (F82). Lo nuevo:
- Dominio puro: `src/domain/pickems/{format,prediction,locks,bracketRewards,economy}.ts`.
- BD 0071: `pickem_brackets` (ámbito + descriptor congelado + recompensas versionadas), `pickem_bracket_matches` (nodo = partido real con cierre congelado / reprogramación / VOID), `pickem_bracket_entries` (revisión + foto de liquidación), `pickem_bracket_picks`, `pickem_bracket_claims`. RPC solo `service_role`.
- **Tablas propias y no `pickem_answers`**: el worker v1 puntuaría y PAGARÍA cualquier respuesta guardada allí, sin liquidación ni aprobación económica. Con tablas propias, nada se paga solo.
- Servidor: `server/services/pickemBrackets.ts`, `server/admin/pickems.ts`; API `/api/game/pickem-brackets`, `/api/admin/pickems`.
- UI: `/pickems/cuadro/[slug]`, «Pick'ems de cuadro» en el hub, `/admin/pickems`, arnés `/design-system/f87` (404 en producción).

## N. Descriptor de formato
`FormatDescriptor` = secciones (cuadro alto/bajo/gran final o Grupo X), nodos (partido real, sección, papel GSL, columna, fila, Bo, **puntos**, semillas de entrada), aristas (`from`, `to`, `WINNER|LOSER`, hueco, **origen** `SOURCE|FORMAT_DERIVED|ADMIN`) y plazas. Determinista (misma entrada = misma huella sha256) y congelado al publicar.

## O. Grafo del cuadro
Orden topológico, descendientes, huecos (`slotSources`: hueco fijado o, si no, en orden de alimentador; sin alimentador = semilla real). Derivación solo con candidato y hueco **únicos**; el admin solo puede añadir donde la fuente calla (contradecirla = `ADMIN_CONTRADICTS_SOURCE`). Validador (puerta de publicación): partido inexistente/de otro evento, duplicado, autoarista, doble destino, hueco doble/desbordado, ciclo, huecos sin origen, caminos de perdedor por formato, una única final/Gran Final, fechas (sin hora / destino antes que alimentador), coherencia con resultados ya jugados, alcanzabilidad, semillas cambiadas.

## P. Eliminación simple
Fixtures 4 y 8: final derivada si es única; puntos 1/2/…+1 en la final; perdedores fuera (`LOSER_PATH` si alguien añade uno).

## Q. Doble eliminación
Fixture a 8 (forma Champions): sin aristas de perdedor → **no publicable** (`LOSER_MISSING`, `SLOT_UNKNOWN`); con las 6 de admin → publicable, 14 partidos, **27 puntos** (alto 1/2/3, bajo 1/2/2/3, Gran Final 5). Derivadas: UF→GF, LF→GF, perdedor UF→LF.

## R. Grupos
Secciones por grupo; ningún grupo alimenta a otro (comprobado).

## S. GSL
Apertura ×2 → Ganadores (fuente) y perdedores → Eliminación (derivado); Eliminación → Decisivo (fuente) y perdedor de Ganadores → Decisivo (derivado); 2 plazas. **Validación REAL**: en los 4 grupos de Champions 2026, cada arista (de la fuente o derivada) lleva al equipo REAL al partido REAL y el cuadro «curado» reproduce exactamente los 20 cruces reales.

## T. Todos contra todos
Partidos independientes, 1 punto, sin aristas, sin camino de perdedor.

## U. Suizo
No soportado (ver L). No se finge.

## V. Cuadro real
Lo trae el worker; la vista lo manda tal cual (`matches`), con marcador y ganador solo junto al equipo real que los consiguió.

## W. Cuadro de predicción del jugador
Picks `matchId → teamId` en su tabla; jamás se escriben sobre `matches`. Participantes predichos = semilla real, o ganador/perdedor REAL del alimentador si ya se jugó, o lo que el jugador predijo; si el partido real ya tiene sus dos equipos, esos.

## X. Propagación del ganador
Elegir en cuartos coloca al equipo en SU semifinal (probado en dominio, servicio y navegador: «T1 aparece en la semi»).

## Y. Propagación del perdedor
En doble/GSL el perdedor predicho cae a su partido del cuadro bajo / Eliminación / Decisivo.

## Z. Invalidación de descendientes
Solo descendientes, solo los que eran válidos antes y dejan de serlo, solo si siguen abiertos, hasta punto fijo. **Propiedad**: 3.000 cambios aleatorios sobre doble, GSL y simple: nunca cambia un independiente ni queda un pick incoherente. Un descendiente ya cerrado se conserva (se puntuará como fallo).

## AA. Modelo de guardado
Auto-guardado por pick en el servidor, con la revisión que tenía el cliente; vista optimista con la MISMA invalidación y vuelta exacta a lo confirmado al vaciarse la cola; nunca «Guardado» sin respuesta; sin conexión no se envía.

## AB. Autoridad del servidor
El cliente envía SOLO `{slug, matchId, teamId|null, revision}` (lista blanca; un `userId`, puntos o escalón = 400). El servidor deriva los participantes válidos del cuadro DEL JUGADOR y la lista de descendientes; la RPC decide cierre (reloj de la BD), revisión, equipo real y escribe en una transacción; guardia de tabla impide crear/cambiar un pick cerrado por cualquier camino.

## AC. Modelo de cierre
Por partido (por defecto) o por fase (opcional, no universal). Cerrado ⇔ ámbito no publicado · anulado · sin fila real · estado real ≠ upcoming · `now() ≥ min(cierre congelado al publicar, inicio real)` (o `min(reprogramación de admin, inicio real)`).

## AD. Carrera en el cierre
Ensayo en BD con `now()` fijo de la transacción: −1 ms abierto, 0 cerrado, +1 ms cerrado; partido real en directo → cerrado. Un pick que llega mientras el worker cierra el partido: lo decide la BD (cerrado → 409); si llega antes, queda y se puntúa contra el resultado real (determinista).

## AE. Reprogramación
Cerrado una vez, cerrado: la fuente lo mueve a más tarde y sigue cerrado (probado). Reabrir = `reschedule` de admin con motivo, solo si el partido real no ha empezado, nunca más tarde que su inicio real; auditado.

## AF. VOID / cancelado
Anulación de admin con motivo (auditada) — o estado `cancelled/void` de la fuente si algún día llega: no suma, sale del máximo, no rompe el perfecto, se cierra.

## AG. Ingesta de resultados
El worker existente sigue siendo la única autoridad (no se creó otro sync ni se tocó el worker). F87 solo lee `matches`.

## AH. Idempotencia
La puntuación se recalcula desde los datos (sin acumulados). Reclamo: PK `(ámbito, jugador)` + `credit_tx_ref_uniq` + puerta de `app_grant_reward`. 20 reclamos simultáneos → 1; 20 picks idénticos → 1 fila.

## AI. Corrección de resultados
Liquidación solo con todo decidido y **12 h** tras el último partido (margen para correcciones de la fuente). Reliquidar exige motivo, sube `settlement_version`, NO toca reclamos (sin top-up ni clawback) y no genera asientos (ensayo: corrección tras reclamar → QA1 pasa de PERFECT a ELITE, 0 asientos nuevos, reclamos intactos).

## AJ. Puntuación
Acierto = el equipo elegido gana ese partido real. Puntos por partido crecientes con la ronda (ver N/Q). Sin pick y cerrado = fallo. VOID fuera. Proporción = puntos / máximo sin anulados.

## AK. Versión de puntuación
`pickem-scoring-v1`; puntos por nodo congelados en el descriptor al publicar (guardia `PICKEM_FROZEN`). El v1 conserva su semántica (nada recalculado).

## AL. Pick'em perfecto
Todos los partidos puntuables con pick y acertados; un VOID no lo rompe; un hueco sin pick sí; un fallo sí (probado en simple, doble y GSL).

## AM. Liquidación
Persistidos: `DRAFT → PUBLISHED → SETTLED` (y `CANCELLED`). Derivados: Próximamente / Predicciones abiertas / En juego / Liquidándose. La puntuación final la calcula la BD (paridad SQL⇄TS exacta en el ensayo).

## AN. Recompensas — arquitectura
Configuración por ámbito (`pickem_brackets.rewards`, versionada, OFF/BORRADOR/ACTIVAS), validada contra el catálogo real; reclamo manual cuando el ámbito está LIQUIDADO; entrega por la ruta única `app_grant_reward`.

## AO. Propuesta de escalones (NO activada)
Por **proporción de puntos** (no percentil: con 2–3 participantes un percentil es absurdo) y con participación mínima **80 %** de los partidos predichos a tiempo. Se cobra el más alto, una vez:

| Escalón | Condición | Recompensa | Valor interno |
|---|---|---|---|
| Participación | ≥ 80 % de partidos con pick antes de su cierre | 1 Sobre Bronce | 2.500 |
| Buen resultado | ≥ 50 % de los puntos | 1 Sobre Plata | 6.000 |
| Gran resultado | ≥ 70 % | 1 Sobre Oro | 12.000 |
| Élite | ≥ 85 % | 1 Sobre Masters | 20.000 |
| Perfecto | todo acertado | 1 Sobre Masters + insignia «Pick'em perfecto · <ámbito>» | 20.000 + coleccionable |

## AP. Análisis económico (precios F80; `economy.json`)
Simulación (4.000 torneos por precisión) sobre los grafos REALES:

| Ámbito | p=0,50 (a ciegas) | p=0,65 (aficionado) | p=0,70 | p=0,80 (experto) | Perfecto a 0,70 |
|---|---|---|---|---|---|
| Champions 2026 Playoffs (doble a 8, 27 pts) | VE 2.793 | VE 3.948 | VE 4.769 | VE 7.824 | 0,67 % |
| Champions 2026 Grupos (4×GSL, 28 pts) | VE 2.929 | VE 4.597 | VE 5.670 | VE 9.202 | 0,13 % |
| Referencia simple a 8 (12 pts) | VE 3.683 | VE 5.904 | VE 6.903 | VE 10.074 | 7,2 % |

Comparación: alta 6.000 cr + 3 Iniciales + 1 Bronce (una vez); techo diario recurrente 11.150 cr (PvE 7.000 + diarias 850 + semanales 3.300); pase libre 15.900 cr + 6 sobres; pase competitivo 26.000 + 6; logros 67.500 total; ruta de Temporada 2 (F83) 23.400 de valor total (un jugador regular ≈ 13.000 en 56 días). Pick'em v1 VIVO: 500 cr por 1 acierto … 41.000 (6.000 cr + Champions).

## AQ. Valor esperado
≈ **2.800–4.800 por participante y ámbito** para jugadores reales (p 0,5–0,7): menos que medio día de techo de PvE y una fracción de la ruta de temporada. Pick'ems complementa, no sustituye.

## AR. Pasivo máximo
Peor caso = participantes × escalón más caro (20.000): 2 → 40.000; 100 → 2.000.000; 1.000 → **20.000.000**. Estadísticamente inalcanzable (a p 0,8 solo el 15 % llega a Élite/Perfecto); el pasivo REALISTA a 1.000 jugadores ≈ 4–5 M. El panel lo muestra y activar exige aceptarlo.

## AS. Recompensa de participación
Exige predicción completa (≥ 80 %) antes de cada cierre: abrir la página o hacer un pick no da nada.

## AT. Recompensa perfecta
Masters + insignia `insignia:pickem:<ámbito>-perfecto` (reutiliza `user_cosmetics` / Sala de Trofeos de F82; nueva familia `PICKEM` en `badges.ts`, sin tocar `ProfileIdentityCard`). **No se inventa carta**: no existe en el catálogo una carta conmemorativa de evento; la opción de carta queda soportada (validada contra el catálogo) pero sin usar.

## AU. Recompensas de sobre
Solo sobres que existen (`getPack`), 1–3 por escalón.

## AV. Cartas / cosméticos
Cartas: solo del catálogo (`getCard`), máx. 1 por escalón (sin carta concreta propuesta). Cosméticos: solo `insignia:pickem:*`. Créditos: permitidos con tope 5.000 y aviso (la propuesta no usa créditos).

## AW. Configuración
`/admin/pickems` → «Recompensas»: tabla por escalón, participación mínima, estado; «Cargar propuesta F87» la pone en BORRADOR. Validación de catálogo en servidor; nunca `if (evento === …)` en React.

## AX. Congelación de recompensas
Editables en borrador; tras publicar, solo hasta el PRIMER cierre (versión +1, auditada con antes/después); después, congeladas (guardia `PICKEM_REWARDS_FROZEN`). Liquidado/cancelado: congeladas.

## AY. Reclamo vs. entrega automática
**Reclamo** visible al liquidar (botón en el cuadro y en «Mis Pick'ems»): encaja con el libro (una clave por reclamo) y evita pagar antes de que los resultados sean estables.

## AZ. Exactamente una vez
PK del reclamo + bloqueo de la entrada + `credit_tx_ref_uniq` + inserción del reclamo y la entrega en la MISMA transacción (si el libro ya tuviera la clave, se aborta todo: `PICKEM_LEDGER_CONFLICT`).

## BA. Carreras de recompensa
Ensayo real con psql en paralelo: 20 reclamos → 1 aplicado + 19 idempotentes, 1 reclamo, 1 asiento, +1 sobre, 1 insignia; 20 reliquidaciones → 1 + 19 `PICKEM_STALE`; dos pestañas/dispositivos = mismo camino. El worker no reclama ni liquida (no hay carrera worker+reclamo).

## BB. Eventos históricos
Intactos: el v1 sigue igual (3/63/1 antes y después). Cero recompensas F87 por eventos terminados (no hay ámbitos publicados).

## BC. Clasificación
Por ámbito: provisional (calculada desde picks + resultados) o la foto de liquidación. Posición con empates (1, 1, 3). Nombre + #TAG; sin correo, UUID ni ip (comprobado en servicio y en producción).

## BD. Mis Pick'ems
Sección en el hub: ACTIVOS / PRÓXIMOS / COMPLETADOS con mi progreso, pendientes, cierre y «Reclamar». Sin ámbitos publicados no pinta nada (hoy: nada).

## BE. Página del evento
`/pickems/cuadro/[slug]`: evento · formato · estado · **próximo cierre (cuenta atrás + hora exacta en la zona del usuario)** · mis predicciones X/Y · puntos · posición · aviso «Pick'em incompleto» · recompensas (exactamente lo que se entrega, o «no tiene recompensas activas») · cuadro · clasificación · reglas.

## BF. Cuadro (UI)
Escritorio: columnas por ronda, alto arriba, bajo debajo, Gran Final centrada; columnas ordenadas por la posición media de sus alimentadores (líneas sin cruces). Tableta: el mismo cuadro con desplazamiento horizontal propio. Móvil: pestañas de sección + rondas + tarjetas a todo el ancho.

## BG. Grupos (UI)
Por grupo: Apertura → Ganadores / Eliminación → Decisivo → Clasificados (1.º / 2.º con «tu pick» y el real ✓/✕).

## BH. Tarjeta de equipo
Logo (o caída visual «?»), nombre, marcador real, punto de selección, ✓/✕ dibujado + texto, ganador real con barra y texto para lector de pantalla, «Por definir» nunca es botón.

## BI. Conectores
`BracketConnectors` reutilizado (el mismo del cuadro real): ganador continuo, perdedor discontinuo; re-medición tras montar (el ref del contenedor llega después del primer efecto del hijo: medido, 0 líneas → corregido).

## BJ. Progreso
«N / M» + barra + «K por hacer ahora».

## BK. Cierre en la UI
Cuenta atrás visual; al llegar a cero se relee del servidor (autoridad suya); también al volver a la pestaña.

## BL. Resultado
Acertado ✓ +N · Fallado ✕ con tu pick · Sin pick · Cerrado · Anulado · «Tu pick ya no juega este cruce».

## BM. Recompensas en la UI
Tarjetas por escalón con condición y contenido exacto; el escalón alcanzado resaltado; reclamado con lo entregado.

## BN. Móvil 390
Usable para completar todo (pestañas y rondas ≥ 44 px, sin desbordamiento): QA de navegador PASS.

## BO. Tableta 1024
Cuadro completo con desplazamiento interno: PASS.

## BP. Escritorio 1440
Cuadro completo con conectores: PASS. **QA de navegador 286/286** (8 escenas × 1440/1024/390 × normal/reducido).

## BQ. Accesibilidad
Botones con `aria-label` («Elegir G2 como ganador de Cuartos · alta frente a 100 Thieves») y `aria-pressed`; foco visible (`nx-focus`); pestañas con `role="tab"`; ✓/✕ con texto; un solo h1; imágenes con alt.

## BR. Movimiento reducido
Animación del pick ≈ 0 (regla global + `motion-reduce`): PASS.

## BS. Rendimiento
Una lectura por ámbito (ámbito + nodos + partidos + equipos + mis picks: lotes, sin N+1); el cuadro se deriva en el cliente con funciones puras memoizadas; sin sondeo continuo (relectura al cierre y al volver). Vestíbulo: +1 lectura constante (46 → 47, sin crecer con los datos).

## BT. Caché
Sin sesión: `public, s-maxage=15` (mismos datos para todos). Con sesión: `private, no-store`. El cliente no usa almacenamiento del navegador para picks.

## BU. Cambio de cuenta
El hook vacía TODO el estado al cambiar el usuario y descarta respuestas en vuelo de la cuenta anterior (`owner` ref). El servidor solo devuelve los picks del token (probado: la vista de un jugador no contiene ni el UUID del otro).

## BV. Cierre de sesión
Igual: estado vacío; sin token la API devuelve la vista pública sin `me`.

## BW. Seguridad (atacado en BD, servidor y producción)
Predecir por otro (cuerpo con `userId` → 400; insert REST → 403) · pick cerrado (409; guardia de tabla) · partido falso/otro ámbito (400/BAD_MATCH) · ámbito falso (404/NOT_FOUND) · equipo imposible/no del cruce/TBD (400) · descendiente incompatible (la lista la calcula el servidor) · reclamar de otro (imposible: el usuario sale del token) · reclamar antes de liquidar (409) · escalón incorrecto (lo calcula la BD) · doble reclamo (1) · admin con cuenta normal (401) · cambiar puntuación/recompensas sin admin (401; RPC `NOT_ADMIN`) · REST/RPC directos (403/404).

## BX. Admin
`/admin/pickems` (grupo Juego): crear borrador desde evento + fases (formato detectado), vista previa con validador, aristas de admin sugeridas (una fila por perdedor sin destino), refrescar con la fuente, publicar, despublicar (sin jugadores), cancelar/borrar con motivo, partidos (cerrar, reprogramar, VOID), recompensas con economía y pasivo, liquidar/reliquidar, auditoría, salud del worker.

## BY. Validador de datos
Ver O. Equipos conocidos o «semilla pendiente» (aviso), caída de logo segura, relaciones válidas, fechas, formato.

## BZ. Puerta de publicación
Con un ERROR no se publica; además lo guardado debe coincidir con lo que hoy deriva la fuente (si no: «Refrescar»). En la BD: checksum y todos los partidos existentes con hora.

## CA. Versionado del evento
Descriptor/puntos/formato/política congelados al publicar; deriva de la fuente DETECTADA y mostrada (partidos nuevos/ausentes, aristas cambiadas, semillas, picks afectados) sin remapear nada; un publicado con jugadores no se despublica (se cancela con motivo).

## CB. Auditoría
`content_audit_log` (entity_type `pickem_bracket`) en la MISMA transacción: crear/editar borrador, publicar, despublicar, cancelar, borrar, recompensas (antes/después), activar, cerrar/reprogramar/VOID/desVOID, liquidar/reliquidar.

## CC. Validación con evento real
Champions 2026 (snapshot real fechado `fixtures/vlr-2766-champions-2026.snapshot.json`, leído de producción en solo lectura): grupos = GSL publicable, 24 aristas coherentes con los 20 resultados reales; playoffs = doble a 8 con 11 aristas de la fuente + 3 derivadas y 6 perdedores sin publicar.

## CD. Borrador real preparado
**`champions-2026-playoffs` — «Champions 2026 · Playoffs» — DRAFT**, derivado de los datos VIVOS (14 partidos, 27 puntos), recompensas = propuesta en BORRADOR (inactivas). El validador lo **bloquea** (10 errores: 6 `LOSER_MISSING` + 4 `SLOT_UNKNOWN`). Probado en producción: publicar → 409; vista previa con 6 aristas (de prueba, NO guardadas) → publicable.

## CE. Worker ANTES
Ver A (`worker/before.txt`).

## CF. Worker DESPUÉS
Tras aplicar 0071 y desplegar (`worker/after.txt`, 09:51Z): mismo cron, misma release `rel-20260914T093113Z-996d06fd`, mismo bundle `872f5449…`, auto-sync `true`, 6 últimas pasadas `status=success` (una con `events_synced=1`), **0 errores**, `sync_state ok` (último éxito 09:50:18Z), recuentos idénticos a ANTES (`events 3 · stages 6 · matches 101 · teams 37 · pickem_events 3 · questions 63 · answers 1`).

## CG. Cron
`*/2 * * * * …/run-sync.sh` sin cambios; mismo bundle y misma release.

## CH. Ingesta duplicada
Índices únicos intactos; 0 claves de pregunta duplicadas, 0 slugs de fase duplicados, `matches` por PK; recuentos estables (ver CF).

## CI. Cuentas QA
Creadas para la regresión (registro real, `@example.invalid`, nombre `qa…`, excluidas del embudo alpha): **19** (2 de la QA de F87, 14 de la regresión —incluido un segundo juego limpio para F85— y 3 registradas por los propios instrumentos F82/F86.2). Preparadas como un jugador nuevo (abrir sobres de alta + `first-team`), sin concesiones de operador salvo las de los instrumentos F82 (cartas por `/api/admin/users`, auditado). Admin temporal por operador (0067, auditado GRANT/REVOKE_ADMIN) para F82, F86, F86.1, F86.2 y el panel, siempre revocado. **Limpieza**: backup local `pre-f87-qa-cleanup/20261006T095150Z`, ensayo con ROLLBACK y borrado canónico de `auth.users` en una transacción con guardas (`scripts/ops/_f87-qa-cleanup.sql`): 19 borradas, quedan **2** cuentas (`qa-cleanup.txt`). Quedan como histórico sin FK, igual que en F86/F86.1/F86.2: **8 copas QA no listadas** (COMPLETED/CANCELLED) con instantánea de nombre/#TAG, filas de auditoría y tags del registro (nunca reutilizables).

## CJ. Admins reales
Antes y después: **davex #NB2Z9BM y ValoRosters #H5ND8K7**, sin cambios (comprobado en la aplicación de 0071, tras F82/F86/F86.1 y tras la QA del panel).

## CK. Embudo alpha
Las QA de F87 cumplen la exclusión (`@example.invalid` y nombre `qa…`): `app_alpha_funnel(hoy, include_test=false)` = **0 cuentas**; con `include_test=true` = 19 (todas QA). Tras la limpieza, `alpha_feedback` = 0.

## CL–CR. Regresión en producción (cuentas QA nuevas)
| Fase | Resultado | Fallos (análisis) |
|---|---|---|
| Smoke (`_f75-smoke-public`) | **74/74** | — |
| F81.2 | 71/72 | Muestreo del HUD dentro de `/cuenta` con cuenta NUEVA; sonda directa: tras el login la cuenta ve su saldo real (3.500) en portada y tienda, nunca la demo. F87 no toca HUD, auth ni `/cuenta`. |
| F82 | 72/74 | Instrumento: exige cartas de G2 que tenía la QA antigua; compara admins con la cuenta borrada `2f86cbe8` (los admins reales son correctos). |
| F83 | **40/40** | — |
| F84 | 46/49 | Instrumento: bloque ranked del perfil propio solo existe con historial ranked (contrato `EMPTY_OWN`), y la QA nueva no lo tiene. |
| F85 | 91/92 | Instrumento: la fila de rating se crea al primer acceso PvP con su valor por defecto (1000, 0 partidas); 0 asientos de rating (aislamiento OK). |
| F86 | 63/66 | Instrumento: cabeza fijada en 0069 (ahora 0071) y 2 comprobaciones sobre la cuenta personal borrada. |
| F86.1 | 35/37 | Instrumento: 2 comprobaciones sobre la cuenta personal borrada `#9KZAWPC`. Detección de la partida 2,5 s (igual que F86.1). |
| F86.2 (E2E alpha) | 143/145 | Instrumento: 2 comprobaciones sobre la cuenta personal borrada `#9KZAWPC`. |

## CS. Closed Alpha
NO iniciada (nada publicado, nadie contactado/registrado).

## CT. Open #1
DRAFT, sin tocar.

## CU. Temporada 2
DRAFT, sin tocar.

## CV. Mercado
OFF (`GLOBAL_MARKET_ENABLED=false`).

## CW. Pagos
OFF.

## CX. F77
Sin tocar (deuda conocida: autoconfirmación ON). Observación: la clave anon de `.env.local` del PC es anterior a la rotación F77-S1 (los instrumentos usan la pública del bundle).

## CY. F78
Excluido: sin Backblaze, sin programación, sin afirmaciones off-site.

## CZ. Backup
Local, **NO OFF-SITE**: `pre-0071/20261006T075555Z` y `pre-0071/20261006T084531Z` (SHA256SUMS ok; el de las 08:45 es el previo inmediato a 0071).

## DA. Migración
`0071_pickems_bracket` aplicada **2026-10-06T08:47:07Z** (241 ms, una transacción): datos existentes intactos (huellas de 24 tablas), admins y perfiles intactos, privilegios de cliente `false` en todo, 4 guardias. Ensayo aislado previo **DRYRUN_OK 91/91** sobre el backup de las 08:45 (`dryrun.txt`).

## DB. Límite de la release
Base = fuente de producción `drl-0.1.1-1-7cee7857` + overlay F87: **28 añadidos + 22 modificados + 0 borrados** = overlay exacto (`BOUNDARY_OK`); los 22 modificados eran byte a byte iguales a producción antes de F87; ficheros F78 = producción; sin instrumentos `_` ni evidencias (`stage.txt`).

## DC. Tests
**6112/6112** (6058 de base + 54 nuevos).

## DD. Tipos
PASS (app + scripts).

## DE. Lint
0 errores nuevos en todo lo de F87 (`npm run lint` sigue roto con Next 16; se usa `ESLINT_USE_FLAT_CONFIG=false npx eslint <rutas>`).

## DF. Build
PASS (local ×3 y en el VPS dentro de `deploy.sh`). Aviso preexistente de `instrumentation.ts` (F67).

## DG. Pruebas de seguridad
Ensayo de BD 91/91, servicio 10/10, render/contratos 7/7, producción **36/36** (`prod-qa.json`) y panel admin **21/21** sobre el borrador real (`admin/admin-prod.json`; publicar → 409, vista previa sin guardar, admin no puede contradecir a la fuente).

## DH. Salud
`/api/health` 200.

## DI. Ready
`ready`, cabeza `0071_pickems_bracket`, todas las comprobaciones en verde (incluida la nueva `pickems`).

## DJ. Smoke
74/74.

## DK. production:check
26 PASS · 2 WARN · 4 FAIL — los 4 FAIL son F78 off-site (excluido), WARN auth-email = F77, WARN build = huella de la build LOCAL frente al árbol local (no aplica a la release desplegada). Ningún fallo nuevo.

## DL. Logs
`valorosters-app` desde el despliegue final: **0** líneas de error. Postgres: los únicos `permission denied for table pickem_bracket_*` son los ataques REST intencionados de la QA de producción. Worker: 0 errores.

## DM. Escaneo de secretos
Overlay y evidencias: sin JWT, claves, contraseñas, correos reales ni UUID de las cuentas reales (la única coincidencia es una prueba preexistente de redacción). `client-secrets` de production:check PASS.

## DN. Release
`drl-0.1.1-1-9bfb0e10` activa (tar sha256 `69df3b62…`; lo desplegado = lo local, 50/50 ficheros). Hubo una release intermedia `f8a165c9` (activa de 08:51Z a 09:49Z): la QA del panel mostró que la simulación económica de un borrador INCOMPLETO salía con «valor esperado 0» (engañoso); se corrigió (sin simulación y con aviso hasta que el validador esté limpio) con prueba nueva, y se redesplegó con el mismo límite de overlay.

## DO. Rollback
Código: `bin/deploy.sh --activate drl-0.1.1-1-7cee7857`. BD: `docs/operations/rollback/0071_pickems_bracket.ROLLBACK.sql` (quita tablas y RPC de F87; lo ya concedido por reclamos se queda; ensayado).

## DP. Commit / push
Ninguno.

## DQ. Riesgos pendientes
1. **El worker v1 sigue pagando** escalones v1 automáticamente (500 créditos por UN acierto; hasta 6.000 + sobre Champions) en cada Pick'em v1 que cree el sync (Champions 2026 tiene el suyo abierto). Cambiarlo exige reconstruir el worker → decisión aparte.
2. Champions 2026 Playoffs: sin las 6 aristas de perdedor no se puede publicar; los cuartos cierran el **7-oct 05:00 UTC**. Además, las recompensas se congelan en el primer cierre: si se quieren recompensas en este ámbito, hay que activarlas antes de esa hora.
3. Dos Pick'ems para el mismo evento (v1 de preguntas y 2.0 de cuadro) pueden confundir si se publica el 2.0 mientras el v1 sigue abierto.
4. Liquidación manual (admin): no hay liquidación automática (no se tocó el worker).
5. Instrumentos de regresión F82/F84/F85/F86/F86.1 desfasados respecto a la limpieza de cuentas del 2026-10-05 (ver CL–CR).
6. Logos: `teams.logo` vacío; marcas sin resolver para release pública (F72.3).

## DR. Lo que requiere tu aprobación
1. **Escalones** (AO): Participación Bronce · ≥ 50 % Plata · ≥ 70 % Oro · ≥ 85 % Masters · Perfecto Masters + insignia; participación mínima 80 %.
2. **Valor interno por escalón**: 2.500 / 6.000 / 12.000 / 20.000 / 20.000 + insignia.
3. **Pasivo máximo**: 20.000 × participantes (1.000 → 20 M); realista ≈ 2,8–4,8 k por participante y ámbito.
4. **Perfecto**: Masters + insignia «Pick'em perfecto · <ámbito>» (sin carta: no hay carta conmemorativa real en el catálogo).
5. **Evento real en BORRADOR**: `champions-2026-playoffs` (Champions 2026 · Playoffs).
6. **Formatos soportados**: eliminación simple, doble, GSL y todos contra todos; suizo no; sin propagación entre fases.
7. **Lo que la fuente no representa**: perdedores del doble, UF/LF→Gran Final (derivados), sembrado del playoff desde grupos, estados VOID.
8. **Configuración manual necesaria**: sí, **6 aristas de perdedor** del doble (cuartos → Ronda 1 baja; semis → Ronda 2 baja) desde el cuadro oficial, en `/admin/pickems`. Lo demás se deriva.
9. (Recomendado, aparte) retirar las recompensas automáticas del Pick'em v1 en el worker.

Nada de lo anterior está activado ni publicado.

## DS. Veredicto
Cumple la definición de terminado: Pick'ems existente auditado y preservado (v1 y worker intactos), modelo real documentado, formatos honestos (suizo y propagación entre fases NO afirmados), grafo determinista con propiedades, pick directo con propagación de ganador y perdedor, invalidación solo de descendientes, autoridad y cierre en la BD (carreras y frontera probadas), reprogramación/VOID/correcciones seguros, puntuación y recompensas versionadas y congeladas, liquidación previa obligatoria al reclamo, exactamente una vez probado con concurrencia real, sin cartas/sobres fantasma, sin recompensas retroactivas, clasificación con nombre + #TAG, panel y validador funcionando en producción sobre el borrador real, responsive/a11y/reducido 286/286, regresión sin fallos atribuibles a F87, límite de release probado, secretos limpios, recompensas reales OFF/BORRADOR y el Pick'em real en BORRADOR.

Límites dichos, no disimulados: el aislamiento al cambiar de cuenta/cerrar sesión con picks reales no se probó de punta a punta en navegador (no hay ningún ámbito publicado y publicar es decisión tuya): lo garantizan el servidor (picks solo del token, `private, no-store`, probado) y el hook (vacía el estado y descarta respuestas de la cuenta anterior); los fallos de la regresión son de instrumentos desfasados tras la limpieza de cuentas del 2026-10-05 o de estado de cuentas nuevas, con evidencia directa.

**F87 PICKEMS 2.0 = GO**
