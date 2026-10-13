# F58 · Seguridad del Admin Control Center

## Barreras (de fuera a dentro)

1. **Middleware.** `/api/admin/*` sin Bearer → 401 en el borde. En las mutaciones del juego, una cuenta sancionada recibe un 403 legible. Es la capa de experiencia, no la autoridad.
2. **Ruta.** `runAdmin` → `verifyAdmin` en CADA petición. Anónimo, token falso y usuario normal reciben el mismo 401 (no hay oráculo).
3. **Límite de frecuencia.** `admin_read` 240/min y `admin_write` 20/min por admin (`app_rate_take`).
4. **Cuerpo.** Máximo 16 KB, JSON plano y lista blanca de campos (mass assignment → 400). El actor sale SIEMPRE del token, nunca del cuerpo.
5. **Validación en servidor.** Sanción, créditos, evento, concesión, simulación, importación y filtros de auditoría: tipos, rangos, longitudes, UUID y listas cerradas.
6. **Base de datos.** RPC `security definer` que solo ejecuta service_role y que vuelven a comprobar `is_admin` del actor y las reglas de negocio:
   - no auto-sanción;
   - no sancionar a otro admin;
   - una sanción activa;
   - saldo esperado;
   - suelo 0;
   - tope de cantidad;
   - publicar solo un borrador.

   Además, RLS activa y cero grants a `anon`/`authenticated` en las tablas nuevas.
7. **Auditoría append-only.** Un trigger rechaza UPDATE/DELETE y no existe ninguna ruta de escritura del registro.

## Pruebas de ataque hechas

| Vector | Resultado |
|---|---|
| Acceso sin sesión / usuario normal (UI y API directa) | 401 en todas las rutas; la UI no se pinta (AdminGuard) |
| IDOR (`/api/admin/users?id=<otro>` como usuario) | 401 |
| Escalada vertical (auto-sanción, sancionar admin, RPC como no admin) | Rechazado en servidor y en SQL (NOT_ADMIN, SELF_SANCTION, TARGET_IS_ADMIN) |
| Mass assignment (`actor`, `created_by`, `balance`) | 400 «Campo no permitido», sin escrituras |
| Inyección en filtros de auditoría/búsqueda | Lista blanca de caracteres → 400; PostgREST parametriza |
| XSS en nombres, motivos y descripciones | Se guardan como texto y React los escapa; las imágenes solo `/…` o `https://` (`javascript:` → 400); `detail` se pinta en `<pre>` como texto |
| Inyección CSV al exportar | Las celdas que empiezan por `= + - @` se neutralizan con `'` |
| Doble envío / reintento | Clave de gesto por diálogo (créditos y concesiones idempotentes); una sanción activa por usuario; publicar un borrador solo una vez; botones deshabilitados mientras procesan |
| Concurrencia | Saldo esperado (`STALE_BALANCE`) y `updated_at` como versión en eventos (`STALE_EVENT`) |
| Fuga de secretos | `/admin/system` solo dice si una clave existe; `redactSecrets` en la auditoría; la ficha de usuario nombra columnas (sin hashes ni tokens); errores internos → mensaje genérico |
| CSRF | No aplica: la autenticación es un Bearer en cabecera (no hay cookies de sesión) |
| Redirecciones abiertas | Solo redirecciones internas (`/admin/cards/*` → `/admin/cartas/*`) con `encodeURIComponent` |

## Enforcement de sanciones

- **Qué se bloquea:** cualquier método que no sea GET/HEAD/OPTIONS en `/api/game/*`, `/api/pickems` y `/api/market`. Eso cubre sobres, desguace, reclamos, partidas, matchmaking, competitivo, campaña, Draft, social, mercado y mazos.
- **Qué no se bloquea:** login, lecturas, páginas públicas y telemetría.
- **Autoridad.** `getSession` devuelve `null` para esas mutaciones con la identidad VERIFICADA.
- **Borde.** El middleware responde 403 con un mensaje. Lee el `sub` del JWT sin verificar, pero solo para DENEGAR: un token falso solo puede bloquearse a sí mismo.
- **Caché.** 15 s por usuario; emitir o revocar la invalida en el propio proceso.

## Residuales conocidos

- Un único rol (`is_admin`): no hay superadmin en el esquema. «No eliminar al último superadmin» no aplica, porque el panel no cambia roles.
- La acción `lifecycle` de la ruta de cartas existente reenvía el mensaje de la RPC (son los `raise` de dominio). No se ha tocado.
- La auditoría de las concesiones se escribe después de `award()`. Si fallara, la concesión queda igualmente en el libro mayor con su ref `admin:grant:*`.
