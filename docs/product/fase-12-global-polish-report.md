# FASE 12 — NEXUS GLOBAL POLISH

> Pasada transversal de cohesión sobre las 17 zonas de jugador.
> Pregunta de control: *si un jugador entra en NEXUS y navega 15 minutos por todo el
> producto, ¿siente que está dentro del mismo videojuego?*

Rama `arch/stabilization` · sin commit · sin despliegue · 2026-09-06
Instrumento: `scripts/_fase12-audit.ts` (no forma parte de CI)

---

## 1. Estado

**FASE 12 — CERRADA.**

Ejecutada en el orden mandado: A (auditoría global) → B (user journey) → C (matriz) →
D (priorización) → E (implementación) → F (regression) → G (QA visual) → H (auditoría
final). No se saltó a E.

---

## 2. Radiografía global

Se midieron **17 zonas de jugador × 2 resoluciones** (390×844 y 1440×900) sobre la build
de producción servida en `127.0.0.1:3005`, con un usuario sembrado real (40 cartas,
640 puntos, 4200 XP, 18 000 créditos, región EMEA) para que ninguna pantalla midiera en
estado vacío.

Por cada zona el instrumento midió: primitivas del sistema en uso, chaflanes, cápsulas
(`border-radius` ≥ 999 px reales, calculadas, no por clase), `rounded-*` por clase,
`<select>` e `<input type=text>` nativos, controles propios por debajo de 44 px,
focalizables sin nombre accesible, barras con `role="progressbar"`, animaciones en bucle
infinito, errores de consola, tamaño real del H1, y el estado de la navegación
(`aria-current`).

**Lo que la radiografía encontró (1440, totales de las 17 zonas):**

| medida | antes |
|---|---|
| controles propios <44 px | **57** |
| `<select>` nativos en pantalla de jugador | **2** |
| clases `rounded-*` | 959 |
| cápsulas reales | 128 |
| barras con `role="progressbar"` | 43 |
| focalizables sin nombre | **0** |
| bucles de animación infinitos | **0** |
| errores de consola | 76 |
| tamaños distintos de H1 | **7** (30/44/46/52/54/84 px) |

El producto ya estaba mucho más cohesionado de lo que la pregunta de control sugería:
cero focalizables sin nombre, cero bucles infinitos, cero `overflow-x` horizontal en las
34 mediciones, `aria-current` correcto en 16 de 17 zonas y el mismo armazón
(`GameShell`) en las 17. Lo que quedaba roto era **el tamaño del dedo y dos pantallas
que no habían recibido el idioma de la casa**.

---

## 3. User journey auditado

Recorrido completo, en el orden en que un jugador lo vive, con las 17 zonas navegadas
seguidas en la misma sesión de navegador:

```
/ (hub)  →  /coleccion  →  /colecciones  →  /inventario  →  /tienda  →  /mercado
        →  /duelos  →  /duelos/mazos  →  /torneos  →  /pickems
        →  /entrenador  →  /entrenador/strats
        →  /cuenta  →  /logros  →  /ranking  →  /recompensas  →  /eventos
```

Lo que se sintió al recorrerlo:

- **El armazón nunca cambia.** Cabecera, navegación de 7 destinos y `<main>` idénticos
  en las 17 zonas. La sensación de "mismo juego" viene sobre todo de aquí y estaba bien.
- **La ruptura era `/colecciones`.** Al pasar de `/coleccion` (183 chaflanes, 5 placas)
  a `/colecciones` (0 chaflanes, 0 primitivas, 2 desplegables del sistema operativo) el
  jugador salía del videojuego y entraba en un formulario. Era la única pantalla del
  recorrido que se sentía de otro producto.
- **Los enlaces de sección eran inalcanzables con el pulgar.** "Ver todo →", "Ver más",
  "Centro de eventos →": el mismo gesto en ocho pantallas distintas, y en casi todas
  medía entre 12 y 19 px de alto.
- **El H1 no tenía una escala.** Siete tamaños distintos para el mismo papel. Dos
  pantallas (`/colecciones`, `/recompensas`) se quedaban en 30 px a 1440 mientras sus
  hermanas subían a 44.

---

## 4. Inconsistencias encontradas

Clasificadas como pide la Parte 30 — **A: intencional**, **B: deuda real**,
**C: accidente**:

| # | Inconsistencia | Alcance | Clase | Prioridad |
|---|---|---|---|---|
| I1 | `.nx-action` con `min-height: 32px` y `border-radius: 8px` | global (12 ficheros) | C | **P0** |
| I2 | 8 sobrescrituras locales `nx-action !min-h-[44px]` parcheando I1 | 7 ficheros | C | **P0** |
| I3 | `/colecciones` sin ninguna primitiva del sistema | 1 zona | C | **P0** |
| I4 | 2 `<select>` nativos en `/colecciones` | 1 zona | C | **P0** |
| I5 | Acciones de sección escritas a mano en `LobbyCircuit` (41×12 px) | hub | C | **P0** |
| I6 | "Centro de eventos →" en `/tienda` (97×12 px) | 1 zona | C | **P0** |
| I7 | "Ver más" de Maestría y Prestigio a 32 px | `/coleccion` | C | **P1** |
| I8 | `InstallBanner` con botones a 36 px y sin chaflán | transversal | C | **P1** |
| I9 | Barra de progreso de colección sin `role="progressbar"` | `/colecciones` | C | **P1** |
| I10 | Emoji `🎁` y glifo `✓` como icono en `/colecciones` | 1 zona | C | **P1** |
| I11 | Siete escalas distintas de H1 | 7 rutas en 30 px | C | **P1** |
| I12 | 352 `rounded-*` en `/coleccion` y 389 en `/mercado` | `Card3D` | **A** | — |
| I13 | Fichas del mapa a 34×34 px en `/entrenador/strats` | 1 zona | **A** | — |
| I14 | 143 404 de retratos de jugador | transversal | **B** | documentada |
| I15 | Enlaces en prosa por debajo de 44 px (7 casos) | 5 zonas | **A** | — |

Las clase A **no se tocaron** y se explican en §6.

---

## 5. Correcciones realizadas

Once correcciones, ninguna cosmética suelta. Todas de presentación.

### C1 — `.nx-action`: 32 → 44 px y la geometría de la casa · P0

`src/app/globals.css`. La clase que viste **todos** los enlaces de sección del producto
declaraba `min-height: 32px` y un `border-radius: 8px` — la única esquina redondeada que
quedaba en una primitiva del sistema.

```css
.nx-action {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px));
  padding-inline: 8px;
  margin-inline: -8px;
```

El `margin-inline` negativo compensa el relleno para que el enlace no se desplace
ópticamente: el objetivo táctil crece, la caja visual se queda donde estaba.

**Un solo cambio resolvió la mayoría de los 41 controles corregidos.** Ocho de las 17
zonas pasaron de tener controles por debajo de 44 px a tener cero sin tocar su fichero.

### C2 — Retirada de las 8 sobrescrituras locales · P0

Con la base correcta, los ocho `nx-action !min-h-[44px]` repartidos por `cuenta`,
`entrenador`, `entrenador/strats`, `ranking`, `recompensas`, `torneos/[id]` (×2) y
`torneos` eran parches de un problema ya resuelto. `grep 'nx-action !min-h'` → **0**.

### C3 — `LobbyCircuit`: dos acciones a mano → la clase del sistema · P0

Las dos acciones de sección del hub estaban escritas a mano y medían 41×12 px. Ahora
usan `className="nx-action"`, igual que las otras diez del producto.

### C4 — `/tienda`: "Centro de eventos →" · P0

97×12 px → `nx-action`. Era, junto con las dos del hub, uno de los cuatro fallos que
`ux:verify` arrastraba desde la Fase 8.

### C5 — `/colecciones`: la pantalla que no hablaba el idioma · P0

Reescritura **de presentación** completa. Ni una consulta, ni un cálculo de progreso, ni
una regla de reclamación cambió:

- Los dos `<select>` nativos → `Segmented`, la primitiva que existe exactamente para
  esto ("la alternativa honesta al `<select>` nativo, que en un juego se lee como un
  formulario", dice su propia documentación). Mismos filtros, mismos valores, mismo
  estado; deja de abrir una rueda del sistema operativo encima de la pantalla en móvil.
- Nuevo ayudante local `Campo`: sigue siendo un `<input>` nativo —lo que se escribe es
  texto— pero con la superficie hundida de la casa y 44 px de alto.
- La tarjeta de colección: `div` con `rounded-2xl` → `Piece`, con `tone="cyan"` cuando la
  colección está completa.
- El porcentaje → `Readout size="md"`, la cifra competitiva del sistema.
- La barra de progreso → `Recessed` con `role="progressbar"`, `aria-valuenow`,
  `aria-valuemin`, `aria-valuemax` y `aria-label`. Antes era un `div` con un ancho en
  línea: el avance de la colección no llegaba a un lector de pantalla.
- `🎁` y `✓ Reclamado` → texto llano y `Badge tone="info"`.
- El nombre de la colección era el enlace de la tarjeta y medía 23 px de alto → 44.
- El estado vacío y el de carga → `Plate` y `Loading` compartidos.
- H1 30 px → `clamp(28px,5vw,44px)`.

Resultado medido en la zona: primitivas 0 → 6, chaflanes 0 → 21, `rounded-*` 16 → 4,
`<select>` 2 → 0, controles <44 px 9 → **0**, barras semánticas 0 → 3, H1 30 → 44 px.

### C6 — `MasteryPanel` y `PrestigePanel`: "Ver más" · P1

32 px → `nx-clip-sm min-h-[44px]`. `/coleccion` bajó de 6 controles pequeños a 3.

### C7 — `InstallBanner` · P1

"Instalar" y "Cerrar" de 36 px a 44 y con el chaflán de la casa. Es el único elemento que
puede aparecer sobre cualquiera de las 17 zonas, así que su geometría es transversal.

### C8 — Unificación de la escala del H1 · P1

`text-3xl` (30 px fijos) → `text-[clamp(28px,5vw,44px)] … leading-none` en `carrera`,
`noticias`, `recompensas`, `colecciones`, `colecciones/[slug]`, `entrenador/equipos` y
`entrenador/partido`. Catorce rutas comparten ahora la misma escala fluida.

---

## 6. Qué NO se tocó

Y por qué. La Parte 30 pide preferir 10 correcciones importantes a 100 cosméticas.

**`Card3D` y sus ~740 `rounded-*` (I12, clase A).** El grueso de las clases redondeadas
del producto —352 en `/coleccion`, 389 en `/mercado`— no son 740 decisiones: son **una**,
tomada en `Card3D`, multiplicada por ~40 cartas en pantalla. Una carta de cromo tiene las
esquinas redondeadas porque una carta física las tiene. Cambiarlo no es pulido: es
rediseñar el objeto central del juego. Intencional, no tocado.

**Las fichas del mapa a 34×34 px (I13, clase A).** Los cinco tokens de rol en
`/entrenador/strats` son **objetos de juego** dentro de un SVG con coordenadas propias,
no controles de interfaz. Subirlos a 44 px cambiaría la escala táctica del mapa, que la
Fase 10 dejó deliberadamente como protagonista. Intencional, no tocado.

**Los 143 404 de retratos (I14, clase B).** La solución obvia —condicionar `PlayerPhoto`
a `player.image`— **rompería un flujo de trabajo documentado**: `public/players/README.md`
describe explícitamente "suelta un PNG llamado `{id}.png` y funciona". El componente pide
la imagen a propósito. Documentada como deuda, no tocada.

**Los enlaces en prosa (I15, clase A).** "Mis cartas", "Mercado", "Crea uno",
"Ir a Progreso": enlaces **dentro de un párrafo**, no botones. Darles 44 px de alto
rompería el interlineado del texto que los contiene. WCAG 2.5.8 exime explícitamente los
objetivos en línea dentro de un bloque de texto. Intencional, no tocado.

**Las deudas de la Parte 32.** Ninguna se auto-resolvió: el error de lint preexistente,
la columna `profiles.level` muerta, el avatar como dato de usuario, los assets ausentes,
el `EmptyState` compartido, los controles del armazón, el `Scoreboard` muerto, la ausencia
de deshacer/rehacer y la de silencio global. Todas siguen documentadas.

**Y las líneas rojas de siempre:** dominio, economía, APIs, base de datos, motores de
juego y reglas. Cero ficheros tocados en `src/domain`, `src/engine`, `src/app/api`,
`supabase/` y `src/data`.

---

## 7. Navegación

| medida | resultado |
|---|---|
| Enlaces de navegación por zona | 7 en las 17 zonas — **idéntico** |
| Zonas con `aria-current` correcto | **16 / 17** |
| Zonas con `overflow-x` horizontal | **0 / 34** mediciones |

**El destino activo por zona (medido, no supuesto):**

| ruta | destino marcado |
|---|---|
| `/` | *ninguno* |
| `/coleccion`, `/colecciones`, `/inventario`, `/mercado` | Colección |
| `/tienda`, `/eventos` | Tienda |
| `/duelos`, `/duelos/mazos`, `/torneos`, `/pickems`, `/entrenador`, `/entrenador/strats` | Jugar |
| `/cuenta`, `/logros`, `/ranking`, `/recompensas` | Progreso |

El agrupamiento es coherente en las 16: cuatro rutas de colección bajo "Colección", seis
de competición bajo "Jugar", cuatro de progresión bajo "Progreso". `/eventos` bajo
"Tienda" es discutible pero deliberado (los eventos venden pases).

**El hub (`/`) no marca ningún destino.** Es la única zona con `aria-current 0`. No es un
accidente: el hub no es uno de los 7 destinos, es la raíz desde la que se llega a ellos.
Se deja como está y se anota en §24 (D5) por si se quiere un destino "Inicio" explícito.

---

## 8. GameShell

El mismo armazón en las 17 zonas, sin excepción: `<header>` de cabecera, `<nav>` de 7
destinos (duplicada como barra inferior en móvil) y `<main>` con el contenido. La
detección del instrumento se hace con `!x.closest('main')`, así que todo lo que cuenta
como "armazón" está medido de verdad, no por una marca declarada.

Controles del armazón por debajo de 44 px: entre 2 y 5 según la zona, sin cambio
antes/después. **Es una deuda de la Parte 32 y no se ha tocado** — está en la lista
explícita de lo que no debía auto-resolverse.

El armazón es la razón principal por la que el producto ya pasaba la pregunta de control
antes de esta fase.

---

## 9. Visual system

| medida (1440, 17 zonas) | antes | después |
|---|---|---|
| Chaflanes (`clip-path` de la casa) | 900 | **961** |
| `rounded-*` por clase | 959 | **902** |
| Cápsulas reales (radio ≥ 999 px) | 128 | **126** |
| Zonas con 0 primitivas del sistema | **1** | **0** |

Las 17 zonas usan ahora al menos una primitiva de `src/components/ui/`. Antes había una
que no usaba ninguna (`/colecciones`).

Las 126 cápsulas restantes están concentradas en `/coleccion` (56) y `/mercado` (40): son
las insignias de rareza y los indicadores de estado de las cartas, decisión de `Card3D` y
de la ficha de carta. Clase A.

`Backdrop` sigue sin usarse en ningún fichero (0 usos). Anotada en §24 (D6): o se usa o se
retira, pero eso es una decisión de diseño, no de pulido.

---

## 10. Buttons

Un solo lenguaje: `NxButton` con variantes `primary` / `secondary` / `tertiary` / `ghost`
/ `danger` / `icon`, tamaños `sm` (34 px) / `md` (44 px) / `lg` (52 px) y acento
`primary` / `gold` / `cyan`. Con `href` renderiza un `Link`, así que un enlace que parece
botón **es** un enlace.

Para el enlace de sección —"ver más de esto"— la clase es `.nx-action`, ahora a 44 px y
con chaflán. Ese era el hueco real del sistema de botones y era el P0 de esta fase.

**Controles propios por debajo de 44 px, por zona (1440):**

| zona | antes | después | causa del arreglo |
|---|---|---|---|
| 01-home | 4 | **0** | C1 + C3 |
| 02-coleccion | 6 | 3 | C6 |
| 03-colecciones | 9 | **0** | C5 |
| 04-inventario | 4 | 2 | C1 |
| 05-tienda | 3 | **0** | C1 + C4 |
| 06-mercado | 4 | 2 | C1 |
| 07-duelos | 1 | 1 | — |
| 08-duelos-mazos | 0 | **0** | — |
| 09-torneos | 2 | **0** | C1 |
| 10-pickems | 2 | **0** | C1 |
| 11-entrenador | 2 | **0** | C1 |
| 12-entrenador-strats | 7 | 5 | C1 |
| 13-cuenta | 2 | **0** | C1 |
| 14-logros | 3 | 1 | C1 |
| 15-ranking | 2 | **0** | C1 |
| 16-recompensas | 2 | **0** | C1 |
| 17-eventos | 4 | 2 | C1 |
| **TOTAL** | **57** | **16** | **−72 %** |

**Los 16 que quedan, uno por uno:**

| zona | control | medida | clase |
|---|---|---|---|
| 12-strats | 5 fichas de rol del mapa | 34×34 | **A** — objeto de juego |
| 02-coleccion | 3 × "Insignia" | 63×32 | **B** — deuda D7 |
| 04-inventario | "Mis cartas", "Mercado" | 74×19, 64×19 | **A** — enlace en prosa |
| 06-mercado | "Mis cartas", "Inventario" | 63×16, 61×16 | **A** — enlace en prosa |
| 17-eventos | "Ir a Progreso", "Marcar todo como leído" | 103×35, 135×32 | **B** — deuda D7 |
| 07-duelos | "Crea uno" | 59×17 | **A** — enlace en prosa |
| 14-logros | "Reclamar" | 74×34 | **B** — deuda D7 |

Nueve de los dieciséis son clase A por diseño. Los siete restantes (D7) son controles
reales que merecen 44 px pero cuyo arreglo toca el interlineado de tres listas densas: se
documentan en lugar de forzarse en esta pasada.

---

## 11. States

`src/components/ui/States.tsx` exporta `Loading`, `ErrorState`, `EmptyState` y
`NeedsAccount`. Uso medido en el árbol:

| componente | ficheros que lo usan |
|---|---|
| Importan `States` | 19 |
| `<Loading>` | 18 |
| `<ErrorState>` | 16 |
| `<EmptyState>` | **6** |

`/colecciones` se ha sumado a los tres primeros en esta fase (antes tenía un párrafo
suelto para cargar y un `div` redondeado para el vacío).

La asimetría de `EmptyState` (6 usos frente a 18 de `Loading`) es la deuda ya
documentada en la Parte 32: muchas pantallas resuelven el vacío con una `Plate` propia
en lugar del componente compartido. **No se ha auto-resuelto**, está en la lista.

---

## 12. Loading

Un solo patrón: `<Loading label="…" />`, presente en 18 ficheros. Ninguna zona muestra un
texto de carga escrito a mano tras C5.

Ninguna de las 17 zonas quedó bloqueada en estado de carga durante la auditoría: las 34
capturas (17 zonas × 2 resoluciones) muestran contenido real, gracias al usuario sembrado.

---

## 13. Empty / Error

Los estados vacíos hablan el mismo idioma en las zonas medidas: título en la familia
condensada en versalitas + una línea de explicación de qué hay que hacer para llenarlo.
El de `/colecciones`, reescrito en C5, dice ahora *"Ninguna colección coincide — las
colecciones de torneo aparecen cuando un torneo se cierra; las de eventos están siempre
disponibles"*, en lugar del párrafo gris anterior.

El estado de error es `ErrorState` en 16 ficheros. No se encontró ninguna pantalla que
muestre un error crudo de red al jugador.

**Deuda pendiente (no tocada):** las 12 pantallas que resuelven el vacío con una `Plate`
propia en lugar de `EmptyState`. El resultado visual es correcto; la duplicación no.

---

## 14. Motion

| medida | resultado |
|---|---|
| Animaciones en bucle infinito | **0 / 34** mediciones |
| Ocurrencias de `motion-reduce:` en el árbol | 10 |
| Ficheros que consultan `prefers-reduced-motion` en JS | 10 |

Cero bucles infinitos en las 17 zonas es el dato relevante: no hay nada girando o
pulsando indefinidamente que canse en una sesión de 15 minutos. Las animaciones son de
transición (entrada, cambio de estado, revelado de sobre), no de ambiente.

La única transición añadida en esta fase es la de la barra de `/colecciones`, que usa
`transform: scaleX()` con `transition-transform duration-normal motion-reduce:transition-none`
— compositable y respetuosa con la preferencia.

---

## 15. Reduced motion

`globals.css` declara la regla general (línea 113) que colapsa `animation-duration` y
`transition-duration` a `0.01ms` para todo el árbol, más dos reglas específicas para
`.nx-card` / `.nx-sweep` (330) y `.nx-bloom` (516).

**Verificación medida** — cada zona renderizada dos veces, con y sin
`prefers-reduced-motion: reduce`, comparando longitud del texto, número de controles y
número de barras de progreso:

| zona | texto (con/sin) | controles | barras | veredicto |
|---|---|---|---|---|
| 01-home | 2160/2160 | 37/37 | 2/2 | **PASS** |
| 02-coleccion | 2528/2528 | 72/72 | 5/5 | **PASS** |
| 03-colecciones | 529/529 | 24/24 | 3/3 | **PASS** |
| 04-inventario | 574/574 | 18/18 | 0/0 | **PASS** |
| 05-tienda | 1691/1691 | 29/29 | 0/0 | **PASS** |
| 06-mercado | 3891/3938 | 134/134 | 0/0 | WARN |
| 07-duelos | 436/436 | 15/15 | 0/0 | **PASS** |
| 08-duelos-mazos | 336/336 | 15/15 | 0/0 | **PASS** |
| 09-torneos | 730/730 | 18/18 | 0/0 | **PASS** |
| 10-pickems | 1778/1778 | 31/31 | 2/2 | **PASS** |
| 11-entrenador | 2141/2141 | 36/36 | 0/0 | **PASS** |
| 12-entrenador-strats | 636/636 | 59/59 | 0/0 | **PASS** |
| 13-cuenta | 894/894 | 37/37 | 2/2 | **PASS** |
| 14-logros | 2957/2957 | 15/15 | 19/19 | **PASS** |
| 15-ranking | 861/861 | 19/19 | 1/1 | **PASS** |
| 16-recompensas | 916/916 | 16/16 | 1/1 | **PASS** |
| 17-eventos | 2160/2160 | 23/23 | 11/11 | **PASS** |

**16 / 17 PASS. Ningún contenido desaparece ni ningún control se pierde con el
movimiento reducido.**

El WARN de `/mercado` es honesto pero no es un fallo de movimiento: los controles
coinciden exactamente (134/134) y la diferencia está en 47 caracteres de texto y 12
nodos, que corresponden a las marcas de tiempo relativas del listado ("hace 3 min" →
"hace 4 min") entre las dos cargas. El mismo WARN aparecía antes de la fase con una
diferencia de 3 caracteres; es contenido no determinista, no una rama de renderizado.

**Nota metodológica importante:** el Chrome sin cabeza declara
`prefers-reduced-motion: reduce` **por defecto**. Todas las capturas de QA de esta y de
las fases anteriores son, por tanto, el renderizado con movimiento reducido. La rama con
movimiento se midió explícitamente forzando `no-preference`.

---

## 16. Accessibility

| medida (1440, 17 zonas) | antes | después |
|---|---|---|
| Focalizables sin nombre accesible | **0** | **0** |
| Barras con `role="progressbar"` | 43 | **46** |
| Controles propios <44 px | 57 | **16** |
| `<select>` nativos | 2 | **0** |
| Zonas con `aria-current` | 16/17 | 16/17 |

Las tres barras nuevas son las de progreso de colección en `/colecciones`, que ahora
anuncian `aria-valuenow` con el porcentaje real. Antes eran `div` con un ancho en línea:
invisibles para un lector de pantalla.

Cero focalizables sin nombre en 34 mediciones es el dato más sólido del producto y venía
así de las fases anteriores.

La suite de accesibilidad de la Fase 8 (`scripts/_fase8-a11y.ts`: teclado, movimiento
reducido, objetivos táctiles) sigue en **14/14**.

---

## 17. Responsive

Medido a 390×844 y 1440×900 en las 17 zonas:

| medida | 390 | 1440 |
|---|---|---|
| Zonas con desbordamiento horizontal | **0 / 17** | **0 / 17** |
| Controles propios <44 px | 16 | 16 |
| `<select>` nativos | 0 | 0 |
| Cápsulas | 125 | 126 |

Los mismos 16 controles pequeños en ambas resoluciones: no hay ningún control que se
encoja al bajar a móvil. La paridad 390/1440 en todas las métricas confirma que las
correcciones son de sistema, no de una resolución.

**El H1 y la escala fluida.** `clamp(28px,5vw,44px)` da 28 px a 390 y 44 px a 1440. Las
dos rutas que se quedaban en 30 px fijos a ambas resoluciones (`/colecciones`,
`/recompensas`) ahora acompañan al resto.

Tamaños de H1 medidos a 1440 después: 84 px (hub), 54 (logros), 52 (duelos, cuenta),
46 (coleccion, tienda, mercado), 44 (nueve zonas), 30 (entrenador/strats).
**No están unificados y no se ha forzado que lo estén**: el hub tiene un titular de
portada, `/entrenador/strats` tiene un titular deliberadamente compacto porque la Fase 10
dejó el mapa como protagonista, y los 46/52/54 son tratamientos de héroe de las fases
8–11. Lo que esta fase corrigió es la anomalía —dos pantallas por debajo de la escala
base— no la variedad intencional. Anotado en §24 (D8).

---

## 18. Performance

| medida (1440) | antes | después |
|---|---|---|
| Nodos DOM, mediana | 447 | 447 |
| Nodos DOM, máximo (`/mercado`) | 3669 | **3645** |
| Zonas con >1000 nodos | 2 | 2 |
| Errores de consola | 76 | **72** |

Ninguna corrección de esta fase añadió peso: la mediana de nodos es idéntica y el máximo
bajó ligeramente. `/colecciones` subió de 219 a 225 nodos (+6) al cambiar dos `<select>`
por dos `Segmented` de tres opciones cada uno — coste esperado y trivial.

Las dos zonas pesadas (`/coleccion` 3238, `/mercado` 3645) lo son por la misma razón:
~40 `Card3D` en pantalla. Es la carga real del producto, no un problema de pulido.

**Los 72 errores de consola son todos 404**, concentrados en las cuatro zonas que
muestran retratos de jugador: `/mercado` (57), `/coleccion` (10), `/cuenta` (3), `/` (2).
Es la deuda I14/D2 explicada en §6: `PlayerPhoto` pide el retrato a propósito porque el
flujo documentado es "suelta el PNG y funciona". Bajaron de 76 a 72 sin tocarlos, por la
variación de qué cartas entran en el listado.

---

## 19. Copy / idioma

Español consistente en las 17 zonas, con la voz de producto ya establecida: los títulos
de sección son afirmaciones cortas en versalitas y los estados vacíos explican **qué
hacer**, no qué falta.

Lo corregido en esta fase:

- `🎁 {recompensa}` → el texto de la recompensa, sin emoji decorativo.
- `✓ Reclamado` → `Badge tone="info"` con la palabra "Reclamado". El glifo `✓` hacía de
  icono y un lector de pantalla lo leía como "marca de verificación".
- *"Cargando colecciones…"* suelto → `Loading label="Cargando colecciones"`.
- *"No hay colecciones que coincidan. Las colecciones de torneo aparecen cuando un admin
  finaliza un torneo…"* → *"Ninguna colección coincide — las colecciones de torneo
  aparecen cuando un torneo se cierra…"*. El jugador no sabe qué es "un admin"; lo que
  necesita saber es cuándo aparecen.

No se ha reescrito ninguna otra cadena: la Parte 30 pide 10 correcciones importantes, no
100 cosméticas, y el resto del texto ya era correcto.

---

## 20. Matriz global

**PANTALLA × DIMENSIÓN** (1440×900, estado final)

Leyenda: NAV = armazón y `aria-current` · VIS = primitivas y geometría de la casa ·
RES = paridad 390/1440 sin desbordamiento · A11Y = objetivos táctiles, nombres y
semántica · MOT = bucles y movimiento reducido · EST = carga / vacío / error ·
PERF = nodos y errores de consola.

| pantalla | NAV | VIS | RES | A11Y | MOT | EST | PERF |
|---|---|---|---|---|---|---|---|
| `/` (hub) | WARN¹ | PASS | PASS | PASS | PASS | PASS | WARN² |
| `/coleccion` | PASS | WARN³ | PASS | WARN⁴ | PASS | PASS | WARN² |
| `/colecciones` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/inventario` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/tienda` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/mercado` | PASS | WARN³ | PASS | PASS | WARN⁵ | PASS | WARN² |
| `/duelos` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/duelos/mazos` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/torneos` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/pickems` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/entrenador` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/entrenador/strats` | PASS | PASS | PASS | PASS⁶ | PASS | PASS | PASS |
| `/cuenta` | PASS | PASS | PASS | PASS | PASS | PASS | WARN² |
| `/logros` | PASS | PASS | PASS | WARN⁴ | PASS | PASS | PASS |
| `/ranking` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/recompensas` | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `/eventos` | PASS | PASS | PASS | WARN⁴ | PASS | PASS | PASS |

**Cero FAIL en 119 celdas. 108 PASS, 11 WARN.**

1. El hub no marca ningún destino de navegación porque no es uno de los 7. Deuda D5.
2. 404 de retratos de jugador. Deuda D2, flujo documentado, no tocada.
3. Cápsulas y `rounded-*` de `Card3D`. Clase A, intencional.
4. Entre 1 y 3 controles reales por debajo de 44 px. Deuda D7.
5. Marcas de tiempo relativas no deterministas entre las dos cargas, no una rama de
   renderizado. Controles idénticos (134/134).
6. Las 5 fichas de 34 px son objetos de juego dentro del SVG, no controles. Clase A.

**Totales antes → después (17 zonas, 1440):**

| métrica | antes | después | Δ |
|---|---|---|---|
| Controles propios <44 px | 57 | **16** | **−72 %** |
| `<select>` nativos | 2 | **0** | **−100 %** |
| Zonas sin primitivas del sistema | 1 | **0** | **−100 %** |
| Clases `rounded-*` | 959 | 902 | −6 % |
| Chaflanes | 900 | 961 | +7 % |
| Cápsulas reales | 128 | 126 | −2 % |
| Barras con `role="progressbar"` | 43 | **46** | +7 % |
| Focalizables sin nombre | 0 | **0** | = |
| Bucles infinitos | 0 | **0** | = |
| Desbordamiento horizontal | 0 | **0** | = |
| Errores de consola | 76 | 72 | −5 % |

A 390 los números son los mismos (57 → 16, 2 → 0, 959 → 903, 43 → 46).

---

## 21. Tests antes / después

Batería completa ejecutada tras la implementación:

| suite | resultado |
|---|---|
| `npm test` | **696 / 696** |
| `typecheck` | limpio |
| `build` | OK |
| `lint` | 9 problemas (1 error preexistente, **sin cambio**) |
| `ux:verify` | **PASA** ← antes fallaba con 4 |
| `ux:scroll` | **38 / 38** |
| `audit:stability` | 105 · **P0 0 · P1 0 · P2 0** |
| `security:verify` | PASA |
| `collection:verify` | PASA |
| `pack:verify` | PASA |
| `card-generator:verify` | 50 / 50 |
| `materializer:verify` | 42 / 42 |
| `catalog-builder:verify` | 44 / 44 |
| `duel-gameplay:verify` | PASA |
| `duel:e2e` | PASA |
| `duel:playtest` | PASA · 0 errores de consola |
| `trainer:verify` | 35 / 35 |
| `maps:verify` | 14 / 14 |
| `strats:verify` | PASA |
| `tactical:verify` | PASA |
| `progression:verify` | PASA |
| `battlepass:verify` | PASA |
| `loop:verify` | PASA |
| `test:pickems` | PASA |
| `test:flow` | ✅ |
| `launcher:verify` | 33 / 33 |
| `_fase8-a11y` (instrumento) | 14 / 14 |

**El resultado más importante: `ux:verify` pasa.** Arrastraba cuatro fallos desde la
Fase 8 —"Ver todo" del hub (41×12) y "Centro de eventos →" de la tienda (97×12)— que se
resolvieron como efecto de C1, C3 y C4. No se tocó la suite: la suite dejó de fallar
porque el producto dejó de estar mal.

El error de lint restante es el preexistente documentado en la Parte 32 y no se
auto-resolvió.

---

## 22. QA visual

**68 capturas** en `docs/product/qa/fase12/`:

- `antes-390-{01..17}-*.png` y `antes-1440-{01..17}-*.png` — 34
- `despues-390-{01..17}-*.png` y `despues-1440-{01..17}-*.png` — 34

Cada zona, en cada resolución, antes y después, con el mismo usuario sembrado, para que
la comparación sea directa.

Acumulado de la serie: `qa/fase8/` (106), `qa/fase9/` (102), `qa/fase10/` (112),
`qa/fase11/` (106), `qa/fase12/` (68). **494 capturas.**

Recordatorio: por la declaración por defecto del Chrome sin cabeza, todas son el
renderizado con movimiento reducido.

---

## 23. Ficheros modificados

**13 ficheros, todos de presentación.**

| fichero | cambio |
|---|---|
| `src/app/globals.css` | `.nx-action`: 32 → 44 px, `border-radius` → chaflán, relleno 6 → 8 px |
| `src/app/colecciones/page.tsx` | Reescritura de presentación (C5) |
| `src/components/lobby/LobbyCircuit.tsx` | 2 acciones a mano → `nx-action` |
| `src/app/tienda/page.tsx` | "Centro de eventos →" → `nx-action`; retirada de override |
| `src/components/collection/MasteryPanel.tsx` | "Ver más" → 44 px + chaflán |
| `src/components/collection/PrestigePanel.tsx` | "Ver más" → 44 px + chaflán |
| `src/components/pwa/InstallBanner.tsx` | Botones 36 → 44 px + chaflán |
| `src/app/cuenta/page.tsx` | Retirada del override `!min-h-[44px]` |
| `src/app/entrenador/page.tsx` | Retirada del override |
| `src/app/entrenador/strats/page.tsx` | Retirada del override |
| `src/app/ranking/page.tsx` | Retirada del override |
| `src/app/recompensas/page.tsx` | Retirada del override + H1 fluido |
| `src/app/torneos/page.tsx` y `torneos/[id]/page.tsx` | Retirada de 3 overrides |

Más el H1 fluido en `carrera`, `noticias`, `colecciones/[slug]`, `entrenador/equipos` y
`entrenador/partido`.

**Instrumento creado:** `scripts/_fase12-audit.ts` — prefijado con `_`, no está en
`package.json`, no forma parte de CI. Como los de las fases 8–11.

**Cero ficheros tocados en:** `src/domain/`, `src/engine/`, `src/app/api/`, `supabase/`,
`src/data/`, `src/lib/economy*`, configuración global.

---

## 24. Deudas

**Nuevas de esta fase:**

| id | deuda | por qué no se resolvió aquí |
|---|---|---|
| D7 | 7 controles reales por debajo de 44 px: 3 × "Insignia" (`/coleccion`), "Reclamar" (`/logros`), "Ir a Progreso" y "Marcar todo como leído" (`/eventos`) | Subirlos rompe el interlineado de tres listas densas; requiere rediseñar la fila, no ajustar una clase |
| D8 | Seis escalas de H1 conviviendo (84/54/52/46/44/30 px) | Cuatro de ellas son tratamientos de héroe deliberados de las fases 8–11. Unificarlas es una decisión de diseño, no un arreglo |

**Heredadas, confirmadas y no auto-resueltas (Parte 32):**

| id | deuda | estado |
|---|---|---|
| D1 | `profiles.level` es columna muerta (todos a 1, incluso con 2567 XP) mientras el armazón deriva el nivel de `levelFromXp(xp)` | Requiere migración de BD. **No tocada** |
| D2 | 143 404 de retratos de jugador | El gate rompería el flujo documentado en `public/players/README.md`. **No tocada** |
| D3 | `EmptyState` compartido usado en 6 ficheros frente a 18 de `Loading` | **No tocada** |
| D4 | Controles del armazón (`GameShell`) por debajo de 44 px | **No tocada** |
| D5 | El hub no marca destino de navegación | **No tocada** |
| D6 | `Backdrop` con 0 usos en el árbol | **No tocada** |
| — | 1 error de lint preexistente | **No tocado** |
| — | Avatar como dato de usuario | **No tocada** |
| — | Assets ausentes | **No tocada** |
| — | `Scoreboard` muerto | **No tocado** |
| — | Sin deshacer/rehacer en el Entrenador | **No tocada** |
| — | Sin silencio global de audio | **No tocada** |

---

## 25. Riesgos

**Bajo.** Los cambios son de presentación y la mayor parte del efecto viene de una sola
declaración CSS.

| riesgo | evaluación |
|---|---|
| `.nx-action` a 44 px desplaza layouts | Mitigado por `margin-inline: -8px`: la caja visual no se mueve. Verificado en las 34 capturas |
| La reescritura de `/colecciones` cambia comportamiento | Ninguna consulta, cálculo de progreso ni regla de reclamación tocada. `collection:verify` pasa |
| `Segmented` con muchos torneos desborda en móvil | No aplica a `/colecciones` (3 opciones fijas). El caso con lista variable es `/ranking`, ya resuelto en Fase 11 con desplazamiento horizontal |
| Los 16 controles pequeños restantes | 9 son clase A por diseño, 7 documentados como D7 |
| Regresión silenciosa en las 17 zonas | 27 suites verdes, incluidas las 5 de recorrido completo (`duel:e2e`, `test:flow`, `loop:verify`, `duel:playtest`, `launcher:verify`) |

---

## 26. Regresiones

**Ninguna.**

- `npm test` 696/696, igual que antes.
- `typecheck` limpio, `build` OK.
- `lint` con los mismos 9 problemas y el mismo error preexistente: no se añadió ni se
  ocultó ninguno.
- `audit:stability` con P0 = P1 = P2 = 0.
- `ux:scroll` sigue en 38/38 y `trainer:verify` en 35/35: la retirada de los overrides en
  `entrenador/strats` no alteró el recuento de `[role="radio"]` que esa suite comprueba.
- Nodos DOM: mediana idéntica, máximo ligeramente inferior.
- Movimiento reducido: los mismos 16 PASS y el mismo WARN de `/mercado`, con la misma
  causa (marcas de tiempo), antes y después.

**Y una mejora que no se buscó directamente:** `ux:verify` pasa por primera vez desde la
Fase 8.

---

## 27. Veredicto

**FASE 12 — CERRADA.**

La pregunta era si un jugador que navega 15 minutos por NEXUS siente que está dentro del
mismo videojuego. La radiografía respondió que **casi**: el armazón, la navegación, los
estados, el movimiento y la accesibilidad ya eran coherentes en las 17 zonas —cero
focalizables sin nombre, cero bucles infinitos, cero desbordamientos, `aria-current` en
16 de 17—. Lo que rompía la ilusión eran dos cosas concretas: **una pantalla que hablaba
otro idioma** (`/colecciones`, con dos desplegables del sistema operativo y ninguna
primitiva de la casa) y **un tamaño de dedo equivocado repetido en ocho pantallas**
(`.nx-action` a 32 px).

Se corrigieron once cosas, no cien. La más importante fue una línea de CSS: subir
`.nx-action` a 44 px y darle el chaflán de la casa arregló por sí sola la mayoría de los
41 controles corregidos, permitió borrar ocho parches locales que existían solo para
tapar ese fallo, y como efecto lateral hizo pasar `ux:verify`, que llevaba fallando desde
la Fase 8.

Lo que no se tocó importa tanto como lo que sí. Las ~740 clases redondeadas de `/coleccion`
y `/mercado` no son 740 decisiones: son una, tomada en `Card3D`, porque una carta de cromo
tiene las esquinas redondeadas. Las fichas de 34 px del mapa táctico son objetos de juego,
no botones. Los 404 de retratos se resuelven en una línea que rompería un flujo de trabajo
documentado. Y las doce deudas de la Parte 32 siguen documentadas y sin auto-resolver,
como se pidió.

Resultado medido: **controles por debajo de 44 px −72 %** (57 → 16), **desplegables
nativos −100 %** (2 → 0), **cero zonas sin el lenguaje del sistema** (1 → 0), tres barras
de progreso que ahora se anuncian, y una matriz de 119 celdas **sin un solo FAIL**.
27 suites verdes, 696 tests, P0/P1/P2 en cero, cero regresiones.

Dominio intacto. Economía intacta. APIs intactas. Base de datos intacta. Motores
intactos. Sin commit y sin despliegue.

---

*Instrumento: `scripts/_fase12-audit.ts` · Capturas: `docs/product/qa/fase12/` ·
Fases previas: [8](fase-8-duelos-report.md) · [9](fase-9-torneos-pickems-report.md) ·
[10](fase-10-entrenador-report.md) · [11](fase-11-perfil-progresion-report.md)*
