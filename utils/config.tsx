export type AppConfig = {
  baseDir: string
  baseBookmarkName: string
  categories: string[]
  linkPatternsText: string
  downloadConcurrency: number
  /** Download remote module resources beside the local module. */
  localizeScriptsOnDownload: boolean
  iCloudMetadataSync: boolean
  remoteHost: string
  remotePort: string
  remotePassword: string
}

const KEY = "surge_modules_manager_cfg_v1"

const DEFAULT_CONFIG: AppConfig = {
  baseDir: "",
  baseBookmarkName: "",
  categories: [],
  linkPatternsText: "#!url=",
  downloadConcurrency: 3,
  localizeScriptsOnDownload: false,
  iCloudMetadataSync: false,
  remoteHost: "http://127.0.0.1",
  remotePort: "6171",
  remotePassword: "",
}

function normalizeDownloadConcurrency(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return DEFAULT_CONFIG.downloadConcurrency
  return Math.max(1, Math.min(10, Math.round(num)))
}

function normalizeCategories(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list ?? []) {
    const name = String(raw ?? "").trim()
    if (!name) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function loadConfig(): AppConfig {
  const st: any = (globalThis as any).Storage
  try {
    const raw = st?.get?.(KEY) ?? st?.getString?.(KEY)
    if (!raw) return DEFAULT_CONFIG
    // Scripting Storage.set/get supports JSON values directly. Older builds
    // of this script stored a JSON string, so accept both representations.
    // Parsing every value as a string silently discarded a valid bookmark
    // configuration and made imports fall back to Scripting's own iCloud
    // directory instead of the Surge bookmark.
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return DEFAULT_CONFIG
    const categories = normalizeCategories(obj?.categories ?? [])
    const baseDir = String(obj?.baseDir ?? "").trim()
    const baseBookmarkName = String(obj?.baseBookmarkName ?? "").trim()
    const linkPatternsText = String(obj?.linkPatternsText ?? DEFAULT_CONFIG.linkPatternsText)
    const downloadConcurrency = normalizeDownloadConcurrency(obj?.downloadConcurrency)
    const localizeScriptsOnDownload = !!obj?.localizeScriptsOnDownload
    const iCloudMetadataSync = !!obj?.iCloudMetadataSync
    const remoteHost = String(obj?.remoteHost ?? DEFAULT_CONFIG.remoteHost).trim() || DEFAULT_CONFIG.remoteHost
    const remotePort = String(obj?.remotePort ?? DEFAULT_CONFIG.remotePort).trim() || DEFAULT_CONFIG.remotePort
    const remotePassword = String(obj?.remotePassword ?? "")
    return {
      ...DEFAULT_CONFIG,
      ...obj,
      categories,
      baseDir,
      baseBookmarkName,
      linkPatternsText,
      downloadConcurrency,
      localizeScriptsOnDownload,
      iCloudMetadataSync,
      remoteHost,
      remotePort,
      remotePassword,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(cfg: AppConfig): void {
  const st: any = (globalThis as any).Storage
  const fixed: AppConfig = {
    baseDir: String(cfg.baseDir ?? "").trim(),
    baseBookmarkName: String(cfg.baseBookmarkName ?? "").trim(),
    categories: normalizeCategories(cfg.categories ?? []),
    linkPatternsText: String(cfg.linkPatternsText ?? DEFAULT_CONFIG.linkPatternsText),
    downloadConcurrency: normalizeDownloadConcurrency(cfg.downloadConcurrency),
    localizeScriptsOnDownload: !!cfg.localizeScriptsOnDownload,
    iCloudMetadataSync: !!cfg.iCloudMetadataSync,
    remoteHost: String(cfg.remoteHost ?? DEFAULT_CONFIG.remoteHost).trim() || DEFAULT_CONFIG.remoteHost,
    remotePort: String(cfg.remotePort ?? DEFAULT_CONFIG.remotePort).trim() || DEFAULT_CONFIG.remotePort,
    remotePassword: String(cfg.remotePassword ?? ""),
  }
  if (st?.set) {
    // Storage officially supports JSON values and returns a success flag.
    // Keep the object typed in the current format; loadConfig still accepts
    // the JSON string used by older builds.
    const ok = st.set(KEY, fixed)
    if (ok === false) throw new Error("Storage.set 保存配置失败")
  } else if (st?.setString) {
    const ok = st.setString(KEY, JSON.stringify(fixed))
    if (ok === false) throw new Error("Storage.setString 保存配置失败")
  } else {
    throw new Error("Storage API 不存在：请确认 Scripting 是否提供 Storage.set/get")
  }
}

export function addCategory(cfg: AppConfig, name: string): AppConfig {
  const categories = normalizeCategories([...(cfg.categories ?? []), name])
  return { ...cfg, categories }
}

/**
 * Persist a category discovered or entered outside the settings form.
 * Imports run through a headless Intent path, so they cannot wait for the
 * settings page's Save button before making a new category available.
 */
export function persistCategory(name: string): AppConfig {
  const category = String(name ?? "").trim()
  const current = loadConfig()
  if (!category || current.categories.includes(category)) return current
  const next = addCategory(current, category)
  saveConfig(next)
  return next
}
