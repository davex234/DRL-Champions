# F65 · Rule change proposal (NOT APPLIED)

> **Status: proposal.** Production keeps `duel-combat-2` / `duel-turns-2`. Nothing here changes printed stats, OVR, roles or editions. Every figure comes from `simulation-report.json` (1.43 M matches of the real engine, seed 65000). The engine already versions its rules (`COMBAT_RULESETS`), so a new version would leave old matches on theirs.

## P-1 · Tiebreak: stop deciding ties by the sum of *printed* OVR

**Evidence**
- In a field of random decks (HARD vs HARD, 300,000 matches), **23.4 %** of matches end tied on score (5-5 dominates: 94 % of matches have no tied encounters, so the margin is almost always even). The sum of printed OVR decides them and adds +1 to the scoreboard.
- Printed OVR and combat correlate only **0.52** at card level. Among matches decided by OVR, the winner had **less total combat** in **32.3 %** (NORMAL: 32.0 %).
- Editions: 91 players have editions with **identical combat** and different OVR. Swapping the low edition for the high one (same deck, same rival, same seed) **improves the result by +2.6 pp** [2.4; 2.7] (up to +8.8 pp for s0pp, 79→94). That comes only from the tiebreak.

**Shadow simulation** (same matches, re-decided; ties never depend on the rule because no bot looks at the tiebreak):

| rule | winner changes | draws | first attacker wins | tiebreak winner had more combat | tiebreak winner declared more |
|---|---:|---:|---:|---:|---:|
| **CURRENT** (OVR → margin → draw) | — | 0.006 % | 45.8 % | 67.2 % | 58.0 % |
| NO_OVR (margin → draw) | 10.0 % | 0.23 % | 48.3 % | 66.5 % | 100 % |
| COMBAT_SUM (printed combat → margin) | 7.8 % | 0.001 % | 46.0 % | 99.6 % | 66.3 % |
| STAT_FIRST (margin → OVR) | 9.8 % | 0.006 % | 48.3 % | 66.5 % | 99.1 % |

**Recommendation for a future `duel-combat-3`:** declared-stat margin first, then sum of **combat** (not OVR), then DRAW. That rewards what happened in the match, removes the edition advantage, and narrows the position gap (see P-2).
**Caveat to measure before shipping:** with margin as the first tiebreak, sacrificing the lowest card stops being free. Bots do not model this, so the shadow run understates how strategy shifts. It needs to be re-simulated with an adapted defender policy.

## P-2 · Position asymmetry: attacking first is a disadvantage

**Evidence:** paired sides (same pair of decks and same seed, only the first attacker changes, 100,000 matches) show an effect of **−8.6 pp** [−9.1; −8.2] for the first attacker, who wins **45.8 %** in the field. Per turn, the attacker wins 66–74 % of encounters, and less on odd turns (the first player's).

**Cause (rule, not a bug):** the defender decides after seeing the attack value. With alternating attacks, the second player always defends with **one more card to choose from** (10/8/6/4/2 against 9/7/5/3/1), and the first player's last defence is forced.

**Today:** the server draws the first attacker with `crypto.randomInt` in PvE and PvP, so across matches it evens out. The asymmetry adds per-match variance but is not biased.

**Options:** (a) do nothing (it is fair in expectation); (b) P-1 with margin first already moves the first attacker from 45.8 % to 48.3 %; (c) a `duel-turns-3` with an ABBA order that equalises choices on defence. That needs its own orchestrator version and simulation, and F65 does not touch the orchestrator.

## P-3 · "Power" should not be measured with printed OVR (autocomplete and PvE rival)

**Evidence:**
- Card impact correlates with **peak stat 0.84**, combat sum 0.78, and **OVR only 0.63**.
- With the same collection, the autocomplete team (maximum OVR) loses to the one chosen by peak stat:

| collection | autocomplete wins |
|---|---:|
| 30 cards | 28.5 % |
| 60 cards | 14.2 % |
| 120 cards | 7.7 % |

- The PvE rival is matched by the sum of OVR, so equal OVR does not mean equal power.

**Proposal:**
- Give autocomplete and `buildOpponentDeck` a power score derived from the trio: the average of the peaks, or the lab's per-card impact.
- Rename the builder's text to something honest ("Mejor OVR" → "Mejor equipo").

These are UI/matchmaking changes, not printed ones. They are not applied in F65 because the brief only allows proven bugs.

## P-4 · Meta: stacking the peak stat dominates

**Evidence:**
- PEAK_MAX (each card chosen by its highest stat) beats every other strategy in the matrix:

| rival | PEAK_MAX wins |
|---|---:|
| OVR_MAX | 97 % |
| COMBAT_MAX | 94 % |
| BALANCED | 97 % |
| SPEC_SH | 76 % |
| SPEC_GS | 99 % |
| SPEC_EF | 98 % |

- Hill-climbing search finds decks with **93 %** out of sample against a mixed field. A counter-deck searched specifically against the best one wins only **6.5 %**.
- There is no single dominant deck (75 different cards across 10 climbs, a core of 1). There is a dominant archetype: the attacker declares its best stat and the defender is forced into the one the table sets.
- Axis: SH attacks win the most (74.3 % against 69.9 % for GS). SH-specialised decks are easier to stack under the 2-per-role composition (Controlador/Iniciador/Centinela have high SH; high EF is concentrated in Duelista/Flex).

**Proposal:** a design phase for counterplay (for example, cards that punish the peak, or a defender with limited choice of axis) with its own simulation. At card level, `card-balance-proposals.json` lists 5 high outliers, 2 low outliers, and 79 cards whose OVR over- or understates their power.
