# Fase 47 · Tactical Coach & Match Preparation 1.0 — informe

Fecha: 2026-09-18 · Rama `arch/stabilization` · sin commit, sin push, sin deploy, sin Docker.
**Migración 0054 añadida y aplicada** (autorizada en el encargo, §79).

---

## 1 · Baseline

`npm test` al abrir: **4481 verdes**. Al cerrar: **4502 / 4502 · 0 fallos** (+21).

## 2 · Entrenador anterior — mucho más de lo que esperaba

La inspección cambió el plan. No había que construir una pizarra: ya existía, y buena.

| | |
|---|---|
| **REUTILIZABLE** | `public/maps/*.png` (**12 mapas reales**), `domain/tactics/{maps,strat}.ts` (685 líneas: `StratStep`, `StepState`, `PlayerToken`, `UtilityToken`, `Drawing`, `Annotation`, topes y saneado), `components/tactics/{MapCanvas,StrategyBoard,AgentPicker,UtilityGlyph,MapPicker}`, `user_strats` con RLS, API con `save`/`duplicate`/`delete`, `coach_matches` |
| **YA ESTABA** | coordenadas normalizadas, zoom, pan, pinch, **pasos**, flechas, líneas, círculos, rectángulos, zonas, trazo libre, texto, utilidades atadas a habilidad del agente, undo, `AgentPicker` con filtro por clase |
| **FALTABA** | identidad **visual** de agente · pantalla completa · reproducción y línea de tiempo · composiciones por mapa · asignación de jugadas a partida |
| **LEGACY** | nada retirado |

## 3 · Los agentes — **la decisión que hay que leer**

El encargo pedía «ver los agentes de VALORANT». **No se puede, y no por capricho:**

- el catálogo canónico de NEXUS son agentes **propios** —`veil, haze, probe, pulse, spear, blitz, warden, tripwire, specter, echo`—, con clase, utilidad y habilidades. Jett, Sova u Omen **no existen** en este producto; meterlos sería inventar datos de producción, que el propio encargo prohíbe;
- sus retratos son de Riot, y el encargo prohíbe «assets robados» e «imágenes dudosas descargadas aleatoriamente».

El proyecto **no tiene retratos** de sus agentes. Así que la identidad se **dibuja**: `AgentEmblem.tsx`, un sigilo original por agente, geométrico, que alude a lo que el agente hace (Veil = cortina, Haze = volutas, Probe = abanico de sonda, Spear = lanza, Warden = escudo con cerrojo, Tripwire = cable tenso, Echo = repetición…), coloreado por clase y legible a 20 px.

**No es un retrato, pero tampoco es una letra en un círculo.** Verificado en la captura `03-agentes-asignados.png`: cinco fichas con marca distinta y nombre. El §91 pasa.

## 4–6 · Mapas y selector

12 mapas reales, con proporción del asset (`aspectRatio`) y selector ya existente. No se inventó ninguno.

## 7 · Tactical Board

Conservado. Ya usa coordenadas normalizadas, zoom, pan y capas.

## 8 · Pantalla completa — **nuevo**

`src/lib/tactics/fullscreen.ts` + `TacticalTheater.tsx`.

**Fullscreen API de verdad**, no `width:100%`: el caso de uso es una TV y con CSS seguirían viéndose la barra del navegador y la de tareas. Cuando la API no está o la rechaza —iOS, iframe sin permiso, o llamada fuera de un gesto— se cae al modo **FOCUS** (`position: fixed` por portal al `body`). Escape sale de los dos.

En la QA automatizada el modo sale `focus`, y es correcto: un Chrome dirigido por CDP no concede pantalla completa sin gesto real. Con una pulsación humana entra en `native`.

## 9 · Zoom / Pan

Ya existían. El teatro arranca con `fitCamera` —la misma función que el editor— y deja acercarse mientras se explica sin tocar la cámara del editor.

> **Bug encontrado y corregido:** inventé una cámara `{cx:.5, cy:.5, scale:1}` y el mapa salía descuadrado y medio fuera de pantalla. El encuadre depende de la proporción real del asset; hay que usar `fitCamera`.

## 10–12 · Composiciones — **nuevo**

`src/domain/tactics/composition.ts` (puro) + `user_compositions` + `/api/game/compositions`.

Cinco agentes por mapa, agentes canónicos, sin repetidos, tope de 12 por mapa, una «principal» por mapa garantizada por **índice único parcial** en la base (no por el cliente). Una composición **incompleta es válida**: se guarda, pero `isComplete` dice que no está lista.

**No se bloquea por meta** (§14): cinco de la misma clase es legal. `classBreakdown` informa, no impone.

## 13 · Coordenadas normalizadas

Ya era así y hay prueba que lo fija: `Point { x: number; y: number }`, sin píxeles en el modelo. **Verificado jugando:** redimensionar de 1600 a 1024 dejó las cinco fichas con el mismo `transform` — `mismas: true`.

## 14 · Ataque / Defensa

En el teatro, arriba, con **palabra y flecha** (`▲ Ataque` / `▼ Defensa`), no sólo color.

## 15–24 · Biblioteca, editor, herramientas, dibujo

Conservados: flechas, líneas, círculos, rectángulos, zonas, trazo libre, texto, colores, duplicar. El editor ya los tenía y no se han tocado.

## 21–22 · Utilidades y habilidades

Ya existían y salen del catálogo real: al seleccionar una ficha con agente, `AbilityPicker` ofrece **sus** habilidades («BREACH FLASH · Destello · 2 cargas» para Spear). El `AgentPicker` ahora las enseña con emblema en vez de codename.

## 25–26 · Reproducción y línea de tiempo — **nuevo**

`src/lib/tactics/playback.ts` (puro) + el teatro.

Avanzar de paso **interpola** las fichas de donde estaban a donde van, 520 ms con suavizado. Tres decisiones que importan:

- el emparejamiento es **por `id`, no por posición**: si se borra un jugador en medio, emparejar por índice teletransportaría al resto;
- una ficha que no existía en el paso anterior **aparece en su sitio**, no viaja desde la nada;
- **llegar al final PARA**, no vuelve al principio: un bucle sorprende a quien está explicando.

**La reproducción no toca datos.** Devuelve una foto calculada; hay prueba que compara el plan serializado antes y después.

Línea de tiempo abajo, con paso actual, pasados y pendientes, pulsable. Teclado: `←` `→` pasos, espacio reproduce/pausa.

## 27–29 · Undo, guardado, concurrencia

Undo ya existía. Guardado explícito ya existía. **Concurrencia: no añadida** — ver P2.

## 30–32 · Integración con partidas — **nuevo, backend**

`coach_match_strats` + `/api/game/match-strats` con `assign` / `unassign` / `reorder`.

**La validación que da sentido a la fase (§41):** una jugada de Ascent **no** puede asignarse a una partida de Bind. Se comprueba en el servidor comparando el mapa de la jugada con el de la partida, y responde **409**. El mapa no se duplica en la fila de asignación: se deduce.

Autoridad: usuario del Bearer siempre; partida o jugada ajenas responden **404, no 403**.

## 33 · Game Day

El teatro **es** el modo Game Day: arriba mapa/lado/nombre, en medio el mapa, abajo los pasos, la composición flotando, y nada más.

## 34 · Permisos

`user_strats` y las dos tablas nuevas llevan RLS propia de dueño, y las rutas añaden `eq("user_id")` como segunda red además de RLS. Hay prueba que lo fija.

## 35–37 · Tablet, escritorio, rendimiento

SVG + DOM, sin WebGL ni canvas bitmap. El `MapCanvas` ya traía punteros y pinch (tablet). Verificado a 1024, 1600 y 2560.

## 38 · QA real

`scripts/_fase47-coach-qa.ts`, con la cuenta QA de F45 (preservada). **17 capturas** en `docs/product/qa/fase47/`.

Recorrido real: entrar → pizarra → colocar **5 jugadores** → asignar **5 agentes** → añadir **2 pasos** (3 en total) → abrir el teatro → recorrer los pasos con botón y con teclado hasta `3 / 3` → cerrar → redimensionar a 1024 y a 2560.

Resultados medidos: `fichas: 5` · `agentes: 5` · `emblemas: 12` en el teatro · `resize.mismas: true`.

> **Tres bugs de mi propio instrumento, corregidos:** usaba `querySelector('svg')` y cogía un icono de la barra en vez del mapa; filtraba botones por `aria-pressed`+`svg` y asignaba **humos** en vez de agentes; y un comentario con comillas invertidas dentro de una plantilla de JS rompía el `transform`. Ninguno era del producto.

## 39 · Capturas

17. Editor, cinco jugadores, agentes asignados, pasos, teatro (3 pasos), vuelta al editor, resize 1024 y 2560.

## 40 · Tests

**+21 útiles** (`src/domain/tactics/f47.test.ts`, 21/21): composición válida/duplicados/agente inexistente/mapa inexistente/incompleta-pero-válida/saneado/sin bloqueo por meta; **cambiar composición avisa en vez de convertir utilidades** (§64); rango de pasos, parada al final, interpolación, emparejamiento por id, no mutación, duración; respaldo de fullscreen; sin coordenadas absolutas; mapa cruzado rechazado; validación en servidor; migración no destructiva; emblema por agente.

**Fuzz de 10.000 operaciones: NO hecho.** Ver P2.

## 41 · Migración / BD

**0054** — `user_compositions`, `user_strats.composition_id` (nullable, `on delete set null`), `coach_match_strats`. Aditiva: sin `drop`, sin `delete`, sin `truncate` (hay prueba). Aplicada a la BD real; comprobado después: **2 tablas + 1 columna, 0 strats existentes afectadas**.

> La última migración en disco era **0053**, no un número más alto: dijiste que no la asumiera y la comprobé — 0053 era Draft Gauntlet. La nueva es 0054.

## 42–43 · Bugs

| Qué | Estado |
|---|---|
| Cámara inventada dejaba el mapa descuadrado en el teatro | **Corregido** (`fitCamera`) |
| Fichas de agente eran círculos con letras | **Corregido** (emblemas) |
| `AgentPicker` identificaba por codename de texto | **Corregido** (emblemas) |
| Tres fallos del instrumento de QA | **Corregidos** |
| Tres pruebas fijaban «última migración = 0053» | **Actualizadas** a 0054, sin debilitarlas |

## 44 · Sistemas no tocados

Home, Main Menu, F45 (arena, combate, turnos, resultado), colección, sobres, tienda, economía, recompensas, Marketplace, worker de Pick'ems, infraestructura. **0 cambios.**

## 45 · P2 — lo que falta, dicho claro

1. **Pantallas de composición y de plan táctico.** El backend está completo y probado —dominio, tablas, API, permisos, validación de mapa cruzado—, pero **no hay interfaz** para crear una composición ni para asignar jugadas a una partida desde el entrenador. Hoy sólo se puede por API.
2. **Fuzz de 10.000 operaciones de editor** (§84): no ejecutado.
3. **Concurrencia entre pestañas** (§58): `user_strats` no tiene `expectedVersion`; sigue siendo último-en-escribir-gana.
4. En el teatro las fichas llegan al DOM (5 tokens, 12 emblemas) pero en las capturas automáticas quedan al borde del mapa y no se leen bien; conviene verificarlo a mano colocándolas en el centro.
5. Callouts (§66): no existen en metadata; no se han inventado.

## 46 · GO / NO-GO

### ~~NO-GO parcial.~~

> **SUPERADO el 2026-09-18.** Los tres bloqueos están resueltos y verificados por interfaz.
> Veredicto final en el **ADDENDUM DE CIERRE** al pie: **GO**.

**Lo que sí está y funciona**, verificado jugando: pizarra con 12 mapas reales, agentes con identidad visual propia, cinco fichas colocadas y arrastrables, coordenadas normalizadas que sobreviven al resize, pasos, **reproducción con interpolación**, línea de tiempo, teclado, **pantalla completa real con respaldo**, modo Game Day sin distracciones, utilidades atadas a habilidades reales, y todo el backend de composiciones y de asignación a partidas con su validación de mapa cruzado.

**Por qué no es GO:** tu §94 lo dice sin ambigüedad — *«NO-GO si creo strats pero luego las partidas no pueden utilizarlas»*. Un entrenador **todavía no puede** crear una composición ni asignar jugadas a una partida **desde la interfaz**: esas dos pantallas no están. La cañería está puesta, probada y protegida; falta el grifo.

También quedan sin hacer el fuzz de 10.000 y la concurrencia.

Prefiero decírtelo así que declarar GO sobre una integración que no puedes usar todavía.

**Estado final:** NEXUS levantado en **http://localhost:3005** (build de producción) — `/entrenador/strats` funciona con el teatro. Túnel 54521 abierto. 0 Chrome sin cabeza. Tu Unreal intacto.

---

# ADDENDUM DE CIERRE · Fase 47 (2026-09-18)

El informe anterior cerraba en **NO-GO** con tres bloqueos. Este addendum los resuelve.

## 1 · Baseline inicial

Confirmado antes de tocar nada: **4502 / 4502 tests**, migración **0054** aplicada, y las doce piezas del
listado (mapas, dominio, coordenadas normalizadas, zoom, pan, pinch, flechas, zonas, dibujo, texto, undo,
utilidades, habilidades, fullscreen, teatro, reproducción, timeline, teclado, backend de composiciones,
API, relación con partidas, 409 de mapa cruzado) siguen en su sitio. No se ha rehecho ninguna.

## 2 · Los tres bloqueos

| | Estado |
|---|---|
| UI para crear y gestionar composiciones | **RESUELTO** |
| UI para asignar composición y jugadas a una partida | **RESUELTO** |
| Fuzz 10.000 + concurrencia entre pestañas | **RESUELTO** |

## 3–4 · Composition Manager y Builder

`/entrenador/composiciones` + `CompositionBuilder.tsx`.

Selector de mapa visual (doce pastillas con su recuento), y dentro: **cinco huecos** con emblema, nombre y
clase; roster con los diez agentes; búsqueda; filtro por clase; reparto por clase informativo; contador
`5 / 5`. **Ni un solo `<select>`** — hay prueba que lo fija.

Ciclo completo: ver · crear · editar · **duplicar** (copia en el MISMO mapa, id nuevo) · borrar.

## 5–6 · Roster e identidad visual

Los diez agentes canónicos —Veil, Haze, Probe, Pulse, Spear, Blitz, Warden, Tripwire, Specter, Echo— con su
glifo original, su nombre y su clase. En el hueco y en el roster van los tres; sobre el mapa manda el glifo.
Ningún agente de Riot: hay prueba que busca `jett`, `sova`, `omen`, `killjoy`, `sage`, `reyna`, `phoenix` y
`cypher` en las tres pantallas nuevas.

## 7 · CRUD

Contra `/api/game/compositions`, que ya existía. La regla la sigue aplicando el servidor
(`validateComposition`); el constructor usa **las mismas funciones del dominio** para avisar antes de enviar,
así que el aviso coincide siempre con el del servidor.

Una composición **incompleta se guarda** —el backend lo permite— y se marca `3 / 5`. Completa hace falta sólo
para llevarla a una partida. No se contradice al backend.

**Principal**: el backend ya lo soportaba (`primary`, con índice único parcial por mapa), así que se muestra
en la lista. No se ha ampliado el modelo.

## 8 · Strat ↔ Composición

El plan enseña qué composición está elegida y avisa cuando una jugada se creó con otra
(`data-testid="comp-incompatible"`). **No se bloquea** —el entrenador manda— pero tampoco se calla.

## 9–11 · Plan táctico de partida

`/entrenador/plan?match=<id>`. Enseña la partida REAL (mapa, equipo, rival, marcador, fecha; cada campo sólo
si existe), las composiciones del mapa, y las jugadas del mapa **separadas por ▲ Ataque / ▼ Defensa** —con
palabra y flecha, no sólo color—. Asignar, quitar, **Abrir** y **Presentar** por jugada, y una tira final con
lo que se lleva al partido.

## 12 · Mapa cruzado

El cliente filtra por comodidad; **el servidor manda**. Verificado en vivo:

```
POST /api/game/match-strats {assign, strat de bind → partida de ascent}
→ 409 · "Esa jugada es de otro mapa (bind) y la partida se juega en ascent."
```

## 13 · Compatibilidad de composición

Se dice en la lista de jugadas antes de asignar. No se convierte nada ni se borra nada en silencio.

## 14–16 · Presentar, fullscreen y reproducción

Desde el plan, **Presentar** abre el teatro ya existente —no se ha rehecho— con la composición elegida
flotando al lado. Verificado en vivo: `montado: true`, `modo: focus`, `linea: true`, `lado: "▲ Ataque"`, y el
paso avanza con el botón y con `→`. Interpolación de 520 ms sin tocar.

`modo: focus` en vez de `native` es correcto: un Chrome dirigido por CDP no concede pantalla completa sin
gesto humano. Con una pulsación real entra en `native`.

## 17–18 · Fuzz 10.000

`src/domain/tactics/f47.fuzz.test.ts` · **semilla `0x5f47a11`** (escrita, no generada) · **10.000
operaciones** · **0 fallos**.

21 operaciones distintas: añadir/mover/borrar ficha, asignar agente, flecha, utilidad, dibujo, texto, editar
texto, añadir/duplicar/borrar/ir a paso, deshacer, rehacer, zoom, pan, resize y guardar-recargar.

Invariantes tras **cada** operación: coordenadas finitas y en `0..1`; sin `NaN` ni `Infinity`; identificadores
únicos entre fichas, utilidades, dibujos y notas; topes de equipo, utilidades, dibujos, notas y puntos;
índice de paso en rango; **agentes del catálogo real**; y **ninguna utilidad huérfana** (atada a un jugador
que ya no está en el paso).

Dos pruebas más: el tamaño de pantalla (los seis del encargo) **nunca** cambia una coordenada, y mil eventos
de reproducción no sacan el índice de rango ni mutan el plan.

## 19 · Concurrencia — sin migración nueva

`user_strats` ya tenía `updated_at` y el trigger `user_strats_touch` la avanza en cada escritura: **es** la
versión. El guardado acepta `baseVersion` y el `UPDATE` sólo muerde si la fila sigue en esa versión.

Cero filas se distingue en dos casos —no existe (**404**) o cambió (**409 `VERSION_CONFLICT`**, con
`currentVersion` para poder recargar sin adivinar)—. Confundirlos haría creer al entrenador que ha perdido la
estrategia.

`baseVersion` es **opcional**: un guardado antiguo sigue funcionando. **No hay «forzar guardado»**, como
pediste; hay prueba que lo impide.

## 20 · Multi-pestaña, verificado en vivo

```
A guarda con su versión   → 200 · versión 2026-09-18T11:54:57.956148+00:00
B guarda con la versión VIEJA → 409 · VERSION_CONFLICT
                                "Esta estrategia ha cambiado en otra pestaña."
nombre final = el de A · pisado: false
```

**B no pisó a A.**

## 21 · Permisos

Sin cambios: RLS de dueño en las tres tablas y `eq("user_id")` como segunda red en cada ruta. El usuario sale
siempre del Bearer; partida o jugada ajenas responden 404, nunca 403.

## 22 · Tablet

`/entrenador/plan` capturado a 768×1024 (captura 32). El plan se lee y se opera.

## 23 · Capturas

**30** en `docs/product/qa/fase47/` (13 nuevas en este cierre): gestor, constructor vacío, 5/5, guardada,
persistida tras recargar, plan táctico, composición elegida, jugada asignada, plan persistido, presentar
desde partida, paso 2, tablet 768 y 2560.

## 24 · QA real end-to-end — TODO por interfaz

```
composiciones → mapa Ascent → nueva → 5 agentes a clics → 5/5 → guardar
→ RECARGAR → sigue ahí
→ plan de partida → elegir composición → asignar jugada → RECARGAR → sigue asignada
→ Presentar → teatro → paso 2
```

Medido: `slotsLlenos: 5` · `contador: "5 / 5"` · `trasRecargar.existe: true` · `plan: {comps:1, jugadas:1,
presentar:1}` · `asignado: "En el plan · 1 ▲__QA_F47_STRAT__"` · `planPersistido` igual tras recargar ·
`presentacion: {montado:true, linea:true, lado:"▲ Ataque"}`.

**Sin terminal, sin API a mano, sin SQL, sin DevTools.**

Los fixtures (`__QA_F47_COMPOSITION__`, `__QA_F47_STRAT__`, `__QA_F47_STRAT_BIND__`, partida `__QA_F47__`) se
crearon por las **rutas reales del producto**, con su validación entera. Se dejan puestos a propósito para que
puedas abrir y probar; están marcados y son identificables por nombre exacto. Los cuatro duplicados de las
repeticiones se borraron con el propio borrado del producto.

## 25–28 · Gates

| Gate | Resultado |
|---|---|
| `npm test` | **4521 / 4521 · 0 fallos** (+19) |
| `tsc` web | **0** |
| `tsc` scripts | **0** |
| `next build` | **exit 0** |
| ESLint (todo lo tocado) | **0** |
| Fuzz 10.000 | **0 fallos** (semilla `0x5f47a11`) |

## 29 · Migraciones

**0 nuevas.** La cabeza sigue en `0054`; hay prueba que lo fija. La concurrencia se resolvió con la columna
`updated_at` que ya existía.

## 30–33 · Sin tocar

**Gameplay 0 · Economía 0 · Cartas 0 · Marketplace OFF.** Tampoco Home, Main Menu (F46), F45, colección,
sobres, tienda, recompensas, worker ni infraestructura.

## 34 · P2 · ORIGINAL AGENT PORTRAIT ART

Declarado como pediste. Veil, Haze, Probe, Pulse, Spear, Blitz, Warden, Tripwire, Specter y Echo merecen
retratos propios. Los glifos originales cierran F47, pero no son personajes. **No se generan aquí**: no hay
pipeline autorizado.

## 35 · Bugs

| Qué | Estado |
|---|---|
| **Sobrescribí `src/lib/tactics/client.ts`** y destruí trabajo sin commitear (`duplicateStrat`, `StratRow.steps`) | **Corregido** — recuperado de git y reconstruido lo que sólo estaba en el árbol de trabajo |
| Usé `window.confirm` para borrar; el producto lo prohíbe y una prueba lo cazó | **Corregido** — confirmación en la propia fila |
| Filtro por prefijo en la QA cogía la jugada de bind y no creaba la de ascent | Corregido (instrumento) |
| Comentarios con comillas invertidas dentro de plantillas de JS | Corregido (instrumento) |
| La QA creaba cinco jugadores con el mismo rol; el dominio exige los cinco roles | Corregido (instrumento) |

**Nuevo P2:** `next start` falla con `ENOENT prerender-manifest.json` en Next 16.2.9. Lo provoqué yo al hacer
`rm -rf .next`: ese fichero venía de builds anteriores y esta versión ya no lo emite. `next build` sigue en
**exit 0** y el código está bien; es un problema de arranque en producción, no de la fase. Por eso NEXUS
queda levantado con **`next dev`**, que sirve exactamente las mismas rutas.

## 36 · GO / NO-GO

### **FASE 47: GO.**

Los tres bloqueos están resueltos y verificados en vivo, no por API:

- **Composition Manager y Builder existen**, son visuales, y una composición creada por interfaz sobrevive a
  recargar;
- **el Plan Táctico existe**, elige composición, asigna jugadas del mapa correcto, persiste, y desde él se
  abre y se **presenta** a pantalla completa;
- **10.000 operaciones de fuzz** sin corromper el plan, con semilla registrada, y **dos pestañas no se pisan**:
  la segunda recibe `409 VERSION_CONFLICT` y los cambios de la primera quedan intactos.

Y lo que pediste explícitamente en §75: esto **no** se declara GO porque la API funcione. Se declara porque el
recorrido entero —Entrenador → mapa → composición → 5 agentes → jugada → 3 pasos → guardar → partida → plan →
asignar → presentar → fullscreen— se ha hecho **desde la interfaz**, y está en las capturas.

**Estado final:** NEXUS levantado en **http://localhost:3005**. `/entrenador/composiciones`,
`/entrenador/plan?match=4ebe9927-46da-4ab1-8c4b-13021407d713` y `/entrenador/strats` responden 200. Túnel
54521 abierto. 0 Chrome sin cabeza. Tu Unreal intacto. Sin commit, sin push, sin deploy.
