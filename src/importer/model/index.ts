/**
 * MODELO CANÓNICO — la ÚNICA definición de datos objetivos de esports.
 *
 * REUTILIZA tal cual `@/domain/esports/types` (Circuit/Tournament/Stage/ProTeam/ProPlayer/Agent/
 * GameMap/Match(=Series)/MatchMap(=Map)/MapPlayerStat/PlayerMatchStat/Standing/TeamStats/
 * PlayerEventStats) — NO se recrea ni se muta — y AÑADE solo las entidades objetivas que faltaban.
 */
export * from "@/domain/esports/types";
export * from "./calendar";
export * from "./bracket";
export * from "./round";
export * from "./people";
export * from "./results";
