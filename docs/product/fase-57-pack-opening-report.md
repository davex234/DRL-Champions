# FASE 57 — PACK OPENING 5.0 · Apertura cinematográfica de sobres

Fecha: 2026-09-23 · sin commit/push/deploy · **0 migraciones** (cabeza 0054).

## 1. Baseline
Antes **4938/4938** → después **4959/4959** (+21: `f57.packOpening.test.tsx`). Ningún test existente se reescribió.

## 2. Cómo funcionaba el opening anterior (Fase 38, conservado)
`/abrir/[packId]` → `PackOpeningExperience`. Gesto → pestillo → UNA petición `openPackOutcome` (clave de gesto guardada antes de pedir) →
`POST /api/game/packs {action:"open", packId, ref}` → `openPackForUser` (RPC `app_apply_pack_open`: descuenta el sobre, crea las
`user_cards`, `economy_ops` idempotente por clave) → resultado autoritativo → `saveOpenReveal` (recuperación en la pestaña) → máquina
de estados pura `revealReducer` (`ready → requesting → opening → hand → reveal → summary`) → `buildRevealPlan` (rareza real, nueva/duplicada
contra la colección de ANTES). Recuperación: recarga con resultado → resumen; recarga con petición enviada → misma clave. Nuevas/duplicadas,
serial y prestigio vienen del plan. Carta = `CardVisual` → `CardFace` → `CardArt`.

## 3. Arquitectura del nuevo opening
Misma autoridad y mismo reducer; se rehízo la PRESENTACIÓN:
- `PackBackdrop` → cámara: negro profundo, foco cenital y suelo con reflejo del color del sobre, horizonte, viñeta, ≤ 16 motas.
- `PackStage` → sobre REAL (`SealedPack` modo `ceremony`: el asset con `drop-shadow`, sin caja) a ~50 % de la altura útil
  (`ceremonyPackWidth`), anticipación, rasgado del propio arte, salida de las cartas y abanico persistente.
- `SealedPack` → `ceremony` y `torn` (recorte dentado determinista de la IMAGEN por la costura + luz de la boca). Tienda sin cambios.
- `CardBack` → dorso rediseñado como silueta de carta SVG (5/7, sigilo NEXUS, filetes, palabra NEXUS), luz por `drop-shadow`.
- `CardReveal` → la carta espera al GESTO; anticipación por rareza real; energía detrás del dorso en rarezas altas; momento máximo.
- Reducer: estado `armed` + evento `ARM` + `gestureEvent()` (un solo gesto para tocar/Espacio/Enter).
- `PackSummary` → título «Resultado del sobre».

## 4. Secuencia exacta
1. **Sellado**: la interfaz desaparece (pantalla completa); el sobre entra desde abajo (escala 0,6→1, opacidad, luz) y flota. ABRIR SOBRE
   (clic/toque/Espacio/Enter; también arrastrar sobre la costura).
2. **Anticipación** (mientras el servidor decide): el sobre se eleva, escala 1,06, luz desde detrás, temblor mínimo. Solo el color del sobre.
3. **Apertura** (2,1 s con resultado): tensión → a 30 % la solapa del PROPIO arte se rasga en dos mitades que salen despedidas, luz desde la
   boca, columna de luz, onda, partículas y un destello contenido (0,22 de opacidad, 0,7 s) → a 46 % las cartas (tantas como el resultado)
   suben desde la boca y se abren en abanico → a 78 % el sobre baja y se apaga.
4. **Reversos**: abanico de dorsos; halo con la MEJOR rareza real (corona si hay legendaria). REVELAR · REVELAR TODAS · OMITIR.
5. **Revelado una a una**: carta grande y centrada, las demás en la tira de abajo. Toque → anticipación de SU rareza → giro 3D → CardArt,
   aterrizaje 0,96→1. Toque durante la anticipación → gira ya. Toque tras girar → siguiente.
6. **Especial / máximo** (según el resultado real) — ver §6–7.
7. **Resultado del sobre**: todas las cartas con CardArt, NUEVA / DUPLICADA ×N / nueva variante, progreso de colección, ABRIR OTRO (si
   quedan unidades), ver colección, volver a sobres.

## 5. Animación y resultado separados
La ceremonia empieza DESPUÉS de `OPEN_SUCCEEDED` y solo con `results` del servidor; antes, solo el color del sobre. Ninguna pieza sortea,
calcula rareza ni vuelve a abrir (tests A1–A4: sin `Math.random`/motor/precio/odds en las piezas; plan idéntico con y sin movimiento;
`saveOpenReveal` antes de animar). Los temporizadores del escenario son de presentación y no mandan eventos al servidor.

## 6. Rareza
Rareza REAL del plan (`rarityOf` del catálogo) → receta existente `rarityCeremony` + `revealHoldMs`: común ≈ 0,3 s y limpia; poco común con
presencia; rara con anillo; épica apaga la sala (dim) y enciende energía detrás del dorso; legendaria con la anticipación más larga.
Sin cambiar probabilidades ni resultado.

## 7. ICON / máximo
El nivel visual máximo existente = legendaria (el Icon y demás variantes de ese cubo) o serial #1: oscuridad, energía rotando hacia la
carta, dorso cargado con el color real, giro más lento, **destello dorado contenido alrededor de la carta** (0,7 s, no pantalla completa),
luz de sala de la F44 y corona. Sin cartas cableadas (test C3). Con movimiento reducido: nada de eso, la carta y su color.

## 8. Abrir otro
Desde el resumen: `RESET` solo si la ceremonia terminó, `opened.current = false`, nueva clave de gesto (la anterior se borró al confirmar),
foto «antes» encadenada. Probado en real: consumió exactamente un sobre más.

## 9. Recarga / cierre
Sin cambios de arquitectura (ya era correcto): resultado guardado antes de animar → recarga = resumen de las mismas cartas; petición sin
respuesta → misma clave → el servidor devuelve lo guardado. **Probado en real**: recarga a mitad del rasgado → resumen con las 5 cartas, `recovered`,
1 sobre consumido.

## 10. Errores
Antes del resultado: `PackStatus` de error (reintento con la misma clave), nunca ceremonia ni cartas (test A2). Con resultado: las cartas ya
son del usuario; la recuperación las enseña.

## 11. Movimiento reducido
Sin mitades, partículas, destello, temblor, energía ni zooms grandes; apertura de 0,42 s; mismo orden sellado → abierto → cartas → revelado → resumen.

## 12. Responsive
1920/1440/1366/1024/768/390: sobre ≤ 50 % de alto y ≤ 66 % de ancho (test M2), carta revelada y botones dentro de la ventana, sin scroll
horizontal (medido en las 38 capturas), safe areas en los controles.

## 13. Rendimiento
Transforms/opacity con framer-motion; ≤ 16 motas ambiente y ráfagas ≤ `MAX_BURST` (40); filtros estáticos por estado (no animados por
fotograma); sin renders React por fotograma; el tamaño del sobre se mide al montar/redimensionar.

## 14. QA visual
`docs/product/qa/fase57-pack-opening/`: 38 capturas del arnés `/design-system/fase57` (sellado Icon/Oro/equipo/procedimental, anticipación,
rasgado, emergiendo, boca abajo 3 y 6 cartas, reposo, común, rara, épica cargando/revelada, legendaria cargando/máxima, resumen, duplicada,
móvil, movimiento reducido, matriz 1920/1366/1024/768) + `live/` (8 capturas reales con la cuenta QA) y `live.json`.

## 15. Tests
Nuevos 21 (máquina de estados, gesto, omitir, abrir otro, recuperación, dinámico 1–6, `packArtwork` para todos los sobres con arte y dibujado
para los demás, sin rutas escritas a mano, sobre sin caja, dorso sin caja, CardArt sin envoltorio, rareza/energía/máximo, nueva/duplicada,
ritmo y tamaño). Arreglo colateral: los fixtures del arnés F31 suponían la líder en la posición 0 (rompía el prerender de `/design-system/fase56`
según el orden de páginas).

## 16. Types / lint / build
tsc web PASS · tsc scripts PASS · eslint src 0 errores (10 advertencias preexistentes) · `npm run build` PASS (exit 0).

## 17. Archivos
Nuevos: `src/app/design-system/fase57/{page.tsx,fixtures.ts}`, `src/components/packs/f57.packOpening.test.tsx`, `scripts/_fase57-{shots,live}.ts`, informe, capturas.
Modificados: `components/packs/{PackStage,CardBack,CardReveal,SealedPack,PackHand,PackOpeningExperience,PackSummary}.tsx`,
`domain/packs/reveal.ts` (`armed`, `ARM`, `gestureEvent`), `app/design-system/fase31/fixtures.ts` (líder por id).

## 18. Catálogo / economía / odds / pools
Sin cambios (catálogo 331; `packs.ts`, `packArtwork.ts`, `services/packs.ts`, ruta de sobres sin tocar).

## 19. Migraciones
Ninguna.

## 20. Marketplace / pagos
`GLOBAL_MARKET_ENABLED = false`, `PAYMENTS_ENABLED = false`.

## 21. Datos reales persistidos por la prueba
Solo la cuenta QA 8c326e52: compró 2 Sobres Bronce con sus créditos (3.570 → 2.070) y los abrió (+10 cartas). La cuenta demo NO se tocó
(tiene 0 sobres sin abrir).

## GO / NO-GO
**GO.** Limitaciones reales: (1) el arte de los sobres trae marca de Valorant de origen (asset existente, no se alteró); (2) no hay
preferencia persistente de «apertura rápida» (sin migración): existen Omitir y Revelar todas en cada ceremonia; (3) sin audio nuevo: se
reutilizan los sonidos procedurales existentes.

---

# HOTFIX 57.1 — «La apertura real no ha cambiado»

**Causa raíz.** No era de rutas ni de caché: todos los CTA (tienda, ficha del sobre, inventario, Mis sobres, recorrido) ya llevaban a
`/abrir/[packId]` → `PackOpeningExperience` → `PackStage`/`CardReveal` de F57, y :3005 servía la build de F57 (chunks con sus marcas).
El Windows del usuario tiene los **efectos de animación apagados** (`SPI_GETCLIENTAREAANIMATION = false`), así que Chrome informa
`prefers-reduced-motion: reduce` a todas las páginas, y el modo reducido de F57 quitaba casi todo: apertura de 0,42 s, sin mitades, cartas por
fundido de 0,2 s, anticipación de 0,18 s y giro de 0,12 s. Medido en runtime con su recorrido exacto (`runtime-before-reduce/runtime.json`):
`requesting → opening → hand` en menos de 250 ms, `tearHalves: 0`, carta ya girada a los 350 ms del toque. Visualmente, la apertura anterior.

**Arreglo (sin segunda implementación).** El modo reducido quita MOVIMIENTO, no la ceremonia: acto de apertura de 1,6 s con el mismo orden;
el sobre se eleva un poco y se desvanece al final; las mitades se separan 14 px y se desvanecen (sin vuelo ni giro); luz de la boca; las cartas
salen de una en una (40 px, 0,12 s de escalonado); la anticipación dura de 0,35 s (común) a 0,9 s (legendaria), con sala a oscuras y anillo de
carga; la cara entra por fundido (sin giro 3D); el momento máximo es una luz dorada quieta. Sin partículas, destellos, temblor ni zooms.

**Evidencia runtime** (tienda → Comprar Sobre Bronce → Confirmar → Abrir ahora → `/abrir/estandar` → ABRIR), con las dos preferencias:
`runtime-after-reduce/` y `runtime-after-full/`: F57 montada (`ceremony-pack`, `data-pack-art`), rasgado con 2 mitades y luz de la boca, 5 cartas
saliendo, reversos, carta armada antes de girar, resumen; 0 errores de consola. Capturas con los nombres pedidos en `real/` (01–06 y 08, `-full`
y `-reduce`). No salió ninguna épica/legendaria en estas aperturas reales: el revelado especial queda cubierto por el arnés (fixture, `09-*`).

**Entradas productivas → F57:** TIENDA (`/tienda` compra y «Abrir ahora»; tarjeta de sobre), FICHA (`/packs/[packId]`), INVENTARIO
(`PackOpenStage`, lista de `/inventario`), MIS SOBRES (`MyPacks`), recorrido del jugador (`packRoute`). Ninguna otra pieza monta una apertura:
contrato `f571.entrypoints.test.ts`. No queda código de la ceremonia anterior (se reemplazó en sitio en F57).

**Contratos reescritos a su intención:** F38 «sin mitades con movimiento reducido» → «mitades sin vuelo ni giro»; F57 M1 (≤ 500 ms) → M1b
(el modo reducido dura ≥ 1,2 s y cada acto se ve).

**Gates:** tests **4965/4965** (antes 4959) · tsc web PASS · tsc scripts PASS · eslint 0 errores (10 advertencias preexistentes) · build PASS
(BUILD_ID `drl-0.1.1-1-809e5534`, sin cambios de código posteriores).

**Datos QA persistidos:** QA 1ff2c0ef compró y abrió 2 Sobres Bronce (evidencia antes/después con `reduce`); QA 8c326e52, 1 más. La cuenta demo no se tocó.

**GO** — verificado en el flujo productivo, con la misma preferencia de movimiento que tiene el equipo del usuario.
