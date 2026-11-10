# FASE 9 — NEXUS PRODUCT EXPERIENCE + VISUAL OVERHAUL

> Estado: **cerrada**. Las diez sub-fases (9A–9J) están implementadas y verificadas.
>
> Regla de la fase, cumplida y demostrada: nada de lo cerrado en las Fases 1–8.5 se ha
> modificado —reglas de combate, `COMBAT_MATCHUP`, OVR, Combat Resolver, orquestador, bots,
> RNG, autoridad del servidor ni RLS existente—. `duel-balance:verify` lo comprueba sobre
> 180.000 partidas simuladas y `duel:e2e` sobre una partida real jugada con clics.
>
> **Índice**: Paso 0 (auditoría) · 9A sistema de diseño y armazón · 9B fondo dinámico, Card3D
> e inicio · 9C tienda e inventario · 9D rangos · 9E progresión · 9F economía · 9G duelos ·
> 9H entrenador · 9I mapas y pizarra · 9J pulido · verificación final · decisiones de producto
> · lo que queda pendiente.

---

## PASO 0 — AUDITORÍA DE LA APLICACIÓN ACTUAL

Auditoría hecha sobre el código real, no sobre la memoria del proyecto: 36 rutas
(`src/app/**/page.tsx`), 11 rutas de API, 5 servicios de servidor, 14 migraciones.

### 0.1 Inventario de rutas

| Bloque | Rutas | Líneas |
|---|---|---|
| Núcleo | `/` 305 · `/coleccion` 430 · `/inventario` 151 · `/tienda` 38 · `/ranking` 239 · `/cuenta` 233 | 1396 |
| Competición | `/torneos` 218 · `/torneos/[id]` 231 · `/pickems` 228 · `/eventos` 463 | 1140 |
| Duelos (Fase 8) | `/duelos` 186 · `/duelos/jugar` 374 · `/duelos/mazos` 273 · `/duelos/replay/[matchId]` 47 | 880 |
| Colección extendida | `/colecciones` 163 · `/colecciones/[slug]` 141 · `/logros` 180 · `/recompensas` 322 · `/mercado` 793 | 1599 |
| Entrenador / carrera | `/entrenador` 338 · `/entrenador/equipos` 199 · `/carrera` 138 · `/manager` 22 | 697 |
| Mundo vivo | `/mundo` 177 · `/noticias` 72 | 249 |
| Otros | `/abrir/[packId]` 21 · `/launcher` 14 · 9 × `/admin/*` | — |

### 0.2 Navegación duplicada

`AppShell` declara **14 entradas** en una lista lateral (7 primarias + 7 «Más»). Es la
estructura de una web con menú, no la de un videojuego. Y dentro de esas 14 hay
solapamientos reales:

1. **Tres entradas de colección**: `/coleccion` (el catálogo completo con filtros),
   `/inventario` (solo sobres sin abrir + duplicados) y `/colecciones` (sets con progreso).
   `/inventario` es un subconjunto estricto de `/coleccion` más los sobres.
2. **La compra está partida en tres**: `/tienda` (sobres normales, 38 líneas),
   `/eventos` (sobres de evento) y `/abrir/[packId]` (apertura). La propia `/tienda`
   tiene que explicar por texto que los sobres de evento están en otro sitio.
3. **Tres superficies de reclamación**: `/logros`, `/recompensas` y `/colecciones`
   reclaman recompensas cada una a su manera.
4. **El rango se enseña en `/` , `/ranking` y `/cuenta`** con tres presentaciones distintas.
5. **La carrera del entrenador está repartida en cuatro rutas**: `/manager` (22 líneas, casi
   un redirector), `/carrera`, `/entrenador` y `/entrenador/equipos`.

### 0.3 Sistemas existentes REUTILIZABLES (§27 — no duplicar)

| Sistema | Dónde | Estado |
|---|---|---|
| Rango competitivo | `src/domain/progression/rank.ts` | 8 escalones (Bronce→Radiante), función **pura** de `profiles.points`. Falta: SIN CLASIFICAR, subdivisiones I-III, NEXUS/CHAMPION. Se **extiende**, no se reescribe. |
| Nivel de cuenta | `src/domain/progression/levels.ts` | XP → nivel, curva cuadrática. Ya es independiente del rango. ✅ |
| Pase de batalla | `src/battlepass/` (8 módulos: engine, missions, season, xp, rewards, migrate, types) | **Motor completo y sin ninguna UI**: 0 referencias desde `src/app` o `src/components`. Soporta `daily/weekly/seasonal/event/special/hidden/repeatable/community/progressive`. |
| Logros | `src/domain/progression/achievements.ts` | Solo **8 logros**, contexto = sobres abiertos + cartas poseídas. No soporta repetibles ni diarios. El motor de misiones del pase **sí**. |
| Economía servidor | `credit_transactions` (0011) + RPC `app_adjust_credits`, `app_buy_pack`, `app_grant_reward`, `app_apply_pack_open` | Libro mayor real con clave de idempotencia (`ref`). Con sesión, **el servidor ya es la autoridad**; el store local es caché de presentación (`CloudSync`). |
| Motor de duelos | `src/domain/cardgame/`, `src/server/services/duels.ts` | Cerrado en Fases 6–8.5. **No se toca.** |
| Colección | `src/collection/` (CollectionEngine) | Proyección/filtro/orden ya centralizados. Reutilizable tal cual. |

### 0.4 Huecos reales (lo que Fase 9 sí tiene que construir)

1. **`profiles` no tiene `region` ni `country`** → la *posición europea* que pide §9D
   **no es computable hoy**. Requiere migración.
2. **No hay divisiones** dentro del rango (I-III) ni estado «SIN CLASIFICAR».
3. **El pase de batalla no tiene UI, ni precio configurable, ni persistencia servidor.**
4. **No existe ningún dominio de mapas / pizarra táctica / strats.** 9I es terreno virgen.
5. **No hay sistema de diseño**: `tailwind.config.ts` define colores y tres animaciones;
   no hay escala de espaciado, radios, elevación ni tipografía. Cada pantalla improvisa
   (`rounded-xl` vs `rounded-2xl`, `bg-white/[0.03]` vs `bg-base-700/30`, `text-white/50`
   vs `text-white/55` vs `text-white/40`).
6. **Componentes con aspecto de web genérica**: cabeceras `h1 + p` repetidas en 20
   pantallas, iconos emoji como sistema de navegación, sin fondos por contexto.

### 0.5 Decisión de arquitectura visual

La Fase 9 **no reescribe pantallas desde cero**: introduce una capa de sistema de diseño
(`src/design/`) y un armazón (`GameShell`) y **migra** las pantallas a ella. Todo lo que ya
es correcto por debajo (motores, servicios, API, RLS) se conserva intacto.

---

## 9A — SISTEMA DE DISEÑO Y ARMAZÓN

### Qué se ha construido

| Pieza | Fichero | Qué resuelve |
|---|---|---|
| Tokens | `src/design/tokens.ts` | Superficie, borde, texto, acento, semántica, rareza, radios, espaciado, tipografía, elevación, halos, duraciones, curvas, puntos de ruptura y alturas de cromo. **Fuente única.** |
| Consumo en Tailwind | `tailwind.config.ts` | Importa los tokens; no los redefine. |
| Capa CSS | `src/app/globals.css` | Custom properties, tinte por contexto y primitivas (`.nx-panel`, `.nx-card`, `.nx-label`, `.nx-rail`, `.nx-chrome`, `.nx-sweep`). |
| Navegación | `src/design/nav.ts` | 14 entradas → **5 secciones**. Fuente única de la barra superior, el menú móvil y los enlaces entre pantallas. |
| Armazón | `src/components/layout/GameShell.tsx` | Sustituye a `AppShell`, que se ELIMINA (no queda código muerto). |

### Decisiones que merecen explicación

1. **Los radios del sistema NO sobrescriben `rounded-sm/md/lg/xl`.** Se publican con nombres
   propios (`rounded-card`, `rounded-panel`, `rounded-stage`…). Sobrescribir la escala de
   Tailwind habría reflowado en silencio las 36 pantallas, incluida la de duelo, revisada y
   cerrada en la Fase 8.5. Así la migración es explícita, componente a componente.
2. **La escala numérica de espaciado tampoco se toca**: la de Tailwind ya es base-4 y en `rem`,
   y pasarla a píxeles habría roto el escalado por tamaño de fuente del navegador.
3. **La sección tiñe el producto** (`data-context` → `--nx-tint`). Sabes dónde estás antes de leer.
4. **Rutas inmersivas**: existe el mecanismo (`isImmersive`) pero de momento solo lo usa
   `/launcher`. `/duelos/jugar` y `/abrir/[packId]` entrarán cuando sus pantallas estén rehechas
   para ocupar el viewport; quitarles el armazón antes las dejaría sin márgenes ni salida.
5. **Coherencia de nombre**: la pantalla de arranque decía «DRL CHAMPIONS · Esports Manager»
   mientras la barra superior decía «NEXUS». Ahora las dos dicen NEXUS · Valorant Cards.

### Verificación

`npm run ux:verify` recorre **18 pantallas × 3 anchos** (390 / 768 / 1440) con un usuario real y
comprueba desbordamiento horizontal, presencia del cromo correcto en cada ancho, contexto activo,
contenido real y apertura del menú por teclado. Pasa entero.

---

## 9B — FONDO DINÁMICO, CARD3D E INICIO

| Pieza | Fichero |
|---|---|
| Fondo | `src/components/visual/DynamicGameBackground.tsx` — 8 variantes (home, duels, tournaments, collection, packs, ranking, profile, world) |
| Carta 3D | `src/components/visual/Card3D.tsx` — 7 modos (static, hover, selected, reveal, legendary, packReveal, showcase) |
| Inicio | `src/app/page.tsx` |

**El fondo** son dos capas: luz (CSS, gratis) y un campo de partículas en `canvas` solo en las
variantes que lo piden. El bucle se **detiene con la pestaña oculta** y se apaga entero con
`prefers-reduced-motion` — dos lecciones directas de la Fase 8.5.

**`Card3D` es un ENVOLTORIO**, no otra carta: la dibujan `PlayerCard` y `DuelCard`, y esto solo
añade volumen. Duplicar el dibujado habría creado un segundo sistema de cartas (§27). La
inclinación es solo para puntero fino: con el dedo encima, girar la carta la esconde.

**El inicio** pasa de panel de control (seis bloques del mismo peso) a vestíbulo, y responde en
orden a: qué está pasando · a qué juego · cómo voy. Mismos datos y mismas funciones de carga que
antes: no ha ganado ni una fuente nueva.

---

## 9C — TIENDA E INVENTARIO

- **`/tienda` enseña TODO el catálogo**: sobres permanentes y de evento. Antes tenía un párrafo
  explicando que los de evento estaban en otro sitio, que es la señal más clara de que la
  información estaba mal repartida. Los de evento se siguen consiguiendo en el Centro de Eventos
  —no cambia ninguna regla de disponibilidad—, pero dejan de estar escondidos.
- **El arte del sobre** era un cuadrado con la letra «D» dentro. Ahora se dibuja el mismo
  `SealedPack` que se ve al abrirlo, a escala: lo que compras y lo que abres son la misma pieza.
- **`/inventario`** migrado al sistema de diseño, con las dos cifras que se comprueban de un
  vistazo en cabecera y un enlace explícito a `/coleccion`.

---

## 9D — SISTEMA DE RANGOS

### Dominio (`src/domain/progression/rank.ts`)

| Antes | Ahora |
|---|---|
| 8 escalones planos, Bronce→Radiante | 9 escalones: **Sin clasificar** → Bronce → Plata → Oro → Platino → Diamante → Maestro → Élite → **Nexus** |
| 0 puntos = Bronce | 0 puntos = Sin clasificar. Hay que puntuar para entrar en la escalera |
| Sin divisiones | **I · II · III** en los siete rangos intermedios |
| Sin cúspide | **Champion**: no es un umbral, es una POSICIÓN — el primero del mundo dentro de Nexus |
| Solo posición global | Global **y regional** |

**Decisión de producto documentada**: la división **I es la de ENTRADA** y la III la más alta,
como en VALORANT (Hierro 1 → Hierro 3), que es el juego del que viene el público. La convención
española con números romanos es la contraria, así que era ambiguo y queda escrito. Invertirlo es
cambiar `DIVISION_I_IS_ENTRY` y nada más.

### El hueco que había que tapar

`profiles` **no tenía región**: la posición europea que pide la Fase 9 no era difícil de
calcular, era imposible. `0015_rank_region.sql` añade `region` con las cuatro regiones del
circuito (las mismas que ya usa el catálogo de cartas: no se inventa una taxonomía paralela), sus
índices y dos vistas (`ranking_points` ampliada y `ranking_points_region`).

«Europa» en la clasificación **es EMEA**, que no es lo mismo. Por eso en la interfaz se escribe
«Europa · EMEA» y nunca solo «Europa». `NULL` es válido y significa «sin región declarada»: ese
jugador cuenta en la global y no en la regional. No se le asigna una por defecto, porque inventar
de dónde es alguien es peor que no saberlo.

### Seguridad

`region` es el primer privilegio de escritura NUEVO que se concede al cliente sobre `profiles`
desde SEC-02. `supabase/tests/0015_rank_region_test.sql` demuestra 6 invariantes contra la base de
datos real: se puede declarar y retirar; una región inventada la rechaza el CHECK; no se puede
tocar la de otro; **`points` sigue siendo solo del servidor**; y acompañar `region` de una columna
protegida en el mismo UPDATE no la desbloquea. Los 6 pasan.

### Tests

`rank.test.ts` pasa de 7 a **15 tests**. Los dos que codificaban «0 puntos = Bronce» se actualizan
con un comentario que explica que el cambio es deliberado; su intención original —que la función
nunca devuelva `undefined`— se conserva intacta. Ningún test se borró.

---

## 9E — PROGRESIÓN: PASE, MISIONES Y LOGROS

### El punto de partida

El motor del pase (`src/battlepass/`, 8 módulos) estaba completo desde la Fase 6 de Colección y
**no tenía ni una temporada definida ni una sola referencia desde la interfaz**. Los logros eran
8, se calculaban en el navegador y `claimAchievement` **sumaba créditos en `localStorage`** —lo que
prohíbe §25— y además se revertían en la siguiente sincronización.

### Los tres carriles

| Carril | Cómo se abre | Qué reparte |
|---|---|---|
| **Libre** | Nada | Créditos y sobres, en cada uno de los 30 niveles |
| **Competitivo** | Llegar a **Oro** (400 pts). Se juega, no se compra | Créditos y sobres, en 6 hitos grandes |
| **De pago** | 5,99 € *(anunciado)* o **1200 fichas** | **Solo cosmética**: avatares, marcos, banderines, títulos |

Ese reparto **es §29 llevada al detalle**: el dinero no puede comprar ventaja competitiva, así que
todo lo que acaba influyendo en un duelo vive en los carriles que se ganan jugando.
`src/battlepass/tracks.test.ts` lo comprueba **sobre los datos reales de la temporada**: si alguien
mete créditos o un sobre en el carril de pago, el test falla.

### Pagos reales: NO (§12)

No hay infraestructura de pago segura, así que **no se integra ninguna pasarela**. El precio se
anuncia desde `src/config/monetization.ts` (`PAYMENTS_ENABLED = false`) y el botón está
deshabilitado con su motivo escrito. La vía que sí funciona es la de fichas, que se ganan jugando.
**El catálogo de paquetes de créditos se deja vacío a propósito**, y eso también es una decisión, no
una tarea pendiente: vender créditos sería vender sobres, y los sobres deciden duelos.

### Servidor

`0016_progression.sql` añade `user_pass`, `user_achievements` y `user_cosmetics`: RLS activada,
**lectura propia sí, escritura ninguna**. Todo lo escribe `service_role` desde
`src/server/services/progression.ts`, y las recompensas salen por `app_grant_reward`, la RPC que ya
existía, con su clave de idempotencia y su asiento en `credit_transactions`. No se creó una segunda
ruta para dar créditos.

Las métricas de las misiones **no se guardan**: se calculan de las tablas donde ya vive cada cifra
(`profiles`, `user_cards`, `duel_matches`, `duel_decks`, `pickem_answers`). Duplicar un contador es
la forma más segura de que las dos copias dejen de coincidir. La única concesión es
`duel_matches.winner`, una columna **derivada** que existe para contar victorias con un índice en vez
de abrir un jsonb por partida; la fuente sigue siendo `state`, y la escribe el mismo servicio a
partir de lo que dice el Combat Resolver.

### Verificación

`npm run progression:verify` — **28 comprobaciones contra la API y la base de datos reales**, todas en
verde: sin token no se responde; el cliente no puede escribir en ninguna de las tres tablas ni en
sus propias filas; los carriles bloqueados rechazan el reclamo; un logro sin completar no se paga;
reclamar dos veces deja **un solo asiento** en el libro mayor; mandar `premium: true` en el cuerpo no
abre nada; y el progreso de un usuario no aparece en el de otro.

---

## 9F — ECONOMÍA DE CRÉDITOS

### Lo que ya estaba bien

La auditoría del Paso 0 encontró que **la economía ya era del servidor** cuando hay sesión:
`credit_transactions` es un libro mayor real con clave de idempotencia (`ref`), las compras
pasan por `app_buy_pack`, las recompensas por `app_grant_reward`, y `CloudSync` **lee** del
servidor en lugar de subir el estado local. La Fase 9F no reescribe nada de eso: lo cierra.

### Lo que se cierra

1. **Se retira el último atajo de `localStorage`.** `useGameStore.claimAchievement` sumaba
   créditos en el navegador. Fuera. El comentario que queda en su sitio explica por qué, y
   `security:verify` comprueba que no vuelve.
2. **El catálogo es configurable y vive en un solo sitio**: `src/config/monetization.ts`.
   Ninguna pantalla escribe un precio a mano —hay un test que lo comprueba.
3. **No se venden créditos.** `CREDIT_PACKAGES` está vacío **a propósito**, y eso es una
   decisión documentada, no una tarea pendiente: los créditos compran sobres, los sobres dan
   cartas y las cartas deciden duelos. Vender créditos sería vender ventaja competitiva (§29).
   La estructura queda escrita para el día que se venda algo que no afecte al duelo.
4. **No hay pasarela de pago** (§12). `PAYMENTS_ENABLED = false` es el único interruptor;
   la interfaz ya está escrita para los dos casos.

### Verificación

`security:verify` incorpora una sección nueva —**14 comprobaciones**— sobre §25: que el store
local no concede logros, que las tres tablas de progresión deniegan toda escritura al cliente,
que el precio vive en la configuración y que no hay pasarela activada.

---

## 9G — DUELOS A PANTALLA COMPLETA Y CONSTRUCTOR DE MAZOS

### La arena

`/duelos/jugar` es ahora una **ruta inmersiva**: el armazón se aparta y la partida ocupa el
viewport entero, sin barra de secciones ni menú. Un juego no te enseña el menú principal
mientras juegas.

A cambio, la arena trae su propio cromo: una barra de 56 px con el mazo, el turno, la
dificultad, **el marcador y una salida siempre visible**. El marcador está ahí *además* de en
el tablero a propósito: al hacer scroll en móvil el del tablero se va, y cómo vas es lo único
que no se puede perder de vista.

**Lo que NO cambia**: el reparto interno del tablero, el orden de la mano en móvil, la
revelación y el marcador —todo eso se revisó jugando y se cerró en la Fase 8.5—. Y por debajo,
absolutamente nada: mismo orquestador, mismo Combat Resolver, mismas reglas.

### El constructor

El mazo vivía en una columna lateral de 320 px con las diez cartas a tamaño `xs`: **la pieza
que estabas construyendo era la más pequeña de la pantalla**, y en móvil había que hacer
scroll para verla. Ahora ocupa la franja superior a lo ancho, con diez huecos que se llenan a
la vista, y la colección queda debajo, que es donde se busca.

Un detalle que parecía cosmético y no lo era: las cartas ya colocadas en el mazo se marcan como
`selected`, que es lo que hace que anuncien `aria-pressed="true"`. Sin eso, una carta *ya en el
mazo* se presentaba como no elegida a un lector de pantalla —y a cualquier automatismo—, y el
guion de capturas lo demostró añadiéndola y quitándola sin que se notara.

Un pulido más, encontrado por la propia herramienta de QA: el enlace de salida de la
preparación medía **64×14 px**. En una pantalla inmersiva es la única salida, y a 390 px un
objetivo de 14 px de alto no se acierta con el pulgar.

### Verificación

`duel:e2e` —15 pasos con clics reales, partida completa de diez turnos y repetición— **pasa
entero** después del cambio. `duel:shots` confirma **0 zonas táctiles por debajo de 32 px** a
390 px, cuando antes había una.

---

## 9H — ENTRENADOR: DE SIMULADOR A CENTRO DE MANDO

`/entrenador` **era** el simulador: al entrar te caía encima un partido en marcha con su HUD de
retransmisión. Todo lo demás del rol —equipos, alineaciones— vivía en rutas que no se enlazaban
entre sí: si no sabías que existían, no existían.

Ahora la raíz es el vestíbulo y el partido vive en `/entrenador/partido` (misma pantalla, solo
movida). El vestíbulo enseña:

| Sección | Estado |
|---|---|
| Equipos y alineaciones | `/entrenador/equipos` — la misma pantalla, y el texto lo dice: una alineación es un equipo con sus titulares marcados |
| Mapas | `/entrenador/mapas` — nuevo |
| Strats | `/entrenador/strats` — nuevo |
| Preparación y simulador | `/entrenador/partido` — **deshabilitado con su motivo** hasta tener cinco titulares |
| Carrera | `/carrera` |
| Historial | **Por definir**, y así se marca |

Sobre el historial: los partidos dirigidos no se guardan en ningún sitio. Se declara como
pendiente en lugar de poner un botón que lleve a una pantalla que no existe.

---

## 9I — MAPAS, PIZARRA Y ESTRATEGIAS

### Los mapas son PROPIOS

Ni el trazado, ni los nombres, ni las zonas vienen de VALORANT ni de ninguna herramienta
existente (§0.6). Lo que se reproduce es la **gramática del género** —dos bases, sitios de
plantado, un centro y sus cuellos de botella—, que no es propiedad de nadie.

Cuatro trazados con problemas distintos, no cuatro variaciones del mismo:

| Mapa | Sitios | Qué error castiga |
|---|---|---|
| **Terminal** | 2 | Perder el centro: quien lo controla elige el sitio |
| **Cantera** | 1 | Atacar sin coordinar un embudo con tres entradas |
| **Órbita** | 2 | Leer mal al rival, porque rotar es barato |
| **Meridiano** | 2 | Fallar la lectura, porque rotar cuesta caro |

Las coordenadas están normalizadas a una rejilla 0..100: el mismo mapa sirve para una pizarra
de 320 px y para una de 900 sin recalcular nada, y una posición guardada hace un año sigue
significando el mismo punto.

### La pizarra

SVG con `viewBox="0 0 100 100"`, así que las coordenadas del dominio se pintan **tal cual**.
Punteros en lugar de ratón (`setPointerCapture`, para que arrastrar siga funcionando cuando el
dedo se sale de la ficha) **y teclado**: cada ficha es enfocable y las flechas la mueven de 2
en 2 unidades, o de 0,5 con Shift. Una pizarra que solo funciona arrastrando deja fuera a quien
no puede arrastrar.

La punta de cada flecha es un tirador propio: sin él, el destino de un movimiento solo se
podría fijar escribiendo coordenadas, que es justo lo que una pizarra existe para evitar.

**La pizarra no decide nada.** No simula la ronda, no calcula probabilidades y no toca el motor
de partido. Es la pizarra del entrenador llevada a datos, y eso es todo lo que promete.

### Seguridad — la tabla distinta

`user_strats` es **la única tabla de la Fase 9 en la que el cliente escribe sus propias filas**,
porque una estrategia es contenido suyo: no concede nada, no puntúa y no afecta a ningún duelo.
Eso la convierte en la que más hay que probar, y por eso se blinda en tres capas:

1. **RLS** con `user_id` comprobado en `using` **y** en `with check`: nadie crea ni mueve una
   estrategia a nombre de otro.
2. **Saneado en el servidor.** RLS filtra filas, no CONTENIDO: por PostgREST se podría guardar
   un jsonb de diez megas con coordenadas de un millón. La ruta pasa todo por `sanitizeStrat`
   —la misma función que usa el editor— antes de escribir.
3. **Tope en la base de datos.** Un trigger corta a las 40 estrategias por usuario, porque a
   PostgREST se llega sin pasar por la aplicación.

### Verificación

`npm run strats:verify` — **25 comprobaciones** contra la API y la base de datos reales, todas
en verde, incluidas las tres que importan de verdad: por PostgREST no se crea a nombre de otro,
no se leen las de otro y no se modifican las de otro; y el tope lo impone la base de datos.

`tactics.test.ts` añade **18 tests**: mapas bien formados (polígonos válidos, dos bases, sitios
que coinciden con lo declarado), geometría (`zoneAt` con solapamientos: gana el cuello, no el
pasillo) y el saneado probado **con basura a propósito**.

---

## 9J — PULIDO, RESPONSIVE Y RENDIMIENTO

`npm run ux:verify` recorre **22 pantallas × 5 anchos** (390 · 768 · 1024 · 1440 · 1920) con un
usuario real. Lo que encontró y lo que se hizo:

### 1. Zonas táctiles

Chips de 26 px, botones de reclamar de 28, el aspa del aviso de instalación en 21×24 y enlaces
de vuelta de 64×14. Se arregló **subiendo el suelo en CSS** —todo `button` y todo enlace con
aspecto de control llega a 32 px— en vez de retocar treinta ficheros a mano, porque a mano la
siguiente pantalla nueva habría vuelto a nacer con el problema.

Un detalle que costó encontrar: la escapatoria `[class*="h-"]` (para que un control con altura
fija propia mande sobre el suelo) también capturaba `min-h-[36px]`, y anulaba justo la altura
que alguien había pedido a mano. Lleva un `:not([class*="min-h-"])`.

La regla de medida distingue **control** de **texto**: un botón necesita 32 px; un enlace
dentro de una frase, no —estirarlo rompería el párrafo—. Medirlo todo con la misma vara marcaba
como defecto la tipografía normal.

### 2. Peso del DOM

`/coleccion` pintaba **las 772 cartas del catálogo: 17.500 nodos**. En un móvil de gama media
eso se nota al desplazarse y al filtrar. Se pinta una tanda de 60 y el resto llega al pulsar.
No es virtualización —veinte líneas en vez de una librería— y baja la pantalla a ~1.500 nodos.
Ahora **las 22 pantallas están por debajo de 4.000**.

### 3. Errores de consola

Cero en las 22 pantallas. Los 404 de imagen se cuentan **aparte** y no fallan el gate: son arte
que falta en el catálogo, no un defecto del código —la aplicación ya los sustituye por su
marcador, con la caché negativa de la Fase 8.5—. Contarlos como fallo habría convertido un
hueco de contenido en un fallo de calidad y habría tapado los errores que sí importan.

### 4. Rendimiento del fondo

El campo de partículas **detiene su bucle con la pestaña oculta** y se apaga entero con
`prefers-reduced-motion`. Las dos cosas son lecciones directas de la Fase 8.5, donde se
comprobó que Chrome estrangula `requestAnimationFrame` en segundo plano.

---

## VERIFICACIÓN FINAL

| Comprobación | Resultado |
|---|---|
| `npm run typecheck` (web + scripts) | ✅ |
| `npm run build` | ✅ |
| `npm test` | ✅ **362 tests** (eran 326 al empezar la fase) |
| `npm run security:verify` | ✅ todas |
| `supabase/tests/0015_rank_region_test.sql` | ✅ 6 invariantes |
| `npm run progression:verify` | ✅ 28 comprobaciones |
| `npm run strats:verify` | ✅ 25 comprobaciones |
| `npm run ux:verify` | ✅ 22 pantallas × 5 anchos |
| `npm run duel:e2e` | ✅ partida completa con clics reales |
| `npm run duel-gameplay:verify` | ✅ |
| `npm run duel-balance:verify` | ✅ 180.000 partidas |
| `npm run test:e2e` | ✅ |

### Lo que NO se ha tocado (§0.6–12)

Reglas del combate · `COMBAT_MATCHUP` · OVR · Combat Resolver · Combat Rules (Fase 7) ·
Orquestador de turnos · Bots y su balance · RNG · autoridad del servidor · RLS existente.
`duel-balance:verify` lo demuestra sobre 180.000 partidas simuladas, y `duel:e2e` sobre una
partida real jugada con clics.

---

## DECISIONES DE PRODUCTO TOMADAS EN ESTA FASE

Se documentan en lugar de presentarlas como si vinieran de algún sitio:

| # | Decisión | Por qué |
|---|---|---|
| 1 | **La división I es la de ENTRADA**, la III la más alta | Como en VALORANT (Hierro 1 → Hierro 3), que es de donde viene el público. La convención española con romanos es la contraria, así que era ambiguo. Se invierte cambiando `DIVISION_I_IS_ENTRY` |
| 2 | **Champion es posicional**, no un umbral | Un rango que se alcanza acumulando no distingue a nadie del que va detrás. Lo ocupa el primero del mundo dentro de Nexus, y solo puede haber uno |
| 3 | **«Europa» en la clasificación es EMEA** | Es la región del circuito y la que ya usa el catálogo de cartas. No es lo mismo que Europa, y por eso la interfaz escribe «Europa · EMEA» |
| 4 | **La región la declara el usuario; `NULL` es válido** | El servidor no puede saberla y adivinarla sería inventar un dato. Sin región se compite en la global y no en la regional, y la pantalla lo dice |
| 5 | **El carril de pago del pase es SOLO cosmética** | §29: el dinero no compra ventaja competitiva. Todo lo que influye en un duelo está en los carriles que se ganan jugando. Hay un test sobre los datos reales de la temporada |
| 6 | **No se venden créditos** | Comprar créditos es comprar sobres, y los sobres deciden duelos. El catálogo se deja vacío y documentado |
| 7 | **El carril competitivo se abre en Oro** | Un premio por competir tiene que exigir haber competido |
| 8 | **`duel_matches.winner` es una columna derivada** | Contar victorias abriendo un jsonb por partida no escala. La fuente sigue siendo `state`, y la escribe el mismo servicio desde lo que dice el Combat Resolver |

## LO QUE QUEDA DECLARADO COMO PENDIENTE

Ninguna de estas cosas se ha disimulado con una pantalla que aparente funcionar:

1. **Historial de partidos del entrenador.** No hay persistencia. Marcado «Por definir» en el
   vestíbulo del entrenador.
2. **Materiales de crafteo como recompensa.** `Reward` los admite, pero solo existen en el
   store local: no hay tabla ni RPC que los conceda. No se reparten hasta que exista esa ruta.
3. **Pasarela de pago.** §12. El precio se anuncia; la compra con dinero real está
   deshabilitada con su motivo escrito, y la vía de fichas sí funciona.
4. **`/abrir/[packId]` no es inmersiva todavía.** El mecanismo existe (`isImmersive`); esa
   pantalla aún depende de los márgenes del armazón.
5. **Arte que falta.** Fotos de jugador y escudos ausentes en el catálogo. La aplicación los
   sustituye; el informe de UX los cuenta aparte.

6. **El nombre del producto en los metadatos.** La interfaz dice NEXUS en todas partes donde
   la ve un jugador: la barra superior, la pantalla de arranque, el aviso de instalación, el
   arte de los sobres, el intro de partido y la pantalla de carga. Los METADATOS
   (`applicationName`, título, Open Graph, manifiesto) siguen diciendo «DRL Champions», y se
   dejan así a propósito: cambiarlos altera la identidad de la aplicación instalada, la
   tarjeta que se ve al compartir un enlace y el icono que ya tienen quienes la instalaron.
   Es una decisión de producto que se sale del alcance de un rediseño visual, y se deja
   apuntada en lugar de tomarla por cuenta propia.
