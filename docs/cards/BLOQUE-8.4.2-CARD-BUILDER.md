# BLOQUE 8.4.2 — NEXUS Card Builder · creación, edición y preview real

> **Estado: READY.** El panel crea y edita cartas reales, el servidor deriva todo lo que no es
> el trío de combate, y la previsualización es el mismo `Card3D` + `CardRenderer` del juego.
> `admin-cards:verify` **102/102** · `admin-cards:qa` **84/84** · `npm test` **766/766** ·
> `audit:stability` **P0 0 · P1 0**. **Sin commit, sin push, sin deploy.**

---

## 0. Resumen ejecutivo

Este bloque tenía que construir un formulario. Lo primero que hizo fue medir el que había, y
lo que encontró cambió el trabajo: **el panel de 8.4.1 aceptaba del navegador campos que el
dominio deriva**, y uno de ellos llegaba hasta el precio de mercado.

Tres medidas contra el servidor real, no tres sospechas:

| Petición | Lo que pasaba |
|---|---|
| `publish { ovr: 99 }` sin tocar el trío | Se guardaba **99** sobre un trío de 84/80/65 — un OVR que ninguna función del dominio produce. Y el ancla del mercado se recalculaba sobre él: `fair_value` **127.775**. |
| `publish { combat: { stronghold: 500, gamesense: -20 } }` | Se guardaba **500 y -20**. La escala del dominio es 0-99 y `combat` es `jsonb` sin ninguna restricción. |
| Cualquier `publish` | El `checksum` quedaba en **cadena vacía**: la RPC hacía `coalesce(p_patch->>'checksum','')` y la ruta nunca lo enviaba. |

El tercero es el más callado y el que más lejos llega: `content-catalog:verify` afirma
«checksum de cada fila = huella de la carta generada», así que **la primera publicación de una
versión sobre una carta del generador habría roto esa verificación** sin que nada avisara
antes. Y editar un borrador era peor todavía: `coalesce(p_patch->>'checksum', checksum)`
conservaba la huella ANTERIOR sobre un contenido nuevo. Una huella que miente es peor que no
tenerla.

**La regla de 8.4.2, en una línea:** una definición de carta tiene exactamente **una entrada
administrable —el trío de combate—** y todo lo demás se deriva de (jugador, variante, trío) con
las mismas funciones que construyen el catálogo desde el bloque 1.

Además, el trabajo destapó **cuatro fallos más**, todos medidos: la huella dependía de *cómo se
escribiera una fecha*; el botón de 44 px del listado pasaba la QA solo porque no estaba en
pantalla; publicar dejaba marcadas como `editorial` cartas del generador que las limpiezas de
8.2 y 8.3 no restauraban; y la comprobación de 44 px del editor destapó dos controles de 34 px.

---

## 1. Auditoría (Fase 1) — la clasificación de cada campo

Lo primero fue decidir qué es cada cosa, porque «campo del formulario» no es una categoría.

| Campo | Clase | De dónde sale | ¿Editable? |
|---|---|---|---|
| `card_id` | **IMMUTABLE** | `${playerId}__${variantId}`, con CHECK en la base | no |
| `player_id`, `variant_id` | **IMMUTABLE** | la identidad de la carta | no |
| `ordinal` | **IMMUTABLE** | el orden de generación; decide el reparto de sobres (8.1) | no |
| `origin` | **IMMUTABLE** | de dónde salió la definición | no |
| `combat` (trío) | **ADMINISTRABLE** | lo escribe una persona · 3 enteros de 0 a 99 | **sí, y es el único** |
| `ovr` | **DERIVED** | `computeCombatOvr(applyCombatBoost(base, boost))` | no |
| `stats` (las 6) | **DERIVED** | `applyStatBoost(player.stats, boost)` | no |
| `stat_boost` | **DERIVED** | `variant.statBoost` | no |
| `rarity_rank` | **DERIVED** | `variant.rank` | no |
| `rarity_bucket` | **DERIVED** | `bucketForRank(rank)` | no |
| `checksum` | **DERIVED** | `cardChecksum(card)` sobre la fila final | no |
| `data_version` | **DERIVED** | `DATA_VERSION` (`VCT-2026`) | no |
| `generated_at` | **DERIVED** | la calibración con la que nació; una edición no la mueve | no |
| `source` | **DERIVED** | se deduce: ¿el trío es el del generador o lo puso alguien? | no |
| `lifecycle` | **ADMINISTRABLE** aparte | la acción de ciclo de vida, no una edición | por su propia acción |
| todo lo anterior | **VERSIONED** | una fila inmutable en `content_card_versions` | histórico |
| `market value`, `salvage` | **DERIVED, no persistidos** | `marketValue(card)`, `salvageValue(card)` | no existen como columna |

Dos consecuencias que merecen decirse en voz alta:

**El OVR no es un campo, es un resultado.** La trazabilidad hasta métricas reales de VLR costó
los bloques 1 y 2. Un formulario que permitiera escribirlo convertiría el catálogo en opinión.

**`source` se deduce, no se pregunta.** Si el trío que llega es exactamente el que el generador
deriva hoy, la carta sigue siendo `vlr`. Si difiere, la ha escrito una persona y queda marcada
`editorial`. Es la diferencia entre «esto sale de las métricas» y «esto lo decidió alguien», y
tiene que verse en la fila — no en un comentario.

---

## 2. Arquitectura: una derivación, dos consumidores

```
                    src/domain/cards/combat.ts          ← la matemática, congelada
                              │  deriveCard()
                              ▼
              src/server/services/cardDerivation.ts     ← la composición, una vez
                    deriveDefinition()  validateCombat()  unboost()
                       │                              │
        ┌──────────────┘                              └──────────────┐
        ▼                                                            ▼
  createCard()                                    derivarEscritura()  (ruta)
  (alta)                                          updateDraft · publish
```

`deriveDefinition()` es el único sitio del panel donde se compone una definición. Recibe
(jugador, variante, trío base, origen) y devuelve la **fila entera**, firmada. Las RPC ya no
rellenan huecos: exigen la fila completa.

### Por qué el cliente calcula lo mismo, y por qué no es duplicar

El editor llama a `deriveCard()` mientras se teclea. No es una segunda fórmula: es la misma
función pura del dominio, importada. Lo del cliente es una **predicción**; lo que se guarda lo
vuelve a derivar el servidor, que **descarta** cualquier cifra que venga en la petición. Como
es la misma función, la predicción es exacta — el administrador ve antes de guardar exactamente
lo que se va a guardar.

### El trío base y el trío en carta

`content_cards.combat` guarda el trío **con** el bonus de la variante aplicado; `deriveCard`
espera la **base**. `unboost()` deshace ese paso para poder editarlo, y **se comprueba a sí
misma**: vuelve a aplicar el bonus y, si no reproduce el trío guardado, devuelve `exact: false`
y el editor lo avisa en pantalla. Para una carta generada la vuelta siempre es exacta, porque
`final = clamp(base + boost)` garantiza `final ≥ boost`.

---

## 3. Las pantallas

| Ruta | Qué hace |
|---|---|
| `/admin/cartas/nueva` | Jugador (búsqueda con debounce) → variante → **previsualización en vivo** → alta en DRAFT |
| `/admin/cartas/[id]/editar` | **NUEVA.** Tres campos, lo derivado a la vista, la carta al lado, y el aviso de a cuántos ejemplares NO afecta |
| `/admin/cartas/[id]` | La ficha se queda como resumen que se lee, y enlaza al editor |

La ficha **perdió** su editor en línea, y no por gusto de tener otra página: aquellas cuatro
casillas —OVR, SH, GS, EF— eran justo la puerta por la que se colaba un OVR incoherente. El
editor nuevo necesita sitio: la carta al lado, lo derivado a la vista y el recuento de
ejemplares.

### Rendimiento

El editor **no** usa `cardSheet()` (nueve consultas: historial, distribución, economía,
diario). Usa `cardEditor()`: **tres**. Un editor tiene que abrirse rápido, y para editar un
trío no hace falta el diario.

---

## 4. La previsualización (Fases 8 y 9)

No existe `AdminCard`, ni `AdminCardPreview`, ni `CardMock`. `CardPreview` pinta:

```
Card3D  (mode="hover", glow = paleta de la variante)
  └── CardRenderer  (el motor por capas del juego)
        └── PlayerPhoto · TeamLogo · Flag · VariantSeal · CardEffects · SerialBadge
```

Es la misma pareja que usan la colección, el álbum y la revelación de sobres. Si mañana cambia
el chaflán de la carta, esta pantalla cambia sola.

**Sin número de serie, a propósito.** Una definición no es un ejemplar: no tiene dueño, ni
serie, ni acuñación, ni listado. A `CardRenderer` se le pasa `serial` sin valor —la chapa
sencillamente no se dibuja— y al lado se dice en palabras qué tirada tendrá *cuando* exista un
ejemplar. Un `#1/25` inventado para que la preview quede bonita sería enseñar como real algo
que no existe, y en un juego con cartas serializadas esa confusión sale cara. Encima de la
carta va `Preview · sin ejemplar`, fuera del marco: tapar la carta para avisar de que es una
previsualización estropea justo lo que se ha venido a mirar.

El trío de combate se lee **debajo** de la carta, porque `CardRenderer` no lo pinta en la cara
(la cara lleva las seis estadísticas heredadas) y es justo lo que se está editando.

---

## 5. Validación y el contrato de la API

```
POST /api/admin/cards
  { action: "editor",      cardId }                                   → lo justo para editar
  { action: "updateDraft", cardId, combat, reason, expectedVersion }  → DRAFT, en sitio
  { action: "publish",     cardId, combat, reason, expectedVersion }  → versión nueva
```

Un campo derivado o inmutable en el cuerpo **no se ignora: se rechaza diciendo de dónde sale**.

```
400  `ovr` no se envía: el OVR sale del trío con computeCombatOvr(); no se escribe a mano
400  `rarity_rank` no se envía: el rank lo fija la variante
400  `player_id` es inmutable: cambiarlo haría de esta carta otra carta distinta
400  `patch` ya no existe. Envía `combat` con el trío base; el resto lo deriva el servidor.
400  stronghold está fuera de la escala 0-99 (llegó 500)
400  stronghold debe ser un entero (llegó 70.5)
400  Esa versión sería idéntica a la vigente: no se publica una versión que no cambia nada
```

**Dos puertas, no una por desconfianza.** La ruta valida para poder dar un mensaje útil; la
base valida porque es el último sitio donde el dato todavía se puede rechazar:

```sql
create or replace function public._combat_valido(c jsonb) ...   -- 3 enteros, 0..99
alter table content_cards        add constraint content_cards_combat_valido        check (...)
alter table content_card_versions add constraint content_card_versions_combat_valido check (...)
```

Comprobado esquivando la ruta: `app_content_update_draft` con `stronghold: 500` llamada
directamente contra PostgREST → rechazada por la restricción.

Y las dos RPC **exigen** el `checksum`: si no llega, se paran. Antes lo rellenaban con cadena
vacía (publish) o con la huella anterior (draft).

---

## 6. El fallo de la fecha

`content-catalog:verify` seguía fallando después de arreglar todo lo anterior, con una
diferencia de huella. La causa:

```
PostgREST devuelve   2026-08-31T00:00:00+00:00
fromCardRow() usa    2026-08-31T00:00:00.000Z     ← new Date(...).toISOString()
```

`generatedAt` entra en `cardChecksum()`, así que **la huella dependía de cómo se escribiera la
fecha**, no de la fecha. La firma que ponía una edición era distinta de la que calcula quien la
comprueba, aunque las dos describieran exactamente la misma carta. Se normaliza con
`toISOString()` en la derivación, que es la forma canónica que usa el resto del sistema.

---

## 7. Concurrencia (Fase 12)

El modelo es el de 8.4.1 —`expectedVersion` comprobado **dentro** de la RPC, bajo su propio
`for update`— y este bloque añade lo que faltaba en la pantalla.

**Un fallo del editor, corregido antes de salir:** la primera versión leía `error` justo
después de `await run(...)` para detectar el conflicto. `error` es estado de React: en ese
punto todavía tiene el valor de la llamada ANTERIOR, así que el aviso habría llegado una
edición tarde. Ahora el conflicto se toma del indicador `conflict` que la ruta ya devuelve, no
de comparar el texto del mensaje.

Cuando otro se adelanta, la pantalla:

- **no borra lo tecleado** — los tres números siguen en el formulario;
- dice cuál es la versión vigente ahora;
- ofrece recargar para decidir sobre esa base.

Verificado: dos publicaciones simultáneas con el mismo `expectedVersion` → **una** sale
adelante (`exitos === 1`), la otra recibe 409 con `conflict: true` y `current`.

---

## 8. Ciclo de vida (Fases 16 y 17)

Comprobado contra el **registro que usa el sorteo**, no leyendo `lifecycle` y dando por hecho
el resto:

| Estado | En el catálogo | En el registro de sorteo | Se versiona |
|---|---|---|---|
| `DRAFT` | no | no | se edita en sitio |
| `PUBLISHED` | sí | **sí** | sí, versión nueva |
| `RETIRED` | sí | **no** | sí — retirar la saca de circulación, no congela su definición |
| `ARCHIVED` | sí | no | **no**, es el final del camino |

Retirar deja fecha y no borra nada: definición, versiones e instancias siguen. Y versionar una
carta retirada **no** la devuelve al sorteo: el estado manda sobre la edición.

---

## 9. Duplicados (Fase 15)

No hace falta una restricción nueva, y conviene explicar por qué **no** se ha puesto:

`content_cards.card_id` es la clave primaria y vale exactamente `player_id || '__' || variant_id`,
garantizado por el CHECK `content_cards_identity` de 0037. Así que «mismo jugador + misma
variante» ya es estructuralmente imposible de duplicar, **sin** tocar el contenido histórico:

- una carta `RETIRED` sigue ocupando su id — y debe: crear una segunda `derke__champions-mvp`
  sería crear una carta distinta con el mismo nombre;
- la carta `legacy` `derke__champions-mvp` convive sin conflicto;
- las versiones no compiten por el id: viven en otra tabla, con `(card_id, version)`.

Una `UNIQUE` añadida sobre `(player_id, variant_id, lifecycle)` —el atajo obvio— habría roto
justo eso. El alta responde **409** cuando el id ya existe, comprobado.

---

## 10. Seguridad (Fases 13 y 14)

Sin cambios de modelo respecto a 8.4.1, y con la superficie nueva cubierta:

- El actor sale **siempre** de `verifyAdmin` → `profiles.is_admin`. Nunca del cuerpo.
- `middleware.ts` corta `/api/admin/*` sin `Bearer` en el borde.
- RPC `security definer` con `execute` revocado a `anon` y `authenticated`.
- Anónimo y usuario normal: **401 en las nueve acciones**, incluida `editor`.
- Suplantar `userId` / `role` / `is_admin` en el cuerpo no sirve: no se leen.
- Inyectar rareza, stats, OVR o datos derivados: **400 con motivo**, campo a campo.
- Cambiar `card_id`, `player_id`, `variant_id`, `ordinal`, `origin`, `lifecycle` o
  `definition_version` por el cuerpo: **400**, campo a campo.
- El diario guarda `actor` (uuid), `action`, `card_id`, `detail`, `at`. **Sin PII.**

---

## 11. D-1b y el mercado (Fase 18)

Sin cambios en las reglas del mercado. Lo que cambia es que ya no se le puede mentir: el ancla
`content_card_market_anchor (card_id, version)` se calcula con `marketValue()` sobre la fila
**derivada**, así que un OVR inventado ya no puede inflarla. La medida de la auditoría —
`fair_value` 127.775 sobre un OVR 99 escrito a mano— es exactamente el camino que este bloque
corta.

`content-pools:qa` comprueba de punta a punta: publicar una versión sobre una carta con
historial de ventas → se crea el ancla → describe la versión NUEVA → coincide con lo que
devuelve la API → los listados y las instancias siguen intactos.

**D-1c sigue declarada** (viene de 8.4.1): `card_price_stats.avg_price` es por `card_id`, no por
versión — el precio real de mercado agrega versiones **por diseño**, porque es lo que la gente
ha pagado por esa carta, no por esa versión de esa carta.

---

## 12. QA real (Fase 23)

`admin-cards:qa` — **84/84**, con navegador real, sesión real y viewport real:

1. Sin sesión → «Acceso restringido», y **cero** cartas filtradas.
2. Usuario normal → igual. El 401 que registra la consola **es** la seguridad funcionando.
3. Admin → 773 definiciones, total contrastado contra `count(*)`; la búsqueda filtra contra la base.
4. Alta real → `benjy__mythic`, DRAFT, v1.
5. Ficha con `CardRenderer` y **el sigilo de respaldo comprobado** (no hay arte en el repo).
6. **El editor, tecleando de verdad**: 3 campos y ninguno más, **ningún campo de OVR**, y al
   subir stronghold a 90 el OVR pasa de 87 a 91 y el trío en carta muestra 99 (90 + 12,
   saturado). Guardar 70/60/50 → el servidor deriva 82/72/62 y OVR 84. Enviar `ovr` → 400.
7. Publicar → aparece PUBLISHED sin reiniciar (la caché se invalida).
8. **Un ejemplar real**, acuñado por `app_apply_pack_open` —la misma RPC que usa el servidor al
   abrir un sobre—: consume un sobre, el trigger de 8.2 le sella `minted_version`, recibe la
   serie #1, sube `card_mints`, y **el dueño la ve en su colección** servida por
   `/api/game/state` con su serie y su versión. Después se publica una versión nueva: la
   definición pasa de OVR 84 a 69 y **el ejemplar no se mueve** — misma uid, misma serie, misma
   `minted_version`, y su versión sigue describiendo lo que obtuvo, cerrada pero intacta.
9. Retirar → RETIRED, y **nada de lo que ya existía ha cambiado** (huella idéntica).
10-11. Responsive y accesibilidad (§13).
12. **Purgar**: primero se comprueba que una carta CON ejemplares **no se puede borrar** —esa
    negativa es una garantía, no un estorbo—; luego se retira el ejemplar de prueba y se purga
    sin dejar un solo puntero huérfano.

---

## 13. Responsive (Fase 21) y accesibilidad (Fase 22)

Con `Emulation.setDeviceMetricsOverride` vía CDP, **12 páginas medidas una a una** (4 rutas × 3
anchos):

| | 390 × 844 | 768 × 1024 | 1440 × 900 |
|---|---|---|---|
| Desbordamiento horizontal | ninguno | ninguno | ninguno |
| Controles bajo 44 px | **0** de 22 · 3 · 7 · 64 | idem | idem |
| Forma del listado | fichas apiladas | tabla | tabla |

**Dos hallazgos, y el segundo es sobre la propia QA.**

1. El editor tenía **dos controles de 34 px** («Deshacer cambios» y «Restaurar el trío
   derivado»): `NxButton size="sm"` mide `min-h-[34px]`. Corregidos.
2. **La comprobación de 8.4.1 aprobaba el listado porque el botón no estaba en pantalla.**
   «Limpiar filtros» solo se pinta cuando hay un filtro puesto, y también medía 34 px. La QA
   ahora **escribe un filtro antes de medir** el listado: mide los controles que existen, no
   los que se ven de entrada.

Accesibilidad, acotada al panel (`[data-admin-panel]`): 0 controles sin nombre accesible, 11
secciones con `aria-labelledby`, tablas con `<caption>`, 0 imágenes sin `alt`, cada campo con
su `<label htmlFor>` y su `aria-describedby`, y ningún `div` haciendo de botón — los elementos
pulsables son `<button>` o `<Link>`.

---

## 14. Consecuencias en otros bloques

Cambiar el contrato tuvo efectos fuera del panel. Los tres se arreglaron; ninguno se silenció.

**1. Tres verificadores llamaban con el contrato anterior.** `content-version:verify` (5
fallos), `content-version:qa` (3) y `content-pools:qa` (2) enviaban `patch: { ovr }`.
Actualizados: ahora envían el trío y **comprueban que el OVR resultante es el que deriva el
dominio**, en vez de comparar contra un número escrito a mano. Las comprobaciones salen
reforzadas, no debilitadas.

`content-version:verify` sigue llamando a la RPC **directamente, sin HTTP** — a propósito: lo
que esa familia demuestra es que la inmutabilidad aguanta en la base de datos, sin depender de
que haya un servidor delante. Lo que cambia es que la fila se compone con `deriveDefinition()`
en vez de inventarla.

**2. `source` no se restauraba.** Las limpiezas de 8.2, 8.3 y 8.4.1 devolvían `ovr`, `combat`,
`stats`, `rarity_*`, `checksum` y `lifecycle`, pero no `source` — no hacía falta, porque hasta
ahora publicar no lo tocaba. Desde 8.4.2 sí, así que una prueba que edita una carta REAL dejaba
el catálogo afirmando que una carta del generador es `editorial`.

Lo destapó `content-catalog:verify` con **un** desajuste: `caedye__bronze: source`. Restaurado,
y las cuatro limpiezas ahora devuelven también `source`, `data_version` y `generated_at`.

**3. Un enlace `<a>` a una página de Next.** Mío, de 8.4.1: el botón `▣ Cartas` de `/admin`. Es
error de lint (`no-html-link-for-pages`), corregido a `<Link>`. Sus cuatro vecinos siguen con
`<a href>`; cambiarlos es otro trabajo y se queda anotado en §17.

---

## 15. Dónde queda la garantía de 8.1

8.1 podía afirmar «lo persistido es exactamente lo que produce el generador» porque nada podía
editarlo. Desde que existe un panel que edita, esa frase hay que enunciarla sobre el conjunto
correcto — y la frontera no es una opinión, es `definition_version`:

- **v1** → nadie ha versionado esa carta. Sigue siendo, byte a byte, la generada.
- **v>1** → alguien la editó a propósito, con motivo y con actor en el diario. Y su **versión 1
  sigue siendo la generada**, porque el histórico es inmutable.

La garantía no se debilita: se enuncia mejor, y además queda comprobable de un vistazo.
`v_content_cards_editadas` (0041 §4) lista las cartas versionadas al menos una vez; hoy tiene
**cero filas**, y `admin-cards:verify` exige que vuelva a cero al terminar.

---

## 16. Regresión

| Comprobación | Resultado |
|---|---|
| `npm test` | **766 / 766** |
| `npx tsc --noEmit` | limpio |
| `npm run build` | compila · `/admin/cartas/[id]/editar` ƒ |
| `eslint` sobre lo tocado | 0 errores (2 avisos preexistentes en `/admin/page.tsx`) |
| `admin-cards:verify` | **102 / 102** |
| `admin-cards:qa` | **84 / 84** |
| `content-catalog:verify` · `:qa` | 62/62 · 33/33 |
| `content-version:verify` · `:qa` | 66/66 · 28/28 |
| `content-pools:verify` · `:qa` | 73/73 · 32/32 |
| `pack` · `economy` · `marketplace` · `collection` · `deck` · `craft` | pasan |
| `cards` 15/15 · `card-generator` 50/50 · `catalog-builder` 44/44 · `distribution` 30/30 | pasan |
| PvP ×8 | 41 · 66 · 111 · 103 · 77 · 51 · 48 · 76 — cero fallos |
| `security` · `telemetry` 35 · `analytics` 48 · `operations` 33 · `navigation` · `ux` · `progression` · `duel-gameplay` · `collection-presentation` | pasan |
| `audit:stability` | 105 comprobaciones · **P0 0 · P1 0 · P2 9** |

Los 9 P2 son el 401 de `/admin/*` cuando el auditor navega sin sesión: el guardia trabajando.

### Integridad

`content-catalog:integrity --compare integrity-841-after.json integrity-842-after.json`

```
[PASS] user_cards intacta — 53 filas, huella idéntica
[PASS] duel_decks intacta · market_listings intacta · market_offers intacta
[PASS] user_packs intacta — 10 filas · duel_matches intacta — 4 filas
[PASS] NO CARD ID LOST — ninguna referencia a carta desaparecida
[PASS] NO USER CARD LOST — 53 → 53 instancias
[PASS] NO DECK BROKEN · NO MARKET REFERENCE BROKEN
[PASS] catálogo materializado — 773 definiciones persistidas
```

`v_instance_version_gaps` **0** · `v_content_card_orphans` **0** ·
`v_content_rpc_overloads` **0** · `v_content_cards_editadas` **0** · cartas `seed-generator`
con `source ≠ vlr` **0** · cuentas de prueba **0**.

Cambian las cuatro tablas derivadas de siempre (`card_mints`, `card_reference`,
`card_price_stats`, `card_price_daily`): contadores de serie que no retroceden y precios que
las propias verificaciones reescriben. Ninguna guarda propiedad de nadie. Está desglosado en
el informe de 8.4.1 §13.

---

## 17. Deudas

1. **La cabecera global tiene dos controles bajo 44 px** («Inicio» 34×34, «Tu nivel» 136×42, en
   `GameShell`). Sale en todas las pantallas del producto; corregirlo es un cambio visual
   global. Las medidas se acotan a `[data-admin-panel]` y esto queda anotado, no colado como
   aprobado.
2. **No hay arte.** `public/players` y `public/teams` están vacíos: toda carta del juego pide un
   PNG que no existe y cae al sigilo. Estado conocido a la espera del Artwork Pipeline; la QA
   lo admite explícitamente y a cambio comprueba que el respaldo se monta.
3. **Cuatro enlaces `<a href>` a páginas de Next** en `/admin` (data-engine, torneos, assets,
   releases). Preexistentes; solo se corrigió el que introduje yo.
4. **`/admin/torneos/page.tsx` llama a `useMemo` condicionalmente** (error de lint
   `rules-of-hooks`). Preexistente y fuera de este bloque.
5. **D-1c**: `card_price_stats.avg_price` sigue siendo por `card_id`. Es la decisión correcta y
   está declarada desde 8.4.1.
6. **Las migraciones 0037–0041 están aplicadas a mano** (`docker cp` + `psql`), siguiendo la
   convención del repositorio para 0026–0041.
7. **`.env.local` (ignorado por git) tiene `NEXT_PUBLIC_ADMIN=1`.** El servidor local corre
   `next start` (`NODE_ENV=production`), donde sin esa variable no hay panel y los verificadores
   del bloque no pueden ejecutarse. Producción sigue necesitando activarla a propósito, y aun
   activada no abre la puerta: quien decide es `verifyAdmin`.

---

## 18. Criterio READY

| # | Criterio | Estado |
|---|---|---|
| 1-4 | `/admin/cartas/nueva` crea carta real, con primera versión, en DRAFT | ✅ |
| 5 | Edición funciona | ✅ DRAFT en sitio · PUBLISHED versiona |
| 6 | Publicación respeta el versionado | ✅ histórico cerrado, nunca reescrito |
| 7 | Retirada funciona | ✅ sale del sorteo, no se borra nada |
| 8 | Preview usa el Card3D real | ✅ `Card3D` + `CardRenderer`, sin componente paralelo |
| 9 | No se inventan instancias | ✅ sin serial, sin dueño, marcada «sin ejemplar» |
| 10 | Validación server-side | ✅ ruta + restricción en la base |
| 11 | Duplicados controlados | ✅ por la clave primaria, sin romper histórico |
| 12 | Concurrencia protegida | ✅ `exitos === 1`, y la pantalla no pierde lo tecleado |
| 13-14 | Admin auth · usuario normal no puede mutar | ✅ 401 en las nueve acciones |
| 15 | D-1b no queda rota | ✅ y ya no se le puede mentir el OVR |
| 16-18 | Caché · DRAFT fuera de sobres · RETIRED fuera de drops | ✅ contra el registro de sorteo |
| 19-24 | Instancias, ownership, mazos, mercado, duelos y PvP intactos | ✅ huella idéntica + PvP ×8 |
| 25-26 | Responsive 390/768/1440 · accesibilidad | ✅ 12 páginas medidas |
| 27-32 | tests · typecheck · build · stability · sin P0 · sin P1 nuevo | ✅ |
| 33-35 | sin commit · sin push · sin deploy | ✅ |

---

## 19. Cómo reproducirlo

```bash
npx supabase start                       # 54521
npm run build && npx next start -p 3005

npm run admin-cards:verify               # 102/102
npm run admin-cards:qa                   # 84/84 — navegador real, 3 anchos

npm run content-catalog:integrity -- --capture docs/cards/integrity-842-after.json
npm run content-catalog:integrity -- --compare docs/cards/integrity-841-after.json \
                                                docs/cards/integrity-842-after.json
```

---

## 20. Ficheros

**Nuevos**

```
src/server/services/cardDerivation.ts        deriveDefinition · validateCombat · unboost
src/components/admin/cards/CardPreview.tsx   Card3D + CardRenderer, sin serie inventada
src/app/admin/cartas/[id]/editar/page.tsx    el Card Builder
supabase/migrations/0041_card_builder.sql    checksum obligatorio · trío con rango ·
                                             v_content_cards_editadas
docs/cards/integrity-842-after.json
```

**Modificados**

```
src/app/api/admin/cards/route.ts          contrato `combat`; `derivarEscritura()`; acción `editor`
src/server/services/adminCards.ts         createCard sobre la derivación única; cardEditor()
src/app/admin/cartas/nueva/page.tsx       previsualización en vivo
src/app/admin/cartas/[id]/page.tsx        editor en línea fuera; enlace al editor
src/app/admin/page.tsx                    `<a>` → `<Link>`
src/components/admin/cards/shared.tsx     botón de cerrar aviso a 44 px
scripts/admin-cards-verify.ts             familias 9 y 10 (102 comprobaciones)
scripts/admin-cards-qa.ts                 editor en navegador, ejemplar real (84)
scripts/content-version-verify.ts         contrato nuevo · restaura `source`
scripts/content-version-qa.ts             contrato nuevo · restaura `source`
scripts/content-pools-qa.ts               contrato nuevo · restaura `source`
```
