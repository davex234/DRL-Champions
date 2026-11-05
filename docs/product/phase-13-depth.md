# FASE 13 — CONTENIDO VIVO, PROFUNDIDAD DE COLECCIÓN Y ENDGAME

> Más motivos para volver, sin un crédito más en circulación.
>
> Estado: **entregada y verificada**. `npm test` **465/465** · typecheck ✅ · build ✅ ·
> **`content:verify` ✅ (nuevo, 20 comprobaciones)** · `security:verify` ✅ (**+14**) ·
> `economy:verify` ✅ · `events:verify` ✅ · `loop:verify` ✅ · `progression:verify` ✅
> (**+14**) · `ux:verify` ✅ · `audit:stability` **P0 0 · P1 0** · `audit:interactions` ✅ ·
> `duel:e2e` ✅ · `duel-gameplay` ✅ · `strats` ✅ · `sw:verify` ✅ · `test:integration` ✅ ·
> `test:pickems` ✅ · `test:e2e` ✅.

---

## 1 · LA REGLA DE LA FASE

**Todo lo que se ha añadido reparte cero créditos.**

77 objetivos nuevos, 162 escalones, 166 insignias, 4 títulos, cuatro preguntas nuevas por
partido. Créditos añadidos a la circulación: **0**.

No es una casualidad: es la condición que permitía añadir profundidad después de que la
Fase 12 calibrara la economía. El grifo de temporada son 124.900 créditos no repetibles; 162
escalones que pagaran aunque fuese 500 serían **+65 %**, y habríamos arreglado el endgame
rompiendo lo que acabábamos de medir.

Está comprobado en cuatro sitios, incluido uno que **corta antes de pagar** y otro que cobra
un conjunto real contra la base de datos y comprueba que el saldo no se mueve.

---

## 2 · LA AUDITORÍA, Y LO QUE ENCONTRÓ

`npm run content:audit` (nuevo) mide el catálogo real. Cinco hallazgos:

**a) Las regiones están equilibradas en cartas, no en rareza.** 204 / 182 / 197 / 189 — un
1,12× entre la mayor y la menor. El desequilibrio está solo arriba.

**b) China no tiene épicas ni legendarias porque no tiene GALARDONES.** Una carta es
`jugador × variante`, y una variante solo existe si el jugador tiene el galardón que la
abre. De 89 jugadores chinos, **0** tienen un galardón de rareza alta; EMEA tiene 5 y
Americas 7. Es el palmarés real, no un fallo de datos.

**c) Ocho jugadores reales tienen galardón alto y no generan carta.** ScreaM, TenZ, Sacy,
Leo, Boostio, Zest (sin métricas: retirados o inactivos) y mimi, Flxja (Game Changers, menos
rondas de las que el umbral exige). Es lo que vacía las variantes `hall-of-fame`,
`game-changers` e `icon-series` (1 carta de 3 portadores).

**d) 12 de 37 variantes están vacías.** Nueve las llena el pipeline de torneos, dos son
consecuencia de (c) y una —`americas-mvp`— no tiene ningún portador: no consta ningún MVP
regional de Americas.

**e) 66 equipos de 6 a 25 cartas.** La materia prima del endgame, y estaba ahí desde el
principio.

---

## 3 · CHINA: LA CORRECCIÓN ES DE HONESTIDAD, NO DE CONTENIDO

Fabricar un galardón para que China tenga legendarias sería **inventar un resultado
deportivo**. No se hace.

Lo que se hace es dejar de mentir: los pesos `epic: 6` y `legendary: 1` pasan a cero. **El
sorteo no cambia ni un ápice** —el motor ya renormalizaba sobre los buckets con cartas—, y
está demostrado: el reparto medido antes y después es idéntico (37,91 / 42,88 / 19,21 %,
valor medio 2.804).

Y la contrapartida, que nadie había medido: **China es el regional MÁS BARATO por carta en
las tres rarezas que sí entrega.**

| | Común | Poco común | Rara |
|---|---|---|---|
| EMEA / Americas / Pacific | 1.704 | 1.500 | 3.367 |
| **China** | **1.583** | **1.399** | **3.123** |

No es un sobre peor: es un sobre sin premio gordo y con mejor tasa base. Ahora lo dice.

---

## 4 · PRIME: DOMINADO, Y RETIRADO

Se midieron las cuatro opciones del encargo antes de decidir nada.

| Eje | Prime | El mejor | Prime es |
|---|---|---|---|
| Coste por épica | 6.042 | Masters 3.290 | 1,84× |
| Coste por legendaria | 18.576 | Icon 13.343 | 1,38× |
| Coste por carta `exclusiva` (su único nicho: no restringe grupo) | 10.050 | Premium 8.071 | 1,25× |
| Certeza de llevarse una `exclusiva` (90 %) | 2 sobres = **20.000** | Premium 8 sobres = **20.000** | empate |
| Percentil 10 | **8.825** | — | **el único sobre cuyo P10 baja de su precio** |

Y las alternativas medidas: bajarlo a 5.429 lo haría líder en épicas pero con una ratio de
**4,00×**, un desajuste que distorsionaría la escalera entera; restringirlo (solo
serializadas, solo `exclusiva`, solo la variante `prime`) deja pools de 50, 6 y 5 cartas, con
**88 %, 99 % y 99 % de duplicados**.

**La causa es estructural:** con 34 raras, 9 épicas y 7 legendarias, el catálogo sostiene
tres sobres de rareza alta y Prime es el cuarto.

**Decisión: retirado del escaparate, no borrado.** La variante `prime` tiene 5 cartas, tres
recompensas conceden sobres Prime y hay jugadores con ejemplares sin abrir. Se deja de
vender, que es lo único que estaba mal. `PackDef.retired` es un booleano y la condición para
devolverlo es objetiva.

---

## 5 · EL ENDGAME: 77 OBJETIVOS SOBRE LAS CARTAS QUE YA TIENES

| Eje | Conjuntos | Escalones | Tamaños |
|---|---|---|---|
| Equipo | **66** | 2 (½ y pleno) | 6–25 |
| Región | 4 | 4 (25/50/75/100 %) | 182–204 |
| Variante | 5 | 2 | 5–54 |
| Rareza alta | 2 | 2 | 7–9 |

**Ninguna tabla nueva.** Lo reclamado va a `user_achievements` como
`mastery:<conjunto>:<escalón>`; el progreso se cuenta contra `user_cards` (paginado: una
colección completa son 772 filas y el cliente corta en 1.000).

**Y ninguna insignia escrita a mano.** El id se deriva del conjunto y el catálogo de
cosméticos sabe pintar lo que no conoce: 166 cosméticos nuevos, cero líneas de contenido.
Un equipo nuevo trae su insignia solo.

Detalle en `collection.md`.

---

## 6 · DESAFÍOS POR PARTIDO

Un partido predecible trae ahora dos preguntas: **quién gana** y **con qué resultado**
(2-0 · 2-1 · 1-2 · 0-2), esta al **doble de puntos**. Con cuatro opciones en vez de dos,
acertar a ciegas baja del 50 % al 25 %: pagar el doble por la mitad de probabilidad deja
intacto el valor esperado de adivinar y premia saber.

**No es un segundo Pick'em**: es un `kind` más de la misma tabla, el mismo ciclo y el mismo
corrector. `loop:verify` recorre la cadena entera del tipo nuevo — se genera, se responde, se
corrige y se paga.

Los otros tres que proponía el encargo **no se implementan porque no se pueden corregir**:
`matches` no guarda mapa ni MVP. Documentado, no fingido.

### Un fallo preexistente que esto destapó

`syncQuestions` refrescaba las opciones de una pregunta pero **nunca sus puntos**. Un partido
que se movía en el cuadro —de cuartos a semifinal, que es lo que hace la sincronización al
corregir la ronda— se quedaba con los puntos de la ronda vieja para siempre. En la base de
demo había cuatro así.

No se veía porque no había con qué comparar. Al añadir la pregunta de resultado —que sí
calcula sus puntos con la ronda actual— el mismo partido pasó a enseñar «10 pts» y «30 pts»,
y salió a la cara. **Corregido**, y solo sobre preguntas que aún no han empezado: cambiar el
valor de una ya respondida sería otra cosa.

---

## 7 · LA VERJA DE CONTENIDO

`npm run content:verify` es el proceso que no existía. Cruza lo que ningún proceso cruzaba:
los pesos de `data/packs` con el pool que sale de `data/players`.

**Habría cazado el sobre China tres fases antes.**

Y lo que no se puede arreglar programando no se ignora ni hace fallar la suite: se **declara
con trinquete**. Los ocho jugadores bloqueados y la variante sin portador están en listas
nombradas; si aparece uno nuevo, falla; si se resuelve uno y no se quita de la lista, también.
Lo pendiente queda a la vista y no puede crecer en silencio.

---

## 8 · LO QUE **NO** SE HA HECHO, Y POR QUÉ

| Se pedía evaluar | Decisión | Motivo |
|---|---|---|
| **Tienda de fichas de evento** | **No se construye** | El encargo pedía comprobar primero si la moneda existe. Existe (`profiles.tokens`, server-authoritative), pero una tienda que la gaste sería un sumidero paralelo al de los sobres. Las recompensas directas y los cosméticos mantienen la economía más limpia, que es lo que el propio encargo prefería |
| **Capa de temporada nueva** | **No se construye** | Ya existe (`CURRENT_SEASON` + `user_pass.season_id`). Construir otra sería la «mega plataforma» que el encargo prohíbe. La maestría es deliberadamente **permanente**: reiniciar cada 84 días un trabajo de meses lo convertiría en trabajo perdido |
| **Materiales / segunda moneda** | **No** | Sin cambios respecto a la Fase 11 |
| **Abrir el marketplace** | **No** | Sigue faltando el mismo criterio: masa de jugadores. Lo que sí se ha escrito es **qué medir cuando la haya** (`marketplace.md` §7 bis) |
| **Fabricar galardones para China** | **No** | Sería inventar un resultado deportivo |
| **Estadísticas editoriales para los ocho** | **No** | El modelo lo admite, pero exige autoría y motivo de una persona. No es una decisión de un programa |

---

## 9 · ARCHIVOS

**Nuevos (13):** `domain/collection/mastery.ts` + test · `domain/cosmetics` (familia
`insignia`) · `server/services/mastery.ts` · `app/api/game/mastery/route.ts` ·
`lib/game/mastery.ts` · `components/collection/MasteryPanel.tsx` ·
`supabase/migrations/0023_match_challenges.sql` · `scripts/content-audit.ts` ·
`scripts/content-verify.ts` · `docs/product/collection.md` · este informe

**Modificados (12):** `domain/pickems/questions.ts` (+ test) ·
`server/services/pickemLifecycle.ts` · `domain/packs/types.ts` · `data/packs.ts` ·
`data/packStats.ts` (regenerado) · `app/coleccion/page.tsx` · `app/tienda/page.tsx` ·
`app/cuenta/page.tsx` · `scripts/security-verify.ts` · `scripts/progression-verify.ts` ·
`scripts/game-loop-verify.ts` · `scripts/visual-shots.ts` · `package.json` ·
`docs/product/events.md` · `docs/product/marketplace.md` · `docs/product/visual/README.md`

---

## 10 · QUÉ **NO** SE HA MODIFICADO

Combat Resolver · CombatPlan · bots · RNG · OVR · estadísticas · generación de cartas ·
CardRegistry · `data/players.ts` · `domain/economy/pricing.ts` · `salvage.ts` ·
`services/economy.ts` · `services/market.ts` · `services/rewards.ts` · `services/duels.ts` ·
`domain/progression/rank.ts` · `duelRewards.ts` · ledger · RLS · auth · service worker ·
replays · sistema táctico · `GLOBAL_MARKET_ENABLED` (sigue en `false`) ·
`PAYMENTS_ENABLED` (sigue en `false`) · el lenguaje visual de la Fase 9.6.

**Precios de sobre: ninguno.** **Probabilidades: solo las dos imposibles de China, a cero, y
el sorteo no cambia.**

---

## 11 · QUÉ QUEDA PARA LA FASE 14

| Pendiente | Qué exige |
|---|---|
| **Los ocho jugadores bloqueados** | Una decisión editorial con autoría y motivo, o métricas reales. `content:verify` los tiene en trinquete |
| **`americas-mvp` sin portador** | Un MVP regional de Americas en los datos. No se inventa |
| **Cartas de rareza alta de China** | Depende del palmarés real. Hasta entonces, el sobre lo dice |
| **Devolver Prime al escaparate** | Que el catálogo tenga rareza alta suficiente para sostener un cuarto sobre |
| **Conjuntos de maestría por temporada** | El catálogo no marca las cartas por temporada |
| **Vitrina de insignias** | Se equipa una; enseñar las 20 que tienes exige pantalla propia |
| **Abrir el marketplace** | Masa de jugadores. Las nueve cifras a medir ya están escritas |
| **Sumidero de créditos de fin de juego** | La maestría da objetivos, **no gasta créditos**. El problema de «con la colección hecha no hay dónde gastar» sigue abierto, y ahora es el único que queda |
