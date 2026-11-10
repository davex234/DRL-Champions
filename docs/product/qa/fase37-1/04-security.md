# 04 · Sondas de seguridad, tope e idempotencia (ensayo, BEGIN … ROLLBACK)

Usuarios **sintéticos** A (`…0f3711`) y B (`…0f3712`) creados dentro de la transacción en `auth.users`; ningún usuario real. Semilla (como servidor): A = 2 favoritos, B = 1. Todo se deshizo con ROLLBACK.

## Acceso de clientes (RLS + grants)
Simulado como PostgREST: `set local role authenticated|anon` + `request.jwt.claims`.

| sonda | esperado | resultado |
|---|---|---|
| A lee la tabla entera | solo sus 2 filas | **2 filas: probe-a__gold, probe-a2__silver** |
| A filtra por `user_id = B` | 0 | **0** |
| A inserta un favorito propio | denegado (no hay INSERT para clientes) | **DENIED** |
| A inserta un favorito **para B** (P0) | denegado | **DENIED** |
| A actualiza filas de B | denegado | **DENIED** |
| A borra filas propias | denegado | **DENIED** |
| A borra filas de B | denegado | **DENIED** |
| B lee la tabla entera | solo su fila | **1 fila: probe-b__gold** |
| authenticated sin `sub` | 0 | **0** |
| anon SELECT | denegado | **DENIED** |
| anon INSERT | denegado | **DENIED** |
| anon DELETE | denegado | **DENIED** |
| PUBLIC (`has_table_privilege`) | ningún privilegio | **f/f/f/f/f** |
| service_role (el servidor) lee | todas | **3 filas** |
| filas tras los intentos de cliente | 3 (sin cambios) | **3** |

Conclusión: no existe vía desde el cliente para que el usuario A inserte, modifique o borre favoritos de B (ni suyos): la única escritura es la del servidor con el usuario sacado del token.

## Tope de 200 (como servidor)
| sonda | resultado |
|---|---|
| A con 199 favoritos | `count=199` |
| alta nº 200 | **ALLOWED** (`count=200`) |
| alta nº 201 | **REJECTED** · `P0001 FAVORITES_LIMIT` |
| total final de A | **200** |
| B no se ve afectado por el tope de A | **ALLOWED** |

Concurrencia: el disparador toma `pg_advisory_xact_lock` por usuario antes de contar, así que dos altas simultáneas del mismo usuario se serializan (corrección previa al apply; la función del ensayo lo confirma con `advisory_lock=true`). No se hizo una prueba de dos sesiones concurrentes.

## Idempotencia y borrado
| sonda | resultado |
|---|---|
| insertar de nuevo (B, probe-b__gold) | **UNIQUE_VIOLATION (23505)** → el servicio lo trata como éxito |
| filas de ese favorito | **1** (no 2) |
| borrar (B, probe-b__gold) | **1 fila** |
| repetir el borrado | **0 filas, sin error** |
| el borrado de B no toca a A | A sigue con **200** |

## Integridad de datos
| sonda | resultado |
|---|---|
| `card_id = '../../etc/passwd'` | **CHECK_VIOLATION** |
| `card_id = 'Benjy__Gold'` (mayúsculas) | **CHECK_VIOLATION** |
| usuario inexistente en `auth.users` | **FK_VIOLATION** |
| borrar el usuario B → sus favoritos | **0** (ON DELETE CASCADE) |
| filas reales tocadas | **0** |

Postflight con las mismas sondas sobre la tabla ya aplicada: `05-postflight.md`.
