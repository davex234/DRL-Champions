# Contrato de presentación · Apertura de sobres 3.0 (Fase 38 · The Reveal)

**El servidor decide, la ceremonia presenta.** Nada de esta capa sortea, pesa, acuña, cobra ni concede.

Piezas: dominio puro `src/domain/packs/reveal.ts` · servicio `src/server/services/packs.ts` · ruta `src/app/api/game/packs/route.ts` · sync `src/lib/game/sync.ts` + `src/lib/game/openRecovery.ts` · UI `src/components/packs/{PackOpeningExperience,PackStage,CardReveal,PackSummary,PackStatus}.tsx` · receta visual `ceremony.ts`.

## 1. Autoridad (lo que ya existía y no cambia)

| paso | quién | dónde |
|---|---|---|
| precio, compra (solo ACTIVE) | servidor | `buyPack` → `guardPurchase` → `app_buy_pack` (clave `pack:buy:<user>:<gesto>`) |
| apertura (ACTIVE y RETIRED poseído; DRAFT 404) | servidor | `openPackForUser` → `guardPublicOpen` |
| semilla | servidor (`randomInt`) | nunca el cliente |
| sorteo, pity, anti-duplicado, orden | motor `PackEngine.draw` (rareza ↑, después `cardId`) | Node |
| serial | `Minter` + `card_mints` | Node + BD |
| persistencia atómica | `app_apply_pack_open`: consume 1 sobre con bloqueo, inserta `user_cards`, funde `card_mints`, pity, `packs_opened + 1`, XP, guarda `{uids, packId}` en `economy_ops` | PostgreSQL |

Comprar **no** incrementa `packs_opened`; abrir suma **exactamente 1**. Objetivos y logros siguen leyendo contadores del servidor.

## 2. Petición y respuesta

`POST /api/game/packs` · `Authorization: Bearer` · cuerpo **cerrado** `{ action: "open", packId, ref }` (≤ 2 000 caracteres → si no 413; cualquier otro campo → 400 «Campo no permitido»; `packId` `^[\w-]{1,64}$`; `ref` `^[\w:-]{1,128}$`). Solo `POST`. 5xx con texto genérico «No se pudo completar la operación».

Respuesta `{ opened: OpenedCardDTO[], credits, xpGained, repeated }` con, por carta, `uid`, `cardId`, `serial|null`, **`mintedVersion`** (leída de `user_cards`), `isNew`, `bucket`, `byPity`, `value` (no se muestra).

## 3. Idempotencia (Fase 38 corrige dos fallos)

- Una apertura = un gesto. `lib/game/sync` guarda el gesto en `sessionStorage` **antes** de pedir y lo borra al confirmar (o ante «No tienes ese sobre»). Un fallo de red o 5xx conserva el gesto: reintentar repite la MISMA operación.
- **Reintento con la misma clave** (`storedOpen`): el servicio busca la operación en `economy_ops` del propio usuario **antes** de leer inventario o sortear. Si existe (y es de ese sobre), devuelve las cartas **leídas de `user_cards` por uid** (`repeated: true`, XP 0). Antes: se re-sorteaba y se emparejaban los uids guardados con cartas de otro sorteo, y si era el último sobre respondía 409.
- **Carrera con la misma clave** (la RPC responde `repeated`): se leen las filas persistidas, nunca las del sorteo descartado.
- **Apertura nueva**: tras la RPC se releen las filas por uid; carta, serial y versión mostrados son los persistidos.
- «Abrir otro» empieza otra operación con otra clave.
- Dos pestañas con dos gestos: la segunda encuentra 0 sobres → «No te queda este sobre» (sin error fatal).

## 4. Máquina de estados de PRESENTACIÓN (no se persiste)

`ready → requesting → opening → hand → reveal(i, revealed) → summary`, más `error`, `no_pack`, `recovering`.

| evento | efecto |
|---|---|
| `OPEN_REQUESTED` | solo desde `ready` (doble clic, Enter repetido → sin efecto) |
| `OPEN_SUCCEEDED(count, repeated)` | desde `requesting` → `opening`; desde `recovering` → `summary` (recuperado) |
| `OPEN_FAILED(failure)` | `NO_PACK` → `no_pack`; resto → `error` (sin cartas, sin ceremonia) |
| `RUPTURE_DONE` / `START_REVEAL` / `CARD_SHOWN` | solo en su fase |
| `NEXT` | anticipación → gira la carta; girada → siguiente o resumen |
| `SKIP` (saltar / revelar todas) | con resultado en mano → `summary` con el mismo recuento; no pide nada |
| `RESET` | desde `summary`/`no_pack` → `ready` |

Nada se revela antes de `OPEN_SUCCEEDED`: mientras espera, el sobre solo usa el color del sobre.

## 5. Qué se cuenta de cada carta (`buildRevealPlan`)

Entrada: instancias autoritativas en el orden del servidor + foto de la colección de **antes** (tomada al pulsar; encadenada al abrir otro; en una recuperación, la colección actual sin las instancias de esta apertura).

- **Rareza**: bucket real del catálogo (común, poco común, rara, épica, legendaria). Sin niveles inventados.
- **NUEVA**: 0 copias de esa definición antes de ESTA apertura. Misma definición dos veces: la 1.ª NUEVA, la 2.ª DUPLICADA ×2. **Nunca `obtained_at`.**
- **DUPLICADA ×N**: total de copias DESPUÉS de esta instancia.
- **NUEVA VARIANTE**: definición nueva de un jugador que ya tenías (antes o antes en este sobre).
- Sin foto previa: estado «desconocido», sin ×N, sin progreso.
- **Serial**: `#N/LÍMITE`; prestigio `#1` / `Top 10` / `Top 100` solo visual (no cambia stats, OVR, XP, créditos ni odds).
- **Ritmo**: anticipación común 320 ms · poco común 560 · rara 950 · épica 1450 · legendaria 2200; +900 ms para #1, +350 Top 10, +150 Top 100; movimiento reducido 180 ms. Heraldo desde rara (la rareza real) o «Serial #1».
- **Anuncio**: «Carta 2 de 5. Aspas. Rara. OVR 84. Serial #7/500. Nueva en tu colección.»

## 6. Resumen

Todas las cartas (ficha real `cardHref`, `data-uid/card-id/serial/minted`), nuevas/duplicadas/variantes, mejor rareza, destacada con criterio explícito (rareza → OVR → serial más bajo), serial destacado, colección `X → Y / TOTAL` y `% → %` (todas duplicadas: `X → X` y «Sin cartas nuevas: N duplicadas»), hasta 3 sets que avanzan (completados primero; equipo, región, edición, rol, rareza), «Set completado» y «Primera legendaria» como reconocimiento — **sin recompensa**. Acciones: abrir otro (si queda de ESTE sobre) / mis sobres / ver sobres, ver en mi colección (ficha de la destacada), añadir al equipo (hoja existente), volver a sobres. Sin valor en monedas, venta ni mercado.

## 7. Recuperación

1. Revelado ya guardado en la pestaña → resumen recuperado («El sobre ya se abrió correctamente»).
2. Petición enviada sin respuesta (recarga / red) → `recovering` → misma clave → resultado guardado.
3. Sin evidencia en la pestaña y sin sobres → «No tienes este sobre» / «No te queda este sobre» con salida a colección. Nunca se reabre.

## 8. Accesibilidad y movimiento

Rareza siempre en texto; anuncio `aria-live` por carta; la cara boca abajo `aria-hidden`; foco a la mano, a cada carta girada y al resumen; teclado Enter/Espacio (abrir, revelar, siguiente), A (revelar todas), S/Escape (saltar, solo con resultado). Movimiento reducido: sin mitades, partículas, onda, velo, corona ni flotación; giro casi inmediato. Fotosensibilidad: un único velo ≤ 0,28 de opacidad durante 0,7 s; sin estroboscopio. Partículas ≤ 40 por estallido; sin confeti. Botones propios ≥ 44 px.

## 9. Fuera de alcance

Sin cambios en odds, pools, precios, número de cartas, pity, seriales, OVR, stats, economía ni ledger. Sin migración (sin 0053), sin tablas de animación. Telemetría: solo el flujo existente `pack_ceremony`.
