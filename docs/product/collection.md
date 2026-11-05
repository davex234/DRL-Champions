# COLECCIÓN, MAESTRÍA Y ENDGAME

> Qué hace un jugador cuando ya tiene el 91 % de las cartas.
>
> Estado: **Fase 14**. Medido con `npm run content:audit`, vigilado por
> `npm run content:verify` (20 comprobaciones) y verificado contra la base de datos real por
> `npm run progression:verify` (32 comprobaciones: 14 de maestría y 18 de prestigio, incluidas
> las dos económicas — que la maestría no paga y que el prestigio sí cobra).

---

## 1 · EL PROBLEMA, CON SU CIFRA

La Fase 11 lo detectó y la Fase 12 lo midió:

| Perfil | 84 días | Catálogo | Coste de la siguiente carta nueva |
|---|---|---|---|
| Casual | 481 cartas | 62 % | 249 cr |
| Activo | 440 | 57 % | 841 cr |
| **Intensivo** | **704** | **91 %** | **1.609 cr** |

Al 91 % **no queda nada que hacer**. El único sumidero son los sobres, y cuando el sobre
deja de traer cartas nuevas, los créditos se acumulan sin destino.

«Completar la colección» tampoco sirve de meta: son 772 cartas. Un objetivo que tarda una
temporada en moverse no orienta una sesión de juego.

---

## 2 · LA MATERIA PRIMA YA ESTABA EN LOS DATOS

`content:audit` mide qué agrupaciones existen en el catálogo. Ninguna se ha inventado:

| Eje | Conjuntos | Tamaños | Mediana | ¿Sirve? |
|---|---|---|---|---|
| Por región | 4 | 182–204 | 197 | Demasiado grande para una meta, bien como recorrido |
| **Por equipo** | **66** | **6–25** | **11** | **Sí. Es el eje principal** |
| Por variante | 25 | 1–168 | 4 | Los pequeños sí |
| Por jugador | 353 | 2–8 | 2 | Demasiados y demasiado triviales |

De ahí salen **77 conjuntos y 162 escalones**.

| Eje | Conjuntos | Escalones | Tamaños |
|---|---|---|---|
| Equipo | 66 | 2 cada uno (½ y pleno) | 6–25 |
| Región | 4 | 4 cada uno (25/50/75/100 %) | 182–204 |
| Variante | 5 | 2 cada uno | 5–54 |
| Rareza alta | 2 | 2 cada uno | 7–9 |

Los conjuntos de menos de **5 cartas** se descartan: se consiguen sin proponérselo. Los de
variante por encima de 60 también: son las metálicas base y las regionales, o sea el
catálogo entero con otro nombre.

---

## 3 · LA REGLA ECONÓMICA: NI UN CRÉDITO

**La maestría no reparte un solo crédito, ni XP, ni fichas, ni sobres.** Reparte **166
insignias** y **4 títulos**.

No es una preferencia estética. El grifo de temporada son **124.900 créditos** no
repetibles (`economy.md` §4, medido). 162 escalones que pagaran aunque fuese 500 créditos
serían **81.000 más, un +65 %**: habríamos resuelto el problema del endgame inflando la
economía que la Fase 12 acababa de calibrar.

Lo que se paga es **reconocimiento**. Y el reconocimiento es, además, lo único que la
Fase 12 dejó preparado para monetizar (`economy.md` §9, opción C) y lo único que no
distorsiona ningún precio.

**Está comprobado en tres sitios**, no confiado a la buena voluntad de quien añada un
conjunto:

| Dónde | Qué comprueba |
|---|---|
| `mastery.test.ts` | Ningún escalón declara créditos, XP, fichas, sobres ni cartas |
| `content:verify` | Lo mismo, sobre el catálogo vivo |
| `services/mastery.ts` | `assertNoCredits()` **corta antes de pagar** |
| `progression:verify` | Cobra un conjunto real contra la base de datos y comprueba que **el saldo no se mueve** |

---

## 4 · LAS INSIGNIAS NO SE ESCRIBEN A MANO

66 equipos son 66 insignias. Escribirlas una a una sería contenido muerto en cuanto llegara
un equipo nuevo.

El id se **deriva** del conjunto (`insignia:equipo:100t`) y `domain/cosmetics/catalog` sabe
pintar un cosmético que no conoce a partir de su propio id: le saca el nombre y el tono del
eje. **Un equipo nuevo trae su insignia sin que nadie la escriba.**

Es la arquitectura que el encargo pedía —«que permita añadirlos», no «cientos escritos»— y
la razón de que 166 cosméticos nuevos no hayan costado una sola línea de contenido.

---

## 5 · SERVIDOR, COMO TODO LO DEMÁS

| Pregunta | Quién responde |
|---|---|
| ¿Qué conjuntos hay? | `domain/collection/mastery`, derivado del catálogo vivo |
| ¿Cuántas tengo? | Recuento sobre `user_cards`, **paginado** (una colección completa son 772 filas y el cliente corta en 1.000) |
| ¿Puedo cobrar? | Progreso real + no reclamado antes |
| ¿Qué me llevo? | El catálogo del servidor |

El cuerpo de la escritura son **un identificador y una fracción**. Lo reclamado va a
`user_achievements` con el id `mastery:<conjunto>:<escalón>` — **ninguna tabla nueva**, igual
que los desafíos de evento de la Fase 12.

**La maestría es permanente, no de temporada.** Una colección tarda meses en construirse y
reiniciar el reconocimiento cada 84 días convertiría el trabajo largo en trabajo perdido. Lo
que sí se guarda es *cuándo* se consiguió, que es lo que permite ordenar una vitrina por
temporadas sin borrar nada.

---

## 6 · QUÉ SE INTENTA ROMPER Y QUÉ LO IMPIDE

En `progression:verify`, contra la base de datos real:

| Ataque | Defensa |
|---|---|
| Cobrar un conjunto sin completarlo | Progreso contado en el servidor |
| Cobrar dos veces | Registro + clave de idempotencia en `award()` |
| Inventarse un conjunto | 404 |
| Inventarse un escalón (`at: 0.31337`) | 404 — no se redondea al más cercano, que sería regalar escalones |
| Una fracción fuera de rango | 400 |
| Una acción desconocida | 400 |
| **Que la maestría pague créditos** | `assertNoCredits()` **antes** de pagar, y el saldo se comprueba después |

---

## 6 bis · PRESTIGIO: EL SUMIDERO (Fase 14)

La maestría daba objetivos y **no gastaba créditos**. Era el último problema abierto desde
la Fase 11, y el prestigio es su respuesta.

### El problema, medido

`npm run economy:simulate` incorpora un escenario de **saturación**: el jugador deja de
comprar sobres en cuanto pasa del 85 % de colección, que es lo que hace una persona cuando
el sobre ya casi nunca trae algo nuevo.

| Perfil | Colección | Acumulado en la temporada | Por día |
|---|---|---|---|
| Casual | 62 % | 274 | 3 |
| Activo | 57 % | 758 | 9 |
| **Intensivo** | **85 %** | **167.582** | **1.995** |

**Dos cosas que cambian el tamaño del problema:** solo un perfil se satura —Casual y Activo
siguen comprando sobres y acaban a cero—, y la magnitud son unos **2.000 créditos al día**.

### La respuesta

Una insignia que te ganaste completando un conjunto se puede **mejorar**: plata, oro, élite.
Cuesta créditos, no da absolutamente nada y solo cambia cómo se ve.

| Escalón | Precio | Días del perfil saturado |
|---|---|---|
| Plata | 15.000 | 7,5 |
| Oro | 40.000 | 20 |
| Élite | 100.000 | 50 |
| **Un conjunto entero** | **155.000** | **78 — casi una temporada** |

Llevar **un** conjunto a élite es el objetivo de una temporada, no de una tarde. Y con 77
conjuntos la capacidad total es de **11.935.000 créditos: 16 años** del perfil que más
acumula. Un sumidero que se agota deja de serlo; este no se agota nunca. Lo que se agota es
el tiempo, y por eso **elegir a qué equipo dedicarlo es la decisión** — que es justo lo que
convierte un sumidero en identidad.

### Medido contra la acumulación

| Perfil | Acumula/temporada | Escalones que paga | Absorbido |
|---|---|---|---|
| Casual | 274 | 0 | 0 % |
| Activo | 758 | 0 | 0 % |
| Intensivo | 167.582 | 3 | **92 %** |

Es un sumidero de **fin de juego**, no un impuesto: al que no se satura no le afecta.

### Las cuatro puertas

```
1. IDEMPOTENCIA   economy_ops[ref]           un reintento no cobra dos veces
2. NO DUPLICAR    ya lo tiene → no se cobra
3. REQUISITO      la insignia de PLENO y el escalón anterior
4. SALDO          _ledger_apply corta y deshace la transacción entera
```

**Los créditos no sustituyen a coleccionar: lo reconocen.** No se puede comprar prestigio de
un conjunto sin haberlo completado antes, y los escalones se compran en orden — saltar de la
base a élite costaría 100.000 en vez de 155.000.

### Lo que NO se ha creado

Ninguna tabla (`user_cosmetics` ya estaba). Ninguna moneda. Ningún cosmético escrito a mano:
**231 ids derivados** (77 insignias × 3 escalones) que el catálogo de cosméticos pinta
reconociendo el sufijo. Un equipo nuevo trae sus tres prestigios solo.

---

## 7 · LO QUE QUEDA

| Pendiente | Nota |
|---|---|
| **Conjuntos por temporada** | Hoy son permanentes. Un conjunto «los campeones de la S1» exigiría marcar cartas por temporada, y el catálogo no guarda esa marca |
| **Vitrina de insignias en el perfil** | Se equipa una y se ve. Enseñar las 20 que tienes exigiría una pantalla propia |
| **Conjuntos por jugador** | 353 conjuntos de 2–8 cartas: demasiados para una lista y demasiado triviales para ser un objetivo. Tendrían sentido acotados a jugadores destacados |
| **Duplicados hacia la maestría** | Hoy un duplicado solo se desguaza. Que además contara para algo exigiría una segunda moneda, que es justo lo que la Fase 12 decidió no introducir |
