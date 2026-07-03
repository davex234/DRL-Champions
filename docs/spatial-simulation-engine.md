# Vertical 7 — Spatial Simulation Engine · Informe técnico

> Los mapas no son dibujos: son **sistemas tácticos**. La IA debe entender el espacio
> como un profesional: líneas de visión, ángulos, crossfires, control, cobertura,
> rutas, peligro, información. Este vertical construye el **LENGUAJE espacial**; las
> habilidades reales (smokes/flashes/mollies/recon) llegarán después y **solo usarán
> esta infraestructura** (ya hay un lenguaje de utilidad listo para ellas).

Sin cámaras, replay, audio, highlights ni visualizer. `npx tsc --noEmit` limpio.
Validación: el equipo que consume el Spatial Engine **gana el duelo de apertura un
+11.7 pp** y monta **crossfires (capacidad inexistente sin él)**.

---

## 1. Arquitectura

Módulo independiente y reutilizable `src/spatial/`. Recibe un `MapDescriptor` genérico
(zonas, muros, conexiones) y NO conoce el juego ni un mapa concreto: otro mapa = otro
adaptador. La táctica (V6) lo **consume** para dejar de hardcodear posiciones.

| Archivo | Rol |
|---|---|
| `types.ts` | `MapDescriptor`, `SpatialMap`, `ControlState`, lenguaje de utilidad — map-agnóstico |
| `build.ts` | **Precomputa** (1 vez): matriz de visión por muestreo, distancias, rumbos, cobertura, **chokes** (betweenness), **crossfires** |
| `control.ts` | **Control del mapa**, zonas de peligro, espacio libre, **rutas de mínima exposición**, info/lecturas |
| `query.ts` | API para la táctica: holds que baten una aproximación, crossfires, carril por exposición, rotación, parejas de trade |
| `utility.ts` | **Lenguaje de utilidad** (smoke/molly/recon como datos + overlay) — infraestructura, sin mecánicas reales |
| `ascent.ts` | Adaptador: construye el descriptor desde la geometría del sim y memoiza el `SpatialMap` |

El puente `src/tactics/spatial.ts` traduce consultas espaciales a asignaciones de la
táctica (holds, crossfires, rotación, carril). Opt-in por equipo (`useSpatial`) para
poder comparar.

---

## 2. El modelo espacial

`SpatialMap` (precomputado, determinista) es lo que un pro "sabe sin pensar":
- **`sight[a][b]` ∈ [0,1]** — fuerza de visión zona→zona.
- **`dist` / `bearing`** — distancias y rumbos (para ángulos y crossfires).
- **`cover[zona]`** — cobertura (muros cercanos → ángulos/protección).
- **`chokes`** — cuellos de botella por **betweenness** (zonas por las que pasan muchas
  rutas) + etiquetas.
- **`crossfires[zona]`** — pares de zonas que baten esa aproximación **desde ángulos
  distintos** y sin exponerse demasiado entre sí.

Sobre eso, un **estado dinámico** se deriva de la ocupación (qué zonas tiene cada
bando): control por zona, peligro, espacio libre, rutas e información. Todo respeta una
**superposición de utilidad** (un smoke corta `sight[a][b]`, una molly deniega una
zona, un recon revela enemigos) — el enganche para las habilidades futuras.

---

## 3. Cómo entiende un mapa (lo que sabe cada zona)

De la malla precomputada se responde, por zona: **qué ve** (`sight`), **qué amenaza**
(zonas que bate), **qué protege** (cobertura + holds que la cubren), **qué conecta**
(adyacencia), **qué la afecta** (overlay de utilidad). Ejemplo real del slice (Ascent A):
- Chokes detectados: `a_main_choke, tree_choke, generator, site`.
- **Crossfire sobre el sitio** = `[a_main_choke, ct]` (dos ángulos opuestos).
- **Crossfire sobre A-Main choke** = `[a_main, tree_choke]`.
- Holds que baten A-Main choke (ordenados): `a_main, plant, site, tree_choke`.
- Cobertura del sitio 0.67 (mucho muro), de heaven 0.50.

La táctica filtra estos holds al **lado defensor** (no aguanta en territorio atacante) y
monta el crossfire desde ahí — sin una sola posición hardcodeada.

---

## 4. Cómo calcula las líneas de visión

Por **muestreo**: cada zona aporta 5 puntos (centro + 4 a `radius·0.7`). Para A→B se
prueban todos los pares de puntos dentro de rango y `sight[a][b]` = fracción de líneas
**despejadas** (sin cruzar muros, vía intersección de segmentos). Así no es un booleano
"se ve / no se ve" sino una **fuerza** [0,1] que captura visión parcial (un ángulo se ve
desde parte de una zona). Las smokes lo anulan en caliente vía la superposición.

---

## 5. Cómo representa el control del mapa

`computeControl(occupación)` da, por zona: `score.ATK` y `score.DEF` =
**presencia** (ocupar la zona) + **dominio de visión** (suma de `sight` desde las zonas
propias). El **dueño** es quien supera al rival por un margen; si no, la zona es
**disputada**. De ahí salen: **espacio** controlado por bando, **zonas de peligro**
(batidas por visión enemiga = dónde te matarían al cruzar), **espacio libre** (zonas sin
dueño que tomar) e **información** (qué enemigos se conocen por visión/ruido/recon). Las
**rutas de mínima exposición** suman el peligro de cada zona de la ruta y eligen la
menos batida — así el ataque evita las líneas que el rival controla.

---

## 6. Qué mejora produce en el comportamiento de la IA

240 partidos, **táctico+ESPACIAL vs táctico puro** (mismo motor V6, solo cambia si
consume el espacio). Determinista.

| Métrica | Espacial | Sin espacial | Δ |
|---|---|---|---|
| **Crossfires montados** | **41.6%** | 0% | nueva capacidad |
| **1ª sangre del equipo (duelo de apertura)** | **55.9%** | 44.1% | **+11.7 pp** |
| 1ª sangre defensiva (lecturas/ángulos) | 52.1% | 40.4% | +11.7 pp |
| Éxito de entrada atacando | 51.2% | 52.7% | −1.4 pp |
| Tasa de trade | 24.5% | 24.7% | ≈ |
| Rondas con rotación a contacto | 24.4% | 23.8% | ≈ |

La IA **ve el mapa**: monta crossfires (par de ángulos), aguanta desde holds con
ventaja de ángulo y rota al carril de contacto → **gana el duelo de apertura de la ronda
un +11.7 pp**. El win-rate global es ~neutro (47.5%): en un modelo de combate **sin
habilidades** la cobertura de carriles pesa tanto como el ángulo, y lo que convierte una
ventaja espacial en rondas (smokes para ejecutar a través de un crossfire, flashes para
abrir un ángulo) es justo la **capa de habilidades aún no construida**. Es decir: el
lenguaje espacial ya cambia el comportamiento de forma medible; falta la capa que lo
capitaliza.

**Nota honesta:** el "control bruto de zonas" y el "retake" no se listan como mejora —
el primero premia DISPERSARSE (artefacto que penaliza la concentración correcta del
crossfire) y el retake casi no ocurre por una limitación previa del sim (el ataque solo
planta tras limpiar el sitio). En el slice de un sitio el ataque en grupo usa Main/Mid
(Tree queda para holds/lurk por el grafo de waypoints).

---

## 7. Qué desbloquea para las siguientes fases

Esta capa es la base sobre la que se montará TODO lo espacial:
- **Habilidades reales**: el lenguaje de utilidad (`smoke/molly/recon/flash`) ya existe;
  un smoke será `corta sightline(a,b)`, una molly `deniega zona`, un flash `ciega a quien
  tiene LOS` — y las consultas (visión, control, peligro, rutas) **ya los respetan**.
- **Ejecuciones reales**: tomar mid con humos, abrir un sitio con flash sobre el ángulo
  del holder, cortar rotaciones con una molly en el choke.
- **Lecturas avanzadas**: info por ruido/recon, predicción de rotaciones por control.
- **Mapas nuevos**: solo hay que escribir un adaptador (`MapDescriptor`); el resto del
  Spatial Engine y la táctica funcionan igual.
- **Narrativa espacial**: "controló mid toda la primera mitad", "el crossfire de A les
  costó tres entradas" — datos que el Match Narrative Engine puede consumir.

---

## 8. Validación

`scripts/spatial-report.ts` (`npx tsx`): compara equipos con y sin Spatial Engine,
mide crossfires, primeras sangres (lecturas), entradas, trades, rotaciones y control.
Determinista. Salida completa en `scripts/spatial-report.out.md`.
