<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'

const servicesReady = ref(false)
const preloadError = ref('')

function getServiceWindow() {
  const candidates = []
  try {
    if (window.top) candidates.push(window.top)
  } catch (_) {
    /* cross-origin */
  }
  try {
    if (window.parent && window.parent !== window) candidates.push(window.parent)
  } catch (_) {
    /* ignore */
  }
  candidates.push(window)
  return candidates.find((w) => w && w.services) || window
}

function api() {
  const w = getServiceWindow()
  const s = w.services || window.services || globalThis.services
  if (!s) return null
  return s
}

function requireApi() {
  const s = api()
  if (!s) {
    throw new Error(
      'preload 未加载。请在 uTools 开发者工具导入：E:\\打包工具\\dist\\plugin.json（先执行 npm run build）'
    )
  }
  if (s.__initError) {
    throw new Error('preload 初始化失败: ' + s.__initError)
  }
  return s
}

function resolveDroppedManifest(files) {
  const s = requireApi()
  if (typeof s.importFromDroppedFiles === 'function') {
    return s.importFromDroppedFiles(files)
  }
  const list = Array.from(files || [])
  for (const file of list) {
    const p =
      (typeof s.getPathFromFile === 'function' && s.getPathFromFile(file)) || file.path || ''
    if (p) return s.resolveManifestPath(p)
  }
  throw new Error('无法读取拖入文件路径，请改用点击选择')
}

function waitForServices(maxTry = 80) {
  return new Promise((resolve) => {
    let n = 0
    const tick = () => {
      const s = api()
      if (s) {
        servicesReady.value = true
        preloadError.value = s.__initError || ''
        try {
          const pong = s.ping?.()
          if (pong?.mode) preloadError.value = ''
        } catch (_) {
          /* ignore */
        }
        resolve(true)
        return
      }
      n++
      if (n >= maxTry) {
        servicesReady.value = false
        preloadError.value =
          'preload 未加载。请确认导入的是 dist\\plugin.json，并在开发者工具中点击「重新加载」'
        resolve(false)
        return
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

const topTab = ref('projects')
const subTab = ref('config')
const projects = ref([])
const env = ref({
  hxCliPath: '',
  nodePath: '',
  javaPath: '',
  androidSdkPath: '',
  androidStudioPath: '',
  uniappOfflineSdkPath: ''
})
const selectedId = ref('')
const keyword = ref('')
const logText = ref('')
const cliStatus = ref(null)
const busy = ref(false)
const dropHint = ref('')
const offlineCheck = ref(null)
const offlineBuildMode = ref('debug')
const offlineSyncBeforePack = ref(true)
const logEl = ref(null)
const logExpanded = ref(false)
const certHint = ref('')

const CHANNEL_OPTIONS = [
  { id: 'google', label: 'GooglePlay' },
  { id: 'huawei', label: '华为' },
  { id: 'xiaomi', label: '小米' },
  { id: 'oppo', label: 'OPPO' },
  { id: 'vivo', label: 'VIVO' }
]

const selected = computed(() => projects.value.find((p) => p.id === selectedId.value) || null)

const filteredProjects = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return projects.value
  return projects.value.filter(
    (p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.appid || '').toLowerCase().includes(q) ||
      (p.path || '').toLowerCase().includes(q)
  )
})

function appendLog(text) {
  logText.value += text
  nextTick(() => {
    const el = logEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function clearLog() {
  logText.value = ''
}

async function refresh() {
  const store = requireApi().getStore()
  env.value = {
    hxCliPath: '',
    nodePath: '',
    javaPath: '',
    androidSdkPath: '',
    androidStudioPath: '',
    uniappOfflineSdkPath: '',
    ...store.env
  }
  projects.value = requireApi().listProjects()
  if (!selectedId.value && projects.value.length) {
    selectedId.value = projects.value[0].id
  }
  await refreshOfflineCheck()
}

async function checkCli() {
  const r = await requireApi().checkCli()
  cliStatus.value = r
  if (r.ok && r.exe) {
    env.value.hxCliPath = r.exe
    requireApi().saveEnv({ hxCliPath: r.exe })
  }
}

async function importManifest(path) {
  if (!path) return
  dropHint.value = ''
  try {
    const manifestPath = requireApi().resolveManifestPath(path)
    const project = requireApi().addProjectByManifest(manifestPath)
    selectedId.value = project.id
    await refresh()
    await refreshOfflineCheck()
  } catch (e) {
    dropHint.value = e.message
    appendLog(`[import] ${e.message}\n`)
  }
}

function onDragOver(e) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

async function onDrop(e) {
  e.preventDefault()
  e.stopPropagation()
  dropHint.value = ''
  try {
    const files = e.dataTransfer?.files
    if (!files?.length) {
      dropHint.value = '未识别到文件，请改用点击选择'
      return
    }
    const manifestPath = resolveDroppedManifest(files)
    await importManifest(manifestPath)
  } catch (err) {
    dropHint.value = err.message
    appendLog(`[drop] ${err.message}\n`)
  }
}

function pickManifest() {
  try {
    const manifestPath = requireApi().pickManifestFile()
    if (manifestPath) importManifest(manifestPath)
  } catch (e) {
    dropHint.value = e.message
  }
}

function pickFolder() {
  try {
    const manifestPath = requireApi().pickProjectFolder()
    if (manifestPath) importManifest(manifestPath)
  } catch (e) {
    dropHint.value = e.message
  }
}

function selectProject(id) {
  selectedId.value = id
  subTab.value = 'config'
  refreshOfflineCheck()
}

async function refreshOfflineCheck() {
  if (!selected.value || !api()) return
  try {
    offlineCheck.value = requireApi().inspectOffline(selectedId.value)
  } catch {
    offlineCheck.value = null
  }
}

function updateField(key, value) {
  if (!selected.value) return
  const idx = projects.value.findIndex((p) => p.id === selectedId.value)
  if (idx < 0) return
  projects.value[idx] = { ...projects.value[idx], [key]: value }
}

async function saveProject() {
  if (!selected.value) return
  busy.value = true
  try {
    const patch = { ...selected.value }
    if (patch.dcloudAppkey) {
      patch.dcloudAppkey = patch.dcloudAppkey.trim().replace(/\s+/g, '')
    }
    requireApi().saveProject(selectedId.value, patch)
    try {
      requireApi().writeManifestAppkey({ ...selected.value, ...patch })
      appendLog('\n[ok] manifest.json appkey updated\n')
    } catch (err) {
      appendLog(`\n[warn] manifest write skipped: ${err.message}\n`)
    }
    try {
      const sync = requireApi().syncNativeProjectConfig(selectedId.value)
      if (sync.synced) appendLog('[ok] AndroidManifest.xml appkey synced\n')
    } catch (err) {
      appendLog(`[warn] native sync skipped: ${err.message}\n`)
    }
    await refresh()
  } finally {
    busy.value = false
  }
}

function removeProject() {
  if (!selected.value) return
  if (!confirm(`Remove project "${selected.value.name}"?`)) return
  requireApi().removeProject(selectedId.value)
  selectedId.value = ''
  refresh()
}

async function saveEnv() {
  requireApi().saveEnv({ ...env.value })
  await refresh()
  await checkCli()
}

async function openHx() {
  busy.value = true
  logText.value = ''
  try {
    const r = await requireApi().openHbuilderX()
    appendLog((r.stdout || r.stderr || '') + `\nexit: ${r.code}\n`)
  } catch (e) {
    appendLog(`Error: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

async function openProjectHx() {
  if (!selected.value) return
  busy.value = true
  try {
    const r = await requireApi().openProjectInHx(selected.value.path)
    appendLog((r.stdout || r.stderr || '') + `\nexit: ${r.code}\n`)
  } catch (e) {
    appendLog(`Error: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

async function buildLocal() {
  if (!selected.value) return
  busy.value = true
  logText.value = ''
  try {
    const r = await requireApi().buildAppResources(selected.value.path, appendLog)
    appendLog(`\nMethod: ${r.method || 'unknown'}\nOutput: ${r.outputDir}\nexit: ${r.code}\n`)
    await refreshOfflineCheck()
  } catch (e) {
    appendLog(`\nError: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

async function generateNative(force = false) {
  if (!selected.value) return
  if (force && !confirm('将从离线 SDK 重新复制 Android 工程，覆盖 native/android，是否继续？')) return
  busy.value = true
  logText.value = ''
  try {
    await requireApi().generateAndroidNativeProject(selectedId.value, { force }, appendLog)
    await refreshOfflineCheck()
  } catch (e) {
    appendLog(`\nError: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

async function syncOffline() {
  if (!selected.value) return
  busy.value = true
  logText.value = ''
  try {
    await requireApi().syncOfflineResources(selectedId.value, appendLog)
    await refreshOfflineCheck()
  } catch (e) {
    appendLog(`\nError: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

function isChannelOn(id) {
  if (!selected.value) return false
  const raw = (selected.value.channels || '').toLowerCase()
  return raw.split(/[,，\s]+/).includes(id)
}

function toggleChannel(id) {
  if (offlineBuildMode.value !== 'release') return
  const set = new Set(
    (selected.value.channels || '')
      .split(/[,，\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
  if (set.has(id)) set.delete(id)
  else set.add(id)
  updateField('channels', [...set].join(','))
}

function viewAndroidSignature() {
  if (!selected.value) return
  const p = selected.value
  const lines = [
    `证书类型: ${p.androidPackType === '0' ? '自有证书' : p.androidPackType}`,
    `别名: ${p.certAlias || '(未填)'}`,
    `keystore: ${p.certFile || '(未填)'}`,
    `证书密码: ${p.certPassword ? '***' : '(未填)'}`,
    `库密码: ${p.storePassword || p.certPassword || '(未填)'}`
  ]
  alert(lines.join('\n'))
}

async function uninstallAndInstall() {
  if (!selected.value) return
  busy.value = true
  logText.value = ''
  try {
    appendLog('[adb] uninstall...\n')
    await requireApi().adbUninstallApp(selectedId.value, appendLog)
    appendLog('\n[adb] install...\n')
    const r = await requireApi().adbInstallApk(
      selectedId.value,
      offlineBuildMode.value,
      appendLog
    )
    appendLog(`\nexit: ${r.code}\n`)
  } catch (e) {
    appendLog(`\nError: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

function startPack() {
  startOfflinePack(offlineBuildMode.value)
}

async function startOfflinePack(buildType) {
  if (!selected.value) return
  const mode = buildType || offlineBuildMode.value
  if (mode === 'release') {
    const p = selected.value
    if (!p.certFile || !p.certAlias || !p.certPassword) {
      alert('正式包需在「项目配置」填写 keystore、别名、证书密码并保存')
      subTab.value = 'config'
      return
    }
    if (!confirm('将打 release 正式包（assembleRelease），用于上架/分发，是否继续？')) return
  }
  offlineBuildMode.value = mode
  busy.value = true
  logText.value = ''
  try {
    const r = await requireApi().offlineGradlePack(
      selectedId.value,
      { buildType: mode, skipSync: !offlineSyncBeforePack.value },
      appendLog
    )
    appendLog(`\nexit: ${r.code}\n`)
    if (r.apkPath) appendLog(`APK: ${r.apkPath}\n`)
    if (r.publishPath) appendLog(`正式包副本: ${r.publishPath}\n`)
    await refreshOfflineCheck()
  } catch (e) {
    appendLog(`\nError: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

function openNativeDir() {
  if (!selected.value) return
  openFolder(requireApi().getNativeProjectDir(selected.value.path))
}

function openApkDir() {
  if (!selected.value) return
  openFolder(requireApi().getApkOutputDir(selected.value.path, offlineBuildMode.value))
}

function openReleasePublishDir() {
  if (!selected.value) return
  openFolder(selected.value.path + '\\unpackage\\release')
}

async function installHxBase() {
  if (!selected.value) return
  busy.value = true
  logText.value = ''
  try {
    const r = requireApi().installHbuilderxDebugBase(selectedId.value, appendLog)
    appendLog(`\n可在 HBuilderX：运行 → 使用自定义基座运行 → 本地基座\n`)
    openFolder(requireApi().openCustomDebugBaseDir(selected.value.path))
  } catch (e) {
    appendLog(`\nError: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

async function cloudPack() {
  if (!selected.value) return
  busy.value = true
  logText.value = ''
  try {
    appendLog('Ensure HBuilderX is running and you are logged in.\n')
    const r = await requireApi().cloudPack(selectedId.value, appendLog)
    appendLog(`\nexit: ${r.code}\n`)
  } catch (e) {
    appendLog(`\nError: ${e.message}\n`)
  } finally {
    busy.value = false
  }
}

function browseCli() {
  try {
    const file = requireApi().selectFile([
      { name: 'cli', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }
    ])
    if (file) {
      env.value.hxCliPath = file
      return
    }
  } catch (_) {
    /* fall through */
  }
}

async function browseHxDir() {
  try {
    const cli = requireApi().pickHbuilderXInstallDir()
    if (cli) {
      env.value.hxCliPath = cli
      await saveEnv()
      await checkCli()
    }
  } catch (e) {
    alert(e.message)
  }
}

function pickEnvFile(field, name) {
  const file = requireApi().selectFile([{ name, extensions: ['exe'] }])
  if (file) env.value[field] = file
}

function pickEnvDir(field) {
  const dir = requireApi().selectDirectory()
  if (dir) env.value[field] = dir
}

function browseNode() {
  pickEnvFile('nodePath', 'node')
}
function browseJava() {
  pickEnvFile('javaPath', 'java')
}
function browseAndroidSdk() {
  pickEnvDir('androidSdkPath')
}
function browseStudio() {
  pickEnvFile('androidStudioPath', 'studio')
}
function browseUniappSdk() {
  pickEnvDir('uniappOfflineSdkPath')
}

function browseSdk(target = 'env') {
  const dir = requireApi().selectDirectory()
  if (!dir) return
  if (target === 'project') updateField('androidSdkPath', dir)
  else env.value.uniappOfflineSdkPath = dir
}

function openOutputDir() {
  if (!selected.value) return
  openFolder(requireApi().getOutputDir(selected.value.path))
}

function onCertDragOver(e) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

async function applyCertPath(filePath) {
  if (!selected.value || !filePath) return
  certHint.value = ''
  try {
    const info = await requireApi().applyCertFile(selectedId.value, filePath, {
      storePassword: selected.value.storePassword,
      certPassword: selected.value.certPassword
    })
    await refresh()
    certHint.value = info.message || ''
  } catch (e) {
    certHint.value = e.message
  }
}

async function onCertDrop(e) {
  e.preventDefault()
  e.stopPropagation()
  const files = e.dataTransfer?.files
  if (!files?.length) return
  const p = requireApi().getPathFromFile(files[0])
  if (p) await applyCertPath(p)
  else certHint.value = 'Cannot read dropped file path'
}

function browseCert() {
  const file = requireApi().selectFile([
    { name: 'keystore', extensions: ['keystore', 'jks', 'p12', 'pfx'] }
  ])
  if (file) applyCertPath(file)
}

async function readCertMeta() {
  if (!selected.value?.certFile) {
    certHint.value = 'Import keystore file first'
    return
  }
  await applyCertPath(selected.value.certFile)
}

function certFileName() {
  const p = selected.value?.certFile
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1]
}

function openFolder(p) {
  if (p) requireApi().openPath(p)
}

onMounted(async () => {
  const preloadFlag = document.documentElement.dataset.preload
  if (preloadFlag === 'missing') {
    servicesReady.value = false
    preloadError.value =
      'HTML 中未检测到 window.services，说明 preload.js 未被 uTools 执行。请检查 dist 目录下是否存在 preload.js'
  }
  await waitForServices()
  if (api()) {
    await refresh()
    await checkCli()
    await refreshOfflineCheck()
  }

  if (window.utools) {
    utools.onPluginEnter((action) => {
      if (action.code !== 'import-manifest') return
      if (action.type !== 'file') return
      const list = Array.isArray(action.payload) ? action.payload : []
      for (const item of list) {
        if (item?.path) {
          importManifest(item.path)
          return
        }
      }
    })
  }
})
</script>

<template>
  <div class="app-shell">
    <div v-if="!servicesReady" class="preload-banner" style="flex-shrink:0">
      <div>preload 未加载。请按顺序操作：</div>
      <div>1. 终端执行 <code>npm run build</code></div>
      <div>2. uTools 开发者工具 → 导入源码 → 选择 <strong>dist\plugin.json</strong>（不要选 public 目录）</div>
      <div>3. 点击「重新加载」后关闭插件再打开</div>
      <div v-if="preloadError" style="margin-top:4px;color:#c41d7f">{{ preloadError }}</div>
    </div>
    <div class="top-tabs">
      <button :class="{ active: topTab === 'projects' }" @click="topTab = 'projects'">
        uni-app 项目
      </button>
      <button :class="{ active: topTab === 'env' }" @click="topTab = 'env'">
        环境设置
      </button>
    </div>

    <div v-if="topTab === 'env'" class="main env-scroll">
      <div class="card">
        <h3 class="section-title" style="margin-top:0;padding-top:0;border:0">HBuilderX CLI（必填）</h3>
        <div class="form-grid">
          <label>cli 路径</label>
          <input
            v-model="env.hxCliPath"
            placeholder="D:\HBuilderX.4.29.xxx\HBuilderX\cli.exe"
          />
          <button class="btn" @click="browseCli">选 cli.exe</button>
          <button class="btn" @click="browseHxDir">选安装目录</button>
        </div>
        <div class="actions" style="margin-top:8px">
          <button class="btn" :disabled="busy" @click="checkCli">检测 CLI</button>
          <button class="btn" :disabled="busy" @click="openHx">启动 HBuilderX</button>
        </div>
        <div
          v-if="cliStatus"
          class="env-status"
          :class="cliStatus.ok ? 'ok' : 'fail'"
        >
          <template v-if="cliStatus.ok">CLI 可用：{{ cliStatus.version }}</template>
          <template v-else>CLI 不可用：{{ cliStatus.error }}</template>
        </div>

        <h4 class="section-title">Node（CLI 型 uni-app 可选）</h4>
        <div class="form-grid">
          <label>node 路径</label>
          <input v-model="env.nodePath" placeholder="C:\nvm\v20.x\node.exe" />
          <button class="btn" @click="browseNode">选择</button>
        </div>

        <h4 class="section-title">Android 本地打包环境（离线工程 / Studio）</h4>
        <div class="form-grid">
          <label>Java (jdk17+)</label>
          <input v-model="env.javaPath" placeholder="...\jdk-17\bin" />
          <button class="btn" @click="browseJava">选择</button>

          <label>Android SDK（Gradle）</label>
          <input
            v-model="env.androidSdkPath"
            placeholder="C:\Users\...\AppData\Local\Android\Sdk（非离线 SDK 压缩包）"
          />
          <button class="btn" @click="browseAndroidSdk">选择</button>

          <label>Android Studio</label>
          <input v-model="env.androidStudioPath" placeholder="...\Android Studio\bin\studio64.exe" />
          <button class="btn" @click="browseStudio">选择</button>

          <label>uni-app 离线 SDK</label>
          <input
            v-model="env.uniappOfflineSdkPath"
            placeholder="...\Android-SDK@4.87.xxx"
          />
          <button class="btn" @click="browseUniappSdk">选择</button>
        </div>

        <div class="actions" style="margin-top: 12px">
          <button class="btn btn-primary" :disabled="busy" @click="saveEnv">保存环境</button>
        </div>
        <p class="hint">
          参考「uniapp应用开发工具」：云打包主要用 HBuilderX CLI + 证书；本地离线打包还需 Java、Android
          SDK、离线 SDK，并生成/更新 Android 原生工程。
        </p>
      </div>
    </div>

    <div v-else class="body">
      <aside class="sidebar">
        <div
          class="drop-zone"
          @dragenter.prevent="onDragOver"
          @dragover.prevent="onDragOver"
          @drop.prevent="onDrop"
          @click="pickManifest"
        >
          点击选择 manifest.json<br />或拖入 manifest / 项目文件夹
        </div>
        <button class="btn" style="width:100%" @click.stop="pickFolder">选择项目文件夹</button>
        <p v-if="dropHint" class="drop-error">{{ dropHint }}</p>
        <input v-model="keyword" class="search" placeholder="搜索项目" />
        <div class="project-list">
          <button
            v-for="p in filteredProjects"
            :key="p.id"
            class="project-item"
            :class="{ active: p.id === selectedId }"
            @click="selectProject(p.id)"
          >
            {{ p.name || p.appid }}
          </button>
        </div>
      </aside>

      <section class="main" v-if="selected">
        <div class="main-scroll">
        <div class="card project-header">
          <h2>{{ selected.name }}</h2>
          <span class="meta">AppID: {{ selected.appid }}</span>
          <span class="meta">{{ selected.path }}</span>
          <div class="actions">
            <button class="btn" @click="openFolder(selected.path)">打开目录</button>
            <button class="btn" @click="openProjectHx">在 HBuilderX 打开</button>
            <button class="btn btn-danger" @click="removeProject">删除</button>
          </div>
        </div>

        <div class="sub-tabs">
          <button :class="{ active: subTab === 'config' }" @click="subTab = 'config'">项目配置</button>
          <button :class="{ active: subTab === 'local' }" @click="subTab = 'local'">本地打包</button>
          <button :class="{ active: subTab === 'cloud' }" @click="subTab = 'cloud'">云打包</button>
        </div>

        <div class="card" v-if="subTab === 'config'">
          <div class="form-grid">
            <label>应用名称</label>
            <input :value="selected.name" @input="updateField('name', $event.target.value)" />
            <span />

            <label>应用包名</label>
            <input
              :value="selected.packagename"
              @input="updateField('packagename', $event.target.value)"
            />
            <span />

            <label>dcloud_appkey</label>
            <input
              :value="selected.dcloudAppkey"
              placeholder="32位，从 dev.dcloud.net.cn 应用详情获取"
              @input="updateField('dcloudAppkey', $event.target.value)"
            />
            <span />

            <label>离线 SDK 路径</label>
            <input
              :value="selected.androidSdkPath"
              @input="updateField('androidSdkPath', $event.target.value)"
              placeholder="默认用环境设置中的 uni-app 离线 SDK"
            />
            <button class="btn" @click="browseSdk('project')">选择</button>
          </div>

          <h4 class="section-title">Android 打包证书（云打包 / 离线正式包必填）</h4>
          <div class="form-grid">
            <label>证书类型</label>
            <select
              :value="selected.androidPackType"
              @change="updateField('androidPackType', $event.target.value)"
            >
              <option value="0">自有证书</option>
              <option value="1">公共证书（测试）</option>
              <option value="2">老版证书</option>
            </select>
            <span />

            <label>证书别名</label>
            <input :value="selected.certAlias" @input="updateField('certAlias', $event.target.value)" />
            <button type="button" class="btn btn-sm" @click="readCertMeta">读取别名</button>

            <label>签名文件</label>
            <div
              class="cert-drop"
              @dragenter.prevent="onCertDragOver"
              @dragover.prevent="onCertDragOver"
              @drop.prevent="onCertDrop"
              @click="browseCert"
            >
              <template v-if="selected.certFile">
                <span class="cert-drop-name">{{ certFileName() }}</span>
                <span class="cert-drop-path">{{ selected.certFile }}</span>
              </template>
              <template v-else>
                拖拽 .jks / .keystore / .p12 到此处，或点击选择
              </template>
            </div>
            <button type="button" class="btn" @click.stop="browseCert">选择</button>

            <label>证书密码</label>
            <input
              type="password"
              :value="selected.certPassword"
              placeholder="打包用，读取别名时需与库密码一致"
              @input="updateField('certPassword', $event.target.value)"
            />
            <span />

            <label>库密码</label>
            <input
              type="password"
              :value="selected.storePassword"
              placeholder="读取别名必填；一般与证书密码相同"
              @input="updateField('storePassword', $event.target.value)"
            />
            <span />

            <label>渠道包</label>
            <input
              :value="selected.channels"
              placeholder="在打包操作中勾选，或手动填写 google,huawei..."
              @input="updateField('channels', $event.target.value)"
            />
            <span />
          </div>
          <p v-if="certHint" class="cert-hint">{{ certHint }}</p>
          <p class="hint">
            支持拖拽证书；填写库密码后点「读取别名」或拖入证书时自动解析别名（不读取密码文件）。
          </p>
        </div>

        <div class="card check-card" v-if="subTab === 'local'">
          <h3 class="block-title">项目检查</h3>
          <div class="check-tags" v-if="offlineCheck">
            <span class="tag" :class="offlineCheck.appResources.ok ? 'ok' : 'warn'">app资源</span>
            <span class="tag" :class="offlineCheck.nativeProject.ok ? 'ok' : 'warn'">android工程</span>
            <span class="tag" :class="offlineCheck.offlineSdk.ok ? 'ok' : 'warn'">
              离线SDK{{ offlineCheck.offlineSdk.version ? ' v' + offlineCheck.offlineSdk.version : '' }}
            </span>
            <span class="tag" :class="offlineCheck.androidSdk?.ok ? 'ok' : 'warn'">AndroidSDK</span>
            <span class="tag" :class="offlineCheck.signing?.ok ? 'ok' : 'warn'">签名</span>
          </div>
          <div class="link-bar">
            <button type="button" class="link-btn" :disabled="busy" @click="refreshOfflineCheck">刷新</button>
            <button type="button" class="link-btn" :disabled="busy" @click="generateNative(false)">生成android源码工程</button>
            <button type="button" class="link-btn" :disabled="busy" @click="generateNative(true)">更新工程</button>
            <button type="button" class="link-btn" @click="openNativeDir">打开原生工程</button>
            <button type="button" class="link-btn" :disabled="busy" @click="installHxBase">安装HX本地基座</button>
          </div>
        </div>

        <div class="card pack-card" v-if="subTab === 'local'">
          <h3 class="block-title">打包操作</h3>

          <div class="pack-row">
            <span class="pack-label">选择平台：</span>
            <label class="pack-option">
              <input type="checkbox" checked disabled />
              <span>android</span>
            </label>
          </div>

          <div class="pack-row">
            <span class="pack-label">选择模式：</span>
            <label class="pack-option">
              <input v-model="offlineBuildMode" type="radio" value="debug" />
              <span>debug(基座包)</span>
            </label>
            <label class="pack-option">
              <input v-model="offlineBuildMode" type="radio" value="release" />
              <span>release(正式包)</span>
            </label>
          </div>

          <div class="pack-row" :class="{ 'is-disabled': offlineBuildMode !== 'release' }">
            <span class="pack-label">android渠道包：</span>
            <label
              v-for="ch in CHANNEL_OPTIONS"
              :key="ch.id"
              class="pack-option"
            >
              <input
                type="checkbox"
                :checked="isChannelOn(ch.id)"
                :disabled="offlineBuildMode !== 'release' || busy"
                @change="toggleChannel(ch.id)"
              />
              <span>{{ ch.label }}</span>
            </label>
          </div>

          <div class="pack-toolbar">
            <span class="pack-android-label">android:</span>
            <button type="button" class="btn-outline" @click="viewAndroidSignature">查看android签名</button>
            <button type="button" class="btn-outline" :disabled="busy" @click="uninstallAndInstall">
              卸载&amp;安装
            </button>
            <span class="pack-vdivider" />
            <button type="button" class="btn-solid" :disabled="busy" @click="syncOffline">同步app资源</button>
            <button type="button" class="btn-solid" :disabled="busy" @click="startPack">开始打包</button>
          </div>

          <label class="pack-extra">
            <input v-model="offlineSyncBeforePack" type="checkbox" />
            <span>开始打包前同步 app 资源（首次建议勾选）</span>
          </label>
          <div class="link-bar">
            <button type="button" class="link-btn" @click="openApkDir">APK目录</button>
            <button type="button" class="link-btn" @click="openReleasePublishDir">正式包目录</button>
            <button type="button" class="link-btn" :disabled="busy" @click="buildLocal">仅编译资源</button>
          </div>
        </div>

        <div class="card pack-card" v-if="subTab === 'cloud'">
          <h3 class="block-title">打包操作</h3>
          <div class="pack-row">
            <span class="pack-label">选择平台：</span>
            <label class="pack-option">
              <input type="checkbox" checked disabled />
              <span>android</span>
            </label>
          </div>
          <div class="pack-row">
            <span class="pack-label">选择模式：</span>
            <label class="pack-option">
              <input type="radio" checked disabled />
              <span>release(云打包正式版)</span>
            </label>
          </div>
          <div class="pack-toolbar">
            <span class="pack-android-label">android:</span>
            <button type="button" class="btn-outline" @click="viewAndroidSignature">查看android签名</button>
            <span class="pack-vdivider" />
            <button type="button" class="btn-solid" :disabled="busy" @click="cloudPack">开始打包</button>
          </div>
          <p class="pack-tip">需启动 HBuilderX 并登录 DCloud；证书在「项目配置」填写。</p>
        </div>
        </div>

        <div class="log-panel" :class="{ expanded: logExpanded }">
          <div class="log-toolbar">
            <span class="log-title">日志</span>
            <button type="button" class="btn btn-sm" @click="clearLog">清空</button>
            <button type="button" class="btn btn-sm" @click="logExpanded = !logExpanded">
              {{ logExpanded ? '还原' : '放大' }}
            </button>
          </div>
          <div ref="logEl" class="log-box">{{ logText || '日志输出区域（打包时自动滚动到底部）' }}</div>
        </div>

        <div class="footer-bar">
          <button class="btn btn-primary" :disabled="busy" @click="saveProject">保存</button>
          <span class="hint">修改配置后请保存；可选写回 manifest.json</span>
        </div>
      </section>

      <section v-else class="main empty">请先导入 manifest.json</section>
    </div>
  </div>
</template>
