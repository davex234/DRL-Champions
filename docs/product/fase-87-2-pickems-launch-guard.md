# F87.2 · Pick'ems Launch Guard — retirada de la creación legacy, anti-farmeo y preparación de lanzamiento

Fecha: 2026-10-06. Producción: https://valorosters.com · release final **`drl-0.1.1-1-510f9e22`** · cabeza **`0073_pickems_launch_guard`**.
Evidencias: `docs/product/qa/pickems-2/f872/` (ensayo, aplicación, staging, despliegues, worker, regresión, QA de jugador, panel admin, cambio de cuenta, limpieza, estado final) y `docs/product/qa/prematch-rules/`.
Sin commit. Sin push. Nada publicado. Ninguna recompensa real activada.

## A. Estado inicial
- Release `drl-0.1.1-1-e919d780` (F87.1) y cabeza 0072.
- 2 cuentas, ambas admin (davex `#NB2Z9BM` y ValoRosters `#H5ND8K7`).
- Reglas v1 aprobadas, recompensas OFF, 0 Pick'ems 2.0 publicados y Champions 2026 Playoffs en DRAFT.
- La corrección de lint de F87.1 (3 apóstrofos en `admin/pickems/page.tsx`) solo estaba en local.

## B. vlr-2976 (estado real)
Leído antes de cambiar nada:
- Evento `finished` (julio–agosto de 2026).
- Pick'em legacy `open`, `LEGACY_V1`, con 0 preguntas, 0 participaciones, 0 puntuaciones y 0 pagos.
- Sin participantes: no hay derechos que preservar.

Decisión aplicada: puede terminar con sus reglas legacy, sin migrarse a F87 ni cancelarse. El ensayo lo demuestra: pregunta → pick → puntuar → pagar su escalón legacy una sola vez.

## C. Eventos legacy
3, todos `LEGACY_V1`: `demo-masters-madrid-2026` (scored), `vlr-2766` Champions 2026 (scored) y `vlr-2976-emea-stage-2` (open).

## D. Participantes legacy
1 en total: ValoRosters, en `vlr-2766`.

## E. Derechos legacy
Intactos. El libro sigue aceptando pagos `pickem_reward:*` de Pick'ems `LEGACY_V1` (0072); F87.2 no cambia esa regla.

## F. Creación legacy antes
- La BD ya rechazaba cualquier INSERT en `pickem_events` sin bandera de operador (0072, `PICKEM_LEGACY_RETIRED`).
- Pero el ciclo `pickemLifecycle` de la app seguía INTENTANDO crearlo, tanto desde la acción «sincronizar» del admin de torneos como desde el orquestador. El worker desplegado también lo intenta.

## G. Creación legacy después
- **Código:** `ensurePickemEvent` ya no crea nada; solo devuelve el Pick'em clásico existente y `LEGACY_V1` del torneo. Uno `RETIRED` tampoco entra en el ciclo.
- **BD:** sin cambios respecto a 0072.
- **Probado en el ensayo** por cada camino:
  - INSERT del worker → `PICKEM_LEGACY_RETIRED`;
  - servicio/admin sin bandera pidiendo `LEGACY_V1` → `PICKEM_LEGACY_RETIRED`;
  - rol de cliente → `permission denied`;
  - panel → no hay ningún botón que cree legacy.
- **Capacidad excepcional:** un superusuario de BD puede crear con la bandera `drl.pickem_legacy_writer` (solo para reparaciones de operador). Ningún camino normal la activa.

## H. Corte estructural
Sin fechas, títulos ni slugs:
- Pick'ems 2.0 vive en `pickem_brackets`, una tabla propia.
- Legacy se identifica por `pickem_events.legacy_mode` (0072).

## I. Por defecto para Pick'ems nuevos
- Un Pick'em nuevo es SIEMPRE un ámbito 2.0 (`pickem_brackets`), en BORRADOR y con recompensas OFF.
- En la tabla legacy, el valor por defecto es `RETIRED`.
- Un ámbito tampoco puede NACER con recompensas activas (`PICKEM_REWARDS_TOO_LATE` al insertar).

## J. Bloqueo de rebaja
- 2.0 → legacy es imposible por construcción: son tablas distintas y no hay conversión.
- `legacy_mode` es inmutable (`PICKEM_LEGACY_MODE_IMMUTABLE`); probado RETIRED → LEGACY_V1 sin bandera.

## K. Versión desconocida
- `legacy_mode` fuera de {LEGACY_V1, RETIRED} → rechazado por restricción, incluso con bandera.
- Política de elegibilidad desconocida → nadie cobra (`POLICY_MISSING`).

## L. Worker antes
Cron `*/2`, release `rel-20260914T093113Z-996d06fd`, bundle `872f5449…`, `ESPORTS_AUTO_SYNC_ENABLED=true` y 0 fallos en las últimas 200 ejecuciones (`worker-before.txt`).

## M. Cambios en el worker
Ninguno en el desplegado. El código fuente compartido (`pickemLifecycle.ts`) deja de intentar crear legacy, y se aplicará cuando el worker se reconstruya. Hasta entonces la BD lo rechaza y el worker lo registra como nota informativa.

## N. Worker después
- 62 ejecuciones desde 0073, todas con exit 0 y `success`; 0 errores.
- Las coincidencias de «error» en su log son el resumen «0 con error» de cada ejecución (`worker-logs-final.txt`).

## O. Cron
Sin cambios (1 línea `*/2`).

## P. Sync
`sync_state` al día (17:46Z).

## Q. Ingesta duplicada
`matches` 101 con 0 ids duplicados; `events` 3; `pickem_events` 3.

## R. Amenaza
- **Principal:** muchas cuentas nuevas predicen el ≥ 80 % del cuadro y cobran un Bronce cada una.
- **Secundaria:** cuentas múltiples en escalones altos.
- No se intenta resolver la multicuenta del todo; el objetivo es que farmear barato no compense.

## S. Auditoría anti-farmeo
Señales revisadas:

| Señal | ¿Sirve? |
|---|---|
| `auth.users.created_at` | Sí: la fija el servidor y no se puede falsificar |
| `duel_matches` (modo y estado, lo liquida el motor) | Sí |
| Correo verificado | No: la autoconfirmación está activa (F77) |
| Nivel / XP | No: deriva de las partidas |
| IP, dispositivo, teléfono | Descartadas por el brief |

## T. Señales usadas
- La antigüedad de la cuenta.
- Las partidas COMPLETADAS o EMPATADAS en `PVE`, `DRAFT_GAUNTLET` o `PVP` (ranked). `PVP_PRIVATE` no cuenta: dos cuentas propias podrían jugárselas entre sí.

## U. Política elegida: `reward-eligibility-v1`
Para COBRAR, la cuenta debe cumplir las dos condiciones en el **primer cierre del Pick'em**:
- **≥ 7 días** de antigüedad;
- **≥ 3 partidas** completadas o empatadas en los modos anteriores.

Predecir, puntuar y salir en la clasificación no lo exigen.

## V. Por qué esta política
- **Solo antigüedad** no frena almacenar cuentas: se crean hoy y se usan en todos los eventos futuros.
- **Solo actividad** se puede automatizar en minutos con una cuenta recién creada.
- **Las dos juntas** obligan a crear cada cuenta con al menos una semana de antelación y a jugar 3 partidas reales del motor del servidor, con su tope y su limitador.

Mínima y proporcionada:
- sin KYC, teléfono, IP ni huella de dispositivo;
- sin exigir F77;
- sin listas blancas manuales y sin anulación de admin.

## W. Versión de la política
Registro único en la BD (`_pickem_eligibility_policy`) con espejo exacto en TS (`domain/pickems/eligibility.ts`); una prueba fija que ambos coinciden. Solo existe la v1.

## X. Congelación de la política
- La política va dentro de la configuración de recompensas (`rewards.eligibilityPolicy`), con su versión y su checksum.
- Se congela con ellas: tras el primer cierre, cualquier cambio da `PICKEM_REWARDS_FROZEN` (0071 + 0073).
- Probado: con una v2 registrada después, un ámbito congelado en v1 sigue evaluando v1, y pasarlo a v2 → `FROZEN`.

## Y. Instantánea de elegibilidad
- Se evalúa en el PRIMER CIERRE del ámbito: la antigüedad en ese instante y las partidas terminadas antes de ese instante.
- Antes del cierre, el jugador ve una vista previa («te faltan N partidas antes del primer cierre»).
- Después es definitiva e inmutable; una partida posterior no cuenta (probado).

## Z. Cuenta nueva
Puede predecir: en el ensayo, las 200 predicciones de las 10 cuentas QA entraron, nuevas incluidas. No cobra: `PICKEM_REWARD_INELIGIBLE`.

## AA. Cuenta madura
Cobra su escalón exacto una sola vez: PERFECT → Masters + insignia; participación → Bronce; 7 días justos y 3 partidas → Plata.

## AB. Perfecto sin derecho a cobro
- El rendimiento sigue siendo **PERFECT** (`final_tier`) y conserva su puesto en la clasificación.
- Reclamar 20 veces a la vez → 0 aplicados, 20 × `INELIGIBLE`.
- Sin sobre Masters, sin insignia y sin asiento en el libro.

## AC. Granja de participación
Una cuenta fresca con ≥ 80 % de picks y pocos puntos → `INELIGIBLE` y sin Bronce.

## AD. Falsificación desde el cliente
Probado en producción:
- `eligible:true` en el cuerpo → 400 «Campo no permitido» (lista blanca);
- RPC de elegibilidad y de reclamo por REST con sesión de jugador → 403/404;
- inserción directa de un reclamo en la BD → el disparador lo rechaza (`PICKEM_REWARD_INELIGIBLE`).

## AE. Elegibilidad para el jugador
Solo con recompensas ACTIVAS, la ficha muestra una nota (`pickem-eligibility`) con símbolo (✓/ⓘ) y texto:
- «Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas…», con el requisito («al menos 7 días y 3 partidas jugadas antes del primer cierre»), o
- «Tu cuenta cumple los requisitos…».

Un perfecto sin derecho dice «Tu resultado: Pick'em perfecto. Sin premio para esta cuenta en este Pick'em.» Verificado en producción a 1440/1024/390.

## AF. Elegibilidad para el admin
Política y recuento por código (Elegible / Cuenta demasiado reciente / Pocas partidas…), sin datos personales (`app_pickem_eligibility_summary`). El diálogo de activación también muestra la política.

## AG. Rendimiento frente a elegibilidad
Separados: escalón y clasificación no dependen de la cuenta; la elegibilidad solo decide el cobro.

## AH. Reglas de recompensa v1
Sin cambios: participación Bronce · ≥ 50 % Plata · ≥ 70 % Oro · ≥ 85 % Masters · perfecto Masters + insignia. Solo el escalón más alto.

## AI. Insignia del perfecto
Misma semántica; solo se entrega a una cuenta elegible, porque va dentro del reclamo.

## AJ. Doble premio
Sigue siendo imposible: las guardias de 0072 se conservan dentro de las de 0073. Un pago legacy con la ref de un ámbito 2.0 → rechazado.

## AK. Carrera de reclamos
Madura PERFECT con 20 reclamos simultáneos → 1 aplicado.

## AL. Carrera worker/reclamo
Worker legacy ×10 con reclamo 2.0 → 1 reclamo y 0 pagos legacy nuevos.

## AM. Modelo de preparación de lanzamiento
Un único concepto canónico (`domain/pickems/launch.ts`): 8 puertas y tres estados (estructura, recompensas, lanzamiento). Lo usan el detalle del panel, «activar recompensas» y «publicar». `activationBlockers` (F87.1) se compone con las mismas piezas.

## AN. Puerta de estructura
Errores del validador (ciclo, aristas sin destino, huecos imposibles, final, etc.) agrupados por código.

## AO. Puerta de fuente
- La fuente ya no deriva el formato, o cambió desde el borrador.
- Partidos ausentes o de otro evento.
- Arista de admin que contradice a la fuente.
- Resultado contradicho.

## AP. Puerta de cierres
Todo partido puntuable con hora o cierre válido.

## AQ. Puerta de puntuación
`pickem-scoring-v1`, puntos enteros > 0 y máximo coherente.

## AR. Puerta de recompensas
Reglas v1 exactas, sobres e insignia válidos y política de elegibilidad CONOCIDA.

## AS. Puerta de economía
Pasivo máximo por jugador calculable. El panel muestra además el peor caso y la simulación.

## AT. Puerta de colisión legacy
El evento no puede tener un Pick'em `LEGACY_V1`.

## AU. Puerta de tiempo
Ni un partido cerrado o empezado, ni el ámbito liquidado o cancelado. En la BD (0073), activar tarde → `PICKEM_REWARDS_TOO_LATE`.

## AV. Fixture listo
Eliminación simple a 8 válida con reglas v1 → «LISTO PARA LANZAR CON RECOMPENSAS». Con recompensas OFF → «LISTO PARA PUBLICAR SIN RECOMPENSAS».

## AW. Fixtures no listos
Cada bloqueo por separado:
- arista de perdedor;
- ciclo;
- contradicción con la fuente;
- deriva;
- cierre inválido;
- sin versión de puntuación;
- máximo incoherente;
- sobre inexistente;
- reglas no aprobadas;
- sin política o con política desconocida;
- pasivo no calculable;
- colisión legacy;
- partido empezado;
- primer cierre pasado;
- liquidado.

Las de recompensas no impiden publicar sin recompensas.

## AX. Publicar frente a recompensas
Siguen siendo acciones distintas. Publicar exige las puertas de estructura, fuente, cierres y puntuación; con recompensas ACTIVAS, todas.

## AY. Panel admin de lanzamiento
Bloque «Preparación de lanzamiento»:
- Estructura ✓ LISTA / ✕ NO LISTA;
- Recompensas OFF / ✓ / ✕;
- Lanzamiento ✓ con o sin recompensas / ✕ NO LISTO;
- cada puerta ✓/✕ con sus motivos en frases;
- la elegibilidad para cobrar.

Producción, Champions: NO LISTO por Estructura (6 cruces de perdedor + 4 huecos), Recompensas (sin política v1) y Colisión legacy. Panel **39/39** a 1440/1024/390, legible en móvil.

## AZ. Champions 2026
DRAFT. Recompensas DRAFT, misma versión y checksum. Activar con confirmación → 409.

## BA. Cruces de perdedor
Siguen sin verificar: 6 × `LOSER_MISSING` en el validador y en la BD. La fuente no los publica. No se inventan.

## BB. Calendario de Champions
El primer cierre es el 2026-10-07 a las 05:00 UTC. Publicarlo no es razonable ni posible sin las aristas, y de todos modos nunca podría tener recompensas 2.0 (autoridad legacy).

## BC. Búsqueda del siguiente evento real
En los datos canónicos solo hay 3 eventos: demo, `vlr-2766` (Champions, autoridad legacy) y `vlr-2976` (terminado). El worker vigila 2.

**NO SUITABLE EVENT YET.**

## BD. Borrador del siguiente evento
No aplica (no hay evento).

## BE. Recompensas reales
OFF (0 ámbitos con recompensas activas).

## BF. Pick'ems reales publicados
0.

## BG. Economía de davex
Saldo 6.120, XP 612, 20 cartas, 2 asientos. Huella conjunta `25d26466…`, idéntica antes de 0073, antes de la limpieza y al final.

## BH. Economía de ValoRosters
Saldo 1.670, XP 1.180, 30 cartas, 17 asientos. Sus cambios de hoy son actividad REAL de la cuenta entre las 14:08 y las 14:22: 2 derrotas, compra de un sobre Heretics y una misión. Son anteriores a F87.2 y no proceden de ninguna QA.

## BI. Los 500 históricos
El mismo asiento (`59f8d286…`, saldo 4.840, 2026-10-03 11:02:21).

## BJ. Cuentas QA
- 9 personas `qa_f872_*`, reutilizadas para TODO: regresión, QA de jugador, panel y cambio de cuenta.
- 2 de la QA de F87 y 4 registradas por los propios arneses F82/F86.2.
- Total: 15, todas `@example.invalid` y ninguna admin. No se crearon más.

## BK. Limpieza QA
1. Verificación previa: solo 2 cuentas reales y 15 QA de esta fase.
2. Backup local `pre-f872-qa-cleanup/20261006T174518Z`.
3. Ensayo con ROLLBACK.
4. Borrado con guardas en una transacción: **15 borradas**.

Después: 2 usuarios, 2 admins, 0 QA y 0 amistades. Quedan como histórico sin FK, igual que en F86/F87, copas QA no listadas.

## BL. Usuarios activos
**2**.

## BM. Admins
**2**: davex y ValoRosters.

## BN–BX. Regresión (release final, una pasada)

| Arnés | Resultado |
|---|---|
| smoke (canónico) | **80/80** |
| F81.2 | **72/72** |
| F82 | **74/74** |
| F83 | **40/40** |
| F84 | **50/50** |
| F85 | **92/92** |
| F86 | **66/66** |
| F86.1 | **37/37** |
| F86.2 | **143/143** |
| F87 (QA de producción) | **36/36** |
| F87.1 (panel F87.1, cambio de cuenta) | **28/28** + incluido en el panel |
| F87.2 (ensayo, jugador, panel) | ensayo **74/74**, jugador **24/24**, panel **39/39** |

Nota sobre F85, F86 y F86.1: la primera pasada de F85 se cortó a mitad (salida 127) y dejó una amistad QA sin limpiar, por lo que F86/F86.1 fallaron por un solo control («0 amistades»). Es contaminación entre arneses, no producto. Se limpió con su propio limpiador (vía API, solo cuentas QA) y se repitió con cuentas QA existentes: todo en verde.

## BY. Tests completos
**6133/6133**.

## BZ. Lint
0 errores (26 avisos históricos).

## CA. Typecheck
PASS (app + scripts).

## CB. Build
PASS en local y en el VPS. Aviso preexistente de `instrumentation.ts`.

## CC–CE. Móvil, tableta y escritorio
Panel, nota de elegibilidad y `/duelos/jugar` verificados a 390/1024/1440: sin desbordamiento y botones ≥ 44 px.

## CF. Accesibilidad
Estados con texto y símbolo (✓/✕/ⓘ), nunca solo color; `aria-pressed`; foco visible; teclado.

## CG. Movimiento reducido
Sin animaciones nuevas.

## CH. Smoke
80/80.

## CI. production:check
27 PASS · 1 WARN (F77) · 4 FAIL (F78). Sin fallos nuevos.

## CJ. Salud
200.

## CK. Ready
`ready`, 20/20, cabeza `0073_pickems_launch_guard`.

## CL. Logs
- **App (release final):** 0 reinicios y 1 línea: un 500 de `/api/game/social` (`duel_matches_pkey`) en la prueba de F85 «B acepta ×5 a la vez». Es una carrera PREVIA de Social, fuera de F87.2; el resultado es correcto (una partida). Ver DC.
- **Postgres:** solo errores esperados de las pruebas negativas (REST sin permiso, `NOT_ADMIN`, `STALE_CUP`, `REASON_REQUIRED`, `CONFIRM_MISMATCH`, `CUP_NOT_IN_PROGRESS`, `duel_matches_pkey` de las aceptaciones simultáneas).
- **Worker:** 0 errores.

## CM. Escaneo de secretos
PASS: overlay, instrumentos y evidencias sin claves, JWT, contraseñas ni correos reales. Los UUID de cuentas reales van acortados.

## CN. Backup
Local, **NO OFF-SITE**:
- `pre-0073/20261006T153550Z` (ensayo);
- `pre-0073/20261006T154335Z` (inmediatamente antes de 0073);
- `pre-f872-qa-cleanup/20261006T174518Z`.

## CO. Migración
`0073_pickems_launch_guard` (sha256 `37739bed…5a7d`), aplicada 2026-10-06T15:43:48Z en 182 ms y una transacción:
- datos intactos (23 tablas);
- 5 funciones nuevas y las 2 guardias de 0072 ampliadas;
- privilegios de cliente cerrados;
- legacy, admins y los 500 iguales.

No se creó ninguna migración para el ajuste UX.

## CP. Ensayo de la migración
Copia aislada `--network none` del backup previo: **74/74**, incluidos rollback (se niega con recompensas activas; devuelve exactamente las guardias de 0072 y no reabre legacy) y reaplicación.

## CQ. Release
- **`drl-0.1.1-1-32316185`** (15:52Z): F87.2 + la corrección de lint de F87.1.
- **`drl-0.1.1-1-510f9e22`** (16:29Z, FINAL): `32316185` + el ajuste UX de PreMatch.

## CR. Límite de la release
- `32316185` = `e919d780` + 30 ficheros de F87.2 (25 modificados, idénticos a producción antes de tocarlos salvo la corrección de lint, + 5 nuevos).
- `510f9e22` = `32316185` + 7 ficheros UX (4 modificados, idénticos a producción antes de tocarlos, + 3 nuevos).
- `BOUNDARY_OK` en los dos; F78 = producción; sin instrumentos `_` ni evidencias.
- El arnés `/design-system/prematch-rules` da 404 en producción (comprobado).

## CS. Rollback
- **App:** `bin/deploy.sh --activate drl-0.1.1-1-32316185` (quita solo el UX) o `drl-0.1.1-1-e919d780` (antes de F87.2). La app vieja sobre 0073 falla cerrada: sus reglas no llevan política, así que la BD no deja activar.
- **BD:** `docs/operations/rollback/0073_pickems_launch_guard.ROLLBACK.sql`. Se niega si hay recompensas activas, devuelve las guardias EXACTAS de 0072 y no reabre la creación legacy.
- **Worker:** no se tocó.

## CT–CY. Producto
- Mercado OFF.
- Pagos OFF.
- Temporada 2 DRAFT.
- Open #1 DRAFT.
- Closed Alpha Cup DRAFT (no listada).
- Closed Alpha NO iniciada.

## CZ. F77
Sin tocar.

## DA. F78
Excluido.

## DB. Commit / push
Ninguno.

## DC. Riesgos pendientes
1. **Multicuenta con antelación:** quien prepare cuentas una semana antes y juegue 3 partidas con cada una puede seguir cobrando Bronce. Cada cuenta cuesta tiempo real y queda visible en el resumen del panel.
2. **Recién llegados:** un jugador que se registra para un torneo no cobra en ese evento (por diseño); puede jugar y salir en la clasificación.
3. **Worker sin reconstruir:** el desplegado sigue intentando crear legacy en eventos nuevos y la BD lo rechaza; desaparece al reconstruirlo con el código actual.
4. **Social (F85):** 5 aceptaciones simultáneas de un reto pueden devolver un 500 a una de las peticiones perdedoras. El resultado sigue siendo una sola partida. No es de F87.2 y no se tocó.
5. **Copias de seguridad:** solo locales (F78).

## DD. Lo que requiere tu aprobación
1. **Política anti-farmeo:** `reward-eligibility-v1` (≥ 7 días Y ≥ 3 partidas en PvE/Draft/ranked antes del primer cierre). Consecuencia de UX: los recién llegados no cobran en su primer evento.
2. **Champions 2026:** NOT READY. Además, el calendario (primer cierre el 2026-10-07 a las 05:00 UTC) hace inviable lanzarlo.
3. **Siguiente evento real:** NO SUITABLE EVENT YET.
4. **Para activar recompensas en un evento futuro:** nada técnico lo bloquea más allá de las 8 puertas. La activación sigue siendo una decisión tuya.

## PREMATCH UX SIMPLIFICATION
- **Selector:** solo FÁCIL · NORMAL · DIFÍCIL, tres columnas iguales también en móvil. Sin etiquetas, descripciones, barras ni el párrafo «Ningún nivel ve…». La seleccionada lleva `aria-pressed`, borde y barra de acento (no solo color), con foco visible. El DOM conserva «Fácil/Normal/Difícil»; las mayúsculas son de CSS.
- **Reglas una sola vez:** 10 TURNOS · DECLARA Y RESPONDE · GANA EL VALOR MAYOR (el bloque compacto de siempre) solo en la primera entrada. Después desaparecen sin dejar hueco («Comenzar duelo» a 20 px). La ayuda «?» las conserva.
- **Persistencia (aprobada):** `duel-rules-seen-<cuenta>` en el adaptador KV de la plataforma (localStorage), el mismo mecanismo que la preferencia de la guía. Es por cuenta y por dispositivo/navegador. Se marca al pintarse las reglas, nunca antes. Sin backend ni migración.
- **Ficheros:**
  - `src/components/duel/PreMatch.tsx`
  - `src/app/duelos/jugar/page.tsx`
  - `src/lib/duel/rulesIntro.ts` (nuevo)
  - `src/components/duel/prematchRules.render.test.tsx` (nuevo)
  - `src/app/design-system/prematch-rules/page.tsx` (arnés, 404 en producción)
  - `src/components/duel/gameplay.contract.test.ts` (A3)
  - `scripts/duel-e2e-browser.ts`: comprobación 5 invertida; su regex de jerga tenía caracteres de control y no podía detectar nada, corregida.
- **Tests:** render 4/4; E2E en navegador sobre la build local **24/24** (primera y segunda entrada, F5, salir y volver, nuevo navegador, otra cuenta, dificultades con ratón y teclado, «Comenzar duelo», 1440/1024/390).
- **Verificación en producción** (`510f9e22`, cuenta QA, Chrome real): FÁCIL · NORMAL · DIFÍCIL sin los textos retirados; reglas en la primera visita y ausentes tras F5 y al volver; 1024/390 sin desbordamiento, en fila y ≥ 44 px; Difícil + «Comenzar duelo» arranca la partida real.

## DE. Veredicto
Estado final:
- **Pick'ems:** listos para lanzar; legacy nuevo bloqueado, el existente solo termina; reglas v1 aprobadas; elegibilidad lista; recompensas reales OFF; 0 publicados; Champions DRAFT / NOT READY.
- **PreMatch:** simplificado, con reglas de una sola vez.
- **Cuentas:** 2 usuarios, 2 admins, 0 QA.
- **Resto:** mercado y pagos OFF; Temporada 2 y Open #1 en DRAFT; Closed Alpha no iniciada.
- Sin commit ni push.

F87.2 PICKEMS LAUNCH GUARD = GO
