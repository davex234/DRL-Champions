# INFORME — INTEGRACIÓN DE LOS 12 MAPAS EN EL ENTRENADOR

**Fecha:** 2026-09-03 · **Rama:** `arch/stabilization` · **Sin commit, sin push, sin deploy.**

Los siete tramos del audit están ejecutados. El recorrido completo del criterio de éxito
funciona: entrar en Entrenador, elegir Ascent, verlo sin deformar, crear una estrategia,
colocar jugadores, añadir utilidades, dibujar, crear pasos, guardar, salir, volver, abrir,
recuperar el estado exacto, revisarlo paso a paso y duplicarlo.

**Los doce PNG maestros están intactos**, comprobado por SHA-256 en cada ejecución de
`maps:verify`.

---

## 1 · ARCHIVOS

### Nuevos (9)

| Fichero | Qué es |
|---|---|
| `public/maps/*.png` (12) | Los assets, copiados **byte a byte**. Hash idéntico al maestro. |
| `src/components/tactics/MapCanvas.tsx` | El lienzo con cámara: `viewBox` derivado del mapa, zoom, rueda, pan, pinza y encuadre. |
| `src/components/tactics/MapPicker.tsx` | Selector de los 12, con miniaturas y carga diferida. |
| `src/components/tactics/UtilityGlyph.tsx` | Nueve glifos SVG propios (humo, destello, incendiaria, aturdidor, muro, información, spike, punto de ruta, marcador). |
| `src/app/entrenador/strats/revisar/page.tsx` | Modo presentación. |
| `scripts/maps-assets-verify.ts` | 14 comprobaciones: hashes, dimensiones, encuadres, rutas. |
| `scripts/trainer-ui-verify.ts` | 35 comprobaciones en navegador real: deformación, zoom, alineación, móvil. |
| `supabase/migrations/0028_strats_plan_size.sql` | Techo de 256 KB para el plan. **Opcional.** |
| `docs/product/trainer-maps-audit.md` | El audit aprobado. |

### Modificados (13)

`src/domain/tactics/maps.ts` (catálogo nuevo) · `src/domain/tactics/strat.ts` (formato 2) ·
`src/domain/tactics/tactics.test.ts` · `src/components/tactics/StrategyBoard.tsx` (capas) ·
`src/components/tactics/MapThumb.tsx` (PNG) · `src/lib/assets.ts` (`mapImageSrc`) ·
`src/lib/tactics/client.ts` (`duplicateStrat`) · `src/app/api/game/strats/route.ts`
(duplicar + tope) · `src/app/entrenador/strats/page.tsx` (editor) ·
`src/app/entrenador/mapas/page.tsx` (estudio) · `src/app/entrenador/page.tsx` (vestíbulo) ·
`scripts/strats-verify.ts` · `package.json` (3 scripts).

**Nada fuera del Entrenador y sus assets.** Motor de cartas, duelos, economía, packs,
marketplace, Pick'ems, progresión, importador VLR, generador y materializer: sin tocar.

---

## 2 · MIGRACIONES

**Una, aditiva y no imprescindible: `0028_strats_plan_size.sql`.**

Añade un `check (pg_column_size(plan) <= 262144)` a `user_strats`. Es el mismo techo que ya
aplica la ruta de servidor, puesto también en la base por el motivo de siempre: a PostgREST
se llega sin pasar por la aplicación, y las políticas de esta tabla dejan al dueño escribir
sus propias filas.

**No he añadido columnas** para `description` ni `tags`, aunque el audit las contemplaba.
Viven dentro del `plan`, saneadas por el dominio con todo lo demás, y sacarlas a columnas
habría creado dos fuentes de verdad para el mismo dato sin que ninguna consulta lo pidiera.
El día que haga falta filtrar por ellas, se desnormalizan entonces.

**No está aplicada:** esta máquina no tiene vía de DDL. **El Entrenador funciona sin ella**
—todo lo verificado en §5 corre contra la base tal como está hoy—, así que es endurecimiento
opcional, no un requisito.

Tampoco hizo falta migrar datos: `user_strats` tenía 0 filas.

---

## 3 · ARQUITECTURA

### 3.1 El catálogo, fuente única

`TacticalMap` gana `asset`, `width`, `height`, `frame`, `available`; `zones` pasa a
**opcional**. Los doce mapas con sus dimensiones reales, y una comprobación automática que
falla si alguien escribe una ruta `/maps/…` a mano fuera de `src/lib/assets.ts`.

`width`, `height` y `frame` son **medidas del fichero**, no dibujo nuevo: cabecera IHDR y
recuadro de los píxeles que difieren del color de fondo. `sites` está verificado mirando los
doce assets uno a uno (2 en todos salvo Haven y Lotus, que tienen 3).

### 3.2 El ratio, resuelto de raíz

Se acabó el `viewBox="0 0 100 100"` universal. Ahora el `viewBox` sale de las dimensiones
reales del mapa y `preserveAspectRatio="xMidYMid meet"` hace el ajuste: si el contenedor no
tiene la proporción del mapa sobra margen, **nunca se estira**. Hay un test que falla si
alguien «normalizara» los mapas a un cuadrado: comprueba que siguen existiendo al menos diez
proporciones distintas entre los doce.

Las coordenadas del dominio siguen en la rejilla 0..100; `toPixels`/`toGrid` traducen.

### 3.3 Las capas

```
ANOTACIONES
DIBUJOS
UTILIDADES
JUGADORES
MAPA PNG        ← capa visual base, intocable
```

Ese es literalmente el orden de los `<g>` dentro del `<svg>`. **Todas las capas comparten un
único `viewBox`**, así que no puede haber desalineación: no hay dos sistemas de coordenadas
que sincronizar, hay uno. El zoom mueve la cámara; el `<image>` no cambia ni un atributo.

### 3.4 El formato 2 de estrategia

Cada paso guarda su **estado táctico completo** —jugadores, utilidades, dibujos,
anotaciones—. Añadir un paso lo siembra con una **copia profunda** del anterior, así que dos
pasos no comparten ni un objeto: mover una ficha en el paso 2 no la mueve en el 1. Hay tests
que lo comprueban por identidad de referencias, no solo por valor.

`sanitizeStrat` migra el formato 1 en lugar de descartarlo, y las utilidades pasan de texto
libre a nueve tipos con su glifo y su color.

---

## 4 · FUNCIONALIDADES

| Paso del encargo | Estado |
|---|---|
| 2 · Integrar assets | ✅ 12 PNG, hash idéntico |
| 3 · Catálogo central | ✅ fuente única, sin rutas a mano |
| 4 · Selector visual | ✅ 12 miniaturas, carga diferida, `contain` |
| 5 · Tablero por capas | ✅ las 5 capas del esquema |
| 6 · Zoom y pan | ✅ rueda anclada al cursor, pan, pinza, ajustar, ± |
| 7 · Jugadores | ✅ 5 máx., añadir/mover/quitar/seleccionar, teclado |
| 8 · Utilidades | ✅ las 9, tipadas |
| 9 · Dibujo | ✅ flecha, línea, círculo, rectángulo, zona, trazo + texto |
| 10 · Secuencias | ✅ hasta 12 pasos con estado propio, ← → |
| 11 · Guardado | ✅ sistema existente ampliado |
| 12 · Mis estrategias | ✅ abrir · editar · duplicar · revisar · eliminar |
| 13 · Presentación | ✅ `/entrenador/strats/revisar` con timeline y teclado |

Seguridad: usuario del token, `sanitizeStrat`+`validateStrat` en servidor, RLS, topes por
paso, tope de plan (413) y tope de 40 estrategias impuesto por la base.

---

## 5 · PRUEBAS Y RESULTADOS

| Comprobación | Resultado |
|---|---|
| `npm test` | ✅ **489/489** |
| `npm run typecheck` (app + scripts) | ✅ sin errores |
| `npm run build` | ✅ compila; `/entrenador/strats/revisar` entre las rutas |
| `npm run maps:verify` | ✅ **14/14** |
| `npm run trainer:verify` | ✅ **35/35** |
| `npm run strats:verify` | ✅ todas |
| `npm run audit:stability` | ✅ 105 · P0 0 · P1 0 · P2 0 |
| `security` · `navigation` · `content` · `credits` · `economy` · `credits:ui` | ✅ todas |

Lo medido, no lo mirado:

- **12 mapas cargan** y sus dimensiones coinciden con el catálogo.
- **Ninguno se deforma**: se compara la proporción natural del PNG con la pintada. Tolerancia
  del 1,5 %; ninguno se acerca.
- **Zoom**: `24 17 1168 1235` → `140.8 140.5 934.4 988`, con el `<image>` en
  `1227x1281@0,0` **antes y después**.
- **Alineación**: tres sondas en coordenadas distintas escalan por `1.2500, 1.2500, 1.2500`.
  Si una capa se moviera por su cuenta, las razones se separarían.
- **Cambiar de mapa** cambia el asset y la cámara se reencuadra al nuevo (Lotus:
  `12 39 1269 1123`).
- **Móvil (390 px)**: sin desbordamiento horizontal en las cuatro rutas, y el mapa va antes
  que las herramientas.
- **Sin errores de consola.**

---

## 6 · DOS FALLOS QUE APARECIERON Y SE ARREGLARON

**El dibujo no funcionaba.** La primera versión colgaba el `pointermove` del trazo de un
`<rect>` que solo se montaba **después** del `pointerdown`; con la captura del puntero ya
tomada por el `<svg>`, ese rectángulo no recibía ni un evento y dibujar dejaba siempre una
forma de dos puntos iguales, o sea un punto. **No lo detectó ningún test: lo vi mirando una
captura del editor.** Ahora los oyentes van en `window`, igual que el arrastre de fichas, y
`trainer:verify` comprueba que un arrastre deja una forma con recorrido real.

**Los cinco jugadores nacían pegados al borde**, sobre el fondo en vez de sobre el trazado.
Los valores por defecto pasan de `y=92/8` a `y=88/12`, con el reparto en x algo más ancho.

Y una hora perdida que conviene dejar escrita: la pizarra decía «necesitas una cuenta» con la
sesión puesta. La causa era un `next start` **antiguo** que seguía vivo en el puerto —mi
`pkill` no lo mataba— sirviendo el HTML de una build ya borrada, con referencias a chunks
inexistentes. No era del código.

---

## 7 · SOBRE LOS MAPAS, EN LA DOCUMENTACIÓN

`src/domain/tactics/maps.ts` decía que los mapas eran **propios** y que «ni su trazado, ni
sus nombres» venían de VALORANT. Ese párrafo está actualizado en su sitio, con la fecha, y
ahora dice lo que decidiste:

> Los doce mapas del Entrenador son **assets de mapa adaptados para NEXUS**: imágenes PNG que
> se usan como capa visual base de la herramienta de estrategias. Este módulo NO afirma nada
> sobre su titularidad ni sobre licencia alguna: no consta verificada ninguna, y no se
> inventa.

Se conserva escrito qué decía antes y que el 2026-09-03 el responsable del producto sustituyó
el catálogo, para que el cambio sea rastreable. **No se afirma ninguna propiedad ni ninguna
licencia.** Lo mismo en `/entrenador/mapas`, en un panel visible.

---

## 8 · DEUDA RESTANTE

1. **`0028` sin aplicar** (§2). Opcional; el servidor ya impone el mismo techo.
2. **Zonas sin definir.** `zones` es opcional y los doce mapas van sin ellas, como acordamos.
   Mientras no existan, la colocación inicial de los cinco usa un borde por defecto en vez de
   la base real, y el inspector no puede decir «esto está en el sitio A».
3. **El trazo a mano alzada no se simplifica al guardar.** Se descarta por distancia mínima
   mientras se dibuja y se corta a 64 vértices, que es tosco: un trazo largo pierde el final
   en vez de perder detalle repartido.
4. **Sin deshacer.** No hay Ctrl+Z: quitar algo mal borrado es volver a colocarlo.
5. **Etiquetas sin interfaz.** El modelo guarda `tags` y el servidor las sanea, pero el editor
   todavía no las deja escribir.
6. **El servidor de pruebas sigue en el 3005** y el de la F17 en el 3001. Ninguno es un
   deploy; conviene cerrarlos cuando acabes de mirar.

---

**Sin commit. Sin push. Sin deploy. Ningún PNG modificado.**
