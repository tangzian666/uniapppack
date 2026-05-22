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
const logEl = ref(null)
const logExpanded = ref(false)

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
    requireApi().saveProject(selectedId.value, { ...selected.value })
    try {
      requireApi().writeManifestAppkey(selected.value)
      appendLog('\n[ok] manifest.json updated\n')
    } catch (err) {
      appendLog(`\n[warn] manifest write skipped: ${err.message}\n`)
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

async function startOfflinePack() {
  if (!selected.value) return
  busy.value = true
  logText.value = ''
  try {
    const r = await requireApi().offlineGradlePack(
      selectedId.value,
      { buildType: offlineBuildMode.value },
      appendLog
    )
    appendLog(`\nexit: ${r.code}\n`)
    if (r.apkPath) appendLog(`APK: ${r.apkPath}\n`)
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
  openFolder(
    requireApi().getNativeProjectDir(selected.value.path) +
      '\\simpleDemo\\build\\outputs\\apk\\debug'
  )
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

function browseCert() {
  const file = requireApi().selectFile([{ name: 'keystore', extensions: ['keystore', 'jks', 'key'] }])
  if (file) updateField('certFile', file)
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

          <h4 class="section-title">Android 打包证书（云打包用）</h4>
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
            <span />

            <label>keystore 文件</label>
            <input :value="selected.certFile" @input="updateField('certFile', $event.target.value)" />
            <button class="btn" @click="browseCert">选择</button>

            <label>证书密码</label>
            <input
              type="password"
              :value="selected.certPassword"
              @input="updateField('certPassword', $event.target.value)"
            />
            <span />

            <label>库密码</label>
            <input
              type="password"
              :value="selected.storePassword"
              @input="updateField('storePassword', $event.target.value)"
              placeholder="与证书密码相同可留空"
            />
            <span />

            <label>渠道包</label>
            <input
              :value="selected.channels"
              placeholder="google,huawei,xiaomi..."
              @input="updateField('channels', $event.target.value)"
            />
            <span />
          </div>
          <p class="hint">自有证书需填写别名、.keystore/.jks 路径及密码；保存后到「云打包」执行打包。</p>
        </div>

        <div class="card" v-if="subTab === 'local'">
          <h3 class="section-title" style="margin-top:0;padding-top:0;border:0">项目检查</h3>
          <ul class="check-list" v-if="offlineCheck">
            <li :class="offlineCheck.appResources.ok ? 'ok' : 'warn'">
              app 资源
              <span v-if="offlineCheck.appResources.ok">✓</span>
              <span v-else>— {{ offlineCheck.appResources.hint }}</span>
            </li>
            <li :class="offlineCheck.nativeProject.ok ? 'ok' : 'warn'">
              android 源码工程
              <span v-if="offlineCheck.nativeProject.ok">✓ {{ offlineCheck.nativeProject.path }}</span>
              <span v-else>— {{ offlineCheck.nativeProject.hint }}</span>
            </li>
            <li :class="offlineCheck.offlineSdk.ok ? 'ok' : 'warn'">
              uni-app 离线 SDK
              <span v-if="offlineCheck.offlineSdk.ok">
                ✓ v{{ offlineCheck.offlineSdk.version || '?' }}
              </span>
              <span v-else>— {{ offlineCheck.offlineSdk.error }}</span>
            </li>
            <li :class="offlineCheck.androidSdk?.ok ? 'ok' : 'warn'">
              Android SDK（Gradle）
              <span v-if="offlineCheck.androidSdk?.ok">✓ {{ offlineCheck.androidSdk.path }}</span>
              <span v-else>— {{ offlineCheck.androidSdk?.hint }}</span>
            </li>
          </ul>
          <button class="btn btn-sm" :disabled="busy" @click="refreshOfflineCheck">刷新检查</button>

          <h4 class="section-title">① 生成 Android 源码工程</h4>
          <p class="hint">
            从离线 SDK 的 <code>HBuilder-Integrate-AS</code> 复制到项目
            <code>native/android</code>，并写入包名、appkey、证书。SDK 版本需与 HBuilderX 一致（建议 4.87）。
          </p>
          <div class="actions">
            <button class="btn btn-primary" :disabled="busy" @click="generateNative(false)">
              生成 Android 工程
            </button>
            <button class="btn" :disabled="busy" @click="generateNative(true)">从 SDK 更新工程</button>
            <button class="btn" @click="openNativeDir">打开原生工程</button>
          </div>

          <h4 class="section-title">② 打包操作</h4>
          <div class="pack-ops">
            <label class="inline-label">
              <input type="checkbox" checked disabled /> android
            </label>
            <div class="mode-row">
              <span>选择模式：</span>
              <label><input v-model="offlineBuildMode" type="radio" value="debug" /> debug（基座包）</label>
              <label><input v-model="offlineBuildMode" type="radio" value="release" /> release（正式包）</label>
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" :disabled="busy" @click="syncOffline">同步 app 资源</button>
            <button class="btn btn-primary" :disabled="busy" @click="startOfflinePack">开始打包</button>
            <button class="btn" :disabled="busy" @click="buildLocal">仅编译 App 资源</button>
            <button class="btn" @click="openOutputDir">打开资源目录</button>
            <button class="btn" @click="openApkDir">打开 APK 目录</button>
            <button class="btn" :disabled="busy" @click="installHxBase">安装为 HX 本地基座</button>
          </div>
          <p class="hint">
            推荐顺序：生成工程 → 同步 app 资源（含 CLI 编译 + 拷贝 www）→ 开始打包（Gradle）。需配置环境里的
            Java、Android SDK、离线 SDK；HBuilderX 需已启动。
          </p>
        </div>

        <div class="card" v-if="subTab === 'cloud'">
          <p class="hint">证书在「项目配置」中填写并保存；此处直接发起云打包。</p>
          <div class="actions" style="margin-top: 10px">
            <button class="btn btn-primary" :disabled="busy" @click="cloudPack">开始云打包</button>
          </div>
          <p class="hint">需先启动 HBuilderX 并登录 DCloud；打包日志见下方。</p>
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
