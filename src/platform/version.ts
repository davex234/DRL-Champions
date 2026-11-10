/**
 * PLATFORM — versión y build info (fuente ÚNICA en runtime para launcher/about/logs/updater).
 *
 * Estas constantes las sincroniza automáticamente el release pipeline desde `version.json`
 * (la fuente de verdad del repositorio) vía `scripts/release/version-engine.mjs`. NO editar a
 * mano: cualquier release las reescribe. `FULL_VERSION` = `${APP_VERSION}+${BUILD_NUMBER}`
 * (p.ej. 0.6.1+128), donde el build number es un contador interno monótono.
 */
import { platformName, osName } from "./env";

export const APP_VERSION = "0.1.1";
export const BUILD_NUMBER = 1;
export const BUILD_CHANNEL = "stable";
export const FULL_VERSION = `${APP_VERSION}+${BUILD_NUMBER}`;

export interface BuildInfo {
  version: string;
  build: number;
  full: string;
  channel: string;
  platform: ReturnType<typeof platformName>;
  os: ReturnType<typeof osName>;
}

export const buildInfo = (): BuildInfo => ({
  version: APP_VERSION,
  build: BUILD_NUMBER,
  full: FULL_VERSION,
  channel: BUILD_CHANNEL,
  platform: platformName(),
  os: osName(),
});
