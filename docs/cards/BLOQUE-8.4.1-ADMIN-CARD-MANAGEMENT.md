# BLOQUE 8.4.1 — NEXUS Card Admin · Administración de cartas

> **Estado: READY.** El panel `/admin/cartas` existe, lee y escribe contra la base de datos
> real, y ninguna operación suya puede modificar un ejemplar ya poseído.
> `admin-cards:verify` **73/73** · `admin-cards:qa` **56/56** · `npm test` **766/766**.
> **Sin commit, sin push, sin deploy.**

---

## 0. Resumen ejecutivo

Hasta este bloque, administrar cartas consistía en editar el generador y volver a migrar. La
infraestructura de 8.1 (persistencia), 8.2 (versionado) y 8.3 (pools) ya permitía hacerlo
bien, pero no había ninguna pantalla que lo hiciera: el plano de contenido era administrable
**por `psql`**. Ahora hay tres pantallas —listado, ficha, alta— construidas con el sistema de
diseño NEXUS, y todo lo que enseñan sale de una consulta.

**Lo que este bloque NO hace, a propósito:**

- No introduce una segunda fuente de verdad. Cero `localStorage`, cero arrays fijos, cero
  mocks, cero métricas inventadas. Cuando un dato no existe, la pantalla lo dice; no lo
  rellena.
- No permite editar una carta publicada en sitio. Editar en sitio es privilegio del borrador;
  sobre una carta en juego, cambiar lo que afecta al juego **publica una versión nueva**, que
  es la frontera que 8.2 estableció y este panel se limita a respetar.
- No decide nada en el cliente. El botón que no debe existir no se pinta, pero la razón por
  la que la operación no ocurre está en el servidor, no en que el botón no esté.

**Cuatro fallos reales encontrados durante este bloque**, tres de ellos en código anterior:

1. **La comprobación de concurrencia estaba fuera de la transacción.** Dos administradores
   publicando a la vez pasaban los dos, porque `expectedVersion` se leía en la ruta antes de
   llamar a la RPC. §6.
2. **Añadir un parámetro a una RPC creó una SEGUNDA función y dejó viva la anterior**, y con
   las dos presentes PostgREST dejó de poder resolver la llamada. Lo destapó
   `content-version:verify`, no este bloque. §7.
3. **`app_content_purge_card` no avisaba a la caché del catálogo** —el mismo agujero que 8.3
   arregló para publicar y retirar, dejado a medias— **y además dejaba huérfana la fila de
   `card_reference`**. §8.
4. **La limpieza de `content-pools:qa` fallaba en silencio.** `.then(() => {}, () => {})`
   sobre un cliente de Supabase no captura nada, porque el cliente no rechaza la promesa:
   resuelve con `{ data, error }`. §9.

---

## 1. Auditoría previa: D-1b y el panel existente (Fase 0)

El encargo pedía auditar D-1b **antes** de implementar. Resultado:

| Pregunta | Respuesta |
|---|---|
| ¿El mercado ancla el precio a la definición o a la versión? | A la **definición**. `_price_anchor` leía `card_reference.fair_value` por `card_id`, sin versión. |
| ¿Qué significaba eso? | Publicar una versión con otro OVR movía el precio de referencia de **todos** los ejemplares, incluidos los acuñados bajo la versión antigua. |
| ¿Se arregló en 8.2? | No. 8.2 protegió lo que el jugador *tiene*; el *precio* seguía siendo por carta. |
| ¿Se arregla aquí? | Sí: `content_card_market_anchor (card_id, version)` + `_price_anchor_versioned(card, version)`, y `app_market_list` pasa `user_cards.minted_version`. |

El ancla la escribe el servidor con `marketValue()` —la misma función de
`domain/economy/pricing` que usa el mercado—, **nunca una fórmula reescrita en SQL**. El orden
de preferencia no cambia; lo único que cambia es que el segundo escalón sabe de qué versión
se habla:

```
1º  card_price_stats.avg_price                  lo que la carta ha valido de verdad
2º  content_card_market_anchor (card, VERSIÓN)  el valor de ESA versión
3º  card_reference.fair_value                   el ancla heredada, por si no hay (2)
```

Del panel anterior: `/admin` tenía once rutas y ninguna administraba cartas. La única guarda
era `ADMIN_ENABLED`, resuelto en 8.1 (§V-1).

---

## 2. Las tres pantallas

| Ruta | Qué es | De dónde salen los datos |
|---|---|---|
| `/admin/cartas` | Listado de las 773 definiciones: búsqueda, filtros por estado/rareza/pool, orden por 5 criterios, paginación | `POST /api/admin/cards` `action: "list"` → `listCards()`, filtrado, ordenado y paginado **en el servidor** |
| `/admin/cartas/[id]` | Ficha completa: identidad, definición, previsualización, historial de versiones, distribución, economía, propiedad, diario | `action: "sheet"` → `cardSheet()`, 8 consultas en paralelo |
| `/admin/cartas/nueva` | Alta: jugador + variante, con la marca DERIVABLE para los que el generador sabe derivar | `action: "players"` → `creatablePlayers()` |

**La previsualización es la carta de verdad.** No es una maqueta ni un `<img>`: es
`CardRenderer`, el mismo componente que pinta la carta en la colección y en el duelo. Si el
render cambia, la previsualización cambia con él, porque no hay dos.

El listado tiene dos formas, no una tabla encogida: a partir de 768 px una tabla densa de diez
columnas; por debajo, fichas apiladas. Es la misma decisión que ya toma el resto del producto.

---

## 3. Lo que se puede editar, y lo que no

La lista blanca vive en la ruta, no en la pantalla:

```ts
const EDITABLE = ["ovr", "combat", "stats", "stat_boost", "rarity_rank", "rarity_bucket"];
```

Todo lo demás —`card_id`, `player_id`, `variant_id`, `ordinal`, `serial`, `minted_version`—
es **inmutable desde el panel**. No hay ruta que los toque, ni con el token correcto.

| Estado | Editar en sitio | Publicar versión | Cambiar estado |
|---|---|---|---|
| `DRAFT` | sí (`app_content_update_draft`) | no (aún no hay nada publicado) | → `PUBLISHED`, `REJECTED` |
| `PUBLISHED` | **no** | sí (`app_content_publish_version`) | → `RETIRED` |
| `RETIRED` | no | sí | → `PUBLISHED`, `ARCHIVED` |
| `ARCHIVED` / `REJECTED` | no | **no** | — |

La ficha explica esta frontera con palabras, no la esconde: sobre un borrador dice *«se edita
en sitio»*; sobre una carta en juego, *«Está en juego. Cambiar lo que afecta al juego publica
una VERSIÓN nueva»*.

---

## 4. Por qué un ejemplar no puede cambiar

Es la propiedad que el encargo pone por delante de todo, y no depende de que el panel se
porte bien: depende de la forma de los datos.

```
user_cards (uid, card_id, serial, minted_version)  ──┐
                                                     │  (card_id, minted_version)
content_card_versions (card_id, version, ovr, ...) ──┘  fila INMUTABLE (trigger)
```

Publicar una versión **inserta una fila nueva** y cierra la anterior con `effective_to`.
Ningún camino del panel hace `update` sobre una fila de `content_card_versions`, y el trigger
de 8.2 lo impediría de todos modos. El ejemplar sigue apuntando a la versión bajo la que
nació.

Medido, no argumentado: `admin-cards:qa` toma una huella de `user_cards`, `duel_decks` y
`market_listings` **antes** de crear una carta y **después** de crearla, editarla, publicarla
y retirarla. Huella idéntica.

---

## 5. Seguridad

- El actor sale **siempre** del token (`verifyAdmin` → `profiles.is_admin`). Nunca del
  cuerpo. No hay `userId`, `role` ni `admin` que la ruta lea del JSON.
- `middleware.ts` rechaza `/api/admin/*` sin `Bearer` antes de llegar a la ruta.
- Todas las RPC de contenido son `security definer` con `revoke all` de `anon` y
  `authenticated`, y `grant execute` solo a `service_role`. Un usuario normal con su token no
  puede invocarlas ni leyendo la respuesta de red.
- Las tablas de contenido tienen RLS activo y **cero políticas**: no hay fila que un cliente
  pueda leer directamente.
- El diario (`content_audit_log`) guarda `actor` (uuid), `action`, `card_id`, `pool_id`,
  `detail` y `at`. **Ni correo, ni nick, ni IP.**

Comprobado en `admin-cards:verify` §5 y §7 con dos cuentas reales: un usuario normal recibe
401 en las nueve acciones, y la RPC directa con su token también.

---

## 6. Concurrencia: la comprobación tenía que ir dentro

**El fallo.** `expectedVersion` se leía en la ruta, antes de llamar a la RPC. Eso protege del
caso lento —A publica, B lo intenta un minuto después—, pero no del simultáneo: si A y B leen
la versión a la vez, los dos pasan la comprobación, y como la RPC toma `for update` se
serializan y **las dos publicaciones salen adelante**. No hay corrupción —el índice único
parcial garantiza una sola versión vigente— pero B ha encadenado su edición sobre una base
que nunca vio.

**La corrección** (`0040` §7): la comprobación se mueve **dentro** de la función, después del
`for update`. A partir de ahí, leer y decidir ocurren bajo el mismo cerrojo.

```sql
select * into v_card from public.content_cards where card_id = p_card_id for update;
...
if p_expected_version is not null and p_expected_version <> v_card.definition_version then
  raise exception 'La carta ha cambiado mientras la editabas (esperabas v%, hay v%)', ...
```

La verificación pasó de aceptar `exitos <= 2` a exigir **`exitos === 1`**. El criterio viejo
habría dado por bueno el fallo.

---

## 7. Dos funciones con el mismo nombre

**El fallo, y es mío, de este mismo bloque.** Para §6 hacía falta un parámetro nuevo en
`app_content_publish_version`. Añadirlo con valor por defecto parecía inofensivo: los
llamantes antiguos seguirían funcionando. Lo que hace `create or replace function` con una
firma distinta, sin embargo, es **crear una función nueva y dejar la anterior donde estaba**:

```
app_content_publish_version(text, jsonb, text, uuid)
app_content_publish_version(text, jsonb, text, uuid, integer)
```

Con las dos vivas, PostgREST recibe cuatro argumentos con nombre y contesta *«could not
choose the best candidate function»*. Es decir: **la publicación de versiones dejó de
funcionar entera**, y solo para los llamantes que usaban la firma antigua.

`admin-cards:verify` no lo vio, porque la ruta llama con cinco. Lo vio
`content-version:verify` —el verificador de 8.2—, que llama con cuatro y cayó con **5
fallos**. Es exactamente el motivo por el que la regresión completa no es opcional.

**La corrección**: se retira la firma de cuatro, y queda una sola función. Quien llame con
cuatro argumentos recibe el `null` por defecto, que es el comportamiento de antes.

**Y un centinela**, porque el error no está en el código sino en la forma de la base:

```sql
create or replace view public.v_content_rpc_overloads as
  select p.proname, count(*) as n, string_agg(...) as firmas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'app_content\_%'
   group by p.proname having count(*) > 1;
```

`admin-cards:verify` §8 falla si alguna vez vuelve a haber dos. Probado que **detecta de
verdad**: con una sobrecarga artificial la vista devuelve `app_content_purge_card x2`; sin
ella, cero filas.

---

## 8. Borrar sin dejar rastro

`app_content_purge_card` —la herramienta que borra una carta **sin historia**, usada por el
migrador y las verificaciones— tenía dos agujeros:

1. **No subía `content_catalog_version`.** 8.3 §9 arregló esto para publicar y cambiar de
   estado, pero se dejó fuera la purga. Consecuencia: la carta desaparecía de la base y el
   servidor la seguía teniendo en memoria, porque su caché solo se recarga cuando la versión
   sube.
2. **Dejaba huérfana la fila de `card_reference`.** Esa fila la escribe el panel al crear la
   carta (D-1). Al purgar, quedaba apuntando a una carta inexistente.

Lo delató `v_content_card_orphans`, la vista que 8.1 creó justo para esto, con una fila que no
debía estar ahí. Las dos cosas se corrigen en `0040` §8, y `admin-cards:qa` §11 lo comprueba
en cada ejecución: purga la carta de prueba y exige **cero** huérfanos.

---

## 9. Una limpieza que fallaba en silencio

`content-pools:qa` terminaba diciendo *«1 pools de prueba restantes»* y seguía adelante. La
causa:

```ts
await db.from("content_pools").delete().eq("id", id).then(() => {}, () => {});
```

El cliente de Supabase **no rechaza la promesa** cuando la base contesta un error: la resuelve
con `{ data, error }`. El segundo manejador de `.then` no llega a ejecutarse nunca, así que el
error se perdía sin dejar traza. Ahora cada borrado mira `error`, lo acumula, y el recuento
final **es una comprobación que falla**, no una línea informativa:

```
[PASS] la QA no deja nada suyo detras — 0 pools qa83-*
```

Importa aquí y no solo allí: el panel de 8.4.1 lista los pools, y un pool de prueba olvidado
aparece en él como si fuera contenido del juego.

---

## 10. Responsive y accesibilidad (Fase 19)

`resize_window` del control de Chrome no cambia el viewport de la página (tras redimensionar,
`innerWidth` seguía en 1920 y `outerWidth` devolvía 0), así que la comprobación se hizo con el
control CDP que el propio proyecto ya usa (`scripts/lib/cdp.ts`), con
`Emulation.setDeviceMetricsOverride` de verdad.

Las tres rutas, en los tres anchos, **9 páginas medidas una a una**:

| | 390 × 844 | 768 × 1024 | 1440 × 900 |
|---|---|---|---|
| Desbordamiento horizontal | ninguno | ninguno | ninguno |
| Controles por debajo de 44 px | 0 / 37 · 3 · 64 | 0 / 37 · 3 · 64 | 0 / 37 · 3 · 64 |
| Forma del listado | fichas apiladas | tabla | tabla |

**Un fallo real corregido:** el enlace al `card_id` de cada fila medía **84 × 14 px**. A 1440
con ratón se acierta; a 768, que se toca con el dedo, no. La celda perdió su `py` y el enlace
reserva sus 44 px, de modo que **la altura de la fila la marca ahora el objetivo táctil**.

Accesibilidad, medida sobre el panel:

- 0 controles sin nombre accesible.
- 11 secciones con `aria-labelledby`.
- 1/1 tablas con `<caption>` (en `sr-only`).
- 0 imágenes sin `alt`.

**Dos cosas que se miden acotadas al panel, y por qué.** Las comprobaciones consultan
`[data-admin-panel]`, no `document`. La cabecera global (`GameShell`) tiene dos controles por
debajo de 44 px —«Inicio» a 34 × 34 y «Tu nivel» a 136 × 42— que aparecen en **todas** las
pantallas del producto. Corregirlos es un cambio visual de todo el juego, fuera del encargo de
este bloque: se deja anotado en §13, no se cuela como aprobado.

---

## 11. Ruido de consola: qué se admite y qué no

Un error de consola no es automáticamente un defecto, y tratarlos todos igual convierte la
comprobación en ruido. La QA declara por fase qué admite:

| Fase | Admite | Por qué |
|---|---|---|
| Sin sesión / usuario normal | 401, 403 | Es el guardia rechazando. El 401 **es** la seguridad funcionando. |
| Panel de administración | `/players/*.png`, `/teams/*.png` | En este repositorio no hay ni un retrato ni un escudo: `public/players` y `public/teams` tienen un README y nada más, a la espera del Artwork Pipeline. `PlayerPhoto` está escrito contando con eso. |
| Todo lo demás | nada | — |

La excepción del arte **no se regala**: a cambio, la fase 5 comprueba que el respaldo se monta
de verdad (*«y sin retrato dibuja el sigilo, no un hueco roto»*). Y la exención es estrecha —
solo perdona avisos de recurso, y solo si **todos** los recursos caídos están en la lista; un
error de JavaScript sigue contando aunque falte el arte.

Un detalle que costó una iteración: `performance.getEntriesByType('resource')` se reinicia con
cada documento, mientras que los errores de consola se acumulan entre navegaciones. Preguntar
una vez al final del bucle de nueve páginas juzgaba los errores de las nueve con los recursos
de la última. Ahora se drena por navegación.

---

## 12. Regresión completa

| Comprobación | Resultado |
|---|---|
| `npm test` | **766 / 766** |
| `npx tsc --noEmit` | limpio |
| `npm run build` | compila; `/admin/cartas` ○, `/admin/cartas/[id]` ƒ, `/admin/cartas/nueva` ○ |
| `eslint` sobre lo tocado | limpio |
| `admin-cards:verify` | **73 / 73** |
| `admin-cards:qa` | **56 / 56** |
| `content-catalog:verify` · `:qa` | 62/62 · 33/33 |
| `content-version:verify` · `:qa` | 66/66 · 28/28 |
| `content-pools:verify` · `:qa` | 73/73 · 32/32 |
| `pack` · `economy` · `marketplace` · `collection` · `deck` · `craft` | todos pasan |
| `cards` 15/15 · `card-generator` 50/50 · `catalog-builder` 44/44 · `distribution` 30/30 | pasan |
| PvP ×8 (`pvp`, `arena`, `matchmaking`, `rating`, `settlement`, `ratelimit`, `sync`, `timeout`) | 41 · 66 · 111 · 103 · 77 · 51 · 48 · 76, cero fallos |
| `security` · `telemetry` 35 · `analytics` 48 · `operations` 33 · `navigation` · `ux` · `progression` · `collection-presentation` · `duel-gameplay` | pasan |
| `audit:stability` | 105 comprobaciones · **P0 0 · P1 0 · P2 9** |

Los 9 P2 son el 401 de las rutas `/admin/*` cuando el auditor navega **sin sesión**: el
guardia haciendo su trabajo.

> Dos verificadores no leen `BASE_URL` sino `E2E_BASE_URL`, y apuntan a 3001 por defecto
> (`audit:stability`, `ux:verify`, `progression:verify`). Se ejecutaron con
> `E2E_BASE_URL=http://127.0.0.1:3005`.

---

## 13. Integridad ANTES / DESPUÉS

`npm run content-catalog:integrity -- --compare docs/cards/integrity-83-after.json docs/cards/integrity-841-after.json`

**Lo que el encargo exige, intacto:**

```
[PASS] user_cards intacta — 53 filas, huella idéntica
[PASS] duel_decks intacta — 1 filas, huella idéntica
[PASS] market_listings intacta — 1 filas, huella idéntica
[PASS] market_offers intacta — 0 filas, huella idéntica
[PASS] NO USER CARD LOST — 53 → 53 instancias
[PASS] NO DECK BROKEN — 10 cartas en mazos, mismas uid
[PASS] NO MARKET REFERENCE BROKEN — 1 listados · 0 ofertas
[PASS] catálogo materializado — 773 definiciones persistidas
```

`v_instance_version_gaps` **0** · `v_content_card_orphans` **0** ·
`v_content_rpc_overloads` **0**.

**Y lo que sí cambió, dicho entero.** Cuatro tablas derivadas tienen otra huella:

| Tabla | Filas | Qué pasó |
|---|---|---|
| `card_mints` | 48 → 48 | Un contador de serie avanzó al abrir sobres durante las verificaciones. **No retrocede nunca** aunque el ejemplar de prueba se borre: si retrocediera, dos cartas compartirían serie. Comprobado: 0 series duplicadas, y ningún contador por debajo de la serie más alta emitida. |
| `card_reference` | 5 → 4 | Anclas de mercado que escriben las propias verificaciones al publicar versiones (D-1). Las cinco anteriores eran residuo de las verificaciones de 8.3; estas cuatro lo son de las de hoy. |
| `card_price_stats` | 1 → 1 | Estadística de precio reescrita por `economy:verify`. |
| `card_price_daily` | 5 → 5 | Igual. |

Ninguna de las cuatro guarda propiedad de nadie: son tablas de precio derivado y contadores.
La instantánea de 8.3 se tomó justo después de las verificaciones de 8.3, así que la
comparación es entre dos residuos de verificación, no entre dos estados de reposo.

`content_audit_log` pasó de 0 a 24 entradas, todas sobre cartas que existen (0 sobre cartas
borradas). **Purgar una carta no borra su diario, y es deliberado**: si lo borrara, un
administrador podría crear una carta, purgarla y no dejar rastro.

---

## 14. Deudas

1. **La cabecera global tiene dos controles por debajo de 44 px** («Inicio» 34 × 34, «Tu
   nivel» 136 × 42, en `GameShell`). Afecta a todas las pantallas del producto, no a este
   panel. No se toca desde aquí: es un cambio visual global.
2. **No hay arte.** `public/players` y `public/teams` están vacíos, así que toda carta del
   juego pide un PNG que no existe y cae al sigilo. Es el estado conocido a la espera del
   Artwork Pipeline; se admite explícitamente en la QA (§11).
3. **Tres cuentas `@example.invalid` de verificaciones antiguas** (3 y 8 de septiembre) siguen
   en la base. `economy:verify` y `pvp-rating-settlement:verify` no borran sus cuentas; es
   deuda ya declarada en bloques anteriores. Las de **esta** sesión sí se borraron: `user_cards`
   volvió de 54 a 53.
4. **Las migraciones 0037–0040 están aplicadas a mano** (`docker cp` + `psql`), siguiendo la
   convención del repositorio para 0026–0040. No hay `supabase db push`.
5. **`.env.local` (ignorado por git) tiene `NEXT_PUBLIC_ADMIN=1`.** El servidor local corre
   `next start`, es decir `NODE_ENV=production`, donde `ADMIN_ENABLED` exige esa variable.
   Sin ella no hay panel y los dos verificadores de este bloque no pueden ejecutarse. **Se
   deja encendida a propósito**, y conviene saberlo: producción sigue necesitando activarla
   deliberadamente, y aun encendida no abre la puerta —solo deja llegar hasta ella; quien
   decide es `verifyAdmin`.

---

## 15. Criterio READY

| # | Criterio | Estado |
|---|---|---|
| 1 | El panel lee del catálogo persistido, no de un array | ✅ 773 definiciones, total contrastado contra `count(*)` |
| 2 | Búsqueda y filtros contra la base, no en el cliente | ✅ filtrado, ordenado y paginado en el servidor |
| 3 | Alta real de una carta | ✅ `benjy__mythic` creada, editada, publicada, retirada y purgada en la QA |
| 4 | La previsualización usa el componente real | ✅ `CardRenderer`, con el sigilo de respaldo comprobado |
| 5 | Editar un borrador no crea versión | ✅ OVR 75 · v1 |
| 6 | Editar una carta en juego publica versión | ✅ y la ficha lo explica antes de hacerlo |
| 7 | Ninguna operación modifica un ejemplar | ✅ huella idéntica antes/después |
| 8 | Una carta publicada no se sirve desde caché antigua | ✅ aparece PUBLISHED sin reiniciar; la purga también avisa (§8) |
| 9 | Un usuario normal no puede mutar contenido | ✅ 401 en las nueve acciones y en la RPC directa |
| 10 | El actor sale del token, nunca del cuerpo | ✅ `verifyAdmin` |
| 11 | Sin PII en el diario | ✅ solo el uuid del actor |
| 12 | Sin datos falsos ni métricas inventadas | ✅ lo que no existe, la pantalla lo dice |
| 13 | Dos administradores simultáneos: gana uno | ✅ `exitos === 1`, comprobado bajo `for update` |
| 14 | 390 / 768 / 1440 sin desbordamiento ni controles pequeños | ✅ 9 páginas medidas con viewport real |
| 15 | Sin tests eliminados ni fallos silenciados | ✅ y se destapó uno que ya estaba silenciado (§9) |
| 16 | Regresión completa sin fallos | ✅ §12 |

---

## 16. Cómo reproducirlo

```bash
# 1. Supabase local y servidor
npx supabase start                    # puerto 54521
npm run build && npx next start -p 3005

# 2. Verificación del bloque (no necesita navegador)
npm run admin-cards:verify            # 73/73

# 3. QA con navegador real: sesión real, tres anchos, ciclo completo
npm run admin-cards:qa                # 56/56

# 4. Integridad
npm run content-catalog:integrity -- --capture docs/cards/integrity-841-after.json
npm run content-catalog:integrity -- --compare docs/cards/integrity-83-after.json docs/cards/integrity-841-after.json
```

Ambos scripts crean sus propias cuentas, las borran al terminar y **dicen lo que dejan**.

---

## 17. Ficheros

**Nuevos**

```
supabase/migrations/0040_admin_card_management.sql   diario, alta, edición, D-1b, concurrencia,
                                                     purga completa, centinela de firmas
src/server/services/adminCards.ts                    listCards, listFacets, cardSheet, createCard
src/app/api/admin/cards/route.ts                     9 acciones, lista blanca de campos
src/app/admin/cartas/page.tsx                        listado
src/app/admin/cartas/[id]/page.tsx                   ficha
src/app/admin/cartas/nueva/page.tsx                  alta
src/components/admin/cards/shared.tsx                insignias, diálogo de confirmación, utilidades
scripts/admin-cards-verify.ts                        73 comprobaciones
scripts/admin-cards-qa.ts                            56 comprobaciones con navegador real
```

**Modificados**

```
src/app/admin/page.tsx                enlace ▣ Cartas
scripts/content-pools-qa.ts           la limpieza ya no traga errores (§9)
package.json                          admin-cards:qa
```
