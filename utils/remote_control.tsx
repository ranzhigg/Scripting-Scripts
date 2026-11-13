import type { AppConfig } from "./config"
import { withTimeout } from "./async"

const REMOTE_REQUEST_TIMEOUT_MS = 8 * 1000
const NEW_MODULE_DISABLE_TIMEOUT_MS = 2500
const REMOTE_API_PREFIX = "/v1"

export type RemoteConnectionResult = {
  latencyMs: number
  enabledCount: number
}

export type CaptureFilterScope = "in-memory" | "on-disk"
export type CaptureFilterType = "off" | "with-keywords" | "without-keywords" | "pattern"

export type CaptureFilter = {
  httpOnly?: boolean
  hideCrashReporterRequests?: boolean
  hideAppleRequests?: boolean
  hideUDP?: boolean
  type?: CaptureFilterType
  keywords?: string[]
  disabledKeywords?: string[]
}

export type CaptureFiltersResponse = {
  active?: CaptureFilterScope
  filters?: Partial<Record<CaptureFilterScope, CaptureFilter>>
}

export type CaptureSession = {
  name: string
  active?: boolean
  requestCount?: number
  size?: number
  endReason?: string
}

export type SurgePoliciesResponse = {
  proxies?: string[]
  "policy-groups"?: string[]
  "external-policies"?: { name?: string; group?: string; identifier?: string }[]
}

export function getRemoteBaseURL(cfg: AppConfig): string {
  const rawHost = String(cfg.remoteHost ?? "http://127.0.0.1").trim() || "http://127.0.0.1"
  const port = String(cfg.remotePort ?? "").trim()

  let parsed: URL
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(rawHost) ? rawHost : `http://${rawHost}`)
  } catch {
    throw new Error("Surge HTTP API 地址不是有效 URL")
  }
  if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    throw new Error("Surge HTTP API 端口必须是 1–65535")
  }
  // Accept either the host form or a previously copied `/v1` API URL. Keep
  // the origin only so every endpoint is composed exactly once.
  parsed.pathname = ""
  parsed.search = ""
  parsed.hash = ""
  if (!parsed.port && !port) return ""
  if (!parsed.port) parsed.port = port
  if (parsed.username || parsed.password) throw new Error("Surge HTTP API 地址不能包含账号或密码")
  return parsed.toString().replace(/\/$/, "")
}

export function getRemoteAPIURL(cfg: AppConfig, path: string): string {
  const base = getRemoteBaseURL(cfg)
  if (!base) return ""
  const suffix = String(path ?? "").trim()
  if (!suffix) return `${base}${REMOTE_API_PREFIX}`
  return `${base}${suffix === "/v1" || suffix.startsWith("/v1/") ? suffix : `${REMOTE_API_PREFIX}/${suffix.replace(/^\/+/, "")}`}`
}

export function getModuleRemoteName(module: { name: string; surgeName?: string }): string {
  return String(module.surgeName ?? "").trim() || module.name
}

function remoteHeaders(cfg: AppConfig): Record<string, string> {
  const key = String(cfg.remotePassword ?? "")
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  if (cfg.remoteAuthMode === "bearer") headers.Authorization = `Bearer ${key}`
  else headers["X-Key"] = key
  return headers
}

async function remoteRequest(
  cfg: AppConfig,
  path: string,
  init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
  timeoutMs = REMOTE_REQUEST_TIMEOUT_MS,
): Promise<any> {
  const url = getRemoteAPIURL(cfg, path)
  if (!url) throw new Error("请先配置 Surge HTTP API 地址和端口")
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用")
  const res = await withTimeout(
    () => fetchFn(url, {
      method: init.method ?? "GET",
      headers: remoteHeaders(cfg),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
    timeoutMs,
    `Surge HTTP API 请求超时（${timeoutMs / 1000}s）：${path}`,
  )
  let data: any = null
  try { data = await res.json() } catch {}
  if (!res?.ok) {
    const detail = data?.error ? `：${String(data.error)}` : ""
    throw new Error(`Surge HTTP API ${res?.status ?? "unknown"}${detail}`)
  }
  return data
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
  if (!getRemoteBaseURL(cfg)) return new Set()
  const data = await remoteRequest(cfg, "/modules")
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
  await remoteRequest(cfg, "/modules", {
    method: "POST",
    body: { [moduleName]: enabled },
  }, timeoutMs)
}

export async function fetchSurgePolicies(cfg: AppConfig): Promise<SurgePoliciesResponse> {
  return await remoteRequest(cfg, "/policies")
}

export async function fetchAvoidedPolicies(cfg: AppConfig): Promise<Set<string>> {
  const data = await remoteRequest(cfg, "/policies/avoided")
  return new Set(Array.isArray(data?.policies) ? data.policies.map((item: any) => String(item).trim()).filter(Boolean) : [])
}

export async function setPolicyAvoided(
  cfg: AppConfig,
  policyName: string,
  avoided: boolean,
): Promise<Set<string>> {
  const name = String(policyName ?? "").trim()
  if (!name) throw new Error("策略名称为空")
  const data = await remoteRequest(cfg, "/policies/avoided", {
    method: "POST",
    body: { policy_name: name, avoided },
  })
  return new Set(Array.isArray(data?.policies) ? data.policies.map((item: any) => String(item).trim()).filter(Boolean) : [])
}

export async function fetchCaptureFilters(cfg: AppConfig): Promise<CaptureFiltersResponse> {
  return await remoteRequest(cfg, "/capture/filters")
}

export async function setCaptureFilter(
  cfg: AppConfig,
  scope: CaptureFilterScope,
  filter: CaptureFilter,
): Promise<CaptureFilter> {
  const data = await remoteRequest(cfg, "/capture/filters", {
    method: "POST",
    body: { scope, ...filter },
  })
  return data?.filter ?? data
}

export async function fetchCaptureEnabled(cfg: AppConfig): Promise<boolean> {
  const data = await remoteRequest(cfg, "/features/capture")
  return !!data?.enabled
}

export async function setCaptureEnabled(cfg: AppConfig, enabled: boolean): Promise<boolean> {
  const data = await remoteRequest(cfg, "/features/capture", {
    method: "POST",
    body: { enabled },
  })
  return !!data?.enabled
}

export async function fetchCaptureSessions(cfg: AppConfig): Promise<CaptureSession[]> {
  const data = await remoteRequest(cfg, "/capture/sessions")
  return Array.isArray(data?.sessions) ? data.sessions : []
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

/**
 * Force Surge to reread a module from its iCloud file after Scripting rewrites
 * it. The HTTP API exposes module enable/disable rather than a separate
 * reload endpoint, so only an already-enabled module is toggled and it is
 * restored to the same enabled state. Disabled modules are left untouched.
 */
export async function refreshEnabledRemoteModule(
  cfg: AppConfig,
  moduleName: string,
): Promise<boolean> {
  const name = String(moduleName ?? "").trim()
  if (!name || !getRemoteBaseURL(cfg) || !String(cfg.remotePassword ?? "").trim()) return false

  const enabled = await fetchEnabledModuleNames(cfg)
  if (!enabled.has(name)) return false

  await setRemoteModuleEnabled(cfg, name, false)
  try {
    await setRemoteModuleEnabled(cfg, name, true)
  } catch (error) {
    // A transient API failure after the disable must not leave a previously
    // enabled module silently off; make one best-effort recovery attempt.
    try { await setRemoteModuleEnabled(cfg, name, true) } catch {}
    throw error
  }
  return true
}
