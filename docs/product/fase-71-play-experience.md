# Fase 71 · Play Experience 2.0

**Fecha:** 2026-09-28 · **Build:** `drl-0.1.1-1-07198d70` (baseline F70.1: `f3ed79f2`) · **App:** `127.0.0.1:3005`, gestionada por la tarea «DRLCards» y su supervisor (F70.2).
**Evidencia:** `docs/product/qa/fase71/`, con los json y 8 capturas pequeñas en `shots/` (git ignora las capturas y `raw/`).

## Veredicto: GO

Es una fase solo de presentación y contenido visual. El motor, las reglas, las stats, la IA, la economía, las cartas, los agentes y la BD no cambian. La huella dorada del motor (`F61 MOTOR 01`) sigue en verde y no hay migraciones (cabeza 0058).

## 1. JUGAR: ver → elegir → jugar

| Antes | Después |
|---|---|
| `/jugar` con un héroe de RtC, 4 tarjetas de modos, la franja del Coach, los desafíos del día, los capítulos y los enlaces de gestión | `/jugar` con **3 paneles grandes**: ROAD TO CHAMPIONS, DUELOS y TACTICAL COACH. Cada uno tiene arte propio, título, un CTA y como mucho una microlínea (p. ej. «7/15») |
| `/duelos` era el hub antiguo de la Fase 8 (equipos, repeticiones, PvP) | `/duelos` con **4 paneles**: PARTIDA RÁPIDA (JUGAR), COMPETITIVO (JUGAR y «#pos · rating» si existe), RETAR A UN AMIGO (RETAR) y DRAFT GAUNTLET (JUGAR y «Combate n/5» si hay run). Debajo, «Mis equipos» y las repeticiones plegadas |

- **Estructura:** JUGAR → { ROAD TO CHAMPIONS `/jugar/road-to-champions` · DUELOS `/duelos` → { `/duelos/jugar`, `/competitivo`, `/social`, `/jugar/draft-gauntlet` } · TACTICAL COACH `/entrenador` }. Todos los enlaces profundos siguen vivos, y los «Volver a Duelos» aterrizan ahora en el hub de duelos.
- **Estados y destinos** siguen saliendo de `gameModes()`, con los mismos ids y el mismo orden. Solo se añaden ayudantes de presentación (`duelModes`, `duelModeCta`, `duelModeNote`, `campaignAreaCta`).
- **Texto medido:** 196 caracteres visibles en `/jugar` y 139 en `/duelos`, contando títulos. Un test fija el presupuesto: menos de 80 caracteres «de lectura» por pantalla y ningún párrafo de más de 32.
- **Móvil (390):** columna única de paneles a ancho completo. A partir de `lg`, 3 o 4 columnas.
- **Partida en curso:** si hay partida abierta, un banner la ofrece primero. Con una partida PvE dice «Continuar partida» y no el nombre de un modo, porque los hechos no distinguen si viene de RtC o de partida rápida. Antes afirmaba «Road to Champions» para una partida rápida.

## 2. Temáticas de duelo (solo visual)

- **Sin migración.** Un tema es un fondo subido con el Asset Manager de F60, con un tipo nuevo, `background`. La BD lo admite desde 0007. La regla del CMS es PNG, WebP o JPEG, hasta 8 MB, de 1280×640 a 4096×2560 y proporción entre 1,3 y 2,6. La firma, la decodificación y el tamaño se validan en el servidor, que además genera un derivado de 960 px para móvil. Los datos del tema van en `assets.meta.duelTheme`: slug, nombre, estado, inicio y fin opcionales, prioridad, `isDefault` y revisión.
- **Selección pura** (`src/domain/duelThemes`):
  1. Evento: el tema activo y en fechas con mayor prioridad (desempate por inicio más reciente y luego por slug).
  2. Si no hay evento, el tema por defecto del panel (como mucho uno).
  3. Si tampoco hay, el **DEFAULT de código**: la arena de siempre, `nexus-champions`.
- **Fallback:** un tema no aprobado, sin URL, desactivado o con fechas corruptas no es candidato. En el navegador el fondo va en dos capas, tema encima y arena por defecto debajo. Si la imagen del tema falla, se ve la de siempre. Nunca hay duelo sin fondo.
- **Panel:** `/admin/duel-themes`, en el grupo Contenido. Permite ver el tema vigente ahora, subir un fondo, crear y editar, activar y desactivar, marcar el tema por defecto (desmarca el anterior) y retirar un tema (el fondo sigue en Assets).
- **Seguridad del panel:**
  - Todo pasa por `runAdmin` y `verifyAdmin`: anónimos y usuarios normales reciben 401.
  - El cuerpo va con lista blanca de campos y el fondo se referencia solo por id (uuid), nunca por ruta.
  - Hay concurrencia optimista (`expectedRev`) y cada cambio se audita en `content_audit_log`.
  - Un fondo usado por un tema cuenta como EN USO y no se puede borrar como huérfano.
- **Juego:** `/api/content/duel-theme` es pública y de solo lectura, con caché de 5 s en el servidor, y devuelve solo `{id, slug, name, wide, narrow, source}`. El cliente guarda el resultado 60 s y se descarga únicamente el fondo elegido.
- **Límite conocido:** `content_entity_version` (0057) no admite entidades nuevas sin migración. Por eso un tema recién activado tarda hasta 5 s en el servidor y hasta 60 s en un cliente ya abierto.

## 3. Stats y selector (la decisión, protagonista)

- **Los hechos del motor, verificados:** el duelo se juega con **3 stats de combate: SH, GS y EF**. Las seis impresas (DMG, SCR, FKS, HS, AST y CLU) no intervienen en el duelo. El atacante elige una de las tres y la del defensor la **impone la regla**. Como no se cambian reglas para acomodar la UI:
  - al **atacar** hay 3 bloques grandes (abreviatura, nombre y el valor real de la carta);
  - al **defender** hay 1 casilla «OBLIGADA».
  
  Las seis impresas se siguen viendo en la carta, sin cambios.
- **Colocación:**
  - En ≥1024 px, una **columna derecha** con la instrucción, los bloques (76 px de alto) y el CTA de siempre («Declarar y atacar» o «Responder»).
  - En pantallas estrechas, una hoja inferior en el flujo, por encima de la mano y sin taparla ni cubrir la carta.
- **Estados:** hover, foco visible y elegida. La elegida se marca con «✓ Elegida», `aria-pressed` y un borde, sin depender del color. Se puede elegir con teclado (flechas, Enter y Espacio), comprobado en navegador real.
- **Valores:** son los de la carta tal cual (`card.combat`), sin recalcular. Los números de la carta elegida se ven más grandes.

## 4. Pistas del rival

- **Una pista por carta oculta:** PAÍS, LIGA·REGIÓN, EQUIPO o ROL. En el dorso se ven el rótulo y el dato: bandera por imagen más código ISO, siglas de liga, sigla del equipo o abreviatura del rol. Sin foto, sin silueta, sin OVR, sin stats y sin edición.
- **La calcula el servidor:**
  - PvE y Draft: en `toPublicView`/`toDraftView`, con el mazo del bot, que solo existe en el servidor.
  - PvP: en `projectMatchFor`, antes de redactar la vista para cada jugador.
  - El cliente solo recibe `{type, value}` y nunca la carta.
- **Determinista:** el tipo sale de FNV-1a(`matchId:uid`) mod 4 (si ese dato está vacío pasa al siguiente; el rol siempre existe). La lista se ordena por un segundo hash, así que no delata el orden del mazo. Los dos jugadores de PvP ven la misma pista para la misma carta. No hay azar del navegador y la IA no se toca.
- **Auditoría de información oculta:**
  - Los tests comprueban que el JSON de la vista PvE y de las proyecciones PvP A y B no contiene uid, cardId, playerId, nick ni OVR de cartas ocultas.
  - **Hallazgo previo, no modificado:** en PvE y Draft, `rivalSumOvr` es el OVR total del mazo del bot, incluidas las cartas ocultas. En PvP solo suma las visibles. Lo fija `F61 UI 03` como decisión de diseño. Es un agregado, no un dato por carta; queda anotado como decisión pendiente.
- **Corregido en la verificación real:** Windows no pinta los emojis de bandera (salía «US US»). Ahora la bandera es la imagen que ya usan las cartas.

## 5. Gates

| Gate | Resultado |
|---|---|
| `npm test` | **5.479/5.479** |
| tsc web / scripts | PASS / PASS |
| Lint | 0 errores (27 avisos, los de siempre) |
| Build | `drl-0.1.1-1-07198d70`, servida por el supervisor y coincidente con el código |
| `npm run gate:browser` (Chrome real, SW activo) | **41/41**. Recorrido: JUGAR (3 áreas) → entradas RtC y Coach → DUELOS (4 modos) → PARTIDA RÁPIDA → carta → selector a la derecha → «Elegida» → pista del rival → el servidor resuelve el turno (0 fetch fallidos, 0 errores de consola). Además, compra de Bronce y logout |
| `_fase71-duel-sizes` | PASS a 1440, 1024 y 390, en ataque (3 bloques de ≥ 64 px, teclado) y en defensa (obligada). Sin scroll horizontal y sin tapar la mano |
| `_fase71-theme` (navegador real) | PASS en los tres casos: tema de evento sobre la arena; imagen del tema rota con la arena visible; sin tema, DEFAULT |
| Recorrido F70 (PvE, Coach, perfil, logout y login) | 14/14 |
| `smoke:production` | 74/74 |
| `production:check -- --app --vps` | 24 PASS · 1 WARN (SMTP) · 1 FAIL (off-site `NOT_CONFIGURED`), ambos externos. `build` PASS |
| Libro de créditos | 12/12 cuentas QA OK (`reconcile-f71.json`) |
| F70.1 | Caché del SW: solo `nexus-v3` + `/offline.html`, sin HTML personal (en el gate). `sw.test` en verde |

**Precondición QA:** la cuenta QA K se quedó sin saldo (605) tras las compras de los gates. El gate ahora lo identifica como precondición y se ejecuta con otra cuenta QA con saldo.

## Pendiente

- Para ver una temática real en producción hace falta que un admin (David) suba un fondo y cree el tema en `/admin/duel-themes`. En esta fase no se crearon datos de admin.
- `src/components/modes/TacticalCoachEntry.tsx` ya no se usa. Se deja en su sitio: es trabajo sin commitear y borrarlo no se puede deshacer.
- Hay instrumentos antiguos fuera de CI (`_fase68-beta`, `_fase44-*`, `_fase39-real-e2e`, `_fase51-shots`) que aún pulsan `mode-cta-QUICK` en `/jugar`. En F71 ese botón vive en `/duelos` como `duel-mode-cta-QUICK`.

## F71.1 · Selector de estadística a todo el lateral

**Build:** `drl-0.1.1-1-99708f57`, servida por el supervisor. Solo cambia la UX: SH, GS y EF, los valores, las reglas y el motor siguen igual.

- **Escritorio (≥1024):**
  - La columna de decisión se estira de debajo del HUD al pie de la mano (`self-stretch`).
  - Es más ancha: `clamp(264px, 25vw, 400px)`, frente a los 228–290 px de F71. Mide 360 px a 1440 y 264 px a 1024.
  - `contain: size` evita que el panel empuje la rejilla, así que termina donde termina la mesa.
- **Tres tercios de toda la altura:** filas `minmax(0,1fr)`. Miden 203 px a 1440 y 153 px a 1024, frente a los 76 px de F71.
  - Cada tercio es un `<button>` de altura completa, clicable en toda su superficie.
  - La sigla mide hasta 54 px y la cifra hasta 92 px; las dos se acotan también por el alto de la ventana.
  - Debajo van el nombre y la descripción. «✓ ELEGIDA» va en la columna izquierda del bloque y nunca pisa la cifra.
- **Tras elegir:** las otras dos opciones bajan a opacidad 0,55, pero siguen visibles.
- **Defensa:** el mismo panel en tercios. La obligada va destacada, con candado y «OBLIGADA». Las otras dos aparecen apagadas como «no disponible»: no son botones ni opciones.
- **390:** la hoja inferior de F71 se mantiene: tres bloques de 64 px en fila y, al defender, solo la obligada.
- **Entrada:** el panel aparece con un deslizamiento suave desde la derecha. Solo ocurre en escritorio y dentro de `prefers-reduced-motion: no-preference`, como exige el contrato de F64.
- **Dos defectos hallados al verificar en el navegador y corregidos:**
  - La instrucción tenía `flex-1`: se comía media columna y empujaba «Declarar y atacar» fuera del panel.
  - El panel se alargaba bajo la mano por una fila oculta de la rejilla.
  
  La sonda `_fase71-duel-sizes` comprueba ahora que el botón de confirmar se ve entero y que los tercios llenan el panel (≥ 55 %).
- **Verificación real:** ataque y defensa a 1440, 1024 y 390, todo PASS. Además, `gate:browser` 40/40, `npm test` 5.485/5.485, tsc web y scripts en PASS y lint con 0 errores.

## F71.2 · Laterales simétricos y «SH 58» a secas

**Build:** `drl-0.1.1-1-f9bb93bc`, servida por el supervisor. Solo cambia la presentación: motor, reglas, valores, cartas, pistas y temáticas siguen igual.

- **Fila externa bajo las cartas del enfrentamiento: fuera.** `DuelCard` gana `hideCombat` y la usan solo las dos cartas grandes de la mesa. El arte y las seis stats impresas (DMG…CLU) no cambian. La mano conserva su fila, porque es con lo que eliges carta y, al defender, marca el eje obligado.
- **Composición en `lg`:** tres columnas, rival (1, rojo) | mesa (2) | tú (3, cian). Los dos laterales miden lo mismo (`clamp(176px, 17vw, 300px)`: 245 px a 1440 y 176 px a 1024) y van a toda la altura (`self-stretch` + `contain:size`).
  - El disparador del historial pasa al pie izquierdo de la mesa; antes tapaba el lateral del rival.
- **Cada tercio es solo «SH 58»:** sigla y cifra enormes. Sin nombres largos ni descripciones, que siguen en el nombre accesible.
  - La elegida lleva un ✓ en la esquina; las otras quedan al 55 %.
  - Al defender, las tres siguen a la vista: la obligada destacada con una etiqueta corta (candado y «OBLIGADA» en `xl`; solo el candado en laterales estrechos) y las otras dos apagadas.
  - El largo «Obligado a responder con…» ya no se repite.
- **Lateral del rival (`arena/RivalStats.tsx`):** solo recibe `view.pendingRival?.card`, la carta que el servidor ya ha hecho pública porque el rival ha declarado.
  - Con la carta oculta muestra «SH ? · GS ? · EF ?». No hay dato que esconder: al navegador no le llega.
  - Con la carta revelada muestra sus cifras reales, con la declarada destacada.
- **390:** el rival va ARRIBA, como una tira compacta encima del enfrentamiento; las cartas en medio; tú ABAJO, en la hoja de tres en fila.
- **Arreglo del pliegue a 390:** el botón de responder se ve sin hacer scroll (810 de 844 px en defensa y 784 en ataque). Se ganó altura al quitar las filas bajo las cartas y la línea larga de «Obligado…»; los bloques miden 56 px.
- **Tests de fuga** (`duel.test.ts`, partidas reales del motor):
  - En PvE, con la carta rival OCULTA, no viaja ningún SH/GS/EF de cartas rivales no jugadas.
  - Con la carta REVELADA, viajan solo sus valores reales y los de las ya jugadas.
  - En PvP, las proyecciones de A y de B solo llevan jugadas o declarada, en los dos estados.
  - Hay un control negativo: el detector sí ve las cartas ocultas en la partida sin proyectar.
- **Tests de render:** V1–V9. Cubren sin fila, columnas 1/2/3, solo sigla y cifra, ataque y elegida, defensa y obligada, rival oculto y revelado, 390 y animación con movimiento reducido.
- **Verificación real** (`_fase71-duel-sizes`): ataque y defensa a 1440, 1024 y 390, todo PASS. Comprueba simetría, rival «?» y rival revelado, 0 filas SH/GS/EF fuera de la mano, el confirmar a la vista sin scroll y que el historial no tapa los laterales.
- **Gates:** `npm test` 5.491/5.491 · tsc web y scripts OK · lint 0 errores · smoke 74/74 · `gate:browser` 40/40 · production:check con build PASS (off-site y SMTP siguen como bloqueos externos).
