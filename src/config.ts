// Shared constants for the opencode-go-session plugin. Importing this module
// has no side effects (proxy.js must not be imported for values — it starts a
// server on load).
import { join } from "node:path";
import { homedir } from "node:os";

export const NAME = "opencode-go-session";
export const VERSION = "1.1.0";

export const PORT = Number(process.env.KIMI_OPENCODE_GO_PROXY_PORT || 18321);
export const UPSTREAM_ORIGIN =
  process.env.KIMI_OPENCODE_GO_UPSTREAM || "https://opencode.ai";
export const PROXY_ORIGIN = `http://127.0.0.1:${PORT}`;
export const HEALTH_PATH = `/__${NAME}/health`;
export const IDLE_EXIT_MS = Number(
  process.env.KIMI_OPENCODE_GO_PROXY_IDLE_MS || 12 * 60 * 60 * 1000,
);

export function kimiHome(): string {
  return process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
}

export function stateDir(): string {
  return join(kimiHome(), NAME);
}

export function configPath(): string {
  return join(kimiHome(), "config.toml");
}
