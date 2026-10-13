# F87.1 · Retirada de recompensas de Pick'em LEGACY + preparación de recompensas de Pick'ems 2.0

Fecha: 2026-10-06. Producción: https://valorosters.com · release **`drl-0.1.1-1-e919d780`** · cabeza **`0072_pickems_reward_cutover`**.
Evidencias: `docs/product/qa/pickems-2/f871/` (ensayo, aplicación, staging, worker antes/después, lint, tipos, tests, production:check, regresión, cambio de cuenta, panel admin, limpieza, estado final, salud y logs).
Sin commit. Sin push. Nada publicado. Ninguna recompensa real activada.

## A. Estado inicial
- Release viva `drl-0.1.1-1-9bfb0e10` (F87), cabeza `0071_pickems_bracket`.
- 2 cuentas, ambas admin: davex `#NB2Z9BM` y ValoRosters `#H5ND8K7`.
- Pick'ems legacy: 3 (`demo-masters-madrid-2026`, `vlr-2766` Champions 2026, `vlr-2976-emea-stage-2`), con 1 participación (ValoRosters) y 1 pago (500 créditos, 2026-10-03).
- Pick'ems 2.0: 1 borrador (`champions-2026-playoffs`, DRAFT, recompensas DRAFT), 0 entradas.
- Worker esports sin tocar desde 2026-09-14, cron cada 2 min.

## B. Arquitectura del Pick'em LEGACY
Migraciones 0012/0018: `pickem_events` (uno por evento) → `pickem_questions` → `pickem_submissions`/`pickem_answers` → `pickem_scores`. Los crea y puntúa el worker (`runPickemLifecycle` en el bundle desplegado, sha `872f5449…`), no la app.

## C. Camino de pago LEGACY
`runPickemLifecycle` → `ensurePickemEvent` (inserta un `pickem_events` por CADA evento sincronizado) → `syncQuestions` → `resolveFinished` → `scoreIfReady` → `scorePickemEvent`.

Este último llama a `app_score_pickem_event` y, por cada fila de `pickem_scores`, a `award()` → `app_grant_reward`, con ref `pickem:<id>:<escalón>` y motivo `pickem_reward:<escalón>`. Escalones del bundle: participación 500 · acertante 1.500 + Estándar · analista 3.000 + Premium · oráculo 6.000 + Champions.

El bundle desplegado NO lleva el arreglo F42 `pickemTierDelta`: en una recalificación paga los escalones intermedios de forma acumulativa. Los errores del ciclo se atrapan y salen como nota `info` (`pickem_lifecycle`): el sync sigue `success`.

## D. Eventos legacy activos
Los 3 `pickem_events` quedan **`LEGACY_V1`** (todos anteriores al corte):

| Evento | Estado | Participantes | Pagos |
|---|---|---|---|
| `vlr-2766` (Champions 2026) | `scored` | 1 | 1 |
| `vlr-2976-emea-stage-2` | `open` | 0 | 0 |
| `demo-masters-madrid-2026` | `scored` | 0 | 0 |

Conservan íntegras sus reglas: no se reescribe ni se cierra ningún evento existente (ver CZ).

## E. Recompensas históricas
1 asiento `pickem_reward:*` en todo el libro: 500 créditos a ValoRosters (2026-10-03). Ni se revierte, ni se compensa, ni se recalcula.

## F. Huella de los 500 de ValoRosters
Mismo asiento antes del ensayo, tras el ensayo, tras aplicar 0072 y al final:

`59f8d286-7b81-489b-9098-bb15ce6047a5 | b7ccff02… | 500 | pickem_reward:participacion | pickem:8c7b9a5e-…:participacion | saldo 4840 | 2026-10-03 11:02:21.826395+00`

Evidencias: `final-state.txt` y `f871-apply-0072.txt` (`VALOROSTERS_500_MISMO_ASIENTO`).

## G. Arquitectura de F87 (Pick'ems 2.0)
- Tablas propias de 0071: `pickem_brackets`, `pickem_bracket_matches`, `pickem_bracket_entries`, `pickem_bracket_picks` y `pickem_bracket_claims`.
- Liquidación manual de admin (`app_pickem_admin_settle`, con `settlement_version`).
- Reclamo exactamente-una-vez (`app_pickem_claim`, ref `pickem_bracket:<id>`, vía `app_grant_reward`).
- Recompensas versionadas (`rewards_version`, `rewards_checksum`), OFF/DRAFT por defecto.

## H. Modelo del corte
El corte es ESTRUCTURAL: no depende de una fecha y no toca el worker. La BD es la autoridad (`0072`):

1. **Discriminador.** `pickem_events.legacy_mode`: las filas existentes quedan `LEGACY_V1` y el valor por defecto pasa a `RETIRED`.
2. **Sin legacy nuevos.** No se crean Pick'ems legacy: el INSERT lanza `PICKEM_LEGACY_RETIRED`, salvo con la bandera de operador `drl.pickem_legacy_writer`.
3. **Inmutable.** `legacy_mode` no se puede cambiar (`PICKEM_LEGACY_MODE_IMMUTABLE`).
4. **Predicciones.** Solo se predice en un `LEGACY_V1` (guardia en `pickem_submissions`).
5. **Libro.** Un asiento `pickem_reward:*` solo entra con ref `pickem:<uuid de un LEGACY_V1>:<escalón>`. Si no, `PICKEM_LEGACY_REWARD_RETIRED` y se deshace toda la transacción.
6. **Una autoridad por evento.** Pick'ems 2.0 no puede activar ni reclamar en un evento con un Pick'em `LEGACY_V1` (`PICKEM_LEGACY_AUTHORITY`).
7. **Reglas.** Activar exige las reglas v1 exactas (`_pickem_rules_v1_ok`, `PICKEM_RULES_NOT_APPROVED`).

## I. Invariante de doble premio
Para cualquier evento E, como mucho UNA autoridad paga:
- Si E tiene un Pick'em `LEGACY_V1`, Pick'ems 2.0 no puede activar recompensas ni insertar reclamos.
- Si E no lo tiene, el libro rechaza cualquier pago legacy de E. Tampoco puede nacer un legacy nuevo para E (INSERT bloqueado, y además `RETIRED`).

Dentro de cada autoridad:
- Legacy: ref única por escalón (la idempotencia de `app_grant_reward` que ya existía).
- 2.0: un reclamo por (cuadro, usuario), con fila bloqueada `for update`.

## J. Comportamiento a prueba de fallos (falla cerrada)
- Una ref legacy malformada, falsificada (`pickem_bracket:…`), de un Pick'em inexistente o de uno `RETIRED` → rechazada. La transacción entera se deshace: ni créditos ni sobres.
- `hasLegacyAuthority` con error de lectura → se trata como «hay autoridad legacy», así que no se activa.
- Todo comprobado en el ensayo (`f871-dryrun.txt`).

## K. Worker antes
Evidencia: `f871-worker-before.txt`.
- Captura: 11:59:14Z.
- Cron `*/2`; release `rel-20260914T093113Z-996d06fd`; bundle `dist/worker.cjs` sha256 `872f5449d8c2…0e34`; `ESPORTS_AUTO_SYNC_ENABLED=true`.
- 0 salidas ≠ 0 en las últimas 200 ejecuciones.
- Tablas legacy: 3 / 63 / 1 / 1; pagos legacy 1 / 500; eventos 3; partidos 101.

## L. Cambios en el worker
**Ninguno.** Sin backup ni rollback que hagan falta, sin segundo worker y sin prueba en sombra: la autoridad está en la BD. El worker sigue intentando crear legacy en eventos nuevos, y la BD lo rechaza como nota informativa de su ciclo.

## M. Worker después
Evidencia: `worker-after.txt`, a las 13:01Z.
- Mismo cron, release, bundle (sha idéntico) y bandera.
- **31 ejecuciones desde 0072: 31 con exit 0 y `status=success`**; 0 errores y 0 `PICKEM_*` en su log.
- Tablas legacy y pagos idénticos a K.

## N. Cron
`*/2 * * * * /opt/nexus/projects/drlcards-sync/bin/run-sync.sh`, sin cambios.

## O. Sync
`events_checked=2 … status=success` en todas las ejecuciones; `sync_state` al día (última escritura 13:00:02Z).

## P. Ingesta duplicada
`matches` 101 con 0 ids duplicados; `events` 3; `pickem_events` 3 (ninguno nuevo).

## Q. Reglas de recompensa v1 (APROBADAS)
`pickem-rewards-v1` (`rewardRulesV1(slug)` ⇄ `_pickem_rules_v1_ok`):
- `minCompletion` 0,8; exactamente 5 escalones; sin créditos ni cartas; 1 sobre por escalón.
- Insignia solo en PERFECT: `insignia:pickem:<slug>-perfecto`.
- Cualquier variación deja de ser v1. En TS se probaron 8 mutaciones más el slug ajeno; en la BD, activar reglas no aprobadas (Élite = sobre Champions) se rechaza con `PICKEM_RULES_NOT_APPROVED`.

## R. Participación
≥ 80 % de los partidos puntuables con pick hecho a tiempo → 1 sobre Estándar (Bronce, 2.500). Con 15/20 (75 %) no hay nada, ni con todos los puntos.

## S. Bueno
≥ 50 % de `max_score` → 1 Premium (Plata, 6.000).

## T. Muy bueno
≥ 70 % → 1 Oro (12.000).

## U. Élite
≥ 85 % → 1 Masters (20.000).

## V. Perfecto
Todos los partidos puntuables y obligatorios acertados → 1 Masters + insignia «Pick'em perfecto» (20.000 + insignia).

## W. Insignia del perfecto
- Por ámbito/evento (`insignia:pickem:<slug>-perfecto`), registrada en `pickemBadgeFact` (`domain/collectionSets/badges.ts`): un id que no encaja no se pinta.
- Sin arte falso: usa la insignia de texto del sistema de insignias.

## X. Sala de Trofeos
La insignia se ve en la Sala de Trofeos (hechos de insignia de F82), NO en `ProfileIdentityCard` (que desde 2026-10-05 es solo la tarjeta de identidad).

## Y. Semántica de VOID
Un partido anulado sale del denominador y no rompe el perfecto (TS: GSL con `gsl-a-e` anulado → PERFECT; SQL: «VOID · perfecto con el anulado sin pick → Masters + insignia de B3»).

## Z. Pick que falta
Un hueco sin pick en un partido puntuable rompe el perfecto (TS: 4/5 picks, 85,7 % → ELITE; SQL: `MISSING_BREAKS_PERFECT` → ELITE).

## AA. Resolución del escalón
- Enteros exactos, sin coma flotante: `atLeast(num, den, frac)` = `num·1000 ≥ round(frac·1000)·den`; la SQL usa `numeric` exacto.
- Fronteras probadas: 499/500, 699/700, 849/850, 999/1000 de 1000; 7/10, 14/20, 17/20, 21/30.
- Paridad SQL⇄TS en 11 perfiles (`f871-dryrun.txt`).

## AB. Prueba de no acumulatividad
`tierFor` devuelve UN identificador; la SQL guarda `final_tier` (un valor) y el reclamo inserta UNA fila con UN escalón. Orden: PERFECT > ELITE > GREAT > GOOD > PARTICIPATION > NONE.

## AC. Versión de la configuración
`rulesVersion` en el JSON; `rewards_version` y `rewards_checksum` por cuadro. Cada guardado incrementa la versión (el admin manda la esperada).

## AD. Congelación de recompensas
No se activan ni cambian cuando el cuadro está PUBLICADO con algún partido ya cerrado (bloqueo «congeladas»). La BD revalida al pasar a o seguir en ACTIVE con cambios.

## AE. Congelación de la puntuación
`scoring_version` `pickem-scoring-v1` fijada en el borrador; la liquidación recalcula con esa versión.

## AF. OFF por defecto
`rewardRulesV1(slug)` nace en OFF y la propuesta del panel en DRAFT; publicar no activa recompensas.

## AG. Guardia de activación
Activar exige, a la vez:
- `ack === true`;
- reglas v1 exactas;
- validador del cuadro sin errores;
- sin autoridad legacy en el evento;
- que no esté congelado ni liquidado.

Hay dos capas: servidor (`activationBlockers`) y BD (disparador).

## AH. Confirmación del admin
El diálogo es de riesgo CRÍTICO, exige escribir el slug y muestra el resumen: escalones con lo que da cada uno, máximo por jugador (20.000 + insignia), versión siguiente y aviso de congelación. «Cargar reglas v1 aprobadas» rellena la tabla exacta.

## AI. Auditoría
Las acciones de admin quedan en `content_audit_log` (0071). La concesión y retirada de admin QA se auditaron como GRANT_ADMIN/REVOKE_ADMIN (actor nulo, «via operator»).

## AJ. Liquidación
Manual, con `settlement_version`; una re-liquidación de un cuadro ya liquidado exige un motivo de ≥ 8 caracteres (`PICKEM_REASON_REQUIRED`).

## AK. Reclamo
Solo con el cuadro SETTLED y las recompensas ACTIVE. Fila de entrada bloqueada `for update`; ref `pickem_bracket:<id>`.

## AL. Exactamente una vez
Si el reclamo ya existe, devuelve `applied:false` con lo ya entregado. Ensayo: «PERFECTO · 20 reclamos simultáneos: 1 aplicado».

## AM. Carrera de reclamos
20 en paralelo sobre el mismo (cuadro, usuario) → 1 fila de reclamo y 1 concesión.

## AN. Carrera worker/reclamo
Worker legacy ×20 en paralelo con el reclamo 2.0 del mismo evento → 1 reclamo aplicado y 0 pagos legacy nuevos.

## AO. Reinicio/reintento
- Worker legacy repetido ×20 → 0 asientos nuevos (27 = 27).
- Reintento de reclamo → `applied:false`.
- Reiniciar la app no cambia nada: todo el estado vive en la BD.

## AP. Corrección de resultados
- Re-liquidar incrementa `settlement_version` y recalcula `final_tier`.
- Un reclamo ya hecho se queda: ni se vuelve a pagar ni se retira.
- Si la corrección SUBE el escalón de alguien que ya reclamó, NO cobra la diferencia; si lo BAJA, no se le quita. Es deliberado: exactamente-una-vez antes que recalcular el libro (ver CY).

## AQ. Vista previa de recompensas
El panel enseña la economía por escalón y el pasivo (1.000 jugadores = 20.000.000). Con el cuadro incompleto no simula y avisa (panel admin: PASS).

## AR. Pasivo económico con 10 jugadores
**Peor caso: 10 × 20.000 = 200.000 (+ hasta 10 insignias).**

Valor esperado por participante (simulación de F87 sobre el doble a 8 de Champions, `economy.json`):

| Acierto medio | Valor esperado por participante |
|---|---|
| 50 % (azar) | 2.793 |
| 60 % | 3.402 |
| 65 % | 3.948 |
| 70 % | 4.769 |
| 80 % | 7.824 |

Hipótesis realista: el 50 % de las cuentas completa el ≥ 80 % del cuadro, con un acierto del 65 %. Con eso salen 19.740; si participan todas con un 70 % de acierto, 47.690.

## AS. Pasivo con 100
Peor caso 2.000.000. Realista 197.400; si participan todas con un 70 %, 476.900.

## AT. Pasivo con 1.000
Peor caso 20.000.000. Realista 1.974.000; si participan todas con un 70 %, 4.769.000.

## AU. Pasivo con 10.000
Peor caso 200.000.000. Realista 19.740.000; si participan todas con un 70 %, 47.690.000.

Los importes son el precio de tienda de los sobres entregados (no créditos acuñados). Lo que de verdad entra en la economía es el valor de las cartas, con liquidación al 6 %.

## AV. Abuso de la participación y multicuenta
La participación da un Bronce (2.500) por rellenar el ≥ 80 % del cuadro, sin exigir aciertos. Con la autoconfirmación de correo activa (deuda F77), cada cuenta nueva suma 2.500 por Pick'em. Es menos que el regalo de alta (6.000), pero se repite en cada evento.

No hay límite por dispositivo o IP, ni antigüedad mínima de cuenta. Medidas a decidir antes de activar recompensas reales (ver CZ): correo verificado (F77), antigüedad o partidas mínimas para la participación, o quitar la participación del primer evento.

## AW. Borrador de Champions 2026
`champions-2026-playoffs` sigue en DRAFT con recompensas DRAFT (versión 1, mismo checksum antes y después de las pruebas). 0 publicados.

Además, nunca podrá premiar: `vlr-2766` tiene un Pick'em `LEGACY_V1`, y el panel lo dice. La activación con reglas v1 y confirmación se probó en producción y devolvió **409 por autoridad legacy, sin cambios**.

## AX. Validación de los 6 cruces de perdedor
Resultado: **NOT READY**.
- **BD:** las 6 aristas siguen con `loser_to_match_id` vacío.
- **Fuente:** la página de VLR del evento se descargó hoy (200, `/event/2766/…/playoffs`). Su gramática (`bracket-item-line mod-up/mod-down`) solo dice a qué partido pasa el GANADOR; nunca dice a dónde cae el perdedor (documentado en `vlr-bracket-markup`).
- **Partidos:** los cuartos altos están sin jugar (el primero, 2026-10-07 05:00 UTC) y la Ronda 1 baja sigue «TBD v TBD».
- **Validador:** 6 `LOSER_MISSING` + 4 `SLOT_UNKNOWN`.

No se inventa ninguna arista.

## AY. Límites del formato
- Sin las aristas de perdedor, un doble eliminación no es publicable.
- Las aristas de admin no pueden contradecir a la fuente (`ADMIN_CONTRADICTS_SOURCE`, comprobado).
- La liquidación es manual: el worker no liquida 2.0.

## AZ. Cambio de cuenta (E2E)
**28/28** (`account-switch/account-switch.json`).

Montaje: Chrome real; login y logout REALES por `/cuenta` con dos cuentas QA nuevas, en la app desplegada.

Solo la API de cuadros se sirve desde un fixture por token (CDP Fetch en cada pestaña):
- Pick'em QA `qa-f871-switch`, que no existe en producción (404 real).
- Picks por el `sub` del JWT.
- Revisión con STALE.
- La misma invalidación (`invalidatedBy`) y la misma vista (`makeView`) que el arnés de F87.

Recorrido:
- A elige 3; los ve tras F5 y por navegación directa.
- B entra con el servidor lento (2,5 s): **nunca se pinta un pick de A** (0 desde la navegación, en las dos pestañas). Todas sus peticiones llevan SU token y el almacenamiento queda sin rastro de A.
- B elige el equipo contrario de A en el mismo cuarto.
- B sale y A vuelve: A recupera **exactamente** sus 4, sin el de B, y otra vez tras F5.

Contra el servidor real: lista pública con 0 cuadros, y el borrador de Champions da 404.

## BA. Cierre de sesión
- Logout REAL: ningún token de A queda en el almacenamiento.
- La 2.ª pestaña del mismo perfil, sin recargar, deja de mostrar los picks de A.

## BB. Multipestaña
- Dos pestañas del MISMO perfil (sesión y `localStorage` compartidos) ven lo mismo.
- La 2.ª guarda un 4.º pick; la 1.ª, con la revisión vieja, recibe STALE y pasa a mostrar lo del servidor con aviso.
- El logout en una vacía la otra.

## BC. F5
A recupera lo suyo del servidor tras F5 (dos veces) y por URL directa.

## BD. Seguridad
- QA de producción F87: 36/36 (REST directo a tablas/RPC de 0071 denegado, lista blanca del cuerpo, `private, no-store`).
- Panel: admin API con cuenta normal → 401.
- Smoke: 80/80, con pruebas entre usuarios y escaladas.
- Privilegios de cliente sobre las funciones de 0072: `false`.

## BE. Cuentas QA
14, todas con correo `@example.invalid` y nombre `qa…` (excluidas del embudo alpha), registradas por el registro real:
- 9 personas de la regresión (`qa-f871-*`), preparadas como jugadores nuevos (sobres de alta + primer equipo). G compró un sobre para que su saldo no coincidiera con el de la demo.
- 2 de la QA de producción de F87.
- 3 registradas por los propios arneses F82/F86.2.

Admin TEMPORAL por operador para F82, F86, F86.1, F86.2 y el panel, siempre revocado.

## BF. Limpieza QA
1. Backup local `pre-f871-qa-cleanup/20261006T131334Z`.
2. Ensayo con ROLLBACK.
3. Borrado canónico de `auth.users` en UNA transacción con guardas (`_f87-qa-cleanup.sql` vía `_f871-regression.sh cleanup 14 COMMIT`): **14 borradas, quedan 2**.

Quedan como histórico sin FK, con el mismo convenio que F86/F87: 6 copas QA NO LISTADAS (CANCELLED/COMPLETED) y filas de auditoría.

## BG. Economía de davex
Saldo 6.120, XP 612, nivel 1. Huella conjunta davex+ValoRosters (perfil + libro + sobres + cartas) = `3079232f267c9692f4829baebc4260ca`, idéntica a la del ensayo previo a 0072 y al final.

## BH. Economía de ValoRosters
Saldo 4.840, XP 896, nivel 1. Misma huella; el asiento de los 500 es el mismo (F).

## BI. Usuarios activos
**2** (`auth.users` = `profiles` = 2).

## BJ. Admins
**2**: davex `#NB2Z9BM` y ValoRosters `#H5ND8K7`.

## BK. Interfaz legacy
`/pickems` (legacy) no cambia. Si un Pick'em clásico estuviera `RETIRED`, predecir devolvería 409 «Este Pick'em clásico ya no admite predicciones» (no hay ninguno: los 3 son `LEGACY_V1`).

## BL. Interfaz de F87
Con recompensas no activas, la ficha dice «Recompensas aún no activadas para este Pick'em. Cuenta para la clasificación.» (render 7/7).

## BM. Interfaz admin
Panel **30/30** a 1440/1024/390 (`f871/admin/admin-prod.json`):
- Lista «Pick'ems clásicos (LEGACY)» aparte, con los 3 en `LEGACY_V1` y sus pagos.
- Etiqueta «2.0» en la lista y, en el detalle, Sistema/Publicación/Liquidación/Recompensas/Reglas/Puntuación.
- Aviso de autoridad legacy y bloqueos de activación listados.
- Sin desbordamiento.

## BN. Arneses obsoletos: antes
F87 heredó 14 fallos de instrumento:

| Arnés | Fallos | Causa |
|---|---|---|
| F81.2 | 1 | HUD medido tras el login |
| F82 | 2 | Cartas de G2 de la QA antigua; admins comparados con `2f86cbe8` |
| F84 | 3 | Bloque ranked exigido siempre |
| F85 | 1 | Ausencia de fila de rating ≠ fila por defecto |
| F86 | 3 | Cabeza fijada en 0069 y `#9KZAWPC` |
| F86.1 | 2 | `#9KZAWPC` |
| F86.2 | 2 | `#9KZAWPC` |

## BO. Arneses obsoletos: después
Arreglos repetibles, sin PASS falso. Copias previas en `scratchpad/f871-prebackup/harness`.

- **F86, F86.1, F86.2.** «Cuenta personal» → huella de solo lectura de las 2 cuentas reales (davex, ValoRosters: mismo #TAG, admin, 0 torneos, 0 feedback, rating y créditos iguales). Admins = exactamente esas 2. Cabeza «≥ 0069 + check cups» en vez de igualdad. Guardia: ningún actor puede ser una cuenta real ni la borrada.
- **F84.** El bloque de rango se espera según el estado competitivo REAL del servidor (contrato EMPTY_OWN).
- **F85.** Rating comparado en su vista canónica (sin fila = 1000:0:0:0).
- **F82.** El estado de G2 se espera según las cartas que tiene la QA (`setState`: LOCKED sin cartas, IN_PROGRESS con alguna) y los admins = los 2 reales.
- **F81.2.**
  - El login de una cuenta con la guía de inicio pendiente aterriza en el vestíbulo `/`, que pinta el saldo en la portada y no en el HUD de cabecera. Se juzga con la regla `isReal` de esa ruta, y nunca se vio el 6.000 de la demo.
  - Además, una persona QA nueva tiene 6.000 = la demo (el arnés abortaba): G compra un sobre como cualquier jugador.
  - Un `/tienda @1024 +3 s` que solo registró el estado de carga en una ejecución no se repitió (pasa aquí y en todas las ejecuciones anteriores): intermitente del muestreo, no del producto.
- **Ciclo repetible** `scripts/ops/_f871-regression.sh`: `setup` crea y prepara las personas, con `QA = A` como en los arneses originales; `run`; `cleanup N [COMMIT]` borra solo las QA creadas desde `setup`.
- **Panel admin (`_f87-admin-prod.mts`).** Ampliado con lo de F87.1, y con `F87_ADMIN_OUT` para no pisar la evidencia de F87.

## BP. F81.2
**72/72.**

## BQ. F82
**74/74.**

## BR. F83
**40/40.**

## BS. F84
**49/49.**

## BT. F85
**92/92.**

## BU. F86/F86.1
**66/66** y **37/37.**

## BV. F86.2
**145/145.**

## BW. F87
- QA de producción **36/36**, panel admin **30/30**, render/contratos 7/7.
- F87.1: ensayo **71/71**, reglas 7/7, cambio de cuenta **28/28**.

## BX. Tests completos
**6119/6119** (también tras el arreglo de lint).

## BY. Tipos
`npm run typecheck` (app + scripts): **PASS** (`typecheck.txt`).

## BZ. Lint
`npm run lint`: **0 errores**, 26 avisos históricos (ninguno en ficheros de F87.1).

La primera pasada encontró **3 errores de F87.1**: `react/no-unescaped-entities`, apóstrofos en JSX de `src/app/admin/pickems/page.tsx`. Se corrigieron con literales `{"…"}`, que dan el mismo texto en pantalla.

## CA. Build
PASS en el VPS dentro de `deploy.sh` (release `e919d780`). La única diferencia entre lo desplegado y lo local en código de app es ese escapado de lint, sin efecto en el render; viaja en la próxima release.

## CB. Móvil
Panel admin a 390 OK; F81.2 a 390 OK. La ficha del cuadro a 390 se validó en F87 y F87.1 solo cambia una frase.

## CC. Tableta
Panel admin y F81.2 a 1024 OK.

## CD. Escritorio
Panel admin, F81.2 y el cambio de cuenta a 1440 OK.

## CE. Salud
`/api/health` 200.

## CF. Ready
`ready`, cabeza `0072_pickems_reward_cutover`, **19/19** comprobaciones en verde (incluida la nueva `pickems_cutover`).

## CG. Smoke
`npm run smoke:production` (canónico) **80/80**, con cuentas QA nuevas.

## CH. production:check
`--app --vps`: **26 PASS · 2 WARN · 4 FAIL**.
- Los 4 FAIL son F78 off-site (excluido).
- WARN `auth-email` = F77.
- WARN `build` = huella de la build LOCAL frente al árbol local (no aplica a la release desplegada).
- Cabeza de app y BD = 0072. Sin fallos nuevos.

## CI. Logs
- `valorosters-app` desde el despliegue: **0** errores, 0 reinicios.
- Postgres: solo errores esperados de las pruebas negativas de los arneses: REST sin permiso, `NOT_ADMIN`, `STALE_CUP`, `REASON_REQUIRED` y 4 `duel_matches_pkey` de las aceptaciones simultáneas (×5 → 1 partida).
- Worker: 0 errores.

## CJ. Escaneo de secretos
Overlay, instrumentos nuevos y evidencias: sin JWT, claves, contraseñas ni correos reales. Los UUID completos de las cuentas reales se acortaron a su prefijo en las evidencias. La única coincidencia del overlay es una prueba preexistente de redacción (`ops.test.ts`).

## CK. Backup
Local, **NO OFF-SITE**:
- `pre-0072/20261006T115428Z` (previo a 0072);
- `pre-f871-qa-cleanup/20261006T131334Z` (previo a la limpieza).

## CL. Migración
`0072_pickems_reward_cutover` (sha256 `8c0661fa…45ae`), aplicada **2026-10-06T11:59:41Z** en 159 ms y una transacción:
- Datos existentes intactos (huellas de 22 tablas sin la columna nueva).
- 3/3 `LEGACY_V1`, por defecto `RETIRED`, 5 disparadores.
- Privilegios de cliente `false`; admins, cuentas, pagos legacy y el asiento de los 500 iguales.

Ensayo aislado previo **71/71** sobre una copia del backup, incluidos rollback y reaplicación. No se reaplicó en esta continuación.

## CM. Release
**`drl-0.1.1-1-e919d780`** activa desde 12:09:43Z (tar sha256 `178d7f03…b7ab`). No se creó otra: no hubo cambio de comportamiento que desplegar.

## CN. Límite de la release
Base = fuente de producción `drl-0.1.1-1-9bfb0e10` + overlay F87.1: **3 añadidos + 23 modificados + 0 borrados** = overlay exacto (`BOUNDARY_OK`).
- Las versiones previas de los 23 eran byte a byte las de producción.
- Ficheros F78 = producción.
- Sin instrumentos `_` ni evidencias (`f871-stage.txt`).

## CO. Rollback
- Código: `bin/deploy.sh --activate drl-0.1.1-1-9bfb0e10`.
- BD: `docs/operations/rollback/0072_pickems_reward_cutover.ROLLBACK.sql` (quita disparadores y funciones y conserva la columna).
- AVISO escrito en el propio fichero: deshacer 0072 devuelve al worker la capacidad de crear y pagar Pick'ems legacy en eventos nuevos, es decir, reabre el riesgo de doble premio. Antes de usarlo hay que comprobar que no hay recompensas 2.0 ACTIVAS.

## CP. Open #1
DRAFT, sin tocar.

## CQ. Closed Alpha Cup
DRAFT, sin tocar.

## CR. Closed Alpha
NO iniciada.

## CS. Temporada 2
DRAFT.

## CT. Mercado
OFF (`GLOBAL_MARKET_ENABLED=false`).

## CU. Pagos
OFF (`PAYMENTS_ENABLED=false`).

## CV. F77
Sin tocar (deuda: autoconfirmación de correo ON).

## CW. F78
Excluido: sin Backblaze, sin programación y sin afirmaciones off-site.

## CX. Commit / push
Ninguno.

## CY. Riesgos pendientes
1. **Legacy vigente con reglas viejas.** Los 3 Pick'ems `LEGACY_V1` conservan las reglas del bundle, incluido el pago acumulativo de escalones intermedios al recalificar. `vlr-2976-emea-stage-2` está `open` (0 participantes): si alguien participa, cobra según legacy.
2. **Participación sin aciertos y multicuenta** (AV), agravado por la autoconfirmación (F77).
3. **Corrección tras reclamo:** no se paga la diferencia al subir ni se retira al bajar (AP).
4. **Liquidación de 2.0 manual** (el worker no liquida).
5. **Champions 2026 Playoffs** no publicable (aristas de perdedor) y, por autoridad legacy, nunca premiable por 2.0.
6. **Copia de seguridad solo local** (F78).

## CZ. Lo que requiere tu aprobación
1. **Champions 2026 Playoffs**: estructuralmente **NOT READY**; las 6 aristas de perdedor **no están verificadas** (la fuente no las publica).
   - El primer cierre es el **2026-10-07 05:00 UTC**: publicarlo antes exigiría aristas de admin no verificadas. Recomendación: no publicarlo antes de ese cierre, o publicarlo más tarde solo como clasificación.
   - En ningún caso tendría recompensas 2.0: es autoridad legacy.
2. **¿Siguen con derecho a recompensas legacy los eventos legacy?** Hoy sí (los 3 `LEGACY_V1`; solo `vlr-2976` está abierto, sin participantes). Decide si se cierran (estado `closed` del Pick'em legacy, sin tocar el histórico) o se dejan terminar con sus reglas.
3. **Antes de activar recompensas en un Pick'em FUTURO:**
   - Que sea de un evento sin Pick'em legacy, cosa que ya ocurre sola para eventos nuevos.
   - Que el cuadro sea válido.
   - Medidas contra la multicuenta en la participación (AV).
   - Aceptar el pasivo (peor caso 20.000 por jugador).
   - Nada técnico lo bloquea más allá de esas guardias.

## DA. Veredicto
Todos los gates reales en verde:
- lint (0 errores), tipos, 6119/6119;
- smoke 80/80;
- production:check sin fallos nuevos (solo F77/F78);
- regresión F81.2–F87.1 completa;
- cambio de cuenta 28/28;
- worker sano y sin tocar;
- salud, ready y logs limpios.

Estado final:
- Cabeza 0072; recompensas reales OFF; 0 Pick'ems publicados.
- Histórico legacy preservado; doble premio legacy/F87 imposible por diseño y probado.
- 2 usuarios, 2 admins.

F87.1 PICKEMS REWARD CUTOVER = GO
