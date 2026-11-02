import { Path } from "scripting"
import { replaceTextVerified, writeTextVerified } from "./verified_write"

export type ModuleBackup = {
  path: string
  timestamp: number
  label: string
}

const BACKUP_DIR_NAME = ".surge-module-backups"
const MAX_BACKUPS_PER_MODULE = 8

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

async function fileExists(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") {
    if (await fm.exists(path)) return true
    // iCloud File Provider can briefly report false while the security-scoped
    // bookmark can still read the file. Do not skip the recovery point in that
    // window.
    if (typeof fm.readAsString === "function") {
      try {
        await fm.readAsString(path)
        return true
      } catch {}
    }
    return false
  }
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return false
}

async function ensureDirectory(path: string): Promise<void> {
  if (await fileExists(path)) return
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
  if (typeof fm.remove === "function") {
    await fm.remove(path)
    return
  }
  if (typeof fm.removeSync === "function") {
    fm.removeSync(path)
    return
  }
}

function moduleNameFromPath(path: string): string {
  const base = String(path).split("/").pop() ?? String(path)
  return base.replace(/\.sgmodule$/i, "")
}

function backupDirectoryFor(path: string): string {
  return Path.join(Path.dirname(path), BACKUP_DIR_NAME)
}

function encodeModuleName(name: string): string {
  return encodeURIComponent(String(name ?? "").trim() || "module")
}

function decodeModuleName(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function backupPathName(path: string): string {
  return String(path).split("/").pop() ?? String(path)
}

function normalizedPath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function parseBackup(path: string): ModuleBackup | null {
  const base = backupPathName(path)
  const match = base.match(/^(.+)\.(\d{10,})\.sgmodule\.bak$/)
  if (!match) return null
  const timestamp = Number(match[2])
  if (!Number.isFinite(timestamp)) return null
  return {
    path,
    timestamp,
    label: decodeModuleName(match[1]),
  }
}

async function listBackupPaths(directory: string): Promise<string[]> {
  const fm = fmOrThrow()
  if (!(await fileExists(directory)) || typeof fm.readDirectory !== "function") return []
  const entries = await fm.readDirectory(directory)
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry: any) => {
      const raw = String(entry)
      return raw.includes("/") ? raw : Path.join(directory, raw)
    })
    .filter((path: string) => !!parseBackup(path))
}

async function pruneBackups(path: string): Promise<void> {
  const directory = backupDirectoryFor(path)
  const moduleName = moduleNameFromPath(path)
  const expectedName = encodeModuleName(moduleName)
  const entries = (await listBackupPaths(directory))
    .map((backupPath) => ({ path: backupPath, info: parseBackup(backupPath) }))
    .filter((item) => item.info?.label === moduleName || backupPathName(item.path).startsWith(`${expectedName}.`))
    .sort((a, b) => (b.info?.timestamp ?? 0) - (a.info?.timestamp ?? 0))

  for (const item of entries.slice(MAX_BACKUPS_PER_MODULE)) {
    try {
      await removeFile(item.path)
    } catch {}
  }
}

/**
 * Save the current module before an overwrite. A missing target is a no-op.
 * Backups live in a hidden, non-.sgmodule directory so they never appear as
 * active Surge modules during the normal recursive scan.
 */
export async function backupModulePath(path: string): Promise<string | null> {
  const target = String(path ?? "").trim()
  if (!target || !(await fileExists(target))) return null

  const fm = fmOrThrow()
  if (typeof fm.readAsString !== "function") throw new Error("FileManager.readAsString 不可用")
  const content = String(await fm.readAsString(target) ?? "")
  const directory = backupDirectoryFor(target)
  await ensureDirectory(directory)

  const name = encodeModuleName(moduleNameFromPath(target))
  let timestamp = Date.now()
  let backupPath = Path.join(directory, `${name}.${timestamp}.sgmodule.bak`)
  while (await fileExists(backupPath)) {
    timestamp += 1
    backupPath = Path.join(directory, `${name}.${timestamp}.sgmodule.bak`)
  }

  await writeTextVerified(backupPath, content, "模块备份")
  await pruneBackups(target)
  return backupPath
}

export async function listModuleBackups(path: string): Promise<ModuleBackup[]> {
  const directory = backupDirectoryFor(String(path ?? ""))
  return (await listBackupPaths(directory))
    .map(parseBackup)
    .filter((item): item is ModuleBackup => !!item)
    .sort((a, b) => b.timestamp - a.timestamp)
}

/** Restore a backup, first preserving the current file as another backup. */
export async function restoreModuleBackup(path: string, backupPath: string): Promise<void> {
  const target = String(path ?? "").trim()
  const source = String(backupPath ?? "").trim()
  if (!target || !source || !(await fileExists(source))) throw new Error("备份文件不存在")

  const expectedDirectory = normalizedPath(backupDirectoryFor(target))
  const actualDirectory = normalizedPath(Path.dirname(source))
  if (actualDirectory !== expectedDirectory || !parseBackup(source)) {
    throw new Error("备份路径无效，已拒绝覆盖模块")
  }

  const fm = fmOrThrow()
  if (typeof fm.readAsString !== "function") throw new Error("FileManager.readAsString 不可用")
  const content = String(await fm.readAsString(source) ?? "")
  if (await fileExists(target)) await backupModulePath(target)
  await replaceTextVerified(target, content, "模块回滚")
}
