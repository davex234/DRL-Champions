# NEXUS — PRIMERA SESIÓN

> Recorrido real de una cuenta recién creada, sin sembrar nada.
> Lo único que tiene es lo que le da el disparador de alta: **4 sobres y 6.000 créditos**.
> Fase 13 · 2026-09-06 · capturas en `docs/product/qa/fase13/`

La pregunta: **«si nunca hubiera usado NEXUS, ¿sé qué hacer?»**

---

## Minuto 0 — Entrar

Llego a `/`. El armazón me dice dos cifras sin que las busque: **NIVEL 1 · 0%** y
**🪙 6.000**. Debajo, una tira de acciones. La primera, destacada y rellena, dice:

> **ABRIR TUS SOBRES** — *Tienes 4 sobres de bienvenida. Ábrelos y empieza tu colección.*

Es correcta. Con cero cartas es literalmente lo único sensato que puedo hacer, y el
servidor lo sabe: `getLoop` le da prioridad **0**, por delante incluso de las
predicciones que caducan.

La pantalla tiene 13 salidas más: el partido en directo, los duelos, mi rango, mi cuenta,
mi colección (0 / 772). No me pierdo.

**Veredicto: CLARO.** El vestíbulo de un jugador nuevo hace su trabajo.

---

## Minuto 1 — El primer tropiezo

Pulso «Abrir tus sobres» y llego a `/inventario`.

Y aquí pasa algo raro. La pantalla se titula **INVENTARIO** y explica *«lo que posees y
todavía no has resuelto»*. Mis cuatro sobres están ahí, en dos paneles oscuros sobre
fondo oscuro, con un «×3 · toca para abrir» en gris de 11 px.

Lo más brillante de la pantalla no son mis sobres. Es un botón rosa que dice
**INSTALAR**, de un aviso para instalar la aplicación. Y el bloque que más espacio
vertical ocupa es **«DUPLICADOS — No tienes cartas duplicadas»**, un recuadro vacío que
por definición está vacío para alguien que acaba de llegar.

He seguido la única instrucción que me han dado y he aterrizado en una pantalla donde la
cosa que vine a hacer es más apagada que un anuncio.

**Veredicto: FRICCIÓN (P0).** No estoy bloqueado —los sobres se ven y se pulsan— pero la
jerarquía dice lo contrario de lo que dice el paso que me trajo aquí.

---

## Minuto 2 — La ceremonia

Toco el sobre inicial. `/abrir/inicial`.

Y esto es otra cosa. Pantalla completa, sin armazón, sin ruido. El sobre flota en el
centro con su resplandor cian. Debajo:

> **DESLIZA PARA ABRIR**
> *Arrastra sobre la costura →*

Con un botón discreto **ABRIR SOBRE** por si no quiero arrastrar. Una sola instrucción,
un solo gesto, cero decoración de más.

Arrastro. Las cartas se revelan **de una en una**: nombre, equipo, rareza, seis
estadísticas, un **¡NUEVA!** verde y su valor en créditos. «Toca para la siguiente».

**Veredicto: FUERTE.** Es el mejor momento del producto. No hay nada que arreglar aquí.

---

## Minuto 4 — El resumen, y el segundo tropiezo

Termina el revelado. El resumen me dice: **Cartas 5 · Nuevas 5 · Valor total**. Y me
ofrece dos botones:

- *Ver colección* (secundario)
- **Abrir otro** (primario, relleno, rosa)

Pulso «Abrir otro», que es exactamente lo que quiero hacer: me quedan tres sobres.

Y me lleva a **`/tienda`**. A comprar.

Tengo tres sobres de bienvenida sin abrir en el inventario y el botón principal me manda
a la caja. No es un enlace roto —la tienda funciona— pero me está ofreciendo pagar por
algo que ya tengo.

Comprobado en la base de datos: al abrir el primer sobre, `sobres` pasó de **4 a 3**,
`cartas` de **0 a 5** y `xp` de **0 a 130**. La recompensa llega. El destino, no.

**Veredicto: ROTO (P0).** Es el CTA principal del momento de mayor intención del juego y
apunta al sitio equivocado.

---

## Minuto 6 — La colección

Voy a `/coleccion` por mi cuenta. **5 / 772 · 1% completado.** Mis cinco cartas están
ahí, con filtros por rol, rareza, «tengo», «faltan». Es bonito y es informativo.

Y no me propone nada. Cero salidas propias: veintidós controles, todos filtros y
ordenaciones. Acabo de vivir el mejor momento del juego y la pantalla donde aterrizo no
me dice qué sigue.

**Veredicto: FRICCIÓN (P1).** No es un callejón —el armazón siempre está— pero el
contenido no continúa el ciclo.

---

## Minuto 8 — La pared

Vuelvo a `/`. El ciclo ahora me dice, con prioridad 5: **«Construye tu mazo — Necesitas
diez cartas para competir. Abre los sobres que ya tienes.»** → `/inventario`.

El paso es correcto. Pero yo, jugador, me he ido por mi cuenta a `/duelos`, que es lo que
quiero hacer. Ahí veo dos paneles grandes: **NUEVO DUELO** («Necesitas un mazo válido de
10 cartas») y **MIS MAZOS** («Crea tu primer mazo»).

Pulso «Mis mazos» → **CREAR MI PRIMER MAZO** (botón rosa, brillante) → y entro en el
constructor.

Diez huecos vacíos. **CARTAS 0 / 10.** «FALTAN 10 CARTAS · Te falta Duelista, Duelista,
Controlador, Controlador…». Un **GUARDAR MAZO** rosa que no puedo usar.

Abajo del todo, en gris, la frase que necesitaba:

> *Todavía no tienes cartas, pero tienes 4 sobres sin abrir en Inventario.*

Está bien escrita y dice exactamente lo correcto. Pero es lo más apagado de la pantalla
y **«Inventario» no es un enlace**. Me dice adónde ir y no me lleva.

Y hay algo peor, que solo se ve midiendo: esa frase **solo aparece si tengo CERO cartas**.
Yo ya tengo cinco. Si hubiera abierto el sobre antes de venir aquí —que es justo lo que
el ciclo me pide— la rejilla mostraría mis cinco cartas, ninguna frase, ningún aviso, y
no habría **nada en toda la pantalla** que me explicara por qué no puedo completar el
mazo ni qué hacer al respecto.

**Veredicto: ROTO (P0).** El tramo entre 1 y 9 cartas es el hueco más grande del ciclo, y
es exactamente el tramo por el que pasa todo jugador nuevo.

---

## Minuto 12 — Lo que sí funciona sin ayuda

Con la pared del mazo detrás, doy una vuelta:

- **`/pickems`** — la mejor pantalla del producto para entender su propio bucle. Me dice
  a la vez: *4 predicciones abiertas*, *tus puntos 0 / 125*, *respondidas 0 / 6*,
  *recompensa: sin escalón todavía, 1 pt para participación*, y por cada partido *15 pts*
  y *cierra en 2 d 23 h*. Sé qué gano, cuánto vale y cuándo se acaba.
- **`/torneos`** — «HACER MIS PREDICCIONES» destacado, el torneo en directo, uno pasado.
- **`/recompensas`** — el recibo: *créditos de bienvenida, 6.000, 6 sept 17:43*. Mi rango
  («Sin clasificar — todavía no has puntuado, acierta una predicción y entras en la
  escalera») y los cinco escalones con lo que paga cada uno.
- **`/eventos`** — misiones, pase de evento, dos eventos con cuenta atrás.
- **`/entrenador`** — cuatro pasos numerados: monta el equipo, estudia el mapa, dibuja la
  jugada, dirige el partido.

Ninguna de estas me deja tirado.

---

## Minuto 15 — ¿Y mañana?

Sin haber jugado un duelo todavía, las razones que el producto me ha dado para volver:

| razón | ¿me la han dicho? |
|---|---|
| 4 predicciones que **cierran en 2-3 días** | **Sí**, y marcadas como urgentes |
| 3 sobres sin abrir | Sí |
| Partido en directo ahora mismo | Sí |
| Colecciones incompletas (1%) | Sí |
| Pase de temporada, 30 niveles | Sí |
| 3 misiones diarias + 2 semanales | **No.** Existen, rotan, se sortean en el servidor — y nadie me las anuncia |

---

## Resumen de la primera sesión

| momento | veredicto |
|---|---|
| Entrar y saber qué hacer | **CLARO** |
| Llegar al inventario | **FRICCIÓN** — los sobres pierden contra un anuncio |
| La ceremonia del sobre | **FUERTE** |
| El resumen → «Abrir otro» | **ROTO** — manda a comprar lo que ya tengo |
| La colección tras abrir | **FRICCIÓN** — sin continuación |
| Construir el primer mazo | **ROTO** — sin guía entre 1 y 9 cartas |
| Pick'ems, torneos, recompensas | **CLARO** |
| Razones para volver | **CLARO** salvo las misiones diarias |

**La conclusión honesta:** NEXUS sabe perfectamente qué debe hacer un jugador nuevo —el
servidor lo calcula bien y lo ordena bien— y falla en llevarlo hasta ahí. Los tres
problemas P0 son de destino y de jerarquía, no de sistema: en los tres casos el dato
correcto ya existe en la pantalla y no está puesto donde el jugador mira.
