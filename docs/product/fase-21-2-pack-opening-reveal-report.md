# FASE 21.2 — EXPERIENCIA DE APERTURA Y REVEAL DE SOBRES

**Estado: entregado sobre la implementación existente.** La ceremonia de apertura ya existía y era
madura (6 actos, reveal por carta, resumen); la Fase 21.2 la **completa** con lo que faltaba —
Saltar, teclado, recuperación tras recarga y guarda de DRAFT— sin reescribirla ni tocar el motor.
`npm test` 919/919, typecheck, build y verifiers en verde. Validación real en navegador incluida.

## Investigación previa (lo que YA existía y NO se reemplazó)
- `/abrir/:packId` → `PackOpeningExperience` (860 líneas): 6 actos —intro, sealed, rupture, hand,
  reveal, summary—, escena inmersiva a pantalla completa, `CardReveal` + `ceremony.ts` por rareza,
  `PackHand` (abanico), `SealedPack`, partículas, sonido, `useReducedMotion`.
- **Server-authoritative ya resuelto:** con sesión la tirada la decide el servidor
  (`openPackOnline` → `/api/game/packs`), sin ella el motor local (`openPackFromInventory`). El
  componente **anima el resultado recibido**; no sortea, no importa RNG ni el decisor.
- Serial, `value`, `isNew`/duplicado, mejor carta, resumen y bucle «Abrir otro» ya presentes.
- Idempotencia: pestillo `opened.current` (una apertura por gesto) + propiedad del servidor
  (no puedes abrir un sobre que ya no posees).

**Conclusión:** construir sobre ella. Los huecos reales frente al encargo eran cuatro.

## Qué se ha añadido (los huecos)
1. **Saltar (§9):** botón «Saltar ⏭» (arriba-izquierda, 44 px, foco visible) durante el reveal +
   `skipToSummary()`. Va directo al resumen con **el resultado ya obtenido**; no reabre, no vuelve
   a sortear, no toca `opened.current`.
2. **Teclado (§21):** `Enter`/`Espacio` abre (sealed) / revela (hand) / avanza (reveal); `→`
   avanza; `Escape`/`S` salta. Un `useEffect` con `keydown`, limpiado al desmontar, respetando la
   fase.
3. **Recuperación tras recarga (§15):** capa mínima nueva `lib/game/openRecovery.ts`
   (`sessionStorage`, por pestaña, TTL 10 min). Al completar la apertura se guarda el resultado; al
   montar, si hay uno fresco para ese sobre, la pantalla lo **restaura y salta al resumen** —marca
   `opened.current` para no reabrir—. **No** toca la persistencia económica del store ni el motor.
4. **Guarda de DRAFT (§13):** un sobre no público (`!isPubliclyOpenable`) muestra «Sobre no
   disponible» en vez de entrar en la ceremonia — la misma autoridad que el servidor (`guardPublicOpen`).
   Y una tercera acción «Volver a sobres» (§10) en el resumen.

## Flujo completo
`/packs` → ficha `/packs/:packId` → **Comprar y abrir** (flujo existente) → el servidor cobra,
valida y **realiza la apertura** → devuelve las cartas → `/abrir/:packId`: intro → sobre sellado →
**Abrir** (arrastre/botón/teclado) → rotura → mano (5 cartas boca abajo) → **Revelar** carta a
carta (con su rareza) → **resumen** con las cartas reales → acciones: Abrir otro / Ver en mi
colección / Volver a sobres. Las cartas ya están en `user_cards` (las insertó el servidor en la
misma transacción que consumió el sobre); la pantalla solo las representa.

## Componentes / rutas
| fichero | cambio |
|---|---|
| `src/components/packs/PackOpeningExperience.tsx` | +Saltar, +teclado, +recuperación, +guarda DRAFT, +«Volver a sobres» |
| `src/lib/game/openRecovery.ts` | **nuevo** — capa de recuperación (sessionStorage) |
| `src/lib/game/openRecovery.test.ts` | **nuevo** — 7 tests |
| `src/components/packs/packOpening.behavior.test.ts` | **nuevo** — 8 invariantes del componente |

Rutas sin cambios (`/abrir/:packId` ya existía). Se reutilizan `CardReveal`, `CardVisual`,
`PlayerCard`, `Card3D`, `SealedPack`, `PackHand`, `ceremony.ts`, `NxButton`.

## Integración backend
`openPackOnline(packId)` (sesión) o `openPackFromInventory(packId)` (local). Endpoint:
`POST /api/game/packs` (`open` / `buy_and_open`). El resultado (`OpenedResult[]`: uid, card,
serial, isNew, value) se anima tal cual. **Nada** de sorteo, rareza, jugador o serial en frontend.

## Server authority · reveal · skip · recovery · seriales · duplicados
- **Authority:** el componente no importa `openPack`, no usa `Math.random`/`makeRng`/`new
  PackEngine`. Verificado por test.
- **Reveal:** carta a carta desde `results[revealIndex]`, con `ceremony.ts` escalando por rareza
  (común rápido; épica/legendaria/icono más intenso). Progresión «N / total» + abanico al pie.
- **Skip:** solo animación; el resultado no cambia.
- **Recovery:** restaura desde sessionStorage; nunca reabre.
- **Seriales/mint:** se muestran los que devuelve el backend (`serial`, `value`); no se calculan.
- **Duplicados:** «NUEVA»/«REPETIDA» desde `isNew` real; recuento en el resumen.

## Responsive / accesibilidad
Escena `fixed inset-0`, tipografías `clamp()`, abanico y rejilla del resumen adaptativos,
`env(safe-area-inset-*)`. Botones ≥44 px, foco visible (`nx-focus`), `aria-label`, `role="status"`
en «Procesando…», `useReducedMotion` simplifica las animaciones. La información no depende solo de
la animación: el resumen la muestra íntegra.

## Tests
- **Nuevos (15):** `openRecovery.test.ts` (7: guardar/recuperar, packId distinto, vacío, clear,
  TTL, JSON malformado, sobrescritura) + `packOpening.behavior.test.ts` (8: server-authority,
  doble-apertura, saltar-sin-reabrir, recuperación, teclado, guarda DRAFT, acciones finales,
  reveal con serial y nuevo/duplicado).
- **Suite:** `npm test` **919/919** ✅ · typecheck ✅ · build ✅ · `security:verify` ✅ ·
  `pack:verify` ✅ · `content:verify` ✅ · `distribution:verify` ✅ (30/0).
- Ningún test existente modificado para forzar verde.

## Validación real (navegador, `next start`, modo local/demo)
Flujo completo con **Team Heretics** (caso principal, §17):
1. `/packs/team-heretics` → «Comprar y abrir» (saldo 6.000 → compra 3.000). ✅
2. Ceremonia: sobre sellado «SOBRE TEAM HERETICS» + «Abrir sobre». ✅
3. Rotura → «5 CARTAS» (mano) → «Revelar». ✅
4. Reveal: **botón Saltar** visible, carta girando con carga de rareza, datos reales
   (COMEBACK · 72 OVR · FLEX · NAVI · BRONCE · ¡NUEVA! · 🪙100 · 1/5). ✅
5. **Saltar** → resumen con las 5 cartas reales (ALFAJER 83 EMEA Winner **#1/500**, CLOUD 77,
   VEQAJ 88 Oro, COMEBACK 72, EXIT 70; Cartas 5 · Nuevas 5 · Repetidas 0 · Valor 7.250). ✅
6. Acciones: «Abrir mis sobres · 3» · «Ver en mi colección» · «Volver a sobres». ✅
7. **Recarga** de `/abrir/team-heretics` → **restaura el mismo resumen** (no reabre, no pierde
   cartas). ✅
8. **DRAFT** `/abrir/team-loud` → «Sobre no disponible». ✅
Una sola apertura por gesto (5 cartas, no 10): sin doble apertura. Capturas en el scratchpad.
Nota: una carta de NAVI/Fnatic en un sobre de Heretics es correcto — el sesgo hace más probables
las de Heretics, **no las garantiza**.

## P2 reales restantes
- **Recuperación = salto al resumen (no re-animación):** tras recargar, la ceremonia no se reanima
  desde la carta en curso; se muestra el resumen con todas las cartas. Es la capa mínima pedida
  (§15): evita perder cartas y evita reaperturas, sin tocar economía. Reanimar exactamente el
  punto sería más trabajo del alcance de esta fase.
- **Rareza declarada sin cartas (heredado):** algunos Team Packs declaran rarezas que su plantilla
  no tiene; el motor renormaliza. Fuera de alcance (§24) y ya documentado en fases previas.

## Cambios NO realizados
Sin tocar RNG, pack draw engine, probabilidades, pools, minting, economía, market, mastery, PvP,
Pick'ems, Trainer, roster, `teamIdentities`, Team Packs existentes, artwork/CardVisual. No se
resolvieron los 6 BLOCKED, no se hizo Ola 4, no se corrigió la rareza P2, no se modificó Fnatic.
Sin commit/push/deploy.
