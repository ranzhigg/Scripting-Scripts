// ==UserScript==
// @name         通用磁力 → MoviePilot 115（双路线）
// @namespace    https://github.com/ranzhigg/scripting-scripts/dual-route
// @version      0.3.2
// @description  在任意资源页识别 BT 磁力，可通过 MoviePilot 或 115 Cookie 离线转存，并拉起常用播放器。
// @author       ranzhi
// @updateURL    https://raw.githubusercontent.com/ranzhigg/Scripting-Scripts/main/Magnet-MoviePilot-115.user.js
// @downloadURL  https://raw.githubusercontent.com/ranzhigg/Scripting-Scripts/main/Magnet-MoviePilot-115.user.js
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
// @connect      115.com
// @connect      my.115.com
// @connect      webapi.115.com
// @connect      proapi.115.com
// @run-at       document-end
// @inject-into  content
// ==/UserScript==

(async () => {
  'use strict'

  const STORE = {
    mpUrl: 'generic_magnet_mp_url',
    apiKey: 'generic_magnet_mp_api_key',
    cookie: 'generic_magnet_115_cookie',
    offlinePath: 'generic_magnet_mp_offline_path',
    route: 'generic_magnet_route',
    player: 'generic_magnet_player',
    playerTemplate: 'generic_magnet_player_template',
  }
  // 公开脚本不写入任何人的私人目录；留空时由 P115StrmHelper 使用自身默认目录。
  const DEFAULT_OFFLINE_PATH = ''
  const DEFAULT_ROUTE = 'auto'
  const DEFAULT_PLAYER = 'infuse'
  const DEFAULT_PLAYER_TEMPLATE = ''
  const MP_PLUGIN_ID = 'P115StrmHelper'
  const MAGNET_PREFIX = 'magnet:?xt=urn:btih:'

  const state = {
    config: {
      mpUrl: '',
      apiKey: '',
      cookie: '',
      offlinePath: DEFAULT_OFFLINE_PATH,
      route: DEFAULT_ROUTE,
      player: DEFAULT_PLAYER,
      playerTemplate: DEFAULT_PLAYER_TEMPLATE,
    },
    magnets: [],
    pushState: new Map(),
    panel: null,
    list: null,
    fab: null,
    scanTimer: null,
    observer: null,
    batchWorking: false,
    p115: { uid: '', sign: '', time: '', path: '', pathId: '' },
  }

  const $ = (selector, root = document) => root.querySelector(selector)

  function normalizeMpUrl(value) {
    let raw = String(value || '').trim()
    if (!raw) return ''
    try {
      const parsed = new URL(raw)
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('仅支持 http:// 或 https:// 地址')
      parsed.search = ''
      parsed.hash = ''
      parsed.pathname = parsed.pathname.replace(/\/(?:login|home|dashboard)\/?$/i, '/')
      return parsed.toString().replace(/\/+$/, '')
    } catch (_) {
      throw new Error('MoviePilot 地址应填写类似 http://10.0.200.10:3000 的 API 基地址')
    }
  }

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
    return String(body?.msg || body?.message || body?.detail || body?.error_msg || body?.error || fallback)
  }

  function errorMessage(error, fallback = '网络请求失败') {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === 'string' && error) return error
    return String(error?.error || error?.message || error?.responseText || fallback)
  }

  function apiEnvelope(body) {
    return body?.data && typeof body.data === 'object' && body.data.code !== undefined
      ? body.data
      : body
  }

  async function requestMoviePilot(path, options = {}) {
    const { apiKey } = state.config
    const baseUrl = normalizeMpUrl(state.config.mpUrl)
    if (!baseUrl || !apiKey) throw new Error('请先配置 MoviePilot 地址和 API Key')
    const response = await gmRequest({
      method: options.method || 'GET',
      url: `${baseUrl}${path}`,
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

  function formBody(values) {
    const params = new URLSearchParams()
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.append(key, String(value))
    })
    return params.toString()
  }

  async function request115(url, options = {}) {
    const cookie = String(state.config.cookie || '').trim()
    if (!cookie) throw new Error('请先配置 115 Cookie')
    const response = await gmRequest({
      method: options.method || 'GET',
      url,
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
        Cookie: cookie,
        ...(options.headers || {}),
      },
      data: options.body ? formBody(options.body) : undefined,
      withCredentials: true,
      responseType: 'json',
      timeout: options.timeout || 30000,
    })
    const body = responseBody(response)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${response.status || '网络'}：${responseMessage(body, '115 请求失败')}`)
    }
    return body
  }

  function is115Success(body) {
    return body?.state === true || body?.state === 1 || body?.code === 0 || body?.code === '0'
  }

  async function get115Session() {
    if (state.p115.uid && state.p115.sign && state.p115.time) return state.p115
    const uidBody = await request115('https://my.115.com/?ct=ajax&ac=get_user_aq', { timeout: 15000 })
    const uid = uidBody?.data?.uid || uidBody?.uid
    if (!uid) throw new Error(responseMessage(uidBody, '115 Cookie 无效或已过期，无法获取 UID'))
    const signBody = await request115('https://115.com/?ct=offline&ac=space', { timeout: 15000 })
    const sign = signBody?.sign || signBody?.data?.sign
    const time = signBody?.time || signBody?.data?.time
    if (!sign || !time) throw new Error(responseMessage(signBody, '115 Cookie 无效或已过期，无法获取离线签名'))
    state.p115 = { uid: String(uid), sign: String(sign), time: String(time), path: '', pathId: '' }
    return state.p115
  }

  function folderItems(body) {
    const data = Array.isArray(body?.data) ? body.data : body?.data?.data
    return Array.isArray(data) ? data : []
  }

  function folderName(item) {
    return String(item?.n || item?.name || item?.file_name || '').trim()
  }

  function folderId(item) {
    return String(item?.cid || item?.fid || item?.file_id || item?.id || '').trim()
  }

  function isFolder(item) {
    return item && !item.sha && !item.sha1 && (item.is_dir === undefined || item.is_dir === true || !item.type)
  }

  async function get115FolderItems(cid) {
    const query = new URLSearchParams({
      aid: '1',
      cid: String(cid || '0'),
      o: 'user_ptime',
      asc: '0',
      offset: '0',
      show_dir: '1',
      limit: '500',
      snap: '0',
      natsort: '1',
    })
    return folderItems(await request115(`https://webapi.115.com/files?${query}`, { timeout: 30000 }))
  }

  async function create115Folder(parentId, name) {
    const body = await request115('https://webapi.115.com/files/add', {
      method: 'POST',
      body: { pid: parentId, cname: name },
      timeout: 30000,
    })
    const createdId = folderId(body) || folderId(body?.data)
    if (createdId) return createdId
    const created = (await get115FolderItems(parentId)).find(item => isFolder(item) && folderName(item) === name)
    if (created && folderId(created)) return folderId(created)
    throw new Error(responseMessage(body, `无法创建 115 目录：${name}`))
  }

  async function resolve115Path(path) {
    const raw = String(path || '').trim()
    if (!raw || raw === '/') return ''
    if (/^\d+$/.test(raw)) return raw
    const parts = raw.split(/[\\/]+/).map(item => item.trim()).filter(Boolean)
    if (!parts.length) return ''
    if (parts.length > 25) throw new Error('115 目录层级不能超过 25 层')
    let currentId = '0'
    for (const part of parts) {
      if (part === '.' || part === '..') throw new Error('115 目录路径不允许使用 . 或 ..')
      const existing = (await get115FolderItems(currentId)).find(item => isFolder(item) && folderName(item) === part)
      currentId = existing ? folderId(existing) : await create115Folder(currentId, part)
      if (!currentId) throw new Error(`无法解析 115 目录：${part}`)
    }
    return currentId
  }

  async function add115OfflineTask(magnet) {
    const session = await get115Session()
    if (state.p115.path !== state.config.offlinePath) {
      state.p115.path = state.config.offlinePath
      state.p115.pathId = await resolve115Path(state.config.offlinePath)
    }
    const payload = {
      url: magnet,
      savepath: '',
      ...(state.p115.pathId ? { wp_path_id: state.p115.pathId } : {}),
      uid: session.uid,
      sign: session.sign,
      time: session.time,
    }
    const body = await request115('https://115.com/web/lixian/?ct=lixian&ac=add_task_url', {
      method: 'POST',
      body: payload,
      timeout: 60000,
    })
    if (!is115Success(body)) throw new Error(responseMessage(body, '115 离线转存失败'))
    return body
  }

  async function submit115Links(links) {
    const results = []
    const completed = []
    try {
      for (const link of links) {
        results.push(await add115OfflineTask(link))
        completed.push(link)
      }
    } catch (error) {
      error.completed = completed
      throw error
    }
    return {
      source: '115',
      body: { state: true, msg: `${results.length} 个任务已提交到 115` },
      results,
    }
  }

  async function submitMoviePilotLinks(links) {
    const body = await requestMoviePilot(`/api/v1/plugin/${MP_PLUGIN_ID}/add_offline_task`, {
      method: 'POST',
      body: {
        links,
        path: state.config.offlinePath || null,
      },
      timeout: 60000,
    })
    const envelope = apiEnvelope(body)
    if (typeof envelope?.code === 'number' && envelope.code !== 0) {
      throw new Error(responseMessage(envelope, '115 离线转存失败'))
    }
    return { source: 'mp', body: envelope }
  }

  async function verifyMoviePilot() {
    const body = await requestMoviePilot('/api/v1/user/current', { timeout: 10000 })
    const user = body?.data && typeof body.data === 'object' ? body.data : body
    return user?.username || user?.name || '连接成功'
  }

  async function submitOfflineLinks(links) {
    const uniqueLinks = [...new Set(links.map(cleanMagnet).filter(Boolean))]
    if (!uniqueLinks.length) throw new Error('没有可提交的磁力链接')
    const canMoviePilot = Boolean(state.config.mpUrl && state.config.apiKey)
    const can115 = Boolean(state.config.cookie)
    if (state.config.route === '115') {
      if (!can115) throw new Error('当前通道设为 115，但没有配置 115 Cookie')
      return submit115Links(uniqueLinks)
    }
    if (state.config.route === 'mp') {
      if (!canMoviePilot) throw new Error('当前通道设为 MoviePilot，但地址或 API Key 未配置')
      return submitMoviePilotLinks(uniqueLinks)
    }
    if (canMoviePilot) {
      try {
        return await submitMoviePilotLinks(uniqueLinks)
      } catch (error) {
        if (!can115) throw error
        notify('MoviePilot 提交失败，切换 115', '当前批次将使用本机保存的 115 Cookie 重试。')
      }
    }
    if (can115) return submit115Links(uniqueLinks)
    throw new Error('请配置 MoviePilot 地址 + API Key，或配置 115 Cookie')
  }

  function submissionMessage(result, fallback) {
    const directResult = result?.results?.[0]
    return responseMessage(result?.body || directResult || result, fallback)
  }

  function hasSubmissionRoute() {
    return Boolean(
      (state.config.mpUrl && state.config.apiKey) ||
      state.config.cookie,
    )
  }

  async function pushMagnet(item) {
    const current = state.pushState.get(item.magnet) || 'idle'
    if (current === 'working' || state.batchWorking) return
    if (!hasSubmissionRoute()) {
      await openSettings()
      if (!hasSubmissionRoute()) return
    }

    state.pushState.set(item.magnet, 'working')
    renderList()
    try {
      const result = await submitOfflineLinks([item.magnet])
      const duplicate = /已存在|重复|already/i.test(submissionMessage(result, ''))
      state.pushState.set(item.magnet, duplicate ? 'duplicate' : 'success')
      const title = duplicate ? '115 任务已存在' : '115 离线提交成功'
      notify(title, `${shortText(item.label, 50)}\n目录：${state.config.offlinePath || 'P115StrmHelper 默认目录'}`)
    } catch (error) {
      state.pushState.set(item.magnet, 'error')
      notify('115 离线提交失败', errorMessage(error))
    } finally {
      renderList()
    }
  }

  async function pushPendingMagnets() {
    if (state.batchWorking) return
    const pending = state.magnets.filter(item => {
      const status = state.pushState.get(item.magnet) || 'idle'
      return status !== 'success' && status !== 'duplicate' && status !== 'working'
    })
    if (!pending.length) {
      notify('没有待推送磁力', '当前页面的磁力都已提交或正在处理中。')
      return
    }
    if (!hasSubmissionRoute()) {
      await openSettings()
      if (!hasSubmissionRoute()) return
    }

    state.batchWorking = true
    pending.forEach(item => state.pushState.set(item.magnet, 'working'))
    renderList()
    try {
      const result = await submitOfflineLinks(pending.map(item => item.magnet))
      const message = submissionMessage(result, `${pending.length} 条任务已提交`)
      const duplicate = /已存在|重复|already/i.test(message)
      pending.forEach(item => state.pushState.set(item.magnet, duplicate ? 'duplicate' : 'success'))
      notify(duplicate ? '115 任务已存在' : '115 批量提交成功', `${message}\n共处理 ${pending.length} 条磁力`)
    } catch (error) {
      const completed = new Set(error?.completed || [])
      pending.forEach(item => state.pushState.set(item.magnet, completed.has(item.magnet) ? 'success' : 'error'))
      notify('115 批量提交失败', errorMessage(error))
    } finally {
      state.batchWorking = false
      renderList()
    }
  }

  function findHttpUrl(value, depth = 0) {
    if (depth > 5 || value === null || value === undefined) return ''
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findHttpUrl(item, depth + 1)
        if (found) return found
      }
      return ''
    }
    if (typeof value !== 'object') return ''
    for (const key of ['file_url_302', 'url', 'file_url', 'download_url']) {
      const found = findHttpUrl(value[key], depth + 1)
      if (found) return found
    }
    for (const item of Object.values(value)) {
      const found = findHttpUrl(item, depth + 1)
      if (found) return found
    }
    return ''
  }

  async function get115PlaybackUrl(target) {
    const raw = String(target || '').trim()
    if (/^https?:\/\//i.test(raw)) return raw
    if (!/^[A-Za-z0-9]{10,32}$/.test(raw)) {
      throw new Error('115 直连播放请输入文件 pickcode，或粘贴已有的 HTTP 播放地址')
    }
    try {
      const body = await request115('https://proapi.115.com/app/chrome/downurl', {
        method: 'POST',
        body: { pickcode: raw },
        timeout: 30000,
      })
      const url = findHttpUrl(body)
      if (url) return url
    } catch (_) {}
    const query = new URLSearchParams({ pickcode: raw, dl: '1' })
    const body = await request115(`https://webapi.115.com/files/download?${query}`, { timeout: 30000 })
    const url = findHttpUrl(body)
    if (!url) throw new Error(responseMessage(body, '115 未返回可播放直链'))
    return url
  }

  function getMpPlaybackUrl(target) {
    const baseUrl = normalizeMpUrl(state.config.mpUrl)
    if (!baseUrl) throw new Error('没有可用的 MoviePilot 地址')
    const raw = String(target || '').trim()
    if (!raw) throw new Error('请输入 115 文件 pickcode、文件路径或已有播放地址')
    if (/^https?:\/\/.*\/api\/v1\/plugin\/P115StrmHelper\/redirect_url/i.test(raw)) return raw
    if (/^https?:\/\//i.test(raw)) return raw
    if (/^[A-Za-z0-9]{10,32}$/.test(raw)) {
      return `${baseUrl}/api/v1/plugin/${MP_PLUGIN_ID}/redirect_url?pickcode=${encodeURIComponent(raw)}`
    }
    if (/^\d+$/.test(raw) || raw.includes('/')) {
      return `${baseUrl}/api/v1/plugin/${MP_PLUGIN_ID}/redirect_url/${encodeURIComponent(raw)}`
    }
    throw new Error('请输入有效的 115 pickcode、文件 ID 或文件路径')
  }

  async function resolvePlaybackUrl(target) {
    const useDirect115 = state.config.route === '115' || !state.config.mpUrl
    if (!useDirect115 && state.config.mpUrl) return getMpPlaybackUrl(target)
    if (state.config.cookie) return get115PlaybackUrl(target)
    if (state.config.mpUrl) return getMpPlaybackUrl(target)
    throw new Error('请先配置 MoviePilot 地址，或配置 115 Cookie')
  }

  function buildPlayerUrl(playbackUrl) {
    const encoded = encodeURIComponent(playbackUrl)
    switch (state.config.player) {
      case 'vlc':
        return `vlc-x-callback://x-callback-url/stream?url=${encoded}`
      case 'browser':
        return playbackUrl
      case 'custom':
        if (!state.config.playerTemplate || !state.config.playerTemplate.includes('{url}')) {
          throw new Error('自定义播放器模板必须包含 {url} 占位符')
        }
        return state.config.playerTemplate.split('{url}').join(encoded)
      case 'infuse':
      default:
        return `infuse://x-callback-url/play?url=${encoded}`
    }
  }

  async function launchPlayer() {
    if (!state.config.mpUrl && !state.config.cookie) {
      await openSettings()
      if (!state.config.mpUrl && !state.config.cookie) return
    }
    const target = window.prompt(
      'MoviePilot 模式可输入 115 pickcode、文件 ID、完整路径或已有 HTTP 播放地址\n纯 115 Cookie 模式请填写文件 pickcode，或粘贴已有 HTTP 播放地址。',
      '',
    )
    if (target === null || !target.trim()) return
    try {
      const playbackUrl = await resolvePlaybackUrl(target)
      const playerUrl = buildPlayerUrl(playbackUrl)
      notify('正在拉起播放器', state.config.player === 'browser' ? '将在当前浏览器打开播放地址' : `播放器：${state.config.player}`)
      window.location.href = playerUrl
    } catch (error) {
      notify('播放器拉起失败', errorMessage(error))
    }
  }

  async function openSettings() {
    const current = state.config
    const url = window.prompt('MoviePilot 地址（可留空，留空后使用 115 Cookie 直连）', current.mpUrl)
    if (url === null) return
    const apiKey = window.prompt('MoviePilot API Key（留空保留，输入 - 清除；不会显示当前值）', '')
    if (apiKey === null) return
    const cookie = window.prompt('115 Cookie（可选，仅保存在本机；留空保留，输入 - 清除）', '')
    if (cookie === null) return
    const path = window.prompt('115 离线目录（可填路径如 /影视/待整理，或目录 ID；留空使用默认目录）', current.offlinePath || '')
    if (path === null) return
    const route = window.prompt('提交通道：auto=MoviePilot 优先并可回退 115，mp=仅 MoviePilot，115=仅 Cookie 直连', current.route || DEFAULT_ROUTE)
    if (route === null) return
    const player = window.prompt('播放器：infuse / vlc / browser / custom', current.player || DEFAULT_PLAYER)
    if (player === null) return
    let playerTemplate = current.playerTemplate || DEFAULT_PLAYER_TEMPLATE
    if (player.trim().toLowerCase() === 'custom') {
      const template = window.prompt('自定义 URL Scheme 模板，使用 {url} 占位符（示例：myplayer://play?url={url}）', playerTemplate)
      if (template === null) return
      playerTemplate = template.trim()
    }

    try {
      state.config.mpUrl = normalizeMpUrl(url)
    } catch (error) {
      notify('MoviePilot 地址无效', error?.message || String(error))
      return
    }
    if (apiKey.trim() === '-') state.config.apiKey = ''
    else if (apiKey.trim()) state.config.apiKey = apiKey.trim()
    if (cookie.trim() === '-') state.config.cookie = ''
    else if (cookie.trim()) state.config.cookie = cookie.trim()
    state.config.offlinePath = path.trim() || DEFAULT_OFFLINE_PATH
    state.config.route = /^(auto|mp|115)$/i.test(route.trim()) ? route.trim().toLowerCase() : DEFAULT_ROUTE
    state.config.player = /^(infuse|vlc|browser|custom)$/i.test(player.trim()) ? player.trim().toLowerCase() : DEFAULT_PLAYER
    state.config.playerTemplate = playerTemplate
    state.p115 = { uid: '', sign: '', time: '', path: '', pathId: '' }
    await Promise.all([
      GM.setValue(STORE.mpUrl, state.config.mpUrl),
      GM.setValue(STORE.apiKey, state.config.apiKey),
      GM.setValue(STORE.cookie, state.config.cookie),
      GM.setValue(STORE.offlinePath, state.config.offlinePath),
      GM.setValue(STORE.route, state.config.route),
      GM.setValue(STORE.player, state.config.player),
      GM.setValue(STORE.playerTemplate, state.config.playerTemplate),
    ])
    if (state.config.mpUrl && state.config.apiKey) {
      try {
        const user = await verifyMoviePilot()
        notify('配置已保存', `MoviePilot：${user}\n115 目录：${state.config.offlinePath || '默认目录'}\n播放器：${state.config.player}`)
      } catch (error) {
        notify('配置已保存，但 MoviePilot 连接测试失败', error?.message || String(error))
      }
    } else if (state.config.cookie) {
      try {
        await get115Session()
        notify('配置已保存', `115 Cookie 可用\n目录：${state.config.offlinePath || '115 默认目录'}\n播放器：${state.config.player}`)
      } catch (error) {
        notify('配置已保存，但 115 Cookie 测试失败', error?.message || String(error))
      }
    } else {
      notify('配置已保存', '请配置 MoviePilot 或 115 Cookie 后再提交任务。')
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
    state.fab.textContent = count ? `MP / 115 · ${count}` : 'MP / 115'
    state.fab.title = hasSubmissionRoute() ? `检测到 ${count} 条磁力` : '先配置 MoviePilot 或 115 Cookie'
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
      push.disabled = status === 'working' || state.batchWorking
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
        <button data-action="batch">全部推送</button>
        <button data-action="play">播放</button>
        <button data-action="settings">配置</button>
      </div>
    `
    document.body.appendChild(panel)
    state.panel = panel
    state.list = $('[data-role="list"]', panel)
    panel.querySelectorAll('[data-action="settings"]').forEach(button => button.addEventListener('click', openSettings))
    $('[data-action="close"]', panel).addEventListener('click', () => panel.classList.remove('open'))
    $('[data-action="refresh"]', panel).addEventListener('click', scanMagnets)
    $('[data-action="batch"]', panel).addEventListener('click', pushPendingMagnets)
    $('[data-action="play"]', panel).addEventListener('click', launchPlayer)
    updateFab()
  }

  async function loadConfig() {
    const savedUrl = String(await GM.getValue(STORE.mpUrl, '') || '').trim()
    try {
      state.config.mpUrl = normalizeMpUrl(savedUrl)
    } catch (_) {
      state.config.mpUrl = savedUrl
    }
    state.config.apiKey = String(await GM.getValue(STORE.apiKey, '') || '').trim()
    state.config.cookie = String(await GM.getValue(STORE.cookie, '') || '').trim()
    state.config.offlinePath = String(await GM.getValue(STORE.offlinePath, DEFAULT_OFFLINE_PATH) || DEFAULT_OFFLINE_PATH).trim()
    const savedRoute = String(await GM.getValue(STORE.route, DEFAULT_ROUTE) || DEFAULT_ROUTE).trim().toLowerCase()
    state.config.route = /^(auto|mp|115)$/.test(savedRoute) ? savedRoute : DEFAULT_ROUTE
    const savedPlayer = String(await GM.getValue(STORE.player, DEFAULT_PLAYER) || DEFAULT_PLAYER).trim().toLowerCase()
    state.config.player = /^(infuse|vlc|browser|custom)$/.test(savedPlayer) ? savedPlayer : DEFAULT_PLAYER
    state.config.playerTemplate = String(await GM.getValue(STORE.playerTemplate, DEFAULT_PLAYER_TEMPLATE) || DEFAULT_PLAYER_TEMPLATE).trim()
  }

  await loadConfig()
  if (!document.body) return
  createPanel()
  GM.registerMenuCommand('配置 MoviePilot 115', openSettings)
  GM.registerMenuCommand('播放 115 文件', launchPlayer)
  scanMagnets()
  state.observer = new MutationObserver(scheduleScan)
  state.observer.observe(document.body, { childList: true, subtree: true })
})().catch(error => {
  try { GM.log('通用磁力脚本初始化失败', error) } catch (_) {}
})
