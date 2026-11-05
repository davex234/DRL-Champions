# CAPTURAS COMPARABLES

Tres juegos de capturas, tomados con el mismo guion (`npm run visual:shots -- <etiqueta>`),
con la misma cuenta sembrada (70 cartas, 5 sobres, 80.000 créditos, 940 puntos, un mazo
guardado y una partida jugada) y en los mismos anchos: **1440×900** y, en las pantallas
donde más se juega, **390×844**.

| Carpeta | Qué es |
|---|---|
| `before/` | NEXUS **antes de la Fase 9.5**. El punto de partida: la web con temática gaming. |
| `after/` | NEXUS **después de la Fase 9.5**. Es, por tanto, **el ANTES de la Fase 9.6**. |
| `96-despues/` | NEXUS **después de la Fase 9.6**. Es, por tanto, **el ANTES de la Fase 10**. |
| `fase10-despues/` | NEXUS **después de la Fase 10**. Solo las pantallas que cambiaron. |
| `fase11-despues/` | NEXUS **después de la Fase 11**. Solo las pantallas que cambiaron. |
| `fase12-despues/` | NEXUS **después de la Fase 12**. Solo las pantallas que cambiaron. |
| `fase13-despues/` | NEXUS **después de la Fase 13**. Solo las pantallas que cambiaron. |
| `fase14-despues/` | NEXUS **después de la Fase 14**. Solo las pantallas que cambiaron. |
| `fase15-antes/` · `fase15-despues/` | El **primer día** de un jugador nuevo, antes y después de la Fase 15. |

Para comparar 9.6, el par es **`after/` → `96-despues/`**, fichero a fichero: los nombres
coinciden.

Para comparar la Fase 10, el par es **`96-despues/` → `fase10-despues/`**. Esa última
carpeta tiene **cinco ficheros y no cuarenta y tres**, a propósito: la Fase 10 fue de
sistemas, no de presentación, y guardar cuarenta capturas idénticas para enseñar cinco
cambios es llenar el repositorio de ruido. Las que cambiaron:

| Captura | Qué cambió |
|---|---|
| `01-inicio.png` · `01-inicio-390.png` | La tira **«Qué hacer ahora»**: los pasos que el servidor calcula con el estado real del jugador |
| `20-torneos.png` | El circuito pasa de listado a **escenario**: el torneo vivo, su partido en directo y sus predicciones abiertas |
| `22-eventos.png` | El **aviso de autoridad**: con cuenta, el evento local es de solo lectura y lo dice |
| `32-resultado.png` | La banda **«Has ganado»**: puntos de rango, créditos y XP que la partida acaba de pagar |

Y para la Fase 11, el par es **`96-despues/` → `fase11-despues/`** (la Fase 10 no tocó
ninguna de estas tres pantallas, así que el «antes» sigue siendo el de la 9.6). Tres
ficheros:

| Captura | Qué cambió |
|---|---|
| `10-inventario.png` | El **desguace de duplicados**: server-authoritative, con su importe y el desglose por carta. Antes el botón estaba deshabilitado con cuenta |
| `12b-mercado-global.png` | El **mercado entre jugadores** reescrito sobre `/api/game/market`. Estado real: escaparate abierto, comercio cerrado |
| `12c-mercado-escaparate.png` | El mismo escaparate **con listados**, para poder ver cómo se presenta una carta en venta. Los listados los crea la RPC real y se retiran al terminar |

> Nota sobre `12c`: con el comercio cerrado no publica nadie, así que el estado que un
> jugador ve hoy es el de `12b`. La captura con contenido existe porque, si no, la
> presentación de una carta en venta no aparecería en ninguna parte — y los datos son
> reales, creados por `app_market_list` y cancelados a continuación.

Y para la Fase 12, **`fase12-despues/`**. Seis ficheros, tres pantallas:

| Captura | Qué cambió |
|---|---|
| `01-inicio.png` · `01-inicio-390.png` | El vestíbulo con el **panel de evento en vivo**. A 1440 px queda por debajo del pliegue, y por eso está también la de abajo |
| `01b-inicio-evento.png` | **El panel entero**: los seis desafíos del conjunto internacional, lo que reparte el evento y cuánto le queda. Datos del evento real de la base de datos; el progreso lo calcula el servidor |
| `13-tienda.png` · `13-tienda-390.png` | La tienda ahora enseña **«Reparto real»** —medido con el motor, no los pesos declarados— y **para qué sirve cada sobre**, con su coste por carta y su advertencia |
| `18-perfil.png` | Los **cosméticos equipados**, por fin visibles: banderín junto al nombre, título debajo y marco alrededor del avatar |

> Los cosméticos de `18-perfil` se conceden con `app_grant_reward` y se equipan con
> `app_equip_cosmetic` —las RPC reales, que comprueban la propiedad—, no escribiendo
> `profiles.equipped` a mano. La captura recorre el mismo camino que un jugador.

> El «antes» de las tres sigue siendo el de la 9.6 (`96-despues/`): ni la Fase 10 ni la 11
> tocaron la tienda ni el perfil, y del vestíbulo la Fase 10 solo añadió la tira del ciclo,
> que ya está en `fase10-despues/01-inicio.png`.

Y para la Fase 13, **`fase13-despues/`**. Siete ficheros, cuatro pantallas:

| Captura | Qué cambió |
|---|---|
| `08-coleccion.png` | La colección, ahora con la **maestría** debajo del progreso por región |
| `08b-coleccion-maestria.png` | **El panel entero**: 77 conjuntos sobre las cartas que ya se tienen, ordenados por lo que se puede cobrar. Las dos insignias reclamables salen primero |
| `13-tienda.png` · `13-tienda-390.png` | **Prime ya no está a la venta** (dominado en todos los ejes medidos) y el sobre China dice que no tiene épicas ni legendarias |
| `18-perfil.png` | La **insignia de maestría** equipada, junto al título y el banderín |
| `21-pickems.png` · `21b-pickems-resultado.png` | Los **desafíos por partido**: cada partido trae ahora la pregunta de ganador y la de **resultado exacto**, con sus cuatro marcadores y el doble de puntos |

> El progreso de la maestría lo calcula el servidor contra `user_cards`, y las preguntas de
> resultado las genera el ciclo de Pick'ems real sobre el torneo sembrado. Nada está
> colocado para la foto.

Y para la Fase 14, **`fase14-despues/`**. Cuatro ficheros, dos pantallas:

| Captura | Qué cambió |
|---|---|
| `08-coleccion.png` · `08b-coleccion-maestria.png` | La colección y su maestría, sin cambios de diseño: se repiten porque el prestigio cuelga de ellas |
| `08c-coleccion-prestigio.png` | **El sumidero**: la vitrina de insignias mejoradas y las que se pueden mejorar, con su precio y su escalón |
| `18-perfil.png` | La **vitrina de prestigio** en la ficha del jugador, entre la identidad y las cartas |

> La siembra completa dos conjuntos de maestría concediendo sus cartas con `app_grant_cards`,
> cobra sus insignias con `claimMasteryTier` y compra un escalón con `buyPrestige` — las RPC
> y los servicios reales, que cobran de verdad. El «🪙 15.000 invertido» de la captura salió
> del saldo de la cuenta sembrada.

La Fase 15 es la primera que tiene **su propio «antes»**, y no reutiliza el de la 9.6.
El motivo es que audita algo que ninguna captura anterior enseñaba: **una cuenta recién
registrada**, con cero cartas y cuatro sobres sin abrir. Todas las capturas anteriores usan
una cuenta sembrada con 86 cartas y 940 puntos, con la que ninguno de estos problemas se ve.

| Captura | Qué cambió |
|---|---|
| `01-lobby-nuevo.png` | La tira «Qué hacer ahora» de un jugador del primer día. **Antes** le proponía primero hacer predicciones de un torneo sin tener ni una carta, y «Construye tu mazo» le mandaba a la Tienda. **Después** empieza por «Abre tus sobres» y el mazo apunta a Inventario |
| `04b-mazos-vacio.png` | El constructor con cero cartas. **Antes**: «Abre un sobre en la Tienda». **Después**: «tienes 4 sobres sin abrir en Inventario», con la cifra que da el servidor |

> Las dos las genera `npm run ftue:audit -- --shots <carpeta>`, que crea una cuenta real,
> la recorre y la borra. No se siembra nada: lo que se fotografía es exactamente lo que
> concede `handle_new_user`.

---

## Dos cosas que hay que saber al mirarlas

**1. Se toman con el movimiento REDUCIDO.** Chrome sin cabeza declara
`prefers-reduced-motion: reduce`, así que las capturas muestran cada pantalla en su estado
de REPOSO, no a mitad de una animación. Es lo que las hace comparables y estables —dos
juegos tomados en fotogramas distintos de la misma animación no se pueden poner uno al lado
del otro—, pero también significa que **de aquí no se juzga el movimiento**.

Las tres excepciones llevan `ceremonia` en el nombre (`34`, `35`, `36`) y se toman aparte
con el movimiento **activado**, porque de una ceremonia no se puede juzgar el reposo.

**2. Tres capturas del juego 9.5 no son lo que dicen.** En `after/`, los ficheros
`07-arena-reveal.png`, `32-resultado.png` y `33-replay.png` son **la misma imagen** que
`06-arena-turno1.png` —se ve en que pesan exactamente lo mismo—. El guion buscaba un botón
«Confirmar» y unos botones «Stronghold / Gamesense / Entryfrag» que no existen en la arena
(el de confirmar cambia de texto según el paso; las estadísticas se rotulan SH / GS / EF),
así que el bucle salía en la primera vuelta y las tres capturas se tomaban sin haber jugado
un solo turno.

Está corregido en la Fase 9.6 —ahora se usan los mismos selectores que `duel:e2e`, que sí
juega la partida entera—, pero **el «antes» de esas tres pantallas no existe**: no se puede
reconstruir sin volver al código de la 9.5.

---

## Regenerarlas

```bash
npm run dev                      # en otra terminal, en el puerto 3001
npm run visual:shots -- 96-despues
```

Hace falta la base de datos local en marcha (`npx supabase start`): el guion siembra una
cuenta real y las pantallas vacías no dicen nada sobre el diseño.
