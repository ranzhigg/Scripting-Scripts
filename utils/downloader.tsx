import { Path } from "scripting"
import { loadConfig } from "./config"
import {
  formatLinkLine,
  getLinkPrefixes,
  moduleFilePath,
  ensureStorage,
  type ModuleInfo,
  getModulesDirResolved,
  requireSurgeProfileDir,
} from "./storage"
import { downloadWithProgress } from "./stream_downloader"
import { validateSurgeModuleText } from "./module_validation"
import { withTimeout } from "./async"
import { backupModulePath } from "./backups"
import { localizeModuleResources } from "./script_localizer"

export type DownloadModuleOptions = {
  mode?: "stream" | "direct"
  /** Raw remote text already fetched by the update preview flow. */
  content?: string
  /** Override the global setting for this one write. */
  localizeResources?: boolean
  /** Preserve local-file import semantics and metadata. */
  isLocal?: boolean
}

const FETCH_TIMEOUT_MS = 30 * 1000
const FILE_OPERATION_TIMEOUT_MS = 15 * 1000

async function writeString(fm: any, path: string, content: string): Promise<void> {
  const writer = typeof fm?.writeAsString === "function"
    ? fm.writeAsString
    : fm?.writeAsStringSync
  if (typeof writer !== "function") throw new Error("FileManager.writeAsString 不可用")
  const result = writer.call(fm, path, content)
  if (result && typeof result.then === "function") await result
  if (result === false) throw new Error(`FileManager 拒绝写入：${path}`)
}

function fetchTimeoutMessage(url: string): string {
  if (/^https?:\/\/script\.hub(?:\/|$)/i.test(url)) {
    return `Script-Hub 转换结果请求超时（${FETCH_TIMEOUT_MS / 1000}s）。script.hub/file 或 convert 不是普通公网下载地址，必须确认当前 Scripting 流量经过 Surge，且 Script Hub 模块和脚本均已启用`
  }
  return `模块请求超时（${FETCH_TIMEOUT_MS / 1000}s）：${url}`
}

function injectNameFlag(content: string): string {
  if (content.includes("🔗")) return content
  return content.replace(/#!\s*name\s*=/i, "#!name=🔗")
}

function upsertMetadataLine(content: string, key: string, value?: string): string {
  const trimmed = String(value ?? "").trim()
  const line = `#!${key}=${trimmed}`
  const re = new RegExp(`^\\s*#!\\s*${key}\\s*=.*$`, "i")
  const lines = String(content ?? "").split(/\r?\n/g)
  let inserted = false
  const next: string[] = []
  for (const item of lines) {
    if (re.test(item)) {
      if (trimmed && !inserted) {
        next.push(line)
        inserted = true
      }
      continue
    }
    next.push(item)
  }
  if (trimmed && !inserted) next.unshift(line)
  return next.join("\n")
}

function injectCategory(content: string, category?: string): string {
  const cat = String(category ?? "").trim()
  // An absent category means “keep the source module's own category”. This
  // matters for Script-Hub output that already carries its native category.
  if (!cat) return content
  return upsertMetadataLine(content, "category", cat)
}

function injectSourceURL(content: string, sourceURL?: string): string {
  const value = String(sourceURL ?? "").trim()
  if (!value) return content
  return upsertMetadataLine(content, "source-url", value)
}

function injectLocalFlag(content: string): string {
  return upsertMetadataLine(content, "local", "true")
}

function prepareLocalModuleText(
  rawText: string,
  info: ModuleInfo & { linkPrefix?: string },
): string {
  let content = validateSurgeModuleText(rawText)
  content = injectLocalFlag(content)
  content = injectCategory(content, info.category)
  content = injectSourceURL(content, info.sourceURL)
  return content
}

function prepareModuleText(
  rawText: string,
  info: ModuleInfo & { linkPrefix?: string },
): string {
  const safeText = validateSurgeModuleText(rawText)
  let content = injectNameFlag(safeText)
  content = injectUrl(content, info.link, info.linkPrefix)
  content = injectCategory(content, info.category)
  content = injectSourceURL(content, info.sourceURL)
  return content
}

function injectUrl(content: string, url?: string, preferredPrefix?: string): string {
  const u = String(url ?? "").trim()
  if (!u) return content
  const prefixes = getLinkPrefixes()
  const first = preferredPrefix && prefixes.includes(preferredPrefix) ? preferredPrefix : prefixes[0] ?? "#url="
  const lines = String(content ?? "").split(/\r?\n/g)
  const filtered = lines.filter((line) => {
    const t = line.trimStart()
    return !prefixes.some((p) => t.startsWith(p))
  })
  return `${formatLinkLine(first, u)}\n${filtered.join("\n")}`
}

async function fetchModuleText(url: string): Promise<string> {
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用")

  const controller = typeof AbortController === "function" ? new AbortController() : undefined
  const isScriptHubHttp = /^http:\/\/script\.hub(?:\/|$)/i.test(url)
  try {
    return await withTimeout(
      async () => {
        const requestInit: any = {
          headers: {
            // Match Scriptable's SurgeModuleTool request.  The Script-Hub
            // converter is exposed through Surge's local `script.hub` route;
            // keeping its expected UA avoids a host-specific rewrite branch.
            "User-Agent": "script-hub/1.0.0",
            Accept: "*/*",
          },
          // Script-Hub's iOS-facing endpoint is intentionally HTTP and is
          // resolved by the iOS Surge module. Scripting otherwise rejects an
          // insecure request before it can reach that local route.
          ...(isScriptHubHttp ? { allowInsecureRequest: true } : {}),
          timeout: FETCH_TIMEOUT_MS / 1000,
          debugLabel: isScriptHubHttp ? "Script-Hub 转换模块" : "Surge 模块更新",
          ...(controller ? { signal: controller.signal } : {}),
        }
        // Scriptable uses `new Request(url)` followed by `loadString()`. Use
        // Scripting's Request object when available as the closest equivalent;
        // retain the plain-fetch fallback for older Scripting runtimes.
        const RequestCtor: any = (globalThis as any).Request
        const request = typeof RequestCtor === "function"
          ? new RequestCtor(url, requestInit)
          : null
        const res = request ? await fetchFn(request) : await fetchFn(url, requestInit)
        const status = Number(res?.status ?? 0)
        if (status < 200 || status >= 400) {
          throw new Error(`HTTP ${res?.status ?? "unknown"} ${res?.statusText ?? ""}`.trim())
        }
        if (typeof res.text !== "function") throw new Error("Response.text 不可用")
        return String(await res.text())
      },
      FETCH_TIMEOUT_MS,
      fetchTimeoutMessage(url),
    )
  } catch (e: any) {
    try { controller?.abort() } catch {}
    throw e
  }
}

async function writeFinalModule(
  fm: any,
  info: ModuleInfo & { linkPrefix?: string },
  targetDir: string,
  rawText: string,
  options: Pick<DownloadModuleOptions, "localizeResources"> = {},
): Promise<{ path: string; localizedResources: number }> {
  const preparedContent = prepareModuleText(rawText, info)
  const path = moduleFilePath(info.name, targetDir)
  const shouldLocalize = options.localizeResources ?? loadConfig().localizeScriptsOnDownload
  // Every write is guarded, even when resource localization is disabled. The
  // guard returns the actual iCloud Drive/Surge root; local resources must be
  // written there because Surge does not reliably discover nested paths.
  const surgeRoot = await requireSurgeProfileDir(targetDir)
  const localized = shouldLocalize
    ? await localizeModuleResources(preparedContent, info, path, surgeRoot)
    : null
  const content = localized?.content ?? preparedContent

  try {
    await backupModulePath(path)
    await withTimeout(
      () => writeString(fm, path, content),
      FILE_OPERATION_TIMEOUT_MS,
      `写入模块超时（${FILE_OPERATION_TIMEOUT_MS / 1000}s）：${path}`,
    )
    // File-provider bookmarks may accept a write request before the provider
    // has actually committed it. Read the file back when supported so an
    // import cannot report success while nothing reached Surge's directory.
    if (typeof fm.readAsString === "function") {
      const saved = String(
        await withTimeout(
          () => fm.readAsString(path),
          FILE_OPERATION_TIMEOUT_MS,
          `写入校验超时（${FILE_OPERATION_TIMEOUT_MS / 1000}s）：${path}`,
        ),
      )
      if (saved !== content) throw new Error(`写入后校验失败：${path}`)
    }
    return { path, localizedResources: localized?.localizedCount ?? 0 }
  } catch (error) {
    if (localized) await localized.rollback()
    throw error
  }
}

/**
 * Write already available module text into the selected Surge bookmark.
 * This is intentionally separate from downloadModule so a local .sgmodule
 * shared from Files can bypass the network and script.hub entirely.
 */
export async function writeModuleText(
  info: ModuleInfo & { linkPrefix?: string },
  targetDir: string,
  rawText: string,
  options: Pick<DownloadModuleOptions, "localizeResources" | "isLocal"> = {},
): Promise<{ ok: boolean; message?: string; path?: string; localizedResources?: number }> {
  const fm: any = (globalThis as any).FileManager
  if (!fm?.writeAsString) return { ok: false, message: "FileManager.writeAsString 不可用" }
  try {
    // A file shared from Files is already the converted module. Keep its
    // metadata byte-for-byte unless the optional script-localization switch is
    // enabled; that switch only rewrites recognized remote module resources.
    const preparedContent = options.isLocal
      ? prepareLocalModuleText(rawText, info)
      : validateSurgeModuleText(rawText)
    const path = moduleFilePath(info.name, targetDir)
    const shouldLocalize = options.localizeResources ?? loadConfig().localizeScriptsOnDownload
    const surgeRoot = await requireSurgeProfileDir(targetDir)
    const localized = shouldLocalize
      ? await localizeModuleResources(preparedContent, info, path, surgeRoot)
      : null
    const content = localized?.content ?? preparedContent
    try {
      await backupModulePath(path)
      await withTimeout(
        () => writeString(fm, path, content),
        FILE_OPERATION_TIMEOUT_MS,
        `写入本地模块超时（${FILE_OPERATION_TIMEOUT_MS / 1000}s）：${path}`,
      )
      if (typeof fm.readAsString === "function") {
        const saved = String(
          await withTimeout(
            () => fm.readAsString(path),
            FILE_OPERATION_TIMEOUT_MS,
            `本地模块校验超时（${FILE_OPERATION_TIMEOUT_MS / 1000}s）：${path}`,
          ),
        )
        if (saved !== content) throw new Error(`写入后校验失败：${path}`)
      }
      return { ok: true, path, localizedResources: localized?.localizedCount ?? 0 }
    } catch (error) {
      if (localized) await localized.rollback()
      throw error
    }
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? e) }
  }
}

async function downloadModuleDirect(
  fm: any,
  info: ModuleInfo & { linkPrefix?: string },
  targetDir: string,
  sourceContent?: string,
  options: Pick<DownloadModuleOptions, "localizeResources"> = {},
): Promise<{ path: string; localizedResources: number }> {
  const text = sourceContent ?? await fetchModuleText(info.link)
  return writeFinalModule(fm, info, targetDir, text, options)
}

async function downloadModuleStream(
  fm: any,
  info: ModuleInfo & { linkPrefix?: string },
  targetDir: string,
  sourceContent?: string,
  options: Pick<DownloadModuleOptions, "localizeResources"> = {},
): Promise<{ path: string; localizedResources: number }> {
  if (sourceContent !== undefined) {
    return writeFinalModule(fm, info, targetDir, sourceContent, options)
  }
  const tmpDir = fm.temporaryDirectory ?? Path.join(Path.dirname(moduleFilePath(info.name, targetDir)), ".tmp")
  const tmpPath = Path.join(tmpDir, `${info.name}_${Date.now()}.tmp`)

  try {
    await downloadWithProgress(info.link, tmpPath)
  } catch (e: any) {
    throw new Error(`下载失败: ${String(e?.message ?? e)}`)
  }

  let text = ""
  try {
    text = await fm.readAsString(tmpPath)
  } catch (e: any) {
    throw new Error(`读取文件失败: ${String(e?.message ?? e)}`)
  }

  try {
    return await writeFinalModule(fm, info, targetDir, text, options)
  } finally {
    try {
      if (typeof fm.remove === "function") await fm.remove(tmpPath)
      else if (typeof fm.removeSync === "function") fm.removeSync(tmpPath)
    } catch {}
  }
}

export async function downloadModule(
  info: ModuleInfo & { linkPrefix?: string },
  options: DownloadModuleOptions = {}
): Promise<{ ok: boolean; message?: string; path?: string; localizedResources?: number }> {
  await ensureStorage()

  const fm: any = (globalThis as any).FileManager
  if (!fm?.writeAsString) {
    return { ok: false, message: "FileManager.writeAsString 不可用" }
  }
  if (options.mode !== "direct" && !fm?.readAsString) {
    return { ok: false, message: "FileManager.readAsString 不可用" }
  }

  const targetDir = info.saveDir ?? (await getModulesDirResolved())
  // Validate before fetching. A failed/stale bookmark must never cause a
  // network request followed by a write into the Scripting private folder.
  await requireSurgeProfileDir(targetDir)
  const localizeResources = options.localizeResources ?? loadConfig().localizeScriptsOnDownload
  try {
    let result: { path: string; localizedResources: number }
    if (options.mode === "direct") {
      result = await downloadModuleDirect(fm, info, targetDir, options.content, {
        localizeResources,
      })
    } else {
      result = await downloadModuleStream(fm, info, targetDir, options.content, {
        localizeResources,
      })
    }
    return { ok: true, path: result.path, localizedResources: result.localizedResources }
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? e) }
  }
}

export type ModuleUpdatePreview = {
  path: string
  sourceContent: string
  currentContent: string
  nextContent: string
  changed: boolean
  addedCount: number
  removedCount: number
  added: string[]
  removed: string[]
}

function normalizePreviewText(value: string): string {
  return String(value ?? "").replace(/\r\n/g, "\n")
}

/** Fetch and prepare a remote module without writing it to disk. */
export async function previewModuleUpdate(
  info: ModuleInfo & { linkPrefix?: string },
): Promise<ModuleUpdatePreview> {
  if (!info.link) throw new Error("本地模块无下载链接，无法预览更新")
  const fm: any = (globalThis as any).FileManager
  if (!fm?.readAsString) throw new Error("FileManager.readAsString 不可用")

  const sourceContent = await fetchModuleText(info.link)
  const nextContent = prepareModuleText(sourceContent, info)
  const path = info.filePath ?? moduleFilePath(info.name, info.saveDir)
  let currentContent = ""
  if (typeof fm.exists !== "function" || await fm.exists(path)) {
    currentContent = normalizePreviewText(await fm.readAsString(path))
  }

  const oldLines = currentContent.split("\n")
  const nextLines = normalizePreviewText(nextContent).split("\n")
  const oldSet = new Set(oldLines)
  const nextSet = new Set(nextLines)
  const addedAll = nextLines.filter((line) => line.trim() && !oldSet.has(line))
  const removedAll = oldLines.filter((line) => line.trim() && !nextSet.has(line))

  return {
    path,
    sourceContent,
    currentContent,
    nextContent,
    changed: currentContent !== normalizePreviewText(nextContent),
    addedCount: addedAll.length,
    removedCount: removedAll.length,
    added: addedAll.slice(0, 12),
    removed: removedAll.slice(0, 12),
  }
}
