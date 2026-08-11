import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  useState,
  VStack,
} from "scripting"

// 全局函数声明（运行时可用，类型定义中可能未包含）
declare function confirm(message: string): Promise<boolean>
declare function alert(message: string): Promise<void>
import {
  type CookieConfigSummary,
  type CookieSource,
  cleanupTempCookieFiles,
  clearAllPersistentCookies,
  deleteAllCookieConfigs,
  deleteCookieConfig,
  extractRootDomain,
  filterCookiesByDomain,
  getCookieConfig,
  getDecryptedCookies,
  inferDomainFromUrl,
  listCookieConfigs,
  saveCookieConfig,
  validateCookiesTxt,
  webkitCookiesToNetscape,
} from "../lib/cookie"

// ─── Cookie 管理主页面 ───────────────────────────────────────

export function CookieManagerView(props: {
  currentConfigId: string | null
  onSelectConfig: (id: string | null, name: string | null) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [configs, setConfigs] = useState<CookieConfigSummary[]>(listCookieConfigs())
  const [refreshKey, setRefreshKey] = useState(0)

  function refresh() {
    setConfigs(listCookieConfigs())
    setRefreshKey(k => k + 1)
  }

  async function openWebViewLogin() {
    await Navigation.present({
      element: <WebViewLoginView onSaved={() => refresh()} />,
    })
    refresh()
  }

  async function openImportView() {
    await Navigation.present({
      element: <CookieImportView onSaved={() => refresh()} />,
    })
    refresh()
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm(`确定要删除 Cookie 配置"${name}"吗？此操作不可撤销。`)
    if (!confirmed) return
    deleteCookieConfig(id)
    if (props.currentConfigId === id) {
      props.onSelectConfig(null, null)
    }
    refresh()
  }

  async function handleDeleteAll() {
  if (configs.length === 0) return
    const confirmed = await confirm(`确定要删除全部 ${configs.length} 个 Cookie 配置吗？此操作不可撤销。`)
    if (!confirmed) return
    deleteAllCookieConfigs()
    props.onSelectConfig(null, null)
    refresh()
  }

  async function handleClearWebViewCookies() {
    const confirmed = await confirm(
      "此操作将清除 Scripting 内置 WebView 共享 Cookie 仓中的所有 Cookie（影响所有使用 WebView 的脚本）。确定继续吗？",
    )
    if (!confirmed) return
    try {
      await clearAllPersistentCookies()
      await alert("已清除 WebView 共享 Cookie 仓。")
    } catch (error: any) {
      await alert(`清除失败：${error?.message ?? String(error)}`)
    }
  }

  function handleSelect(id: string, name: string) {
    if (props.currentConfigId === id) {
      props.onSelectConfig(null, null)
    } else {
      props.onSelectConfig(id, name)
    }
  }

  return (
    <NavigationStack>
      <List
        key={refreshKey}
        navigationTitle="Cookie 管理"
        navigationBarTitleDisplayMode="large"
      >
        <Section
          header={<Text>当前使用</Text>}
          footer={<Text>选中的 Cookie 将在快捷和高级下载中自动使用。点击列表项可切换选中状态。</Text>}
        >
          {props.currentConfigId ? (
            (() => {
              const current = configs.find(c => c.id === props.currentConfigId)
              return current ? (
                <HStack>
                  <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" />
                  <VStack alignment="leading" spacing={2}>
                    <Text font="body">{current.name}</Text>
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {current.domains.length > 1
                        ? `${current.domains[0]} +${current.domains.length - 1} 个域名`
                        : current.domain}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Button
                    title="取消使用"
                    action={() => handleSelect(current.id, current.name)}
                  />
                </HStack>
              ) : (
                <Text foregroundStyle="secondaryLabel">未使用 Cookie</Text>
              )
            })()
          ) : (
            <Text foregroundStyle="secondaryLabel">未使用 Cookie</Text>
          )}
        </Section>

        <Section
          header={<Text>已保存的 Cookie</Text>}
          footer={<Text>共 {configs.length} 个配置。Cookie 内容已加密存储，仅在下载时解密使用。</Text>}
        >
          {configs.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">暂无保存的 Cookie 配置。</Text>
          ) : (
            configs.map(config => (
              <HStack key={config.id}>
                <VStack alignment="leading" spacing={3}>
                  <HStack>
                    <Text font="body">{config.name}</Text>
                    {props.currentConfigId === config.id && (
                      <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" />
                    )}
                  </HStack>
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {config.domains.length > 1
                      ? `${config.domains[0]} +${config.domains.length - 1} 个域名`
                      : config.domain} · {config.cookieCount} 个 Cookie · {formatDate(config.createdAt)}
                  </Text>
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    {config.source === "webView" ? "WebView 登录" : "手动导入"}
                    {config.lastUsedAt ? ` · 上次使用 ${formatDate(config.lastUsedAt)}` : " · 尚未使用"}
                  </Text>
                </VStack>
                <Spacer />
                <VStack alignment="trailing" spacing={6}>
                  <Button
                    title={props.currentConfigId === config.id ? "已选中" : "使用"}
                    action={() => handleSelect(config.id, config.name)}
                  />
                  <Button
                    title="删除"
                    systemImage="trash"
                    foregroundStyle="systemRed"
                    action={() => void handleDelete(config.id, config.name)}
                  />
                </VStack>
              </HStack>
            ))
          )}
        </Section>

        <Section header={<Text>添加 Cookie</Text>}>
          <Button
            title="WebView 登录获取"
            systemImage="globe"
            action={() => void openWebViewLogin()}
          />
          <Button
            title="导入 cookies.txt"
            systemImage="doc.text"
            action={() => void openImportView()}
          />
        </Section>

        <Section
          header={<Text>危险操作</Text>}
          footer={<Text>清除 WebView Cookie 仓会影响所有使用 Scripting 内置浏览器的脚本，请谨慎操作。</Text>}
        >
          <Button
            title="删除全部 Cookie 配置"
            systemImage="trash.fill"
            foregroundStyle="systemRed"
            action={() => void handleDeleteAll()}
          />
          <Button
            title="清除 WebView 共享 Cookie"
            systemImage="globe.badge.chevron.backward"
            foregroundStyle="systemRed"
            action={() => void handleClearWebViewCookies()}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── WebView 登录页面 ────────────────────────────────────────

function WebViewLoginView(props: { onSaved: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [loginUrl, setLoginUrl] = useState("https://www.youtube.com")
  const [ephemeral, setEphemeral] = useState(true)
  const [loggingIn, setLoggingIn] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  async function handleLogin() {
    const url = loginUrl.trim()
    if (!url) {
      setStatusMessage("请输入登录页面 URL。")
      return
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      setStatusMessage("URL 必须以 http:// 或 https:// 开头。")
      return
    }

    if (!ephemeral) {
      const confirmed = await confirm(
        "持久模式将使用 Scripting WebView 的共享 Cookie 仓，其他使用 WebView 的脚本可能读取到这些 Cookie。\n\n确定要使用持久模式吗？",
      )
      if (!confirmed) return
    }

    setLoggingIn(true)
    setStatusMessage("正在打开登录页面…")

    try {
      const controller = new WebViewController({ ephemeral })
      await controller.loadURL(url)
      setStatusMessage("请在打开的网页中完成登录，登录后点击左上角返回。")
      await controller.present({
        fullscreen: false,
        navigationTitle: "登录后请返回",
      })

      setStatusMessage("正在读取 Cookie…")
      const rawCookies = await controller.getAllCookies()
      controller.dispose()

      if (rawCookies.length === 0) {
        setStatusMessage("未获取到 Cookie。请确认已成功登录后重试。")
        setLoggingIn(false)
        return
      }

      // 持久模式下过滤无关域名：共享 WebView 仓中可能有其他网站的 Cookie，
      // 只保留与登录页面同根域的 Cookie。
      // 隔离模式下保留全部 Cookie（均为本次会话产生，包括 CDN 等关联域名）。
      const loginHost = inferDomainFromUrl(url)
      const rootDomain = extractRootDomain(loginHost)
      const cookies = ephemeral
        ? rawCookies
        : filterCookiesByDomain(rawCookies, rootDomain)

      if (cookies.length === 0) {
        setStatusMessage(`持久模式下未找到与 ${rootDomain} 相关的 Cookie。请尝试使用隔离模式。`)
        setLoggingIn(false)
        return
      }

      const cookiesTxt = webkitCookiesToNetscape(cookies)
      const validation = validateCookiesTxt(cookiesTxt)
      if (!validation.valid || validation.cookieCount === 0) {
        setStatusMessage(`Cookie 格式转换失败：${validation.error ?? "没有有效条目"}`)
        setLoggingIn(false)
        return
      }

      const domain = loginHost
      saveCookieConfig({
        name: domain,
        source: "webView",
        cookiesText: cookiesTxt,
        domain,
        domains: validation.domains,
      })
      setStatusMessage(null)
      setLoggingIn(false)
      props.onSaved()
      const domainSummary = validation.domains.length > 1
        ? `${domain} 等 ${validation.domains.length} 个域名`
        : domain
      await alert(`已保存 ${validation.cookieCount} 个 Cookie（覆盖 ${domainSummary}）。`)
      dismiss()
    } catch (error: any) {
      setStatusMessage(`登录获取失败：${error?.message ?? String(error)}`)
      setLoggingIn(false)
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="WebView 登录"
        navigationBarTitleDisplayMode="large"
      >
        <Section
          header={<Text>登录页面</Text>}
          footer={<Text>选择或输入需要登录的网站地址，点击开始后会在内置浏览器中打开。完成登录后返回即可自动捕获 Cookie。</Text>}
        >
          <TextField
            title="登录 URL"
            prompt="https://www.example.com"
            value={loginUrl}
            onChanged={setLoginUrl}
          />
        </Section>

        <Section
          header={<Text>Cookie 隔离</Text>}
          footer={
            ephemeral
              ? <Text>隔离模式（推荐）：Cookie 在独立沙箱中获取，自动捕获登录过程中所有相关域名（含 CDN 等），关闭后自动丢弃。</Text>
              : <Text foregroundStyle="systemOrange">持久模式：Cookie 存储在共享仓中，其他使用 WebView 的脚本可能读取到这些 Cookie。仅保留与登录页面同根域的 Cookie。</Text>
          }
        >
          <Toggle
            title="隔离模式（推荐）"
            value={ephemeral}
            onChanged={setEphemeral}
          />
          {!ephemeral && (
            <Text font="footnote" foregroundStyle="systemRed">
              ⚠️ 持久模式的 Cookie 可能被其他 Scripting 脚本读取。仅在你了解风险时使用。
            </Text>
          )}
        </Section>

        {!!statusMessage && (
          <Section>
            <Text font="footnote" foregroundStyle={statusMessage.startsWith("登录获取失败") || statusMessage.startsWith("未获取") ? "systemRed" : "secondaryLabel"}>
              {statusMessage}
            </Text>
          </Section>
        )}

        <Section>
          <Button
            title={loggingIn ? "处理中…" : "开始登录"}
            systemImage="globe"
            action={() => void handleLogin()}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── cookies.txt 导入页面 ────────────────────────────────────

function CookieImportView(props: { onSaved: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [cookieText, setCookieText] = useState("")
  const [cookieName, setCookieName] = useState("")
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [cookieCount, setCookieCount] = useState(0)
  const [domains, setDomains] = useState<string[]>([])

  function handleTextChanged(value: string) {
    setCookieText(value)
    if (!value.trim()) {
      setValidationMessage(null)
      setCookieCount(0)
      setDomains([])
      return
    }
    const result = validateCookiesTxt(value)
    if (result.valid) {
      setValidationMessage(`✓ 格式有效，识别到 ${result.cookieCount} 个 Cookie，域名：${result.domains.join(", ")}`)
      setCookieCount(result.cookieCount)
      setDomains(result.domains)
      if (!cookieName.trim() && result.domains[0]) {
        setCookieName(result.domains[0])
      }
    } else {
      setValidationMessage(`✗ ${result.error}`)
      setCookieCount(0)
      setDomains([])
    }
  }

  async function handlePaste() {
    try {
      const text = await Pasteboard.getString()
      if (text) handleTextChanged(text)
      else setValidationMessage("剪贴板中没有文本。")
    } catch (error: any) {
      setValidationMessage(`无法读取剪贴板：${error?.message ?? String(error)}`)
    }
  }

  async function handleSave() {
    if (cookieCount === 0) {
      setValidationMessage("请先粘贴有效的 cookies.txt 内容。")
      return
    }
    try {
      saveCookieConfig({
        name: cookieName.trim() || domains[0] || "导入的 Cookie",
        source: "import",
        cookiesText: cookieText,
        domain: domains[0],
      })
      props.onSaved()
      await alert(`已保存 ${cookieCount} 个 Cookie。`)
      dismiss()
    } catch (error: any) {
      setValidationMessage(`保存失败：${error?.message ?? String(error)}`)
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="导入 Cookie"
        navigationBarTitleDisplayMode="large"
      >
        <Section
          header={<Text>cookies.txt 内容</Text>}
          footer={<Text>Netscape cookies.txt 格式，每行 7 个 tab 分隔字段：domain, include_subdomains, path, secure, expiration, name, value。以 # 开头的行会被忽略。</Text>}
        >
          <TextField
            title="粘贴 cookies.txt 文本"
            prompt={"# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t1234567890\tsession\tabc123"}
            axis="vertical"
            lineLimit={{ min: 5, max: 15, reservesSpace: true }}
            value={cookieText}
            onChanged={handleTextChanged}
          />
          <Button
            title="从剪贴板获取"
            systemImage="doc.on.clipboard"
            action={() => void handlePaste()}
          />
        </Section>

        {!!validationMessage && (
          <Section>
            <Text
              font="footnote"
              foregroundStyle={validationMessage.startsWith("✓") ? "systemGreen" : "systemRed"}
            >
              {validationMessage}
            </Text>
          </Section>
        )}

        {cookieCount > 0 && (
          <Section header={<Text>配置信息</Text>}>
            <TextField
              title="名称"
              prompt="例如 YouTube Cookie"
              value={cookieName}
              onChanged={setCookieName}
            />
            <HStack>
              <Text>识别域名</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">{domains.join(", ")}</Text>
            </HStack>
            <HStack>
              <Text>Cookie 数量</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">{cookieCount}</Text>
            </HStack>
          </Section>
        )}

        <Section>
          <Button
            title="保存 Cookie"
            systemImage="checkmark.circle.fill"
            action={() => void handleSave()}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── Cookie 明文查看 ─────────────────────────────────────────

export async function viewCookieContentWithAuth(id: string): Promise<void> {
  const config = getCookieConfig(id)
  if (!config) {
    await alert("Cookie 配置不存在。")
    return
  }

  const confirmed = await confirm(
    `即将显示"${config.name}"的明文 Cookie 内容。\n\n⚠️ Cookie 包含登录凭证，请勿在他人面前展示或截屏分享。确定要继续吗？`,
  )
  if (!confirmed) return

  if (LocalAuth.isAvailable) {
    const authed = await LocalAuth.authenticate("验证身份以查看 Cookie 明文内容", true)
    if (!authed) {
      await alert("身份验证失败，无法查看 Cookie 内容。")
      return
    }
  }

  try {
    const cookiesText = getDecryptedCookies(id)
    if (!cookiesText) {
      await alert("解密 Cookie 失败。")
      return
    }
    await Navigation.present({
      element: <CookieContentView name={config.name} content={cookiesText} />,
    })
  } catch (error: any) {
    await alert(`读取 Cookie 失败：${error?.message ?? String(error)}`)
  }
}

function CookieContentView(props: { name: string; content: string }) {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <List
        navigationTitle="Cookie 明文内容"
        navigationBarTitleDisplayMode="inline"
      >
        <Section
          header={<Text>{props.name}</Text>}
          footer={<Text foregroundStyle="systemRed">⚠️ 以下内容包含登录凭证，请妥善保护。</Text>}
        >
          <Text font="caption" foregroundStyle="label">
            {props.content}
          </Text>
        </Section>
        <Section>
          <Button title="关闭" action={() => dismiss()} />
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── 辅助函数 ────────────────────────────────────────────────

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  } catch {
    return isoString
  }
}
