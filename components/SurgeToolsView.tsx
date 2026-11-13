import {
  Button,
  ForEach,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting"

import type { AppConfig } from "../utils/config"
import {
  fetchAvoidedPolicies,
  fetchCaptureEnabled,
  fetchCaptureFilters,
  fetchCaptureSessions,
  fetchSurgePolicies,
  setCaptureEnabled,
  setCaptureFilter,
  setPolicyAvoided,
  type CaptureFilter,
  type CaptureFilterScope,
  type CaptureFilterType,
  type CaptureSession,
} from "../utils/remote_control"

const FILTER_TYPES: CaptureFilterType[] = ["off", "with-keywords", "without-keywords", "pattern"]

function splitKeywords(value: string): string[] {
  return Array.from(new Set(
    String(value ?? "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 128),
  ))
}

function joinKeywords(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).join(", ") : ""
}

function formatSession(session: CaptureSession): string {
  const count = Number.isFinite(Number(session.requestCount)) ? ` · ${session.requestCount} 请求` : ""
  const state = session.active ? "进行中" : session.endReason ? `已结束 · ${session.endReason}` : "已保存"
  return `${session.name} · ${state}${count}`
}

export function SurgeToolsView(props: { initial: AppConfig }) {
  const dismiss = Navigation.useDismiss()
  const [cfg] = useState<AppConfig>(props.initial)
  const [policies, setPolicies] = useState<string[]>([])
  const [avoided, setAvoided] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<CaptureFilterScope>("in-memory")
  const [filters, setFilters] = useState<Partial<Record<CaptureFilterScope, CaptureFilter>>>({})
  const [filter, setFilter] = useState<CaptureFilter>({
    type: "off",
    keywords: [],
    disabledKeywords: [],
    httpOnly: false,
    hideCrashReporterRequests: true,
    hideAppleRequests: false,
    hideUDP: false,
  })
  const [captureEnabled, setCaptureEnabledState] = useState(false)
  const [sessions, setSessions] = useState<CaptureSession[]>([])
  const [keywordsText, setKeywordsText] = useState("")
  const [status, setStatus] = useState("正在读取 Surge 能力…")
  const [busy, setBusy] = useState(false)

  async function refresh() {
    if (busy) return
    setBusy(true)
    try {
      const policyResult = await fetchSurgePolicies(cfg)
      const [avoidedResult, filtersResult, captureResult, sessionResult] = await Promise.all([
        fetchAvoidedPolicies(cfg).catch(() => null),
        fetchCaptureFilters(cfg).catch(() => null),
        fetchCaptureEnabled(cfg).catch(() => null),
        fetchCaptureSessions(cfg).catch(() => null),
      ])
      setPolicies(Array.from(new Set((policyResult.proxies ?? []).map((item) => String(item).trim()).filter(Boolean))))
      if (avoidedResult) setAvoided(avoidedResult)
      if (captureResult !== null) setCaptureEnabledState(captureResult)
      if (sessionResult) setSessions(sessionResult)
      if (filtersResult) setFilters(filtersResult.filters ?? {})
      const nextFilter = filtersResult?.filters?.[scope]
      if (nextFilter) {
        setFilter(nextFilter)
        setKeywordsText(joinKeywords(nextFilter.keywords))
      }
      const unsupported = [
        avoidedResult ? "" : "策略避让",
        filtersResult ? "" : "抓包筛选",
        captureResult === null ? "抓包开关" : "",
        sessionResult ? "" : "抓包会话",
      ].filter(Boolean)
      setStatus(`已连接 · 策略 ${policyResult.proxies?.length ?? 0} 个 · 保存的抓包会话 ${sessionResult?.length ?? 0} 个${unsupported.length ? ` · 当前 Surge 不支持或未开放：${unsupported.join("、")}` : ""}`)
    } catch (e: any) {
      setStatus(`读取失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function togglePolicy(name: string, value: boolean) {
    if (busy) return
    setBusy(true)
    try {
      setAvoided(await setPolicyAvoided(cfg, name, value))
      setStatus(value ? `已避让：${name}` : `已取消避让：${name}`)
    } catch (e: any) {
      setStatus(`策略避让失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function saveFilter() {
    if (busy) return
    setBusy(true)
    try {
      const next: CaptureFilter = {
        ...filter,
        keywords: splitKeywords(keywordsText),
      }
      const applied = await setCaptureFilter(cfg, scope, next)
      setFilter(applied)
      setFilters((current) => ({ ...current, [scope]: applied }))
      setKeywordsText(joinKeywords(applied.keywords))
      setStatus(`${scope === "in-memory" ? "内存" : "磁盘"}抓包筛选已保存`)
    } catch (e: any) {
      setStatus(`筛选保存失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleCapture(value: boolean) {
    if (busy) return
    setBusy(true)
    try {
      const applied = await setCaptureEnabled(cfg, value)
      setCaptureEnabledState(applied)
      setStatus(applied ? "HTTP 抓包已开启" : "HTTP 抓包已停止")
      if (!applied) setSessions(await fetchCaptureSessions(cfg))
    } catch (e: any) {
      setStatus(`抓包开关失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  function changeScope(nextScope: CaptureFilterScope) {
    setScope(nextScope)
    const nextFilter = filters[nextScope]
    if (nextFilter) {
      setFilter(nextFilter)
      setKeywordsText(joinKeywords(nextFilter.keywords))
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle="Surge 高级控制"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <Button title="关闭" action={dismiss} />,
          topBarTrailing: <Button title="刷新" disabled={busy} action={() => void refresh()} />,
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>运行状态</Text>}>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={4}>{status}</Text>
            <Toggle
              title="HTTP 抓包"
              value={captureEnabled}
              disabled={busy}
              onChanged={(value: boolean) => void toggleCapture(value)}
            />
            <Text font="caption" foregroundStyle="systemOrange" lineLimit={4}>
              开启或停止抓包会关闭现有连接；只在排查请求时使用，完成后及时关闭。
            </Text>
          </Section>

          <Section
            header={<Text>策略避让</Text>}
            footer={<Text font="caption" foregroundStyle="secondaryLabel">仅影响 url-test、fallback、load-balance、smart 自动策略组；不会改变手动选择、规则直连或永久配置。Surge 重启后会清空避让标记。</Text>}
          >
            {policies.length ? (
              <ForEach
                count={policies.length}
                itemBuilder={(index) => {
                  const name = policies[index]
                  return (
                    <Toggle
                      key={name}
                      title={name}
                      value={avoided.has(name)}
                      disabled={busy}
                      onChanged={(value: boolean) => void togglePolicy(name, value)}
                    />
                  )
                }}
              />
            ) : (
              <Text foregroundStyle="secondaryLabel">没有读取到可避让的代理策略</Text>
            )}
          </Section>

          <Section
            header={<Text>抓包筛选参数</Text>}
            footer={<Text font="caption" foregroundStyle="secondaryLabel">筛选参数对应 Surge HTTP API 的 `/v1/capture/filters`。关键词支持逗号或换行分隔；pattern 支持 *、?，以 - 开头可排除匹配。</Text>}
          >
            <Picker
              title="筛选范围"
              pickerStyle="segmented"
              value={scope === "in-memory" ? 0 : 1}
              onChanged={(index: number) => changeScope(index === 1 ? "on-disk" : "in-memory")}
            >
              <Text tag={0}>内存请求</Text>
              <Text tag={1}>磁盘会话</Text>
            </Picker>
            <Picker
              title="匹配类型"
              pickerStyle="menu"
              value={Math.max(0, FILTER_TYPES.indexOf(filter.type ?? "off"))}
              onChanged={(index: number) => setFilter((current) => ({ ...current, type: FILTER_TYPES[index] ?? "off" }))}
            >
              {FILTER_TYPES.map((item, index) => <Text key={item} tag={index}>{item}</Text>)}
            </Picker>
            <TextField
              label={<Text>关键词</Text>}
              value={keywordsText}
              onChanged={setKeywordsText}
              prompt="example.com, api.example.net"
              axis="vertical"
              lineLimit={{ min: 2, max: 5 }}
            />
            <Toggle title="仅记录 HTTP" value={!!filter.httpOnly} onChanged={(value: boolean) => setFilter((current) => ({ ...current, httpOnly: value }))} />
            <Toggle title="隐藏崩溃报告请求" value={filter.hideCrashReporterRequests !== false} onChanged={(value: boolean) => setFilter((current) => ({ ...current, hideCrashReporterRequests: value }))} />
            <Toggle title="隐藏 Apple 请求" value={!!filter.hideAppleRequests} onChanged={(value: boolean) => setFilter((current) => ({ ...current, hideAppleRequests: value }))} />
            <Toggle title="隐藏 UDP 请求" value={!!filter.hideUDP} onChanged={(value: boolean) => setFilter((current) => ({ ...current, hideUDP: value }))} />
            <Button title={busy ? "保存中…" : "保存抓包筛选"} systemImage="checkmark" disabled={busy} action={() => void saveFilter()} />
          </Section>

          <Section header={<Text>已保存的 HTTP 抓包会话</Text>}>
            {sessions.length ? sessions.slice(0, 12).map((session) => (
              <HStack key={session.name}>
                <Text lineLimit={2}>{formatSession(session)}</Text>
              </HStack>
            )) : <Text foregroundStyle="secondaryLabel">暂无保存会话</Text>}
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
