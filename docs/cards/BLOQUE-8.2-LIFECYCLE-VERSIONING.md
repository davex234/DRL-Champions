# BLOQUE 8.2 — Ciclo de vida, versionado e integridad de instancias

> **Estado: READY.** H-2 cerrado. 53 instancias históricas protegidas y reconstruibles,
> `derke__champions-mvp` preservada, 0 huecos de historia.
> **Sin commit, sin push, sin deploy.**

---

## 0. Resumen ejecutivo

**El problema**: una carta que alguien ya posee cambiaba de significado si un administrador
editaba después su definición. Sin versión, sin registro y sin aviso: cambiaban sus
estadísticas, su OVR, su rareza, lo que valía en el mercado y lo que pagaba el desguace. Es
H-2 de la auditoría, y era el mayor riesgo de integridad del sistema.

**La solución**: una instancia deja de apuntar a *«la carta»* y pasa a apuntar a **la carta
tal y como era cuando se acuñó**.

**La forma**: una tabla nueva y una columna. No tres tablas.

```
DEFINITION → content_cards          (ya existía: identidad + ciclo de vida)
VERSION    → content_card_versions  (NUEVA: el registro inmutable)
INSTANCE   → user_cards             (ya existía: + una columna, `minted_version`)
```

**La prueba** (§10), ejecutada contra el servidor real por la API real:

| | ejemplar del jugador | definición vigente |
|---|---|---|
| OVR | **81** | 90 |
| valor de mercado | **6.450** | 9.700 |
| combate SH/GS/EF | **67/63/94** | 77/73/99 |
| rareza | **epic** | legendary |
| en la partida en curso | **81** | — |

El administrador editó de verdad. El ejemplar no se movió.

**Un hallazgo del código que decidió el diseño**: `app_buy_listing` **reescribe
`obtained_at`** al cambiar de dueño (0020, línea 273). De las 53 instancias actuales, 3
tienen `origin='market'`, así que deducir la versión por la fecha daría el resultado
equivocado en 3 casos **hoy mismo**. Por eso la versión es un puntero que registra un hecho,
no una inferencia sobre marcas de tiempo.

**Un riesgo que se detectó a tiempo**: 8.1 cargaba en el servidor solo las cartas
`PUBLISHED`. En cuanto existe `RETIRED`, eso deja a los dueños de una carta retirada con un
`uid` que no resuelve — mazo inválido, listado invisible, desguace que se la salta. Sería
introducir exactamente el daño que este bloque existe para impedir. Se separaron las dos
preguntas (§6).

---

## 1. Auditoría — las diez preguntas, respondidas antes de implementar

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Qué datos son la **identidad**? | `card_id` = `player_id__variant_id`. Nada más. Inmutable para siempre; lo impone un `CHECK`. |
| 2 | ¿Qué datos son sus **características**? | `ovr`, `combat` (SH/GS/EF), `stats` (las 6 heredadas), `stat_boost`, `rarity_rank`/`rarity_bucket`, `data_version`, `source`, `generated_at`. |
| 3 | ¿Qué pertenece a la **instancia**? | `uid`, `user_id`, `serial`, `origin`, `locked`, `obtained_at` — **y la versión bajo la que se acuñó**. Nada más: una instancia es una referencia con historia, no una copia. |
| 4 | ¿Qué debe **congelarse**? | Todo lo de (2), pero **en la versión, no en la instancia**. La instancia congela un puntero. |
| 5 | ¿Qué puede **evolucionar**? | `lifecycle`, `definition_version` (puntero a la vigente) y, cuando existan, los campos cosméticos. Hoy **no hay ninguno**: todas las columnas editables afectan al juego. |
| 6 | ¿Qué afecta al **valor económico**? | `rarity_rank` (vía `variant.rank`) y `ovr` → `marketValue`. `serial` + `variant.serialLimit` → `instanceValue`. `bucketForRank(rank)` → `salvageValue`. Todo congelable en la versión salvo el `serial` (es de la instancia) y el `serialLimit` (regla de variante, en código). |
| 7 | ¿Qué afecta al **combate**? | Solo `combat`. Ni rareza, ni OVR, ni variante — `combat.ts` no conoce `cardId`. Y ya se congelaba por partida en `takeDeckSnapshot`. |
| 8 | ¿Qué afecta a la **distribución en sobres**? | `variant_id` (grupo, serie, región), `rarity_bucket` y `lifecycle`. Esto **debe leer la versión VIGENTE**, no la acuñada: es «qué puedo obtener», no «qué tengo». |
| 9 | ¿Qué es **puramente visual**? | Paleta y nivel de animación, que viven en `variants.ts` como regla de juego. `content_cards` no tiene ni una columna visual. |
| 10 | ¿Qué es **histórico**? | `card_mints.minted`, `duel_matches.state`, `market_audit`, `transactions`, `economy_ops` — y desde ahora `content_card_versions`. |

**Una consecuencia poco obvia de (6):** la rareza sale de `variants.ts`, que es **código**.
Sin congelarla, cambiar el `rank` de una variante en un despliegue movería la rareza, el
valor de mercado y el desguace de todas las instancias ya poseídas. Es H-2 por otra puerta,
y por eso `rarity_rank` está en la versión.

---

## 2. Modelo de datos

### `content_card_versions` — el registro inmutable

| Columna | Qué es |
|---|---|
| `card_id` + `version` | **PK**. La identidad de un momento de la carta |
| `player_id`, `variant_id` | identidad congelada — un registro histórico que dependiera de la fila viva para saber de quién es la carta no sería un registro histórico |
| `ovr`, `combat`, `stats`, `stat_boost` | lo que afecta al juego |
| `rarity_rank`, `rarity_bucket` | la rareza, blindada frente a cambios en `variants.ts` |
| `data_version`, `source`, `generated_at`, `checksum` | procedencia |
| `effective_from` / `effective_to` | ventana de vigencia. `NULL` = vigente |
| `created_at`, `created_by`, `reason` | auditoría |

**Constraints**

- `content_card_versions_identity` — `card_id = player_id || '__' || variant_id`.
- `content_card_versions_window` — `effective_to > effective_from`.
- `content_card_versions_reason` — a partir de la versión 2, **motivo obligatorio**.
- Índice **único parcial** `where effective_to is null` — *exactamente una* vigente por carta.
  Sin esto, «¿cuál es la versión actual?» sería una pregunta con dos respuestas posibles.

**Índices**: `card_id`, `(card_id, effective_from)`, y el único parcial de vigencia.

### `content_cards` — dos añadidos

- `content_cards_current_version_fk`: FK `(card_id, definition_version) → content_card_versions(card_id, version)`, **deferrable**. `definition_version` deja de ser un entero suelto y pasa a ser un puntero que tiene que existir.
- El `CHECK` de `origin` admite un cuarto valor: `legacy` (§7).

### `user_cards` — una columna

`minted_version int` **nullable**, con `check (minted_version is null or >= 1)` e índice
`(card_id, minted_version)`.

Nullable a propósito: `NOT NULL` obligaría a inventar una versión para un `card_id` fuera del
catálogo, y 8.1 midió que ese caso es real. `NULL` significa «no consta», que es la verdad.

### `v_instance_version_gaps` — la respuesta al criterio 4

Cero filas = todo ejemplar poseído se puede reconstruir exactamente. **Hoy: 0.**

---

## 3. El sello: por qué un trigger y no cinco RPC

Hay **cinco** rutas que insertan en `user_cards` (0011 ×2, 0018, 0019, 0026) y una que
transfiere propiedad (0020). Modificar cinco RPC críticas —sobres, recompensas, ciclo de
juego, libro mayor, eventos— para que cada una recuerde estampar la versión son cinco
oportunidades de olvidarlo, hoy y en cada ruta futura.

`trg_user_cards_stamp_version` (BEFORE INSERT) lo hace **en un solo sitio, sin tocar ni una
línea de las RPC existentes**, y no se puede saltar. No pisa un valor ya puesto, por si algún
día hay que acuñar bajo una versión concreta (una compensación, una restauración).

Y la venta es un `UPDATE` sobre el mismo `uid`: **el ejemplar no se recrea, cambia de dueño**,
así que su versión viaja con él. El comprador recibe *ese* ejemplar con su historia, no uno
nuevo. Verificado.

---

## 4. Instance snapshot — CAMPO | FUENTE | CONGELADO | DERIVADO | MOTIVO

El snapshot es **por referencia**: la instancia guarda un puntero y la versión guarda el
contenido. N ejemplares de la misma carta y versión comparten UNA fila.

| CAMPO | FUENTE | CONGELADO | DERIVADO | MOTIVO |
|---|---|---|---|---|
| `card_id` | `user_cards` | **sí** (ya lo estaba) | no | es la identidad; cambiarlo sería otra carta |
| `minted_version` | `user_cards` (trigger) | **sí** | no | **la pieza nueva**: ancla el ejemplar a su momento |
| `serial` | `user_cards` | **sí** (ya lo estaba) | no | es de la instancia, no de la definición |
| `origin` | `user_cards` | **sí** | no | cómo llegó |
| `obtained_at` | `user_cards` | no | no | **se reescribe al vender** (0020). Por eso no sirve para inferir versión |
| `locked` | `user_cards` | no | no | estado vivo: lo pone y quita el mercado |
| `player_id`, `variant_id` | versión | **sí** | no | identidad, replicada para que el histórico sea autónomo |
| `ovr` | versión | **sí** | no | mueve valor de mercado y presentación |
| `combat` | versión | **sí** | no | **lo único que entra en combate** |
| `stats` (6) | versión | **sí** | no | simulador y pipeline de esports |
| `stat_boost` | versión | **sí** | no | trazabilidad de cómo se llegó al trío |
| `rarity_rank` / `rarity_bucket` | versión | **sí** | de `variants.ts` | blinda frente a un cambio de código en las variantes |
| `data_version`, `source`, `generated_at` | versión | **sí** | no | procedencia auditable |
| `checksum` | versión | **sí** | calculado | comparación O(1) |
| `marketValue` | — | **no** | calculado | función pura de (rareza, ovr) **de la versión acuñada** |
| `instanceValue` | — | **no** | calculado | `marketValue` × multiplicador de serie |
| `salvageValue` | — | **no** | calculado | tabla por bucket **de la versión acuñada** |
| `serialLimit` | `variants.ts` | no | no | regla de juego; ver deuda D-3 |

**Por qué los valores económicos NO se congelan**: son funciones puras de datos que sí están
congelados. Guardar el número además de sus entradas crearía dos verdades que divergirían al
primer ajuste de fórmula. Se congela la **entrada**, se calcula la **salida**.

---

## 5. Economía (Fase 3)

`marketValue`, `instanceValue`, `salvageValue` y `quickSellValue` **no se han tocado**: misma
matemática, mismas constantes, misma tabla de desguace. Lo único que cambia es **qué carta se
les pasa**.

| Superficie | Antes | Ahora |
|---|---|---|
| desguace (vista previa y cobro) | `catalog.card(cardId)` | `catalog.instance(cardId, minted_version)` |
| escaparate y «mis listados» | `cat.card(row.card_id)` | `cat.instance(row.card_id, versión del `card_uid`)` |
| ancla de referencia (`card_reference`) | catálogo vigente | catálogo vigente — **correcto**: es el precio de mercado de hoy |

Regla que gobierna todo el bloque:

> **«lo que tengo» resuelve por la versión acuñada; «lo que existe / puedo obtener» resuelve
> por la versión vigente.**

Las versiones de los listados se resuelven **en lote, en una consulta** (`mintedVersions`),
no por listado: un N+1 en la pantalla más consultada del mercado no era aceptable.

---

## 6. Combate y ciclo de vida

### Combate (Fase 4) — no se ha tocado nada

`takeDeckSnapshot` ya congelaba `combat`, `ovr`, `statBoost`, `dataVersion` y `serial` por
partida, y la partida no vuelve a mirar el catálogo. Ese diseño era correcto y sigue igual.

Lo que 8.2 añade es la capa de **antes** de la partida: el mazo se construye y se valida con
la carta que el jugador tiene, no con la definición vigente. `makeDeckResolver` acepta un
tercer parámetro **opcional** `versionLookup`; sin él el comportamiento es idéntico al
anterior (por eso las 766 pruebas del dominio pasan sin tocarlas), y el servidor sí lo pasa.

**Demostrado en QA con una partida empezada antes de la edición**: la mano sigue en OVR 81 y
`duel_matches.state` conserva el trío histórico.

### Ciclo de vida (Fase 5)

```
DRAFT ──► REVIEW ──► APPROVED ──► PUBLISHED ──► RETIRED
  │         │  │         │                        │  │
  │         │  └─► REJECTED ──┐                   │  └─► ARCHIVED
  └──► ARCHIVED ◄─────────────┴───────────────────┘
```

Las transiciones las impone `app_content_set_lifecycle`; cualquier otra se rechaza.
**Quién**: solo `service_role`, invocado por una ruta de servidor tras `verifyAdmin`.

**Qué pasa al RETIRAR** — y esta es la parte que obligó a un cambio de arquitectura:

| Recurso | Efecto de RETIRED |
|---|---|
| instancias | **ninguno**: se siguen poseyendo |
| colección / inventario | la siguen viendo |
| mazos | siguen siendo válidos |
| mercado | los listados siguen visibles y tasando |
| desguace | sigue pagando |
| partidas históricas | intactas (ya estaban congeladas) |
| **sobres** | **deja de poder salir** |

Para poder cumplir esto hubo que separar dos conjuntos que 8.1 trataba como uno:

```
RESOLVABLE_LIFECYCLES = [PUBLISHED, RETIRED]   «¿existe?»          → registro de resolución
DROPPABLE_LIFECYCLES  = [PUBLISHED]            «¿puede tocarme?»   → registro del sorteo
```

`ServerCatalog` construye los dos. Mientras no haya retiradas coinciden, y el verificador lo
comprueba abriendo sobres.

**ARCHIVED con ejemplares en circulación está PROHIBIDO** por la RPC: sacaría la carta del
catálogo del servidor y dejaría colecciones rotas. Para eso está RETIRED.

**RETIRED nunca es DELETE.** El único borrado posible es `app_content_purge_card`, que se
**niega** si hay instancias, acuñaciones o listados: es la protección explícita, no una
puerta trasera.

---

## 7. Reglas de edición (Fase 6)

| Cambio | Clasificación | Cómo se impone |
|---|---|---|
| `player_id` | **FORBIDDEN** | no está en la lista blanca de la API ni se lee en la RPC; además el `CHECK` de identidad lo haría imposible |
| `variant_id` | **FORBIDDEN** | ídem — sería otra carta, y las instancias apuntarían a algo que no compraron |
| `card_id` | **FORBIDDEN** | es la PK y el `CHECK` la ata a los dos anteriores |
| `ovr` | SAFE WITH NEW VERSION | RPC `app_content_publish_version` |
| `combat` | SAFE WITH NEW VERSION | ídem |
| `stats` | SAFE WITH NEW VERSION | ídem |
| `stat_boost` | SAFE WITH NEW VERSION | ídem |
| `rarity_rank` / `rarity_bucket` | SAFE WITH NEW VERSION | ídem |
| `lifecycle` | operación aparte | `app_content_set_lifecycle`, con transiciones validadas |
| team / event / season / artwork / market data | **no existen todavía** | son columnas de 8.3; hoy no hay ninguna cosmética |

**No hay ningún campo SAFE sin versión**, y conviene decirlo en vez de fingir una categoría
vacía: hoy **toda** columna editable afecta al juego. La distinción cosmético/relevante
aparecerá cuando 8.3 añada arte y descripción.

Un campo desconocido en el patch **se rechaza**, no se ignora: un error de tecleo no debe
pasar por una edición que no cambia nada.

---

## 8. Versionado (Fase 7)

Se guarda `version` (entero por carta), `effective_from`/`effective_to`, `checksum`,
`created_at`, `created_by` y `reason`. **No** se guarda un `version_id` global: la clave
natural `(card_id, version)` ya identifica y ordena, y un id sintético solo añadiría una
indirección.

Una instancia **no** apunta a la última versión: apunta a la suya.

```
CARTA A ── v1 (OVR 86) ──cerrada──►  v2 (OVR 93) ──vigente
             ▲                          ▲
             │                          │
       instancia #7                instancia #12
       (acuñada antes)             (acuñada después)
```

**Reproducibilidad histórica**: dada una instancia, `serverCatalog().instance(cardId,
mintedVersion)` devuelve el `CardDef` exacto de aquel momento. Y para saber a cuánta gente
afecta una edición antes de hacerla, `inspect` devuelve `instancesByVersion`.

**Repliegue explícito y observable**: si la versión no se encontrara —solo posible por
corrupción—, se cae a la v1 y luego a la vigente, para no dejar a nadie sin su carta.
`instanceIsExact()` distingue una resolución exacta de un repliegue, y
`v_instance_version_gaps` los enumera. Hoy: **0**.

---

## 9. El caso `derke__champions-mvp` (Fase 8)

**Qué representa**: `card_mints` guarda **1 serial acuñado** de una carta que el generador ya
no produce. Derke sigue en el roster y `champions-mvp` sigue siendo una variante válida; lo
que desapareció fue el **galardón** en su palmarés. Es decir: lo que falta no son los datos,
es la **autorización**.

**Medido**: 0 instancias, 0 listados, 1 acuñación. La colección de nadie depende de ella.

**Qué se ha hecho**: materializarla como **legacy**, con la misma matemática del dominio.

```
playerCombatBase(derke) → trío real (métricas VLR)
deriveCard(trío, statBoost de champions-mvp) → OVR 88 · SH/GS/EF 70/66/97
origin    = 'legacy'    ← no salió del generador; su existencia la justifica el histórico
lifecycle = 'RETIRED'   ← existe y se resuelve, pero NO vuelve a circulación
ordinal   = el último   ← no desplaza ni una posición del catálogo vigente
```

**No se ha inventado ni un número. No se ha tocado `card_mints`. No se ha falsificado el
palmarés de Derke** — el generador sigue sin producirla, y el verificador lo comprueba.

**Cómo evita que futuras FK la rompan**: ahora tiene definición y versión, así que una FK
`user_cards.card_id → content_cards.card_id` ya no la rechazaría. `v_content_card_orphans`
ha pasado de 1 a **0**.

**Cómo se administrará**: es una carta como cualquier otra para el plano de control —
inspeccionable, versionable, y republicable con `RETIRED → PUBLISHED` si algún día se decide
devolverla. Lo que no puede es aparecer en un sobre por accidente.

---

## 10. La prueba de inmutabilidad (Fase 10)

Ejecutada dos veces: en el verificador (contra el dominio) y en la QA real (contra el
servidor, por la API de administración, con sesión de admin).

```
1. carta elegida          derke__prime · v1 · OVR 86
2. ejemplar creado        serial #7, minted_version = 1  (lo estampa el trigger)
3. foto                   OVR 86 · SH/GS/EF 67/63/94 · mercado 6.450 · #7 30.925 · desguace 600
4. EDICIÓN REAL           app_content_publish_version: OVR → 93, rareza → legendary
5. definición vigente     OVR 93 · mercado 9.700          ← SÍ cambió
6. el ejemplar            OVR 86 · mercado 6.450 · #7 30.925 · desguace 600   ← NO cambió
```

Comprobado campo a campo: OVR, combate, stats, rareza, valor de mercado, valor de la serie,
desguace **calculado por el servidor**, resolución del mazo, y el historial (dos versiones,
ventana cerrada, motivo obligatorio).

Y la comprobación que impide que la prueba se engañe a sí misma: **la definición tiene que
haber cambiado**. Una prueba de inmutabilidad que pasa sin que nada se mueva no prueba nada.

---

## 11. Mercado y mazos (Fases 11 y 12)

**Mercado.** Un listado es un ejemplar concreto (`card_uid`), no una carta abstracta. Si el
anuncio se enriqueciera con la definición vigente, el sistema estaría generando publicidad
falsa: anunciaría estadísticas que la carta en venta no tiene. Ahora resuelve por la versión
del ejemplar.

Lo que **no** cambia: el precio lo sigue poniendo el vendedor, la banda antifraude sigue
igual y las RPC del mercado no se han tocado. En QA, tras la edición: OVR anunciado 81
(no 90) y precio 900 intacto.

**Mazos.** El `DeckBuilder` y las reglas de composición no se han tocado. En QA, tras la
edición: el mazo sigue `valid`, con la misma suma de OVR (890), y la partida empezada antes
conserva su mano.

---

## 12. Seguridad (Fase 13)

Cuatro capas, y ninguna confía en el cliente:

1. **`middleware.ts`** corta en el borde `/api/admin/*` sin `Bearer`.
2. **`verifyAdmin(req)`** resuelve el token contra GoTrue y comprueba `profiles.is_admin`.
   **El actor sale de ahí**, nunca del cuerpo — `userId`, `actor`, `role` e `is_admin` en el
   JSON ni se leen.
3. **RPC `security definer`** con `execute` revocado a `anon` y `authenticated`.
4. **El trigger de inmutabilidad**, que rechaza reescribir el histórico **incluso con
   `service_role`**.

| Prueba | Resultado |
|---|---|
| `anon` leer `content_card_versions` | denegado `42501` |
| `authenticated` leer el historial | denegado `42501` |
| `anon` / `authenticated` publicar versión | denegado `42501` |
| `anon` / `authenticated` retirar carta | denegado `42501` |
| usuario reescribe `minted_version` de OTRO | denegado |
| usuario reescribe la de las suyas | denegado `42501` |
| API sin sesión | 401 |
| API con usuario normal | 401 |
| API suplantando `actor`/`role`/`is_admin` | 401 |
| API cambiando la **identidad** de una carta (admin válido) | 400 — lista blanca |
| API editando **sin motivo** (admin válido) | 400 |
| API con admin válido | 200 |
| reescribir OVR / combat / rarity / checksum / effective_from de una versión | **rechazado por el trigger** |
| borrar una versión con ejemplares acuñados | **rechazado por el trigger** |

---

## 13. Constraints (Fase 14)

| Constraint | Impide |
|---|---|
| PK `(card_id, version)` | versiones duplicadas |
| único parcial `where effective_to is null` | dos versiones vigentes a la vez |
| `content_card_versions_identity` | una versión que no es de la carta que dice |
| `content_card_versions_window` | una ventana que termina antes de empezar |
| `content_card_versions_reason` | una edición sin motivo (v ≥ 2) |
| `check (ovr between 1 and 99)`, `stat_boost in (0,2,4,6,9,12)`, buckets, `source` | valores fuera del dominio |
| `content_cards_current_version_fk` | que la versión vigente no exista |
| `user_cards_minted_version_chk` | versión 0 o negativa |
| FK `versions → cards` `on delete restrict` | borrar una carta dejando su historia colgando |
| trigger de inmutabilidad | reescribir o borrar historia |

**Ninguna rompe datos históricos legítimos**: `minted_version` es nullable y no hay FK contra
`content_card_versions`, precisamente por el caso legacy y por el pipeline de torneos.

`content_cards_current_version_fk` nace `NOT VALID` por secuencia —las 772 filas existen
antes que sus versiones, que las crea el migrador en TypeScript— y **valida toda escritura
nueva desde ese instante**. El migrador la valida del todo al terminar, y el verificador
comprueba que quedó validada.

---

## 14. Migración e integridad ANTES/DESPUÉS (Fase 9)

**Qué hizo** `content-version:migrate`:

1. 773 versiones génesis (772 del generador + 1 legacy), copiadas de `content_cards` — sin
   volver a ejecutar el generador, porque 8.1 ya demostró que esa fila **es** lo que produce.
2. La carta legacy, con la matemática del dominio.
3. Retrocarga de las 53 instancias a `minted_version = 1`.
4. Validación de la FK y republicación de la identidad del catálogo.

**Por qué la retrocarga a v1 es EXACTA, no cómoda**: la versión 1 tiene
`effective_from = CATALOG_GENERATED_AT` (2026-08-31) y las 53 instancias se obtuvieron entre
el **2026-09-02 y el 2026-09-08** — todas posteriores. Medido, no supuesto. Si alguna fuera
anterior, el migrador la deja en `NULL` y lo dice: un `NULL` honesto antes que un número que
finge una historia que nadie registró.

### TABLA DE INTEGRIDAD

| RECURSO | ANTES | DESPUÉS | DIF | ESTADO |
|---|---:|---:|---:|---|
| `user_cards` | 53 | 53 | +0 | **intacta, huella idéntica** |
| `duel_decks` | 1 | 1 | +0 | intacta |
| `market_listings` | 1 | 1 | +0 | intacta |
| `market_offers` | 0 | 0 | +0 | intacta |
| `card_reference` | 0 | 0 | +0 | intacta |
| `user_packs` | 10 | 10 | +0 | intacta |
| `duel_matches` | 4 | 4 | +0 | intacta |
| `content_players` | 379 | 379 | +0 | sin cambios |
| `content_cards` | 772 | 773 | +1 | +1 legacy |
| `content_card_versions` | — | 773 | — | materializada |
| `card_mints` | 42 | 43 | +1 | ver nota ¹ |
| `card_price_stats` / `_daily` | 1 / 5 | 1 / 5 | +0 | ver nota ¹ |

```
[PASS] NO USER CARD LOST           53 → 53, huella idéntica
[PASS] NO INSTANCE LOST            0 huecos en v_instance_version_gaps
[PASS] NO SERIAL LOST              user_cards intacta (serial está en la huella)
[PASS] NO OWNERSHIP LOST           user_id en la huella, sin cambios
[PASS] NO DECK BROKEN              10 cartas en mazos, mismas uid
[PASS] NO MARKET BROKEN            1 listado · 0 ofertas, huellas idénticas
[PASS] NO CARD ID LOST             ninguna referencia desaparecida
```

**¹ Las tres diferencias, explicadas con evidencia y no con una afirmación.** No las causó la
migración: las causaron los ~30 verificadores ejecutados entre las dos instantáneas
(`economy:verify` abre sobres y ejecuta una venta real).

- `card_mints`: **0 perdidas**, 1 nueva (`aspas__americas-winner`, salida de un sobre de un
  verificador). Es un contador global de seriales y **por diseño no se decrementa nunca**:
  hacerlo permitiría reutilizar un número de serie.
- `card_price_stats` / `_daily`: **0 perdidas**; el único `card_id` afectado es
  `yuran__bronze`, la carta con la que `economy:verify` comercia.
- Y la prueba de que la migración no puede tocarlas: `0038_card_versioning.sql` **no
  contiene ni un `insert` ni un `update`** sobre esas tablas (solo un `count` dentro de la
  guarda de purga), y el migrador solo hace un `select` sobre `card_mints` para citar la
  justificación de la carta legacy.

Además, `economy:verify` **no borra sus cuentas de prueba** — deuda preexistente ya declarada
en 8.1 (D-4). Se borró la que dejó esta sesión y se volvió a medir.

Artefactos: `docs/cards/integrity-82-before.json`, `docs/cards/integrity-82-after.json`.

---

## 15. Tests, typecheck, build y QA (Fases 15 y 17)

| | Resultado |
|---|---|
| `npm test` | **766/766** — sin tocar ni una prueba |
| `npm run typecheck` | limpio (web + scripts) |
| `npm run build` | compila; `/api/admin/cards` registrada |
| `content-version:verify` | **66/66** |
| `content-version:qa` | **28/28** |
| `content-catalog:verify` (8.1) | **62/62** |
| `content-catalog:qa` (8.1) | **33/33** |
| `audit:stability` (build de producción) | 105 comprobaciones · **P0 = 0 · P1 = 0 · P2 = 0** |

**Verificadores de regresión, todos en verde**: `pack`, `collection`, `deck`, `content`,
`economy`, `security`, `craft`, `marketplace`, `telemetry`, `analytics`, `operations`,
`loop`, `progression`, `events`, `duel-gameplay`, `duel-balance`, `card-generator`,
`materializer`, `catalog-builder`, `publisher`, y los ocho de PvP (573 comprobaciones:
`pvp` 41, `pvp-sync` 48, `pvp-matchmaking` 111, `pvp-rating` 103, `pvp-rating-settlement` 77,
`pvp-timeout` 76, `pvp-arena` 66, `pvp-ratelimit` 51).

**El determinismo de los sobres sigue intacto**: 60 aperturas (13 sobres × 5 semillas), 0
divergencias entre el motor alimentado desde código y desde base de datos — el mismo listón
que 8.1, ahora con una carta retirada en la base que **no** entra en el pool.

**Sobre el `audit:stability`**: una primera pasada contra el servidor de *desarrollo* dio 2
P1. Los dos eran el WebSocket de HMR (`ws://…/_next/webpack-hmr`) fallando con
`ERR_NO_BUFFER_SPACE`: agotamiento de sockets de Windows tras ~30 verificadores. Se comprobó
contra un **build de producción**, donde ese WebSocket no existe: **0 P0, 0 P1, 0 P2** — mejor
incluso que los 9 P2 con que cerró 8.1.

### QA real (Fase 17)

Una cuenta nueva compra un sobre, se queda una carta, la mete en un mazo, empieza un duelo y
la anuncia en el mercado. Entonces un **administrador real, por la API real**, edita esa
carta. Y se vuelve a mirar todo.

| # | Paso | Resultado |
|---|---|---|
| 1 | admin autenticado | 200 |
| 2-3 | carta elegida (`valyn__silver`) e inspección | v1 · OVR 81 · PUBLISHED · `{"1":1}` ejemplares |
| 4 | ejemplar creado jugando | anclado a v1 por el trigger |
| 5 | edición por la API | v1 → v2 · OVR 81 → 90 · rareza → legendary |
| 6 | la definición cambió de verdad | OVR 90 |
| 7 | **colección** | **OVR 81** |
| 8 | **inventario** | el ejemplar sigue, con su uid y su serie |
| 9 | **mercado** | **OVR anunciado 81**, precio 900 intacto |
| 10 | **economía** | desguace sin cambios |
| 11 | **mazo** | legal, suma OVR 890 |
| 12 | **duelo** en curso | **mano OVR 81**; `duel_matches.state` conserva el trío |
| 13 | **PvP** | el mazo entra en cola con las cartas del jugador |
| 14 | **histórico** | 2 versiones con ventana y motivo · 0 huecos |
| 15 | usuario normal | sesión, publicación, retirada, API directa y RPC: **todo 401 / 42501** |

**Datos de prueba**: todas las cuentas borradas, todas las definiciones restauradas, 0
versiones de prueba restantes, listado fixture eliminado. Estado final: 773 definiciones ·
773 versiones · 53 instancias · 0 sin versión · 0 huecos · 0 huérfanas · 0 cuentas residuales.

---

## 16. Rendimiento (Fase 16)

| Medida | Resultado |
|---|---|
| cargar catálogo + historial completo | **47 ms** (773 definiciones + 773 versiones, una pasada) |
| segunda llamada | **0 ms** (caché, misma instancia) |
| 10.000 resoluciones por definición | 0-1 ms |
| 10.000 resoluciones **por versión** | 3-5 ms |
| resolver una colección entera | 53 instancias en **6 ms**, **una** consulta |
| sorteo de sobres | sin cambio: pool cacheado, O(1) por apertura |

**Sin N+1.** El historial se carga entero de una vez —crece con las publicaciones, no con el
tráfico ni con el número de jugadores— y se indexa por `cardId#version` en un `Map`. Las
versiones de los listados del mercado se resuelven en lote. Si algún día el historial creciera
de verdad, lo que hay que cargar es el subconjunto referenciado por `user_cards`, no volver a
consultar por instancia.

**Sin duplicación masiva**: N ejemplares de la misma carta y versión comparten una fila. Con
el snapshot dentro de `user_cards` habrían sido 15 campos por ejemplar.

---

## 17. Decisiones rechazadas, y por qué

| Descartado | Motivo |
|---|---|
| **Copiar el snapshot en `user_cards`** | Duplica 15 campos por ejemplar (hoy 53, mañana millones) y crea la segunda fuente de verdad que 8.1 ya rechazó (§Pregunta 9). La normalización por versión da lo mismo sin el coste. |
| **Inferir la versión por `obtained_at` + rangos de vigencia** | **Medido: sería incorrecto.** `app_buy_listing` reescribe `obtained_at` al vender (0020:273); 3 de las 53 instancias actuales darían la versión equivocada. Los rangos se guardan igual —responden «qué había vigente en T»— pero la autoridad es el puntero. |
| **Una tabla `card_instances` nueva** | `user_cards` ya ES la tabla de instancias, con RLS, índice único de serial y 5 rutas de escritura. Migrarla sería la operación más peligrosa del bloque a cambio de nada. |
| **Modificar las 5 RPC de acuñación** | Cinco sitios donde olvidarse, hoy y en cada ruta futura. Un `BEFORE INSERT` lo hace en uno y no toca ninguna RPC crítica. |
| **`minted_version NOT NULL`** | Obligaría a inventar una versión para una carta fuera del catálogo — un caso real y medido. `NULL` dice la verdad. |
| **FK `minted_version → content_card_versions`** | Misma razón que la FK de `card_id` en 8.1: el pipeline de torneos puede acuñar fuera del catálogo. Se vigila con `v_instance_version_gaps`. |
| **Congelar `marketValue` en la instancia** | Guardar el número junto a sus entradas crea dos verdades que divergen al primer ajuste de fórmula. Se congela la entrada; la salida se calcula. |
| **Borrar `derke__champions-mvp`** | Es historia real: un serial acuñado. Borrarlo sería falsificar el registro. |
| **Rehacer la banda antifraude por versión** | Cambiaría las reglas del mercado, que el encargo pide no tocar, y no hace falta para la integridad. Queda como deuda D-1. |
| **Una RPC genérica de alta de cartas** | Sería superficie administrativa de 8.3 colada por la puerta de atrás. `app_content_materialize_legacy` es deliberadamente estrecha: solo `legacy`, siempre `RETIRED`. |

---

## 18. Deudas técnicas

| id | Deuda | Por qué no ahora |
|---|---|---|
| **D-1** | La **banda antifraude del mercado es ciega a la versión**: `_price_anchor` lee `card_price_stats.avg_price` y `card_reference.fair_value` por `card_id`. Si una carta tuviera dos versiones con OVR muy distinto, la banda de la vieja se calcularía contra el ancla de la nueva. | Solo se vuelve explotable cuando exista edición en producción. Arreglarlo es cambiar el esquema del mercado (clave por `(card_id, version)`), que el encargo pide no tocar. **8.3 debe re-sincronizar `card_reference` al publicar una versión.** |
| **D-2** | El **cliente** sigue renderizando la colección desde el catálogo generado en TypeScript. | Sin acceso a versiones no puede mostrar la histórica. Se cierra cuando 8.3/8.4 sirvan la colección desde el servidor. La garantía de 8.2 es **server-side**: todo lo que mueve dinero o decide una partida ya resuelve por versión. |
| **D-3** | `variant.serialLimit` sigue en código y **no** está congelado en la versión. Cambiarlo movería `instanceValue` de las cartas serializadas ya poseídas. | El resto de la variante (rank) sí se congela. `serialLimit` requiere decidir antes qué significa cambiar la tirada de una serie ya acuñada — es una decisión de producto, no de esquema. |
| **D-4** | `content_cards` **no tiene columnas cosméticas**, así que hoy toda edición exige versión nueva. | Arte y descripción llegan en 8.3; entonces aparece la categoría «SAFE sin versión». |
| **D-5** | Sigue **sin FK** `user_cards.card_id → content_cards.card_id`. | Heredada de 8.1. Materializar la legacy cerró el único huérfano (`v_content_card_orphans` = 0), así que el camino queda abierto — pero el pipeline de torneos todavía puede acuñar fuera del catálogo. |
| **D-6** | `economy:verify` **no borra sus cuentas de prueba** (residuo del 03, 08 y 09 de septiembre). | Preexistente, declarada en 8.1. Ensucia las mediciones de integridad. |
| **D-7** | La migración 0038 se aplica **a mano con `psql`**, como 0026-0037. | Convención vigente del repositorio: `supabase_migrations.schema_migrations` solo registra hasta 0025. |
| **D-8** | No hay **UI** de versiones ni de ciclo de vida. | Es 8.4. `/api/admin/cards` es la superficie mínima que el modelo necesita para demostrarse. |

---

## 19. Criterio READY

| # | Criterio | |
|---|---|---|
| 1 | modelo claro Definition / Version / Instance | ✅ 1 tabla + 1 columna |
| 2 | las 53 instancias históricas protegidas | ✅ huella idéntica |
| 3 | ninguna edición muta una instancia histórica | ✅ probado en dominio y por HTTP |
| 4 | se puede reconstruir históricamente una instancia | ✅ 0 huecos |
| 5 | lifecycle definido | ✅ 7 estados, transiciones validadas |
| 6 | publicación definida | ✅ `app_content_publish_version`, con motivo |
| 7 | retirada no destruye histórico | ✅ RETIRED resuelve, no sortea |
| 8 | `derke__champions-mvp` preservada | ✅ legacy + RETIRED, `card_mints` intacta |
| 9 | ownership intacto | ✅ |
| 10 | seriales intactos | ✅ |
| 11 | decks intactos | ✅ |
| 12 | mercado intacto | ✅ |
| 13 | packs intactos | ✅ 60 aperturas, 0 divergencias |
| 14 | duelos intactos | ✅ partida en curso inmune |
| 15 | PvP intacto | ✅ 573 comprobaciones |
| 16 | economía intacta | ✅ fórmulas sin tocar |
| 17 | seguridad server-side | ✅ 4 capas |
| 18 | RLS / constraints | ✅ |
| 19 | tests pasan | ✅ 766/766 |
| 20 | typecheck pasa | ✅ |
| 21 | build pasa | ✅ |
| 22 | QA real pasa | ✅ 28/28 |
| 23 | no hay P0 | ✅ |
| 24 | no hay P1 nuevo | ✅ 0 en producción |
| 25 | **no se ha hecho commit** | ✅ |
| 26 | **no se ha hecho push** | ✅ |
| 27 | **no se ha hecho deploy** | ✅ |

---

## 20. Cómo reproducirlo

```bash
npx supabase start
npm run build && npx next start -p 3005

# Esquema (convención del repo: a mano, como 0026-0037)
docker cp supabase/migrations/0038_card_versioning.sql supabase_db_DRLCards:/tmp/0038.sql
docker exec supabase_db_DRLCards psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/0038.sql

npm run content-catalog:integrity -- --capture docs/cards/integrity-82-before.json
npm run content-version:migrate          # --dry-run para verlo sin escribir
npm run content-catalog:integrity -- --capture docs/cards/integrity-82-after.json
npm run content-catalog:integrity -- --compare docs/cards/integrity-82-before.json docs/cards/integrity-82-after.json

BASE_URL=http://127.0.0.1:3005 npm run content-version:verify
BASE_URL=http://127.0.0.1:3005 npm run content-version:qa
```

**Reversión**: la cabecera de `0038_card_versioning.sql` la documenta. Quita el trigger, las
funciones, la FK, la columna `minted_version` y la tabla de versiones. **Ni una fila de
`user_cards` se pierde**: solo se le retira una columna añadida. La carta legacy la crea el
migrador, así que revertir también la retira.
