# F58.2 · Acceso «Administración» dentro del juego

**Estado: GO** (2026-09-24). Sin migraciones y sin cambios en F57, economía, sobres, catálogo, eventos, moderación, 0055 ni `src/design/tokens.ts`.

## Qué se añade

| Dónde | Cómo se ve |
|---|---|
| Escritorio (≥1024 px) | Desplegable de la sección **Temporada** (junto a *Mi perfil* y *Cuenta*), tras un separador: escudo + «ADMINISTRACIÓN» en dorado y «Panel interno: catálogo, usuarios, economía y sistema». |
| Móvil/tablet (<1024 px) | Hoja **Menú** (☰), bloque «Herramientas internas» antes del audio. |
| `/admin` | Botón **← Volver al juego** siempre visible en la cabecera («Juego» en móvil) y el del pie de la barra lateral: vuelven a la pantalla desde la que se entró, o a `/`. |

No es una entrada del menú principal ni de la barra inferior. Un jugador normal no la ve y no deja ningún hueco.

## Permiso: una sola fuente de verdad

`AdminEntry` → `useAdminSession()` → `GET /api/admin/session` (Bearer) → `verifyAdmin` → `profiles.is_admin`.

Es la misma cadena que usan `AdminGuard`, `/admin` y el bloque de `/cuenta`. No hay emails, listas, `localStorage`, flags de frontend ni un `isAdmin` local. **Solo** `admin === true` en la respuesta del servidor concede el acceso.

### `useAdminSession` (reescrito como store compartido)

- **Un único store** para todos los componentes (`useSyncExternalStore`): la cabecera lo precalienta y el menú ya lo encuentra resuelto.
- **Sin parpadeo:** el snapshot de servidor/hidratación es `checking`, y `checking` no pinta nada. El HTML inicial nunca contiene «Administración».
- **Cierre de sesión:** `SIGNED_OUT` o una sesión sin usuario pasan a `denied` al instante e invalidan las comprobaciones en vuelo (`seq++`). Una respuesta antigua no puede pisar a la nueva.
- **Cambio de cuenta:** vuelve a `checking` (el acceso se oculta) y revalida.
- **Refresco de token del mismo usuario:** revalida sin ocultar nada, así que `/admin` no se desmonta.
- **Pérdida de permiso:** al volver a la pestaña, si han pasado ≥60 s desde la última comprobación, revalida. No hay caché indefinida.

### «Volver al juego» sin redirección abierta

Al pulsar el acceso se guarda `location.pathname + search` en `sessionStorage` (`nx-admin-return`). Tanto al guardar como al leer pasa por `safeReturnPath`, que devuelve `/` en cualquiera de estos casos:

- la ruta no empieza por `/`;
- empieza por `//` o por `/admin`;
- contiene espacios o `\`;
- supera los 200 caracteres.

## Protección de servidor: intacta

- `/admin` sigue detrás de `AdminGuard`.
- Cada `/api/admin/*` sigue haciendo su propio `verifyAdmin`, además del rate limit y la lista blanca de F58.
- El acceso nuevo es navegación, no seguridad.

## Pruebas

`src/components/layout/adminEntry.test.tsx` añade 9 tests:

1. Anónimo o usuario: no ve el acceso.
2. Mientras se comprueba no se pinta nada y el SSR va vacío.
3. El admin ve un enlace a `/admin`.
4. Una sola fuente de verdad.
5. Cambios de sesión.
6. Ubicación del acceso.
7. `AdminGuard` no pinta el panel sin `granted`.
8. Las API de `/api/admin/*` responden 401 con un token de usuario.
9. `safeReturnPath`.

También se ajustó una regex en `adminControlCenter.test.ts`.

**Gates**

| Gate | Resultado |
|---|---|
| `npm test` | 5079/5079 (antes 5070) |
| `tsc` (web y scripts) | 0 errores |
| `eslint src` | 0 errores, 27 avisos (línea base) |
| `npm run build` | PASS |

## QA

Evidencia en `qa/fase58-2-admin-entry/`: `entry-qa.json` más las capturas. Instrumento: `scripts/_fase58-2-entry-qa.ts`.

| Persona | 1440 px | 390 px | `/admin` a mano |
|---|---|---|---|
| Anónimo | no aparece (0 muestras durante la carga) | no aparece | «Acceso restringido» |
| Usuario | no aparece (0 muestras) | no aparece | «Acceso restringido» |
| Admin | aparece → `/admin` con el panel → «Volver al juego» → `/temporada` | ídem | — |

**Chrome real con la cuenta admin (963 px, hoja Menú):** el acceso aparece, abre `/admin` con el Centro operativo, y «Volver al juego» (`href=/temporada`) regresa a `/temporada`.

## Ficheros

**Nuevos**

- `src/components/layout/AdminEntry.tsx`
- `src/components/layout/adminEntry.test.tsx`
- `scripts/_fase58-2-entry-qa.ts`
- este documento y `qa/fase58-2-admin-entry/`

**Modificados**

- `src/lib/supabase/useAdminSession.ts` (store compartido)
- `src/components/layout/GameShell.tsx` (dos inserciones y el precalentado)
- `src/components/admin/cc/AdminShell.tsx` («Volver al juego»)
- `src/server/admin/adminControlCenter.test.ts` (una regex)
