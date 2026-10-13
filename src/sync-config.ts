// Point every OpenCode Go base_url in config.toml at the local proxy.
//
// Idempotent: only the URL origin is rewritten, paths are kept, and the file
// is left untouched when it already points at the proxy on the current port.
// The pre-plugin file is preserved once as config.toml.bak-<NAME>.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { NAME, PORT, UPSTREAM_ORIGIN, PROXY_ORIGIN, configPath } from "./config.js";

// Distinguishing path marker of the Go inference endpoint; for the default
// upstream (https://opencode.ai, empty path) this is /inference/go. Used to
// recognize localhost URLs we wrote earlier without hijacking unrelated local
// services on other ports.
const PATH_PREFIX = new URL(UPSTREAM_ORIGIN).pathname.replace(/\/$/, "") || "/inference/go";

// matches: base_url = "..."  /  OPENAI_BASE_URL = "..."
const BASE_URL_LINE = /^(\s*)(base_url|[A-Z][A-Z0-9_]*BASE_URL)(\s*=\s*")([^"]*)(")/;

function rewrite(value: string): string | null {
  let next: string | null = null;
  if (value.startsWith(UPSTREAM_ORIGIN)) {
    next = PROXY_ORIGIN + value.slice(UPSTREAM_ORIGIN.length);
  } else {
    const local = /^http:\/\/127\.0\.0\.1:(\d+)(\/.*)?$/.exec(value);
    if (local && Number(local[1]) !== PORT && (local[2] ?? "").startsWith(PATH_PREFIX)) {
      next = PROXY_ORIGIN + (local[2] ?? "");
    }
  }
  return next === value ? null : next;
}

export interface SyncResult {
  changed: boolean;
  file?: string;
  backup?: string;
  count?: number;
  reason?: string;
}

export function syncConfig(): SyncResult {
  const file = configPath();
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    return { changed: false, reason: `cannot read ${file}: ${(err as Error).message}` };
  }

  let count = 0;
  const lines = text.split(/\r?\n/).map((line) => {
    const match = BASE_URL_LINE.exec(line);
    if (!match) return line;
    const next = rewrite(match[4]);
    if (next === null) return line;
    count++;
    return `${match[1]}${match[2]}${match[3]}${next}${match[5]}`;
  });

  if (count === 0) return { changed: false, file };

  const backup = `${file}.bak-${NAME}`;
  if (!existsSync(backup)) {
    try {
      copyFileSync(file, backup);
    } catch {}
  }
  writeFileSync(file, lines.join("\n"));
  return { changed: true, file, backup, count };
}
