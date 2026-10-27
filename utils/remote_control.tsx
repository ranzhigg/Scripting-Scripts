import type { AppConfig } from "./config"
import { withTimeout } from "./async"

const REMOTE_REQUEST_TIMEOUT_MS = 8 * 1000
const NEW_MODULE_DISABLE_TIMEOUT_MS = 2500

export type RemoteConnectionResult = {
  latencyMs: number
  enabledCount: number
}

export function getRemoteBaseURL(cfg: AppConfig): string {
  const host = String(cfg.remoteHost ?? "http://127.0.0.1").trim() || "http://127.0.0.1"
  const port = String(cfg.remotePort ?? "").trim()
  return port ? `${host.replace(/\/+$/, "")}:${port}` : ""
}

export function getModuleRemoteName(module: { name: string; surgeName?: string }): string {
  return String(module.surgeName ?? "").trim() || module.name
}

function remoteHeaders(cfg: AppConfig): Record<string, string> {
  return {
    "X-Key": String(cfg.remotePassword ?? ""),
    "Content-Type": "application/json",
  }
}

function parseEnabledNames(data: any): Set<string> {
  const enabled = data?.enabled
  if (Array.isArray(enabled)) {
    return new Set(enabled.map((x) => String(x).trim()).filter(Boolean))
  }
  if (enabled && typeof enabled === "object") {
    return new Set(
      Object.entries(enabled)
        .filter(([, value]) => !!value)
        .map(([key]) => String(key).trim())
        .filter(Boolean)
    )
  }
  return new Set()
}

export async function fetchEnabledModuleNames(cfg: AppConfig): Promise<Set<string>> {
  const baseURL = getRemoteBaseURL(cfg)
  if (!baseURL) return new Set()
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用")

  const res = await withTimeout(
    () => fetchFn(`${baseURL}/v1/modules`, {
      method: "GET",
      headers: remoteHeaders(cfg),
    }),
    REMOTE_REQUEST_TIMEOUT_MS,
    `远程状态请求超时（${REMOTE_REQUEST_TIMEOUT_MS / 1000}s）`,
  )
  if (!res?.ok) throw new Error(`请求失败：${res?.status ?? "unknown"}`)
  const data = await res.json()
  return parseEnabledNames(data)
}

/**
 * Verify the same read endpoint used by the module status badges. Keeping the
 * test on this path avoids claiming that the port is healthy when only a
 * different endpoint happens to respond.
 */
export async function testRemoteConnection(cfg: AppConfig): Promise<RemoteConnectionResult> {
  if (!getRemoteBaseURL(cfg)) throw new Error("请先配置 HTTP 远程控制端口")
  const startedAt = Date.now()
  const enabled = await fetchEnabledModuleNames(cfg)
  return {
    latencyMs: Math.max(0, Date.now() - startedAt),
    enabledCount: enabled.size,
  }
}

export async function setRemoteModuleEnabled(
  cfg: AppConfig,
  moduleName: string,
  enabled: boolean,
  timeoutMs = REMOTE_REQUEST_TIMEOUT_MS,
): Promise<void> {
  const baseURL = getRemoteBaseURL(cfg)
  if (!baseURL) throw new Error("请先配置 HTTP 远程控制端口")
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用")

  const res = await withTimeout(
    () => fetchFn(`${baseURL}/v1/modules`, {
      method: "POST",
      headers: remoteHeaders(cfg),
      body: JSON.stringify({ [moduleName]: enabled }),
    }),
    timeoutMs,
    `远程开关请求超时（${timeoutMs / 1000}s）`,
  )
  if (!res?.ok) throw new Error(`请求失败：${res?.status ?? "unknown"}`)
}

/**
 * A newly written local module must not silently change the active profile.
 * Surge normally keeps a new module disabled; when the file is written through
 * Scripting/iCloud, the HTTP API is used as a best-effort guard for versions
 * that discover the file and enable it during the same refresh.
 *
 * This intentionally does not throw: a missing HTTP API must not make a file
 * import fail, and existing modules are never passed through this helper.
 */
export async function disableNewModuleByDefault(
  cfg: AppConfig,
  moduleName: string,
): Promise<boolean> {
  const name = String(moduleName ?? "").trim()
  if (!name || !getRemoteBaseURL(cfg)) return false
  try {
    await setRemoteModuleEnabled(cfg, name, false, NEW_MODULE_DISABLE_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}
