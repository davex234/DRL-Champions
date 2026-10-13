# F74 · Crafting Experience 2.0 (NEXUS FORGE)

**Estado (2026-09-30): GO.** Rediseño visual de la parte del JUGADOR de Misiones y Crafting. Sin cambios de backend,
recetas, recompensas, condiciones, economía, motor ni migraciones (cabeza sigue en 0060). Build `drl-0.1.1-1-08943cb7`.

## Qué cambió (solo presentación)

- `components/crafting/forge.module.css` + `Forge.tsx`: escenario (luz ambiental, retícula, partículas CSS), paneles HUD
  con chaflán, haz de energía, núcleo hexagonal, abanico de sobres, marcador «Tienes / Necesitas», barra segmentada,
  arte de recompensa (sobre real · glifo de créditos/XP), huecos de carta, carta MISTERIOSA de clase, sellos de estado y
  las dos secuencias: forja de sobres (~1,8 s) y revelación de carta (~1,2 s). Todo CSS/transform/opacity +
  `framer-motion` (ya estaba). Movimiento reducido: sin bucles; fundidos.
- `HubNav`: dos zonas grandes MISIONES · CRAFTING (Crafting con arte real de sobres).
- `/misiones`: resumen HUD, placas con medallón de recompensa, barra grande, sellos En curso · Reclamable · Reclamada ·
  Completada · Bloqueada (con «Tras: …»), banner del proyecto con su carta; aviso «Misión actualizada / completada» con el
  `useToast` existente (uno por visita, comparando con lo visto en este navegador).
- `/misiones/crafting`: dos ramas gigantes con arte real.
- Sobres: escalera de inventario + un CARRIL por receta (origen en abanico → núcleo → destino protagonista), estados
  listo / faltan N / no disponible sin apagar el arte; móvil recompuesto (origen → destino en fila, CTA a lo ancho).
- Cartas: selector de transformación por clase, FORJA con huecos que se llenan, carta aleatoria de la clase (nunca una
  carta concreta antes del servidor), selección con brillo/✓/×N, revelación de la carta REAL devuelta.
- Proyecto: campaña con la carta objetivo grande (contenida en progreso, halo + RECLAMAR CARTA al completar), etapas en
  ruta (✓ / número / 🔒 con su dependencia real), revelación al reclamar.
- Admin (`/admin/crafting`): sin cambios.

## QA

BEFORE/AFTER en `qa/fase74/before|after` (mismo mundo de fixtures con cartas REALES, servicios reales de F73 sobre
MemSupabase, UI real de :3005; 1440/1024/390, 390 con movimiento reducido): 52/52 flujos en las dos versiones (el único
FAIL es la comprobación obsoleta «producción sin 0059»). Revisadas a ojo; corregidos: desbordamiento lateral de
/misiones a 390, etiqueta del abanico encima de los sobres, destello con bordes duros, diálogos demasiado altos a 390,
nombres de etapas apretados a 1024, capturas tomadas en mitad de la secuencia o con el splash.
Gates: 5629/5629 · tipos 0/0 · lint 0 errores · smoke 74/74 · gate 56/57 (FAIL = deuda conocida de la cola ranked) ·
production check 17/0/0 · dominio público PASS.
