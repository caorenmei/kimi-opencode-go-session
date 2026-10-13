# opencode-go-session

A [Kimi Code](https://www.kimi.com/code/) plugin that fixes OpenCode Go's
`400 Request is missing x-opencode-session` error when using `opencode-go/*`
models.

[中文说明](#中文说明)

## Why

[OpenCode Go](https://opencode.ai/docs/go/) asks every client to send a stable
per-conversation session id in the `x-opencode-session` request header (routing
and prompt-cache affinity). Kimi Code does not send that header yet, so
`opencode-go` requests fail with 400.

Kimi Code already puts its session id into the request body as
`prompt_cache_key`. This plugin runs a loopback proxy in front of the upstream
and copies that value into the header — nothing needs to be generated, stored,
or kept in sync:

- concurrent sessions send distinct ids (each request carries its own body)
- a resumed session keeps its id
- sessions never regenerate ids

## How it works

```
kimi --(base_url)--> 127.0.0.1:18321 --(https, + x-opencode-session)--> opencode.ai
```

| Event | Hook action |
| --- | --- |
| `SessionStart` | health-check the proxy, spawn it detached if missing, then point every `opencode-go` `base_url` in `config.toml` at the proxy (idempotent; origin only, paths kept) |
| `UserPromptSubmit` | cheap health check; restarts the proxy if it died |

The proxy stamps each request with `x-opencode-session`, resolved from:

1. `body.prompt_cache_key` — Kimi Code's own session id
2. `body.metadata.user_id` — anthropic-protocol requests
3. a persisted fallback id — body-less requests such as `GET /models`

## Install

In Kimi Code:

```
/plugins install https://github.com/caorenmei/opencode-go-session
/reload
```

No manual configuration is required. Use any `opencode-go/*` model as usual.

Requirements: Kimi Code CLI 0.20.2+ (verified on 2.1.1) and Node.js 18+ on
`PATH` (hooks run `node`; Node is also what runs Kimi Code itself).

## Configuration

All optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `KIMI_OPENCODE_GO_PROXY_PORT` | `18321` | Loopback port to listen on and point `base_url` at |
| `KIMI_OPENCODE_GO_UPSTREAM` | `https://opencode.ai` | Upstream origin to forward to |
| `KIMI_OPENCODE_GO_PROXY_IDLE_MS` | `43200000` (12h) | Idle time before the proxy exits by itself |

If the port clashes with another program, set `KIMI_OPENCODE_GO_PROXY_PORT` to
a free port and `/reload`; the next hook run rewrites `config.toml` to the new
port automatically. The plugin never repoints `config.toml` at a port it does
not own.

## Uninstall

1. `/plugins remove opencode-go-session`, then `/reload`
2. Restore `~/.kimi-code/config.toml.bak-opencode-go-session` over
   `~/.kimi-code/config.toml` (created once, before the plugin's first rewrite)
3. The proxy exits on its own after the idle timeout

## Troubleshooting

```bash
curl http://127.0.0.1:18321/__opencode-go-session/health
# {"name":"opencode-go-session","version":"1.1.0","pid":...,"upstream":"https://opencode.ai"}
```

Runtime state lives in `$KIMI_CODE_HOME/opencode-go-session/`:

- `proxy.log` — one line per proxied request, including the injected id
- `plugin.log` — hook diagnostics (hooks never print to stdout, since hook
  stdout can be appended to the model context)
- `default-id` — the fallback id

## Development

Sources are TypeScript (`src/`); the compiled output (`dist/`) is committed so
the plugin runs without a build step after installation.

```bash
npm install
npm run build
```

There are no runtime dependencies — only Node.js built-ins.

## Notes

- The proxy binds `127.0.0.1` only. Your API key travels over loopback in
  cleartext to a process you own; nothing extra leaves the machine.
- Response bodies (including long SSE streams) are piped through untouched;
  socket timeouts are disabled so long generations are not cut off.
- Only requests whose configured `base_url` was rewritten pass through the
  proxy. Other providers are never touched.

## License

[MIT](./LICENSE)

---

## 中文说明

修复 Kimi Code 调用 OpenCode Go 模型（`opencode-go/*`）时的
`400 Request is missing x-opencode-session` 报错。

原理：Kimi Code 的请求体里本来就带有 `prompt_cache_key`（即会话 id）。本插件在本机回环
地址（默认 `127.0.0.1:18321`）运行一个代理，把 `config.toml` 中 `opencode-go` 的
`base_url` 自动指向代理，代理逐请求把该会话 id 透传为 `x-opencode-session` 头：

- 并发会话各自不同（每个请求按自己的 body 取值，无共享状态）
- 恢复会话时值不变，从不重复生成
- 其它 provider 完全不经过代理

安装（在 Kimi Code 中执行）：

```
/plugins install https://github.com/caorenmei/opencode-go-session
/reload
```

无需任何手工配置。如遇端口冲突，设置环境变量 `KIMI_OPENCODE_GO_PROXY_PORT` 后 `/reload`，
配置会自动迁移到新端口。排错日志在 `~/.kimi-code/opencode-go-session/`（`proxy.log` /
`plugin.log`）。卸载见上文 Uninstall。许可：MIT。
