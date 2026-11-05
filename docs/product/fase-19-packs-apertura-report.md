# Fase 19 — Packs y apertura de sobres: la experiencia visual

**Resultado: la ceremonia completa del encargo está implementada sobre el sistema REAL, y el
acto que faltaba —las cartas boca abajo— ya existe.** 74/74 comprobaciones de una apertura
real verificada contra la base de datos, 845/845 tests, typecheck y build limpios.

No se ha tocado la economía, ni las probabilidades, ni el acuñado, ni los seriales, ni las
reglas del motor de cartas. No se ha inventado ni una carta, ni un jugador, ni un sobre, ni una
probabilidad. No se ha creado ningún `V2`: las piezas existentes se han evolucionado.

**No se ha hecho commit, ni push, ni despliegue.**

---

## 0 · La conclusión de la auditoría, primero

La radiografía inicial cambió el encargo. **Esto no era un sistema ausente: era un sistema al
que le faltaba un acto.** Ya existían y funcionaban:

| Pieza | Estado previo |
|---|---|
| `/tienda` → `ShopHero` + `ShopRail` | Vitrina y carril ya implementados (§4 casi cubierto) |
| `/abrir/[packId]` → `PackOpeningExperience` | Ya inmersivo (`IMMERSIVE_ROUTES`), con 5 actos |
| `CardReveal` + `ceremony.ts` | Reveal 1-a-1, anillo de carga, heraldo, `dim`/`rays`/`ring`/`shards`/`burst` por rareza **real** (`variant.animation`, del dominio) |
| `SealedPack` | Sobre por capas: foil, costura perforada, solapa que se levanta con `cutProgress` |
| Servidor | `/api/game/packs` → `PackEngine`→`openPack`→`Minter`, semilla criptográfica, idempotencia en `economy_ops` |
| Artwork | `CardVisual` por `uid` contra el mapa precargado — **sin N+1** |
| Sonido | `lib/sound.ts` sintetizado: `primeAudio`, `playCutTick`, `playBurst`, `playReveal(rank)` |

**§8, §9, §14, §16, §17 y §18 del encargo estaban ya satisfechos.** Rehacerlos habría sido
exactamente el sistema paralelo que prohíbe §19.

### Clasificación

**P0 — el acto que faltaba**

1. **Las 5 cartas boca abajo NO EXISTÍAN.** El flujo iba de `rupture` directamente a
   `CardReveal` de la carta 1. Entre «el sobre se ha partido» y «esta es tu primera carta» no
   había nada: el jugador nunca veía su tirada como un CONJUNTO, que es lo que se compra al
   comprar un sobre. Es la fase 5 del §6 y era el hueco más grande.
2. **§7 «las otras cartas visibles pero atenuadas»**: `CardReveal` pintaba SOLO la carta
   activa. Las otras cuatro no estaban en pantalla hasta su turno.
3. **§11 última carta**: sin trato diferenciado.
4. **§13 «ABRIR OTRO SOBRE»**: el botón de mayor intención del producto **navegaba fuera** de
   la ceremonia (a `/inventario` o `/tienda`), expulsando al jugador del bucle.

**P1** — carta del reveal a 300 px fijos y piezas posicionadas en `bottom-N` (riesgo de
solape y de corte a 390); identidad del sobre limitada a UNA variable (`accent`), así que el
Inicial gratuito y el Icon de 20.000 créditos eran el mismo objeto de otro color.

**P2** — `PackStoreCard` (vivo en `/eventos`) duplica el trabajo de `ShopHero`. **No se ha
tocado** más allá de adaptar su llamada; queda como deuda.

---

## 1 · Qué componentes modifiqué

| Fichero | Qué cambió |
|---|---|
| `src/components/packs/PackOpeningExperience.tsx` | **Reescrito.** Sexto acto (`hand`), abanico persistente en el reveal, bucle en el sitio, resumen con datos legibles, `env(safe-area-inset-*)`, capas `z-*` del sistema en vez de `z-[60]` |
| `src/components/packs/CardReveal.tsx` | **Reescrito.** Usa `CardBack`, acepta `isLast`, emite la carga al abanico (`onCharge`), maqueta en FLUJO con hueco reservado, ficha con jugador/OVR/rol/equipo/variante/serial |
| `src/components/packs/SealedPack.tsx` | API pasa de `accent`+`name` a `pack: PackDef`; identidad visual por escalón; longhands de borde (arregla un aviso de React) |
| `src/components/packs/ceremony.ts` | **Añadida** `lastCardCeremony()` — sube intensidad, nunca identidad |
| `src/components/shop/ShopHero.tsx` | El sobre ENTRA al seleccionarlo (§4); llamada nueva a `SealedPack` |
| `src/components/shop/ShopRail.tsx` | Llamada nueva a `SealedPack` (1 línea) |
| `src/components/packs/PackStoreCard.tsx` | Llamada nueva a `SealedPack` (1 línea) |
| `src/app/tienda/page.tsx` | Llamada nueva a `SealedPack` (1 línea) |
| `src/app/inventario/page.tsx` | Llamada nueva a `SealedPack` (1 línea) |

> **Aviso de lectura del diff:** `src/app/tienda/page.tsx`, `src/app/inventario/page.tsx` y
> `src/components/shop/*` **ya estaban modificados/sin commitear al empezar la sesión** (el
> árbol tenía 429 ficheros tocados). Lo mío en esos cuatro es **una línea en cada uno**; el
> resto del diff es trabajo anterior, no de esta fase.

## 2 · Qué componentes reutilicé (sin duplicar)

`openPack` · `PackEngine` · `Minter` · `/api/game/packs` · `openPackOnline` ·
`openPackFromInventory` · `useGameStore` · `useEventsStore.recordPackOpened` · `CardVisual` /
`CardFace` / `useArtworkStore` / `artworkPintable` · `PlayerCard` / `CardRenderer` · `Card3D` ·
`ceremony.ts` · `Particles` (`AmbientParticles`, `ParticleBurst`, `Confetti`) · `lib/sound`
(incluido `playCue("whoosh")`, que ya existía) · `design/motion` (`EASE`) · `design/tokens`
(`LAYER`, `READOUT`, `CHAMFER`, `TYPE`) · `NxButton` · `Surface` · `Readout` · `Badge` ·
`ErrorState` · `data/packs` · `data/packStats` · `domain/packs/guidance` · `packStats`.

## 3 · Archivos nuevos

| Fichero | Para qué |
|---|---|
| `src/components/packs/PackHand.tsx` | El abanico. Dos modos: `hand` (el acto) y `strip` (el pie durante el reveal) |
| `src/components/packs/CardBack.tsx` | El dorso, extraído. UNA pieza para toda la ceremonia |
| `src/components/packs/packIdentity.ts` | Identidad visual del sobre derivada del catálogo |
| `src/components/packs/packs.test.tsx` | 23 tests de las propiedades nuevas |
| `scripts/_faseP-packs-qa.ts` | Instrumento de apertura REAL (prefijado `_`, fuera de CI) |
| `docs/product/qa/packs/*.png` | 37 capturas de la apertura real |

## 4 · Archivos modificados

Los nueve de §1. **Ni uno de dominio, economía, API, base de datos ni motor de juego.**

## 5 · Qué comportamiento visual se implementó

La secuencia del encargo, acto por acto:

1. **`intro`** — el sobre llega desde el fondo del escenario (suelo en perspectiva, horizonte,
   viñeta) con su rótulo «NEXUS / nombre del sobre».
2. **`sealed`** — el sobre respira; la costura perforada existe ANTES de rasgar. **El botón
   manda ahora**: era un control de 12 px debajo de «desliza para abrir»; ahora es un
   `NxButton size="lg"` y el arrastre es la alternativa, no el camino único.
3. **`rupture`** — columna de luz por la costura, onda de choque, las dos mitades salen de
   cuadro, estallido de partículas.
4. **`hand` (NUEVO)** — las cartas SALEN del punto donde estaba el sobre (desplazamiento
   expresado en % del ancho de cada carta, escalonado 85 ms) y se quedan **boca abajo**, con su
   recuento («6 CARTAS») y un CTA `REVELAR` que espera a que estén plantadas.
5. **`reveal`** — una a una: tensión con anillo de carga + **el canto del dorso se enciende con
   el color de la rareza real** (§9), heraldo si la rareza lo merece, giro 3D, aterrizaje con
   aura/onda/esquirlas, y ficha legible con jugador · OVR · rol · equipo · variante · serial ·
   nueva/repetida · valor. **El abanico sigue al pie**, atenuado, y cada hueco se tiñe con el
   color de su rareza al descubrirse. Sustituye a la fila de puntos.
6. **`summary`** — «TUS CARTAS», la mejor grande (230 px), el resto en rejilla (150 px) con pie
   de texto por carta, cifras (cartas/nuevas/repetidas/valor) y **el bucle**.

**La última carta** (§11) recibe `lastCardCeremony`: +300 ms de tensión, onda de choque y sala
un 14 % más oscura. **No toca `herald` ni `confetti`**, que son las dos palancas que ANUNCIAN
algo concreto: subírselas a una común sería el fake-out que §9 prohíbe. Test dedicado:
«una común en el último hueco sigue siendo una común».

### Identidad del sobre (§2)

Familia común (chaflán, sigilo hexagonal, costura, banda de nombre) y **cuatro escalones**
derivados de `PackDef.guaranteedMin`, que es el único campo que ya ordena los sobres por
ambición:

| Escalón | Garantía del catálogo | Foil | Anillos | Sigilo | Barrido | Cantoneras |
|---|---|---|---|---|---|---|
| `base` | sin garantía | 0,55× | 1 | plano | no | no |
| `premium` | rara o mejor | 0,80× | 1 | degradado | sí | sí |
| `elite` | épica o mejor | 1,00× | 2 | degradado | sí | sí |
| `legend` | legendaria | 1,25× | 3 | degradado | sí | sí |

**Deliberadamente NO depende del precio**: el precio cambia en cada rebalanceo y la identidad
de un objeto no puede cambiar porque se ajuste una tarifa. Y **no hay una sola regla por
`packId`** — un test lo verifica sobre los doce sobres del catálogo.

## 6 · Qué tipos de packs están conectados

Los **doce del catálogo real**, con su escalón medido:

`inicial` base · `estandar` base · `emea`/`americas`/`pacific`/`china` base · `premium`
premium · `masters` elite · `champions` elite · `ewc` elite · `prime` elite (retirado del
escaparate, sigue abriéndose) · `icon` legend.

**Lo que NO existe y NO he inventado:** el §3 pedía preparar `TEAM PACKS` y `VCT / EVENT PACKS`
«si están definidos en catálogo». **No lo están.** `data/packs.ts` no tiene ningún sobre de
equipo ni de VCT, así que crearlos habría sido inventar producto y probabilidades. Lo que sí
está hecho es que **el sistema los acepta sin tocar código**: `packIdentity` es una función de
la forma del `PackDef`, no una tabla, así que un sobre nuevo obtiene su identidad el día que
entra en el catálogo. También quedan sin usar `BRONCE`/`PLATA`/`ORO` como nombres de sobre:
en NEXUS son **variantes de carta** (`bronze`/`silver`/`gold`, ranks 1-3), no sobres, y
renombrarlos habría chocado con el dominio.

## 7 · Qué sistema de datos utiliza la apertura

El real, sin una segunda ruta:

```
Tienda  → buyPackOnline → POST /api/game/packs {action:"buy"}      → app_buy_pack (precio del CATÁLOGO, ref obligatoria)
Apertura→ openPackOnline → POST /api/game/packs {action:"open"}    → serverPackEngine(sb).open()
                                                                       → openPack()  [DECIDE: pool+pesos+garantías+pity+anti-dup]
                                                                       → Minter      [ACUÑA: serial, calidad, origen]
                                                                    → app_apply_pack_open (consume sobre + inserta user_cards + mint + pity + XP)
Sin sesión → useGameStore.openPackFromInventory → runtimePackEngine() (modo de un jugador)
Artwork    → mapa `uid → fichero` que ya viene con /api/game/state  → useArtworkStore → CardVisual
```

La pantalla **anima lo que le devuelven**. Tests de ausencia lo fijan: sin `Math.random`, sin
`weights`, sin `.price`, sin componer seriales.

## 8 · Qué tests ejecuté

| Gate | Resultado |
|---|---|
| `npm test` (845 ficheros de propiedades) | **845/845 ✓** |
| `packs.test.tsx` (nuevo) | **23/23 ✓** |
| `shop.test.tsx` (el que vigila esta pantalla) | **27/27 ✓** — incluye «el envoltorio mide lo que mide la carta» |
| `npx tsc --noEmit` (app + scripts) | **limpio** |
| `npm run build` | **✓ Compiled successfully**, `/abrir/[packId]` prerenderiza los 12 sobres |
| `npm run security:verify` | **TODAS LAS COMPROBACIONES PASAN** |
| `npm run pack:verify` | **TODAS PASAN** (10 M decisiones de drop, escala lineal, ratio 2,01) |
| `npm run economy:verify` | **inestable, ajeno a esta fase** (ver §17) |
| `eslint src/components/packs src/components/shop` | **limpio** |
| `_faseP-packs-qa.ts` (apertura REAL) | **74/74 ✓** |

## 9 · Resultado de `npm test`

```
ℹ tests 845
ℹ pass 845
ℹ fail 0
ℹ duration_ms 83917
```

## 10 · Typecheck

`npx tsc --noEmit --incremental false` sobre la app y `tsconfig.scripts.json`: **sin salida**.

## 11 · Build

```
✓ Compiled successfully in 6.8s
✓ Generating static pages using 19 workers (60/60)
● /abrir/[packId]   → /abrir/inicial, /abrir/estandar, /abrir/premium, … (12 sobres)
```

## 12 · Security

`npm run security:verify`: **todas pasan**. Lo relevante para esta fase, ya verificado por ese
gate y sin cambios por mi parte: el precio lo pone el servidor desde el catálogo, la semilla es
criptográfica, la clave de idempotencia es obligatoria en la compra, las RPC están revocadas al
cliente (`revoke=true grant=true`) y la tienda no vende sobres retirados.

Comprobado además en la apertura real: el cargo fue **-2.500 exactos** (precio de catálogo del
Premium), con asiento `buy_pack:premium` y clave
`pack:buy:<userId>:<gesto>`. **El cliente no envía precio, ni rareza, ni carta, ni serial.**

## 13 · UX

- La acción principal de cada acto es un `NxButton` (suelo de 44 px garantizado por la
  primitiva): `Abrir sobre` → `Revelar` → `Abrir otro sobre`.
- El arrastre sobre la costura se conserva, pero ya no es la única vía.
- Se dice lo que está pasando: «Procesando… / Abriendo tu sobre en el servidor» mientras el
  servidor decide.
- Los tres estados límite (sobre inexistente, error de apertura, no tienes este sobre) explican
  qué pasó y ofrecen **dos** salidas cuyo orden depende de lo que el jugador tenga.
- **`Repetidas` se añadió al resumen**: el §12 lo pide y solo se contaban las nuevas.
- Cada carta del resumen lleva pie de texto (nick · OVR · variante · Nº · nueva/repetida):
  antes ese dato solo estaba dibujado dentro del arte, ilegible a 150 px e inexistente para un
  lector de pantalla.

## 14 · QA responsive

Medido en la apertura real a los cuatro anchos exigidos. **Sin desbordamiento horizontal y sin
scroll vertical en NINGÚN acto de la ceremonia, incluido el resumen**, en los cuatro:

| Ancho | Sobre sellado | Cartas boca abajo | Revelado | Resumen | Controles < 44 px |
|---|---|---|---|---|---|
| 1440×900 | x 1440/1440 · y 900/900 | ✓ 6 cartas enteras | ✓ 8 enteras | ✓ sin scroll | 0 |
| 1024×768 | x 1024/1024 · y 768/768 | ✓ 6 cartas enteras | ✓ 8 enteras | ✓ sin scroll | 0 |
| 768×1024 | x 768/768 · y 1024/1024 | ✓ 6 cartas enteras | ✓ 8 enteras | ✓ sin scroll | 0 |
| 390×844 | x 390/390 · y 844/844 | ✓ 6 cartas enteras | ✓ 8 enteras | ✓ sin scroll | 0 |

`prefers-reduced-motion: reduce` (pasada aparte): el acto de las cartas sigue existiendo, **se
revelan las 6 de 6** y la ceremonia llega al resumen. La preferencia apaga movimiento, no
contenido.

## 15 · Apertura real verificada

Un usuario real, créditos por la RPC de economía, compra pulsando el botón de la tienda,
apertura pulsando el botón de la ceremonia, y **la pantalla contrastada contra la base de
datos**. Los 20 pasos que pedía el §21, cubiertos. Ejemplo de una tirada real (Premium):

```
carta 1  BRONCE            TEX · 70 OVR · CENTINELA · MIBR            🪙 100
carta 2  PLATA             DAMBI · 80 OVR · DUELISTA · NS             🪙 225
carta 3  ORO               BASIC · 89 OVR · FLEX · FUR                🪙 575
carta 4  CHINA             MONK · 87 OVR · CONTROLADOR · AT           🪙 725
carta 5  EMEA WINNER       WO0T · 85 OVR · DUELISTA · HERETICS  Nº 6/500   🪙 6.725
carta 6  CHAMPIONS WINNER  T3XTURE · 85 OVR · DUELISTA · GEN.G  Nº 8/200   🪙 19.500
```

Contra la base de datos: **6 ejemplares en `user_cards`**, todos con `origin = pack`, el sobre
**consumido** (`user_packs.qty = 0`), seriales solo en las variantes serializadas y **dentro de
su límite** (6/500, 8/200), y `/coleccion` diciendo **45 copias** cuando la base de datos dice
45.

**Rareza alta sin forzar nada:** se abrió el sobre `icon`, que garantiza legendaria *por
catálogo*. El heraldo se cantó antes de ver la carta y el rank máximo obtenido fue **12-13**
(Masters MVP / Champions MVP), o sea la garantía se cumplió **en el sorteo real**.

37 capturas en `docs/product/qa/packs/`.

## 16 · Problemas encontrados

1. **[REAL, P0] El abanico se cortaba a 390 px.** Seis cartas a ancho fijo (84 px) medían
   384 px dentro de un hueco de 358: la primera y la última se salían del cuadro. **Y no había
   scroll que lo delatara**, porque el escenario es `overflow-hidden` — `scrollWidth` decía que
   todo estaba bien. Es exactamente el fallo que `globals.css` ya documenta para la mesa de
   duelo.
2. **[REAL, P0] `transform` de framer-motion borrando la escala de Tailwind.** Animar en el
   MISMO nodo que lleva `scale-[0.72] xs:scale-[0.8]` pierde esa escala en silencio, porque
   framer escribe la propiedad `transform` completa en línea. Lo introduje en `ShopHero` y
   **estaba también en los otros dos sitios que escribí** (sobre sellado y carta del reveal):
   la carta se pintaba a 300 px en un móvil de 390. Misma trampa que `animate-rise` en
   `globals.css`.
3. **[REAL, preexistente] Aviso de React en cada rerender del corte.** `SealedPack` mezclaba
   atajo y propiedad concreta del mismo valor (`borderColor` + `borderBottom: "none"`), y React
   avisa con razón: cuál gana depende del orden de actualización.
4. **[preexistente] `npm run lint` está roto** bajo Next 16 (`next lint` ya no existe: trata
   `lint` como directorio). No es de esta fase.
5. **[preexistente] `economy:verify` es inestable** (ver §17).
6. **[falsos positivos del instrumento — 5]** Tal y como pide el método, se marcan en vez de
   contarse como problemas del producto: (a) tres aserciones sensibles a mayúsculas —
   `.nx-label` lleva `text-transform: uppercase` e `innerText` **devuelve el texto
   transformado**, así que la pantalla dice «PRECIO», no «Precio»—; (b) comprobar la tienda
   antes de que `HydrationGate`/`CloudSync` la montaran; (c) esperar un saldo de 120.000 cuando
   el perfil nuevo ya trae créditos de bienvenida (126.000); (d) recortar `innerText` a 400
   caracteres y comprobar sobre el recorte; (e) buscar las cartas de `/coleccion` por
   `aria-label="Carta de…"`, que esa pantalla no usa (dibuja con `AlbumGrid`/`CardThumb`).

## 17 · Problemas corregidos

- **(1)** El abanico reparte el ancho en vez de imponerlo: cada carta es `flex-1 min-w-0` con
  techo `max-w`, así que su ancho sale de dividir el espacio disponible. El giro del abanico se
  bajó a ±4,5° porque el `transform` no lo ve el layout y cada grado de más es ancho no
  reservado. **Y se añadió la medida que faltaba**: `cartasCortadas()` comprueba carta por
  carta que su rectángulo cabe ENTERO en el viewport — la comprobación que sí caza esta clase
  de fallo. Verde en los cuatro anchos.
- **(2)** La escala vive en su propio nodo y la animación en otro, en los tres sitios.
- **(3)** Longhands por lado (`borderTopColor`…, `borderBottomWidth: 0`) en la solapa y en las
  cantoneras. Consola limpia en la apertura completa.
- **(6)** Instrumento corregido: regex insensibles a mayúsculas, espera activa a que la
  pantalla monte, saldo leído de la base de datos, aserciones sobre el texto completo y
  selector de cartas por marco 5:7.

**No corregido a propósito:** `economy:verify` falla de forma intermitente en
`✕ mis listados incluyen los cerrados` (§8 MERCADO · LECTURAS) — 2 de 5 ejecuciones. Es
**mercado**, no sobres, y ninguna de mis líneas lo toca. Arreglarlo sería salirse de la fase;
queda documentado como deuda.

## 18 · Deudas restantes

1. **`economy:verify` inestable** en la lectura de listados de mercado (2/5 fallos). Ajeno a
   esta fase. Sospecha: visibilidad/orden de filas creadas por ejecuciones concurrentes.
2. **`npm run lint` roto** bajo Next 16. Migrar a `eslint.config.js` (ESLint 9) o cambiar el
   script; hoy hay que usar `ESLINT_USE_FLAT_CONFIG=false npx eslint`.
3. **`PackStoreCard` sigue duplicando a `ShopHero`** en `/eventos`: su propia barra de rarezas,
   su propio párrafo de orientación y su propio botón. Es P2 y está vivo; unificarlo es una
   fase de pantalla, no un cambio suelto.
4. **Artwork manual no verificado con fichero real**: la base local tiene **0 filas en
   `assets`**, así que la apertura ejercitó el camino de FALLBACK (dibujado por capas), que es
   el correcto y no dejó ni una imagen rota. El camino del fichero es el mismo código que ya
   usa la colección (`CardVisual` por `uid`), pero **no he podido verlo con un artwork real**
   porque no existe ninguno en este entorno.
5. **Duplicado dentro de un mismo sobre no observado**: en las tiradas reales del QA todas las
   cartas de cada sobre salieron `NUEVA` (el contador «Repetidas» marcó 0), aunque sí
   aparecieron duplicados **entre** sobres (un `×2` en la colección). El camino «Repetida» está
   implementado y probado a nivel de render, pero no lo ha disparado un drop real.
6. **Sobres de equipo y de VCT**: no existen en el catálogo. El sistema visual está preparado
   (identidad derivada, no tabla), pero crearlos es decisión de producto y de economía.
7. **El sonido de la apertura sigue siendo sintetizado** (`lib/sound`). Se reutiliza todo lo que
   había, incluido `playCue("whoosh")` para la salida de las cartas, y la abstracción está
   limpia para meter ficheros cuando existan. No se ha creado ningún sistema de audio paralelo.
8. **`ShopHero` no anima la entrada del sobre con `AnimatePresence`**: al cambiar de sobre se
   remonta por `key` y entra, pero el anterior no sale. Es suficiente para §4 y evita el salto
   de layout que daría una transición de salida en un contenedor de altura fija.

---

## Criterio final del encargo, contrastado

```
TIENDA ✓ → ELIGES SOBRE ✓ → ABRIR SOBRE ✓ → SOBRE ENTRA EN ESCENA ✓ →
SOBRE SE ABRE FÍSICAMENTE ✓ → 5 CARTAS BOCA ABAJO ✓ (nuevo) →
REVEAL 1..N ✓ (uno a uno, las demás visibles y atenuadas) →
RARITY REVEAL ✓ (rareza real, anticipación real, sin fake-outs) →
TUS CARTAS ✓ → ABRIR OTRO SOBRE ✓ (sin salir de la pantalla)
```

Una desviación consciente del §13, y es de honestidad: **no hay botón «AÑADIR A COLECCIÓN»**.
Las cartas ya están en la colección — el servidor las insertó en `user_cards` dentro de la
misma transacción que consumió el sobre (`app_apply_pack_open`), antes de que la pantalla las
animara. Un botón que dijera «añadir» sería teatro sobre una operación ya cerrada, y quien
cerrara la pestaña sin pulsarlo creería haber perdido las cartas. La acción es **«Ver en mi
colección»**, y la principal es el bucle.

**FASE 19 — CERRADA**
