# FASE 68 · CLOSED BETA 5.0 — Journeys de jugador reales · QA longitudinal · Validación de producto

**Veredicto: GO para la beta cerrada.** Un jugador nuevo completa la primera sesión, vuelve y sigue progresando; el ranked aguanta varias partidas seguidas; sobres, tienda, inventario, colección y libro cuadran; no hay fugas entre cuentas.

- **Bugs:** 14 hallados. 0 BLOCKER, 0 CRITICAL.
  - 1 MAJOR arreglado.
  - 1 MAJOR abierto, bloqueado por una decisión de economía explícita (F57.6 congelada).
  - 7 MINOR arreglados.
  - 2 POLISH arreglados y 3 abiertos.
- **Qué no se ha hecho:** sin deploy, DNS, SMTP externo, migraciones ni commit. Tu cuenta tiene 0 escrituras.
- **Evidencia:** `docs/product/qa/fase68-beta/` (35 JSON + `raw/` + 210 capturas).
- **Runbook:** `docs/operations/drlcards-closed-beta.md` + plantilla de feedback.

## Matriz de la beta

| Recorrido | Estado | Evidencia clave |
|---|---|---|
| Jugador nuevo (primera sesión F63) | **PASS** tras F68-001 | 6 cuentas nuevas. Guía de 80–92 s automatizada, sin rodeos, desde F. |
| Primeros 30 minutos | **PASS** | Portada sin guía. JUGAR → Partida rápida → resultado con 4 salidas. Reclamos → colección → tienda. |
| Vuelta (otra sesión) | **PASS** | Sin guía forzada ni starter duplicado. HUD = servidor. 0 escrituras al mirar. |
| Casual (PvE, sobres, tienda, colección) | **PASS** | 8 PvE en 3 dificultades, con victorias y derrotas. Compra, saldo insuficiente, doble clic. |
| Competitivo (ranked) | **PASS** | 8 partidas en 3 tandas. Elo movido una vez por partida. Delta negativo bien pintado. Historial. |
| Explorador (Draft, Coach, Pick'ems, social, perfil) | **PASS** con F68-010 abierto | Draft con victoria y derrota. Coach completo con historial. Predicción real. Amistad. |
| Equipos | **PASS** | Incompleto explicado. Autocompletar, activar, cambiar, F5 y doble guardado. |
| Progresión y reclamos | **PASS** tras F68-008 | Reclamar, revisitar sin re-pago, 409 al repetir por API, temporada, logros. |
| Móvil 390 / tablet 1024 / escritorio 1440 | **PASS** | B y G en 390 (G y D con movimiento reducido), D en 1024, A/C/E/F/H/I/J en 1440. |
| Teclado, red lenta, F5, doble clic, atrás, multipestaña, sesión larga | **PASS** tras F68-002/003/007 | Ver puntos 36–42. |
| Cambio de cuenta / fugas | **PASS** | A→B→A y C→F→C: HUD, nombre, equipos y localStorage limpios. |
| Libro, inventario, cartas, progresión | **PASS** | 10/10 cuentas conciliadas (SQL de solo lectura). |
| Integridad, seguridad, production:check, smoke | **PASS** | 0 anomalías · 22/22 · 24 PASS + 1 FAIL externo · 67/67. |

## Informe (1–99)

### Línea base y alcance

1. **Línea base** (`baseline.json`):
   - 5.334 tests verdes, 331 cartas, 29 agentes, cabeza de migraciones 0057, Next 16.3.6.
   - Mercado y pagos OFF. Solo `127.0.0.1:3005`.
   - `production:check`: 24 PASS, 1 FAIL (backup-offsite). Smoke 67/67.
   - Build de partida: `drl-0.1.1-1-abdcaffc`.
2. **Personas** (`personas.json`):
   - **A** — Nuevo, 1440.
   - **B** — Casual, móvil 390.
   - **C** — Competitivo, 1440.
   - **D** — Explorador: tablet 1024 con movimiento reducido; se saltó el tutorial.
   - **E** — Returning: cuenta QA de F63 con historial.
   - **F** y **G** — Nuevos de la Ronda 2 (G en 390 reducido).
   - **H**, **I** y **J** — Cuentas nuevas finales (J sobre la build definitiva).
3. **Cuentas de la beta:** 10 (9 nuevas por `/cuenta` y 1 reutilizada). Credenciales solo en el scratchpad; en la evidencia, solo el prefijo del id.
4. **Sesiones:** 52 sesiones instrumentadas, más sondas y diagnósticos. Cada una en un navegador nuevo, con login por formulario.
5. **Acciones de jugador:** 2.413 (clics, teclas y navegaciones del arnés).
6. **Partidas:** 42 en total.
   - 28 PvE (pagadas en el libro).
   - 8 ranked.
   - 3 Draft Gauntlet.
   - 3 Tactical Coach.
7. **Sobres abiertos:** 44 (`open_pack` = `user_game.packs_opened` en cada cuenta).
8. **Compras en tienda:** 12 `buy_pack`. Incluye los 2 cobros dobles de F68-002 antes del arreglo: fueron compras reales y quedaron apuntadas en el libro.

### Recorridos

9. **Jugador nuevo** (`new-player.json`):
   - Registro real → bienvenida → EMPEZAR → sobre Bronce → primera carta → colección → Iniciales → primer equipo (orden del servidor) → primera partida contra el bot, con F5 a mitad → resultado → progreso → SEGUIR JUGANDO.
   - En la Ronda 1 se atascaba en el segundo Sobre Inicial (**F68-001**).
   - Tras el arreglo: 86–92 s y 14–16 pasos automatizados, en F, G, H, I y J.
10. **Primeros 30 minutos:**
    - La portada ya no enseña la guía. JUGAR lleva al hub de modos.
    - Partida rápida → preparación con el equipo activo y las tres dificultades → segunda partida → resultado con «Jugar otra / Cambiar rival o equipo / Ver la partida / Mis equipos».
    - La portada avisa de recompensas (`home-claimable`) → Progreso → Reclamar todo → colección, inventario y tienda.
    - En ningún punto faltó un siguiente paso visible.
11. **Vuelta** (`returning-player.json`, E ×4):
    - Login por formulario, sin guía forzada en `/`, `/progresion`, `/coleccion`, `/jugar` ni `/temporada`.
    - `starter` idéntico antes y después: sin Sobre Inicial duplicado.
    - HUD igual al servidor. 0 escrituras.
12. **Casual** (`casual.json`, B en 390):
    - 8 PvE en tres sesiones: Fácil, Normal y Difícil, con victorias y derrotas.
    - «Jugar otra», «Cambiar rival», volver a la portada y re-entrar, con F5 en el resultado y a mitad de partida.
    - Sobres, tienda, colección y progresión.
13. **Competitivo** (`competitive.json`):
    - C construye y activa equipos y juega 8 ranked contra E (1440 frente a 390 reducido) en tres tandas.
    - Deltas ±15…±21, colocación «n/10» y puesto en la escalera.
14. **Explorador** (`explorer.json`, D):
    - Se salta el tutorial. JUGAR sin equipo lleva a «Mis equipos» con «Consigue cartas / Crea tu equipo» y llega a equipo válido por la interfaz.
    - Draft, Coach, Pick'ems, perfil y social.
    - Navegación con atrás, adelante, F5 y URL directas.
    - 404 e ids inválidos: siempre con salida.
15. **Sobres** (`packs.json`):
    - Inventario → abrir, con doble clic en ABRIR, F5 en plena ceremonia y atrás tras abrir.
    - Siempre +1 en `packsOpened`: sin reaperturas ni restos de animación (medido: la capa de salida desaparece a los 2 s).
    - La colección se refresca al volver.
16. **Tienda** (`store.json`):
    - Modal con precio, saldo y «Después», y «Confirmar · 1.000».
    - Tras comprar: «Sobre añadido… Saldo: …», «Abrir ahora» abre ese sobre y el saldo baja exactamente el precio.
    - Saldo insuficiente: «te faltan 1.690 / 3.420 DRL Credits», botón desactivado, sin cambios en saldo ni en inventario y nunca negativo.
    - Doble clic: cobraba 2 en la misma tarea (**F68-002**); tras el arreglo cobra 1.
17. **Colección** (`collection.json`, 390):
    - Filtros «Poseídas», orden (6 criterios) y búsqueda. Viven en la URL y «atrás» los restaura.
    - El detalle de carta aguanta F5.
    - Álbum y sets. Carga en unos 2,1 s. Datos al día tras abrir sobres.
18. **Equipos** (`teams.json`):
    - Guardar incompleto (1/10) está permitido y explica «Solo un equipo completo y legal puede ser el activo», sin código crudo.
    - Autocompletar, guardar, activar, cambiar una carta y F5 persisten.
    - Doble guardado de un equipo nuevo creaba dos (**F68-003**); arreglado.
19. **Autoequipo:**
    - Válido (10/10), se guarda y se puede activar desde el constructor y desde «Crear mi primer equipo».
    - Su calidad sigue siendo la de F65 (no óptima): no se tocó.
20. **PvE** (`pve.json`):
    - Resultados reales, sin forzar: por ejemplo Fácil 6–5, Normal 7–3 y Difícil 2–8.
    - Pagos por partida: victoria +120/+220, derrota +40/+60 según dificultad; F5 no vuelve a pagar.
    - Sin partida viva al terminar.
21. **Ranked** (`ranked.json`):
    - Cola desde `/competitivo`, emparejamiento en 3–13 s y partida por la interfaz en los dos clientes.
    - Resultado en ambas interfaces y Elo movido una sola vez y coherente con `outcome`.
    - «Buscar otro rival» encadena la siguiente partida.
    - Unas 38 peticiones PvP por partida y cliente (F66: 39–47). 0 errores de consola, 0 × 4xx/5xx.
22. **Progresión** (`progression.json`):
    - Las misiones avanzan con acciones reales: duelos, sobres, cartas y una predicción (d-pickem-1, 0 → 1).
    - Reclamar paga XP de temporada y créditos; la XP de cuenta sube jugando y abriendo sobres.
23. **Reclamos:**
    - «Reclamar todo» cobra en serie. El diálogo lista lo recogido con «Abrir sobre» y «Seguir».
    - Revisitar no re-paga. Por API, repetir da 409 «Misión ya reclamada».
    - El HUD no se actualizaba hasta recargar (**F68-008**); arreglado.
24. **Subida de nivel:**
    - Real en el recorrido, sin fixture: cuenta del nivel 3 al 4–5, y temporada al nivel 2–4 a base de reclamar.
    - Se ve en la barra de nivel del resultado (XP +25/+60, «196 / 277 XP») y en el HUD.
    - Persistencia verificada en `profiles.xp` y en el pase.
25. **Temporada:** `/temporada` con nivel, siguiente recompensa («Nivel 5 · Sobre Bronce + 600»), carril libre/competitivo (bloqueado <400 puntos) y misiones. Sin modificar nada.
26. **Logros:**
    - Progreso correcto (por ejemplo «Abrir 100 sobres» 3/100, «Coleccionista» 15/40).
    - Uno completado de verdad: «Consigue una leyenda» (I sacó una carta legendaria), cobrado una vez.
    - 0 logros reclamados sin completar (conciliación).
27. **Perfil:** `/jugador/<id>` refleja nivel, ranked (provisional/colocación y rating), temporada, colección y vitrina; `/cuenta` igual.
28. **Draft** (`draft.json`):
    - Entrada, elección con confirmación, «Jugar combate 01», partida, resultado y «Volver al gauntlet».
    - Retoma la run a medias y la partida en curso.
    - Victoria y derrota. Sin movimientos económicos (F39).
29. **Tactical Coach** (`coach.json`):
    - Quick Play: 5 agentes reales con su arte (F59), mapa automático y partido interactivo (plan → compra → ronda en vivo a 8× → decisiones → siguiente ronda) hasta el resultado.
    - Se registra en el historial.
    - Hallazgos:
      - F68-005 (404 de retratos, arreglado).
      - F68-006 (copia de derrota, arreglada).
      - **F68-010** (recompensa solo local, abierto).
      - F68-011 y F68-012 (POLISH).
30. **Pick'ems** (`pickems.json`):
    - Evento activo (Champions 2026, 15 predicciones pendientes).
    - Predicción real por la interfaz (G2 Esports), sigue marcada tras F5 y hace avanzar la misión diaria.
    - No se tocó worker, cron ni scoring.
31. **Navegación:**
    - Atrás, adelante, F5 y URL directas en 8 rutas: sin desbordes ni imágenes rotas.
    - 404 con «VOLVER AL JUEGO».
    - Ids inválidos de repetición, jugador, carta, sobre y partida con salida.
    - El detalle de partida ranked mal formado decía «Algo ha fallado» (**F68-014**); ahora «Partida no encontrada».
32. **Móvil 390** (`mobile.json`): sesiones completas e interactivas de B (primera sesión, PvE, tienda, colección, equipos, progresión) y G (primera sesión, red lenta, multipestaña).
33. **Tablet 1024** (`tablet.json`): D completo (equipos, explorador, Draft, Pick'ems, progresión) con movimiento reducido.
34. **Escritorio 1440** (`desktop.json`): A, C, E, F, H, I y J.
35. **Movimiento reducido:** D (1024) y G (390) en todas sus sesiones, más E en los ranked a 390. Tu Chrome reporta `reduce`, así que esta es tu experiencia real.

### Hábitos de jugador

36. **Teclado:**
    - Login solo con Tab + Enter. Foco visible en la portada. Enter en JUGAR navega.
    - Modal de tienda: foco dentro y atrapado; Escape cierra y devuelve el foco a «Comprar».
    - Búsqueda en colección por teclado. Acciones de equipos alcanzables con Tab.
37. **Red lenta** (`slow-network.json`, 400 ms + 1,5 Mbps):
    - Las 5 pantallas cargan (portada unos 0,9–1 s, progresión unos 2 s) y la partida se completa.
    - Sin red, la colección muestra su modo sin conexión y se recupera al volver.
38. **F5:** en la bienvenida, en la ceremonia, a mitad de partida (se recupera), en el resultado (no re-paga), en el detalle de carta, en el constructor y en Pick'ems. Sin acciones duplicadas.
39. **Doble clic:**
    - Humano (60 ms, CDP): compra y guardado salen una vez.
    - En la misma tarea: compra y guardado salían dos veces (F68-002 y F68-003); arreglado.
    - Reclamar, abrir y jugar: una vez.
40. **Atrás del navegador:** tras abrir un sobre, desde el detalle de carta (restaura filtros) y en el historial. Sin estado roto.
41. **Varias pestañas** (`multitab.json`):
    - La colección se refresca al navegar.
    - El saldo de la 2.ª pestaña se quedaba viejo (**F68-007**); ahora se pone al día al volver a ella.
42. **Sesión larga:**
    - 40 navegaciones internas y 2 partidas en la misma página: heap 10 → 14 MB, oyentes +91.
    - 0 avisos duplicados, 0 `<audio>` acumulados. La sesión sigue autenticada (200).
43. **Logout/login:** el logout limpia el HUD y el login recupera todo (saldo, equipos, progreso).
44. **Cambio de cuenta** (`account-switch.json`): A→B→A y C→F→C en el mismo navegador. HUD, nombre en `/cuenta`, equipos, inventario y progresión cambian.
45. **Fuga entre cuentas:** 0. Ni el id, ni el nombre, ni los equipos de la cuenta anterior aparecen en localStorage ni en pantalla, en ninguno de los dos sentidos.
46. **Estados vacíos:** «No tienes nada pendiente de recoger», inventario sin sobres, Coach con historial 0, ranked «Sin clasificar», social sin amigos y «Todavía no tienes ningún equipo». Todos con un siguiente paso.
47. **Estados de error:**
    - Red caída (modo sin conexión), URL inválidas (salida siempre).
    - Acciones caducadas: reclamo repetido 409 con mensaje; partida PvE y versión vieja cubiertas por F66/F67.
48. **Errores de auth:**
    - Contraseña mala y correo inexistente dan el mismo mensaje. Registro con correo existente.
    - Enlace de recuperación caducado (**F68-009**).
    - Los textos crudos de GoTrue en inglés (**F68-004**) están arreglados.
    - Correo real: **BLOCKED** (no hay SMTP; no se intentó).

### Bugs

49. **Por severidad** (`bugs.json`): BLOCKER 0 · CRITICAL 0 · MAJOR 2 · MINOR 7 · POLISH 5.
50. **BLOCKER:** 0 arreglados, 0 abiertos.
51. **CRITICAL:** 0 arreglados, 0 abiertos.
52. **MAJOR:** 1 arreglado (F68-001) y 1 abierto (**F68-010**, bloqueado por una decisión de economía explícita).
53. **MINOR:** 7 arreglados (F68-002, 003, 004, 005, 007, 008, 009), 0 abiertos.
54. **POLISH:** 2 arreglados (F68-006, 014) y 3 abiertos (F68-011, 012, 013).
55. **Los más importantes:**
    - **F68-001:** la guía de la primera sesión se atascaba en el segundo Sobre Inicial; era un callejón sin salida en el recorrido principal.
    - **F68-010:** el Coach promete créditos y nivel que no existen en el servidor.
    - **F68-002:** cobro doble posible.
    - **F68-008:** el HUD mentía tras reclamar.
56. **Causas raíz:**
    - F68-001: un enlace a la URL actual no vuelve a montar la página en Next. Además, el instrumento de F63 navegaba por URL en vez de pulsar el botón.
    - F68-002 y F68-003: guardias con estado de React (asíncrono), más una clave de idempotencia nueva por llamada.
    - F68-004: `error.message` crudo.
    - F68-005: se pedía siempre el PNG por defecto; no hay retratos publicados.
    - F68-007 y F68-008: el saldo vive en el store de juego y solo se resincronizaba al cargar.
    - F68-009: nadie leía el error de GoTrue en la URL.
    - F68-010: la simulación corre en el cliente y el servidor no puede verificarla (preexistente).
57. **Ronda 1** (`round1.json`): 30 sesiones (incluido el primer ranked C–E) sobre la build de partida y la primera build con arreglos. Se encontraron F68-001 a 007, 010, 011, 012, 013 y 014.
58. **Ronda 2** (`round2.json`, 21 sesiones): se repitieron los recorridos principales (dos cuentas nuevas en 1440 y 390 reducido, vuelta, PvE, ranked, explorador, teclado, red lenta, multipestaña y cambio de cuenta) tras los arreglos. Salieron F68-008 y F68-009, se arreglaron y se volvió a verificar.
59. **Cuenta nueva final:**
    - H (tras 001–008), I (tras todos los arreglos) y **J sobre la build definitiva `drl-0.1.1-1-9792433c`**.
    - Guía completa sin rodeos (86–87 s), 2 partidas, reclamos con el HUD al día (7.265 / 19.790 / 12.025 = servidor), colección y tienda.
    - 0 FAIL.
60. **Cuenta que vuelve, pasada final:** E ×2 sobre la build final. 10/10 PASS.
61. **Ranked final:** C contra E, 2 partidas (+17/−17 y +15/−15). 8/8 PASS.

### Consistencia

62. **Libro** (`ledger-reconciliation.json`): 10/10 cuentas. Inicial + ganado + gastado = saldo final. Cadena `balance_after` continua, ningún saldo negativo, 0 claves repetidas.
63. **Inventario** (`inventory-reconciliation.json`):
    - 10/10 cuentas: alta (3 Iniciales + 1 Bronce) + compras + sobres de recompensa − aperturas = `user_packs`.
    - Aperturas: `economy_ops` = `user_game.packs_opened`.
    - 0 cartas ajenas en equipos. Cartas en BD = cartas en `/state`.
64. **Progresión:** 0 misiones y 0 logros reclamados sin completar. Las misiones avanzan exactamente con las acciones hechas.
65. **Integridad de datos** (`integrity.json`, auditoría de F67 en sesión read-only):
    - 14/14 checks a 0 y admins = 1.
    - Tablas públicas: 122 (sin cambios).
    - Usuarios de auth: 18 → 27 (+9 QA).
66. **Smoke de seguridad** (`security-smoke.json`): **22/22**.
    - Cruce PvE, repetición ajena e IDOR ranked: 404 idéntico al de una partida inexistente.
    - Admin: 401/404.
    - Recompensas falsas (misión, logro, nivel 30) → 409.
    - Precio y créditos enviados por el cliente → 400. Sobre que no se tiene → 409.
    - REST directo a 7 tablas privadas de otro usuario → 0 filas. Nada cambió en ninguna cuenta.

### Gates y operación

67. **production:check** (`production-check.json`): **24 PASS · 0 WARN · 1 FAIL**.
    - El FAIL es `backup-offsite`, bloqueo externo conocido.
    - La build `drl-0.1.1-1-9792433c` coincide con la huella del código actual.
68. **smoke:production:** **67/67 OK**.
69. **Presupuesto de peticiones** (`performance.json`): **9,4 API por pantalla** en las 22 rutas de F64 (F64: 9,3 · F67: 9,5). Portada: 6. 0 × 429, 0 × 5xx.
70. **Errores de consola:** 0 sin explicar. Los 49 registrados los provocaron las pruebas:
    - 400/422 de GoTrue en las sondas de auth.
    - `ERR_INTERNET_DISCONNECTED` en el corte de red.
    - 404/400 de URL inválidas.
    - 5 × 404 de retratos antes de F68-005.
    - Journeys normales: 0.
71. **404:** 0 recursos internos perdidos tras F68-005. Antes: hasta 212 por partido del Coach.
72. **5xx:** 0. Logs del servidor limpios en las 4 builds; ningún 5xx en el Resource Timing de las 52 sesiones.
73. **Rendimiento:**
    - Apertura de sobre: 2,9–4,3 s de ceremonia.
    - Colección: unos 2,1 s. Progresión: unos 2 s con red lenta.
    - Cola ranked: 2,9–13 s.
    - PvE: 26–36 s por partida (automatizada). Coach: unos 2–3,5 min a 8×.
    - Carga de pantallas (Resource Timing): 33–151 ms tras el primer acceso.
74. **Callejones sin salida:** 0 en el recorrido principal tras F68-001. Todas las pantallas inválidas tienen salida (comprobado también `/abrir/no-existe`: «Ver sobres / Ver mi inventario»).
75. **Puntos de fricción** («¿y ahora qué?», solo lo observado):
    - F68-001 (resuelto).
    - Enlace caducado sin explicación (resuelto).
    - Dos CTA en la compra del Coach (F68-012).
    - Dos «rangos» distintos (F68-013).
    - «Te enviamos un enlace» sin SMTP real (limitación).
    - Resuelto por la interfaz (PASS): tras saltar el tutorial, tras terminar la guía, sin equipo, sin sobres, sin recompensas.
76. **Evidencia de balance** (sin parche):
    - Coach Normal con decisiones al azar: 0–13 y 1–13.
    - PvE Difícil gana con claridad a un casual (2–8, 3–7).
    - Autocompletar válido pero no óptimo.
    - Coherente con F65 P-1…P-4, que siguen sin aplicar.
    - Economía (anotado, sin tocar): un Sobre Inicial puede traer una legendaria y el logro paga 10.000 en la primera sesión.

### Estado de lo que no se toca

77. **0058:** sigue **PROPUESTA, no aplicada**. Exposición actual medida: `profiles` es legible por anónimos con todas sus columnas (`avatar, collection_value, created_at, credits, distinct_cards, equipped, id, is_admin, last_seen_at, level, market_volume, packs_opened, points, rarest_rank, region, taxes_paid, tokens, updated_at, username, xp`). Es el RLS-1 de F67; ninguna explotación nueva cambia su gravedad.
78. **Bloqueos públicos:** copia externa de backups, dominio + HTTPS, SMTP real + callbacks de GoTrue, commits/estado reproducible y la decisión sobre 0058.
79. **Limitaciones de la beta cerrada** (`known-issues.json` y runbook):
    - Correo sin entrega real.
    - El registro revela si un correo existe (GoTrue con autoconfirmación).
    - Una instancia en Windows, dependiente del túnel. Techo de unas 60 RPS.
    - Recompensa del Coach solo local (F68-010).
    - Acceso de testers solo en el equipo del operador mientras no haya acceso privado.
80. **Motor cambiado:** NO (`src/sim` y el motor de duelos intactos; `moments.ts` es narrativa y `resolveImage` es metadato de retransmisión).
81. **Balance cambiado:** NO.
82. **Economía cambiada:** NO. Precios, pagos y recompensas intactos. Los arreglos solo afectan a guardias del cliente y a relecturas de saldo.
83. **Cartas cambiadas:** NO (331).
84. **Agentes cambiados:** NO (29).
85. **Migración:** NO.
86. **Esquema de producción modificado:** NO. Todas las consultas SQL fueron de solo lectura (`default_transaction_read_only`).
87. **Datos de juego de tu cuenta:** NO. 0 filas hoy en libro, cartas, partidas, equipos y operaciones del prefijo `2f86cbe8`.
88. **Restos QA:** 9 cuentas QA nuevas `qa-f68-*@example.invalid`, conservadas: borrarlas rompería historial, libro y seriales.
    - 0 PvE/PvP vivas y 0 en cola.
    - 1 run de Draft en READY (D a mitad de gauntlet).
    - 3 partidas de Coach y 1 amistad D–C.
    - El ranked de las cuentas QA ha movido la escalera QA: C 1072, E 948.
89. **Tests:** 5.334 → **5.364** (+30 regresiones de F68), todos verdes.
90. **tsc web:** 0 errores.
91. **tsc scripts:** 0 errores.
92. **lint:** 0 errores (27 avisos, los mismos de antes).
93. **build:** verde. `drl-0.1.1-1-9792433c`. Aviso heredado de F67 (`process.exit` en `instrumentation`, Edge).
94. **HTTP :3005:** `/api/ready` 200 (config, database, schema 0057, catalog 331/331, storage).
95. **Solo localhost:** `next start -H 127.0.0.1 -p 3005` (proceso real identificado por `Get-NetTCPConnection`).
96. **Túnel:** abierto (54521/54522). Se cerró durante los gates y se reabrió porque la app lo necesita.
97. **Ficheros:**
    - **Modificados:**
      - `src/components/onboarding/{OnboardingKit,FirstCardLesson}.tsx`
      - `src/components/packs/PackOpeningExperience.tsx`
      - `src/app/tienda/page.tsx`, `src/app/packs/[packId]/page.tsx`
      - `src/lib/game/{sync,usePackPurchase}.ts`
      - `src/components/duel/DeckBuilder.tsx`
      - `src/lib/supabase/auth.tsx`, `src/components/auth/AuthForms.tsx`
      - `src/components/cards/layers/PlayerPhoto.tsx`
      - `src/lib/match/{playerMapper,moments}.ts`
      - `src/components/sync/CloudSync.tsx`
      - `src/lib/progression/claims.ts`, `src/app/logros/page.tsx`
      - `src/app/duelos/competitivo/partida/[matchId]/page.tsx`
    - **Nuevos:**
      - `src/lib/supabase/authErrors.ts`, `src/data/playerPhotos.ts`
      - 9 ficheros de test `f68.*` / `authErrors.test.ts`
      - Instrumentos `scripts/_fase68-*` (fuera de CI)
      - `docs/operations/drlcards-closed-beta.md`, `docs/operations/drlcards-beta-feedback-template.md`
      - Este informe y `docs/product/qa/fase68-beta/`
    - Cada edición se hizo sobre el fichero leído, con diff previo, parche quirúrgico y los saltos de línea originales (CRLF/LF).
98. **Limitaciones de la propia fase:**
    - Los recorridos son automatizados: los tiempos no son tiempos humanos (F63 estimó 5–8 min; F68 no añadió pasos, quitó el rodeo de F68-001).
    - La «segunda pestaña» de un navegador distinto equivale a otro dispositivo; se midió también la pestaña real del mismo navegador.
    - El acceso de un tester remoto no se probó: no existe.
    - Los falsos positivos del arnés están documentados en `bugs.json → harnessFalsePositives`.
99. **GO / NO-GO:** **GO para la beta cerrada.**
    - Se cumplen todos los criterios de la definición de hecho: primera sesión, vuelta, sobres, tienda, inventario y colección cuadran; los equipos persisten; el PvE y el ranked longitudinal funcionan; progresión y reclamos cuadran; los modos secundarios no tienen bloqueos ocultos; móvil y cambio de cuenta limpios; F5, atrás y multipestaña; libro, inventario e integridad en verde; Ronda 2 y pasadas finales; 0 BLOCKER/CRITICAL; F61–F67 intactas; tests y build verdes.
    - Queda **un MAJOR abierto con bloqueo explícito**: F68-010, recompensa del Coach solo local. Su arreglo exige elegir una política de economía (simular en servidor, premio acotado server-side o dejar de prometer recompensa con sesión). F57.6 está congelada y esta fase no la toca. **Necesita tu decisión.**
    - La release pública sigue **BLOCKED** por los bloqueos externos de F67.

**FASE 68 — CERRADA** (beta cerrada GO; F68-010 pendiente de decisión de economía; release pública BLOCKED por externos).
