# NEXUS VALORANT CARDS — Duel Gameplay · Product Preview

Documento de producto para enviar a colaboradores externos. **No es documentación técnica**: explica
el juego, no cómo está programado.

## Entregable

| archivo | qué es |
|---|---|
| **`NEXUS-Duel-Gameplay-Product-Preview.pdf`** | **El PDF final.** 32 páginas · 16:9 apaisado (1280×720 px) · listo para enviar. |
| `duel-gameplay.html` | Fuente editable del documento (el PDF sale de aquí). |
| `duel-showcase.json` | Datos reales usados por los mockups: dos mazos y tres partidas completas. |
| `preview/slide-NN.png` | Una imagen por diapositiva, para revisar sin abrir el PDF. |
| `fonts/*.woff2` | Las dos tipografías del documento, incrustadas en el PDF (SIL Open Font License). |

## Cómo se regenera

```bash
npm run duel-doc:fonts     # 0 · tipografías (una sola vez; luego funciona sin conexión)
npm run duel-doc:data      # 1 · datos reales, ejecutando el motor del juego
npm run duel-doc:build     # 2 · HTML
npm run duel-doc:check     # 3 · control de calidad
npm run duel-doc:pdf       # 4 · PDF + imágenes de revisión
```

El paso 3 falla si alguna diapositiva se desborda, recorta contenido, queda vacía, tiene texto por
debajo de 6 px o no cargan las tipografías. Las 32 pasan.

## Tipografías

**Rajdhani** para titulares y cifras —la misma tipografía display del juego— y **Barlow** para el
texto. Las dos van **incrustadas** en el PDF, así que se ve igual en cualquier ordenador y no
depende de conexión.

> Nota técnica: la tipografía de texto de la aplicación es Inter, pero Chrome **no la incrusta** al
> exportar a PDF —se comprobó familia por familia— y el texto caía a una fuente del sistema que
> además no se puede redistribuir. Barlow se incrusta correctamente, es de licencia libre y es un
> grotesco del mismo registro. La tipografía display, que es la que da carácter al documento, sí es
> la del juego.

## Qué contiene el documento

| # | Diapositiva | Sección |
|---|---|---|
| 1 | Portada — *From collection to competitive play* | — |
| 2 | Índice | — |
| 3 | El concepto: no gana quien tiene la carta más cara | 01 · El juego |
| 4 | **From collection to duel** — el recorrido completo | 01 |
| 5 | Anatomía de una carta | 02 · La carta |
| 6 | **The three combat stats** — Stronghold, Gamesense, Entryfrag | 02 |
| 7 | Quién puede pelear contra quién — tabla de enfrentamientos | 02 |
| 8 | Mi mazo — 10 cartas, composición y cobertura de ejes | 03 · El mazo |
| 9 | Mazo válido y mazo inválido | 03 |
| 10 | Home · punto de entrada a Duelos | 04 · El duelo |
| 11 | Mis mazos | 04 |
| 12 | Constructor de mazo | 04 |
| 13 | **Choose your opponent** — EASY / NORMAL / HARD | 06 · El oponente |
| 14 | Información oculta: las mismas reglas para los dos | 06 |
| 15 | Pantalla de preparación | 04 |
| 16 | La pantalla de duelo | 04 |
| 17 | Paso 1 · eliges la carta | 04 |
| 18 | Paso 2 · declaras la estadística | 04 |
| 19 | Paso 3 · responde el rival | 04 |
| 20 | **The duel moment** — la revelación | 04 |
| 21 | Resultado del turno (incluye un empate real) | 05 · Las reglas |
| 22 | Diez turnos, una partida entera | 04 |
| 23 | El marcador | 04 |
| 24 | El flujo de una partida | 05 |
| 25 | Cómo se gana y cómo se empata | 05 |
| 26 | Victoria · Derrota · Empate | 07 · El resultado |
| 27 | Repetición de la partida | 07 |
| 28 | Cómo está montado por dentro (única página técnica) | 08 · El plan |
| 29 | **What is already built** | 08 |
| 30 | **Next — gameplay experience** (Fase 8) | 08 |
| 31 | **Not in this phase** | 08 |
| 32 | Cierre — *The next step* | — |

## Mockups e imágenes

Todas las imágenes se **generan** dentro del documento (HTML + CSS + SVG). No hay capturas de
pantalla externas ni assets descargados.

### Pantallas de la aplicación (marco de móvil, con la estética real del juego)

| # | Mockup | Diapositiva |
|---|---|---|
| 1 | Home / entrada a Duelos | 10 |
| 2 | Mis mazos | 11 |
| 3 | Constructor de mazo | 12 |
| 4 | Selección de dificultad | 13 |
| 5 | Pantalla de preparación | 15 |
| 6 | Pantalla principal del duelo | 16 |
| 7 | Selección de carta | 17 |
| 8 | Selección de estadística | 18 |
| 9 | Carta del rival (boca abajo) | 19 |
| 10 | Momento de enfrentamiento | 20 |
| 11 | Resultado del turno | 21 |
| 12 | Historial de turnos | 22 |
| 13 | Marcador | 23 |
| 14 | Resultado final (Victoria / Derrota / Empate) | 26 |
| 15 | Replay | 27 |

### Cartas

Las cartas se dibujan con **la misma anatomía que el renderizador del juego**: proporción 5:7, borde
y degradado de la paleta de la variante, OVR arriba a la izquierda, rol, país, equipo, nombre,
etiqueta de variante y trío de combate.

- **Jugadores, equipos, variantes, OVR y estadísticas son datos reales del catálogo** (VCT-2026).
- **No hay fotografías de jugadores.** El proyecto no tiene artwork autorizado (`public/players/`
  solo contiene un README), así que se usa **exactamente la misma silueta con iniciales** que la
  aplicación muestra cuando falta la foto. No se ha descargado ninguna imagen protegida.
- Los logos de equipo se representan con el monograma y el color de marca, igual que hace la app
  cuando no hay logo.

### Diagramas

| Diagrama | Diapositiva |
|---|---|
| Recorrido *From collection to duel* | 4 |
| Tabla de enfrentamientos SH ⟷ EF · GS ⟷ GS | 7 |
| Flujo completo de una partida, con el bucle de 10 turnos | 24 |
| Escalera de desempates hasta DRAW | 25 |
| Arquitectura en una página | 28 |

## De dónde salen las cifras

Ningún número está escrito a mano. `duel-showcase.json` se genera ejecutando el motor real
(constructor de mazo → orquestador de turnos → resolutor de combate → bot NORMAL) y contiene:

- **Mazo propio** — 10 cartas reales, Σ OVR 901, composición 2 por rol.
- **Mazo rival** — 10 cartas reales, Σ OVR 879.
- **Mazo inválido** — los errores los produce la validación real del dominio (4 Duelistas, 0 Flex).
- **Partida de victoria** — 5-4, con un empate de turno auténtico (dos Gamesense de 99).
- **Partida de derrota** — 4-6.
- **Partida de empate** — 5-5 con mazos idénticos: medias 901-901 y estadística total 837-837.

Las partidas de las diapositivas 16 a 27 son **la misma partida real**, contada turno a turno.

## Lo que el documento marca como no decidido

Aparecen etiquetados como `POR DEFINIR` o `POSTERIOR A ESTA FASE`, nunca como implementados:

química del mazo · recompensas del duelo · abandono y rendición · PvP · emparejamiento ·
tiempo real · economía del duelo · mercado · modo Draft · compartir repeticiones.

## Reglas respetadas

- No se ha modificado la aplicación: ni interfaz, ni dominio, ni base de datos, ni cartas.
- Todo lo añadido vive en `scripts/duel-doc-*` , `scripts/duel-deck-export.ts` y `docs/product/`.
- Las reglas mostradas son las cerradas en las Fases 1-7. No se ha inventado ninguna regla nueva.
- El documento no reproduce interfaces de Riot ni usa assets protegidos.
