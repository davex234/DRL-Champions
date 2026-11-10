# Reemplazo total del catálogo por `Cartas\` — informe final (2026-09-21)

**Veredicto: NO-GO para dar el juego por bueno. El reemplazo en sí está hecho y verificado (no revertir).**
El catálogo antiguo ya no existe en la BD. Las 329 cartas nuevas son válidas y no hay ninguna referencia rota en la BD.
El NO-GO se debe a tres consecuencias de producto que necesitan una decisión (§30–§34): no se han improvisado.
El informe anterior (`catalog-replace-nogo.md`) queda como historia de la auditoría previa.

## Datos y assets

1. **Inventario.** Hay 343 PNG en `Cartas\` (1288×1800) y el manifiesto tiene 343 entradas con su sha256
   (`catalog-replace/NEW_CATALOG_MANIFEST.{json,csv}`). Al terminar se volvieron a calcular los 343 sha256:
   ninguno cambió. Los originales no se han renombrado, movido, convertido ni sobrescrito.
2. **Lectura.** Los datos impresos (OVR, rol y 6 stats) se leyeron con dos modelos de visión (qwen3-vl 8b y 4b) y
   una lectura manual (NRG MADA). Resultado: 330 SAFE / 0 AMBIGUOUS / 13 INVALID.
3. **Excluidas (decisión del usuario).**
   - 13 cartas de jugadores sin datos: CRYO, ROSÉ ×2, JIENI, CANEZERRA, INSPIRE, ION, BAHA, MRFALIN, SHEYDOS, PANCADA,
     SHAO y XFERRO.
   - SEN KYU: su jugador tiene 88 rondas y el mínimo es 100, así que no tiene trío de combate real.
   - Quedan **329 cartas de 195 jugadores**.
4. **La carta impresa manda** para OVR, rol y las 6 stats; FKS sustituye a COM en la presentación. El trío de combate
   sale de las métricas reales del jugador (`deriveCombat`). No hay bonus de combate por edición.
5. **Rareza por edición:**

   | Rareza | Edición | Cartas |
   |---|---|---|
   | común | base | 168 |
   | poco común | masters-l / masters-sdc | 59 + 59 |
   | rara | future-star | 20 |
   | épica | champions-s | 20 |
   | legendaria | record-breaker / moments | 2 + 1 |

6. **Assets.** `public/cards/<card_id>.webp`: 329 ficheros de 750×1048 (~100 KB cada uno, 32 MB en total), generados
   con sharp. Solo están reescalados, sin retoques. Los genera `scripts/cartas-import.ts`; con `--check` se verifican.

## Código

7. **Catálogo.**
   - `src/data/cardCatalog.ts` (generado) contiene `CARD_MANIFEST`.
   - `buildCatalog` recorre el manifiesto: `cardFromManifest` pone el combate real, y el OVR, rol y stats impresos.
   - Siete variantes nuevas en `variants.ts` (`DESIGNED_EDITIONS`, `statBoost` 0, sin serie limitada).
8. **El rol de la carta manda** (`card.role ?? player.role`) en todos los sitios donde el rol afecta al juego:
   - Motor: resolver, composición de mazo, validador y constructor.
   - Modos: draft, campaña, rival PvE.
   - Sobres: asistencia del Sobre Inicial.
   - Colección: registro, estadísticas, room y coach.
   - Estrategia de mazo, recorrido del jugador y vistas de partida.
   - En esta fase, además: `server/services/starter.ts`, `server/services/dailyLoop.ts`, el revelado del sobre, el
     reverso y la ficha de la carta.
9. **Nunca el mismo jugador dos veces en un mazo automático.** Un jugador puede tener cartas de roles distintos, así
   que el deduplicado es de mazo entero, no por rol. Aplica en: rival del draft, rival de campaña, rival PvE, QA
   simulada, muestreo de estrategia y sugerencias.
10. **Arte en pantalla.** `PlayerCard`, `CardViewer`, `CardThumb` y `DuelCard` pintan `card.image`, con el renderizado
    antiguo como respaldo. La ficha muestra las stats impresas con FKS («Primeras bajas»).
11. **Servidor.**
    - `withPrinted` enriquece desde el manifiesto las cartas leídas de la BD.
    - `cardChecksum` incluye el rol impreso.
    - La huella SQL (`_bump_catalog`) coincide con la de TypeScript.
12. **Bug propio encontrado y corregido.** `starter.ts` y `dailyLoop.ts` calculaban «plantilla lista» con el rol del
    jugador, mientras la asistencia ya usaba el de la carta. Eso daba en la prueba de economía un peor caso de 8 Sobres
    Iniciales gratis. Corregido: pasa (peor caso ≤ 3). **No hay regresión de economía.**

## Base de datos

13. **Backup previo (obligatorio), verificado y conservado.** Dos volcados:
    - completo (`full-postgres.dump`, formato custom, 2.376.065 B, 1871 entradas en `pg_restore --list`);
    - de las 29 tablas afectadas (`affected-tables-data.sql`, 2.669.727 B).

    Verificación:
    - Los sha256 coinciden en origen y en destino (`SHA256SUMS`).
    - Los recuentos del volcado (`dump-rowcounts.txt`) coinciden con los de la BD viva.
    - Restauración de prueba en una base temporal: 773 cartas, 213 ejemplares, 10 794 entradas. Solo hubo 2 errores,
      en esquemas internos de Supabase (`realtime`, `vault`). La base temporal se borró; el backup no.

    Ubicaciones:
    - VPS: `/opt/nexus/backups/supabase-drlcards/pre-catalog-replace/` y `~/backups/catalog-replace-2026-09-21/`.
    - PC: `C:\NEXUS-CENTRAL\DRLCards-backups\catalog-replace-2026-09-21\`, fuera del repositorio.
14. **Reemplazo en UNA transacción** (`scripts/cartas-db-replace.ts` genera el SQL; `psql -v ON_ERROR_STOP=1`).
    - Las cartas y versiones se insertan con `toCardRow` y los pools se rehacen con la RPC oficial
      `app_content_pool_set_entries`, con la misma lógica que `content-pools:migrate` y `:boost`.
    - Las verificaciones van dentro de la transacción: cualquier fallo la aborta entera.
15. **Ensayo** (mismo SQL, termina en ROLLBACK): «VERIFICACIÓN OK». Después la BD seguía intacta
    (773 / 213 / versión 782 / 10 794).
16. **Ejecución real.** El SQL es idéntico al del ensayo más una guarda: si los recuentos no son los del backup,
    aborta. Terminó en COMMIT, con exit 0.
17. **Estado final.**
    - 329 cartas y 329 versiones, todas PUBLISHED y de ediciones diseñadas.
    - **0 cartas antiguas, 0 huérfanos (`v_content_card_orphans`), 0 huecos de versión.**
    - 4590 entradas de pool, ninguna rota.
    - Versión del catálogo 783, versión de la distribución 918.
    - Huella `77513507…00f9`, la misma que en TypeScript.
18. **Borrado (decisión: borrar con backup, sin mapeo viejo→nuevo):**
    - propiedad: 213 `user_cards`, 51 `card_mints`, 13 `card_reference`;
    - mazos: 5 `duel_decks`, 3 `duel_active_deck`, 3 colas PvP ya cerradas (por cascada), 1 vitrina vaciada (la fila se
      conserva porque guarda logros);
    - mercado: 1 anuncio y 8 filas de precio;
    - catálogo: 773 cartas, 773 versiones y 10 794 entradas.
19. **Conservado.**
    - Los 379 jugadores (`content_players`).
    - Las auditorías: `content_audit_log` (367), `market_audit` (595) y `transactions` (1). Son historia, no
      referencias vivas.
    - Las 31 partidas terminadas, que guardan su propia foto; su `deck_id` pasa a NULL por la clave ajena.
20. **Verificación independiente** con el camino del servidor (`scripts/cartas-db-verify.ts`, solo lectura): «TODO
    CORRECTO». Cartas campo a campo, huellas, pertenencia de pools, cero instancias antiguas y assets presentes.
    Los `content-*-verify` antiguos **escriben** en la BD y no se han corrido contra producción.
21. **Sin migraciones.** El head sigue en 0054: no hay ningún CHECK que limite las variantes.

## QA

22. **QA visual real** (build de producción, BD real, cuenta QA): 21 capturas en `docs/product/qa/catalog-replace/`,
    a 1440, 768 y 390.
    - Pantallas: Colección; Detalle de carta poseída y no poseída; Apertura sellada, revelación y resumen.
    - Resultado: 0 imágenes rotas, 0 errores de consola y 0 desbordamiento horizontal.
23. **Apertura real** en la cuenta QA `1ff2c0ef` y en ninguna otra: un Sobre Inicial gratis y 2 Sobres Estándar
    (1500 créditos).
    - Salieron comunes, poco comunes, 1 rara y 1 legendaria (`marteen__record-breaker`).
    - La cuenta queda con 15 ejemplares nuevos y 5760 créditos.
24. **Tests: 4558** (4557 de base + 1 nuevo): 4545 pasan y **13 fallan a propósito**. No se han debilitado:
    reflejan §30 y §33.
    - `campaign` 6 + `campaign.contract` 1 + `campaign.service` 1;
    - `teamPackCatalog` 4 + `packs` 1.
25. **Tests adaptados sin debilitar.**
    - Leen el rol de la carta.
    - Los fixtures apuntan a cartas que existen (antes, por ejemplo, `aspas__gold`).
    - Los recuentos salen del manifiesto (antes 772 o 37 variantes; ahora 44 variantes).
    - Las colecciones sintéticas vuelven a dejar cartas sin poseer.
    - Los mazos de fixture no repiten jugador.
    - La carta serializada de QA es local (`serialFixture.ts`), porque el catálogo diseñado no tiene serializadas.
26. **Dos invariantes con cambio de regla explícito.**
    - `combat.test`: «statBoost por rank» sigue valiendo para las variantes antiguas. Se añade un test que fija
      statBoost 0 en las ediciones diseñadas (decisión «sin bonus»).
    - `mastery.ts`: el techo de un conjunto por variante era 60 cartas, calibrado para 772. Ahora es el menor entre 60
      y el 15 % del catálogo, que es el invariante que el test ya exigía. Con esto, Masters L (59) deja de ser un objetivo
      de maestría.
27. **`packStats` regenerado** (`economy:model -- --emit`). Son las probabilidades que se **muestran**; ni precios ni
    pesos. Mostrar las antiguas sería mentir. Consecuencia en §31.
28. **Gates.**
    - `tsc` web: 0 errores.
    - `tsc` scripts: 0 errores.
    - `lint`: 0 errores; 28 avisos anteriores, ninguno en ficheros de esta tarea.
    - `build`: OK.
    - `npm test`: 13 fallos (§24).

    Se corrieron con el túnel cerrado.
29. **Producción.** `npm run start` en :3005 con la build final, túnel abierto. `/` responde 200, `/coleccion` 200,
    `/cards/*.webp` 200 y `/api/game/state` 401 sin sesión.

## Bloqueos y consecuencias (decisión de producto pendiente)

30. **BLOQUEO · Road to Champions.** c1-n3 (BLG), c1-n4 (TE) y c1-n5 (JDG) no tienen ninguna carta en el catálogo
    diseñado, así que no hay rival (`CORE_TOO_SMALL` / `RIVAL_UNAVAILABLE`). Como cada nodo exige el anterior,
    **13 de los 15 nodos quedan inaccesibles**. Hace falta decidir: cambiar rivales o añadir cartas de esos equipos.
31. **Sobres Masters, Champions y EWC** (5000–8000 créditos): ya no pueden dar raras ni legendarias. La tienda lo
    muestra con la verdad, pero es una bajada de valor que no se ha compensado, porque tocar la economía está prohibido.
32. **Referencias en contenido a cartas que ya no existen.**
    - Recompensas de nivel 50 de Masters Toronto, EWC 2026 y Champions Paris: `derke__masters-mvp`, `wo0t__ewc-mvp` y
      `aspas__champions-mvp`. Se entregan solo en local y `grantCard` las ignora: no se escribe ninguna referencia
      rota, pero el jugador no recibe nada.
    - Logro «icon-series»: ahora es imposible.
    - Tarea semanal «Consigue 2 cartas MVP»: ahora es imposible.
    - El simulador económico cita cartas icon-series.

    No se ha inventado ninguna sustituta.
33. **Team Packs** (todos DRAFT, fuera de la venta salvo Heretics, Fnatic, NAVI y G2).
    - BLG, TE y JDG: sin cartas y con boosts vacíos.
    - La auditoría declarada está desincronizada (p. ej. NRG ahora tiene `LEGACY_ROSTER`).
    - Los datos de equipo del jugador son incoherentes y vienen de antes: «TH» frente a «Team Heretics», «FNC» frente a
      «Fnatic», y «KRÃœ» con mojibake.
34. **Sin ediciones serializadas.** Seriales, «#1» y prestigio siguen funcionando, pero ninguna carta real los usa.

## Cierre

35. **Para pasar a GO:** decidir §30 (imprescindible) y §32 (recompensas, logro y tarea). §31, §33 y §34 son
    aceptables si se documentan como decisión.
36. **Rollback, si alguna vez hiciera falta:** restaurar las tablas afectadas desde `full-postgres.dump` o
    `affected-tables-data.sql`, con `--disable-triggers` por la clave circular cartas↔versiones. Después volver al
    código anterior.
37. **Sin commit, push ni deploy.**
    - No se usó ninguna operación git destructiva.
    - Tactical Coach, economía (precios, recompensas, pase, misiones) y reglas de combate están intactos.
    - `GLOBAL_MARKET_ENABLED=false`.
    - Instrumentos nuevos: `cartas-import.ts`, `cartas-db-replace.ts`, `cartas-db-verify.ts`,
      `_catalog-replace-shots.ts` y `_catalog-qa-state.ts`.
