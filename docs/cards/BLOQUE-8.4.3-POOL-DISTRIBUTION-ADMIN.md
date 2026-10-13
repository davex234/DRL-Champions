# BLOQUE 8.4.3 — NEXUS Pool & Drop Distribution Manager

> **Estado: READY.** Un administrador controla qué cartas salen en qué sobres y con qué peso,
> desde una pantalla, sin tocar una sola regla del motor.
> `pools-admin:verify` **60/60** · `pools-admin:qa` **58/58** · `npm test` **773/773** ·
> `content-pools:verify` **73/73 con 0 divergencias** · `audit:stability` **P0 0 · P1 0**.
> **Sin commit, sin push, sin deploy.**

---

## 0. Resumen ejecutivo

La prueba que decide este bloque no está en una pantalla: está en 40 sobres abiertos de verdad.

```
Admin configura:  benjy__silver=10   derke__silver=20   boaster__bronze=5
40 sobres reales → 200 cartas:  28,0 %   59,5 %   12,5 %
Esperado:                       28,571 % 57,143 % 14,286 %

Admin sube boaster a 500  →  otros 40 sobres  →  4,0 %   4,0 %   92,0 %
                             sin reiniciar el servidor

Admin quita boaster del pool  →  30 sobres más  →  no aparece ni una vez
                                 y los 209 ejemplares que ya tenía un jugador,
                                 intactos: mismos uid, misma serie, misma versión
```

**Y un fallo grave encontrado en la auditoría, antes de escribir una línea de panel.**

`buildPool` cachea la PERTENENCIA de un sobre por `${pack.id}@${dist.key}`, y esa clave era
`${pool.id}#${entries.length}`: el identificador del pool y **cuántas** entradas tenía. Medido:

```
pool A = [derke__prime, benjy__silver, aaaay__silver]  → clave  sonda#3
pool B = [derke__prime, benjy__silver, vora__silver]   → clave  sonda#3
buildPool(registro, sobre, B)  devuelve el pool de A.
```

Es decir: **un administrador que sustituyera una carta por otra dejaba la base de datos
correcta y el proceso servidor repartiendo la configuración anterior indefinidamente**, hasta
que cambiara el catálogo o alguien reiniciara. Es exactamente el escenario que la Fase 12 de
8.3 declaraba cerrado, y el que la Fase 15 de este encargo manda comprobar.

No se vio en 8.3 porque sus pruebas cambiaban de pool desvinculando uno y vinculando otro con
distinto id: la clave cambiaba por el identificador, nunca por el contenido. **Un cambio
dentro del mismo pool nunca se ejercitó** — y es justo lo que hace un panel.

Además, la auditoría encontró otras dos ausencias que el panel necesitaba y no existían:
**nadie vigilaba quién llegó antes** al editar un pool, y **cambiar la distribución no dejaba
ni una línea en el diario**.

---

## 1. Auditoría (Fase 1) — las diez preguntas, contestadas

| # | Pregunta | Respuesta medida |
|---|---|---|
| 1 | ¿Qué pools existen? | **12**, uno por sobre (`pack-<packId>`), todos `ACTIVE`, modo `EXPLICIT`, revisión 4. Migrados de `PackDef` en 8.3. |
| 2 | ¿Qué packs usan cada pool? | Uno cada uno, `priority` 100, `enabled`. 12 vínculos, relación 1:1 hoy. |
| 3 | ¿Qué cartas contiene cada pool? | **6.864 entradas**, todas `INCLUDE`: de 182 (americas) a 772 (inicial, estándar, premium, prime, icon). |
| 4 | ¿Qué weights? | **Todos 1.0000**, sin excepción. Por eso el sorteo de hoy es, bit a bit, `rng.pick`. |
| 5 | ¿Cómo se calcula la probabilidad? | `P(carta) = P(bucket) × P(carta\|bucket)`; `P(bucket)` renormalizado **sobre los buckets con stock** (lo que hace `rollBucket`); `P(carta\|bucket) = w / Σw` (`effectiveProbabilities`). |
| 6 | ¿Cómo se unen varios pools? | `composeDistribution` los **UNE**. `EXCLUDE` gana siempre. La pertenencia solo se restringe si algún pool es `EXPLICIT`/`MIXED`. |
| 7 | ¿Cómo funciona `priority`? | Decide **qué peso manda** cuando una carta está en dos pools del mismo sobre (gana el de prioridad más baja). **No da exclusividad.** |
| 8 | ¿Cómo se invalida la caché? | `content_distribution_version.version` sube en la MISMA transacción (`_bump_distribution`); el servidor la comprueba cada ≤5 s; y `buildPool` la lleva en su clave — **que era donde estaba el fallo**. |
| 9 | ¿Qué es transaccional? | Las cuatro RPC de 8.3, todas `security definer` plpgsql. `set_entries` reemplaza el conjunto entero; `publish` valida antes de escribir. |
| 10 | ¿Qué sigue siendo solo código? | `PackDef` entero: huecos, pesos por rareza, pity, garantías, anti-duplicado, `repeatable`, precio. Un pool **estrecha y repondera**, nunca ensancha. |

---

## 2. El fallo de la clave de caché, y su cierre

La clave pasa a identificar el **contenido**, no a contarlo:

```ts
function poolFingerprint(pool: PoolDef): string {
  // FNV-1a sobre modo + reglas + (cardId, mode, weight) ORDENADOS
  return `${pool.entries.length}.${h.toString(36)}`;
}
key: activos.map(({ pool }) => `${pool.id}#${poolFingerprint(pool)}`).join("|")
```

Se ordenan las entradas porque reordenar una lista **no** es un cambio de distribución, y se
incluye el peso aunque `buildPool` no lo cachee: una clave que identifica «el trozo que hoy
resulta que se cachea» obliga a razonar cada vez sobre qué entra y qué no. Identificar la
configuración entera cuesta nada y no hay que volver a pensarlo.

**No es criptográfica y no pretende serlo.** La huella auditable del pool vive en SQL
(`_pool_checksum`, sha256); esta solo tiene que separar claves de caché.

Queda cubierto por **7 tests de dominio** nuevos (`src/domain/packs/distribution.test.ts`),
incluido el que mira la consecuencia y no la causa: *«buildPool NO devuelve la pertenencia
anterior tras sustituir una carta»*.

---

## 3. Arquitectura

```
/admin/pools            listado · 1 consulta a v_pool_admin
/admin/pools/nueva      alta (nace DRAFT, vacío, sin sobre)
/admin/pools/[id]       ficha + edición + probabilidad + simulación + diario
        │
        ▼
POST /api/admin/pools   list · sheet · cardOdds · simulate · inspect
                        upsert · entryUpsert · entryRemove · setEntries
                        publish · bind · unbind
        │
        ▼
src/server/services/adminPools.ts   listPools · poolSheet · cardOdds · simulate
        │
        ▼
app_content_pool_*  (RPC transaccionales, security definer)
```

**Tres rutas, no cuatro.** No hay `/admin/pools/[id]/editar` porque editar un pool *es*
mirarlo: se cambia un peso y hay que ver enseguida la cuota que queda. Separar las dos cosas
obligaría a ir y volver en el gesto más repetido del panel. (En 8.4.2 la decisión fue la
contraria y por el motivo contrario: editar una carta necesita la carta al lado y el recuento
de ejemplares, y eso no cabe en una ficha que se lee.)

---

## 4. El peso es relativo; la cuota se calcula sola

El administrador escribe **pesos**, nunca porcentajes:

```
A = 10        →  28,571 %
B = 20        →  57,143 %
C =  5        →  14,286 %
total = 35
```

Pedir porcentajes que sumen 100 obligaría a recalcular todos los demás cada vez que se toca
uno — el trabajo que la máquina debe hacer. Y las cuotas no se calculan en la interfaz: salen
de `effectiveProbabilities()`, la misma función que consume el sorteo. La verificación no
compara contra un porcentaje escrito a mano, compara contra lo que devuelve esa función: si
el motor cambiara, la comprobación fallaría en vez de dar por buena una cifra copiada.

---

## 5. Dos números distintos, que no se mezclan

| | Qué es | De qué depende |
|---|---|---|
| **Cuota en el pool** | `weight ÷ peso total del pool` | Solo del pool. Es lo que se controla en la ficha. |
| **P en el sobre** | `P(bucket) × P(carta\|bucket)` | Del sobre, de qué buckets tienen stock y de los pesos por rareza del `PackDef`. |

Enseñar la primera como si fuera la segunda sería el error más fácil de cometer aquí: una
carta con el 50 % del peso de un pool de legendarias sale en menos de una de cada mil
aperturas. Por eso la probabilidad real se pregunta carta a carta, contra un sobre concreto, y
se enseña **descompuesta**:

```
P(bucket)              ×   P(carta | bucket)      =   P en un hueco
0,500 %                    11,111 %                   0,0556 %
epic · renormalizado       peso 1 de 9 · 9 cartas
sobre buckets con stock
```

Con las tres advertencias sin las que el número mentiría, **en la pantalla y no en una nota al
pie**:

- «P en un hueco» vale para un hueco **sin garantía ni pity en juego**: los huecos garantizados
  sortean con otro mínimo de rareza y el pity fuerza el bucket.
- «Al menos una» (`1 − (1−p)^huecos`) supone huecos independientes; el anti-duplicado y las
  garantías los correlacionan, así que es una aproximación y va con nombre propio.
- Si la carta no está en el pool, la probabilidad es **0** y se dice **por qué**.

Un bucket sin stock reparte 0 % aunque el sobre declare peso para él — el caso real del sobre
inicial con las legendarias. El panel dice 0 %, no el peso declarado.

---

## 6. Concurrencia (Fase 20)

**El problema.** `set_entries` reemplaza el conjunto entero de entradas, y eso es correcto: una
secuencia de altas y bajas sueltas tendría estados intermedios observables, y el estado
intermedio de un pool es una distribución que nadie quiso publicar. Pero al reemplazarlo todo,
dos administradores a la vez se pisan **en silencio**: A añade una carta, B guarda la lista que
leyó antes, y la carta de A desaparece sin que nada lo diga.

**La solución.** `content_pools.revision` ya existía y `_bump_distribution` ya la subía en la
misma transacción: había testigo, solo faltaba comprobarlo. `p_expected_revision` se comprueba
**dentro** de la función, después del `for update` — la misma lección que 8.4.1 §7, y por el
mismo motivo: comprobarlo en la ruta protege del caso lento pero no del simultáneo.

Verificado:

```
[PASS] el primero en guardar gana — r14 → r15
[PASS] el segundo NO sobrescribe en silencio — esperabas r14, hay r15
[PASS] y el rechazo dice cuál es la revisión vigente
[PASS] el cambio de A sigue en pie: el de B no lo pisó — peso 11
[PASS] de dos publicaciones simultáneas, solo UNA sale adelante
[PASS] sin `expectedRevision` la operación sigue siendo posible
```

La pantalla, ante un conflicto: **no borra lo tecleado**, dice cuál es la revisión vigente y
ofrece recargar.

---

## 7. Una entrada, atómicamente

8.3 fijaba las entradas **todas de golpe**. Ese razonamiento sigue en pie para una *secuencia*;
no para una operación suelta dentro de una única transacción que además sube la revisión y la
versión de la distribución.

Y hacía falta, porque **el panel pagina**. Un pool real tiene 772 entradas; la ficha enseña 25.
Si cambiar un peso obligara a reenviar «todas», el navegador enviaría las 25 cargadas y
`set_entries` **borraría las otras 747**. La puerta se cierra dando la operación correcta
(`entryUpsert` / `entryRemove`) en vez de confiar en que nadie la pise. `set_entries` se
conserva intacta: sigue siendo como sustituye una configuración entera el migrador.

`entryRemove` además impide vaciar el último `INCLUDE` de un pool `EXPLICIT` `ACTIVE` — la
misma configuración prohibida que `publish` ya rechazaba al activar, cerrada también por el
otro lado.

---

## 8. Ciclo de vida (Fase 9)

| Estado del pool | Reparte | Se edita |
|---|---|---|
| `DRAFT` | no | sí |
| `ACTIVE` | sí, si está en ventana y algún sobre lo usa | sí |
| `RETIRED` | no | **no** — hay que reactivarlo, y eso deja rastro |

**«Activo» son tres cosas a la vez**: `ACTIVE`, dentro de su ventana, y con al menos un sobre
vinculado. Un pool `ACTIVE` que ningún sobre usa no reparte nada; enseñarlo como activo sería
mentir por omisión. La columna «reparte» dice la verdad de las tres juntas.

**Histórico frente a elegible**, que el encargo pide distinguir explícitamente: una carta
`RETIRED` **se queda en el pool**. La entrada es el histórico; la elegibilidad la decide el
ciclo de vida de la carta en tiempo de sorteo (`DROPPABLE_LIFECYCLES`). La ficha lo dice con
todas las letras: *«se conservan a propósito: retirar una carta la saca de los sobres nuevos,
no la borra del histórico del pool ni de las manos de quien la tenga»*.

Y una carta en `DRAFT` **no puede entrar** en un pool `ACTIVE`: sería repartir contenido que
nadie ha aprobado.

---

## 9. Publicación y caché (Fases 12 y 15)

No hay un paso en el que el pool esté «medio activo». `app_content_pool_publish` valida
—ninguna entrada apunta a carta no publicada, un `EXPLICIT` no está vacío— y **solo entonces**
escribe, en la misma transacción que sube la revisión y la versión global.

La lectura del servidor es coherente por construcción:
`app_content_distribution_snapshot()` devuelve pools, entradas, vínculos y versión **en una
sola función `stable`**. Con tres consultas por PostgREST se podría atravesar una publicación y
componer una configuración que nunca existió.

Verificado de punta a punta:

```
[PASS] cambiar un peso sube la versión de la distribución
[PASS] la versión global sube en la MISMA transacción — v167 → v168
[PASS] y el servidor lee el peso NUEVO, no el anterior — peso servido 77
[PASS] dos configuraciones distintas NO comparten clave de caché
[PASS] y buildPool no sirve la pertenencia anterior
```

---

## 10. Simulación (Fase 17)

Simular no es abrir sobres: es **preguntarle al motor qué decidiría**. `openPack()` decide y no
acuña — no toca `user_cards`, `card_mints`, mercado, libro mayor ni economía. Acuñar es
`app_apply_pack_open`, que la simulación no llama.

```
[PASS] la simulación responde — 20.000 cartas · 289 ms
[PASS] NADA ha cambiado: ni ejemplares, ni acuñaciones, ni mercado, ni catálogo
[PASS] lo observado converge a lo esperado — 4 sigmas de margen sobre la binomial
[PASS] una simulación desmesurada se rechaza — tope de 20.000 declarado
```

El pity arranca limpio en cada apertura **a propósito**: se está midiendo la distribución, no
una racha concreta de un jugador. Y lo «esperado» se calcula con `buildPool` +
`effectiveProbabilities`, no con una regla de tres.

---

## 11. Seguridad (Fase 19)

- **26 intentos** (13 acciones × anónimo y usuario normal): todos **401**.
- Suplantar `userId` / `role` / `is_admin` / `owner` en el cuerpo: **401**. No se leen.
- Las **6 RPC** de pools, invocadas directamente contra PostgREST como `anon` y como
  `authenticated`: **42501** en las doce combinaciones.
- Las tablas `content_pools`, `content_pool_entries`, `content_pack_pools` y la vista
  `v_pool_admin`: RLS activo, cero políticas, un usuario normal no lee ni una fila.

---

## 12. Auditoría (Fase 21)

`content_audit_log` nació en 0040, **después** de los pools, así que cambiar la distribución
—de lo más sensible que se puede tocar en este juego— no escribía ni una línea. Las cuatro RPC
de 8.3 y las dos nuevas pasan a auditar; el diario ya tenía la columna `pool_id` esperando.

Acciones registradas: `pool_create`, `pool_update`, `pool_entry_add`, `pool_entry_update`,
`pool_entry_remove`, `pool_set_entries`, `pool_active`, `pool_retired`, `pool_draft`,
`pool_bind`, `pool_unbind`.

El detalle guarda **el cambio**, no la configuración entera: qué entra, qué sale, qué pesos se
mueven (`weight: [10, 11]`) y entre qué revisiones. Guardar 772 entradas por línea lo haría
ilegible justo cuando hace falta leerlo. Cada entrada lleva actor y motivo; **sin PII**.

---

## 13. QA real (Fase 24)

`pools-admin:qa` — **58/58**, con navegador, sesión y **sobres reales**:

1-2. Sin sesión y como jugador: «Acceso restringido», cero pools filtrados.
3-4. Pool creado en `DRAFT`; tres cartas comunes con pesos 10/20/5.
5. La ficha enseña **28,571 % / 57,143 % / 14,286 %** y un peso total de 35 — no porcentajes
   que haya que cuadrar a 100. Y explica que varios pools se **UNEN** y que `priority` no da
   exclusividad.
6. Publicado y vinculado al sobre `inicial` (desvinculando antes el pool migrado: si no, los
   dos se unirían y el sobre seguiría repartiendo las 772 de siempre).
7. **40 sobres abiertos por `/api/game/packs`**: 200 cartas, **todas** del pool configurado,
   repartidas 28,0 / 59,5 / 12,5.
8. Peso de la tercera a 500 → otros 40 sobres → **92,0 %**, sin reiniciar.
9. Quitada del pool → 30 sobres más → **no aparece ni una vez**; y sus **209 ejemplares**
   siguen con el mismo uid, la misma serie y la misma versión, y en la colección del jugador.
10. Probabilidad descompuesta y simulación que no acuña.
11-12. Responsive y accesibilidad (§14).
13. Mazos, listados y definiciones intactos; el sobre devuelto a su configuración original.

---

## 14. Responsive (Fase 22) y accesibilidad (Fase 23)

Con `Emulation.setDeviceMetricsOverride` vía CDP, **9 páginas medidas una a una**:

| | 390 × 844 | 768 × 1024 | 1440 × 900 |
|---|---|---|---|
| Desbordamiento horizontal | ninguno | ninguno | ninguno |
| Controles bajo 44 px | **0** | **0** | **0** |
| Forma del listado | fichas apiladas | tabla | tabla |

**Un hallazgo:** el filtro «solo los que reparten hoy» era una `<input type="checkbox">`. Su
etiqueta medía 44 px, pero **el objetivo táctil es la casilla, no el texto**: 20 px. Se
sustituye por un `<button aria-pressed>` del tamaño que se le diga, que se anuncia igual a un
lector de pantalla y se pulsa entero.

Accesibilidad, acotada a `[data-admin-panel]`: 0 controles sin nombre accesible, 0 campos sin
etiqueta, secciones con `aria-labelledby`, tablas con `<caption>`, **0 `div` haciendo de
botón**, y los 12 primeros controles reciben foco por teclado.

---

## 15. Rendimiento

| Operación | Coste |
|---|---|
| Listado de 12 pools con salud y sobres | **1 consulta** (`v_pool_admin`) — serían 48 pool a pool |
| Ficha de un pool de 772 entradas | 4 consultas fijas + 1 por página, no una por fila |
| Simulación de 5.000 aperturas (25.000 cartas) | **286 ms** de servidor |
| `buildPool` por apertura | O(1) — cacheado por configuración |

---

## 16. Determinismo (Fase 25)

`content-pools:verify` sigue midiendo lo que midió 8.3, con la clave de caché nueva:

```
[PASS] MISMA semilla ⇒ MISMAS cartas, con y sin pools persistidos
       378 aperturas (27 sobres × 7 semillas × 2 estados), 0 divergencias
73 correctas · 0 fallidas
```

Con todos los pesos a 1 —que es como está el catálogo hoy— el sorteo es bit a bit el anterior.
La clave de caché no participa en la decisión: solo decide si un pool se reconstruye o se
reutiliza.

---

## 17. Regresión (Fase 26)

| Comprobación | Resultado |
|---|---|
| `npm test` | **773 / 773** (766 + 7 nuevos de distribución) |
| `npx tsc --noEmit` | limpio |
| `npm run build` | compila · `/admin/pools`, `/admin/pools/[id]`, `/admin/pools/nueva` |
| `eslint` sobre lo tocado | 0 errores nuevos |
| `pools-admin:verify` · `:qa` | **60/60** · **58/58** |
| `content-pools:verify` · `:qa` | 73/73 · 33/33 |
| `content-catalog:verify` · `:qa` | 62/62 · 33/33 |
| `content-version:verify` · `:qa` | 66/66 · 28/28 |
| `admin-cards:verify` · `:qa` | 102/102 · 84/84 |
| `pack` · `economy` · `marketplace` · `collection` · `deck` · `craft` | pasan |
| `cards` 15/15 · `card-generator` 50/50 · `catalog-builder` 44/44 · `distribution` 30/30 | pasan |
| PvP ×8 | 41 · 66 · 111 · 103 · 77 · 51 · 48 · 76 — cero fallos |
| `security` · `telemetry` · `analytics` · `operations` · `navigation` · `ux` · `progression` · `duel-gameplay` · `collection-presentation` | pasan |
| `audit:stability` | 105 comprobaciones · **P0 0 · P1 0 · P2 9** |

Los 9 P2 son el 401 de `/admin/*` sin sesión: el guardia trabajando.

### Integridad

```
[PASS] user_cards intacta — 53 filas, huella idéntica
[PASS] user_packs · duel_decks · market_listings · market_offers · duel_matches intactas
[PASS] NO CARD ID LOST · NO USER CARD LOST 53 → 53 · NO DECK BROKEN · NO MARKET REFERENCE BROKEN
[PASS] catálogo materializado — 773 definiciones
```

`v_instance_version_gaps` **0** · `v_content_card_orphans` **0** ·
`v_content_rpc_overloads` **0** · `v_content_cards_editadas` **0** · contadores de serie por
debajo de la serie emitida **0** · series duplicadas **0** · pools **12** · entradas **6.864** ·
vínculos **12** · cuentas de prueba **0**.

Cambian las cuatro tablas derivadas de siempre (`card_mints`, `card_reference`,
`card_price_stats`, `card_price_daily`): contadores de serie que no retroceden y precios que
las propias verificaciones reescriben. Desglose en el informe de 8.4.1 §13.

---

## 18. Consecuencias en otros bloques

**1. `content-pools:qa` dejaba los contadores de distribución descuadrados.** Su limpieza borra
el pool de prueba con un `DELETE` directo —atajo de fixture, no camino de producto— así que
`_bump_distribution` no corría y `content_distribution_version` se quedaba diciendo que había
13 pools activos y 6.865 entradas cuando quedaban 12 y 6.864. El juego no se rompe (`version`
sigue subiendo por otros caminos); lo que se estropea es la **auditabilidad**, que es para lo
que esas tablas existen. Corregido, y ahora la QA lo comprueba en cada ejecución.

**2. `economy:verify` dejaba cuentas de prueba vivas** — la deuda que llevaba tres bloques
apareciendo en la comprobación de integridad como «un ejemplar de más». La causa estaba
escondida por un `.catch(() => {})`: al hacerlo visible, GoTrue devolvía un error con el cuerpo
vacío al borrar una cuenta **con inventario vivo**. Por SQL el borrado en cascada funciona, así
que el problema no era el modelo: era pedirle a la API que borrara una cuenta con cartas y
sobres encima. Ahora se sueltan las filas antes —como ya hacía el bloque externo con
`market_listings`— y el verificador **falla** si sobrevive alguna.

**3. `Select` estaba duplicado** en dos pantallas y el panel de pools habría sido la tercera.
Sube a `components/admin/cards/shared.tsx` junto a `TextField`, `PoolBadge` y `fmtCuota`.

---

## 19. Deudas

1. **La cabecera global tiene dos controles bajo 44 px** («Inicio» 34×34, «Tu nivel» 136×42, en
   `GameShell`). Sale en todas las pantallas del producto; corregirlo es un cambio visual
   global. Las medidas se acotan a `[data-admin-panel]` y esto queda anotado, no colado.
2. **Un pool no puede ENSANCHAR lo que un sobre reparte.** Es deliberado desde 8.3: mientras
   `PackDef` viva en código, sus restricciones son la única barrera que impide que una
   configuración administrativa contradiga lo que el sobre dice ser. Poder ensanchar exige que
   el sobre entero sea administrable, y eso es un bloque propio.
3. **Las reglas de pool (`content_pools.rules`) no se editan desde el panel.** La columna
   existe y el dominio la consume (`PoolRules`), pero los 12 pools reales son `EXPLICIT` y no
   la usan. Exponerla sin un caso de uso sería un formulario que nadie sabe rellenar.
4. **`/admin/torneos/page.tsx` llama a `useMemo` condicionalmente** (error de lint
   `rules-of-hooks`). Preexistente, fuera de este bloque.
5. **Cuatro enlaces `<a href>` a páginas de Next** en `/admin`. Preexistentes.
6. **No hay arte.** `public/players` y `public/teams` están vacíos; `PlayerPhoto` cae al sigilo.
   La QA lo admite explícitamente y comprueba que el respaldo se monta.
7. **Las migraciones 0037–0042 están aplicadas a mano** (`docker cp` + `psql`), siguiendo la
   convención del repositorio para 0026–0042.
8. **`.env.local` (ignorado por git) tiene `NEXT_PUBLIC_ADMIN=1`.** Sin ella no hay panel en un
   servidor `next start` y los verificadores del bloque no pueden ejecutarse. Producción sigue
   necesitando activarla a propósito, y aun activada quien decide es `verifyAdmin`.

---

## 20. Criterio READY

| # | Criterio | Estado |
|---|---|---|
| 1-3 | `/admin/pools`, listado y ficha funcionan | ✅ |
| 4-5 | Crear y editar pool | ✅ DRAFT vacío · edición con testigo de revisión |
| 6-8 | Añadir carta, eliminar carta, weight | ✅ operaciones atómicas, no reenvío de la página |
| 9 | Probabilidad efectiva correcta | ✅ comparada contra `effectiveProbabilities` |
| 10 | Varios pools respetan la semántica de 8.3 | ✅ unión, `EXCLUDE` gana, `priority` decide peso |
| 11 | Lifecycle respetado | ✅ y el histórico se distingue de lo elegible |
| 12-13 | Publicación consistente · caché invalidada | ✅ y se cerró la colisión de clave |
| 14 | El pack usa la configuración persistida | ✅ 40 sobres reales, 200 cartas, todas del pool |
| 15 | La simulación no muta datos | ✅ huella idéntica tras 20.000 aperturas |
| 16-17 | Seguridad · concurrencia | ✅ 26 intentos 401 · `exitos === 1` |
| 18 | Card3D real | ✅ `CardPreview` = `Card3D` + `CardRenderer` |
| 19-20 | Responsive 390/768/1440 · accesibilidad | ✅ 9 páginas medidas |
| 21 | Determinismo preservado | ✅ 378 aperturas, **0 divergencias** |
| 22-26 | Mercado, instancias, mazos, duelos y PvP intactos | ✅ huella + PvP ×8 |
| 27-32 | tests · typecheck · build · stability · sin P0 · sin P1 nuevo | ✅ |
| 33-35 | sin commit · sin push · sin deploy | ✅ |

---

## 21. Cómo reproducirlo

```bash
npx supabase start                       # 54521
npm run build && npx next start -p 3005

npm run pools-admin:verify               # 60/60
npm run pools-admin:qa                   # 58/58 — sobres reales, 3 anchos
npm run content-pools:verify             # 73/73 · 0 divergencias

npm run content-catalog:integrity -- --capture docs/cards/integrity-843-after.json
npm run content-catalog:integrity -- --compare docs/cards/integrity-842-after.json \
                                                docs/cards/integrity-843-after.json
```

---

## 22. Ficheros

**Nuevos**

```
supabase/migrations/0042_pool_admin.sql      concurrencia · diario · v_pool_admin ·
                                             entryUpsert / entryRemove
src/server/services/adminPools.ts            listPools · poolSheet · cardOdds · simulate
src/app/admin/pools/page.tsx                 listado
src/app/admin/pools/nueva/page.tsx           alta
src/app/admin/pools/[id]/page.tsx            ficha, edición, probabilidad, simulación, diario
src/domain/packs/distribution.test.ts        7 tests de la clave de caché
scripts/pools-admin-verify.ts                60 comprobaciones
scripts/pools-admin-qa.ts                    58 comprobaciones con navegador y sobres reales
docs/cards/integrity-843-after.json
```

**Modificados**

```
src/domain/packs/distribution.ts          la clave identifica el contenido, no lo cuenta
src/app/api/admin/pools/route.ts          list · sheet · cardOdds · simulate · entry* ·
                                          expectedRevision · conflicto marcado
src/components/admin/cards/shared.tsx     adminPoolApi · Select · TextField · PoolBadge · fmtCuota
src/app/admin/cartas/page.tsx             usa el `Select` compartido
src/app/admin/page.tsx                    enlace ◈ Pools
scripts/content-pools-qa.ts               latido de distribución en la limpieza
scripts/economy-verify.ts                 la limpieza deja de fallar en silencio
```
