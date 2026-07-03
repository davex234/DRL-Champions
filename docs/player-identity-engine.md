# Vertical 4 — Player Identity Engine · Informe

> Objetivo: que los jugadores dejen de comportarse como agentes genéricos y empiecen
> a comportarse como **profesionales reales y reconocibles**. La identidad pesa más
> que el OVR: dos jugadores con las mismas estadísticas **nunca** juegan igual.

Sin cámaras nuevas, sin replay, sin audio, sin highlights, sin nuevas interfaces.
Solo cabeza. Todo el trabajo es de **motor + IA**.

---

## 1. El modelo psicológico

Cada jugador posee un **ADN** (`Identity`): un vector de **19 rasgos** en escala 0–100
(50 = neutro), agrupados en cinco familias. El ADN es **fijo** durante la partida.
Sobre él vive un **estado mental dinámico** (`MentalState`) que evoluciona ronda a
ronda y duelo a duelo. El ADN decide *cómo de fuerte y cómo de rápido* se mueve la
mente (p. ej. `resilience` controla la recuperación; `composure` amortigua el tilt).

### 1.1 ADN — 19 rasgos (`src/sim/identity/traits.ts`)

| Familia | Rasgos |
|---|---|
| **Temperamento** | `aggression`, `patience`, `riskAppetite` |
| **Mente** | `composure` (sangre fría), `selfBelief`, `resilience`, `consistency`, `ego` |
| **Inteligencia** | `tacticalIQ`, `adaptability`, `discipline`, `creativity` |
| **Estilo** | `entryDrive`, `lurkTendency`, `tradeInstinct`, `utilityLean`, `clutchFactor` |
| **Social** | `leadershipDrive`, `communication` |

No es la lista del enunciado copiada: se rediseñó para que **cada rasgo tenga un
gancho mecánico distinto** en el motor (nada decorativo). Por ejemplo `patience` y
`aggression` no son inversos: un jugador puede ser poco agresivo *y* poco paciente
(pasivo pero nervioso) — son ejes independientes.

### 1.2 Estado mental dinámico (`src/sim/identity/mental.ts`)

| Variable | Qué es | Se mueve por |
|---|---|---|
| `confidence` | Autoconfianza (0–100) | Sube con bajas propias/de equipo; baja con muertes |
| `tilt` | Frustración (0–100) | Sube al morir/perder; lo **amortigua** `composure`, lo **disuelve** `resilience` |
| `morale` | Moral del momento (0–100) | Eventos de equipo |
| `momentum` | Racha corta (−100..100) | Cadena de bajas; se enfría solo |
| `fatigue` | Fatiga (0–100) | Sube lento; **se arrastra entre rondas** |
| `pressure` | Presión **situacional** (0–100) | Recalculada cada tick: desventaja numérica, clutch, ceguera, reloj de postplant |

**El ADN permanece; la mente cambia.** Entre rondas, `carryMental()` regresa
parcialmente a la base (según `resilience`), ajusta por victoria/derrota y acumula
fatiga. De ahí salen los arcos de partida (uno se viene arriba; otro entra en tilt y
no sale).

---

## 2. Cómo influye en las decisiones

La traducción ADN + mente + situación → números concretos vive en
`src/sim/identity/modifiers.ts`, y el motor la consume en cuatro puntos:

### 2.1 Movimiento y colocación (`playerBrain.ts`)
- **`holdSpot()`** desplaza el punto de hold: agresividad/entry/confianza/ego
  **adelantan** el ángulo; paciencia/disciplina/**presión** lo **repliegan**;
  `creativity` abre un **off-angle** lateral (determinista por jugador). → Quién es
  *peeker* y quién *holder*, y a qué distancia se da el duelo, depende de la cabeza.
- **`wantsRepeek()`** es la decisión individual estrella: ¿re-asoma a una última
  posición vista o aguanta? Agresividad, riesgo, **tilt** y ego empujan a cazar;
  paciencia y disciplina a esperar. Aquí nace el "siempre hace locuras" frente al
  "siempre se esconde".

### 2.2 Combate (`combat.ts`)
- **`aimMult()`**: la confianza y el momentum **suman** letalidad; tilt, presión y
  fatiga **restan** (amortiguados por sangre fría y, en clutch, por `clutchFactor`);
  la **inconsistencia** añade varianza por duelo (vía el RNG sembrado del motor).
- **`reactDelta()`**: tilt y presión **frenan** la reacción; confianza e instinto de
  trade la **sueltan**.
- **`tradeRadius()`**: la comunicación y el instinto de trade amplían la ventana de
  refrag del equipo.

### 2.3 Capa de equipo / IGL (`director.ts`)
- **`iglLatencyMult()`**: un líder con `leadershipDrive` alto y equipo confiado
  decide **antes**; el tilt y la baja moral **ralentizan** execute y retake.
- **`topByTrait()`** elige al lanzador de utilidad por `utilityLean` (no por su rol
  nominal) y escala la calidad del flash; y al **lurker designado** por
  `lurkTendency`, que se separa por el flanco lo diga su rol o no.
- **`shouldAdapt()`**: un IGL `adaptability` alto, por detrás o con baja moral, pasa
  a jugar más lento / a picks y repliega la defensa.

### 2.4 Reacción a la presión
`computePressure()` se recalcula **cada tick** (desventaja numérica, último vivo,
ceguera, reloj de postplant) y entra en puntería, reacción y colocación. La misma
situación hunde a un jugador de poca `composure` y enfoca a uno de `clutchFactor`
alto.

---

## 3. Qué cambia en el gameplay (validación)

Experimento **controlado** (`scripts/identity-report.ts`, `npx tsx`): a los 10
jugadores se les dan **atributos idénticos** (aim 76 / gameSense 78 / utility 72 /
leadership 72) y se **rotan los arquetipos por los 5 roles** para que rol y ADN no se
confundan. Cualquier diferencia es **100% identidad**. 600 rondas, determinista.

| Arquetipo | K/D | DistPeek | Avance | 1stContact | MuereSolo% | Trade-death% | Repeek/rnd | Surv% | Clutch% | TiltPico | ConfFin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FURIA (duelista) | 1.12 | 375 | **200** | 0.16 | **23%** | 24% | 13.6 | 36% | 8% | 5 | 79 |
| NOVA-X (estrella) | 0.96 | 377 | 192 | 0.13 | 21% | 26% | 14.3 | 36% | 5% | 6 | **81** |
| SOMBRA (lurker) | 0.86 | **397** | **132** | 0.19 | **8%** | 28% | 12.4 | 34% | 11% | 4 | 69 |
| ANCLA-U (soporte) | 1.06 | 391 | 189 | 0.18 | 12% | **31%** | 11.8 | 37% | **17%** | 4 | 59 |
| MURO (ancla) | 1.01 | 395 | 194 | **0.34** | 14% | 29% | 12.1 | 35% | 11% | **3** | 64 |

**Lectura:**
- **FURIA** conquista más espacio y **muere más solo** (sobre-extensión): el fragger
  de fuego.
- **SOMBRA** toma **mucho menos espacio**, asoma **de más lejos** y **casi nunca
  muere solo**: juega de flanco y con cabeza; buen ratio de clutch.
- **ANCLA-U** vive de la utilidad y el equipo: **más trade-deaths** (juega pegado) y
  **mejor clutch%**.
- **MURO** es el que más entra en el **primer duelo aguantando su ángulo** y el de
  **menor tilt**: el muro inquebrantable.
- **NOVA-X** acaba con la **confianza más alta** pero K/D irregular: techo altísimo y
  errático (su `consistency` baja).

**Separabilidad:** con una huella de 10 features normalizadas, el **par más parecido**
(FURIA vs NOVA-X, ambos hiperagresivos) dista **2.46 σ**, muy por encima del umbral
de 1 σ. **Todos los pares son distinguibles solo observando el comportamiento.**

---

## 4. Historias que emergen

Ninguna está guionizada; emergen de rasgos + estado mental. Ejemplo real (semilla
#165 del experimento), un **1v4 ganado a pelo** por el arquetipo de estrella, que
entra al clutch con confianza 61 y encadena cuatro bajas en ~2 s. El motor lo narra
desde el log de eventos en la sección final de `scripts/identity-report.out.md`.

Tras observar varias partidas, el ADN produce frases reconocibles:
- *"Este siempre se la juega"* → **FURIA** (máximo MuereSolo%).
- *"Este siempre se esconde"* → **SOMBRA** (mínimo avance, juega de lejos).
- *"Este nunca falla un clutch"* → **ANCLA-U** (mejor clutch%).
- *"Este es un muro"* → **MURO** (máximo primer-contacto aguantando).
- *"A este no le tiembla el pulso"* → **MURO** (mínimo tilt).

---

## 5. Cualquier pro, sin hardcodear

No hay ningún jugador codificado. Un pro presente o futuro se modela eligiendo o
afinando un **perfil de rasgos** (`src/sim/identity/profiles.ts`) o escribiendo su
propio vector con `makeIdentity({...})`. Los nombres de los arquetipos describen un
**estilo**, no a una persona; la huella de comportamiento emerge **solo** de los
números. La API pública (`src/sim/index.ts`) exporta `Identity`, `MentalState`,
`makeIdentity`, `PROFILES`, etc.

### Determinismo intacto
Todo el azar sigue pasando por el RNG sembrado del motor; los off-angles y el arrastre
mental son deterministas. **Misma semilla ⇒ misma ronda, byte a byte** (verificado en
la validación).

---

## 6. Mapa de archivos

| Archivo | Rol |
|---|---|
| `src/sim/identity/traits.ts` | ADN: 19 rasgos, familias, helpers |
| `src/sim/identity/mental.ts` | Estado mental: init, decaimiento, arrastre, impacto de bajas |
| `src/sim/identity/modifiers.ts` | Traducción ADN+mente+situación → números (combate, movimiento, equipo) |
| `src/sim/identity/profiles.ts` | Arquetipos de ejemplo (datos, no comportamiento) |
| `src/sim/identity/index.ts` | API del módulo |
| `types.ts` / `engine.ts` | `SimPlayer.identity/mental`, init + arrastre + `tickMental` |
| `ai/playerBrain.ts` · `ai/behaviors.ts` | Colocación, re-peek, reacción |
| `ai/director.ts` | Timing de IGL, lurker/util designados, adaptación |
| `combat.ts` | Multiplicador de puntería, ventana de trade, fallout mental |
| `scripts/identity-report.ts` | Validación controlada + informe (`npx tsx scripts/identity-report.ts`) |
