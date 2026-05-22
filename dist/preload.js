/* uTools preload：首行即挂载，避免后续逻辑异常导致 services 不可用 */
;(function bootstrap() {
  const boot = {
    ping() {
      return { ok: true, stage: 'bootstrap' }
    },
    __boot: true
  }
  window.services = boot
  if (typeof globalThis !== 'undefined') globalThis.services = boot
})()

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const os = require('os')
const offline = require('./offline-android.js')

const STORAGE_KEY = 'uniapp_pack_data_v1'
let exposeMode = 'unknown'

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(stripJsonComments(raw))
}

function stripJsonComments(text) {
  let out = ''
  let i = 0
  let inString = false
  let quote = ''
  let escaped = false
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        inString = false
      }
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function findProjectRoot(manifestPath) {
  return path.dirname(path.resolve(manifestPath))
}

function parseManifest(manifestPath) {
  const root = findProjectRoot(manifestPath)
  const manifest = readJson(manifestPath)
  const appid = manifest.appid || ''
  const name =
    manifest.name ||
    path.basename(root)
  const android = manifest['app-plus']?.distribute?.android || {}
  const packagename = android.packagename || android.package || ''
  const appkey =
    manifest['app-plus']?.distribute?.sdkConfigs?.dcloud?.appkey ||
    manifest['app-plus']?.distribute?.android?.dcloud_appkey ||
    ''
  return {
    id: appid || root,
    appid,
    name,
    path: root,
    manifestPath: path.resolve(manifestPath),
    packagename,
    appkey,
    versionName: manifest.versionName || '',
    versionCode: manifest.versionCode || ''
  }
}

function loadStore() {
  if (typeof utools !== 'undefined' && utools.dbStorage) {
    return utools.dbStorage.getItem(STORAGE_KEY) || defaultStore()
  }
  return defaultStore()
}

function saveStore(data) {
  if (typeof utools !== 'undefined' && utools.dbStorage) {
    utools.dbStorage.setItem(STORAGE_KEY, data)
  }
}

function defaultStore() {
  return {
    env: {
      hxCliPath: '',
      nodePath: '',
      javaPath: '',
      androidSdkPath: '',
      androidStudioPath: '',
      uniappOfflineSdkPath: ''
    },
    projects: []
  }
}

function normalizeEnv(env) {
  const base = { ...defaultStore().env, ...(env || {}) }
  if (!base.uniappOfflineSdkPath && base.androidSdkPath) {
    const p = base.androidSdkPath.replace(/\\/g, '/')
    if (/Android-SDK|uniapp|离线/i.test(p)) {
      base.uniappOfflineSdkPath = base.androidSdkPath
      base.androidSdkPath = ''
    }
  }
  return base
}

function scanDriveForHbuilderX(driveRoot, list) {
  try {
    const entries = fs.readdirSync(driveRoot, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (!/^HBuilderX/i.test(ent.name)) continue
      const base = path.join(driveRoot, ent.name)
      const candidates = [
        path.join(base, 'cli.exe'),
        path.join(base, 'HBuilderX', 'cli.exe'),
        path.join(base, 'bin', 'cli.exe')
      ]
      for (const c of candidates) {
        if (fs.existsSync(c)) list.push(c)
      }
    }
  } catch (_) {
    /* ignore permission errors */
  }
}

function detectHbuilderXCliCandidates() {
  const list = []
  if (process.platform === 'win32') {
    const fixedRoots = [
      process.env.HBUILDERX_HOME,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)']
    ].filter(Boolean)
    const rels = [
      'HBuilderX\\cli.exe',
      'HBuilderX\\HBuilderX\\cli.exe',
      '软件\\HBuilderX\\cli.exe',
      'Program Files\\HBuilderX\\cli.exe'
    ]
    for (const root of fixedRoots) {
      for (const rel of rels) {
        list.push(path.join(root, rel))
      }
    }
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${letter}:\\`
      try {
        if (!fs.existsSync(drive)) continue
      } catch (_) {
        continue
      }
      scanDriveForHbuilderX(drive, list)
    }
    const pathEnv = process.env.Path || process.env.PATH || ''
    for (const dir of pathEnv.split(';')) {
      const d = (dir || '').trim()
      if (!d) continue
      list.push(path.join(d, 'cli.exe'))
    }
  } else {
    list.push('/Applications/HBuilderX.app/Contents/MacOS/cli')
    list.push('/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli')
  }
  return [...new Set(list)]
}

function resolveCliExecutable(env, options = {}) {
  const configured = (env && env.hxCliPath) || ''
  if (configured) {
    if (fs.existsSync(configured)) return configured
    throw new Error(
      `Configured HBuilderX CLI not found: ${configured}. Please re-select cli.exe in Environment settings.`
    )
  }
  for (const candidate of detectHbuilderXCliCandidates()) {
    if (fs.existsSync(candidate)) {
      if (options.autoSave) {
        const store = loadStore()
        store.env.hxCliPath = candidate
        saveStore(store)
      }
      return candidate
    }
  }
  const hint = detectHbuilderXCliCandidates().slice(0, 3).join('\n  ')
  throw new Error(
    'HBuilderX cli.exe not found. Go to Environment tab -> Select -> choose cli.exe in your HBuilderX install folder (e.g. D:\\HBuilderX\\cli.exe), then Save.\n' +
      (hint ? `Tried:\n  ${hint}` : '')
  )
}

function createWinCliDecoders() {
  if (process.platform !== 'win32') return null
  try {
    const { TextDecoder } = require('util')
    return {
      out: new TextDecoder('gbk'),
      err: new TextDecoder('gbk')
    }
  } catch (_) {
    return null
  }
}

function decodeCliChunk(decoders, stream, buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (decoders) {
    const dec = stream === 'stderr' ? decoders.err : decoders.out
    try {
      return dec.decode(b, { stream: true })
    } catch (_) {
      /* fall through */
    }
  }
  return b.toString('utf8')
}

function flushCliDecoders(decoders) {
  if (!decoders) return ''
  try {
    return (decoders.out.decode() || '') + (decoders.err.decode() || '')
  } catch (_) {
    return ''
  }
}

function runCommand(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === 'win32' && !path.isAbsolute(exe)
    const decoders = createWinCliDecoders()
    const child = spawn(exe, args, {
      cwd: options.cwd,
      shell: useShell,
      windowsHide: true,
      env: { ...process.env, ...options.env }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (buf) => {
      const text = decodeCliChunk(decoders, 'stdout', buf)
      stdout += text
      if (options.onData) options.onData(text)
    })
    child.stderr.on('data', (buf) => {
      const text = decodeCliChunk(decoders, 'stderr', buf)
      stderr += text
      if (options.onData) options.onData(text)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const tail = flushCliDecoders(decoders)
      if (tail) {
        stdout += tail
        if (options.onData) options.onData(tail)
      }
      resolve({ code, stdout, stderr })
    })
  })
}

function detectUnpackageDir(projectPath) {
  const candidates = [
    path.join(projectPath, 'unpackage', 'resources'),
    path.join(projectPath, 'unpackage', 'dist', 'build', 'app-plus'),
    path.join(projectPath, 'unpackage', 'dist', 'build', 'app'),
    path.join(projectPath, 'dist', 'build', 'app-plus'),
    path.join(projectPath, 'unpackage', 'release')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return path.join(projectPath, 'unpackage')
}

function findAppResourceOutput(projectPath) {
  const resourcesDir = path.join(projectPath, 'unpackage', 'resources')
  if (!fs.existsSync(resourcesDir)) return detectUnpackageDir(projectPath)
  const entries = fs.readdirSync(resourcesDir, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.isDirectory() && ent.name.startsWith('__UNI__')) {
      const www = path.join(resourcesDir, ent.name, 'www')
      if (fs.existsSync(www)) return www
      return path.join(resourcesDir, ent.name)
    }
  }
  return resourcesDir
}

function mergeProjectConfig(store, projectId, patch) {
  const idx = store.projects.findIndex((p) => p.id === projectId)
  if (idx >= 0) {
    store.projects[idx] = { ...store.projects[idx], ...patch, updatedAt: Date.now() }
  }
  saveStore(store)
  return store.projects[idx]
}

function getPathFromFile(file) {
  if (!file) return ''
  try {
    const { webUtils } = require('electron')
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file)
    }
  } catch (_) {
    /* preload may not load electron in some builds */
  }
  return file.path || ''
}

function resolveManifestPath(targetPath) {
  const resolved = path.resolve(targetPath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path not found: ${resolved}`)
  }
  const stat = fs.statSync(resolved)
  if (stat.isFile()) {
    if (/manifest\.json$/i.test(resolved)) return resolved
    throw new Error('Please select manifest.json or a project folder')
  }
  const manifest = path.join(resolved, 'manifest.json')
  if (fs.existsSync(manifest)) return manifest
  throw new Error(`manifest.json not found in: ${resolved}`)
}

function addProjectFromManifest(manifestPath) {
  const realManifest = resolveManifestPath(manifestPath)
  const parsed = parseManifest(realManifest)
  const store = loadStore()
  const existing = store.projects.findIndex((p) => p.path === parsed.path)
  const saved =
    existing >= 0
      ? { ...store.projects[existing], ...parsed }
      : {
          ...parsed,
          androidSdkPath:
            store.env.uniappOfflineSdkPath || store.env.androidSdkPath || '',
          dcloudAppkey: parsed.appkey || '',
          certAlias: '',
          certFile: '',
          certPassword: '',
          storePassword: '',
          androidPackType: '0',
          channels: '',
          createdAt: Date.now()
        }
  if (existing >= 0) {
    store.projects[existing] = { ...saved, updatedAt: Date.now() }
  } else {
    store.projects.unshift(saved)
  }
  saveStore(store)
  return saved
}

function buildPackConfig(project, store) {
  return {
    project: project.path,
    platform: 'android',
    iscustom: false,
    safemode: false,
    android: {
      packagename: project.packagename || `uni.app.${(project.appid || '').replace(/__/g, '')}`,
      androidpacktype: String(project.androidPackType ?? '0'),
      certalias: project.certAlias || '',
      certfile: project.certFile || '',
      certpassword: project.certPassword || '',
      storePassword: project.storePassword || '',
      channels: project.channels || ''
    }
  }
}

function createServices() {
  return {
  ping() {
    return { ok: true, mode: exposeMode }
  },

  getStore() {
    const store = loadStore()
    store.env = normalizeEnv(store.env)
    return store
  },

  saveEnv(env) {
    const store = loadStore()
    store.env = normalizeEnv({ ...store.env, ...env })
    saveStore(store)
    return store.env
  },

  listProjects() {
    return loadStore().projects
  },

  resolveManifestPath(targetPath) {
    return resolveManifestPath(targetPath)
  },

  getPathFromFile(file) {
    return getPathFromFile(file)
  },

  importFromDroppedFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) {
      throw new Error('No files detected. Click to select manifest.json instead.')
    }
    for (const file of files) {
      const p = getPathFromFile(file)
      if (p) {
        return resolveManifestPath(p)
      }
    }
    throw new Error(
      'Cannot read dropped file path. Use click to select, or drag manifest.json into uTools search bar.'
    )
  },

  pickManifestFile() {
    if (typeof utools === 'undefined') return null
    const file = utools.showOpenDialog({
      title: '选择 manifest.json',
      filters: [{ name: 'manifest.json', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (file && file.length) return resolveManifestPath(file[0])
    return null
  },

  pickProjectFolder() {
    if (typeof utools === 'undefined') return null
    const dir = utools.showOpenDialog({
      title: '选择项目目录',
      properties: ['openDirectory']
    })
    if (dir && dir.length) return resolveManifestPath(dir[0])
    return null
  },

  addProjectByManifest(manifestPath) {
    return addProjectFromManifest(manifestPath)
  },

  removeProject(projectId) {
    const store = loadStore()
    store.projects = store.projects.filter((p) => p.id !== projectId)
    saveStore(store)
  },

  saveProject(projectId, patch) {
    const store = loadStore()
    return mergeProjectConfig(store, projectId, patch)
  },

  selectFile(filters) {
    if (typeof utools === 'undefined') return null
    const result = utools.showOpenDialog({
      title: '选择文件',
      filters: filters || [{ name: 'All', extensions: ['*'] }],
      properties: ['openFile']
    })
    return result && result.length ? result[0] : null
  },

  selectDirectory() {
    if (typeof utools === 'undefined') return null
    const result = utools.showOpenDialog({
      title: '选择目录',
      properties: ['openDirectory']
    })
    return result && result.length ? result[0] : null
  },

  pickHbuilderXInstallDir() {
    if (typeof utools === 'undefined') return null
    const picked = utools.showOpenDialog({
      title: '选择 HBuilderX 安装目录',
      properties: ['openDirectory']
    })
    if (!picked || !picked.length) return null
    const base = picked[0]
    const candidates = [
      path.join(base, 'cli.exe'),
      path.join(base, 'HBuilderX', 'cli.exe'),
      path.join(base, 'bin', 'cli.exe')
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
    throw new Error(`cli.exe not found under: ${base}`)
  },

  openPath(targetPath) {
    if (typeof utools !== 'undefined') {
      utools.shellOpenPath(targetPath)
      return true
    }
    return false
  },

  detectCliCandidates() {
    return detectHbuilderXCliCandidates().filter((p) => fs.existsSync(p))
  },

  async checkCli() {
    const store = loadStore()
    try {
      const exe = resolveCliExecutable(store.env, { autoSave: true })
      const result = await runCommand(exe, ['ver'])
      return {
        ok: result.code === 0,
        version: (result.stdout || result.stderr).trim(),
        exe,
        autoConfigured: !store.env.hxCliPath
      }
    } catch (err) {
      return { ok: false, error: err.message, exe: store.env.hxCliPath || '' }
    }
  },

  async openHbuilderX() {
    const store = loadStore()
    const exe = resolveCliExecutable(store.env)
    return runCommand(exe, ['open'])
  },

  async openProjectInHx(projectPath) {
    const store = loadStore()
    const exe = resolveCliExecutable(store.env)
    return runCommand(exe, ['project', 'open', '--path', projectPath])
  },

  async buildAppResources(projectPath, onLog) {
    const pkgPath = path.join(projectPath, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const scriptName = ['build:app', 'build:app-plus', 'build:app-android'].find(
        (key) => pkg.scripts && pkg.scripts[key]
      )
      if (scriptName) {
        onLog && onLog(`Using npm run ${scriptName}\n`)
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
        const result = await runCommand(npm, ['run', scriptName], {
          cwd: projectPath,
          onData: onLog
        })
        return {
          ...result,
          method: 'npm',
          outputDir: detectUnpackageDir(projectPath)
        }
      }
    }

    const store = loadStore()
    const exe = resolveCliExecutable(store.env, { autoSave: true })
    onLog &&
      onLog(
        'HBuilderX project detected (no package.json build script). Using CLI to publish app resources...\n'
      )
    onLog && onLog(`CLI: ${exe}\n`)
    onLog && onLog('Please ensure HBuilderX is running (Environment -> Start HBuilderX).\n\n')

    await runCommand(exe, ['project', 'open', '--path', projectPath], { onData: onLog })

    const publishArgs = [
      ['publish', '--platform', 'APP', '--type', 'appResource', '--project', projectPath],
      ['publish', 'app-android', '--type', 'appResource', '--project', projectPath],
      ['publish', 'app', '--type', 'appResource', '--project', projectPath]
    ]

    let lastResult = { code: 1, stdout: '', stderr: '' }
    for (const args of publishArgs) {
      onLog && onLog(`> "${exe}" ${args.join(' ')}\n`)
      lastResult = await runCommand(exe, args, { onData: onLog })
      if (lastResult.code === 0) {
        const outputDir = findAppResourceOutput(projectPath)
        onLog &&
          onLog(
            `\n[成功] App 资源已导出\n输出目录: ${outputDir}\n` +
              `（wgt/基座需与 HBuilderX、离线 SDK 版本一致，见 https://ask.dcloud.net.cn/article/35627 ）\n`
          )
        return {
          ...lastResult,
          method: 'hbuilderx',
          outputDir
        }
      }
    }

    throw new Error(
      (lastResult.stderr || lastResult.stdout || '').trim() ||
        'Failed to publish app resources. Check HBuilderX is open, project is imported, and CLI path is correct.'
    )
  },

  getOutputDir(projectPath) {
    return detectUnpackageDir(projectPath)
  },

  getNativeProjectDir(projectPath) {
    return offline.getNativeProjectDir(projectPath)
  },

  installHbuilderxDebugBase(projectId, onLog) {
    const store = loadStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Project not found')
    const { source, dest } = offline.installCustomDebugBase(project.path, 'debug')
    onLog &&
      onLog(`[OK] HBuilderX custom debug base installed\n  from: ${source}\n  to:   ${dest}\n`)
    return { source, dest }
  },

  openCustomDebugBaseDir(projectPath) {
    const dir = path.join(projectPath, 'unpackage', 'debug')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  },

  inspectOffline(projectId) {
    const store = loadStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Project not found')
    return offline.inspectOfflineProject(project, normalizeEnv(store.env))
  },

  async generateAndroidNativeProject(projectId, options, onLog) {
    const store = loadStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Project not found')
    const env = normalizeEnv(store.env)
    onLog && onLog('[1/1] Generate Android source project from offline SDK...\n')
    const result = offline.generateAndroidProject(project, env, {
      force: !!(options && options.force)
    })
    onLog &&
      onLog(
        `[OK] Native project: ${result.nativeRoot}\n` +
          `SDK: ${result.sdkRoot} (v${result.sdkVersion || '?'})\n` +
          (result.copiedFrom ? `Copied from: ${result.copiedFrom}\n` : 'Existing project; config updated.\n')
      )
    return result
  },

  async syncOfflineResources(projectId, onLog) {
    const store = loadStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Project not found')
    const env = normalizeEnv(store.env)

    onLog && onLog('[1/2] Compile / export app resources...\n')
    const build = await this.buildAppResources(project.path, onLog)
    if (build.code !== 0) {
      throw new Error('Failed to export app resources')
    }

    onLog && onLog('\n[2/2] Copy www into Android native project...\n')
    const sync = offline.syncResourcesToNative(project, env)
    onLog &&
      onLog(
        `[OK] www synced\n  from: ${sync.wwwSource}\n  to:   ${sync.wwwTarget}\n`
      )
    return { build, sync }
  },

  async offlineGradlePack(projectId, options, onLog) {
    const store = loadStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Project not found')
    const env = normalizeEnv(store.env)
    const buildType = options?.buildType === 'release' ? 'release' : 'debug'
    const nativeRoot = offline.getNativeProjectDir(project.path)

    if (!options?.skipSync) {
      onLog && onLog('[1/3] Sync app resources to native project...\n')
      await this.buildAppResources(project.path, onLog)
      const sync = offline.syncResourcesToNative(project, env)
      onLog && onLog(`[OK] www -> ${sync.wwwTarget}\n\n`)
    } else {
      onLog && onLog('[1/3] Skip resource sync (use existing www in native project)\n\n')
      offline.applyNativeConfig(nativeRoot, project, env)
    }

    const androidSdk = offline.resolveAndroidSdkPath(env)
    if (androidSdk && !store.env.androidSdkPath) {
      store.env.androidSdkPath = androidSdk
      saveStore(store)
    }

    const { gradlew, task, gradleEnv } = offline.runGradleAssemble(nativeRoot, buildType, env, onLog)
    onLog && onLog(`[2/3] Gradle ${task} (JAVA_HOME=${gradleEnv.JAVA_HOME})\n`)
    onLog && onLog(`> "${gradlew}" ${task}\n\n`)

    const result = await runCommand(gradlew, [task], {
      cwd: nativeRoot,
      env: gradleEnv,
      onData: onLog
    })

    const apkPath = offline.findApkOutput(nativeRoot, buildType)
    onLog &&
      onLog(
        `\n[3/3] Build finished (exit ${result.code})\n` +
          (apkPath ? `APK dir: ${apkPath}\n` : 'Check simpleDemo/build/outputs/apk/\n')
      )
    return { ...result, apkPath, nativeRoot, buildType }
  },

  async cloudPack(projectId, onLog) {
    const store = loadStore()
    const project = store.projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Project not found')

    const config = buildPackConfig(project, store)
    const configPath = path.join(
      os.tmpdir(),
      `uniapp-pack-${project.appid || Date.now()}.json`
    )
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    onLog && onLog(`Pack config: ${configPath}\n`)

    const exe = resolveCliExecutable(store.env, { autoSave: true })
    onLog && onLog(`CLI: ${exe}\n`)
    await runCommand(exe, ['project', 'open', '--path', project.path], { onData: onLog })
    const result = await runCommand(exe, ['pack', '--config', configPath], { onData: onLog })
    return { ...result, configPath }
  },

  writeManifestAppkey(project) {
    const manifestPath = project.manifestPath
    if (!fs.existsSync(manifestPath)) {
      throw new Error('manifest.json not found')
    }
    const raw = fs.readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(stripJsonComments(raw))
    if (!manifest['app-plus']) manifest['app-plus'] = {}
    if (!manifest['app-plus'].distribute) manifest['app-plus'].distribute = {}
    if (!manifest['app-plus'].distribute.sdkConfigs) {
      manifest['app-plus'].distribute.sdkConfigs = {}
    }
    if (!manifest['app-plus'].distribute.sdkConfigs.dcloud) {
      manifest['app-plus'].distribute.sdkConfigs.dcloud = {}
    }
    manifest['app-plus'].distribute.sdkConfigs.dcloud.appkey = project.dcloudAppkey || ''
    if (project.packagename) {
      if (!manifest['app-plus'].distribute.android) {
        manifest['app-plus'].distribute.android = {}
      }
      manifest['app-plus'].distribute.android.packagename = project.packagename
    }
    if (project.name) manifest.name = project.name
    writeJson(manifestPath, manifest)
    return true
  }
  }
}

function exposeServices(services) {
  /* uTools 官方方式：直接挂到 window（与页面共享） */
  window.services = services
  if (typeof globalThis !== 'undefined') globalThis.services = services

  let mode = 'window'
  try {
    const { contextBridge } = require('electron')
    if (contextBridge && typeof contextBridge.exposeInMainWorld === 'function') {
      contextBridge.exposeInMainWorld('services', services)
      mode = 'window+contextBridge'
    }
  } catch (bridgeErr) {
    console.log('[preload] contextBridge skip:', bridgeErr.message)
  }
  return mode
}

try {
  const services = createServices()
  exposeMode = exposeServices(services)
} catch (err) {
  console.error('[preload] init failed:', err)
  const fallback = {
    __initError: err.message,
    ping: () => ({ ok: false, error: err.message }),
    getStore: () => defaultStore(),
    listProjects: () => [],
    resolveManifestPath: () => {
      throw new Error('preload init failed: ' + err.message)
    }
  }
  exposeServices(fallback)
}
