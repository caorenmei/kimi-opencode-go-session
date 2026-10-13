// opencode-go-session proxy
//
// Loopback proxy that forwards requests to the OpenCode Go upstream and adds
// the x-opencode-session header it requires. Header value is taken per request
// from the caller's session identifier, so concurrent sessions differ and a
// resumed session keeps its id:
//   1. body.prompt_cache_key   (Kimi Code puts its session id here)
//   2. body.metadata.user_id   (anthropic-protocol requests)
//   3. a persisted fallback id (generated once) for body-less requests
import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { NAME, VERSION, PORT, UPSTREAM_ORIGIN, HEALTH_PATH, IDLE_EXIT_MS, stateDir, } from "./config.js";
const STATE_DIR = stateDir();
const LOG_FILE = join(STATE_DIR, "proxy.log");
mkdirSync(STATE_DIR, { recursive: true });
function log(...args) {
    try {
        appendFileSync(LOG_FILE, new Date().toISOString() + " " + args.join(" ") + "\n");
    }
    catch { }
}
let fallbackId = "";
try {
    fallbackId = readFileSync(join(STATE_DIR, "default-id"), "utf8").trim();
}
catch { }
if (!fallbackId) {
    fallbackId = crypto.randomUUID();
    try {
        writeFileSync(join(STATE_DIR, "default-id"), fallbackId);
    }
    catch { }
}
const upstream = new URL(UPSTREAM_ORIGIN);
const transport = upstream.protocol === "http:" ? http : https;
const agent = new transport.Agent({ keepAlive: true });
let lastActivity = Date.now();
const server = http.createServer((req, res) => {
    if (req.url === HEALTH_PATH) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: NAME, version: VERSION, pid: process.pid, upstream: UPSTREAM_ORIGIN }));
        return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
        lastActivity = Date.now();
        const body = Buffer.concat(chunks);
        let sessionId;
        if (body.length > 0 && String(req.headers["content-type"] || "").includes("json")) {
            try {
                const parsed = JSON.parse(body.toString("utf8"));
                sessionId = parsed.prompt_cache_key ?? parsed.metadata?.user_id;
            }
            catch { }
        }
        const headerValue = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : fallbackId;
        const headers = {
            ...req.headers,
            host: upstream.host,
            "x-opencode-session": headerValue,
        };
        delete headers["connection"];
        const upstreamReq = transport.request({
            hostname: upstream.hostname,
            port: upstream.port || undefined,
            path: req.url,
            method: req.method,
            headers: headers,
            agent,
        }, (up) => {
            res.writeHead(up.statusCode ?? 502, up.headers);
            up.pipe(res);
        });
        upstreamReq.setTimeout(0);
        upstreamReq.on("error", (err) => {
            log("upstream error:", err.message);
            if (!res.headersSent)
                res.writeHead(502);
            res.end(`${NAME} proxy: upstream error: ${err.message}`);
        });
        upstreamReq.write(body);
        upstreamReq.end();
        log(req.method, req.url, "-> x-opencode-session:", headerValue);
    });
});
// LLM streams can run for many minutes; disable all socket timeouts.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.on("error", (err) => {
    log("listen failed:", err.message);
    process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
    log(`listening on 127.0.0.1:${PORT} -> ${UPSTREAM_ORIGIN} (pid ${process.pid})`);
});
setInterval(() => {
    if (Date.now() - lastActivity > IDLE_EXIT_MS) {
        log("idle timeout reached, exiting");
        process.exit(0);
    }
}, 5 * 60 * 1000).unref();
