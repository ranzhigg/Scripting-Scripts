import {
  Button,
  Divider,
  EmptyView,
  Grid,
  GridRow,
  Group,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationStack,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"

import {
  ensureStorage,
  loadModules,
  moduleFilePath,
  detectLinkPrefix,
  loadModuleAtPath,
  removeModuleFile,
  sortModules,
  type ModuleInfo,
  updateModuleMetadata,
  listDirectSubDirs,
  saveLocalModule,
  getModulesDirResolved,
  moveModuleFile,
} from "../utils/storage"
import { loadConfig, persistCategory, type AppConfig } from "../utils/config"
import { downloadModule, previewModuleUpdate, writeModuleText, type ModuleUpdatePreview } from "../utils/downloader"
import { EditModuleView } from "./EditModuleView"
import { RemoteControlView } from "./RemoteControlView"
import { SettingsView } from "./SettingsView"
import { useMarkdownReleaseNotesSheet } from "./ReleaseNotesSheet"
import {
  disableNewModuleByDefault,
  fetchEnabledModuleNames,
  getModuleRemoteName,
  refreshEnabledRemoteModule,
  setRemoteModuleEnabled,
} from "../utils/remote_control"
import { autoExportMetadataToICloud } from "../utils/metadata_sync"
import {
  listModuleBackups,
  restoreModuleBackup,
  type ModuleBackup,
} from "../utils/backups"
import { inspectModuleHealth } from "../utils/health"
import { recordRecentImport } from "../utils/recent_imports"

function ModuleIcon(props: { module: ModuleInfo }) {
  const [failed, setFailed] = useState(false)
  const isRemote = !!props.module.link
  const fallbackName = isRemote ? "icloud.and.arrow.down.fill" : "puzzlepiece.extension.fill"
  const fallbackColor = isRemote ? "systemBlue" : "systemOrange"
  const frame = { width: 30, height: 30 }
  const iconShape = { type: "rect", cornerRadius: 7 } as any

  const fallback = (
    <Image
      systemName={fallbackName}
      font={24}
      foregroundStyle={fallbackColor}
      frame={frame}
    />
  )

  if (props.module.icon && !failed) {
    return (
      <Image
        imageUrl={props.module.icon}
        placeholder={fallback}
        onError={() => setFailed(true)}
        resizable
        interpolation="high"
        clipShape={iconShape}
        frame={frame}
      />
    )
  }

  return fallback
}

function FilterMenu(props: {
  value: string
  options: string[]
  onSelect: (value: string) => void
}) {
  return (
    <Menu
      label={(
        <HStack spacing={3} frame={{ width: 96, alignment: "trailing" }}>
          <Text lineLimit={1} truncationMode="tail" foregroundStyle="accentColor">
            {props.value}
          </Text>
          <Image systemName="chevron.down" font={10} foregroundStyle="accentColor" />
        </HStack>
      )}
    >
      {props.options.map((item, idx) => (
        <Button
          key={`${item}-${idx}`}
          title={item}
          action={() => {
            HapticFeedback.heavyImpact()
            props.onSelect(item)
          }}
        />
      ))}
    </Menu>
  )
}

function BatchMoveMenu(props: {
  disabled: boolean
  targets: { label: string; path: string }[]
  onMove: (path: string) => void | Promise<void>
}) {
  const foreground = props.disabled ? "secondaryLabel" : "systemBlue"

  return (
    <Menu
      label={(
        <VStack
          frame={{ maxWidth: "infinity", minHeight: 46, alignment: "center" }}
          padding={{ top: 3, bottom: 3 }}
          spacing={2}
        >
          <Image systemName="folder" font={15} foregroundStyle={foreground} />
          <Text font="caption2" foregroundStyle={foreground} lineLimit={1}>
            移动
          </Text>
        </VStack>
      )}
      disabled={props.disabled}
      buttonStyle="borderless"
      glassEffect
      buttonBorderShape="roundedRectangle"
      tint="systemBlue"
      frame={{ maxWidth: "infinity", minHeight: 46 }}
      listRowBackground={<EmptyView />}
      listRowSeparator="hidden"
    >
      {props.targets.map((target) => (
        <Button
          key={target.path}
          title={target.label}
          action={() => {
            HapticFeedback.mediumImpact()
            void props.onMove(target.path)
          }}
        />
      ))}
    </Menu>
  )
}

function BatchRemoteMenu(props: {
  disabled: boolean
  onSetEnabled: (enabled: boolean) => void | Promise<void>
}) {
  const foreground = props.disabled ? "secondaryLabel" : "systemBlue"

  return (
    <Menu
      label={(
        <VStack
          frame={{ maxWidth: "infinity", minHeight: 46, alignment: "center" }}
          padding={{ top: 3, bottom: 3 }}
          spacing={2}
        >
          <Image systemName="antenna.radiowaves.left.and.right" font={15} foregroundStyle={foreground} />
          <Text font="caption2" foregroundStyle={foreground} lineLimit={1}>
            远程
          </Text>
        </VStack>
      )}
      disabled={props.disabled}
      buttonStyle="borderless"
      glassEffect
      buttonBorderShape="roundedRectangle"
      tint="systemBlue"
      frame={{ maxWidth: "infinity", minHeight: 46 }}
      listRowBackground={<EmptyView />}
      listRowSeparator="hidden"
    >
      <Button
        title="启用所选"
        systemImage="checkmark.circle"
        action={() => {
          HapticFeedback.mediumImpact()
          void props.onSetEnabled(true)
        }}
      />
      <Button
        title="停用所选"
        systemImage="slash.circle"
        action={() => {
          HapticFeedback.mediumImpact()
          void props.onSetEnabled(false)
        }}
      />
    </Menu>
  )
}

function BatchCompactButton(props: {
  title: string
  systemImage: string
  tint?: "systemBlue" | "systemGreen" | "systemRed"
  disabled?: boolean
  onPress: () => void | Promise<void>
}) {
  const foreground = props.disabled ? "secondaryLabel" : (props.tint ?? "systemBlue")

  return (
    <Button
      action={() => {
        HapticFeedback.mediumImpact()
        void props.onPress()
      }}
      disabled={props.disabled}
      buttonStyle="borderless"
      glassEffect
      buttonBorderShape="roundedRectangle"
      tint={props.tint ?? "systemBlue"}
      frame={{ maxWidth: "infinity", minHeight: 46 }}
      listRowBackground={<EmptyView />}
      listRowSeparator="hidden"
    >
      <VStack
        frame={{ maxWidth: "infinity", minHeight: 46, alignment: "center" }}
        padding={{ top: 3, bottom: 3 }}
        spacing={2}
      >
        <Image systemName={props.systemImage} font={15} foregroundStyle={foreground} />
        <Text font="caption2" foregroundStyle={foreground} lineLimit={1}>
          {props.title}
        </Text>
      </VStack>
    </Button>
  )
}

function CategoryChip(props: {
  title: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Button
      title={props.title}
      action={() => {
        HapticFeedback.mediumImpact()
        props.onPress()
      }}
      buttonStyle="glass"
      buttonBorderShape="roundedRectangle"
      tint={props.selected ? "systemBlue" : "systemGray"}
      frame={{ minWidth: 54, minHeight: 34 }}
    />
  )
}

function formatBackupTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return String(timestamp)
  }
}

function BackupPickerView(props: {
  moduleName: string
  backups: ModuleBackup[]
}) {
  const dismiss = Navigation.useDismiss()

  return (
    <NavigationStack>
      <List
        navigationTitle="选择回滚版本"
        navigationBarTitleDisplayMode="inline"
      >
        <Section header={<Text>{props.moduleName}</Text>}>
          {props.backups.map((backup) => (
            <Button
              key={backup.path}
              title={`${formatBackupTime(backup.timestamp)} · ${backup.label}`}
              action={() => {
                HapticFeedback.mediumImpact()
                dismiss(backup.path)
              }}
            />
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}

function buildPreviewMessage(preview: ModuleUpdatePreview): string {
  const added = preview.added.length
    ? preview.added.map((line) => `+ ${line}`).join("\n")
    : "无新增行"
  const removed = preview.removed.length
    ? preview.removed.map((line) => `- ${line}`).join("\n")
    : "无删除行"
  const addedMore = preview.addedCount > preview.added.length
    ? `\n…其余新增 ${preview.addedCount - preview.added.length} 行未展开`
    : ""
  const removedMore = preview.removedCount > preview.removed.length
    ? `\n…其余删除 ${preview.removedCount - preview.removed.length} 行未展开`
    : ""
  return [
    `新增 ${preview.addedCount} 行，删除 ${preview.removedCount} 行`,
    "",
    "新增内容：",
    added + addedMore,
    "",
    "删除内容：",
    removed + removedMore,
    "",
    "确认后会自动备份当前文件，再写入新版本。",
  ].join("\n")
}

function ModuleSummaryCard(props: {
  total: number
  visible: number
  enabled: number
  remoteReady: boolean
}) {
  const visibleText = props.visible === props.total
    ? "全部显示"
    : `当前显示 ${props.visible} 个`
  const stateText = props.remoteReady
    ? `远程已启用 ${props.enabled}/${props.total}`
    : "未配置远程控制"

  return (
    <VStack
      spacing={10}
      padding={{ top: 14, bottom: 14, leading: 16, trailing: 16 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      glassEffect={{ type: "rect", cornerRadius: 24 } as any}
      listRowBackground={<EmptyView />}
      listRowSeparator="hidden"
    >
      <HStack spacing={12}>
        <Image
          systemName="square.grid.2x2.fill"
          font={22}
          foregroundStyle="systemBlue"
          frame={{ width: 34, height: 34 }}
        />
        <VStack alignment="leading" spacing={2}>
          <Text font="caption" foregroundStyle="secondaryLabel">模块总数</Text>
          <Text font="title">{String(props.total)}</Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={4}>
          <Text font="caption" foregroundStyle="secondaryLabel">{visibleText}</Text>
          <Text font="caption" foregroundStyle={props.remoteReady ? "systemGreen" : "secondaryLabel"}>
            {stateText}
          </Text>
        </VStack>
      </HStack>
    </VStack>
  )
}

function BottomActionButton(props: {
  title: string
  systemImage: string
  tint: "systemBlue" | "systemGreen" | "systemPurple"
  disabled?: boolean
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      action={() => {
        HapticFeedback.mediumImpact()
        void props.onPress()
      }}
      buttonStyle="glass"
      buttonBorderShape="roundedRectangle"
      tint={props.tint}
      disabled={props.disabled}
      frame={{ maxWidth: "infinity", minHeight: 48 }}
      listRowBackground={<EmptyView />}
      listRowSeparator="hidden"
    >
      <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "center" }}>
        <Image systemName={props.systemImage} font={16} foregroundStyle={props.tint} />
        <Text font="headline" foregroundStyle={props.tint}>{props.title}</Text>
      </HStack>
    </Button>
  )
}

export function HomeView(props: { refreshToken?: number; tag?: number; tabItem?: any } = {}) {
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    markdownFile: "changelog.md",
    storageKey: "surge-modules-manager:release-notes:last-seen-hash",
    title: "更新内容",
  })

  const withButtonHaptic = (action: () => void | Promise<void>) => () => {
    HapticFeedback.mediumImpact()
    void action()
  }
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [stage, setStage] = useState("就绪")
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolvedBaseDir, setResolvedBaseDir] = useState("")
  const [filterCategory, setFilterCategory] = useState("全部")
  const [searchText, setSearchText] = useState("")
  const [searchVisible, setSearchVisible] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [moveTargets, setMoveTargets] = useState<{ label: string; path: string }[]>([])
  const [lastFailureDetails, setLastFailureDetails] = useState("")
  const [statusCardVisible, setStatusCardVisible] = useState(false)
  const [contentIndexLoaded, setContentIndexLoaded] = useState(false)
  const [enabledModuleNames, setEnabledModuleNames] = useState<Set<string>>(new Set())
  const [togglingModuleNames, setTogglingModuleNames] = useState<Set<string>>(new Set())
  const categories = cfg.categories ?? []
  const filterOptions = useMemo(() => ["全部", ...categories], [categories])
  const baseDir = resolvedBaseDir || cfg.baseDir
  const dirOptions = useMemo(() => {
    const set = new Set<string>()
    for (const m of modules) {
      const p = m.filePath ? String(m.filePath) : ""
      if (!p) continue
      const rel = baseDir ? p.replace(baseDir, "").replace(/^\/+/, "") : p
      const dir = rel.includes("/") ? rel.split("/")[0] : ""
      if (dir) set.add(dir)
    }
    return ["全部", ...Array.from(set)]
  }, [modules, baseDir])
  const [filterDir, setFilterDir] = useState("全部")

  function getTopDir(m: ModuleInfo): string {
    const p = m.filePath ? String(m.filePath) : ""
    if (!p) return ""
    const rel = baseDir ? p.replace(baseDir, "").replace(/^\/+/, "") : p
    return rel.includes("/") ? rel.split("/")[0] : ""
  }

  const searchKey = searchText.trim().toLowerCase()
  const filteredModules = useMemo(() => {
    return modules.filter((m) => {
      const catOk = filterCategory === "全部" ? true : m.category === filterCategory
      const dirOk = filterDir === "全部" ? true : getTopDir(m) === filterDir
      if (!catOk || !dirOk || !searchKey) return catOk && dirOk
      return [m.name, m.surgeName, m.category, m.link, m.content]
        .some((value) => String(value ?? "").toLowerCase().includes(searchKey))
    })
  }, [modules, filterCategory, filterDir, searchKey, baseDir])
  const selectedModules = filteredModules.filter((m) => selectedKeys.has(moduleKey(m)))
  const selectedDownloadableCount = selectedModules.filter((m) => !!m.link).length
  const selectedRemoteCount = selectedModules.length
  const onlyLocalFiltered =
    filteredModules.length > 0 && filteredModules.every((m) => m.isLocal || !m.link)
  const remoteControlReady = !!String(cfg.remotePort ?? "").trim()
  const enabledRemoteCount = useMemo(
    () => modules.filter((m) => enabledModuleNames.has(getModuleRemoteName(m))).length,
    [modules, enabledModuleNames],
  )

  function persistModuleCategory(category?: string) {
    const value = String(category ?? "").trim()
    if (!value || categories.includes(value)) return
    setCfg(persistCategory(value))
  }

  function moduleKey(m: ModuleInfo): string {
    return m.filePath || `${m.name}-${m.link}`
  }

  function isConverterModuleLink(link: string): boolean {
    const value = String(link ?? "")
    return /https?:\/\/script\.hub(?:\/|$)|_start_|_end_|[?&]type=(?:surge-module|loon-plugin|qx-rewrite|all-module)(?:&|$)/i.test(value)
  }

  function dirName(path: string): string {
    const normalized = String(path ?? "").replace(/\/+$/, "")
    return normalized.split("/").pop() || normalized || "根目录"
  }

  function inferSaveDir(m: ModuleInfo): string | undefined {
    if (!m.filePath) return undefined
    const idx = String(m.filePath).lastIndexOf("/")
    return idx > 0 ? String(m.filePath).slice(0, idx) : undefined
  }

  async function refreshModules(
    resetStageOnSuccess = false,
    includeContent = false,
  ): Promise<boolean> {
    try {
      await ensureStorage()
      const resolved = await getModulesDirResolved()
      setResolvedBaseDir(resolved)
      const list = sortModules(await loadModules(resolved, includeContent))
      setModules(list)
      setContentIndexLoaded(includeContent)
      try {
        const subDirs = await listDirectSubDirs(resolved)
        setMoveTargets([
          { label: "根目录", path: resolved },
          ...subDirs.map((path) => ({ label: dirName(path), path })),
        ])
      } catch {
        setMoveTargets(resolved ? [{ label: "根目录", path: resolved }] : [])
      }
      if (resetStageOnSuccess) {
        setStage("就绪")
        setProgress(null)
      }
      return true
    } catch (e: any) {
      setModules([])
      setMoveTargets([])
      setContentIndexLoaded(false)
      setStage(String(e?.message ?? e))
      return false
    }
  }

  async function syncMetadataIfNeeded() {
    await autoExportMetadataToICloud(cfg)
  }

  async function readInstalledModuleText(target: ModuleInfo): Promise<string | undefined> {
    const path = target.filePath
    const fm: any = (globalThis as any).FileManager
    if (!path || !fm?.readAsString) return undefined
    try {
      const content = String(await fm.readAsString(path) ?? "")
      return content.trim() ? content : undefined
    } catch {
      return undefined
    }
  }

  async function syncLocalizationSetting(enabled: boolean) {
    const remoteModules = modules.filter((item) => !!item.link)
    if (!remoteModules.length) return
    let sourceContents: Map<string, string> | undefined
    if (enabled) {
      const fm: any = (globalThis as any).FileManager
      if (fm?.readAsString) {
        const cached = new Map<string, string>()
        for (const item of remoteModules) {
          // Localize the module that is actually installed. Do not fetch the
          // `#!url` again: converter links such as boxjs/script.hub may return
          // a script or a transient response instead of a Surge module.
          if (!item.filePath) continue
          try {
            const content = String(await fm.readAsString(item.filePath) ?? "")
            // Keep an empty value in the map as well. Its presence tells
            // downloadBatch to fail locally instead of falling back to the
            // remote `#!url` when a bookmarked file cannot be read.
            cached.set(moduleKey(item), content)
          } catch {
            cached.set(moduleKey(item), "")
          }
        }
        if (cached.size) sourceContents = cached
      }
    }
    await downloadBatch(
      remoteModules,
      enabled ? "开启本地化：同步现有模块…" : "关闭本地化：切回远程引用…",
      sourceContents,
    )
  }

  useEffect(() => {
    void refreshModules()
  }, [props.refreshToken])

  useEffect(() => {
    void refreshRemoteModules(true, loadConfig())
  }, [])

  useEffect(() => {
    if (!searchKey || contentIndexLoaded || !modules.length) return
    void refreshModules(false, true)
  }, [searchKey, contentIndexLoaded, modules.length])

  useEffect(() => {
    if (filterDir !== "全部" && !dirOptions.includes(filterDir)) {
      setFilterDir("全部")
    }
  }, [dirOptions, filterDir])

  useEffect(() => {
    if (filterCategory === "全部") return
    if (!categories.includes(filterCategory)) {
      setFilterCategory("全部")
    }
  }, [categories, filterCategory])

  useEffect(() => {
    const hasStatus = stage !== "就绪" || progress !== null || !!lastFailureDetails
    if (!hasStatus) {
      setStatusCardVisible(false)
      return
    }

    setStatusCardVisible(true)
    const timer = setTimeout(() => {
      setStatusCardVisible(false)
    }, 3000)

    return () => clearTimeout(timer)
  }, [stage, progress, lastFailureDetails])

  useEffect(() => {
    const validKeys = new Set(modules.map((m) => moduleKey(m)))
    setSelectedKeys((previous) => {
      const next = new Set(Array.from(previous).filter((key) => validKeys.has(key)))
      if (next.size === previous.size) return previous
      return next
    })
  }, [modules])

  function toggleSelection(target: ModuleInfo) {
    const key = moduleKey(target)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function clearSelection() {
    setSelectedKeys(new Set())
  }

  function exitSelectionMode() {
    setSelectionMode(false)
    clearSelection()
  }

  function selectAllFiltered() {
    if (
      filteredModules.length > 0 &&
      filteredModules.every((m) => selectedKeys.has(moduleKey(m)))
    ) {
      clearSelection()
      return
    }
    setSelectedKeys(new Set(filteredModules.map((m) => moduleKey(m))))
  }

  function invertFilteredSelection() {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (const item of filteredModules) {
        const key = moduleKey(item)
        if (next.has(key)) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }

  async function shareSelectedModules() {
    if (!selectedModules.length) {
      await Dialog.alert({ message: "请先选择模块" })
      return
    }

    const fm: any = (globalThis as any).FileManager
    const paths = selectedModules
      .map((item) => String(item.filePath ?? "").trim())
      .filter(Boolean)
    if (!paths.length) {
      await Dialog.alert({ message: "所选模块没有可分享的本地文件" })
      return
    }

    const existingPaths: string[] = []
    for (const path of paths) {
      const exists = typeof fm?.exists === "function"
        ? await fm.exists(path)
        : typeof fm?.existsSync === "function" ? fm.existsSync(path) : true
      if (exists) existingPaths.push(path)
    }
    if (!existingPaths.length) {
      await Dialog.alert({ message: "所选模块文件已不可用，请先刷新模块列表" })
      return
    }

    const shareSheet: any = (globalThis as any).ShareSheet
    if (typeof shareSheet?.present !== "function") {
      await Dialog.alert({
        title: "当前版本不支持批量分享",
        message: "请升级 Scripting，或在“文件”中多选 .sgmodule 后分享给本脚本/捷径。",
      })
      return
    }

    const openedEntities: any[] = []
    try {
      const fileEntity: any = (globalThis as any).FileEntity
      const items = existingPaths.map((path) => {
        if (typeof fileEntity?.openForReading !== "function") return path
        try {
          const entity = fileEntity.openForReading(path)
          openedEntities.push(entity)
          return entity
        } catch {
          return path
        }
      })
      setStage(`准备分享 ${existingPaths.length} 个模块…`)
      const shared = await shareSheet.present(items)
      setStage(shared ? `已分享 ${existingPaths.length} 个模块` : "已取消分享")
    } catch (e: any) {
      setStage(`分享失败：${String(e?.message ?? e)}`)
      await Dialog.alert({ title: "批量分享失败", message: String(e?.message ?? e) })
    } finally {
      for (const entity of openedEntities) {
        try { entity?.close?.() } catch {}
      }
    }
  }

  async function openSettings() {
    await Navigation.present({
      element: (
        <SettingsView
          initial={loadConfig()}
          onDone={(next) => {
            const localizationChanged = cfg.localizeScriptsOnDownload !== next.localizeScriptsOnDownload
            setCfg(next)
            if (localizationChanged) void syncLocalizationSetting(next.localizeScriptsOnDownload)
          }}
        />
      ),
    })
    setCfg(loadConfig())
    await refreshModules(true)
  }

  async function openRemoteSettings() {
    await Navigation.present({
      element: (
        <RemoteControlView
          initial={loadConfig()}
          onDone={(next) => {
            setCfg(next)
          }}
        />
      ),
    })
    const next = loadConfig()
    setCfg(next)
    await refreshRemoteModules(true, next)
  }

  async function refreshRemoteModules(silent = false, nextCfg: AppConfig = cfg) {
    if (!String(nextCfg.remotePort ?? "").trim()) {
      setEnabledModuleNames(new Set())
      return
    }
    try {
      const enabled = await fetchEnabledModuleNames(nextCfg)
      setEnabledModuleNames(enabled)
    } catch (e: any) {
      setEnabledModuleNames(new Set())
      if (!silent) setStage(`远程状态获取失败：${String(e?.message ?? e)}`)
    }
  }

  async function refreshAll() {
    if (busy) return
    setBusy(true)
    setLastFailureDetails("")
    setStage("刷新模块列表…")
    try {
      const ok = await refreshModules(true)
      if (ok) await refreshRemoteModules(false, loadConfig())
    } finally {
      setBusy(false)
    }
  }

  async function runHealthCheck() {
    if (busy) return
    setBusy(true)
    setStage("检查模块健康状态…")
    try {
      const report = await inspectModuleHealth(modules)
      const issueText = report.issues
        .slice(0, 12)
        .map((issue) => `${issue.level === "error" ? "❌" : "⚠️"} ${issue.moduleName}：${issue.message}`)
        .join("\n")
      const omitted = report.issues.length > 12
        ? `\n其余 ${report.issues.length - 12} 个问题已省略`
        : ""
      const message = report.issues.length
        ? `已检查 ${report.checked} 个模块\n错误 ${report.errors} 个，警告 ${report.warnings} 个\n\n${issueText}${omitted}`
        : `已检查 ${report.checked} 个模块，未发现问题。`
      await Dialog.alert({
        title: report.issues.length ? "发现模块问题" : "模块状态正常",
        message,
      })
      setStage(report.issues.length ? "健康检查完成：发现问题" : "健康检查完成")
    } catch (e: any) {
      const message = String(e?.message ?? e)
      setStage(`健康检查失败：${message}`)
      await Dialog.alert({ title: "健康检查失败", message })
    } finally {
      setBusy(false)
    }
  }

  async function addModule() {
    if (!categories.length) {
      await Dialog.alert({ message: "请先在设置页添加分类" })
      return
    }
    const subDirs = await listDirectSubDirs()
    const info = await Navigation.present<ModuleInfo>({
      element: <EditModuleView title="添加模块" categories={categories} saveDirs={subDirs} />,
    })
    if (!info) return

    const current = modules
    const nameExists = current.some((m) => m.name === info.name)
    const linkExists = info.link ? current.some((m) => m.link === info.link) : false
    if (nameExists) {
      await Dialog.alert({ message: "模块名称已存在" })
      return
    }
    if (linkExists) {
      await Dialog.alert({ message: "下载链接已存在" })
      return
    }

    setBusy(true)
    setStage("添加模块中…")
    setProgress(null)
    try {
      persistModuleCategory(info.category)
      let addedModule: ModuleInfo | undefined
      if (info.isLocal) {
        setStage(`保存模块：${info.name}`)
        const result = await writeModuleText(
          info,
          info.saveDir ?? (await getModulesDirResolved()),
          info.content ?? "",
          { isLocal: true },
        )
        if (!result.ok) throw new Error(result.message ?? "本地模块写入失败")
        addedModule = await loadModuleAtPath(result.path ?? moduleFilePath(info.name, info.saveDir)) ?? info
        recordRecentImport(addedModule)
        setStage(result.localizedResources
          ? `添加完成（模块资源已本地化 ${result.localizedResources} 个）：${result.path ?? info.saveDir ?? "当前配置目录"}`
          : `添加完成（已写入 Surge）：${result.path ?? info.saveDir ?? "当前配置目录"}`)
      } else {
        setStage(`下载模块：${info.name}`)
        const res = await downloadModule(info)
        if (!res.ok) {
          await Dialog.alert({ message: res.message ?? "下载失败" })
          setStage("添加完成（下载失败）")
        } else {
          addedModule = await loadModuleAtPath(res.path ?? moduleFilePath(info.name, info.saveDir)) ?? info
          recordRecentImport(addedModule)
          setStage(`添加完成（已写入 Surge）：${res.path ?? "当前配置目录"}`)
        }
      }

      if (addedModule) {
        const remoteName = getModuleRemoteName(addedModule)
        const disabled = await disableNewModuleByDefault(loadConfig(), remoteName)
        if (disabled) setStage(`添加完成（默认关闭：${remoteName}）`)
      }
      await refreshModules()
      await refreshRemoteModules(true, loadConfig())
      await syncMetadataIfNeeded()
    } catch (e: any) {
      setStage(`添加失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function modifyModuleFor(target: ModuleInfo) {
    const current = modules
    const subDirs = await listDirectSubDirs()
    const originalSaveDir = inferSaveDir(target)
    const updated = await Navigation.present<ModuleInfo>({
      element: (
        <EditModuleView
          title="编辑模块"
          categories={categories}
          initial={{ ...target, saveDir: originalSaveDir }}
          saveDirs={subDirs}
        />
      ),
    })
    if (!updated) return

    const idx = current.findIndex((m) => m.name === target.name && m.link === target.link)
    if (idx < 0) return

    const merged: ModuleInfo = { ...target, ...updated }

    if (merged.name) {
      const nameExists = current.some((m, i) => i !== idx && m.name === merged.name)
      if (nameExists) {
        await Dialog.alert({ message: "模块名称已存在" })
        return
      }
    }

    if (merged.link) {
      const linkExists = current.some((m, i) => i !== idx && m.link === merged.link)
      if (linkExists) {
        await Dialog.alert({ message: "下载链接已存在" })
        return
      }
    }

    setBusy(true)
    setStage("修改模块中…")
    setProgress(null)
    try {
      persistModuleCategory(merged.category)
      const finalName = merged.name || target.name
      const finalSaveDir = merged.saveDir ?? originalSaveDir
      const needMove =
        finalName !== target.name ||
        String(finalSaveDir ?? "") !== String(originalSaveDir ?? "")
      const finalFilePath = needMove
        ? await moveModuleFile(target, finalSaveDir, finalName)
        : (target.filePath ?? moduleFilePath(finalName, finalSaveDir))

      if (merged.isLocal || !merged.link) {
        await saveLocalModule(
          { ...merged, name: finalName, saveDir: finalSaveDir, filePath: finalFilePath },
          merged.content ?? ""
        )
      } else {
        await updateModuleMetadata({ ...merged, name: finalName, filePath: finalFilePath }, {
          link: merged.link,
          sourceURL: merged.sourceURL,
          category: merged.category ?? "",
          local: false,
        })
      }
      await refreshModules()
      await syncMetadataIfNeeded()
      setStage("修改完成")
    } catch (e: any) {
      setStage(`修改失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function viewModuleContent(target: ModuleInfo) {
    try {
      const fm: any = (globalThis as any).FileManager
      if (!fm?.readAsString) throw new Error("FileManager.readAsString 不可用")
      const path = target.filePath ?? moduleFilePath(target.name)
      const text = await fm.readAsString(path)
      if (!text) {
        await Dialog.alert({ message: "模块内容为空或读取失败" })
        return
      }
      const controller = new (globalThis as any).EditorController({
        content: String(text),
        ext: "txt",
        readOnly: true,
      })
      try {
        await controller.present({ navigationTitle: target.name, fullscreen: true })
      } finally {
        controller.dispose()
      }
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function localizeResourcesFor(target: ModuleInfo) {
    const path = target.filePath ?? moduleFilePath(target.name, inferSaveDir(target))
    const targetDir = inferSaveDir(target) ?? (await getModulesDirResolved())
    if (!targetDir) {
      await Dialog.alert({ message: "书签路径不可用，请在设置页重新选择 iCloud/Surge 文件夹" })
      return
    }
    setBusy(true)
    setStage(`整理现有模块资源：${target.name}`)
    try {
      // Process the file that is actually in the Surge directory. This is
      // intentionally offline for an explicit localization action: the
      // localizer can migrate old paths without fetching the module again.
      const fm: any = (globalThis as any).FileManager
      if (!fm?.readAsString) throw new Error("FileManager.readAsString 不可用")
      const content = String(await fm.readAsString(path) ?? "")
      const result = await writeModuleText(
        { ...target, saveDir: targetDir, filePath: path },
        targetDir,
        content,
        { localizeResources: true },
      )
      if (!result.ok) throw new Error(result.message ?? "模块资源本地化失败")
      let surgeReloaded = false
      let surgeReloadFailed = false
      try {
        // The iCloud file is now correct, but Surge may still hold the old
        // module text in its active profile. Toggle only an already-enabled
        // module so its state is preserved while forcing a reread.
        surgeReloaded = await refreshEnabledRemoteModule(
          loadConfig(),
          getModuleRemoteName(target),
        )
      } catch {
        surgeReloadFailed = true
      }
      await refreshModules()
      await syncMetadataIfNeeded()
      const surgeReloadMessage = surgeReloaded
        ? "Surge 已重新加载该模块。"
        : surgeReloadFailed
          ? "Surge 自动刷新失败，请在 Surge 中关闭后重新启用该模块。"
          : "如 Surge 仍显示旧路径，请在 Surge 中关闭后重新启用该模块。"
      if (result.localizedResources) {
        setStage(`资源已写入 Surge 配置目录：${result.localizedResources} 个`)
        await Dialog.alert({
          title: "已整理并本地化",
          message: `已处理 ${result.localizedResources} 个远程资源，并写入 Surge 根目录；模块引用已改为根目录文件名。\n\n${surgeReloadMessage}\n例如：文件为 Surge/timecard.js，模块内应为 script-path=timecard.js。`,
        })
      } else {
        setStage("模块没有可下载的远程资源")
        await Dialog.alert({ message: target.link
          ? `当前模块没有发现可本地化的远程脚本、规则集或 include；已有本地路径已完成校正。\n\n${surgeReloadMessage}`
          : `当前本地模块没有可本地化的远程脚本、规则集或 include。\n\n${surgeReloadMessage}` })
      }
    } catch (e: any) {
      const message = String(e?.message ?? e)
      setStage(`模块资源本地化失败：${message}`)
      await Dialog.alert({ title: "模块资源本地化失败", message })
    } finally {
      setBusy(false)
    }
  }

  async function previewModuleFor(target: ModuleInfo) {
    if (!target.link) {
      await Dialog.alert({ message: "本地模块没有远程内容，无法预览更新" })
      return
    }

    let preview: ModuleUpdatePreview | null = null
    setBusy(true)
    setStage(`读取更新预览：${target.name}`)
    try {
      const linkPrefix = await detectLinkPrefix(target)
      preview = await previewModuleUpdate({
        ...target,
        saveDir: inferSaveDir(target),
        linkPrefix,
      })
      if (!preview.changed) {
        await Dialog.alert({ title: "无需更新", message: "远程内容与本地文件一致。" })
        return
      }
    } catch (e: any) {
      const message = String(e?.message ?? e)
      setStage(`预览失败：${message}`)
      await Dialog.alert({ title: "更新预览失败", message })
      return
    } finally {
      setBusy(false)
    }

    if (!preview) return
    const confirmed = await Dialog.confirm({
      title: `更新预览：${target.name}`,
      message: buildPreviewMessage(preview),
    })
    if (!confirmed) return

    const sourceContents = new Map<string, string>([
      [moduleKey(target), preview.sourceContent],
    ])
    await downloadBatch([target], `更新模块：${target.name}`, sourceContents)
  }

  async function restoreModuleFor(target: ModuleInfo) {
    const path = target.filePath ?? moduleFilePath(target.name)
    setBusy(true)
    setStage(`读取备份：${target.name}`)
    try {
      const backups = await listModuleBackups(path)
      if (!backups.length) {
        await Dialog.alert({ message: "这个模块还没有可用的备份。远程更新或覆盖写入后会自动生成备份。" })
        return
      }

      const selectedPath = await Navigation.present<string | null>({
        element: <BackupPickerView moduleName={target.name} backups={backups} />,
        modalPresentationStyle: "pageSheet",
      })
      if (!selectedPath) return

      const selected = backups.find((backup) => backup.path === selectedPath)
      const confirmed = await Dialog.confirm({
        title: "确认回滚",
        message: `将 ${target.name} 回滚到 ${formatBackupTime(selected?.timestamp ?? 0)}？\n当前文件也会先自动备份。`,
      })
      if (!confirmed) return

      setStage(`回滚模块：${target.name}`)
      await restoreModuleBackup(path, selectedPath)
      await refreshModules()
      await syncMetadataIfNeeded()
      setStage("回滚完成")
    } catch (e: any) {
      const message = String(e?.message ?? e)
      setStage(`回滚失败：${message}`)
      await Dialog.alert({ title: "回滚失败", message })
    } finally {
      setBusy(false)
    }
  }

  async function deleteModuleFor(target: ModuleInfo) {
    const ok = await Dialog.confirm({
      title: "删除模块",
      message: `确定删除模块：${target.name}？`,
    })
    if (!ok) return

    setBusy(true)
    setStage("删除模块中…")
    setProgress(null)
    try {
      await removeModuleFile(target)
      await refreshModules()
      await syncMetadataIfNeeded()
      setStage("删除完成")
    } catch (e: any) {
      setStage(`删除失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function copyModuleLink(target: ModuleInfo) {
    try {
      await Pasteboard.setString(target.link)
      await Dialog.alert({ message: "链接已复制" })
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function copyFailureDetails() {
    if (!lastFailureDetails) return
    try {
      await Pasteboard.setString(lastFailureDetails)
      await Dialog.alert({ message: "失败详情已复制" })
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function downloadSingle(target: ModuleInfo, sourceContent?: string) {
    if (!target.link) {
      await Dialog.alert({ message: "本地模块无下载链接，无法更新" })
      return
    }
    const sourceContents = sourceContent === undefined
      ? undefined
      : new Map<string, string>([[moduleKey(target), sourceContent]])
    await downloadBatch([target], `下载模块：${target.name}`, sourceContents)
  }

  async function downloadBatch(
    list: ModuleInfo[],
    title: string,
    sourceContents?: Map<string, string>,
  ) {
    const downloadable = list.filter((m) => !!m.link)
    if (!downloadable.length) {
      await Dialog.alert({ message: "暂无可下载模块" })
      return
    }

    setBusy(true)
    setStage(title)
    setProgress(null)
    setLastFailureDetails("")
    const errors: string[] = []
    let okCount = 0
    let localizedResourceCount = 0
    try {
      const total = downloadable.length
      let nextIndex = 0
      let completed = 0
      // A localization batch rewrites several files that Surge watches. Keep
      // those writes serial so iCloud does not deliver a burst of profile
      // changes that looks like a reload loop to Surge.
      const configuredConcurrency = Math.max(1, Math.min(cfg.downloadConcurrency || 3, total))
      const localizeEnabled = loadConfig().localizeScriptsOnDownload
      const concurrency = sourceContents || localizeEnabled ? 1 : configuredConcurrency

      const updateOverallProgress = () => {
        setStage(`下载中：已完成 ${completed}/${total}`)
        setProgress(completed / total)
      }

      updateOverallProgress()

      async function worker() {
        for (;;) {
          const idx = nextIndex
          nextIndex += 1
          if (idx >= total) return

          const m = downloadable[idx]
          const linkPrefix = await detectLinkPrefix(m)
          let sourceContent = sourceContents?.get(moduleKey(m))
          // A converter URL is not a stable module download endpoint. When
          // the installed module already has local resources, use its current
          // text first and only fall back to the URL if that text cannot be
          // read from the selected Surge bookmark.
          if (sourceContent === undefined && localizeEnabled && isConverterModuleLink(m.link)) {
            sourceContent = await readInstalledModuleText(m)
          }
          const downloadInfo = { ...m, saveDir: inferSaveDir(m), linkPrefix }
          let res = await downloadModule(
            downloadInfo,
            sourceContent === undefined
              ? undefined
              : { content: sourceContent, localizeResources: localizeEnabled },
          )

          // Some `#!url` values are converter endpoints rather than direct
          // Surge module downloads. If the remote response is invalid, keep
          // the installed module as the source and repair/localize it
          // offline. This is what makes Update All safe for boxjs and similar
          // Script-Hub-generated modules.
          if (!res.ok && sourceContent === undefined && localizeEnabled) {
            sourceContent = await readInstalledModuleText(m)
            if (sourceContent !== undefined) {
              const fallback = await downloadModule(
                downloadInfo,
                { content: sourceContent, localizeResources: true },
              )
              if (fallback.ok) res = fallback
            }
          }
          if (res.ok) {
            okCount += 1
            localizedResourceCount += res.localizedResources ?? 0
            recordRecentImport(m)
          }
          else errors.push(`${m.name}: ${res.message ?? "下载失败"}`)

          completed += 1
          updateOverallProgress()
        }
      }

      const workers = Array.from({ length: concurrency }, () => worker())
      await Promise.all(workers)

      // Do not toggle every updated module here. Each disable/enable pair is a
      // full Surge configuration reload; doing that for a batch can trigger
      // Surge's "configuration reloaded too frequently" guard. iCloud will
      // deliver the changed module files, and a user can manually re-enable a
      // module once if the current Surge build does not notice the change.

      if (errors.length) {
        const details = errors.join("\n")
        setLastFailureDetails(details)
        setStage(`下载完成：成功 ${okCount}/${total}`)
        await Dialog.alert({
          title: "部分下载失败",
          message: `${errors.slice(0, 8).join("\n")}${errors.length > 8 ? `\n其余 ${errors.length - 8} 个失败已省略` : ""}\n\n可在状态区域复制完整失败详情。`,
        })
      } else {
        setLastFailureDetails("")
        setStage(
          `${localizedResourceCount
            ? `下载完成：${okCount}/${total}（模块资源本地化 ${localizedResourceCount} 个）`
            : `下载完成：${okCount}/${total}`}；如 Surge 未立即识别新路径，请手动重新启用对应模块。`,
        )
      }
      if (okCount > 0) {
        await syncMetadataIfNeeded()
        await refreshRemoteModules(true, loadConfig())
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      setLastFailureDetails(msg)
      setStage(`下载失败：${msg}`)
      await Dialog.alert({ title: "下载失败", message: msg })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function downloadAll() {
    await downloadBatch(filteredModules, "下载全部模块…")
  }

  async function downloadSelected() {
    if (!selectedModules.length) {
      await Dialog.alert({ message: "请先选择模块" })
      return
    }
    await downloadBatch(selectedModules, `批量更新：${selectedModules.length} 个模块…`)
  }

  async function deleteSelected() {
    if (!selectedModules.length) {
      await Dialog.alert({ message: "请先选择模块" })
      return
    }
    const ok = await Dialog.confirm({
      title: "批量删除",
      message: `确定删除已选的 ${selectedModules.length} 个模块？`,
    })
    if (!ok) return

    setBusy(true)
    setStage("批量删除中…")
    setProgress(null)
    try {
      for (const item of selectedModules) {
        await removeModuleFile(item)
      }
      exitSelectionMode()
      await refreshModules()
      await syncMetadataIfNeeded()
      setStage("批量删除完成")
    } catch (e: any) {
      setStage(`批量删除失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function moveSelectedTo(targetDir: string) {
    if (!selectedModules.length) {
      await Dialog.alert({ message: "请先选择模块" })
      return
    }

    setBusy(true)
    setStage("批量移动中…")
    setProgress(null)
    try {
      const finalDir = targetDir || (await getModulesDirResolved())
      for (const item of selectedModules) {
        await moveModuleFile(item, finalDir, item.name)
      }
      exitSelectionMode()
      await refreshModules()
      await syncMetadataIfNeeded()
      setStage("批量移动完成")
    } catch (e: any) {
      setStage(`批量移动失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleRemoteModule(target: ModuleInfo, nextValue: boolean) {
    const remoteName = getModuleRemoteName(target)
    if (!remoteControlReady) {
      await Dialog.alert({ message: "请先配置 HTTP 远程控制端口" })
      return
    }
    if (!remoteName) {
      await Dialog.alert({ message: "未找到模块远程名称" })
      return
    }

    HapticFeedback.heavyImpact()
    setTogglingModuleNames((prev) => new Set([...prev, remoteName]))
    setEnabledModuleNames((prev) => {
      const next = new Set(prev)
      if (nextValue) next.add(remoteName)
      else next.delete(remoteName)
      return next
    })

    try {
      await setRemoteModuleEnabled(cfg, remoteName, nextValue)
    } catch (e: any) {
      setEnabledModuleNames((prev) => {
        const next = new Set(prev)
        if (nextValue) next.delete(remoteName)
        else next.add(remoteName)
        return next
      })
      await Dialog.alert({
        title: "远程控制失败",
        message: `${remoteName}\n${String(e?.message ?? e)}`,
      })
    } finally {
      setTogglingModuleNames((prev) => {
        const next = new Set(prev)
        next.delete(remoteName)
        return next
      })
    }
  }

  async function setSelectedRemoteModulesEnabled(nextValue: boolean) {
    if (!remoteControlReady) {
      await Dialog.alert({ message: "请先配置 HTTP 远程控制端口" })
      return
    }
    if (!selectedModules.length) {
      await Dialog.alert({ message: "请先选择模块" })
      return
    }

    const action = nextValue ? "启用" : "停用"
    const confirmed = await Dialog.confirm({
      title: `批量${action}远程模块`,
      message: `将通过 Surge HTTP API ${action}已选的 ${selectedModules.length} 个模块？`,
    })
    if (!confirmed) return

    setBusy(true)
    setStage(`远程${action}中…`)
    setProgress(null)
    const errors: string[] = []
    let completed = 0
    let nextIndex = 0
    try {
      const total = selectedModules.length
      const concurrency = Math.max(1, Math.min(cfg.downloadConcurrency || 3, total))
      const updateProgress = () => {
        setStage(`远程${action}：已完成 ${completed}/${total}`)
        setProgress(completed / total)
      }
      updateProgress()

      async function worker() {
        for (;;) {
          const index = nextIndex
          nextIndex += 1
          if (index >= total) return
          const target = selectedModules[index]
          const remoteName = getModuleRemoteName(target)
          try {
            await setRemoteModuleEnabled(cfg, remoteName, nextValue)
          } catch (e: any) {
            errors.push(`${remoteName}: ${String(e?.message ?? e)}`)
          } finally {
            completed += 1
            updateProgress()
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()))
      await refreshRemoteModules(true, loadConfig())
      setStage(`远程${action}完成：成功 ${total - errors.length}/${total}`)
      if (errors.length) {
        await Dialog.alert({
          title: `部分${action}失败`,
          message: errors.slice(0, 8).join("\n") + (errors.length > 8 ? `\n其余 ${errors.length - 8} 个失败已省略` : ""),
        })
      }
    } catch (e: any) {
      const message = String(e?.message ?? e)
      setStage(`远程${action}失败：${message}`)
      await Dialog.alert({ title: `远程${action}失败`, message })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const fixedStatusPanel = (
    <VStack
      spacing={6}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack>
        <Text font="headline">状态</Text>
        <Spacer />
      </HStack>
      <Text>{stage}</Text>
      {progress !== null ? (
        <ProgressView
          value={progress}
          total={1}
          progressViewStyle="linear"
          frame={{ maxWidth: "infinity" }}
        />
      ) : null}
      {lastFailureDetails ? (
        <VStack alignment="leading" spacing={8}>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={4}>
            {lastFailureDetails}
          </Text>
          <Button
            title="复制失败详情"
            systemImage="doc.on.doc"
            action={withButtonHaptic(copyFailureDetails)}
          />
        </VStack>
      ) : null}
    </VStack>
  )

  const fixedBatchPanel = selectionMode ? (
    <VStack
      spacing={8}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack>
        <Text font="headline">批量操作</Text>
        <Spacer />
        <Text foregroundStyle="secondaryLabel">已选 {selectedModules.length}</Text>
      </HStack>
      <Grid
        horizontalSpacing={6}
        verticalSpacing={0}
        listRowBackground={<EmptyView />}
        listRowSeparator="hidden"
        frame={{ maxWidth: "infinity", alignment: "center" }}
        padding={{ top: 2, bottom: 2 }}
      >
        <GridRow>
          <BatchCompactButton
            title="全选"
            systemImage="checkmark.circle"
            tint="systemBlue"
            onPress={selectAllFiltered}
          />
          <BatchCompactButton
            title="反选"
            systemImage="circle.lefthalf.filled"
            tint="systemBlue"
            onPress={invertFilteredSelection}
          />
          <BatchCompactButton
            title="更新"
            systemImage="arrow.triangle.2.circlepath"
            tint="systemGreen"
            disabled={busy || selectedDownloadableCount === 0}
            onPress={downloadSelected}
          />
          <BatchMoveMenu
            disabled={busy || selectedModules.length === 0}
            targets={moveTargets}
            onMove={moveSelectedTo}
          />
        </GridRow>
        <GridRow>
          <BatchRemoteMenu
            disabled={busy || !remoteControlReady || selectedRemoteCount === 0}
            onSetEnabled={setSelectedRemoteModulesEnabled}
          />
          <BatchCompactButton
            title="删除"
            systemImage="trash"
            tint="systemRed"
            disabled={busy || selectedModules.length === 0}
            onPress={deleteSelected}
          />
          <BatchCompactButton
            title="分享"
            systemImage="square.and.arrow.up"
            tint="systemBlue"
            disabled={busy || selectedModules.length === 0}
            onPress={shareSelectedModules}
          />
          <BatchCompactButton
            title="完成"
            systemImage="checkmark"
            tint="systemBlue"
            onPress={exitSelectionMode}
          />
        </GridRow>
      </Grid>
    </VStack>
  ) : null

  const showStatusPanel = statusCardVisible && (stage !== "就绪" || progress !== null || !!lastFailureDetails)
  const showTopCard = showStatusPanel || selectionMode
  const showSearchPanel = searchVisible || !!searchKey
  const showTopInset = showSearchPanel || showTopCard
  // Keep all four built-in categories visible. "全部" is kept in the menu so
  // an actual category (including 广告) is never hidden behind the overflow
  // control. If a user adds more categories, the selected extra category is
  // shown as the menu label.
  const chipOptions = categories.slice(0, 4)
  const categoryMenuLabel = chipOptions.includes(filterCategory) ? "全部" : filterCategory

  return (
    <NavigationStack>
      <List
        sheet={releaseNotesSheet}
        navigationTitle={"模块管理"}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"insetGroup"}
        toolbar={{
          topBarLeading: (
            <HStack>
              <Button title="" systemImage="switch.2" action={withButtonHaptic(openRemoteSettings)} />
              <Button
                title=""
                systemImage={searchVisible || searchText.trim() ? "magnifyingglass.circle.fill" : "magnifyingglass"}
                action={withButtonHaptic(() => setSearchVisible((value) => !value))}
              />
              <Button
                title=""
                systemImage="arrow.clockwise"
                disabled={busy}
                action={withButtonHaptic(refreshAll)}
              />
            </HStack>
          ),
          topBarTrailing: (
            <HStack>
              <Button
                title=""
                systemImage={selectionMode ? "checkmark.circle.fill" : "checklist"}
                action={withButtonHaptic(() => {
                  if (selectionMode) exitSelectionMode()
                  else setSelectionMode(true)
                })}
              />
              <Button
                title=""
                systemImage="checkmark.shield"
                disabled={busy}
                action={withButtonHaptic(runHealthCheck)}
              />
              <Button title="" systemImage="gearshape" action={withButtonHaptic(openSettings)} />
            </HStack>
          ),
        }}
        ignoresSafeArea={{ regions: "keyboard" }}
        safeAreaInset={{
          top: {
            alignment: "center",
            spacing: 0,
            content: (
              showTopInset ? (
                <VStack
                  spacing={showSearchPanel && showTopCard ? 8 : 0}
                  padding={{ top: 8, bottom: 8, leading: 18, trailing: 18 }}
                  frame={{ maxWidth: "infinity" }}
                >
                  {showSearchPanel ? (
                    <HStack
                      spacing={8}
                      padding={{ top: 10, bottom: 10, leading: 14, trailing: 14 }}
                      frame={{ maxWidth: "infinity" }}
                      glassEffect={{ type: "rect", cornerRadius: 20 } as any}
                    >
                      <TextField
                        title="搜索"
                        value={searchText}
                        onChanged={(value: string) => setSearchText(value)}
                        prompt="搜索名称、链接或内容"
                      />
                      {searchText.trim() ? (
                        <Button
                          title=""
                          systemImage="xmark.circle.fill"
                          action={withButtonHaptic(() => setSearchText(""))}
                        />
                      ) : null}
                    </HStack>
                  ) : null}
                  {showTopCard ? (
                    <VStack
                      spacing={showStatusPanel && selectionMode ? 10 : 0}
                      padding={{ top: 13, bottom: 12, leading: 18, trailing: 18 }}
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                      glassEffect={{ type: "rect", cornerRadius: 28 } as any}
                    >
                      {showStatusPanel ? fixedStatusPanel : null}
                      {showStatusPanel && selectionMode ? <Divider /> : null}
                      {fixedBatchPanel}
                    </VStack>
                  ) : null}
                </VStack>
              ) : <VStack />
            ),
          },
          bottom: {
            alignment: "center",
            spacing: 0,
            content: (
              selectionMode ? <VStack /> : (
                <HStack
                  spacing={10}
                  padding={{ top: 8, bottom: 12, leading: 16, trailing: 16 }}
                  frame={{ maxWidth: "infinity" }}
                >
                  <BottomActionButton
                    title="添加模块"
                    systemImage="plus"
                    tint="systemBlue"
                    disabled={busy}
                    onPress={addModule}
                  />
                  <BottomActionButton
                    title="更新全部"
                    systemImage="arrow.triangle.2.circlepath"
                    tint="systemGreen"
                    disabled={busy || onlyLocalFiltered}
                    onPress={downloadAll}
                  />
                </HStack>
              )
            ),
          },
        }}
      >
        <Section>
          <VStack
            spacing={12}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
            listRowBackground={<EmptyView />}
            listRowSeparator="hidden"
          >
            <ModuleSummaryCard
              total={modules.length}
              visible={filteredModules.length}
              enabled={enabledRemoteCount}
              remoteReady={remoteControlReady}
            />
            <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
              {chipOptions.map((item, idx) => (
                <CategoryChip
                  key={`${item}-${idx}`}
                  title={item}
                  selected={filterCategory === item}
                  onPress={() => setFilterCategory(item)}
                />
              ))}
              {filterOptions.length > chipOptions.length ? (
                <FilterMenu
                  value={categoryMenuLabel}
                  options={filterOptions}
                  onSelect={(value) => setFilterCategory(value)}
                />
              ) : null}
            </HStack>
          </VStack>
        </Section>
        <Section
          header={(
            <HStack frame={{ maxWidth: "infinity" }}>
              <Text lineLimit={1} truncationMode="tail" layoutPriority={1}>
                {filteredModules.length > 0
                  ? `模块列表 (${filteredModules.length})`
                  : "模块列表"}
              </Text>
              <Spacer />
              {dirOptions.length > 1 ? (
                <FilterMenu
                  value={filterDir}
                  options={dirOptions}
                  onSelect={(value) => setFilterDir(value)}
                />
              ) : null}
            </HStack>
          )}
        >
          {filteredModules.length === 0 ? (
            <Text>{searchText.trim() ? "暂无匹配模块" : "暂无模块"}</Text>
          ) : (
            filteredModules.map((m) => (
              (() => {
                const remoteName = getModuleRemoteName(m)
                return (
                  <VStack
                    key={`${m.name}-${m.link}`}
                    contextMenu={selectionMode ? undefined : {
                      menuItems: (
                        <Group>
                          {m.link ? (
                            <Button title="预览更新" action={withButtonHaptic(() => previewModuleFor(m))} />
                          ) : null}
                          <Button title="本地化脚本与规则集" action={withButtonHaptic(() => localizeResourcesFor(m))} />
                          <Button title="查看模块" action={withButtonHaptic(() => viewModuleContent(m))} />
                          <Button title="回滚版本" action={withButtonHaptic(() => restoreModuleFor(m))} />
                          <Button title="复制链接" action={withButtonHaptic(() => copyModuleLink(m))} />
                          <Button title="删除" role="destructive" action={withButtonHaptic(() => deleteModuleFor(m))} />
                        </Group>
                      ),
                    }}
                    leadingSwipeActions={{
                      allowsFullSwipe: false,
                      actions: selectionMode ? [] : [
                        <Button
                          title="更新"
                          tint={m.link ? "systemGreen" : "systemGray"}
                          disabled={!m.link}
                          action={withButtonHaptic(() => downloadSingle(m))}
                        />,
                      ],
                    }}
                    trailingSwipeActions={{
                      allowsFullSwipe: false,
                      actions: selectionMode ? [] : [
                        <Button title="编辑" tint="systemOrange" action={withButtonHaptic(() => modifyModuleFor(m))} />,
                      ],
                    }}
                  >
                    <HStack spacing={10}>
                      {selectionMode ? (
                        <Button
                          title=""
                          systemImage={selectedKeys.has(moduleKey(m)) ? "checkmark.circle.fill" : "circle"}
                          action={withButtonHaptic(() => toggleSelection(m))}
                        />
                      ) : null}
                      <ModuleIcon module={m} />
                      <VStack alignment="leading" spacing={3}>
                        <Text font="headline">{m.name}</Text>
                        <Text font="caption" foregroundStyle="secondaryLabel">
                          {m.category ? `${m.category} · ` : ""}{m.link ? "远程模块" : "本地模块"}{m.localResources ? " · 资源已本地化" : ""}
                        </Text>
                      </VStack>
                      <Spacer />
                      {!selectionMode ? (
                        <Toggle
                          title=""
                          value={enabledModuleNames.has(remoteName)}
                          disabled={!remoteControlReady || togglingModuleNames.has(remoteName)}
                          toggleStyle="switch"
                          onChanged={(value: boolean) => {
                            void toggleRemoteModule(m, value)
                          }}
                        />
                      ) : null}
                    </HStack>
                  </VStack>
                )
              })()
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
