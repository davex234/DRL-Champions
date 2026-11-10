# F86.2 — Closed Alpha · preparación para jugadores reales

- **Fecha:** 2026-10-05
- **Base:** `drl-0.1.1-1-a719bcd7` (F86.1)
- **Release:** **`drl-0.1.1-1-7cee7857`**. La primera publicación de F86.2, `889a7535`, quedó sustituida por esta.
- **Migración:** **0070_alpha_feedback** aplicada. La cabeza real es **0070**.
- **Runbook para la organización:** [`closed-alpha-runbook.md`](closed-alpha-runbook.md).
- **Evidencia:** `docs/product/qa/alpha/`
  - `alpha-e2e.json`
  - `shots/` (recorrido y 54 capturas 1440/1024/390 × normal/reducido)
  - `apply-0070.txt`

> Esta fase es **preparación**. No hay humanos todavía: nada de lo que sigue es una opinión, ni una métrica de
> retención o de comprensión. Todo es **mecánica comprobada** con cuentas QA. La alpha **no ha empezado**, no se ha
> contactado a nadie y el torneo de la alpha está en **borrador**.

---

## 1. Auditoría: qué se encontró

Lo auditado con el código real: portada, registro, guía F63, sobres, colección, equipos, partida rápida, ranked,
social/#TAG, torneos, Sala de Trofeos, navegación, perfil, errores y observabilidad. Lo que bloquearía a una persona
que entra sin ayuda:

| # | Bloqueo | Evidencia | Arreglo |
|---|---|---|---|
| B1 | La portada sin sesión no tenía ningún acceso visible a crear cuenta o entrar. Solo existía al fondo de «Más opciones». | `MainMenu` sin CTA; `/` es inmersiva, sin barra | «Crear cuenta» (→ `/cuenta?registro=1`, abre la pestaña de registro) y «Ya tengo cuenta · Entrar» a la vista |
| B2 | Registro con el nombre vacío: el alta (`handle_new_user`) usaba la **parte local del correo** como nombre público. | trigger de 0011 | Nombre obligatorio (3–16, sin «@», sin espacios) y contraseña ≥ 8 en el cliente, con mensajes claros |
| B3 | En `/packs/inicial` sin sesión, «Inicia sesión» era un botón **desactivado**: una llamada muerta. | `PackPurchaseCta` | Ahora es un enlace a la cuenta |
| B4 | El jugador no veía su propio #TAG en Social, que es donde se usa. Solo estaba en el perfil y sin explicación. | `SocialHub` | «Tu tag» en la cabecera de Social, copiable, con su para qué (`selfTag` desde el servidor) |
| B5 | Un tag pegado **sin «#»** se buscaba como nombre y no encontraba a nadie. | `searchPlayers` | Coincidencia exacta del tag primero, luego los nombres |
| B6 | La pantalla de campeón decía «Tu trofeo ya está en tu Sala de Trofeos» sin enlace, y la Sala no está en ningún menú. | `ChampionMoment` | «Sala de Trofeos» es un enlace |
| B7 | Partida rápida: en un 409 (jugada vencida o estado viejo) o al retomar con F5 una partida que el reloj terminó, la vista llegaba sin `context` y se enseñaba el resultado **completo**, con progreso, en vez del mínimo. | `duels.ts` | `withContext` en esos tres caminos |
| B8 | Al empezar un duelo o jugar un turno, el error crudo podía llegar a la pantalla (p. ej. «Error 502» o texto de la BD). | `duelos/jugar` | Pasa por `playerMessage` |
| B9 | Desde la portada no se llegaba a Torneos, Competitivo ni Mi perfil, y «Perfil y ajustes» llevaba a la cuenta. | `MoreMenu` | Añadidos «Competitivo», «Torneos» y «Mi perfil»; «Cuenta y ajustes»; «Dar feedback» |
| B10 | No había forma de recoger feedback humano. | sin tabla, API ni página | 0070 + `/feedback` + `/admin/alpha` |

El resultado mínimo de la partida rápida **ya existía** (desplegado en `1a261ed8`). Se ha validado y se ha cerrado
el hueco B7.

**Observación de UX, no bloqueo.** La primera partida de la guía termina en el resultado mínimo de la rápida, que no
tiene el botón de la guía. Una persona sale con «Volver al menú principal» y la portada retoma la guía («Continúa tu
inicio · paso 6/6»). Es un clic más; comprobado en producción, onboarding COMPLETED. Se deja así porque el resultado
mínimo no debe mostrar progreso.

## 2. Feedback y embudo (0070)

### Feedback

- **Dónde:** `/feedback`, con siete preguntas opcionales:
  - qué costó entender;
  - en qué momento no sabías qué hacer;
  - qué gustó más;
  - qué gustó menos;
  - si hubo algún error, y su descripción;
  - del 1 al 10, si volverías;
  - comentario libre.
- **Envío idempotente:** la clave de envío la genera el formulario. Un doble clic, dos pestañas o un reintento dan una
  sola fila.
- **Borrador:** se guarda por cuenta en el navegador, así que un F5 no lo pierde.
- **Sin red:** dice que no se ha enviado; nunca muestra un éxito falso.
- **Privacidad:**
  - RLS sin políticas y sin privilegios para clientes;
  - append-only, con tope de 30 envíos por cuenta;
  - ni correo, ni IP, ni adjuntos;
  - el usuario lo pone el servidor desde la sesión.
- **Accesos:** «Dar feedback» en el menú (armazón y portada) y una invitación al terminar tu torneo. Sin modales.

### Panel `/admin/alpha` (solo administradores)

- **Feedback:** nombre + #TAG, fecha, origen y respuestas. **Nunca el correo.** Las cuentas de prueba están ocultas
  por defecto.
- **Embudo:** `app_alpha_funnel(desde)` responde con **datos que ya existían**, sin eventos nuevos:
  - libro de créditos;
  - `economy_ops`;
  - `duel_decks`;
  - `duel_matches` (rápida = PvE sin intento de campaña);
  - cola ranked;
  - amistades y retos;
  - inscripciones y cruces de torneo;
  - feedback.

  Excluye administradores y cuentas de prueba (correo `@example.invalid` o nombre «qa…»).
- **Limitaciones del embudo:**
  - Una partida rápida abandonada no deja fila.
  - Abrir la pantalla de Ranked sin entrar en la cola no cuenta.

## 3. Torneo de la alpha

- `valorosters-closed-alpha-cup` («Valorosters Closed Alpha Cup»): **BORRADOR, no listado**, máximo 8, mínimo 4,
  ventana de 90 min. Las **fechas son provisionales** (2 nov): el runbook explica cuáles elegir antes de publicar.
- **Limitación conocida:** «No listado» oculta el torneo del hub, pero **no** restringe la inscripción a quien tenga el
  enlace. No se ha construido un sistema de invitaciones, porque el brief no lo pedía y no existía. El procedimiento
  controlado está en el runbook: publicar tarde, con la inscripción abierta poco tiempo y el máximo en 8.
- **Valorosters Open #1** sigue en **BORRADOR**.

## 4. F82: instrumento repetible

- **Antes: 64/71.** Fallaban 6 comprobaciones que dependían del reclamo de un solo uso de QA K (Eternal Fire, ya
  reclamado el 2026-10-03), más la cabeza fijada en `0062`.
- **Ahora:**
  - En cada ejecución se registra una **cuenta QA nueva** por el formulario real.
  - Una QA con admin **temporal** le concede, por el camino canónico y auditado (`/api/admin/users` → grant →
    `award`), las cartas que pide el set, y se revoca el admin enseguida.
  - El reclamo con doble clic más 6 reclamos API en paralelo da **exactamente uno**.
  - La cabeza pasa a comprobarse como «≥ 0062 y sonda `collections` en verde».
- **Comprobación obsoleta reescrita:** «insignia destacada visible en el perfil» dejó de ser cierta con Profile 2.0,
  donde el perfil es una tarjeta de identidad sin vitrina. Ahora comprueba la tarjeta simple, y la insignia destacada
  se sigue validando por la API del perfil.
- **Lo que no se ha tocado:** el reclamo histórico de QA K ni su insignia (sigue habiendo 1 de K).
- **Resultado:** 74/74 en producción, y de nuevo 74/74 tras el despliegue final, con otra cuenta nueva.

## 5. Pruebas en producción

| Prueba | Resultado |
|---|---|
| Alpha E2E (`_f862-alpha-e2e.mts`, cuentas QA nuevas + A–G) | **142/142** sobre `889a7535`. Sobre la release final `7cee7857`: **128/128** antes de que Claude Code detuviera la ejecución por falta de memoria del PC (no por un fallo); el bloque de aislamiento se comprobó después por SQL de solo lectura (todo 0). |
| F81.2 | **72/72**. Hubo dos fallos aislados y distintos en reintentos previos: un 502 del túnel en `/api/telemetry` (keepalive, conocido) y un test de tiempo en `/tienda` con la máquina sin memoria. Ninguno toca F86.2. |
| F82 | **74/74 ×2** (repetible; antes 64/71) |
| F83 | **40/40** |
| F84 | **52/52** |
| F85 | **92/92** (anti-spam intacto) |
| F86.1 (torneo con dos navegadores) | **37/37**: detección de la partida 2,48 s, foco 652 ms. Un intento previo cayó porque el instrumento pulsaba JUGAR de W antes de que su panel cargara. Se endureció (comprueba que el «listo» llega, sin relajar nada) y se añadió limpieza garantizada al salir. |
| Smoke | **80/80** |
| production:check | 27 PASS · 1 WARN (F77) · 4 FAIL (F78, excluido): igual que la línea base. Las cabezas de app y BD = 0070 |
| Suite / tipos / lint / build | 6058/6058 · 0 · 0 errores (26 avisos previos) · OK |

## 6. Release

- **Contenido:** `drl-0.1.1-1-a719bcd7` + overlay F86.2. 44 ficheros: 13 añadidos, 31 modificados y 0 borrados. Están
  enumerados en `/tmp/f862/{added,modified}.txt` del VPS.
- **Frontera comprobada:** `BOUNDARY_OK`, y los 9 ficheros F78 son idénticos a los de producción.
- **Lo que queda fuera:** los rollback antiguos (0061–0068) que solo existen en local y los instrumentos `_`.
- **Rollback:**
  - App: `bin/deploy.sh --activate drl-0.1.1-1-a719bcd7`. La release anterior funciona con 0070 aplicada, porque
    0070 es aditiva.
  - BD, si de verdad hiciera falta: `docs/operations/rollback/0070_alpha_feedback.ROLLBACK.sql`. Borra el feedback;
    expórtalo antes.
  - Backup previo: `/opt/nexus/backups/supabase-drlcards/pre-0070/backup_pre_0070_20261005T182853Z.dump`.

## 7. Riesgos y observaciones

- **«No listado» no es una invitación.** El enlace basta para inscribirse; por eso el runbook pide publicar tarde,
  con la inscripción abierta poco tiempo y el máximo en 8. No se ha construido un sistema de invitaciones.
- **Recuperación de contraseña (F77, sin tocar).** Está configurada (Resend, URLs de valorosters.com), pero NO se ha
  probado. El registro no la necesita (autoconfirmación ON). A los testers se les pide una contraseña que recuerden.
- **Primera partida de la guía.** Termina en el resultado mínimo de la rápida: un clic más para volver a la guía por
  la portada. Es una observación de UX que medirán los humanos.
- **Ranked con 4–8 personas.** Hace falta que dos busquen partida a la vez; que no coincidan es normal.
- **Embudo.** Una partida rápida abandonada no deja fila, porque el motor borra la partida PvE abandonada.
- **Partidas PvP abandonadas.** Quedan con `status = IN_PROGRESS` y `closed_reason = ABANDONED`. Es la forma que ya
  tenía el motor: 19 de torneos QA y 10 de duelos privados anteriores. Están cerradas; no es una partida colgada.
- **QA en producción.** Quedan torneos `qa-f86*` (COMPLETED o CANCELLED, no listados), cuentas `@example.invalid` y 3
  feedback QA, ocultos por defecto en el panel y en el embudo. No se borran.
- **Cabecera del panel admin.** Enseña el correo del propio administrador conectado; es el armazón del panel (F58),
  no el feedback.
- **Memoria del PC.** Las suites de navegador son pesadas: una ejecución la detuvo Claude Code por falta de memoria.
  No se relanzó automáticamente.
