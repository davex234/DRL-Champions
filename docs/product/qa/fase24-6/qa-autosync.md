# FASE 24.6 · QA AUTO-SYNC (QA SYNTHETIC · FakeDb)

| escenario | esperado | medido | |
|---|---|---|---|
| UPCOMING · primer sync | 3 partidos, 7 preguntas, clase future/upcoming | 3 partidos, 7 preguntas, clase future | ✅ |
| ACTIVE · un partido terminado, otros por jugar | clase active, intervalo 10 min | clase active, intervalo 10 min | ✅ |
| LIVE · partido en directo | clase live, intervalo 2 min (no 20 s), sin scoring | clase live, intervalo 120 s, scoring=0 | ✅ |
| FINISHED · upcoming→finished directo | 1 terminado, scoring 1, 20 pts, 1 recompensa | terminados 1, scoring 1, 20 pts, recompensa 1 | ✅ |
| SOURCE FAILURE · timeout | 1 fallo, partidos intactos, fallos consecutivos 1 | fallos 1, intactos=true, consecutivos 1 | ✅ |
| SOURCE FAILURE · lista vacía | SOURCE_SUSPICIOUS, 3 partidos siguen | SOURCE_SUSPICIOUS, 3 partidos | ✅ |
| RETRY · 503, 503, 200 | 3 intentos y éxito | 3 intentos, resultado ok | ✅ |
| RETRY · 404 | 1 intento (no se reintenta) | 1 intento(s) | ✅ |
| DUPLICATE TRIGGER · dos a la vez | 1 efectiva + 1 locked, 1 Pick'em, 3 partidos | locked 1, pickems 1, partidos 3 | ✅ |
| DRY RUN · resultado nuevo | 0 escrituras, 0 RPC, informa 1 would-finish | 0 escrituras, 0 RPC, finish 1, needs-scoring true | ✅ |
| KILL SWITCH · ESPORTS_AUTO_SYNC_ENABLED ausente | skipped=disabled, 0 partidos, 0 escrituras | skipped=disabled, 0 partidos, 0 escrituras | ✅ |

✅ 11/11 escenarios

último run: 20270110123000-0ren39 · 0 ms
