import { Path } from "scripting"
import {
  getSurgeBookmarkRoot,
  isPathWithin,
  type ModuleInfo,
} from "./storage"
import { validateSurgeModuleText } from "./module_validation"
import { extractLocalModuleResourceReferences } from "./script_localizer_core"

export type ModuleHealthIssue = {
  moduleName: string
  level: "error" | "warning"
  message: string
}

export type ModuleHealthReport = {
  checked: number
  errors: number
  warnings: number
  issues: ModuleHealthIssue[]
}

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

async function fileExists(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") return !!(await fm.exists(path))
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return false
}

function inferProfileRoot(modulePath: string): string {
  const normalized = String(modulePath ?? "").replace(/\\/g, "/")
  const parts = normalized.split("/")
  const index = Math.max(
    parts.map((item) => item.toLowerCase()).lastIndexOf("module"),
    parts.map((item) => item.toLowerCase()).lastIndexOf("modules"),
  )
  if (index > 0) return parts.slice(0, index).join("/")
  return Path.dirname(Path.dirname(modulePath))
}

async function verifyLocalResources(
  content: string,
  modulePath: string,
  profileRoot: string,
): Promise<string[]> {
  const references = extractLocalModuleResourceReferences(content)
  if (!references.length) return []
  const root = profileRoot || inferProfileRoot(modulePath)
  const missing: string[] = []
  for (const reference of references) {
    const value = String(reference.value ?? "").trim()
    const resourcePath = value.startsWith("/") ? value : Path.join(root, value)
    if (!(await fileExists(resourcePath))) missing.push(value)
  }
  return Array.from(new Set(missing))
}

function isSupportedModuleLink(link: string): boolean {
  return /^(?:https?|http):\/\//i.test(String(link ?? "").trim())
}

function addDuplicateIssues(
  modules: ModuleInfo[],
  issues: ModuleHealthIssue[],
  field: "name" | "link",
  label: string,
) {
  const groups = new Map<string, string[]>()
  for (const module of modules) {
    const raw = String(module[field] ?? "").trim().toLowerCase()
    if (!raw) continue
    const list = groups.get(raw) ?? []
    list.push(module.name)
    groups.set(raw, list)
  }
  for (const names of groups.values()) {
    if (names.length < 2) continue
    issues.push({
      moduleName: names[0],
      level: "warning",
      message: `${label}重复：${Array.from(new Set(names)).join("、")}`,
    })
  }
}

export async function inspectModuleHealth(modules: ModuleInfo[]): Promise<ModuleHealthReport> {
  const issues: ModuleHealthIssue[] = []
  const fm = fmOrThrow()
  const profileRoot = await getSurgeBookmarkRoot()

  addDuplicateIssues(modules, issues, "name", "模块名称")
  addDuplicateIssues(modules, issues, "link", "下载链接")

  for (const module of modules) {
    const moduleName = module.name || "未命名模块"
    const path = String(module.filePath ?? "").trim()
    if (!path) {
      issues.push({ moduleName, level: "error", message: "没有对应的文件路径" })
      continue
    }
    if (!(await fileExists(path))) {
      issues.push({ moduleName, level: "error", message: "模块文件不存在或书签权限失效" })
      continue
    }

    if (profileRoot && !isPathWithin(profileRoot, path)) {
      issues.push({ moduleName, level: "error", message: "模块文件不在已授权的 iCloud Drive/Surge 目录内" })
    }

    let content = ""
    try {
      if (typeof fm.readAsString !== "function") throw new Error("FileManager.readAsString 不可用")
      content = String(await fm.readAsString(path) ?? "")
      validateSurgeModuleText(content)
    } catch (e: any) {
      issues.push({
        moduleName,
        level: "error",
        message: String(e?.message ?? e),
      })
      continue
    }

    if (module.link && !isSupportedModuleLink(module.link)) {
      issues.push({
        moduleName,
        level: "warning",
        message: `下载链接格式异常：${module.link}`,
      })
    }
    if (!content.trim()) {
      issues.push({ moduleName, level: "error", message: "文件内容为空" })
    }

    const missingResources = await verifyLocalResources(content, path, profileRoot)
    if (missingResources.length) {
      issues.push({
        moduleName,
        level: "error",
        message: `本地资源不存在或路径不一致：${missingResources.slice(0, 6).join("、")}${missingResources.length > 6 ? "…" : ""}`,
      })
    }
  }

  return {
    checked: modules.length,
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warning").length,
    issues,
  }
}
