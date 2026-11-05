# NEXUS AGENT BIBLE 1.0

**Fase 48 · Agent Identity System.** Los diez agentes propios de NEXUS, de nombre y glifo a
personaje. Documento de identidad **canónica**: lo que aquí se declara es lo que recibe quien
produzca el arte, y lo que el producto usa para distinguirlos.

---

## 0 · Qué era dato y qué es nuevo

Antes de esta fase, un agente de NEXUS era esto y nada más:

| Ya existía (fuente de verdad, intocable) | Dónde vive |
|---|---|
| id, nombre, **codename**, clase | `src/agents/catalog.ts` |
| perfil de capacidades (0–100, **quince ejes**; 15 es el valor base) | `src/agents/capabilities.ts` |
| kit de utilidad: cargas, mecánicas, objetivo macro | `src/agents/types.ts` |
| etiquetas legibles («humos», «trampas», «lurker») | `src/agents/catalog.ts` |
| habilidades DERIVADAS de clase × mecánica | `src/abilities/catalog.ts` |
| glifo original (sigilo SVG) y color de clase | `src/components/tactics/AgentEmblem.tsx` |

**No había ni una línea de lore, ni descripción física, ni dirección de arte.** Todo lo que
este documento añade —fantasía, carácter, silueta, cara, equipo, motivo, acento— es **identidad
canónica NUEVA propuesta en la Fase 48**. No sustituye ningún dato de juego y no toca el
equilibrio: un agente sigue siendo su clase, su kit y sus números.

**Cero copia.** Ninguno de los diez es «básicamente» un agente de Valorant con otro nombre. Ni
nombres, ni siluetas, ni habilidades, ni assets de Riot. Donde ha hecho falta elegir, se ha
elegido el camino que SEPARA, no el que se parece.

---

## 1 · NEXUS AGENT ART LANGUAGE

### La premisa que ordena todo lo demás

**Son atletas, no operativos.** NEXUS es un producto de esports competitivo: los agentes compiten
en un circuito profesional reglado, no asaltan edificios. Esa sola decisión resuelve la mitad de
las preguntas de diseño y es lo que más los separa de cualquier shooter táctico:

- el equipo es **material de competición homologado**, no militar: ligero, reparado, con marcas
  de uso reales —rozaduras en los cantos, correas dadas de sí, una pieza sustituida que no es
  del mismo lote—;
- **no hay armas de fuego en los retratos**. Lo que define a un agente es su utilidad, que es lo
  que el motor modela de verdad. Una pistola en la mano sería una promesa que el juego no cumple;
- **nadie va enmascarado del todo**. Hay cara, o al menos mandíbula y mirada. Un circuito
  profesional tiene rostros; diez cascos integrales serían diez desconocidos;
- **ni poderes sobrenaturales ni magia**. Todo lo que hace un agente sale de un aparato que
  lleva encima y que se ve.

### Los cinco principios

1. **Oscuro, técnico y cinematográfico.** La misma paleta de la casa: fondo `#06070d`, contraste
   alto, luz dura. El agente se ilumina, el fondo no existe.
2. **La silueta es la identidad.** Un agente tiene que reconocerse **en negro sobre blanco**. Si
   dos siluetas se confunden, el diseño está mal, por bien pintados que estén.
3. **Cada pieza tiene función.** Ni un cable que no lleve a ningún sitio, ni una placa que no
   proteja nada, ni una luz que no indique nada. Si no se puede decir para qué sirve, se quita.
4. **Un solo acento de luz por agente.** El color propio aparece en dos o tres puntos —un visor,
   una junta, una guía—, nunca como iluminación ambiental de todo el cuerpo. Diez personajes
   bañados en su color son diez siluetas idénticas de distinto tono.
5. **El arte no lleva interfaz.** Ni nombre, ni clase, ni stats, ni logotipos, ni marco, ni
   fondo. Eso lo pone el producto, y lo pone igual para los diez.

### Iluminación (común a las cuatro piezas)

Clave fría alta a 3/4 por la izquierda; relleno muy bajo del color de la **clase** por la
derecha —así una composición fotografiada en fila tiene coherencia de familia—; contraluz sutil
que despega el contorno del fondo, porque el producto pinta detrás gradientes oscuros.

### Tratamiento

Realismo estilizado: proporciones humanas creíbles, materiales identificables (composite mate,
tejido técnico, goma, metal cepillado), sin caricatura y sin hiperrealismo fotográfico. El
acabado lo marca el máster de Veil (§ 3 del informe de fase).

---

## 2 · Diferenciación: los diez de un vistazo

La prueba del algodón es la silueta. Ni dos comparten volumen, altura aparente y cabeza:

| Agente | Altura aparente | Volumen | Cabeza | Rasgo de contorno irrepetible |
|---|---|---|---|---|
| **Veil** | alta | esbelto | capucha baja | capa larga con lastre; el bajo cuelga recto |
| **Haze** | media | compacto | moño alto | cintas sueltas que van medio paso por detrás |
| **Probe** | media-alta | delgado | visor monocular | antebrazo izquierdo el doble que el derecho |
| **Pulse** | media | atlético | descubierta | peto de nervaduras horizontales, postura adelantada |
| **Spear** | alta | ancho de hombros | coleta corta | peto en punta, **un solo** hombro reforzado |
| **Blitz** | baja | denso | casco integral | torso corto y cuadrado; nada cuelga |
| **Warden** | alta | el más voluminoso | casco con mandíbula | hombreras cuadradas y placa frontal de una pieza |
| **Tripwire** | media | enjuto | gafas en la frente | carretes en caderas y muslos; postura agachada |
| **Specter** | alta | ligero | pañuelo alto | faldón partido y brazos largos; manos vacías |
| **Echo** | media | cargado | diadema sobre gorro | arnés de módulos repetidos a tres tamaños |

Y el segundo eje, el cromático: los dos agentes de cada clase comparten familia pero no tono, de
modo que **la clase sigue leyéndose de un vistazo y el agente también**.

| Clase | Color de clase (manda en el mapa) | Los dos acentos |
|---|---|---|
| Controlador | `#a78bfa` | Veil `#8b7bf0` · Haze `#c3a0ff` |
| Iniciador | `#19e3ff` | Probe `#19e3ff` · Pulse `#6ea8ff` |
| Duelista | `#ff2e63` | Spear `#ff2e63` · Blitz `#ff7a3d` |
| Centinela | `#3fc07a` | Warden `#3fc07a` · Tripwire `#7fd44f` |
| Flexible | `#ffd35c` | Specter `#cbb26a` · Echo `#ffd35c` |

Regla del par: **el que ancla lleva el tono grave; el que se mueve, el claro.**

---

## 3 · Los diez

> `CLASE`, `CODENAME`, `KIT` y `HABILIDADES` son datos del catálogo, citados tal cual.
> El resto es identidad nueva de la Fase 48.

---

### VEIL

- **NAME** · Veil — **CODENAME** · `VEIL` — **CLASS** · Controlador
- **KIT** · 4 cargas · humo + cobertura · objetivo: espacio. **HABILIDADES** · Smoke Screen, Containment
- **NÚMEROS** · control 92 · espacio 82 · utilidad 78 · post-plant 64
- **CORE FANTASY** · El que **construye la pared**. Veil no desaparece ni engaña: levanta
  materia entre el equipo y el peligro, y esa materia se queda ahí. Cuando un mapa se parte en
  dos mitades, es porque Veil lo ha decidido.
- **PERSONALITY** · Metódico y callado. Llega antes que nadie al escenario y mide distancias.
  Habla poco durante la ronda y siempre en imperativo corto. No celebra.
- **SILHOUETTE** · Alta y estrecha. Capa técnica larga con lastre en el bajo que cuelga recto y
  no ondea; hombros estrechos.
- **FACE / HEAD** · Mitad superior en sombra bajo la capucha. Mandíbula y boca visibles, piel
  mate, una cicatriz corta de quemadura en el pómulo derecho.
- **HAIR / HEADGEAR** · Capucha estructurada de tejido pesado, con varilla interna que le da
  forma fija. Pelo corto, invisible bajo ella.
- **BODY TYPE** · Delgado, fibroso, de brazos largos.
- **OUTFIT** · Capa-sobretodo de composite mate hasta media pantorrilla, abierta por delante;
  debajo, mono técnico ajustado gris grafito. Guantes largos sin dedos.
- **SIGNATURE EQUIPMENT** · Un **dispensador de cortina** en la espalda: cuatro cartuchos
  verticales que se ven sobresalir por encima del hombro derecho, uno por carga. Cuanto más
  gastados, más marcados están.
- **PRIMARY VISUAL MOTIF** · **Lo que cae y se queda.** Verticales pesadas: pliegues rectos,
  cartuchos en fila, nada horizontal.
- **COLOR IDENTITY** · `#8b7bf0`, índigo-violeta profundo. Aparece en la junta de los cartuchos y
  en la costura interior de la capucha. Nada más.
- **GLYPH RELATIONSHIP** · El sigilo son **tres velos que caen de una barra**. Los tres pliegues
  del glifo son los mismos tres pliegues del bajo de su capa.
- **TACTICAL IDENTITY** · Corta líneas y las mantiene cortadas. El defecto de un equipo con Veil
  es la lentitud: sus *defaults* son lentos porque su ventaja necesita tiempo.
- **VISUAL DO** · Telas gruesas con peso real · verticales · sombra en la cara · aire de obra.
- **VISUAL DON'T** · Nada espectral, etéreo ni translúcido. No es un fantasma ni un hechicero. No
  cara tapada del todo. No humo pintado alrededor del personaje.

---

### HAZE

- **NAME** · Haze — **CODENAME** · `HAZE` — **CLASS** · Controlador
- **KIT** · 4 cargas · humo · objetivo: espacio. **HABILIDADES** · Smoke Screen
- **NÚMEROS** · control 80 · engaño 74 · utilidad 70 · espacio 64 · rotación 62
- **CORE FANTASY** · La que **mueve la pared**. Donde Veil deja materia quieta, Haze la arrastra:
  aparece humo en un sitio, el rival rota, y el humo ya está en otro. Su arma es el tempo.
- **PERSONALITY** · Rápida, sarcástica, incapaz de estarse quieta. Habla todo el rato en la
  comunicación y cambia de plan a mitad de frase. Es la primera en reírse de un fallo propio.
- **SILHOUETTE** · Media, compacta y siempre en movimiento. Chaqueta corta abierta que vuela;
  cintas de escape a la espalda.
- **FACE / HEAD** · Cara entera, expresiva. Ojos muy abiertos, cejas altas. Pecas quemadas por el
  sol en nariz y pómulos.
- **HAIR / HEADGEAR** · Pelo recogido en moño alto, con mechones sueltos. Gafas de aerosol
  subidas a la frente, con el cristal rayado.
- **BODY TYPE** · Baja-media, sólida, piernas fuertes de corredora.
- **OUTFIT** · Chaqueta corta de tejido ligero sobre camiseta técnica, pantalón de trabajo con
  refuerzos en rodilla. Todo dado de sí.
- **SIGNATURE EQUIPMENT** · Cuatro **botes de aerosol** en un cinturón de liberación rápida a la
  cadera, más dos **cintas de escape** en la mochila que sueltan un hilo de vapor y siempre van
  medio paso por detrás de ella.
- **PRIMARY VISUAL MOTIF** · **La estela.** Todo lo suyo va con retardo respecto al cuerpo:
  cintas, mechones, faldón de la chaqueta.
- **COLOR IDENTITY** · `#c3a0ff`, lila pálido. En las cintas y en el cristal de las gafas.
- **GLYPH RELATIONSHIP** · El sigilo son **dos volutas que se desplazan** sobre una línea: la
  misma estela, dibujada.
- **TACTICAL IDENTITY** · Fakes y ritmo. Su humo vale menos por lo que tapa que por cuándo llega.
- **VISUAL DO** · Movimiento congelado a mitad · tejido ligero · desgaste alegre.
- **VISUAL DON'T** · No serpientes, no veneno, no verde tóxico. No confundirla con Veil: ella
  **no** lleva capa ni capucha.

---

### PROBE

- **NAME** · Probe — **CODENAME** · `PRB` — **CLASS** · Iniciador
- **KIT** · 3 cargas · recon · objetivo: información. **HABILIDADES** · Recon Pulse
- **NÚMEROS** · **información 94**, la más alta del roster (el siguiente tiene 62) · utilidad 76 · iniciación 72
- **CORE FANTASY** · El que **mira**. No abre el sitio: dice qué hay dentro. Su valor es que,
  después de su pulso, el equipo deja de adivinar.
- **PERSONALITY** · Analítico, literal, incómodo con la ambigüedad. Da coordenadas y cantidades,
  no sensaciones. Repite el dato si nadie lo ha confirmado.
- **SILHOUETTE** · Media-alta y delgada, con una **asimetría inconfundible**: el antebrazo
  izquierdo es el doble de voluminoso que el derecho.
- **FACE / HEAD** · Visor monocular rígido sobre el ojo derecho, con el izquierdo descubierto.
  Rostro anguloso, mirada fija.
- **HAIR / HEADGEAR** · Pelo rapado a los lados, con la banda del visor cruzándole el cráneo.
- **BODY TYPE** · Alto, enjuto, de postura erguida y poco natural.
- **OUTFIT** · Chaleco plano de bolsillos finos sobre camisa técnica de manga larga. Nada
  abultado: lo único voluminoso es el brazo del instrumento.
- **SIGNATURE EQUIPMENT** · El **abanico de sonda**: tres antenas cortas plegadas sobre el
  antebrazo izquierdo que se abren en abanico. Mochila plana de sensores, sin volumen.
- **PRIMARY VISUAL MOTIF** · **La óptica.** Lentes, cristales, sensores. Superficies que miran.
- **COLOR IDENTITY** · `#19e3ff`, cian. Es la referencia cromática de su clase y sólo brilla en
  el cristal del visor y en las puntas de las antenas.
- **GLYPH RELATIONSHIP** · El sigilo es un **pulso que se abre en abanico** desde un punto: el
  abanico del antebrazo, visto de frente.
- **TACTICAL IDENTITY** · Lecturas e información para el *retake*. Sobrevive poco (44): no está
  para pelear, está para ver.
- **VISUAL DO** · Asimetría marcada · instrumentos identificables · postura de observación.
- **VISUAL DON'T** · No arco, no flechas, no bestias ni drones-animal. No un ojo gigante. No dos
  brazos iguales: la asimetría **es** el personaje.

---

### PULSE

- **NAME** · Pulse — **CODENAME** · `PLS` — **CLASS** · Iniciador
- **KIT** · 3 cargas · destello + recon · objetivo: cegar. **HABILIDADES** · Flashpoint, Recon Pulse
- **NÚMEROS** · iniciación 90 · utilidad 72 · entrada 66 · información 62
- **CORE FANTASY** · El que **abre la ventana**. Cuenta atrás, golpe, y durante un segundo y
  medio el sitio es del equipo. Pulse no entra el primero: hace que entrar sea posible.
- **PERSONALITY** · Cuenta en voz alta. Ordena el caos con ritmo —«tres, dos, uno, va»— y necesita
  que el equipo entre a su compás. Se frustra cuando alguien se adelanta.
- **SILHOUETTE** · Media y atlética, con el torso claramente adelantado: siempre a punto de salir.
- **FACE / HEAD** · Cabeza descubierta, sin nada que tape. Cara ancha, mandíbula marcada,
  protector bucal colgando del cuello.
- **HAIR / HEADGEAR** · Pelo corto y húmedo de sudor. Protectores de oído finos, tipo diadema baja.
- **BODY TYPE** · Media, musculada, de hombros redondos.
- **OUTFIT** · Peto de resonancia sobre malla técnica de manga corta; pantalón corto de
  competición con espinilleras. Es el que más se parece a un deportista de los diez.
- **SIGNATURE EQUIPMENT** · **Guanteletes de resonancia** gruesos y el **peto de nervaduras
  horizontales** que marca el latido. Tres cápsulas en el cinturón, una por carga.
- **PRIMARY VISUAL MOTIF** · **La onda concéntrica.** Nervaduras paralelas, anillos, cosas que se
  propagan desde un centro.
- **COLOR IDENTITY** · `#6ea8ff`, azul. En las nervaduras del peto y en el canto de los guanteletes.
- **GLYPH RELATIONSHIP** · El sigilo es un **latido que cruza** dentro de un círculo tenue: la
  línea del peto y el anillo de propagación.
- **TACTICAL IDENTITY** · Abre sitios. Su información es secundaria a su iniciación, y por eso su
  objetivo declarado es *cegar* y no *informar*.
- **VISUAL DO** · Horizontales · piel visible · sudor y desgaste de competición.
- **VISUAL DON'T** · No electricidad ni rayos (eso es Blitz). No casco. No confundir sus
  nervaduras con las placas repetidas de Echo: las de Pulse son **paralelas y del mismo tamaño**.

---

### SPEAR

- **NAME** · Spear — **CODENAME** · `SPR` — **CLASS** · Duelista
- **KIT** · 2 cargas · destello · objetivo: cegar. **HABILIDADES** · Breach Flash
- **NÚMEROS** · **entrada 94** · presión 82 · espacio 72 · supervivencia 30
- **CORE FANTASY** · El **primero por la puerta**. Se ciega a sí mismo el camino y entra. No
  espera a que otro abra: se abre él, y asume el precio.
- **PERSONALITY** · Disciplinado, seco, sin bravuconería. Trata la entrada como un oficio: repite
  el mismo gesto mil veces hasta que sale perfecto. No discute la llamada.
- **SILHOUETTE** · Alta, de hombros anchos y cintura estrecha, toda orientada hacia delante.
  **Nada le cuelga.**
- **FACE / HEAD** · Cara despejada, con protector nasal metálico fino. Ojos entrecerrados por
  costumbre de mirar hacia el destello.
- **HAIR / HEADGEAR** · Coleta corta, tirante. Sin casco.
- **BODY TYPE** · Alto y en forma de cuña: ancho arriba, estrecho abajo.
- **OUTFIT** · Peto acuñado en punta sobre mono oscuro ceñido. **Un solo hombro reforzado**, el
  izquierdo, gastado hasta el material base de tanto entrar de ese lado.
- **SIGNATURE EQUIPMENT** · Dos **cápsulas de destello** en soporte frontal, a la altura del
  esternón, donde la mano las alcanza sin mirar. Sin mochila.
- **PRIMARY VISUAL MOTIF** · **La línea que apunta.** Todo converge hacia delante; ni un elemento
  suelto que frene.
- **COLOR IDENTITY** · `#ff2e63`, el magenta de NEXUS. En el filo de la cuña del peto y en las
  cápsulas.
- **GLYPH RELATIONSHIP** · El sigilo es una **lanza con punta y astil**: su peto, de perfil.
- **TACTICAL IDENTITY** · Entry fragger que se abre con su propia utilidad. Sobrevive 30: está
  para gastarse, y eso es una decisión de diseño, no un defecto.
- **VISUAL DO** · Asimetría del hombro · desgaste concentrado en un lado · líneas convergentes.
- **VISUAL DON'T** · No lanza física en las manos —el nombre es el motivo, no el objeto—. No
  fuego, no aire, no cuchillos. No capa.

---

### BLITZ

- **NAME** · Blitz — **CODENAME** · `BLZ` — **CLASS** · Duelista
- **KIT** · 2 cargas · destello · objetivo: cegar. **HABILIDADES** · Breach Flash
- **NÚMEROS** · **presión 90** (el valor más alto del roster en ese eje) · entrada 86 · espacio 60 · supervivencia 26, la más baja de los seis agentes que la declaran
- **CORE FANTASY** · El que **no para**. Spear entra una vez y bien; Blitz entra cinco veces y no
  le importa perder cuatro. Su valor es que el rival nunca puede respirar.
- **PERSONALITY** · Impaciente, ruidoso, físico. Habla mientras corre. Lo que en otro sería
  imprudencia, en él es el plan.
- **SILHOUETTE** · **La más baja y densa de los diez.** Torso corto y cuadrado, centro de
  gravedad bajo, todo pegado al cuerpo.
- **FACE / HEAD** · **Casco integral con visor de una pieza**, el único totalmente cubierto —y
  por eso el contraste de la mandíbula vista en el resto del roster funciona—. Se le ve media
  cara reflejada en el propio visor.
- **HAIR / HEADGEAR** · Casco corto y redondo, sin crestas ni antenas.
- **BODY TYPE** · Bajo, ancho, compacto.
- **OUTFIT** · Placas cortas y superpuestas como escamas en torso, antebrazos y espinillas,
  pensadas para cambiar de dirección sin engancharse.
- **SIGNATURE EQUIPMENT** · Dos **cápsulas de destello** en los antebrazos, integradas en la
  placa, no en un cinturón: las lanza sin bajar las manos.
- **PRIMARY VISUAL MOTIF** · **El quiebro.** Formas cortas superpuestas, ángulos, nada largo.
- **COLOR IDENTITY** · `#ff7a3d`, naranja. En el borde de cada placa, como una línea de corte.
- **GLYPH RELATIONSHIP** · El sigilo es un **rayo quebrado**: la lectura de su silueta y de su
  forma de moverse.
- **TACTICAL IDENTITY** · Presión constante y duelos rápidos. Es el que menos sobrevive, y el
  diseño lo dice sin disculparse.
- **VISUAL DO** · Placas cortas · ángulos · centro de gravedad bajo.
- **VISUAL DON'T** · No explosivos ni pirotecnia. No alto y esbelto: si Blitz y Spear se
  confunden en silueta, el trabajo está mal hecho.

---

### WARDEN

- **NAME** · Warden — **CODENAME** · `WRD` — **CLASS** · Centinela
- **KIT** · 3 cargas · cobertura + incendiaria · objetivo: negar. **HABILIDADES** · Trapwire, Incendiary
- **NÚMEROS** · **ancla 90** · supervivencia 82 · retake 76 · post-plant 70
- **CORE FANTASY** · El que **no se mueve**. Un sitio con Warden dentro no se toma barato. No
  persigue, no rota: ocupa, y lo que ocupa deja de estar disponible.
- **PERSONALITY** · Paciente hasta lo exasperante. El veterano del roster. Habla en frases
  completas y tranquilas incluso perdiendo. Es a quien llama el equipo cuando se rompe el plan.
- **SILHOUETTE** · **La más voluminosa.** Hombreras cuadradas, placa frontal de una pieza, cuello
  alto. Ocupa el doble de ancho que Specter.
- **FACE / HEAD** · Casco abierto por arriba con **mandíbula cerrada**: se le ven los ojos y la
  frente, nunca la boca. Mirada baja.
- **HAIR / HEADGEAR** · Casco de media cara, con el borde interior acolchado y deformado por el
  uso.
- **BODY TYPE** · Grande, pesado, de piernas plantadas.
- **OUTFIT** · Placa frontal continua, sin huecos ni costuras visibles, sobre acolchado grueso.
  Todo liso: no hay dónde engancharse.
- **SIGNATURE EQUIPMENT** · Tres **módulos de cierre** cúbicos anclados al cinturón trasero, que
  se dejan en el suelo. Sin mochila: lo que lleva, lo planta.
- **PRIMARY VISUAL MOTIF** · **La superficie continua.** Grandes planos sin interrupción; lo
  contrario de las placas cortas de Blitz.
- **COLOR IDENTITY** · `#3fc07a`, verde. En la junta perimetral de la placa frontal, como una
  línea de sellado.
- **GLYPH RELATIONSHIP** · El sigilo es un **escudo con cerrojo**. Su placa frontal es ese
  escudo; el cerrojo son los módulos.
- **TACTICAL IDENTITY** · Ancla, retake e información defensiva. El único del roster que combina
  supervivencia alta con utilidad alta.
- **VISUAL DO** · Planos grandes · simetría · peso visible · desgaste de rozamiento.
- **VISUAL DON'T** · No robots, ni torretas, ni ayudantes mecánicos. No cura a nadie. No muros de
  energía: lo suyo es materia.

---

### TRIPWIRE

- **NAME** · Tripwire — **CODENAME** · `TRP` — **CLASS** · Centinela
- **KIT** · 3 cargas · incendiaria + cobertura · objetivo: negar. **HABILIDADES** · Incendiary, Trapwire
- **NÚMEROS** · ancla 86 · **post-plant 82** · supervivencia 72 · utilidad 66
- **CORE FANTASY** · La que **prepara el terreno antes**. Warden ocupa con el cuerpo; Tripwire
  ocupa con el trabajo hecho media hora antes. Cuando la ronda empieza, su parte ya está puesta.
- **PERSONALITY** · Práctica, obsesiva con los detalles, de humor seco. Llega la primera y se va
  la última. Lleva las manos siempre ocupadas.
- **SILHOUETTE** · Media y enjuta, **siempre algo agachada**, con el peso hacia delante como
  quien está colocando algo.
- **FACE / HEAD** · Cara entera y concentrada, con marcas de las gafas alrededor de los ojos.
  Guantes finos y dedos manchados.
- **HAIR / HEADGEAR** · Gafas de trabajo subidas a la frente, con la goma dada de sí. Pelo corto
  y desordenado.
- **BODY TYPE** · Media, delgada, de manos grandes.
- **OUTFIT** · Chaleco de bolsillos planos y numerados —numerados por ella, no por un
  fabricante—, pantalón con refuerzos en las rodillas de arrodillarse mil veces.
- **SIGNATURE EQUIPMENT** · **Carretes de cable** en caderas y muslos, con el hilo fino visible
  saliendo de dos de ellos, y anclas cortas colgadas del cinturón.
- **PRIMARY VISUAL MOTIF** · **La tensión entre dos puntos.** Hilos rectos y tensos; todo lo suyo
  une un sitio con otro.
- **COLOR IDENTITY** · `#7fd44f`, verde-lima. En el propio hilo y en la marca de los carretes.
- **GLYPH RELATIONSHIP** · El sigilo es un **cable tenso entre dos anclas**: literalmente su
  equipo, reducido a su forma mínima.
- **TACTICAL IDENTITY** · Trampas, negación de espacio y post-plant. El mejor del roster después
  del plantado.
- **VISUAL DO** · Hilos rectos · herramientas gastadas · postura de trabajo.
- **VISUAL DON'T** · No cámaras espía ni vigilancia (eso la acercaría a Probe). No voluminosa: si
  se confunde con Warden, se ha perdido el par.

---

### SPECTER

- **NAME** · Specter — **CODENAME** · `SPC` — **CLASS** · Flexible
- **KIT** · 2 cargas · recon + humo · objetivo: información. **HABILIDADES** · Ghost Recon, Phantom Veil
- **NÚMEROS** · **lurk 92** — el segundo del roster en ese eje tiene 30 · rotación 76 · supervivencia 72
- **CORE FANTASY** · El que **no está donde parece**. Specter juega solo, por detrás, y su arma
  es que el rival tenga que dedicarle atención sin saber dónde gastarla.
- **PERSONALITY** · Silencioso y paciente; el que menos habla de los diez. Cuando habla, el
  equipo para. Tiene un humor muy seco que casi nadie pilla.
- **SILHOUETTE** · Alta y ligera, de brazos largos. **Sobrecapa sin mangas con faldón partido**
  que se abre en dos al caminar.
- **FACE / HEAD** · Pañuelo alto que cubre la barbilla y la boca; ojos descubiertos y quietos.
- **HAIR / HEADGEAR** · Pelo largo recogido hacia atrás, pegado. Sin casco ni gafas.
- **BODY TYPE** · Alto, delgado, de paso largo.
- **OUTFIT** · Sobrecapa ligera sin mangas sobre ropa oscura ajustada. Nada que haga ruido:
  cierres de tela, sin metal a la vista.
- **SIGNATURE EQUIPMENT** · **Las manos vacías.** Es el único del roster sin equipo visible en
  las manos; sus dos cargas van a la espalda, planas, bajo la capa. El vacío ES la firma.
- **PRIMARY VISUAL MOTIF** · **El desfase.** El contorno se repite una vez, desplazado y mucho más
  tenue, como una figura que no acaba de estar donde parece.
- **COLOR IDENTITY** · `#cbb26a`, latón apagado. En el broche de la capa y en el borde del
  pañuelo. Es el acento más discreto de los diez, a propósito.
- **GLYPH RELATIONSHIP** · El sigilo es **una silueta que se duplica**, una al 40 %: el desfase,
  dibujado.
- **TACTICAL IDENTITY** · Lurker de flanco y de *timings*. Su humo no tapa: engaña.
- **VISUAL DO** · Telas silenciosas · manos vacías · repetición tenue del contorno.
- **VISUAL DON'T** · No teletransporte, no clones, no dobles espectrales sólidos. No ninja. No
  confundir su capa con la de Veil: la de Specter es **ligera, sin mangas y partida**.

---

### ECHO

- **NAME** · Echo — **CODENAME** · `ECO` — **CLASS** · Flexible
- **KIT** · 3 cargas · destello + humo + recon · objetivo: estancar. **HABILIDADES** · Decoy Flash, Phantom Veil, Ghost Recon
- **NÚMEROS** · **engaño 86** · rotación 72 · utilidad 62. **El kit más variado del roster:** tres mecánicas distintas.
- **CORE FANTASY** · El que **se convierte en lo que falta**. Echo no tiene un papel: tiene el
  papel que la composición necesita esa ronda. Su firma es la repetición: hace que una cosa
  parezca cinco.
- **PERSONALITY** · Sociable, adaptable, buen lector de sala. Es el pegamento del equipo y el que
  traduce entre Pulse y Specter. No tiene ego sobre su propio papel.
- **SILHOUETTE** · Media, equilibrada y **visiblemente cargada**: es quien más cosas lleva encima.
- **FACE / HEAD** · Cara entera, gesto abierto. Auriculares de diadema sobre un gorro corto de
  punto —la única pieza de ropa no técnica del roster—.
- **HAIR / HEADGEAR** · Gorro corto; el pelo asoma por debajo.
- **BODY TYPE** · Media, normal, sin extremos. Su neutralidad física es intencionada.
- **OUTFIT** · **Arnés de cinco puntos** con módulos repetidos, **mangas asimétricas** —una larga,
  una corta—, y capas de ropa de distintos lotes, como quien ha ido sustituyendo piezas.
- **SIGNATURE EQUIPMENT** · Los **módulos repetidos a tres tamaños** —grande, mediano, pequeño—
  alineados en el mismo eje del arnés: tres cargas, tres mecánicas, tres tamaños.
- **PRIMARY VISUAL MOTIF** · **La repetición a distinta escala.** La misma forma, tres veces, cada
  vez menor.
- **COLOR IDENTITY** · `#ffd35c`, oro. En los tres módulos, con el brillo decreciendo del grande
  al pequeño.
- **GLYPH RELATIONSHIP** · El sigilo son **cinco verticales que menguan hacia fuera** desde la
  central, cada una más tenue que la anterior: los módulos vistos de frente, y el eco que da
  nombre al agente.
- **TACTICAL IDENTITY** · Fakes y adaptación. Su objetivo declarado es *estancar*: gana tiempo,
  no espacio.
- **VISUAL DO** · Tríadas · asimetría de mangas · mezcla deliberada de lotes.
- **VISUAL DON'T** · No sonido dibujado ni ondas visuales (eso es Pulse). No genérico por ser
  «el flexible»: su neutralidad de cuerpo se compensa con el equipo más característico de los diez.

---

## 4 · Qué se entrega por agente

Contrato completo en `src/agents/visuals.ts` (`AGENT_ART_CONTRACT`). Resumen:

| Pieza | Proporción | Máster | Encuadre | Peso máx. |
|---|---|---|---|---|
| `avatar` | 1:1 | 256 × 256 | cabeza y hombros; ojos en el tercio superior | 40 KB |
| `portrait` | 3:4 | 480 × 640 | cara y torso superior, corte a media caja torácica | 90 KB |
| `portrait-large` | 3:4 | 960 × 1280 | **el mismo** encuadre, al doble de resolución | 220 KB |
| `fullbody` | 3:5 | 720 × 1200 | silueta completa con pies y 4 % de margen inferior | 260 KB |

Formato **WEBP con alfa real**, sin fondo. Ruta: `/public/agents/<id>/<variante>.webp`.

**Prohibido dentro del arte:** texto, nombre, clase, números, logotipos, marcos, fondos,
degradados de interfaz y cualquier elemento de UI. Todo eso lo pone el producto.

---

## 5 · Estado de producción

**Fase 48B · Veil producido como Golden Sample, pendiente de aprobación humana.**
`/public/agents/veil/portrait.webp` (480 × 640) y `avatar.webp` (256 × 256), publicados en
`published`. Máster y pipeline reproducible en `docs/product/art/veil/`; informe en
`docs/product/fase-48b-veil-golden-sample-report.md`. Los otros nueve siguen con su sigilo, que
es una identidad de pleno derecho y no un hueco.

**Fase 48C · Veil V2, candidato para aprobación visual.** Sustituye a V1 en `/public` (mismas
rutas); V1 se conserva en `docs/product/art/veil/v1/` y su máster en
`docs/product/art/veil/veil-master-960x1280.webp`. Informe:
`docs/product/fase-48c-veil-v2-report.md`. Corrige las desviaciones de V1: sin micrófono (NO es
canon), cuello alto técnico sin solapas ni cremallera, cicatriz de quemadura curada y visible,
parte superior de la cara dominada por la sombra de la capucha. Lenguaje del glifo en el traje:
**yugo recto sobre el hombro derecho del que cuelgan pliegues verticales con la punta ribeteada en
`#8b7bf0`** — la barra y los velos del sigilo. Los cuatro cartuchos son módulos de tapa plana con
anillo en la junta. Publicar arte es dejar el fichero en su carpeta y añadir la variante a `published`
en `AGENT_IDENTITY`: ninguna pantalla cambia.

El orden de producción es **Veil primero**, como muestra patrón que fija estilo, luz, encuadre,
nivel de detalle y tratamiento de fondo. Hasta que Veil esté aprobado en las cuatro superficies
—roster, los cinco huecos, Plan Táctico y Presentar—, no se produce ningún otro.
