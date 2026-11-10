# FASE 24.4 — TOURNAMENT BRACKET DATA ENGINE · Estructura real, progresión winner/loser y clasificación

**Estado:** completada (persistencia en BD pendiente de entorno, documentada) · **Fecha:** 2026-09-14
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** (cambios en el árbol de trabajo)

> Regla de la fase: NO inventar estructura. Una conexión solo se persiste y se pinta como
> CONFIRMED cuando la fuente real la demuestra; lo demás es UNKNOWN y no se dibuja. Con esa
> regla, el cuadro de la 24.3 pasa a mostrar las líneas **antes de que se jueguen los partidos**
> cuando la fuente las publica — y se ha comprobado con torneos reales de vlr.gg.

---

## 1. Fuente real encontrada

La **página del evento de vlr.gg** (`/event/{id}/{slug}`), que el importador ya descargaba para
la cabecera, los equipos y la clasificación final, lleva el cuadro completo dibujado con un
markup estable. Se ha comprobado con acceso web real sobre **cinco eventos**:

| Evento (REAL SOURCE) | Formato | Estado | Uso |
|---|---|---|---|
| Valorant Champions 2026 (`/event/2766`) | 4 grupos GSL: Opening → Winner's → **Qualified**; Elimination → Decider → **Qualified** | **sin jugar** (empieza 27-sep-2026) | fixture + prueba real pre-match |
| Valorant Champions 2025 (`/event/2283`) | doble eliminación a 8 | terminado | fixture + prueba real con resultados |
| VCT 2025 Pacific Stage 2 (`/event/2500`) | doble eliminación compacta con byes | terminado | fixture |
| VCT 2024 Americas Stage 1 (`/event/2004`) | doble eliminación con «Knockout Round» | terminado | fixture |
| VCT 2026 EMEA Stage 2 (`/event/2976`) | doble eliminación | terminado | inspección |

Los cuatro primeros se guardan recortados y sin modificar en `src/importer-vlr/fixtures/`
(atribuidos con URL y fecha). Champions 2026 es exactamente el caso que la fase pedía: partidos
«TBD vs. TBD» con id de partido, y columnas «Qualified» vacías.

## 2. Qué datos estructurales ofrece

```
<div class="wf-label mod-large">Bracket | Group A</div>
<div class="event-brackets-container">
  <div class="bracket-container mod-upper|mod-lower">
    <div class="bracket-col mod-N [mod-single]">
      <div class="bracket-col-label">Upper Semifinals | Opening | Qualified</div>
      <div class="bracket-row …"><a class="bracket-item" href="/{matchId}/{slug}" title="A vs. B">
        <div class="bracket-item-team mod-first [mod-winner|mod-loser]" data-team-id="…"><span>Nombre</span> … score</div>
        … <div class="bracket-item-line mod-up|mod-down|mod-straight"></div>   ← alimenta la columna siguiente
```

- **`bracket-item-line`** es la marca explícita de que ese partido alimenta la columna siguiente
  del mismo contenedor (`SOURCE_STRUCTURED_HTML`). Gramática cerrada, verificada contra los
  resultados reales de los cinco eventos:
  - 2 alimentadores por destino, en parejas consecutivas (`down`, `up`) → **hueco 1** y **hueco 2**.
  - tantos alimentadores como destinos → uno a uno, en orden, **sin hueco** (el otro hueco lo
    ocupa un cabeza de serie o quien cae del cuadro alto, y la página no dice cuál).
  - alimentador `mod-straight` hacia una columna `mod-single` («Qualified») → **el ganador se clasifica**.
- Ids de partido (href), nombres, `data-team-id`, marcador, `mod-winner`, fecha (`data-utc-ts`).
- Grupo (etiqueta `wf-label` previa) y rama (`mod-upper`/`mod-lower`).

## 3. Qué NO ofrece (y por tanto no se afirma)

- **Adónde cae el perdedor**: el cuadro bajo es otro contenedor sin líneas desde el alto.
- **Final Baja → Gran Final** y **Upper Final → Gran Final**: la Gran Final es una columna sin
  línea de entrada.
- **Reset de gran final**: no existe como partido en ninguna página observada.
- **`standings.status`** (qualified/eliminated): la página no marca clasificados en las tablas;
  los grupos de Champions 2026 se publican como mini-cuadros, sin tabla.
- Estructura de playoffs antes de que VLR la publique (Champions 2026 aún no tiene cuadro de
  playoffs: sus 16 partidos de playoffs existen en el listado, sin cuadro → sin aristas).

Todo lo anterior sigue cubierto por la verificación por resultado de la 24.3 (`RESULT_VERIFIED`).

## 4. Modelo canónico implementado

Se **reutiliza** el modelo que el importador canónico ya tenía definido y nadie rellenaba
(`RawBracket { id, stageId, kind, nodes: RawBracketNode[] }` con `winnerToNodeId`/`loserToNodeId`),
ampliado con campos opcionales: `winnerToSlot`, `loserToSlot`, `winnerQualifies`,
`winnerQualifiesLabel`, `evidence`, `confidence` (`src/importer/types.ts`, `model/bracket.ts`).

En el sync: `RawMatch.progression?: { winnerTo, loserTo, winnerQualifies, evidence, confidence, version }`.

En el dominio de Pick'ems (`domain/pickems/bracket.ts`): `BracketModel` gana `edgeMeta`
(por arista: `kind STRUCTURAL|RESULT_VERIFIED`, `evidence`, `confidence CONFIRMED`, `toKind
match|qualification`), `qualificationNodes[]`, `conflicts[]`, `issues[]`. La forma de
`BracketEdge {from,to,source,slot}` de 24.3 no cambia (sus pruebas siguen verdes sin tocarlas).

## 5. Persistencia

Se comprobó primero si cabía en tablas existentes: sí. En todos los formatos publicados un
partido tiene como mucho un destino para su ganador y uno para su perdedor, así que la
migración **`0045_match_progression.sql`** añade columnas a `matches` (sin tabla nueva):
`winner_to_match_id`/`winner_to_slot`, `loser_to_match_id`/`loser_to_slot`,
`winner_qualifies`/`winner_qualifies_label`, `progression_evidence`, `progression_confidence`
(CHECK: solo `CONFIRMED`), `progression_version`, `progression_synced_at`. FK reales con
`on delete set null`, `check` sin autoarista, índices únicos parciales por (destino, hueco) para
ganador y perdedor. RLS intacta: lectura pública, escritura solo `service_role`.

**No aplicada en ninguna BD** (Supabase local inexistente, sin vía autorizada a la VPS).

## 6. Evidence / confidence

- `SOURCE_STRUCTURED_HTML` + `CONFIRMED`: lo que emite el parser de VLR.
- `SOURCE_EXPLICIT` / `SOURCE_BRACKET_LINK`: reservados para fuentes con relaciones explícitas.
- `RESULT_VERIFIED`: el fallback de 24.3, calculado en el dominio, nunca persistido.
- `INFERRED` existe en los tipos del importador pero **no se persiste** (CHECK) ni se pinta
  (prueba 11).
- Auditable: `progressionRow` escribe evidence/confidence/version; `model.edgeMeta` lo expone.

## 7. Winner progression

Parser → `snapshot.brackets` → `RawMatch.progression.winnerTo` → columnas 0045 → arista
STRUCTURAL en el dominio. Existe antes del resultado (Champions 2026: 12 aristas de partido con
ningún partido jugado). Al jugarse, la arista no cambia; solo cambia el participante del destino
(prueba 7).

## 8. Loser progression

Soportada de extremo a extremo (`loserTo`, `loser_to_match_id/slot`, aristas `LOSER`
estructurales, línea discontinua hacia abajo) y probada con fixtures. **VLR no la publica**, así
que hoy solo llega por verificación por resultado; una fuente que la exponga la activa sin
cambios de código.

## 9. Slots

Se conservan cuando la fuente los conoce (parejas): hueco 1/2 → `slot a/b`, y la línea entra por
la fila correspondiente. En transiciones uno a uno la arista existe **sin hueco** y la línea
entra por el centro. Nunca se inventa un hueco. Colisión de hueco (dos partidos confirmados al
mismo hueco) → ninguna de las dos aristas, y se anota.

## 10. Qualification

`QualificationNode { id: qual:<clave>, key, label, stageId, side, fromMatchId, source: WINNER, team }`,
solo cuando la fuente confirma `winner_qualifies`. `team` es el ganador REAL del partido o
`null`. UI: `QualifiedNode` («CLASIFICADO · Por definir» → «CLASIFICADO · [logo] Equipo»), en
una columna final «Clasificados» por rama, con conector desde el partido. En Champions 2026 hay 8
nodos reales (Winner's y Decider de cada grupo).

## 11. Advance (Pick'ems)

`buildQualificationQuestions` (kind `advance`, `match_id` del partido) solo para partidos con
`winner_qualifies` **y** `progression_confidence = 'CONFIRMED'`, con los dos equipos y sin
empezar. Opciones = lados a/b reales, cierre = inicio del partido, puntos por ronda del
servidor, corrector = ganador real (`correctOptionForKind`). Idempotente por el índice único
(evento, partido, tipo). La generación por `standings` de 24.2 sigue como estaba. El test de 24.2
que exige que `tournament.ts` no tenga generador de advance sigue verde: el generador vive en
`questions.ts` y solo actúa con clasificación confirmada.

## 12. Standings

`standings.status` no se rellena porque **la fuente no publica** qualified/eliminated de forma
explícita (ni en tablas ni en el cuadro: la clasificación se representa como columna
«Qualified» del cuadro, que ahora sí se captura como nodo). No se deriva. Documentado como P2.

## 13. GSL

Champions 2026 (real, sin jugar): por grupo, `Opening (2) → Winner's (1)` con huecos,
`Winner's → Qualified`, `Elimination (1) → Decider (1)`, `Decider → Qualified`. Los perdedores de
Opening → Elimination y de Winner's → Decider no están en el markup → verificación por resultado
cuando se jueguen. Las rondas de un mismo grupo se ordenan juntas y llevan «Grupo A».

## 14. Double elimination

Champions 2025 (real, terminado): 11 aristas estructurales (UQF→USF con huecos, USF→UF con
huecos, LR1→LR2 uno a uno, LR2→LR3 con huecos, LR3→LF) + 33 verificadas por resultado
(perdedores al cuadro bajo, UF→GF, LF→GF), 0 conflictos: la gramática coincide con la realidad.
El conector dibuja ahora también hacia arriba (Final Baja → Gran Final).

## 15. Conflicts

`STRUCTURE_CONFLICT` en el dominio: la estructura dice C y el ganador real juega D, o no ocupa el
hueco anunciado, o no juega el destino → la arista **no se pinta**, se registra en
`model.conflicts` y el fallback por resultado **no elige por su cuenta** para esa fuente
(pruebas 12/12b). El parser también descarta la transición entera si contradice un resultado
publicado en la misma página.

## 16. Fallback histórico

Sin columnas 0045 (torneos antiguos) el modelo es exactamente el de 24.3 (prueba 28). Sin
resultados ni estructura: rondas sin líneas. Sin rondas fiables: vista 24.2.

## 17. Integración 24.3

`buildBracketModel`: 1) STRUCTURAL CONFIRMED (validadas: autoarista, destino inexistente, otra
fase, ronda hacia atrás, hueco doble, ciclo → degradan en seguro) → 2) RESULT_VERIFIED solo
donde no hay estructural ni conflicto → 3) nada. `TournamentBracket` y `BracketConnector` sin
rediseño: las líneas estructurales sin resultado van al 75 % de opacidad y se «encienden» al
verificarse; `data-kind`/`data-source` por línea; columna «Clasificados»; el pie dice «N de
estructura confirmada, M por resultado» y los conflictos sin pintar. La vista abre en la fase
con partidos por jugar que ya tienen equipos.

## 18. Seguridad

Escritura solo por el importador (`upsertMatchProgression`, service_role). El cliente lee las
columnas y no tiene ninguna escritura (prueba 34). CHECK de `progression_confidence` impide
persistir INFERRED. `app_submit_pick` intacto.

## 19. Performance

Cero peticiones nuevas en el cliente: las columnas viajan en el mismo `fetchMatches` del lote de
`usePickem`. En el importador, cero páginas nuevas: el cuadro está en la página del evento ya
descargada. El sync añade un upsert parcial por torneo (una sola llamada).

## 20. Tests

**47 pruebas nuevas** (1134/1134 en verde; las 1087 previas intactas, ninguna modificada):

- `importer-vlr/brackets.test.ts` (11, sobre fixtures REALES): parse de Champions 2026 y Pacific
  2025; parejas/huecos/uno-a-uno; 0 desconocidas y 0 conflictos en 4 eventos; coincidencia con
  resultados reales; lo que NO se afirma (perdedores, LF→GF, reset); clasificación pre-match;
  sin markup; markup cambiado (sin líneas / sin hrefs) → 0 aristas (29-30); 3→1 desconocida;
  conflicto; autoarista/doble destino.
- `domain/pickems/bracketStructure.test.ts` (17): 1-7 estructural (winner, loser, slot 1, slot 2,
  qualified, pre-match, permanece tras resultado); 8-11 fallback, prioridad, UNKNOWN, INFERRED;
  12 conflicto + 12b hueco; 13-16 autoarista/destino/otra fase/ronda atrás; 17 colisión; 14 ciclo;
  22-25 doble; 26 reset solo si existe; 23 GSL; 27 liga sin aristas; 28 compatibilidad; 24 grupos+playoff.
- `lib/esports/sync/structure.test.ts` (6): REAL SOURCE → brackets → progression → fila parcial;
  null para sin estructura/INFERRED/autoarista; 19 reimport idéntico; 20 reimport sin cuadro no
  borra; 16 destino de otro torneo no se escribe.
- `domain/pickems/qualification.test.ts` (5): 36-40 advance solo confirmada, no con UNKNOWN/INFERRED,
  TBD, idempotente, corrector real.
- `components/pickems/bracket/structure.test.tsx` (7): 45-48 líneas pre-match, TBD, qualified
  TBD/real; 49-51 conector; 52-53 desktop/móvil; 55-56 accesibilidad/motion; 44 historial; 34 seguridad.
- 31-35, 41-43: las pruebas de 24.2/24.3 (match_winner, pick desde caja, lock, scoring, champion,
  submission única, progreso, rewards) siguen verdes sin cambios.

**Gates:** `npm test` 1134/1134 ✓ · `typecheck` ✓ (web + scripts) · `build` ✓ · `security:verify` ✓
· `pack:verify` ✓ · `content:verify` ✓ · `distribution:verify` 30/0 ✓ · lint de lo tocado 0/0.
`test:pickems`: no ejecutable (Supabase vivo).

## 21. QA

`scripts/_fase24-4-qa.ts` (fuera de CI), **39/39 ✓**, capturas en `docs/product/qa/fase24-4/`:
- **App real** (`next start`, sin backend): 11 rutas a 1440/390 sin excepciones ni desbordamiento.
- **REAL IMPORTED (sin BD)**: `real-champions-2026-pre-{1440,390}.png` (líneas antes de jugarse,
  clasificados «Por definir»), `real-champions-2025-final-{1440,390}.png` (estructura + resultados).
- **QA SYNTHETIC**: `fixture-double-confirmed-*` (perdedores confirmados, TBD), `fixture-historial-*`.
- Comprobado: líneas dibujadas = aristas con los dos extremos en la fase visible; sin
  desbordamiento; botones ≥ 44 px; `_real-*.json` con aristas, procedencia, nodos y conflictos.

## 22. Prueba REAL

- **REAL SOURCE / REAL IMPORTED**: el importador real (`importVlrTournament`, 3 páginas, sin
  detalles) sobre `vlr.gg/event/2766` (Champions 2026) → cuadro presente, **12 aristas + 8
  clasificaciones, 0 desconocidas, 0 conflictos**, 34 partidos; el adaptador de sync produce las
  filas 0045 y el dominio 20 aristas estructurales (todas antes de cualquier resultado). Sobre
  `vlr.gg/event/2283` (Champions 2025): 11 estructurales + 33 por resultado, **0 conflictos**.
- **NO realizado**: escritura en base de datos (migración 0045 + `upsertMatchProgression`) ni
  `/pickems` con datos vivos. Sin Supabase no se finge.

## 23. Limitaciones / P2

1. Aplicar la 0045 y correr un sync real cuando haya BD; verificar `/pickems` con Champions 2026.
2. Perdedores, UF/LF → GF y reset: solo por resultado hasta que una fuente los publique.
3. `standings.status`: la fuente no lo expone; derivarlo sería inventar.
4. Layout de grupos GSL: las 16 rondas de Champions 2026 se muestran en una fila por fase
   (agrupadas por grupo); una pestaña por grupo sería más cómoda (no rediseño en esta fase).
5. `qualified:<grupo>:<columna>` es la clave; una fuente con ids propios de clasificación puede
   usarlos sin cambiar el modelo.
6. Observabilidad: `SyncResult.structure` y `VlrImportMeta.structure` + warnings del importador;
   sin sistema nuevo.

## Archivos

**Creados:** `src/importer-vlr/brackets.ts`, `brackets.test.ts`, `fixtures/vlr-{2766,2500,2004,2283}-*.html`;
`supabase/migrations/0045_match_progression.sql`; `src/domain/pickems/bracketStructure.test.ts`,
`qualification.test.ts`; `src/lib/esports/sync/structure.test.ts`;
`src/components/pickems/bracket/QualifiedNode.tsx`, `structure.test.tsx`; `scripts/_fase24-4-qa.ts`;
`docs/product/qa/fase24-4/*`; este informe.

**Modificados:** `src/importer-vlr/{engine,normalize,index,types}.ts`; `src/importer/{types.ts,
model/bracket.ts, normalize/index.ts}`; `src/lib/esports/sync/{source,vlrSnapshotSource,mappers,
writers,orchestrator}.ts`; `src/domain/pickems/{bracket,questions}.ts`;
`src/server/services/pickemLifecycle.ts`; `src/lib/game/client.ts`;
`src/components/pickems/bracket/{TournamentBracket,BracketConnector,BracketRound,BracketPickemView}.tsx`.

**No tocados:** Marketplace, packs/RNG/minting, colección, inventario, Duelos/PvP, Trainer,
`teamIdentities`, Team Packs, economía, XP/levels, reward engine, `app_submit_pick`,
`app_score_pickem_event`.

Sin `git commit`, sin `push`, sin `deploy`. Sin Docker. Servidor de la app detenido al terminar.

**FASE 24.4 — CERRADA** (persistencia en BD pendiente de entorno, documentada).
