# Closed Alpha · guía para dirigir la prueba

Esta guía es para ti (la organización), no para quienes prueban. Todo se hace desde la web y el panel `/admin` con tu
cuenta de siempre. **No hace falta tocar la base de datos ni ejecutar comandos.**

El objetivo es **ver si Valorosters se entiende solo**. Por eso a quien prueba no se le explica cómo funciona: solo
recibe el enlace y juega.

> Estado al preparar esta guía (5 oct 2026): la alpha está **lista, pero sin empezar**. El torneo «Valorosters Closed
> Alpha Cup» existe en **BORRADOR**: nadie lo ve y nadie puede inscribirse hasta que tú lo publiques.

---

## ANTES DE LA PRUEBA

1. **Elige 4–8 personas** y el día y la hora. Lo ideal es una tarde en la que puedan jugar a la vez durante 1–2 horas:
   el torneo necesita que los dos rivales de cada cruce estén conectados al mismo tiempo.
2. **Comprueba que la web está bien.** Abre <https://valorosters.com> en una ventana privada. Debes ver la portada con
   **«Crear cuenta»** y **«Ya tengo cuenta · Entrar»**.
3. **Prepara el torneo** (sección «Cómo preparar el torneo»). Déjalo **sin publicar** hasta que todos tengan cuenta.
4. **Ten a mano el mensaje para los testers** (sección «Qué decir a los testers»).

## QUÉ ENLACE MANDAR

- **Primero solo este:** <https://valorosters.com>. Cada persona crea su cuenta y empieza a jugar.
- **El del torneo, más tarde**, cuando lo publiques: `https://valorosters.com/copas/valorosters-closed-alpha-cup`.
  - El torneo está como **«No listado»**: no aparece en la lista de torneos y solo entra quien tiene el enlace.
  - **Ojo:** «No listado» **no** es una invitación cerrada. Cualquiera que reciba el enlace podría inscribirse. Por
    eso:
    - mándalo solo a los testers;
    - publícalo con la inscripción abierta poco tiempo (30–60 min);
    - deja el máximo en 8.

## QUÉ DECIR A LOS TESTERS

Mensaje listo para copiar:

> ¡Hola! Estoy probando **Valorosters**, un juego de cartas competitivo inspirado en Valorant, y me ayudaría mucho que lo
> probaras.
>
> Entra en **https://valorosters.com**, créate una cuenta y juega como lo harías normalmente. **No te voy a explicar nada
> a propósito**: quiero ver si el juego se entiende solo.
>
> Si algo no lo entiendes o te atascas, **no me preguntes de primeras**: apúntalo, porque justo eso es lo que quiero
> descubrir. Cuando termines, cuéntamelo desde **«Dar feedback»** (en el menú) o en
> https://valorosters.com/feedback.
>
> Más tarde te pasaré el enlace de un pequeño torneo entre los que estamos probando. ¡Gracias!

Cuando publiques el torneo:

> Ya está abierto el torneo de la prueba: **https://valorosters.com/copas/valorosters-closed-alpha-cup**. Entra e
> inscríbete. Cuando te toque, pulsa JUGAR y espera a tu rival.

## QUÉ NO DECIRLES

- Cómo se juega, cómo se arma un equipo o qué significan las cartas: es justo lo que queremos medir.
- Que existe la guía del principio o dónde está cada cosa (Social, Torneos, Ranked…).
- Su #TAG ni dónde verlo: queremos saber si lo encuentran solos.
- No les prometas premios. El torneo de prueba solo da el trofeo de campeón.
- Contraseñas:
  - **Que usen una contraseña que recuerden.** El registro no necesita correo, y la recuperación de contraseña por
    correo **no se ha probado** en esta preparación.
  - Si alguien la olvida, lo más rápido es que cree otra cuenta.

## CÓMO PREPARAR EL TORNEO

1. Entra en <https://valorosters.com/admin> → **Torneos de jugadores** (`/admin/copas`).
2. Abre **«Valorosters Closed Alpha Cup»** (estado BORRADOR) → **«Editar borrador»**.
3. Revisa estos campos. **Las fechas puestas ahora son provisionales; cámbialas:**

   | Campo | Qué poner |
   |---|---|
   | **Abre la inscripción** | El momento en que mandarás el enlace del torneo. |
   | **Cierra la inscripción** | 30–60 min después. |
   | **Empieza (ronda 1)** | Igual que el cierre, o unos minutos después. |
   | **Ventana por ronda (minutos)** | Tiempo que tiene cada cruce para jugarse. Está en **90**. Si jugáis todos a la vez, 30–60 basta. Si no se juega a tiempo, el cruce queda «en revisión» y lo decides tú. |
   | **Mínimo de inscritos** | **4**. Si al cerrar hay menos, el torneo se cancela solo. |
   | **Máximo de inscritos** | **8**. Con 5, 6 o 7 personas, algunas pasan la primera ronda sin jugar (pase directo). |
   | **Visibilidad** | **No listado**. |

4. **«Guardar»**. Guardar no publica nada.
5. **«Vista previa»** para ver cómo quedará.
6. Cuando los testers ya tengan cuenta y estés listo: **«Publicar»**. Después de publicar, las fechas y los límites
   **ya no se pueden cambiar** (solo los textos). Si te equivocas: **«Cancelar torneo»** y crea otro con
   **«Nuevo borrador»**.

> **No publiques «Valorosters Open #1».** Sigue en borrador a propósito. La alpha usa solo la «Closed Alpha Cup».

## CÓMO VER SI ESTÁN INSCRITOS

- En `/admin/copas`, abre el torneo y mira el panel **«Inscritos»**. Cada persona aparece con su nombre y su **#TAG**,
  nunca con su correo.
- También puedes abrir el enlace del torneo: verás cuántos participantes hay.

## CÓMO GENERAR EL CUADRO

- **Se genera solo** cuando cierra la inscripción, la primera vez que alguien abre el torneo. Los cruces se ordenan por
  rating ranked, y quien no tiene rating cuenta como 1000.
- Si al cerrar no aparece, en `/admin/copas` pulsa **«Generar cuadro»**. El botón solo sale con la inscripción ya cerrada.
- Con menos inscritos que el mínimo, el torneo pasa a **«Sin el mínimo: el torneo se canceló»**. No hay campeón.

## CÓMO SABER SI UNA PARTIDA ESTÁ BLOQUEADA

- En `/admin/copas`, dentro del torneo, mira el panel **«Cruces por resolver»**.
- Allí aparecen los cruces cuyo plazo venció sin partida, o los que acabaron en empate exacto. **Nunca se decide por
  sorteo:** decides tú.
- Antes de resolver, pregunta a los dos jugadores qué pasó. Lo normal es que uno no estuviera en la pantalla del
  torneo. Para entrar en la partida, los dos deben pulsar **JUGAR** y quedarse esperando en esa pantalla.
- Que alguien esté «esperando a su rival» durante un rato es normal: está esperando a que el otro entre.

## CÓMO RESOLVER NO-SHOW

Caso: uno se presentó y el otro no, y venció el plazo de la ronda.

1. Abre el cruce en **«Cruces por resolver»** → **«Resolver»**.
2. Elige quién avanza.
3. **Escribe el #TAG exacto** de quien avanza, por ejemplo `#7K4M92X`. Así no te equivocas de persona.
4. **Escribe el motivo**, por ejemplo «No se presentó en el plazo». Es obligatorio y queda en la auditoría.
5. Si no se presentó ninguno de los dos: **«Los dos fuera»** y escribe `ELIMINAR A LOS DOS`.

## CÓMO RESOLVER EMPATE

Caso: la partida terminó en empate exacto (mismo marcador y mismos desempates).

1. El cruce aparece en **«Cruces por resolver»**.
2. Decide quién avanza con un criterio que puedas explicar. Por ejemplo, repetir la partida de palabra y que el
   perdedor la abandone, o un criterio acordado antes con los testers.
3. **«Resolver»** con el **#TAG exacto** y el **motivo**. Nunca se sortea.

## CÓMO VER EL CAMPEÓN

- Cuando se juega la final, el torneo pasa a terminado. La ficha del torneo muestra el **momento de campeón**: nombre,
  #TAG y trofeo.
- El campeón recibe su **trofeo** una sola vez. Lo ve en su **Sala de Trofeos**, a un toque desde la pantalla de campeón.
- En `/admin/copas` el torneo aparece como completado, con el campeón y la auditoría.

## CÓMO VER FEEDBACK

- Entra en `/admin` → **Closed Alpha** (`/admin/alpha`) → pestaña **«Feedback»**.
- Cada respuesta muestra:
  - quién la envió, con su nombre y **#TAG** (nunca el correo);
  - la fecha y desde dónde la envió (menú o torneo);
  - sus respuestas a las 7 preguntas.
- Solo lo ven los administradores. Ningún tester ve el feedback de otro, ni siquiera el suyo después de enviarlo.
- Los testers lo envían desde **«Dar feedback»** (menú) o desde la invitación al acabar su torneo.

## QUÉ DATOS RECOGER

En `/admin/alpha` → pestaña **«Embudo»**:

1. En **«Desde»**, pon la hora a la que mandaste el enlace.
2. Deja **sin marcar** «Incluir cuentas de prueba».

Verás cuántas cuentas nuevas llegaron a cada paso: sobres, equipo, partida rápida, ranked, social, amigos, torneo,
final y feedback. Debajo, cada persona con sus pasos.

- Son **hechos medidos en los datos**, no opiniones. Que alguien «abrió un sobre» no dice si lo entendió: eso lo
  cuenta su feedback.
- No cuenta administradores ni cuentas de prueba.
- Limitaciones:
  - Una partida rápida **abandonada** no deja rastro.
  - Abrir la pantalla de Ranked sin entrar en la cola no cuenta como «entraron en la cola ranked».
  - En Ranked hace falta que **dos** personas busquen partida a la vez. Con 4–8 testers puede que no coincidan, y es
    normal.

Además del panel, apunta tú:
- quién se atascó y dónde (lo que te cuenten);
- cuánto tardaron en empezar a jugar;
- si alguien te preguntó algo (eso es justo un fallo de la experiencia).

## QUÉ HACER AL TERMINAR

1. Comprueba en `/admin/copas` que el torneo terminó con campeón, o resuelve lo pendiente.
2. Pide a quien no lo haya hecho que envíe su feedback (`/feedback`).
3. Revisa `/admin/alpha` (feedback y embudo) y sácale captura o cópialo. El feedback se guarda en la base de datos y
   no caduca.
4. **No borres cuentas ni el torneo.** Se quedan como registro de la prueba.
5. Evalúa con los criterios de éxito de abajo. No los decide nadie por adelantado: salen de lo que digan y hagan las
   personas reales.

### Criterios para evaluar después

- **Críticos:**
  - no pudieron registrarse;
  - no consiguieron sobres o no los pudieron abrir;
  - no pudieron crear equipo;
  - no pudieron empezar una partida;
  - el torneo se quedó atascado;
  - alguien vio datos de otra cuenta;
  - la pantalla dijo algo falso.
- **Experiencia:**
  - no sabían qué hacer después;
  - no encontraron un modo de juego;
  - no entendieron las reglas del equipo;
  - no entendieron la espera del torneo;
  - no encontraron su #TAG;
  - no entendieron el resultado.
- **Interés** (solo lo que digan ellos):
  - quieren otra partida;
  - volverían (nota del 1 al 10);
  - lo que más les gustó;
  - lo que menos.
