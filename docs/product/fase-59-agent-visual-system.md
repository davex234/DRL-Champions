# F59 · Valorant Agent Visual System

**Estado: GO** (2026-09-24). Sin migraciones, sin cambios de gameplay, cartas ni economía.

Evidencia en `qa/fase59-agent-visual-system/`:

- `asset-inventory.json`
- `agent-mapping.json`
- `missing-assets.json`
- `surface-audit.json`
- `before-after.json`
- `runtime.json`
- `screenshots/{before,after}/`

## 1. Inventario (`personajes/`, originales intactos)

| Carpeta | Ficheros | Formatos | Tamaños | Transparencia |
|---|---|---|---|---|
| `cara/` | 29 | 23 webp, 3 png, 3 jpeg | 185–1024 px, cuadradas | 26 con alfa; **fade, iso y killjoy (jpeg) con fondo blanco** |
| `entero/` | 29 | 28 avif, 1 png | 352 px de ancho × 470 (24) o 540 (5) | 4 con alfa (miks, veto, vyse, waylay); **25 opacos con fondo de estudio** (#1a222d) |

- Sin duplicados (sha256).
- Sin ficheros ajenos.
- Nombres que no son el id canónico:
  - `cara/Omen.webp` (mayúscula) → `omen`;
  - `entero/geko.avif` (grafía) → `gekko`, por un alias explícito.

## 2. Cruce con el roster

El catálogo canónico es `src/domain/tactics/roster.ts` (`TACTICAL_AGENTS`), que se lee y no se escribe a mano: **29 agentes**.

| Caso | Agentes |
|---|---|
| Ambas piezas | 29 |
| Solo cara | 0 |
| Solo cuerpo | 0 |
| Sin arte | 0 |

- **Ficheros no reconocidos:** 0.
- **Colisiones:** 0.

## 3. Pipeline (`npm run agent-art:import`, `scripts/agent-art-import.ts`)

1. Lee los ficheros de `personajes/{cara,entero}`.
2. Resuelve cada fichero con `planAgentArt`. La coincidencia es exacta, tras normalizar (minúsculas, sin tildes ni símbolos) y aplicar la tabla de alias. **Nunca por posición ni por parecido.**
3. Dos ficheros para la misma pieza de un agente hacen **fallar** el script.
4. Los ficheros sin dueño se informan en la evidencia.
5. Escribe los derivados WEBP (conservan el alfa):
   - `public/agents/<id>/face.webp`, cara de hasta 256 px;
   - `public/agents/<id>/face-96.webp`, para chips, filas y fichas del mapa;
   - `public/agents/<id>/full.webp`.
6. **Caras con fondo blanco:** se quita solo el blanco conectado al borde (relleno por inundación, borde suavizado de 1 px), en el derivado.
7. Genera `src/domain/tactics/agentArtManifest.ts`, con `?v=` igual al hash del derivado y `sourceSha` igual al hash del original.
8. Escribe la evidencia.

**Idempotencia:** solo escribe lo que cambia y no incluye fechas. `--check` no escribe y falla si algo difiere. Dos ejecuciones seguidas dan `changed: []`.

## 4. Fuente de verdad y componentes

```
roster.ts (id canónico)
  → agentArtManifest.ts (generado)
  → agentArt.ts: agentArtwork(id) · getAgentArtwork(id, "face"|"full") · agentIdFromName(texto) · AGENT_ART_TUNING
  → components/agents/AgentArt.tsx:
      AgentPortrait · AgentFullBody · AgentFaceSvg (fichas SVG) · AgentLineup (los cinco) · AgentChip (dato de esports)
  → pantallas
```

- **Cara:** circular, con anillo del color del rol y `srcset` 96/256.
  - Estados por CSS: `selected`, `disabled`, `dead`, `ally`, `enemy`.
  - Accesible: alt «Nombre · Rol», o `alt=""` si el nombre ya está escrito al lado.
  - `loading="lazy"`.
- **Cuerpo:** marco 3:4 anclado arriba, así la cabeza siempre queda dentro. El fondo del marco tiene el tono del estudio de los originales y el borde inferior se funde con una máscara, de modo que opacos y transparentes se ven iguales.
- **Sin arte:** el emblema de siempre (código o sigilo del legado). Nunca una imagen rota, y nunca la cara estirada para simular un cuerpo.
- **`AGENT_ART_TUNING`** (encuadre por agente) existe pero está vacío: ningún agente lo necesitó.

## 5. Superficies

Detalle completo en `surface-audit.json`.

**Modificadas**

- **Constructor de composición:** los cinco huecos muestran el cuerpo entero (la cara en móvil); el roster de 29 muestra caras.
- **Tiras de composición:** en composiciones, jugar y plan.
- **Quick play:** en la barra y en el roster.
- **Selector de agente de la pizarra.**
- **Panel EQUIPO de la pizarra.**
- **Fichas del mapa:** la cara va recortada dentro de la ficha, que conserva anillo, halo y selección. El legado muestra el sigilo.
- **Teatro:** panel lateral y tira móvil.
- **Pre-partido:** alineación de cuerpos enteros. Las cartas siguen en su bloque aparte.
- **Hub `/entrenador`:** caras de tu última composición.
- **Match Center (estadísticas por mapa):** cara y nombre canónico en lugar del slug crudo; en móvil, la cara junto al nick.

**Auditadas sin cambio** (no hay dato de agente real o no es un agente)

- Partido en vivo: el simulador no asigna agente por jugador.
- Pick'ems: solo equipos y jugadores.
- Draft Gauntlet: cartas de jugador.
- Historial del entrenador: `coach_matches` no guarda agentes.
- Map pool.
- Admin.
- `CardViewer`: su campo «Agente» es lore por rol, y ponerle cara mezclaría jugador con agente.

## 6. Tests

- **Añadidos** (`src/domain/tactics/agentArt.test.ts` y `src/components/agents/agentArt.test.tsx`): 22 tests. Cubren los casos A–G, los componentes, los respaldos, la accesibilidad, los estados, la integración y la separación jugador ≠ agente.
- **Pins reescritos** por decisión explícita de F59, no debilitados:
  - `f47.close` «el constructor usa AgentEmblem»;
  - `agentPortrait.test` «EL MAPA NO LLEVA CARAS», que ahora exige la cara dentro de la ficha y prohíbe cuerpos y retratos de interfaz sobre el mapa;
  - `f511` P2, que ahora exige `AgentLineup` en el pre-partido.

| Gate | Resultado |
|---|---|
| Tests | 5079 → 5101, 0 fallos |
| tsc (web y scripts) | 0 |
| eslint | 0 errores, 27 avisos (línea base) |
| build | PASS |

## 7. Rendimiento

| Pantalla | Antes | Después |
|---|---|---|
| Selector (29 caras) | 457 KB (caras de 250 px) | 130 KB con `face-96` (≈4,5 KB por cara) |

- En móvil nunca se pide el cuerpo entero: queda en `display:none` con `loading="lazy"`.
- El pre-partido pide solo los 5 cuerpos que muestra (135 KB).
- Imágenes rotas: 0 en 30 escenas × 3 anchos.

## 8. Limitaciones

- **Esports:** la tabla `public.agents` y `src/data/esports/agents.ts` tienen 27 agentes, sin Miks ni Veto. El sync de VLR deja `agent_id` nulo para esos dos, así que el Match Center muestra «—». Arreglarlo es un cambio de datos (insertar filas) y queda fuera de esta fase.
- **Partido en vivo:** sin caras, porque el motor no sabe qué agente lleva cada punto. No se infiere.
- **`MapReveal` (quick play automático):** no muestra la composición.
- **Habilidades:** siguen en texto; no hay iconos en `personajes/`.
- **Licencia:** las fases F16 y F47 evitaban el artwork de Riot por falta de licencia. Estos ficheros los aporta el usuario y se integran por su decisión explícita.
- **Instrumento QA:** `scripts/_fase59-agent-qa.ts` (fuera de CI; sesión simulada y fixtures reales, sin escrituras).
