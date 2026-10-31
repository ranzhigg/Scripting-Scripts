import { Path } from "scripting"
import { loadConfig } from "./config"
import { backupModulePath } from "./backups"

export type ModuleInfo = {
  name: string
  link: string
  /** Original source URL kept by a third-party conversion adapter, if any. */
  sourceURL?: string
  surgeName?: string
  category?: string
  icon?: string
  filePath?: string
  saveDir?: string
  isLocal?: boolean
  /** Legacy marker: the module's remote [Script] references were localized. */
  localScripts?: boolean
  /** The module's remote scripts, rule sets, and includes have been localized. */
  localResources?: boolean
  content?: string
}

const BASE_DIR_NAME = "SurgeModulesManager"
const MODULES_DIR_NAME = "Modules"
const SURGE_MODULE_DIR_NAME = "Module"
const LEGACY_RESOURCE_DIR_NAME = ".scripting-resources"
const BUILTIN_LINK_PREFIXES = ["#!url=", "#SUBSCRIBED"]

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

function isPromiseLike(v: any): v is Promise<any> {
  return !!v && typeof v === "object" && typeof v.then === "function"
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
  try {
    const r = fn.apply(thisArg, args)
    return isPromiseLike(r) ? await r : r
  } catch {
    return undefined
  }
}

function normalizePath(path: string): string {
  return String(path ?? "").replace(/\/+$/, "")
}

/**
 * The bookmark is the user's iCloud/Surge directory. Surge keeps local
 * modules in its `Module` child. Accept an already-selected Module folder as
 * a compatibility path so existing installations are not nested again.
 */
function surgeModuleDirectory(root: string): string {
  const normalized = normalizePath(root)
  if (!normalized) return ""
  const last = normalized.split("/").pop()?.toLowerCase() ?? ""
  if (last === "module" || last === "modules") return normalized
  return Path.join(normalized, SURGE_MODULE_DIR_NAME)
}

function pickRootDir(): string {
  const fm = fmOrThrow()
  if (fm.isiCloudEnabled && fm.iCloudDocumentsDirectory) {
    return fm.iCloudDocumentsDirectory
  }
  return fm.documentsDirectory || fm.appGroupDocumentsDirectory || fm.scriptsDirectory || ""
}

export function getBaseDir(): string {
  const cfg = loadConfig()
  if (cfg.baseDir) return cfg.baseDir
  return Path.join(pickRootDir(), BASE_DIR_NAME)
}

export function getModulesDir(): string {
  const cfg = loadConfig()
  if (cfg.baseDir) return surgeModuleDirectory(cfg.baseDir)
  return Path.join(getBaseDir(), MODULES_DIR_NAME)
}

async function resolveBookmarkedPath(rawPath: string, bookmarkName?: string): Promise<string> {
  const fm = fmOrThrow()
  const raw = String(rawPath ?? "").trim()
  const name = String(bookmarkName ?? "").trim()
  if (!raw && !name) return ""
  if (!fm?.bookmarkedPath) return raw

  if (name) {
    let nameExists = true
    if (fm?.bookmarkExists) {
      const existed = await callMaybeAsync(fm.bookmarkExists, fm, [name])
      nameExists = !!existed
    }
    if (nameExists) {
      const byName = await callMaybeAsync(fm.bookmarkedPath, fm, [name])
      if (byName) return String(byName)
    }
  }
  if (!fm?.getAllFileBookmarks) return raw

  const list = await callMaybeAsync(fm.getAllFileBookmarks, fm, [])
  const arr = Array.isArray(list) ? list : []
  const target = normalizePath(raw)
  const match = arr.find((b: any) => {
    const p = normalizePath(String(b?.path ?? ""))
    const n = String(b?.name ?? "")
    return (p && p === target) || (name ? n === name : false)
  })
  if (match?.name) {
    const resolved = await callMaybeAsync(fm.bookmarkedPath, fm, [match.name])
    if (resolved) return String(resolved)
  }

  // If bookmark name is configured but cannot be resolved, do not trust stale raw path.
  if (name) return ""
  return raw
}

export async function getModulesDirResolved(baseDir?: string): Promise<string> {
  const cfg = loadConfig()
  const configured = String(cfg.baseDir ?? "").trim()
  const bookmarkName = String(cfg.baseBookmarkName ?? "").trim()
  const target = String(baseDir ?? "").trim()
  if (!configured && !target) return getModulesDir()

  if (!target) {
    if (!configured) return getModulesDir()
    const resolved = await resolveBookmarkedPath(configured, bookmarkName)
    if (resolved) return surgeModuleDirectory(resolved)
    return bookmarkName ? "" : surgeModuleDirectory(configured)
  }

  if (configured && normalizePath(target) === normalizePath(configured)) {
    const resolved = await resolveBookmarkedPath(target, bookmarkName)
    if (resolved) return surgeModuleDirectory(resolved)
    return bookmarkName ? "" : surgeModuleDirectory(target)
  }
  return target
}

/**
 * Return the resolved iCloud/Surge bookmark root selected by the user.
 *
 * Resource localization must never fall back to Scripting's own documents
 * directory. The module directory is resolved separately as its `Module`
 * child, while this root is used for the security-scope boundary check.
 * Requiring both the configured path and bookmark name lets callers
 * distinguish a real, still-valid external folder from the legacy fallback.
 */
export async function getSurgeBookmarkRoot(): Promise<string> {
  try {
    const cfg = loadConfig()
    const configured = String(cfg.baseDir ?? "").trim()
    const bookmarkName = String(cfg.baseBookmarkName ?? "").trim()
    if (!configured || !bookmarkName) return ""

    const fm = fmOrThrow()
    if (typeof fm.bookmarkedPath !== "function") return ""
    const resolved = await resolveBookmarkedPath(configured, bookmarkName)
    return normalizePath(resolved ?? "")
  } catch {
    return ""
  }
}

export function isPathWithin(root: string, target: string): boolean {
  const base = normalizePath(root)
  const value = normalizePath(target)
  return !!base && !!value && (value === base || value.startsWith(`${base}/`))
}

async function exists(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") return !!(await fm.exists(path))
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return false
}

async function ensureDir(dir: string): Promise<void> {
  const fm = fmOrThrow()
  if (await exists(dir)) return
  if (typeof fm.createDirectory === "function") {
    await fm.createDirectory(dir, true)
    return
  }
  if (typeof fm.createDirectorySync === "function") {
    fm.createDirectorySync(dir, true)
    return
  }
  throw new Error("FileManager.createDirectory 不可用")
}

export async function ensureStorage(): Promise<void> {
  const cfg = loadConfig()
  if (cfg.baseDir) {
    const resolved = await getModulesDirResolved(cfg.baseDir)
    if (!resolved) {
      throw new Error("书签路径不可用，请在设置页重新选择书签文件夹")
    }
    // The user authorizes the iCloud/Surge folder. Create its Module child on
    // first use (or reuse it when it already exists); all module and resource
    // writes then stay under that security-scoped directory.
    await ensureDir(resolved)
    return
  }
  await ensureDir(getBaseDir())
  if (!cfg.baseDir) {
    await ensureDir(getModulesDir())
  }
}

function extractNameFromPath(p: string): string {
  const base = String(p).split("/").pop() ?? String(p)
  return base.replace(/\.sgmodule$/i, "")
}

function parseTag(content: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*#!\\s*${key}\\s*=\\s*(.*)$`, "im")
  const m = content.match(re)
  return m?.[1]?.trim()
}

function parseIcon(content: string): string | undefined {
  const lines = String(content ?? "").split(/\r?\n/g)
  for (const raw of lines) {
    const m = raw.match(/^\s*#\s*!?\s*icon\s*(?:=|\s)\s*(.+)$/i)
    const value = m?.[1]?.trim()
    if (value) return value
  }
  return undefined
}

export function getLinkPrefixes(): string[] {
  const cfg = loadConfig()
  const raw = String(cfg.linkPatternsText ?? "").split(/\r?\n/g)
  const configured = raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    // A hostname is not a metadata prefix. Ignore it instead of allowing a
    // setting such as `http://script.hub` to shadow/erase real link markers.
    .filter((s) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(s))
  return Array.from(new Set([...configured, ...BUILTIN_LINK_PREFIXES]))
}

export function formatLinkLine(prefix: string, url: string): string {
  const p = String(prefix ?? "").trim()
  const u = String(url ?? "").trim()
  if (/^#SUBSCRIBED$/i.test(p)) return `${p} ${u}`
  return `${p}${u}`
}

function parseLinkFromContent(content: string, prefixes: string[]): string {
  const lines = String(content ?? "").split(/\r?\n/g)
  for (const lineRaw of lines) {
    const line = lineRaw.trimStart()
    for (const prefix of prefixes) {
      if (line.startsWith(prefix)) {
        return line.slice(prefix.length).trim()
      }
    }
  }
  return ""
}

export function detectLinkPrefixFromContent(content: string, prefixes: string[]): string | undefined {
  const lines = String(content ?? "").split(/\r?\n/g)
  for (const lineRaw of lines) {
    const line = lineRaw.trimStart()
    const hit = prefixes.find((p) => line.startsWith(p))
    if (hit) return hit
  }
  return undefined
}

async function isDirectory(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.isDirectory === "function") return !!(await fm.isDirectory(path))
  if (typeof fm.isDir === "function") return !!(await fm.isDir(path))
  return false
}

async function removeTree(path: string): Promise<number> {
  const fm = fmOrThrow()
  if (!(await exists(path))) return 0

  let removed = 0
  if (await isDirectory(path) && typeof fm.readDirectory === "function") {
    const entries = await fm.readDirectory(path)
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const raw = String(entry)
        const child = raw.includes("/") ? raw : Path.join(path, raw)
        removed += await removeTree(child)
      }
    }
  }

  if (typeof fm.remove === "function") await fm.remove(path)
  else if (typeof fm.removeSync === "function") fm.removeSync(path)
  else throw new Error("FileManager.remove 不可用")
  return removed + 1
}

async function removeLegacyResourceDirectories(dir: string): Promise<number> {
  const fm = fmOrThrow()
  if (!(await exists(dir)) || !(await isDirectory(dir)) || typeof fm.readDirectory !== "function") return 0

  const entries = await fm.readDirectory(dir)
  if (!Array.isArray(entries)) return 0

  let removedDirectories = 0
  for (const entry of entries) {
    const raw = String(entry)
    const child = raw.includes("/") ? raw : Path.join(dir, raw)
    if (raw === LEGACY_RESOURCE_DIR_NAME || child.split("/").pop() === LEGACY_RESOURCE_DIR_NAME) {
      await removeTree(child)
      removedDirectories += 1
      continue
    }
    if (await isDirectory(child)) {
      removedDirectories += await removeLegacyResourceDirectories(child)
    }
  }
  return removedDirectories
}

/**
 * Remove only resource directories created by the pre-4.2.6 fallback path.
 * Module files, backups, metadata, and the selected Surge bookmark are kept.
 */
export async function cleanupLegacyPrivateResources(): Promise<{
  removedDirectories: number
  skipped: boolean
  path: string
}> {
  const legacyModulesDir = Path.join(pickRootDir(), BASE_DIR_NAME, MODULES_DIR_NAME)
  const surgeRoot = await getSurgeBookmarkRoot()
  if (surgeRoot && (isPathWithin(legacyModulesDir, surgeRoot) || isPathWithin(surgeRoot, legacyModulesDir))) {
    return { removedDirectories: 0, skipped: true, path: legacyModulesDir }
  }

  const removedDirectories = await removeLegacyResourceDirectories(legacyModulesDir)
  return { removedDirectories, skipped: false, path: legacyModulesDir }
}

async function listModuleFilesRecursive(dir: string): Promise<string[]> {
  const fm = fmOrThrow()
  const list = await fm.readDirectory(dir)
  if (!Array.isArray(list)) return []
  const files: string[] = []
  for (const entry of list) {
    const raw = String(entry)
    const full = raw.includes("/") ? raw : Path.join(dir, raw)
    if (await isDirectory(full)) {
      const sub = await listModuleFilesRecursive(full)
      files.push(...sub)
      continue
    }
    if (!full.toLowerCase().endsWith(".sgmodule")) continue
    files.push(full)
  }
  return files
}

function parentDirectory(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index > 0 ? normalized.slice(0, index) : ""
}

/**
 * Read the new Surge/Module directory and the old selected-root location.
 * Before the automatic Module-folder handling was added, modules could be
 * written directly into iCloud/Surge. Keep that location visible so changing
 * the storage rule never makes existing modules appear deleted.
 */
async function moduleSearchDirectories(primaryDir?: string): Promise<string[]> {
  const primary = String(primaryDir ?? (await getModulesDirResolved())).trim()
  if (!primary) return []

  const directories: string[] = [primary]
  const add = (value: string) => {
    const normalized = normalizePath(value)
    if (!normalized) return
    if (!directories.some((item) => normalizePath(item) === normalized)) directories.push(normalized)
  }

  const surgeRoot = await getSurgeBookmarkRoot()
  if (surgeRoot) {
    add(surgeRoot)
    const rootName = normalizePath(surgeRoot).split("/").pop()?.toLowerCase() ?? ""
    if (rootName === "module" || rootName === "modules") add(parentDirectory(surgeRoot))
  }

  return directories
}

async function listModuleFilesFromSearchDirectories(primaryDir?: string): Promise<string[]> {
  const files: string[] = []
  for (const directory of await moduleSearchDirectories(primaryDir)) {
    // File Provider can briefly report a false `exists` while the same
    // security-scoped directory is readable. Let the directory read decide;
    // a genuinely absent directory is simply skipped after the catch.
    try {
      files.push(...await listModuleFilesRecursive(directory))
    } catch {}
  }
  return Array.from(new Set(files))
}

export async function loadModules(
  resolvedDir?: string,
  includeContent = false,
): Promise<ModuleInfo[]> {
  // Callers that already resolved and authorized the bookmark can pass the
  // directory through. This avoids repeating the security-scoped bookmark
  // lookup during a single refresh.
  if (!resolvedDir) await ensureStorage()
  const dir = resolvedDir || await getModulesDirResolved()

  const modules: ModuleInfo[] = []
  const files = await listModuleFilesFromSearchDirectories(dir)
  const prefixes = getLinkPrefixes()
  for (const path of files) {
    const item = await readModuleInfo(path, prefixes, includeContent)
    if (item) modules.push(item)
  }
  return modules
}

export function moduleFilePath(moduleName: string, dir?: string): string {
  const base = dir ?? getModulesDir()
  return Path.join(base, `${moduleName}.sgmodule`)
}

async function readModuleInfo(
  path: string,
  prefixes = getLinkPrefixes(),
  includeContent = false,
): Promise<ModuleInfo | null> {
  const fm = fmOrThrow()

  const name = extractNameFromPath(path)
  if (!name) return null

  let text = ""
  try {
    text = await fm.readAsString(path)
  } catch {
    text = ""
  }

  const link = parseLinkFromContent(text, prefixes)
  const sourceURL = parseTag(text, "source-url")
  const localTag = parseTag(text, "local")
  const localScriptsTag = parseTag(text, "local-scripts")
  const hasLocalScripts =
    localScriptsTag != null &&
    String(localScriptsTag).trim() !== "" &&
    !["0", "false", "no"].includes(String(localScriptsTag).trim().toLowerCase())
  const localResourcesTag = parseTag(text, "local-resources")
  const hasLocalResources =
    localResourcesTag != null &&
    String(localResourcesTag).trim() !== "" &&
    !["0", "false", "no"].includes(String(localResourcesTag).trim().toLowerCase())
  const hasLocalTag =
    localTag != null &&
    String(localTag).trim() !== "" &&
    !["0", "false", "no"].includes(String(localTag).trim().toLowerCase())
  const isLocal = hasLocalTag || !link
  const category = parseTag(text, "category") ?? parseTag(text, "cagegory") ?? undefined
  const surgeName = parseTag(text, "name") ?? undefined
  const icon = parseTag(text, "icon") ?? parseIcon(text)
  return {
    name,
    link,
    sourceURL,
    surgeName,
    category,
    icon,
    filePath: path,
    isLocal,
    localScripts: hasLocalScripts,
    localResources: hasLocalResources || hasLocalScripts,
    ...(includeContent ? { content: text } : {}),
  }
}

/**
 * Read one known destination without recursively walking the whole bookmark.
 * Script-Hub imports always target the selected bookmark root, and a full
 * iCloud directory walk can block an Intent for a long time.
 */
export async function loadModuleAtPath(path: string): Promise<ModuleInfo | null> {
  if (!(await exists(path))) return null
  return readModuleInfo(path)
}

function resolveModulePath(target: ModuleInfo | string): string {
  if (typeof target === "string") return moduleFilePath(target)
  return target.filePath ?? moduleFilePath(target.name)
}

export async function moveModuleFile(
  target: ModuleInfo | string,
  nextDir?: string,
  nextName?: string
): Promise<string> {
  const fm = fmOrThrow()
  const from = resolveModulePath(target)
  const name = String(nextName ?? (typeof target === "string" ? target : target.name)).trim()
  const baseDir = nextDir ?? Path.dirname(from)
  const to = moduleFilePath(name, baseDir)

  if (normalizePath(from) === normalizePath(to)) return to
  await ensureDir(baseDir)
  if (!(await exists(from))) return to

  if (typeof fm.rename === "function") {
    await fm.rename(from, to)
    return to
  }
  if (typeof fm.renameSync === "function") {
    fm.renameSync(from, to)
    return to
  }
  throw new Error("FileManager.rename 不可用")
}

export async function detectLinkPrefix(target: ModuleInfo | string): Promise<string | undefined> {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return undefined
  const raw = await fm.readAsString(path)
  return detectLinkPrefixFromContent(String(raw ?? ""), getLinkPrefixes())
}

export async function removeModuleFile(target: ModuleInfo | string): Promise<void> {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return
  if (typeof fm.remove === "function") {
    await fm.remove(path)
    return
  }
  if (typeof fm.removeSync === "function") {
    fm.removeSync(path)
    return
  }
  throw new Error("FileManager.remove 不可用")
}

export async function renameModuleFile(oldTarget: ModuleInfo | string, newName: string): Promise<void> {
  const fm = fmOrThrow()
  const from = resolveModulePath(oldTarget)
  const to = Path.join(Path.dirname(from), `${newName}.sgmodule`)
  if (!(await exists(from))) return
  if (typeof fm.rename === "function") {
    await fm.rename(from, to)
    return
  }
  if (typeof fm.renameSync === "function") {
    fm.renameSync(from, to)
    return
  }
  throw new Error("FileManager.rename 不可用")
}

function upsertTag(content: string, key: string, value?: string): string {
  const trimmed = String(value ?? "").trim()
  const line = `#!${key}=${trimmed}`
  const re = new RegExp(`^\\s*#!\\s*${key}\\s*=.*$`, "im")
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

function upsertLink(content: string, prefixes: string[], value?: string): string {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return content
  const lines = String(content ?? "").split(/\r?\n/g)
  let matchedPrefix: string | undefined
  const filtered = lines.filter((line) => {
    const t = line.trimStart()
    const hit = prefixes.find((p) => t.startsWith(p))
    if (hit && !matchedPrefix) matchedPrefix = hit
    return !hit
  })
  const prefix = matchedPrefix ?? prefixes[0] ?? "#url="
  return `${formatLinkLine(prefix, trimmed)}\n${filtered.join("\n")}`
}

export async function updateModuleMetadata(
  target: ModuleInfo | string,
  info: {
    link?: string
    sourceURL?: string
    category?: string
    icon?: string
    local?: boolean
    localScripts?: boolean
  }
) {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return
  const raw = await fm.readAsString(path)
  let content = String(raw ?? "")
  content = upsertLink(content, getLinkPrefixes(), info.link)
  if (Object.prototype.hasOwnProperty.call(info, "sourceURL")) {
    content = upsertTag(content, "source-url", info.sourceURL)
  }
  // Omitted/undefined category means “keep the category already persisted in
  // the module”. Pass an empty string when the caller intentionally clears it.
  if (Object.prototype.hasOwnProperty.call(info, "category") && info.category !== undefined) {
    content = upsertTag(content, "category", info.category)
  }
  if (info.icon !== undefined) {
    content = upsertTag(content, "icon", info.icon)
  }
  if (info.local !== undefined) {
    content = upsertTag(content, "local", info.local ? "true" : "")
  }
  if (info.localScripts !== undefined) {
    content = upsertTag(content, "local-scripts", info.localScripts ? "true" : "")
  }
  await backupModulePath(path)
  await fm.writeAsString(path, content)
}

export async function saveLocalModule(info: ModuleInfo, rawContent: string): Promise<void> {
  await ensureStorage()
  const fm = fmOrThrow()
  if (!fm?.writeAsString) throw new Error("FileManager.writeAsString 不可用")
  const targetDir = info.saveDir ?? (await getModulesDirResolved())
  await ensureDir(targetDir)
  const path = moduleFilePath(info.name, targetDir)
  let content = String(rawContent ?? "")
  content = upsertTag(content, "local", "true")
  if (info.sourceURL !== undefined) content = upsertTag(content, "source-url", info.sourceURL)
  if (info.category !== undefined) content = upsertTag(content, "category", info.category)
  await backupModulePath(path)
  await fm.writeAsString(path, content)
}

export async function listDirectSubDirs(baseDir?: string): Promise<string[]> {
  const fm = fmOrThrow()
  const root = await getModulesDirResolved(baseDir)
  const list = await fm.readDirectory(root)
  if (!Array.isArray(list)) return []
  const dirs: string[] = []
  for (const entry of list) {
    const raw = String(entry)
    const full = raw.includes("/") ? raw : Path.join(root, raw)
    const name = raw.includes("/") ? raw.split("/").pop() ?? raw : raw
    if (!name || name.startsWith(".")) continue
    if (name === "__pycache__" || name === "__pypackages__") continue
    if (await isDirectory(full)) dirs.push(full)
  }
  return dirs
}

export async function loadCategoriesFromModules(baseDir?: string): Promise<{
  categories: string[]
  scanned: number
  added: number
}> {
  const fm = fmOrThrow()
  const files = await listModuleFilesFromSearchDirectories(await getModulesDirResolved(baseDir))
  const set = new Set<string>()
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const cat = parseTag(text, "category") ?? parseTag(text, "cagegory")
    if (cat) set.add(cat)
  }
  const categories = Array.from(set)
  return { categories, scanned: files.length, added: categories.length }
}

export async function renameCategoryInModules(oldName: string, newName: string, baseDir?: string): Promise<void> {
  const fm = fmOrThrow()
  const files = await listModuleFilesFromSearchDirectories(await getModulesDirResolved(baseDir))
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      continue
    }
    const cat = parseTag(text, "category")
    if (!cat || cat !== oldName) continue
    let content = upsertTag(text, "category", newName)
    await backupModulePath(path)
    await fm.writeAsString(path, content)
  }
}

export async function countModulesByCategory(baseDir?: string): Promise<Record<string, number>> {
  const fm = fmOrThrow()
  const files = await listModuleFilesFromSearchDirectories(await getModulesDirResolved(baseDir))
  const counts: Record<string, number> = {}
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const cat = parseTag(text, "category") ?? parseTag(text, "cagegory") ?? ""
    if (!cat) continue
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}

export function sortModules(list: ModuleInfo[]): ModuleInfo[] {
  return [...list].sort((a, b) => {
    const ca = String(a.category ?? "")
    const cb = String(b.category ?? "")
    if (ca !== cb) return ca.localeCompare(cb)
    return a.name.localeCompare(b.name)
  })
}
