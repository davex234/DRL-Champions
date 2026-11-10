# Fase 48 — NEXUS Agent Identity System 1.0

**Estado: GO para F48A (sistema).**
**ART PRODUCTION BLOCKED — HUMAN/IMAGE PIPELINE REQUIRED.**

Los diez agentes tienen identidad canónica completa, el producto está preparado para enseñar
retratos, y no se ha fabricado ni un retrato malo para poder decir «terminado». 0 migraciones
(cabeza **0054**), 0 cambios de juego, 0 commit, 0 push, 0 deploy.

---

## 1 · Qué información real existía sobre agentes

Se inspeccionó antes de escribir nada. Lo que había es esto y **nada más**:

| Dato | Dónde |
|---|---|
| id, nombre, **codename**, clase | `src/agents/catalog.ts` |
| perfil de capacidades (15 ejes, 0–100, base 15) | `src/agents/capabilities.ts` |
| kit de utilidad: cargas, mecánicas, objetivo macro | `src/agents/types.ts` |
| etiquetas legibles («humos», «trampas», «lurker») | `src/agents/catalog.ts` |
| habilidades **derivadas** de clase × mecánica | `src/abilities/catalog.ts`, `agentAbilities.ts` |
| glifo original (sigilo SVG) + color de clase | `src/components/tactics/AgentEmblem.tsx` |
| dónde aparecen | `CompositionBuilder`, `AgentPicker`, `StrategyBoard`, `TacticalTheater`, `/entrenador/plan`, `lib/match/lineups.ts` |

**No había lore, ni descripción física, ni dirección de arte, ni carpeta de assets.** Todo eso es
nuevo en esta fase y está marcado como tal.

Dos hallazgos que condicionaron el diseño:

1. **Las habilidades son derivadas, no propias.** Spear y Blitz comparten literalmente `Breach
   Flash`; Warden y Tripwire comparten las dos suyas. El motor los distingue por capacidades, no
   por habilidades — así que **la diferenciación visual tiene que cargar con ese peso**.
2. **El Asset Manager de la BD no servía.** `AssetKind`/`SubjectType` son enums en base de datos;
   añadir `agent_portrait` habría exigido migración. Como el encargo pide 0 migraciones, los
   retratos siguen el patrón estático que ya existe para mapas y sobres (`/public/...` +
   resolutor en `lib/assets.ts`). Ninguna arquitectura nueva.

---

## 2 · Los diez agentes

| Agente | Codename | Clase | Kit | Eje dominante | Acento F48 |
|---|---|---|---|---|---|
| Veil | `VEIL` | Controlador | 4 · humo+cobertura · espacio | control 92 | `#8b7bf0` |
| Haze | `HAZE` | Controlador | 4 · humo · espacio | control 80 · fake 74 | `#c3a0ff` |
| Probe | `PRB` | Iniciador | 3 · recon · info | **información 94** | `#19e3ff` |
| Pulse | `PLS` | Iniciador | 3 · destello+recon · cegar | iniciación 90 | `#6ea8ff` |
| Spear | `SPR` | Duelista | 2 · destello · cegar | **entrada 94** | `#ff2e63` |
| Blitz | `BLZ` | Duelista | 2 · destello · cegar | **presión 90** | `#ff7a3d` |
| Warden | `WRD` | Centinela | 3 · cobertura+molly · negar | **ancla 90** | `#3fc07a` |
| Tripwire | `TRP` | Centinela | 3 · molly+cobertura · negar | **post-plant 82** | `#7fd44f` |
| Specter | `SPC` | Flexible | 2 · recon+humo · info | **lurk 92** | `#cbb26a` |
| Echo | `ECO` | Flexible | 3 · destello+humo+recon · estancar | **fake 86** | `#ffd35c` |

Ni un agente once, ni uno menos. Una prueba lo fija con la lista escrita a mano.

---

## 3 · NEXUS Agent Art Language

Documento completo en **`docs/product/nexus-agent-bible.md`**. La premisa que lo ordena todo:

> **Son atletas, no operativos.** NEXUS es esports competitivo: los agentes compiten en un
> circuito profesional reglado, no asaltan edificios.

De ahí salen las reglas duras: equipo de competición homologado y con desgaste real; **sin armas
de fuego en los retratos** (lo que define a un agente es su utilidad, que es lo que el motor
modela); **nadie enmascarado del todo** —hay cara, o al menos mandíbula y mirada—; y **nada
sobrenatural**: todo sale de un aparato que lleva encima y se ve.

Cinco principios: oscuro/técnico/cinematográfico sobre la paleta de la casa · **la silueta es la
identidad** (reconocible en negro sobre blanco) · cada pieza tiene función · **un solo acento de
luz** por agente, en dos o tres puntos · **el arte no lleva interfaz**.

---

## 4 · Agent Bible (resumen)

Los diez con las 17 casillas del encargo: NAME, CODENAME, CLASS, CORE FANTASY, PERSONALITY,
SILHOUETTE, FACE/HEAD, HAIR/HEADGEAR, BODY TYPE, OUTFIT, SIGNATURE EQUIPMENT, PRIMARY VISUAL
MOTIF, COLOR IDENTITY, GLYPH RELATIONSHIP, TACTICAL IDENTITY, VISUAL DO, VISUAL DON'T.

La fantasía sale del dato, no del capricho:

- **Veil** construye la pared (control 92) · **Haze** la mueve (fake 74 + rotación 62).
- **Probe** mira (información 94) · **Pulse** abre la ventana (iniciación 90).
- **Spear** es el primero por la puerta y se gasta (entrada 94, supervivencia 30) · **Blitz** no para (presión 90).
- **Warden** no se mueve (ancla 90 + supervivencia 82) · **Tripwire** prepara el terreno antes (post-plant 82).
- **Specter** no está donde parece (lurk 92) · **Echo** se convierte en lo que falta (el único kit de tres mecánicas).

Cada ficha lleva su `VISUAL DON'T` con el nombre del riesgo real: *«no espectral»* en Veil, *«no
arco ni flechas»* en Probe, *«no teletransporte ni clones»* en Specter, *«no explosivos»* en
Blitz. **Cero copias de Valorant**, y una prueba del árbol vigila que no se cuele ningún id de
Riot en las pantallas del entrenador.

---

## 5 · Diferenciación visual entre los diez

Dos ejes, los dos comprobados por pruebas:

**Silueta.** Ni dos comparten volumen + altura + cabeza. La tabla completa está en la biblia; el
resumen es que hay un bajo y denso (Blitz), un macizo (Warden), dos altos y ligeros (Veil,
Specter), un asimétrico (Probe), uno descubierto y atlético (Pulse), una agachada (Tripwire), una
en movimiento (Haze), uno en cuña (Spear) y uno cargado de módulos (Echo).

**Color.** Cada clase conserva su color —que es lo que hace legible una composición de un
vistazo— y dentro de la clase los dos agentes tienen **acento propio**. Regla del par: *el que
ancla lleva el tono grave; el que se mueve, el claro.*

Una prueba falla si dos agentes comparten acento, si dos de la misma clase comparten silueta, o
si alguno se queda sin motivo visual.

---

## 6 · Arquitectura de assets

Se ADAPTA la que ya existe, no se inventa otra:

```
public/agents/<id>/<variante>.webp      ← igual que /maps y /packs (WEBP con alfa, como los sobres)
src/lib/assets.ts     → agentArtSrc(id, variante)    ← el ÚNICO sitio que compone rutas
src/agents/visuals.ts → el manifiesto y el contrato
```

`ASSETS.agentsDir` se ha añadido junto a `playersDir`, `teamsDir` y `mapsDir`. **Ningún
componente escribe `/agents/veil/portrait.webp` a mano**, la misma regla que ya regía para los
mapas.

**No se ha creado la carpeta `public/agents/`**: estaría vacía y una carpeta vacía no se versiona.
La crea quien deje la primera pieza.

### Contrato de las cuatro piezas

| Pieza | Proporción | Máster | Encuadre | Peso máx. |
|---|---|---|---|---|
| `avatar` | 1:1 | 256×256 | cabeza y hombros, ojos en el tercio superior | 40 KB |
| `portrait` | 3:4 | 480×640 | cara y torso superior, corte a media caja torácica | 90 KB |
| `portrait-large` | 3:4 | 960×1280 | **el mismo** encuadre, doble resolución | 220 KB |
| `fullbody` | 3:5 | 720×1200 | silueta completa con pies, 4 % de margen inferior | 260 KB |

Transparencia real, sin fondo, y **prohibido dentro del arte**: texto, nombre, clase, números,
logotipos, marcos y cualquier elemento de interfaz.

---

## 7 · Manifest

`src/agents/visuals.ts`, exportado por `src/agents/index.ts`:

- `AGENT_ART_CONTRACT` — qué entrega cada variante (proporción, tamaño, encuadre, uso, peso).
- `AGENT_IDENTITY[id]` — acento, motivo, silueta y **`published`: qué piezas existen de verdad**.
- `AGENT_VISUALS[id]` / `agentVisual(id)` — la entrada resuelta: `classColor`, `accent`, `motif`,
  `silhouette`, `glyph: "emblem"`, y `avatar` / `portrait` / `portraitLarge` / `fullbody` como
  ruta **o `null`**.
- `agentArt(id, variante)` — la pieza a usar, con degradado *hacia arriba* solamente: un
  `portrait-large` vale para un hueco de `portrait`, pero **un `avatar` nunca rellena un hueco de
  medio cuerpo** (mejor el sigilo que una cabeza estirada).

Dos decisiones que merecen nombre:

1. **`null` es información, no un hueco.** Con `published: []` en los diez, el producto hace
   **cero peticiones** al servidor. No es el patrón de las fotos de jugador, donde cada carta
   pide un PNG que no está.
2. **El manifiesto se construye al LEER, no al importar.** Si fuera una foto tomada al cargar el
   módulo, publicar una pieza durante la sesión dejaría `AGENT_VISUALS` diciendo una cosa y
   `agentArt()` otra: dos fuentes de verdad, que es lo que este fichero existe para evitar.

`AGENT_CLASS_ACCENT` duplica el valor de `AGENT_CLASS_COLOR` porque `src/agents` es datos puros y
no puede importar un componente de React. **Una prueba compara las dos copias** para que no se
separen nunca.

---

## 8 · Componente y respaldo

`src/components/tactics/AgentPortrait.tsx` — `{ agentId, variant, size, decorative }`, sin lógica
duplicada en ninguna pantalla. `size` acepta píxeles o `"fill"` (ocupa el ancho y saca el alto de
la proporción).

**El respaldo no es un error, es la identidad que el producto ya tiene.** Sin arte, pinta el
sigilo dentro del mismo marco, sobre un velo del acento del agente. Y hay una regla fina que
evita empeorar pantallas: en una caja **cuadrada** el sigilo va **con su anillo de clase** —ahí es
una ficha, y el anillo es lo que la convierte en una—; en una caja **alta** va desnudo y grande,
porque el anillo pelearía con el marco.

**Accesibilidad:** el sigilo ya es un `role="img"` con su etiqueta; el envoltorio no la repite
—se corrigió una doble lectura detectada por la prueba— y con `decorative` lleva `aria-hidden`,
que calla todo lo de dentro cuando la pantalla ya escribe el nombre al lado. **El retrato nunca
es la única forma de saber quién es un agente.**

---

## 9 · Composition Manager

Donde más se nota, como pedía el encargo.

**Los cinco huecos** pasan de un emblema de 56 px flotando en una caja de 132 px a **una caja 3:4
entera dada al retrato**, con el nombre y la clase debajo y el canto inferior del **acento del
agente**. Hoy se ve el sigilo grande sobre su velo de color; el día que exista el retrato,
aparece en esa misma caja **sin tocar esta pantalla**. El hueco vacío reserva exactamente la misma
caja, así que llenar el cinco no mueve nada de sitio.

Dos controladores dejan de ser dos huecos violetas idénticos.

**El roster sigue siendo rápido.** No se ha tocado su geometría: diez fichas de 48 px de alto,
dos filas, clic-clic-clic-clic-clic. Usa la variante `avatar`, cuyo respaldo dibuja **exactamente
el mismo emblema con anillo que había antes**.

Antes/después: `qa/fase48/antes/03-editor-lleno-1440.png` → `despues/03-editor-lleno-1440.png`.

---

## 10 · Plan Táctico

`CompositionStrip` —la tira de los cinco que usa el Plan y las listas— pasa por `AgentPortrait`
en variante cuadrada. **Hoy el resultado es idéntico al de ayer** y el día que haya avatares los
enseña sin tocar la pantalla. No se ha llenado el Plan de caras: la composición se identifica con
la tira y punto, que es lo que pedía el encargo.

---

## 11 · Presentar

El panel de composición del teatro (retrato pequeño + nombre + clase) pasa por el mismo
componente, en `avatar`. **Las capturas de Presentar a 1440 y 1920 son byte a byte idénticas a
las de antes de la fase** — la mejor prueba de que la preparación es invisible hasta que llegue
el arte. El mapa sigue siendo el protagonista.

---

## 12 · Qué mantiene glifos, y por qué

**El mapa.** `StrategyBoard` sigue pintando `AgentEmblemGlyph` dentro del SVG del tablero y
**no importa `AgentPortrait`**. Con cinco jugadores, utilidades, flechas, zonas y texto
compitiendo, un retrato a 20 px es una mancha marrón y un sigilo sigue siendo una marca: ahí gana
la legibilidad, no el arte.

No es una intención escrita en un comentario: **hay una prueba que lee la fuente del tablero y
falla si alguien importa el retrato en la capa del mapa.**

---

## 13 · Performance

- **Cero peticiones de red añadidas.** Con `published: []`, el marcado no contiene ni un `<img>`:
  comprobado por prueba sobre los diez y verificado en navegador.
- Cuando el arte llegue: `loading="lazy"`, `decoding="async"`, WEBP con presupuesto de peso por
  variante (40–260 KB) y el `avatar` de 40 KB para las listas. Diez avatares ≈ 400 KB, no
  «diez PNG de 15 MB».
- El respaldo es SVG en línea, sin petición y sin coste de decodificación.

---

## 14 · Responsive y layout shift

**Sin salto.** La caja se reserva SIEMPRE con la proporción del contrato, haya arte o no, y el
`<img>` declara su tamaño intrínseco: cuando el retrato llegue, cae dentro de un hueco que ya
medía lo que va a medir. Probado a 96 px, a 40 px y en modo fluido.

Capturado y revisado a **390 · 768 · 1440 · 1920 · 2560**. En tablet (768) los cinco huecos se
leen como cinco cartas de agente con nombre y clase, y el roster sigue entrando en dos filas. A
390 los cinco caben en fila sin recortes.

---

## 15 · Pipeline de arte: la encontrada y la que no existe

Se buscó de verdad antes de declarar nada:

| Candidato | Qué es en realidad |
|---|---|
| `src/artwork-ai` + `scripts/artwork-ai-verify.ts` | **Asistente de CALIDAD, de solo lectura.** Su propia cabecera dice «sin IA generativa»: analiza métricas y sugiere, no dibuja. |
| `src/artwork-acquisition` | Descarga y deduplica assets **existentes** de proveedores. No genera. |
| `scripts/pack-art-render.ts` | **Máster vectorial + `sharp`.** Rasteriza un diseño escrito en código a WEBP con alfa. Es el camino que el propio proyecto tomó en la Fase 20.1, y su cabecera lo dice: «sin herramienta de generación de imágenes en el entorno». |
| `ANTHROPIC_API_KEY` en `.env.example` | Modelo de **texto** para análisis competitivo. Ni siquiera está puesto en `.env.local`. |
| Dependencias | `sharp@0.34.5` (rasterizar). **Ninguna** de generación de imagen. |
| Mi entorno | **Ninguna herramienta de generación de imágenes.** |

**Conclusión: no existe pipeline de generación de arte original.**

Y la vía del máster vectorial **no sirve aquí**, aunque haya funcionado para los sobres: el arte
de sobre es diseño gráfico —materiales, emblemas, metales— y un retrato de personaje es figuración.
Dibujar diez personas a mano en SVG produciría exactamente lo que el §28 prohíbe: *«no fabriques
SVGs de personas, no dibujes caras con CSS»*. Y el §34 lo remata: *«no quiero diez gradientes con
iniciales para decir terminado; usa los glifos como fallback profesional»*.

Así que eso es lo que se ha hecho.

---

## 16 · Estado de VEIL golden sample

**No producido.** No hay con qué producirlo, y fabricar un Veil mediocre habría fijado el
estándar en el sitio equivocado — que es justo lo que el golden sample existe para evitar.

Lo que **sí** queda listo para que Veil se produzca y se integre el mismo día que haya pipeline:

- ficha completa en la biblia (fantasía, carácter, silueta, cara, equipo, motivo, acento, do/don't);
- contrato de encuadre, resolución, formato, transparencia y peso;
- ruta y manifiesto (`published: ["portrait"]` y ya está);
- las cuatro superficies donde hay que evaluarlo, con captura previa para comparar;
- y la prueba de que el camino funciona: **se declaró arte de Veil que no existe en disco, se
  compiló, y el navegador enseñó el sigilo sin una sola imagen rota** (§17).

**P2 abierto y con nombre: ORIGINAL AGENT PORTRAIT ART — VEIL PRIMERO.**

---

## 17 · Screenshots QA y prueba de respaldo

`docs/product/qa/fase48/`: **12 en `antes/` + 12 en `despues/`**, capturadas con sesión real
contra la base de datos del VPS y sobre la build de producción — no en `next dev`. Cubren lista
de composiciones, editor vacío, editor 5/5 (390/768/1440/1920/2560), pizarra con fichas,
Presentar (1440/1920) y Plan Táctico (1440/768).

**Prueba de respaldo real (§45), hecha en navegador y revertida después.** Se declaró
temporalmente que Veil tenía `portrait` y `avatar`, se compiló, y se midió el DOM:

```
veil   portrait → glyph (sigilo)      ← el servidor devolvió 404, el onError hizo su trabajo
veil   avatar   → glyph (sigilo)
… los otros nueve → glyph, sin pedir nada
imágenes rotas: 0 · alt suelto visible: 0
```

Evidencia en `fallback-simulado-1440.png` y `fallback-simulado.json`. La captura es
**indistinguible** de la normal: un asset declarado que falta degrada de forma invisible. La
declaración temporal está revertida y verificada.

---

## 18 · Tests

**4544 / 4544 PASS.** Línea base 4525 + **19 pruebas nuevas**, sin relleno:

- `src/agents/visuals.test.ts` (11): el manifiesto cubre el roster exacto · nadie sin acento,
  motivo ni silueta · **dos agentes nunca comparten acento** · los dos de cada clase se
  distinguen en color y silueta · **las dos copias del color de clase no pueden separarse** · el
  sigilo siempre está · sin arte, las cuatro variantes caen al sigilo en los diez · un agente
  inexistente no revienta · el degradado no estira encuadres · el contrato es coherente · las
  rutas las compone un solo sitio.
- `src/components/tactics/agentPortrait.test.tsx` (8): los diez pintan sigilo y **nadie pide una
  imagen** · el hueco se reserva con la proporción del contrato · con arte declarado el mismo
  componente lo pinta · un avatar no rellena un hueco de retrato · identidad textual sin doble
  lectura · un agente inexistente no rompe nada · **y el mapa no puede llevar retratos**.

**Una invariante reescrita, no debilitada.** `f47.close.test.ts` exigía literalmente
`<AgentEmblem` en el constructor. Lo que protegía era la regla «un agente se elige por su imagen,
no leyendo nombres», no ese identificador. Ahora exige `<AgentPortrait` **y además** que
`AgentPortrait.tsx` contenga `<AgentEmblem`: la garantía queda cerrada donde de verdad importa.

## 19 · Types

`tsc --noEmit` **PASS** · `tsc -p tsconfig.scripts.json` **PASS**.

## 20 · Lint

`npm run lint` → **exit 0**. 28 warnings, los mismos `Unused eslint-disable directive` ya
documentados como P2; ninguno nuevo, ninguno en ficheros de esta fase.

## 21 · Build

`npm run build` **PASS**.

## 22 · Producción

`next start -p 3005` sobre la build final. `GET /api/game/state` → **401** (correcto sin sesión);
`/entrenador`, `/entrenador/composiciones` y `/entrenador/strats` → **200**. Túnel a la base de
datos abierto para que la aplicación sea usable.

**Runtime:** en las 12 escenas capturadas, **0 errores de hidratación, 0 de chunk, 0 de React y 0
assets 404**. Los únicos mensajes son 75 respuestas `429` del limitador de la propia API,
provocadas por el arnés al pedir pantallas en ráfaga.

**Demo a salvo (§49):** no hay pantallas rotas, ni assets a medias, ni placeholder experimental
visible. Todo el trabajo incompleto está detrás del respaldo existente, y Presentar está byte a
byte igual que antes de la fase.

## 23 · Working-tree safety

Solo lectura primero (`git status`, `git diff --stat`). Por cada fichero existente: copia de
seguridad → parche con ancla verificada → `diff` de comprobación. Saltos de línea preservados
fichero a fichero. **Cero `Write` ciego sobre fichero existente** — el incidente de
`src/lib/tactics/client.ts` no se ha repetido. Cero `git reset`, `clean`, `restore`, `checkout .`,
stash o rebase. **Ningún trabajo previo perdido.**

Ficheros tocados:

| Fichero | Qué |
|---|---|
| `src/agents/visuals.ts` | **nuevo** · manifiesto, contrato e identidad de los diez |
| `src/agents/visuals.test.ts` | **nuevo** · 11 pruebas |
| `src/components/tactics/AgentPortrait.tsx` | **nuevo** · componente y respaldo |
| `src/components/tactics/agentPortrait.test.tsx` | **nuevo** · 8 pruebas |
| `src/agents/index.ts` | exporta el manifiesto |
| `src/lib/assets.ts` | `agentsDir` + `agentArtSrc()` |
| `src/components/tactics/AgentEmblem.tsx` | `size` admite medida CSS (para caja fluida) |
| `src/components/tactics/CompositionBuilder.tsx` | huecos con retrato, roster y tira por el componente |
| `src/components/tactics/TacticalTheater.tsx` | panel de composición por el componente |
| `src/domain/tactics/f47.close.test.ts` | invariante reescrita a la arquitectura nueva |
| `scripts/_fase48-shots.ts`, `_fase48-fallback.ts` | **nuevos** · instrumentos `_`, fuera de CI |
| `docs/product/nexus-agent-bible.md` | **nuevo** · la biblia |

> Nota de higiene: `src/design/tokens.ts` y `public/sw.js` aparecen con fecha de hoy porque
> `src/build/buildid.test.ts` los modifica y los restaura en un `finally` a propósito (comprueba
> que el build id cambia al cambiar una fuente). El contenido vuelve idéntico; sólo cambia la
> fecha. **No los ha tocado esta fase.**

## 24 · Sistemas no tocados

Gameplay, combate, habilidades, equilibrio, economía, progresión, cartas, colección, sobres,
tienda, reglas de mazo, motor de partido, F45, F46, home, worker de Pick'em, VPS, esquema de
Supabase, Caddy y Docker: **sin tocar**.

**F47 intacta**: coordenadas normalizadas, pasos, reproducción de 520 ms, modelo de strat,
dominio de composiciones, asignación a partidas, validación de mapa cruzado y concurrencia. No se
ha tocado `src/agents/catalog.ts`, `capabilities.ts`, `types.ts` ni `src/abilities/`.

**`CompositionHUD` (retransmisión) no se ha tocado**: enseña el *perfil* de una composición, no
agentes individuales. Meter retratos ahí no aportaba nada (§23 del encargo).

## 25 · Migrations

**0 migraciones.** Cabeza en `0054_tactical_compositions.sql`, fijado por prueba.

## 26 · Marketplace

`GLOBAL_MARKET_ENABLED = false`, sin cambios.

## 27 · Qué necesita el siguiente paso

1. **Una pipeline de imagen autorizada** (humana o de herramienta), que es lo único que bloquea.
2. **Veil primero**, como muestra patrón, en `portrait` (480×640) y `avatar` (256×256).
3. Evaluarlo en las cuatro superficies con las capturas de `antes/` al lado, y **ajustar el
   contrato artístico si no funciona en interfaz antes de producir los otros nueve**.
4. Publicar es: dejar el fichero en `public/agents/veil/` y añadir la variante a `published` en
   `AGENT_IDENTITY`. Ninguna pantalla cambia. La prueba «sin arte publicado…» fallará entonces —
   y hay que **actualizarla, no debilitarla**.
5. Pendientes largos: `portrait-large` y `fullbody` (declarados, sin uso todavía) y una eventual
   pantalla de agente que los aproveche.

## 28 · Veredicto

**GO para F48A.** Los diez agentes canónicos están inventariados; hay Agent Bible con identidad
diferenciada y un lenguaje artístico común; los glifos se conservan y mandan en el mapa; hay
contrato de assets, manifiesto centralizado y respaldo probado en navegador; Composition Manager,
Plan Táctico y Presentar están preparados; responsive intacto; 0 cambios de juego; 0 migraciones;
F47 intacta; Marketplace OFF; tests, tipos, lint y build en verde; producción en `:3005`.

**NO-GO para el artwork, y dicho sin disimulo:** `ART PRODUCTION BLOCKED — HUMAN/IMAGE PIPELINE
REQUIRED`. No se ha fingido que esté hecho y no se han fabricado diez placeholders para rellenar
la casilla.
