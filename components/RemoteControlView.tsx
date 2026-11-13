import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  SecureField,
  Text,
  TextField,
  VStack,
  useState,
} from "scripting"

import { loadConfig, saveConfig, type AppConfig } from "../utils/config"
import { testRemoteConnection } from "../utils/remote_control"
import { SurgeToolsView } from "./SurgeToolsView"

export function RemoteControlView(props: {
  initial?: AppConfig
  onDone?: (cfg: AppConfig) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [cfg, setCfg] = useState<AppConfig>(props.initial ?? loadConfig())
  const [testing, setTesting] = useState(false)

  async function testConnection() {
    if (testing) return
    setTesting(true)
    try {
      const result = await testRemoteConnection({
        ...cfg,
        remoteHost: String(cfg.remoteHost ?? "").trim() || "http://127.0.0.1",
        remotePort: String(cfg.remotePort ?? "").trim(),
        remotePassword: String(cfg.remotePassword ?? ""),
        remoteAuthMode: cfg.remoteAuthMode === "bearer" ? "bearer" : "x-key",
      })
      await Dialog.alert({
        title: "连接成功",
        message: `响应 ${result.latencyMs} ms\n当前已启用模块 ${result.enabledCount} 个`,
      })
    } catch (e: any) {
      await Dialog.alert({
        title: "连接失败",
        message: String(e?.message ?? e),
      })
    } finally {
      setTesting(false)
    }
  }

  async function saveAndClose() {
    try {
      const fixed: AppConfig = {
        ...cfg,
        remoteHost: String(cfg.remoteHost ?? "").trim() || "http://127.0.0.1",
        remotePort: String(cfg.remotePort ?? "").trim(),
        remotePassword: String(cfg.remotePassword ?? ""),
        remoteAuthMode: cfg.remoteAuthMode === "bearer" ? "bearer" : "x-key",
      }
      saveConfig(fixed)
      props.onDone?.(fixed)
      dismiss()
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"HTTP 远程控制"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarTrailing: (
            <Button
              title="保存"
              action={() => {
                HapticFeedback.mediumImpact()
                void saveAndClose()
              }}
            />
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>连接信息</Text>}>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text lineLimit={1} frame={{ width: 64, alignment: "leading" as any }}>
                地址：
              </Text>
              <TextField
                title=""
                value={cfg.remoteHost}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remoteHost: v }))}
                prompt="http://127.0.0.1"
                keyboardType="URL"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text lineLimit={1} frame={{ width: 64, alignment: "leading" as any }}>
                端口：
              </Text>
              <TextField
                title=""
                value={cfg.remotePort}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remotePort: v }))}
                prompt="6171"
                keyboardType="numberPad"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text lineLimit={1} frame={{ width: 64, alignment: "leading" as any }}>
                密码：
              </Text>
              <SecureField
                title=""
                value={cfg.remotePassword}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remotePassword: v }))}
                prompt="Surge HTTP API 密钥"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
            <Picker
              title="认证方式"
              pickerStyle="menu"
              value={cfg.remoteAuthMode === "bearer" ? 1 : 0}
              onChanged={(index: number) => setCfg((c) => ({ ...c, remoteAuthMode: index === 1 ? "bearer" : "x-key" }))}
            >
              <Text tag={0}>X-Key（默认）</Text>
              <Text tag={1}>Bearer</Text>
            </Picker>
            <Button
              title={testing ? "测试连接中…" : "测试连接"}
              systemImage="antenna.radiowaves.left.and.right"
              disabled={testing}
              action={() => {
                HapticFeedback.mediumImpact()
                void testConnection()
              }}
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              使用 Surge HTTP API 的模块状态接口进行测试，不会修改模块开关。默认使用 X-Key；Bearer 适用于只方便发送 Authorization 的环境。
            </Text>
            <Button
              title="Surge 高级控制"
              systemImage="slider.horizontal.3"
              action={() => {
                HapticFeedback.mediumImpact()
                void Navigation.present({ element: <SurgeToolsView initial={cfg} /> })
              }}
            />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
