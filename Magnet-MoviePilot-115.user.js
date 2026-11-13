// ==UserScript==
// @name         通用磁力 → MoviePilot 115 离线
// @namespace    https://github.com/ranzhigg/scripting-scripts
// @version      0.1.0
// @description  在任意资源页识别 BT 磁力，一键提交到 MoviePilot 的 115 离线目录。
// @author       ranzhi
// @match        http://*/*
// @match        https://*/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.addStyle
// @grant        GM.registerMenuCommand
// @grant        GM.xmlHttpRequest
// @grant        GM.notification
// @grant        GM.setClipboard
// @connect      *
// @run-at       document-end
// @inject-into  content
// ==/UserScript==

(async () => {
  'use strict'

  const STORE = {
    mpUrl: 'generic_magnet_mp_url',
    apiKey: 'generic_magnet_mp_api_key',
    offlinePath: 'generic_magnet_mp_offline_path',
  }
  // 公开脚本不写入任何人的私人目录；留空时由 P115StrmHelper 使用自身默认目录。
  const DEFAULT_OFFLINE_PATH = ''
  const MP_PLUGIN_ID = 'P115StrmHelper'
  const MAGNET_PREFIX = 'magnet:?xt=urn:btih:'

  const state = {
    config: { mpUrl: '', apiKey: '', offlinePath: DEFAULT_OFFLINE_PATH },
    magnets: [],
    pushState: new Map(),
    panel: null,
    list: null,
    fab: null,
    scanTimer: null,
    observer: null,
  }

  const $ = (selector, root = document) => root.querySelector(selector)

  function cleanMagnet(value) {
    let text = String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .trim()
    if (!text) return ''
    try {
      if (/^magnet%3A%3F/i.test(text)) text = decodeURIComponent(text)
    } catch (_) {}
    const match = text.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/i)
    if (!match) return ''
    return match[0].replace(/[)\]}>,.;，。；！？]+$/g, '')
  }

  function shortText(value, limit = 120) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
  }

  function sourceLabel(node) {
    if (!node) return shortText(document.title || location.hostname, 90)
    const container = node.closest('tr, li, article, section, p, dd, .card, .item, .resource, .torrent')
    return shortText(container?.innerText || node.textContent || document.title || location.hostname, 90)
  }

  function addMagnet(value, node = null, label = '') {
    const magnet = cleanMagnet(value)
    if (!magnet || !magnet.toLowerCase().startsWith(MAGNET_PREFIX.toLowerCase())) return
    if (state.magnets.some(item => item.magnet === magnet)) return
    state.magnets.push({ magnet, label: label || sourceLabel(node) })
  }

  function scanMagnets() {
    const previous = state.magnets
    state.magnets = []

    document.querySelectorAll('a[href], [data-magnet], [data-url], [data-link]').forEach(node => {
      const candidates = [
        node.getAttribute('href'),
        node.getAttribute('data-magnet'),
        node.getAttribute('data-url'),
        node.getAttribute('data-link'),
        node.textContent,
      ]
      candidates.forEach(value => addMagnet(value, node))
    })

    const bodyText = document.body?.innerText || ''
    const bodyMatches = bodyText.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/gi) || []
    bodyMatches.forEach(value => addMagnet(value, null, document.title || location.hostname))

    if (!state.magnets.length) {
      state.magnets = previous.filter(item => document.body?.innerText?.includes(item.magnet))
    }

    state.magnets.sort((left, right) => left.magnet.localeCompare(right.magnet))
    updateFab()
    renderList()
  }

  function scheduleScan() {
    clearTimeout(state.scanTimer)
    state.scanTimer = setTimeout(scanMagnets, 350)
  }

  function notify(title, text) {
    try {
      GM.notification({ title, text })
    } catch (_) {}
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      let settled = false
      const done = callback => value => {
        if (settled) return
        settled = true
        callback(value)
      }
      try {
        GM.xmlHttpRequest({
          ...options,
          onload: done(resolve),
          onerror: done(reject),
          ontimeout: done(reject),
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  function responseBody(response) {
    if (response?.response && typeof response.response === 'object') return response.response
    try {
      return JSON.parse(response?.responseText || '{}')
    } catch (_) {
      return {}
    }
  }

  function responseMessage(body, fallback = 'MoviePilot 请求失败') {
    return String(body?.msg || body?.message || body?.detail || fallback)
  }

  async function requestMoviePilot(path, options = {}) {
    const { mpUrl, apiKey } = state.config
    if (!mpUrl || !apiKey) throw new Error('请先配置 MoviePilot 地址和 API Key')
    const response = await gmRequest({
      method: options.method || 'GET',
      url: `${mpUrl.replace(/\/+$/, '')}${path}`,
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      data: options.body ? JSON.stringify(options.body) : undefined,
      responseType: 'json',
      timeout: options.timeout || 30000,
    })
    const body = responseBody(response)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${response.status || '网络'}：${responseMessage(body)}`)
    }
    return body
  }

  async function verifyMoviePilot() {
    const body = await requestMoviePilot('/api/v1/user/current', { timeout: 10000 })
    const user = body?.data && typeof body.data === 'object' ? body.data : body
    return user?.username || user?.name || '连接成功'
  }

  async function pushMagnet(item) {
    const current = state.pushState.get(item.magnet) || 'idle'
    if (current === 'working') return
    if (!state.config.mpUrl || !state.config.apiKey) {
      await openSettings()
      if (!state.config.mpUrl || !state.config.apiKey) return
    }

    state.pushState.set(item.magnet, 'working')
    renderList()
    try {
      const body = await requestMoviePilot(`/api/v1/plugin/${MP_PLUGIN_ID}/add_offline_task`, {
        method: 'POST',
        body: {
          links: [item.magnet],
          path: state.config.offlinePath || null,
        },
        timeout: 60000,
      })
      const envelope = body?.data && typeof body.data === 'object' && body.data.code !== undefined
        ? body.data
        : body
      if (typeof envelope?.code === 'number' && envelope.code !== 0) {
        throw new Error(responseMessage(envelope, '115 离线转存失败'))
      }
      const duplicate = /已存在|重复|already/i.test(responseMessage(envelope, ''))
      state.pushState.set(item.magnet, duplicate ? 'duplicate' : 'success')
      const title = duplicate ? '115 任务已存在' : '115 离线提交成功'
      notify(title, `${shortText(item.label, 50)}\n目录：${state.config.offlinePath || 'P115StrmHelper 默认目录'}`)
    } catch (error) {
      state.pushState.set(item.magnet, 'error')
      notify('115 离线提交失败', error?.message || String(error))
    } finally {
      renderList()
    }
  }

  async function openSettings() {
    const current = state.config
    const url = window.prompt('MoviePilot 地址（例如 http://192.168.1.100:3000）', current.mpUrl)
    if (url === null) return
    const apiKey = window.prompt('MoviePilot API Key（留空保留当前值）', '')
    if (apiKey === null) return
    const path = window.prompt('115 离线目录（可留空，使用 P115StrmHelper 默认目录）', current.offlinePath || '')
    if (path === null) return

    state.config.mpUrl = url.trim().replace(/\/+$/, '')
    if (apiKey.trim()) state.config.apiKey = apiKey.trim()
    state.config.offlinePath = path.trim() || DEFAULT_OFFLINE_PATH
    await Promise.all([
      GM.setValue(STORE.mpUrl, state.config.mpUrl),
      GM.setValue(STORE.apiKey, state.config.apiKey),
      GM.setValue(STORE.offlinePath, state.config.offlinePath),
    ])
    try {
      const user = await verifyMoviePilot()
      notify('MoviePilot 配置已保存', `${user}\n115 目录：${state.config.offlinePath || 'P115StrmHelper 默认目录'}`)
    } catch (error) {
      notify('配置已保存，但连接测试失败', error?.message || String(error))
    }
    updateFab()
  }

  function addStyle() {
    GM.addStyle(`
      #mp115-magnet-fab { position: fixed; right: 16px; bottom: 22px; z-index: 2147483646; border: 0; border-radius: 999px; padding: 10px 14px; color: #fff; background: #5b5ce2; box-shadow: 0 6px 24px rgba(48, 51, 140, .32); font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; }
      #mp115-magnet-panel { position: fixed; right: 16px; bottom: 70px; z-index: 2147483647; display: none; width: min(420px, calc(100vw - 32px)); max-height: min(70vh, 620px); overflow: hidden; border: 1px solid rgba(120, 120, 180, .24); border-radius: 18px; color: #202033; background: rgba(255, 255, 255, .98); box-shadow: 0 18px 60px rgba(20, 20, 70, .24); font: 13px -apple-system, BlinkMacSystemFont, sans-serif; }
      #mp115-magnet-panel.open { display: flex; flex-direction: column; }
      #mp115-magnet-panel .mp115-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; border-bottom: 1px solid #ececf4; }
      #mp115-magnet-panel .mp115-title { flex: 1; font-size: 15px; font-weight: 700; }
      #mp115-magnet-panel button { border: 0; cursor: pointer; font: inherit; }
      #mp115-magnet-panel .mp115-icon { width: 28px; height: 28px; border-radius: 8px; color: #5556d5; background: #f0f0ff; }
      #mp115-magnet-panel .mp115-body { overflow: auto; padding: 10px; }
      #mp115-magnet-panel .mp115-empty { padding: 24px 12px; color: #707084; text-align: center; line-height: 1.6; }
      #mp115-magnet-panel .mp115-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 10px; margin-bottom: 8px; border-radius: 12px; background: #f7f7fb; }
      #mp115-magnet-panel .mp115-label { overflow: hidden; color: #4f4f64; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      #mp115-magnet-panel .mp115-magnet { overflow: hidden; margin-top: 4px; color: #8b8b9b; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
      #mp115-magnet-panel .mp115-actions { display: flex; gap: 5px; }
      #mp115-magnet-panel .mp115-push { padding: 7px 9px; border-radius: 9px; color: #fff; background: #5b5ce2; white-space: nowrap; }
      #mp115-magnet-panel .mp115-push.success { background: #2caa70; }
      #mp115-magnet-panel .mp115-push.duplicate { color: #946c00; background: #fff0bf; }
      #mp115-magnet-panel .mp115-push.error { color: #a62f3b; background: #ffe3e5; }
      #mp115-magnet-panel .mp115-copy { padding: 7px 8px; border-radius: 9px; color: #5a5a70; background: #e9e9f2; }
      #mp115-magnet-panel .mp115-foot { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #ececf4; }
      #mp115-magnet-panel .mp115-foot button { flex: 1; padding: 9px; border-radius: 10px; color: #5556d5; background: #f0f0ff; }
      @media (prefers-color-scheme: dark) {
        #mp115-magnet-panel { color: #f4f4fa; background: rgba(35, 35, 43, .98); }
        #mp115-magnet-panel .mp115-head, #mp115-magnet-panel .mp115-foot { border-color: #4a4a55; }
        #mp115-magnet-panel .mp115-row { background: #2c2c35; }
        #mp115-magnet-panel .mp115-label { color: #e5e5ef; }
        #mp115-magnet-panel .mp115-magnet { color: #9f9faf; }
        #mp115-magnet-panel .mp115-icon, #mp115-magnet-panel .mp115-foot button { color: #c9c9ff; background: #41415f; }
        #mp115-magnet-panel .mp115-copy { color: #dedeee; background: #4a4a55; }
      }
    `)
  }

  function updateFab() {
    if (!state.fab) return
    const count = state.magnets.length
    state.fab.textContent = count ? `MP 115 · ${count}` : 'MP 115'
    state.fab.title = state.config.mpUrl ? `检测到 ${count} 条磁力` : '先配置 MoviePilot'
    state.fab.style.display = count ? 'block' : 'none'
  }

  function renderList() {
    if (!state.list) return
    state.list.replaceChildren()
    if (!state.magnets.length) {
      const empty = document.createElement('div')
      empty.className = 'mp115-empty'
      empty.textContent = '当前页面没有检测到 BT 磁力链接。'
      state.list.appendChild(empty)
      return
    }
    state.magnets.forEach(item => {
      const row = document.createElement('div')
      row.className = 'mp115-row'
      const info = document.createElement('div')
      const label = document.createElement('div')
      label.className = 'mp115-label'
      label.textContent = item.label || document.title || location.hostname
      const magnet = document.createElement('div')
      magnet.className = 'mp115-magnet'
      magnet.textContent = item.magnet
      info.append(label, magnet)
      const actions = document.createElement('div')
      actions.className = 'mp115-actions'
      const status = state.pushState.get(item.magnet) || 'idle'
      const push = document.createElement('button')
      push.className = `mp115-push ${status === 'success' || status === 'duplicate' || status === 'error' ? status : ''}`
      push.textContent = status === 'working'
        ? '提交中…'
        : status === 'success'
          ? '已提交'
          : status === 'duplicate'
            ? '已存在'
            : status === 'error'
              ? '重试'
              : '推送 115'
      push.disabled = status === 'working'
      push.addEventListener('click', () => pushMagnet(item))
      const copy = document.createElement('button')
      copy.className = 'mp115-copy'
      copy.textContent = '复制'
      copy.addEventListener('click', async () => {
        try {
          await GM.setClipboard(item.magnet)
          notify('磁力已复制', '已写入剪贴板')
        } catch (_) {
          window.prompt('复制磁力链接', item.magnet)
        }
      })
      actions.append(push, copy)
      row.append(info, actions)
      state.list.appendChild(row)
    })
  }

  function createPanel() {
    addStyle()
    const fab = document.createElement('button')
    fab.id = 'mp115-magnet-fab'
    fab.addEventListener('click', () => {
      state.panel.classList.toggle('open')
      renderList()
    })
    document.body.appendChild(fab)
    state.fab = fab

    const panel = document.createElement('div')
    panel.id = 'mp115-magnet-panel'
    panel.innerHTML = `
      <div class="mp115-head">
        <div class="mp115-title">通用磁力 · MoviePilot 115</div>
        <button class="mp115-icon" data-action="settings" title="配置">⚙</button>
        <button class="mp115-icon" data-action="close" title="关闭">×</button>
      </div>
      <div class="mp115-body" data-role="list"></div>
      <div class="mp115-foot">
        <button data-action="refresh">重新扫描</button>
        <button data-action="settings">配置 MP</button>
      </div>
    `
    document.body.appendChild(panel)
    state.panel = panel
    state.list = $('[data-role="list"]', panel)
    panel.querySelectorAll('[data-action="settings"]').forEach(button => button.addEventListener('click', openSettings))
    $('[data-action="close"]', panel).addEventListener('click', () => panel.classList.remove('open'))
    $('[data-action="refresh"]', panel).addEventListener('click', scanMagnets)
    updateFab()
  }

  async function loadConfig() {
    state.config.mpUrl = String(await GM.getValue(STORE.mpUrl, '') || '').trim().replace(/\/+$/, '')
    state.config.apiKey = String(await GM.getValue(STORE.apiKey, '') || '').trim()
    state.config.offlinePath = String(await GM.getValue(STORE.offlinePath, DEFAULT_OFFLINE_PATH) || DEFAULT_OFFLINE_PATH).trim()
  }

  await loadConfig()
  if (!document.body) return
  createPanel()
  GM.registerMenuCommand('配置 MoviePilot 115', openSettings)
  scanMagnets()
  state.observer = new MutationObserver(scheduleScan)
  state.observer.observe(document.body, { childList: true, subtree: true })
})().catch(error => {
  try { GM.log('通用磁力脚本初始化失败', error) } catch (_) {}
})
