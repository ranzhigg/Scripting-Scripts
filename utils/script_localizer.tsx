import { Path } from "scripting"

import { withTimeout } from "./async"
import {
  extractRemoteModuleResourceReferences,
  relativeProfilePath,
  rewriteRemoteModuleResources,
  type RemoteModuleResourceReference,
} from "./script_localizer_core"
import type { ModuleInfo } from "./storage"

const RESOURCE_FETCH_TIMEOUT_MS = 30 * 1000
const RESOURCE_FILE_OPERATION_TIMEOUT_MS = 15 * 1000
const MAX_RESOURCE_CHARS = 20 * 1024 * 1024
const RESOURCE_DIRECTORY = ".scripting-resources"

export type ScriptLocalizationResult = {
  content: string
  localizedCount: number
  scriptCount: number
  ruleSetCount: number
  domainSetCount: number
  includeCount: number
  resourceURLs: string[]
  rollback: () => Promise<void>
}

type FileChange = {
  path: string
  existed: boolean
  previous?: string
}

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (const char of String(value ?? "")) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8)
}

function safeSegment(value: string, fallback: string): string {
  const fixed = String(value ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 80)
  return fixed || fallback
}

function resourceFileName(url: string, kind: RemoteModuleResourceReference["kind"]): string {
  const fallback = kind === "script" ? "script.js" : kind === "include" ? "include.conf" : "rules.list"
  let last = fallback
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.split("/").pop() ?? ""
    if (path) last = decodeURIComponent(path)
  } catch {}

  const defaultExtension = kind === "script" ? ".js" : kind === "include" ? ".conf" : ".list"
  const extension = last.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? defaultExtension
  const stem = last.replace(/\.[A-Za-z0-9]{1,8}$/, "") || kind
  return `${safeSegment(stem, kind)}-${shortHash(`${kind}:${url}`)}${extension.toLowerCase()}`
}

function moduleResourceDirectory(
  modulePath: string,
  moduleName: string,
  kind: RemoteModuleResourceReference["kind"],
): string {
  // Keep resources beside the module. If the module is in an iCloud Surge
  // subdirectory, this deliberately produces
  // `<subdir>/.scripting-resources/<module>/...`; the caller then rewrites the
  // module reference relative to the selected Surge bookmark root.
  const moduleDir = Path.dirname(modulePath)
  const directoryName = `${safeSegment(moduleName, "module")}-${shortHash(moduleName)}`
  const kindDir = kind === "script" ? "scripts" : kind === "include" ? "includes" : "rulesets"
  return Path.join(moduleDir, RESOURCE_DIRECTORY, directoryName, kindDir)
}

async function exists(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") return !!(await fm.exists(path))
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return false
}

async function ensureDirectory(path: string): Promise<void> {
  if (await exists(path)) return
  const fm = fmOrThrow()
  if (typeof fm.createDirectory === "function") {
    await fm.createDirectory(path, true)
    return
  }
  if (typeof fm.createDirectorySync === "function") {
    fm.createDirectorySync(path, true)
    return
  }
  throw new Error("FileManager.createDirectory 不可用")
}

async function removeFile(path: string): Promise<void> {
  const fm = fmOrThrow()
  try {
    if (typeof fm.remove === "function") {
      await fm.remove(path)
      return
    }
    if (typeof fm.removeSync === "function") fm.removeSync(path)
  } catch {}
}

async function writeString(path: string, content: string): Promise<void> {
  const fm = fmOrThrow()
  if (typeof fm.writeAsString === "function") {
    await fm.writeAsString(path, content)
    return
  }
  if (typeof fm.writeAsStringSync === "function") {
    fm.writeAsStringSync(path, content)
    return
  }
  throw new Error("FileManager.writeAsString 不可用")
}

async function readString(path: string): Promise<string> {
  const fm = fmOrThrow()
  if (typeof fm.readAsString !== "function") throw new Error("FileManager.readAsString 不可用")
  return String(await fm.readAsString(path) ?? "")
}

function fetchTimeoutMessage(url: string): string {
  return `模块资源下载超时（${RESOURCE_FETCH_TIMEOUT_MS / 1000}s）：${url}`
}

async function fetchResourceText(url: string): Promise<string> {
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用，无法本地化模块资源")

  const isHTTP = /^http:\/\//i.test(url)
  return withTimeout(
    async () => {
      const requestInit: any = {
        headers: {
          "User-Agent": "script-hub/1.0.0",
          Accept: "application/javascript,text/javascript,text/plain,*/*",
        },
        timeout: RESOURCE_FETCH_TIMEOUT_MS / 1000,
        debugLabel: "Surge 模块资源本地化",
        ...(isHTTP ? { allowInsecureRequest: true } : {}),
      }
      const RequestCtor: any = (globalThis as any).Request
      const request = typeof RequestCtor === "function"
        ? new RequestCtor(url, requestInit)
        : null
      const response = request ? await fetchFn(request) : await fetchFn(url, requestInit)
      const status = Number(response?.status ?? 0)
      if (status < 200 || status >= 400) {
        throw new Error(`HTTP ${response?.status ?? "unknown"} ${response?.statusText ?? ""}`.trim())
      }
      const length = Number(response?.headers?.get?.("content-length") ?? 0)
      if (length > MAX_RESOURCE_CHARS) throw new Error(`模块资源超过 ${MAX_RESOURCE_CHARS / 1024 / 1024} MiB，已拒绝写入`)
      if (typeof response?.text !== "function") throw new Error("Response.text 不可用")
      const text = String(await response.text())
      if (text.length > MAX_RESOURCE_CHARS) throw new Error(`模块资源超过 ${MAX_RESOURCE_CHARS / 1024 / 1024} MiB，已拒绝写入`)
      return text
    },
    RESOURCE_FETCH_TIMEOUT_MS,
    fetchTimeoutMessage(url),
  )
}

function upsertLocalResourcesTag(content: string): string {
  const line = "#!local-resources=true"
  // Keep exactly one marker. `#!local-scripts` was the first beta marker;
  // remove it when upgrading an already-localized module so repeated runs do
  // not accumulate two sources of truth.
  const lines = String(content ?? "").split(/\r?\n/g)
  const withoutLegacyMarkers = lines.filter((item) => (
    !/^\s*#!\s*(?:local-resources|local-scripts)\s*=.*$/i.test(item)
  ))
  return `${line}\n${withoutLegacyMarkers.join("\n")}`
}

async function writeResourceFile(path: string, content: string): Promise<FileChange> {
  const existed = await exists(path)
  const previous = existed ? await readString(path) : undefined
  await ensureDirectory(Path.dirname(path))
  await withTimeout(
    () => writeString(path, content),
    RESOURCE_FILE_OPERATION_TIMEOUT_MS,
    `写入模块资源超时（${RESOURCE_FILE_OPERATION_TIMEOUT_MS / 1000}s）：${path}`,
  )
  const saved = await withTimeout(
    () => readString(path),
    RESOURCE_FILE_OPERATION_TIMEOUT_MS,
    `模块资源校验超时（${RESOURCE_FILE_OPERATION_TIMEOUT_MS / 1000}s）：${path}`,
  )
  if (saved !== content) throw new Error(`模块资源写入后校验失败：${path}`)
  return { path, existed, previous }
}

async function rollbackChanges(changes: FileChange[]): Promise<void> {
  for (const change of [...changes].reverse()) {
    try {
      if (change.existed) {
        await writeString(change.path, change.previous ?? "")
      } else {
        await removeFile(change.path)
      }
    } catch {}
  }
}

/**
 * Download all remote module resources and return module text pointing to
 * local files. The caller owns the returned rollback callback and should call
 * it if the enclosing module write fails.
 */
export async function localizeModuleResources(
  content: string,
  info: Pick<ModuleInfo, "name">,
  modulePath: string,
  profileDir?: string,
): Promise<ScriptLocalizationResult> {
  const references = extractRemoteModuleResourceReferences(content)
  if (!references.length) {
    const hasLocalizationMarker = /^\s*#!\s*(?:local-resources|local-scripts)\s*=/im.test(content)
    return {
      // A beta build used `#!local-scripts`; normalize that marker even when
      // all resource references have already been rewritten locally.
      content: hasLocalizationMarker ? upsertLocalResourcesTag(content) : content,
      localizedCount: 0,
      scriptCount: 0,
      ruleSetCount: 0,
      domainSetCount: 0,
      includeCount: 0,
      resourceURLs: [],
      rollback: async () => {},
    }
  }

  const uniqueResources = Array.from(
    new Map(references.map((ref) => [`${ref.kind}:${ref.value}`, ref])).values(),
  )
  const rootDir = profileDir || Path.dirname(modulePath)
  const replacements = new Map<string, string>()
  const changes: FileChange[] = []

  try {
    for (const reference of uniqueResources) {
      const directory = moduleResourceDirectory(modulePath, info.name, reference.kind)
      const filePath = Path.join(directory, resourceFileName(reference.value, reference.kind))
      const relative = relativeProfilePath(rootDir, filePath)
      const resourceText = await fetchResourceText(reference.value)
      const current = await (async () => {
        if (!(await exists(filePath))) return undefined
        try { return await readString(filePath) } catch { return undefined }
      })()
      if (current !== resourceText) {
        changes.push(await writeResourceFile(filePath, resourceText))
      }
      // Include the resource kind in the key. The same URL can legally be
      // used by two directives, but each directive still gets a stable file
      // name and its own rewritten reference.
      replacements.set(`${reference.kind}:${reference.value}`, relative)
    }

    const counts = uniqueResources.reduce(
      (result, reference) => {
        if (reference.kind === "script") result.scriptCount += 1
        if (reference.kind === "ruleset") result.ruleSetCount += 1
        if (reference.kind === "domainset") result.domainSetCount += 1
        if (reference.kind === "include") result.includeCount += 1
        return result
      },
      { scriptCount: 0, ruleSetCount: 0, domainSetCount: 0, includeCount: 0 },
    )

    return {
      content: upsertLocalResourcesTag(rewriteRemoteModuleResources(content, replacements)),
      localizedCount: uniqueResources.length,
      ...counts,
      resourceURLs: uniqueResources.map((reference) => reference.value),
      rollback: () => rollbackChanges(changes),
    }
  } catch (error) {
    await rollbackChanges(changes)
    throw new Error(`模块资源本地化失败：${String((error as any)?.message ?? error)}`)
  }
}
