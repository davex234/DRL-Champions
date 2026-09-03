# NEXUS · PROTOCOLO DE VALIDACIÓN HUMANA

> Hoja de trabajo del facilitador. Se imprime, se rellena una por participante y no se
> comparte con quien está probando.

---

## OBJETIVO

Validar **qué entiende y qué hace una persona que nunca ha desarrollado NEXUS.**

No se valida si el producto funciona —eso ya lo cubren 480 pruebas y la batería de verifies—
sino si **se entiende solo**. Son dos cosas distintas y solo una de ellas la puede responder
una persona.

---

## ANTES DE EMPEZAR

| Requisito | Detalle |
|---|---|
| **Versión** | La build **congelada** de F17D. Nadie toca el código durante toda la tanda |
| **Servidor** | `npm run build` + `npx next start -p 3001`. **NUNCA `npm run dev`** (ver §Por qué) |
| **Cuenta** | **Nueva y real**, creada por la propia persona en el registro. Sin sembrar nada |
| **Grabación** | Pantalla y audio, con consentimiento explícito y previo |
| **Participantes** | 5–10 personas que **no** hayan participado en el desarrollo |

**Reparto buscado**, porque cambia las respuestas: mitad conoce el Valorant competitivo y
mitad no; mitad ha jugado juegos de cartas y mitad no; y al menos un tercio en móvil (390 px).

### Por qué en producción y no en `dev`

Está medido, no es una manía: con `next dev` la misma auditoría da **P1 1–2**, y con
`next build` + `next start` da **0**. En desarrollo Next compila cada ruta la primera vez que
se pide (medido: `/tienda` entre 81 ms y 804 ms), y una transición que tarda se ve como
«he pulsado y no pasa nada». Además el primero de la tanda lo sufriría más que el último,
que es exactamente lo que rompe la comparación entre participantes.

---

## PROTOCOLO

### Lo único que dice el facilitador

| Momento | Frase, literal |
|---|---|
| Inicio | *«Esto es NEXUS. Adelante.»* — y silencio |
| A los 10 min, si no ha jugado | *«Juega una partida.»* |
| Después | *«Haz lo que harías si esto fuera tuyo.»* |
| Si se atasca más de 2 min | *«¿Qué estás intentando hacer?»* — **nunca** la respuesta |

> **Regla que no se rompe:** no se explica dónde está ninguna función **antes** de que la
> persona la encuentre. Si no la encuentra, ese es el hallazgo.

### Recorrido esperado (no se dicta; se observa si ocurre)

1. Entrar en NEXUS
2. Explorar libremente
3. Intentar entender qué es
4. Abrir sus sobres
5. Conseguir su primera carta
6. Explorar la colección
7. Intentar construir un mazo
8. Intentar jugar
9. Explorar torneos
10. Explorar Pick'ems
11. Explorar progreso / perfil

---

## LAS 10 PREGUNTAS · DESPUÉS de explorar, nunca antes

Se transcriben **con las palabras de la persona**. No se parafrasea ni se resume.

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Qué crees que es NEXUS? | |
| 2 | ¿Qué intentaste hacer primero? | |
| 3 | ¿Qué fue lo más fácil? | |
| 4 | ¿Qué fue lo más confuso? | |
| 5 | ¿Entendiste para qué sirven las cartas? | |
| 6 | ¿Entendiste para qué sirve el mazo? | |
| 7 | ¿Entendiste por qué podías / no podías jugar? | |
| 8 | ¿Entendiste Pick'ems? | |
| 9 | ¿Qué esperabas encontrar? | |
| 10 | ¿Qué cambiarías? | |

---

## REGISTRO DE LA SESIÓN

### Observado por el facilitador

| Qué | Valor |
|---|---|
| Tiempo hasta el primer sobre | |
| Tiempo hasta la primera carta | |
| ¿Encuentra la colección? | sí / no |
| ¿Intenta construir un mazo? | sí / no |
| ¿Consigue construirlo? | sí / no |
| ¿Intenta un duelo? | sí / no |
| ¿Termina el duelo? | sí / no |
| ¿Encuentra Pick'ems? | sí / no |
| ¿Hace una predicción? | sí / no |
| **Punto de abandono** | |
| Comentarios espontáneos | |

> Los **tiempos** y los **sí/no** de sobre, carta, mazo, duelo y Pick'em se confirman después
> contra la base de datos. Lo demás —encontrar, entender, abandonar— **solo lo ve el
> facilitador**: no existe telemetría que lo responda, y por eso hay una persona mirando.

### Confirmación desde la base de datos

Al terminar cada sesión:

```
npm run session:observe -- --user <nombre> --json
```

Devuelve la línea de tiempo real desde el alta: primer sobre comprado y abierto, primera
carta, primer mazo, primer duelo iniciado y terminado, primera recompensa, primer Pick'em y
primera predicción. Es **solo lectura**: no escribe nada ni altera la experiencia.

Ejemplo de salida (cuenta sembrada, no un participante):

```
primer sobre ABIERTO      21s
primera CARTA             21s
primer MAZO             3m 4s
primer DUELO iniciado   3m 10s
primer DUELO terminado  3m 54s
primer PICK'EM enviado  4m 29s
```

---

## LO QUE NO SE HACE

- **No se explica** dónde está nada antes de que lo encuentre.
- **No se cambia el producto entre participantes.** Si aparece un P0 a mitad de tanda, se
  **para la tanda** y se anota; no se parchea en caliente.
- **No se ayuda** salvo con la pregunta neutra («¿qué estás intentando hacer?»).
- **No se inventa** ningún resultado. Una casilla sin observar se deja **vacía**.
- **No se convierten los hallazgos en features** durante la tanda. Primero observar.

---

## AL TERMINAR LA TANDA

1. Clasificar cada hallazgo por **frecuencia** (cuántas personas de N) **antes** que por
   gravedad. Con 5–10 personas se cuentan incidencias, **nunca porcentajes**: esta muestra
   sirve para encontrar problemas, no para medir tasas.
2. Para cada problema repetido, determinar **antes de tocar nada** si es copy, navegación,
   jerarquía, feedback, onboarding, información, estado vacío o bug.
3. Corregir solo **P0/P1 o lo repetido y claramente demostrado**, y siempre **la causa más
   pequeña posible**.

---

## AVISO SOBRE EL CONTENIDO QUE VERÁN

- **Las cartas son reales**: 379 jugadores del roster VLR, 772 cartas, 0 sintéticas.
- **El torneo también**: `VCT 2026: EMEA Stage 2` está cargado con datos reales (16 equipos,
  84 jugadores, 60 partidos, 146 mapas, 1.460 filas de scoreboard).
- **Convive con un torneo DEMO** (`DRL Masters Madrid 2026`), que es el único con Pick'ems
  abiertos, porque el torneo real ya terminó y no queda nada que predecir.

Por eso se añade una pregunta extra, que **no se formula**: solo se anota si sale sola.

> **11 · ¿Menciona el torneo por su cuenta? ¿Distingue el real del demo?**
