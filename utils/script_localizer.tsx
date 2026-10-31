import { Path } from "scripting"

import { withTimeout } from "./async"
import {
  extractLocalModuleResourceReferences,
  extractRemoteModuleResourceReferences,
  relativeProfilePath,
  rewriteModuleResourceReferences,
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
  // module reference relative to the Surge `Module` profile directory.
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

/**
 * File Provider can briefly report false from `exists()` for an iCloud file
 * that is still readable through the security-scoped bookmark. Resource
 * migration must not mistake that transient state for a missing file.
 */
async function resourceFileExists(path: string): Promise<boolean> {
  if (await exists(path)) return true
  try {
    await readString(path)
    return true
  } catch {
    return false
  }
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
 * Repair local references produced by older builds.
 *
 * Resources are intentionally stored beside their module, while Surge
 * resolves `script-path` and external rule resources against its Module
 * profile directory. Therefore a module in `Module/Offline/BoxJs.sgmodule`
 * must use `Offline/.scripting-resources/...`. The v4.2.11 form
 * `Module/Offline/.scripting-resources/...` treated the outer iCloud bookmark
 * as if it were the Surge profile directory and resulted in Invalid Local
 * Resource; the earlier short form `.scripting-resources/...` also omitted the
 * module's `Offline/` prefix.
 */
async function rebaseExistingLocalResourcePaths(
  content: string,
  modulePath: string,
  profileDir?: string,
): Promise<string> {
  const references = extractLocalModuleResourceReferences(content)
  if (!references.length) return content

  const moduleDir = Path.dirname(modulePath)
  // `profileDir` is the actual Surge Module/profile directory, not the outer
  // iCloud/Surge bookmark and not the module's optional subdirectory.
  const rootDir = profileDir || moduleDir
  const replacements = new Map<string, string>()

  function parentDirectory(path: string): string {
    const normalized = String(path ?? "").replace(/\\/g, "/").replace(/\/+$/, "")
    const index = normalized.lastIndexOf("/")
    return index > 0 ? normalized.slice(0, index) : ""
  }

  function candidatePaths(value: string): string[] {
    if (value.startsWith("/")) return [value]
    const candidates: string[] = []
    const add = (candidate: string) => {
      if (!candidate || candidates.includes(candidate)) return
      candidates.push(candidate)
    }

    // Current modules and the original v4.2.9 layout keep resources beside
    // the module. Keep the selected module directory first.
    add(Path.join(moduleDir, value))
    add(Path.join(rootDir, value))

    // v4.2.11 wrote a path relative to the outer `Surge` bookmark, for
    // example `Module/Offline/.scripting-resources/...`. Walk the containing
    // directory's ancestors so that migration can locate that file without
    // downloading it again.
    let ancestor = moduleDir
    for (let index = 0; index < 8; index += 1) {
      ancestor = parentDirectory(ancestor)
      if (!ancestor) break
      add(Path.join(ancestor, value))
    }

    // Preserve the short-lived `Module`/`Modules` compatibility layouts.
    add(Path.join(rootDir, "Module", value))
    add(Path.join(rootDir, "Modules", value))
    return candidates
  }

  for (const reference of references) {
    const value = String(reference.value ?? "").trim()
    let physicalPath = ""
    for (const candidate of candidatePaths(value)) {
      if (await resourceFileExists(candidate)) {
        physicalPath = candidate
        break
      }
    }
    if (!physicalPath) continue

    const relative = relativeProfilePath(rootDir, physicalPath)
    if (relative && relative !== value) {
      replacements.set(`${reference.kind}:${value}`, relative)
    }
  }

  if (!replacements.size) return content
  return rewriteModuleResourceReferences(content, references, replacements)
}

async function verifyLocalResourcePaths(
  content: string,
  profileDir: string,
): Promise<void> {
  const references = extractLocalModuleResourceReferences(content)
  for (const reference of references) {
    const value = String(reference.value ?? "").trim()
    const path = value.startsWith("/") ? value : Path.join(profileDir, value)
    if (!(await resourceFileExists(path))) {
      throw new Error(`本地资源不存在：${value}`)
    }
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
  // First repair paths already pointing at `.scripting-resources`. This path
  // is deliberately offline: a local module should not be re-fetched merely
  // because its resource references were written using the wrong base.
  const rebasedContent = await rebaseExistingLocalResourcePaths(content, modulePath, profileDir)
  const references = extractRemoteModuleResourceReferences(rebasedContent)
  if (!references.length) {
    const hasLocalizationMarker =
      /^\s*#!\s*(?:local-resources|local-scripts)\s*=/im.test(rebasedContent) ||
      extractLocalModuleResourceReferences(rebasedContent).length > 0
    if (hasLocalizationMarker) {
      await verifyLocalResourcePaths(rebasedContent, profileDir || Path.dirname(modulePath))
    }
    return {
      // A beta build used `#!local-scripts`; normalize that marker even when
      // all resource references have already been rewritten locally.
      content: hasLocalizationMarker ? upsertLocalResourcesTag(rebasedContent) : rebasedContent,
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
  // Surge resolves local module resource fields against the Module profile
  // directory. Keep the physical tree beside the module and write the short
  // `Offline/.scripting-resources/...` (or `.scripting-resources/...` for a
  // module directly in Module/) path used by that profile-relative loader.
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

    const localizedContent = upsertLocalResourcesTag(rewriteRemoteModuleResources(rebasedContent, replacements))
    await verifyLocalResourcePaths(localizedContent, rootDir)
    return {
      content: localizedContent,
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
