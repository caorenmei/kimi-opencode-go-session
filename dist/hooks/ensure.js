// Hook entry point: make sure the proxy is running, and (on session start)
// that config.toml points at it.
//
// Usage: node ./dist/hooks/ensure.js [sync-config]
//
// Always exits 0 and prints nothing on stdout: hook stdout can end up in the
// model context, so all reporting goes to the plugin log instead.
import { spawn } from "node:child_process";
import http from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NAME, PORT, HEALTH_PATH, stateDir } from "../config.js";
const SYNC = process.argv.includes("sync-config");
const STATE_DIR = stateDir();
const LOG_FILE = join(STATE_DIR, "plugin.log");
const PROXY_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "proxy.js");
function log(...args) {
    try {
        mkdirSync(STATE_DIR, { recursive: true });
        appendFileSync(LOG_FILE, new Date().toISOString() + " " + args.join(" ") + "\n");
    }
    catch { }
}
function health() {
    return new Promise((resolve) => {
        const req = http.get({ host: "127.0.0.1", port: PORT, path: HEALTH_PATH, timeout: 800 }, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve(parsed.name === NAME ? { ours: true, version: parsed.version } : { ours: false });
                }
                catch {
                    resolve({ ours: false });
                }
            });
        });
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", (err) => resolve({ error: err.code || err.message }));
    });
}
async function main() {
    let state = await health();
    if (!state.ours) {
        if (state.error === "ECONNREFUSED" || state.error === "timeout") {
            const child = spawn(process.execPath, [PROXY_PATH], {
                detached: true,
                stdio: "ignore",
                windowsHide: true,
            });
            child.unref();
            for (let i = 0; i < 10; i++) {
                await new Promise((r) => setTimeout(r, 150));
                state = await health();
                if (state.ours)
                    break;
            }
            log(state.ours ? `started proxy (v${state.version}) on port ${PORT}` : "proxy did not come up");
        }
        else {
            // Something else owns the port. Do not touch config.toml: a wrong port
            // would break opencode-go entirely. Set KIMI_OPENCODE_GO_PROXY_PORT to a
            // free port and reload.
            log(`port ${PORT} is occupied by another program (${state.error ?? "unexpected response"}); ` +
                "set KIMI_OPENCODE_GO_PROXY_PORT to a free port and reload");
            return;
        }
    }
    if (SYNC && state.ours) {
        const { syncConfig } = await import("../sync-config.js");
        const result = syncConfig();
        if (result.changed) {
            log(`config.toml updated: ${result.count} endpoint(s) -> 127.0.0.1:${PORT}`);
        }
        else if (result.reason) {
            log(result.reason);
        }
    }
}
main()
    .catch((err) => log("ensure failed:", err?.message ?? String(err)))
    .finally(() => process.exit(0));
