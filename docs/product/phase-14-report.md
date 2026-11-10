# FASE 14 — LIVE WORLD, META PROGRESSION & ENDGAME

> El último problema abierto desde la Fase 11, cerrado. Y cerrado con una cifra, no con una
> intuición.
>
> Estado: **entregada y verificada**. `npm test` **480/480** · typecheck ✅ · build ✅ ·
> `content:verify` ✅ · `security:verify` ✅ (**+14**) · `economy:verify` ✅ ·
> `events:verify` ✅ · `loop:verify` ✅ · `progression:verify` ✅ (**+18**) · `ux:verify` ✅ ·
> `audit:interactions` ✅ · `audit:stability` **P0 0 · P1 0** · `duel:e2e` ✅ ·
> `duel-gameplay` ✅ · `strats` ✅ · `sw:verify` ✅ · `test:integration` ✅ · `test:pickems` ✅ ·
> `test:e2e` ✅ · `economy:simulate` ✅ · `economy:model` ✅ · `content:audit` ✅.

---

## 1 · AUDITORÍA INICIAL

**A) Qué existe y funciona.** Catálogo (379 jugadores, 772 cartas, 37 variantes), packs,
colección, duelos, Combat Resolver, Pick'ems con su ciclo completo, eventos
server-authoritative con desafíos, match challenges (`match_winner` + `match_score`),
progresión, pase, rangos, cosméticos con equipado, maestría (77 conjuntos, 162 escalones),
ledger, idempotencia, marketplace portado y cerrado, pipeline VLR.

**B) Qué existe pero está desconectado.** Nada relevante. Las tres fases anteriores cerraron
los huecos (eventos, cosméticos, maestría).

**C) Qué falta de verdad.** **Un sumidero de créditos.** La auditoría lo confirmó de forma
tajante: de las 15 funciones `app_*` que existen, **solo `app_buy_pack` saca créditos de la
economía** — más la comisión del mercado, que está cerrado. No hay forma de gastar créditos
en nada que no sea un sobre.

**D) Qué se puede reutilizar.** Todo lo necesario: `user_cosmetics` (propiedad), `_ledger_apply`
(la única puerta al saldo), `economy_ops` (idempotencia), `app_equip_cosmetic` (equipar), y
las 166 insignias que la maestría ya deriva del catálogo.

**E) Qué no tocar.** Lo congelado por la regla 1. No se ha tocado nada de esa lista.

**F) Qué necesita migración.** Una función. `app_buy_cosmetic`.

**G) Qué se hace sin tablas nuevas.** Todo lo demás. **Cero tablas creadas.**

---

## 2 · PROBLEMAS ENCONTRADOS

**1 · Un solo sumidero.** Confirmado leyendo las migraciones: comprar sobres.

**2 · El endgame estaba mal dimensionado en el diagnóstico heredado.** La Fase 13 dijo
«al 91 % no hay dónde gastar», pero nadie había medido **cuánto** se acumula. Los tres
perfiles de la simulación acaban a cero *porque el modelo compra sobres mientras puede*, lo
que escondía la magnitud real.

**3 · Un fallo de presentación en los títulos de maestría.** `titulo:region:emea` se
renderizaba como «Region:emea»: el catálogo de cosméticos solo quitaba el eje a las
insignias, no a las demás familias. Corregido.

---

## 3 · DECISIONES TOMADAS

### 3.1 · Medir antes de proponer (regla 0 y 3)

Se añadió a `economy:simulate` un escenario de **saturación**: el jugador deja de comprar
sobres al pasar del 85 % de colección.

| Perfil | Colección | Acumulado en la temporada | Por día |
|---|---|---|---|
| Casual | 62 % | 274 | 3 |
| Activo | 57 % | 758 | 9 |
| **Intensivo** | **85 %** | **167.582** | **1.995** |

**Esto cambia el tamaño del problema.** El endgame afecta a **un solo perfil** —Casual y
Activo no llegan a saturarse en una temporada— y su magnitud son **unos 2.000 créditos al
día**. Cualquier sumidero se dimensiona contra esa cifra, no contra una impresión.

### 3.2 · El sumidero: prestigio de insignias

Una insignia ganada completando un conjunto se puede **mejorar**: plata, oro, élite. Cuesta
créditos y **no da absolutamente nada**: solo cambia cómo se ve.

| Escalón | Precio | Días del saturado |
|---|---|---|
| Plata | 15.000 | 7,5 |
| Oro | 40.000 | 20 |
| Élite | 100.000 | 50 |
| **Un conjunto entero** | **155.000** | **78 — casi una temporada** |

Por qué **este** y no otro:

- **Es un sumidero, no un grifo.** Saca créditos y no devuelve ninguno.
- **No hay segunda moneda** (regla 15). Se paga en DRL Credits.
- **No hay pay-to-win** (regla 6). Es el color de una insignia.
- **No hay contenido escrito a mano** (regla 5). 231 ids derivados, cero líneas.
- **Conecta colección con economía.** No se compra sin haber completado antes: **los
  créditos no sustituyen a coleccionar, lo reconocen.**

### 3.3 · Lo que NO se decidió tocar

No se ha bajado ninguna recompensa para «cerrar el grifo». La Fase 12 midió que el grifo
está calibrado; el problema no era que entrara demasiado, sino que **no salía nada**. Se
arregla el lado que estaba roto.

---

## 4 · QUÉ SE IMPLEMENTÓ

| Pieza | Qué es |
|---|---|
| `domain/collection/prestige.ts` | Dominio puro: escalones, precios justificados, ofertas derivadas |
| `supabase/migrations/0024_prestige_sink.sql` | `app_buy_cosmetic` — cobra y concede en una transacción. **Ninguna tabla** |
| `server/services/prestige.ts` | Vitrina y compra. El precio lo pone el servidor |
| `app/api/game/prestige/route.ts` | `GET` vitrina · `POST` comprar. **El cuerpo no lleva ni un número** |
| `components/collection/PrestigePanel.tsx` | Vitrina + tienda, bajo la maestría en `/coleccion` |
| Vitrina en `/cuenta` | El prestigio en la ficha del jugador |
| `economy:simulate` | Escenario de saturación + dimensionado del sumidero |
| Catálogo de cosméticos | Reconoce el escalón: color, glifo y nombre |

---

## 5 · QUÉ **NO** SE IMPLEMENTÓ, Y POR QUÉ

| Se pedía evaluar | Decisión | Motivo |
|---|---|---|
| **Capa de temporadas nueva** | **No** | Ya existe (`CURRENT_SEASON` + `user_pass.season_id` + `advanceSeason`). Construir otra sería la mega plataforma que la regla 7 prohíbe. Y lo que la regla pedía —que la temporada no borre la colección— **ya se cumple**: la maestría es permanente y el prestigio también |
| **Ampliar match challenges** | **No** | La regla 10 lo condiciona a que los datos existan. `matches` sigue sin guardar mapa ni MVP, y `player_stats` solo se llena si el importador pasó por ese partido. Sin dato no hay corrección, y sin corrección nadie cobra |
| **Nuevo pipeline de live content** | **No** | La regla 9 dice explícitamente que no se duplique. El pipeline VLR → events → matches → player_stats → generated_cards existe y funciona; lo que le falta son torneos reales que procesar, no código |
| **Segunda moneda / materiales / tienda de fichas** | **No** | Reglas 15 y 12 de la Fase 13. Nada de la auditoría lo justifica |
| **Abrir marketplace / activar pagos** | **No** | Reglas 13 y 14. Siguen en `false` y no se han tocado |
| **Bajar recompensas** | **No** | El grifo está medido y calibrado desde la Fase 12 |

---

## 6 · IMPACTO ECONÓMICO

Medido con `npm run economy:simulate`, sección «El sumidero de prestigio»:

| Perfil | Acumula/temporada | Escalones que paga | **Absorbido** |
|---|---|---|---|
| Casual | 274 | 0 | **0 %** |
| Activo | 758 | 0 | **0 %** |
| Intensivo | 167.582 | 3 | **92 %** |

**Es un sumidero de fin de juego, no un impuesto.** Al que no se satura no le afecta en
absoluto; al que se satura le absorbe el 92 % de lo que acumulaba sin destino.

**Capacidad total:** 77 conjuntos × 155.000 = **11.935.000 créditos**, **16 años** del perfil
que más acumula. Un sumidero que se agota deja de serlo.

**Inflación:** ninguna. El prestigio no crea créditos; solo los destruye. El resto de la
economía está sin tocar y `economy:verify` y `economy:model` lo confirman (ratios de sobre,
ancla y bucle de desguace idénticos).

---

## 7 · IMPACTO EN PROGRESIÓN

Ninguno en la progresión de juego: el prestigio no da XP, ni puntos, ni rango, ni cartas, ni
sobres. Hay una prueba que comprueba que un escalón **solo** tiene id, nombre, precio, color
y orden, y otra en `security:verify` que falla si aparece un campo que suene a ventaja.

Lo que sí cambia es la progresión **de identidad**: el perfil pasa de decir *cuánto tienes* a
decir *a qué le has dedicado créditos*, que es una elección y no un número.

---

## 8 · IMPACTO EN RETENCIÓN / ENDGAME

El bucle que faltaba, cerrado:

```
COLECCIONAR → COMPLETAR CONJUNTO → INSIGNIA (gratis)
                                        │
                                        ▼
                       JUGAR → CREDITOS → PRESTIGIO → PERFIL
```

Antes, un jugador saturado no tenía motivo para volver: sus créditos no compraban nada que
quisiera. Ahora, **jugar sigue teniendo destino** aunque la colección esté hecha, y el
destino es una decisión (qué equipo merece la élite), no una compra automática.

---

## 9 · CAMBIOS DE BASE DE DATOS

**Una migración. Cero tablas.**

`0024_prestige_sink.sql` → `app_buy_cosmetic(p_user, p_cosmetic_id, p_price, p_requires, p_ref)`.

Cuatro puertas, en este orden: idempotencia (`economy_ops`) → no duplicar → requisito
(insignia de pleno y escalón anterior) → saldo (`_ledger_apply`, que corta y deshace).
**Se comprueba todo antes de tocar el saldo**, para que un rechazo no deje ni un asiento a
medias. Revocada a `anon`/`authenticated`, concedida solo a `service_role`.

---

## 10 · ENDPOINTS

| Ruta | Métodos | Nota |
|---|---|---|
| **`/api/game/prestige`** (nuevo) | `GET` vitrina · `POST {action:"buy", setId, tierId}` | El cuerpo **no lleva ni un número** |

Ninguna ruta existente modificada.

---

## 11 · SEGURIDAD

**+14 comprobaciones** en `security:verify`: exige sesión, solo admite `buy`, **el cuerpo no
acepta precio, saldo ni cantidad**, el precio sale de `PRESTIGE_TIERS`, el requisito se
comprueba antes de cobrar, cobra por `_ledger_apply` (no escribe `profiles.credits`), el
cargo es negativo, es idempotente, rechaza la doble compra, la RPC está revocada, y un
escalón no puede llevar ningún campo que dé ventaja.

**+18 ataques** en `progression:verify` contra la base de datos real: 401 sin token, conjunto
inventado (404), escalón inventado (404), acción desconocida (400), **saltarse escalones**
(409), **conjunto sin completar** (409), **sin saldo** (409 y el saldo intacto), compra
correcta con **el saldo bajando exactamente el precio**, **un asiento NEGATIVO en el libro
mayor**, el cosmético concedido, **doble compra rechazada sin cobrar**, y la oferta avanzando
al escalón siguiente.

---

## 12 · TESTS

**480 / 480** (+15, todos de prestigio). Los que importan:

- **«EL PRESTIGIO ES UN SUMIDERO: cuesta créditos y no devuelve NADA»** — comprueba los
  campos exactos de un escalón.
- **«los precios están calibrados contra el jugador que SE SATURA»** — si alguien los toca
  sin volver a medir, dice cuánto se ha desviado de los 1.995 cr/día.
- **«el sumidero tiene más capacidad que el grifo, y por mucho»**.
- **«no se puede saltar un escalón»** — saltar a élite costaría 100.000 en vez de 155.000.
- **«solo se prestigia la insignia de PLENO»**.
- **«la maestría SIGUE sin repartir créditos después de añadir el prestigio»**.

---

## 13 · VERIFICACIONES

Todas verdes. La lista completa está en la cabecera.

Una nota honesta: durante la fase introduje un **fallo real** —los hooks del prestigio
quedaron después del `return` temprano de `/cuenta`, rompiendo el orden de hooks de React—.
Lo detectó `ux:verify` con 13 fallos. Corregido moviéndolos arriba; `ux:verify` vuelve a
pasar. Es exactamente para lo que sirve tener la verificación.

---

## 14 · CAPTURAS

`fase14-despues/`, cuatro ficheros, dos pantallas: la colección con maestría (que no cambia
de diseño pero es de donde cuelga el prestigio), **el panel de prestigio** y **la vitrina en
el perfil**.

La siembra completa dos conjuntos con `app_grant_cards`, cobra sus insignias con
`claimMasteryTier` y compra un escalón con `buyPrestige` — las RPC y los servicios reales,
que cobran de verdad. El «🪙 15.000 invertido» de la captura salió del saldo de la cuenta.

---

## 15–17 · ESTADO DE LO CONGELADO

| | |
|---|---|
| **Marketplace** | `GLOBAL_MARKET_ENABLED = false`. **No tocado.** Los criterios de apertura y las nueve cifras a medir siguen en `marketplace.md` |
| **Payments** | `PAYMENTS_ENABLED = false`. **No tocado.** `CREDIT_PACKAGES` sigue vacío |
| **Live content pipeline** | VLR → events → matches → player_stats → generated_cards. **Intacto y no duplicado.** Las 9 variantes de galardón de torneo siguen vacías esperando un torneo real, y `content:verify` las distingue de las que están vacías por otro motivo |

---

## 18 · DEUDA RESTANTE

| Pendiente | Naturaleza |
|---|---|
| Los ocho jugadores con galardón y sin carta | **Decisión editorial**, no de código. En trinquete en `content:verify` |
| `americas-mvp` sin ningún portador | Hueco de palmarés real |
| Cartas de rareza alta de China | Depende del palmarés real |
| Devolver Prime al escaparate | Que el catálogo sostenga un cuarto sobre de rareza alta |
| Mapa y MVP en match challenges | Falta el dato en `matches` |
| Abrir el marketplace | Masa de jugadores |
| Conjuntos de maestría por temporada | El catálogo no marca las cartas por temporada |

---

## 19 · CRITERIOS OBJETIVOS PARA LA FASE 15

1. **¿El sumidero funciona con gente real?** Medir `sum(delta) where reason like 'prestige:%'`
   contra los créditos creados en el mismo periodo. Si absorbe menos del 20 % de lo que
   acumulan los saturados, los precios están altos; si absorbe más del 90 % de **todos** los
   jugadores, están bajos y se ha convertido en impuesto.
2. **¿Cuánta gente llega a saturarse?** Hoy es una hipótesis de un perfil modelado. Con
   datos: `% de jugadores con distinct_cards / 772 > 0,85`.
3. **¿Se elige, o se compra todo?** Si la distribución de escalones comprados es plana entre
   conjuntos, el prestigio no está sirviendo de identidad y hay que revisar el diseño.
4. **Marketplace:** los umbrales ya escritos (≥200 jugadores, liquidez ≥0,2, ≥1.000 ventas).
5. **Contenido:** que un torneo real recorra el pipeline entero y genere sus galardones.
