const fs = require('fs')
const path = require('path')

function rimraf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
}

function copyDirFiltered(src, dest, options = {}) {
  const skipNames = new Set(options.skipNames || ['.gradle', 'build', '.idea', '.DS_Store'])
  const filter = (srcPath) => {
    const base = path.basename(srcPath)
    if (skipNames.has(base)) return false
    if (options.skipFile && options.skipFile(srcPath)) return false
    return true
  }
  fs.cpSync(src, dest, { recursive: true, filter })
}

function isValidAndroidSdkDir(dir) {
  if (!dir || !fs.existsSync(dir)) return false
  return (
    fs.existsSync(path.join(dir, 'platforms')) ||
    fs.existsSync(path.join(dir, 'build-tools')) ||
    fs.existsSync(path.join(dir, 'platform-tools'))
  )
}

/** Gradle / Android Studio 用的本机 Android SDK（不是 uni-app 离线 SDK 包） */
function resolveAndroidSdkPath(env) {
  const candidates = [
    env?.androidSdkPath,
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT
  ].filter(Boolean)
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local) candidates.push(path.join(local, 'Android', 'Sdk'))
  } else if (process.env.HOME) {
    candidates.push(path.join(process.env.HOME, 'Library', 'Android', 'sdk'))
    candidates.push(path.join(process.env.HOME, 'Android', 'Sdk'))
  }
  for (const p of candidates) {
    const resolved = path.resolve(p)
    if (isValidAndroidSdkDir(resolved)) return resolved
  }
  return ''
}

function resolveOfflineSdkRoot(env, project) {
  const candidates = [project?.androidSdkPath, env?.uniappOfflineSdkPath].filter(Boolean)
  for (const p of candidates) {
    const resolved = path.resolve(p)
    if (!fs.existsSync(resolved)) continue
    if (fs.existsSync(path.join(resolved, 'HBuilder-Integrate-AS'))) return resolved
    const parent = path.dirname(resolved)
    if (/Android-SDK@/i.test(path.basename(resolved))) return resolved
  }
  throw new Error(
    'uni-app offline SDK path not configured. Set it in Environment or Project config (Android-SDK folder containing HBuilder-Integrate-AS).'
  )
}

function findIntegrateTemplate(sdkRoot) {
  const integrate = path.join(sdkRoot, 'HBuilder-Integrate-AS')
  if (!fs.existsSync(integrate)) {
    throw new Error(`HBuilder-Integrate-AS not found under: ${sdkRoot}`)
  }
  const gradlew = path.join(integrate, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  if (!fs.existsSync(gradlew)) {
    throw new Error(`Gradle wrapper missing in: ${integrate}`)
  }
  return integrate
}

function getNativeProjectDir(projectPath) {
  return path.join(projectPath, 'native', 'android')
}

function getSimpleDemoDir(nativeRoot) {
  return path.join(nativeRoot, 'simpleDemo')
}

function resolveJavaHome(javaPath) {
  if (!javaPath) return ''
  const resolved = path.resolve(javaPath)
  if (path.basename(resolved).toLowerCase() === 'bin') return path.dirname(resolved)
  return resolved
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeGradleString(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function readAppResourceWww(projectPath, appid) {
  const resourcesDir = path.join(projectPath, 'unpackage', 'resources')
  if (!fs.existsSync(resourcesDir)) return ''
  const id = appid || ''
  if (id) {
    const www = path.join(resourcesDir, id, 'www')
    if (fs.existsSync(www)) return www
  }
  const entries = fs.readdirSync(resourcesDir, { withFileTypes: true })
  for (const ent of entries) {
    if (!ent.isDirectory() || !ent.name.startsWith('__UNI__')) continue
    const www = path.join(resourcesDir, ent.name, 'www')
    if (fs.existsSync(www)) return www
  }
  return ''
}

function parseSdkVersionLabel(sdkRoot) {
  const m = path.basename(sdkRoot).match(/Android-SDK@([\d.]+)/i)
  return m ? m[1] : ''
}

function inspectOfflineProject(project, env) {
  const projectPath = project.path
  const nativeRoot = getNativeProjectDir(projectPath)
  const wwwDir = readAppResourceWww(projectPath, project.appid)
  const androidSdkPath = resolveAndroidSdkPath(env)
  let sdkRoot = ''
  let sdkVersion = ''
  let templatePath = ''
  let sdkError = ''
  try {
    sdkRoot = resolveOfflineSdkRoot(env, project)
    sdkVersion = parseSdkVersionLabel(sdkRoot)
    templatePath = findIntegrateTemplate(sdkRoot)
  } catch (e) {
    sdkError = e.message
  }
  const gradlew = path.join(
    nativeRoot,
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  )
  return {
    appResources: {
      ok: !!wwwDir,
      path: wwwDir,
      hint: wwwDir ? '' : 'Run "Sync app resources" or compile app resources first'
    },
    nativeProject: {
      ok: fs.existsSync(gradlew),
      path: nativeRoot,
      hint: fs.existsSync(gradlew) ? '' : 'Generate Android source project first'
    },
    offlineSdk: {
      ok: !!templatePath,
      path: sdkRoot,
      version: sdkVersion,
      templatePath,
      error: sdkError
    },
    androidSdk: {
      ok: !!androidSdkPath,
      path: androidSdkPath,
      hint: androidSdkPath
        ? ''
        : 'Configure Android SDK in Environment (e.g. C:\\Users\\...\\AppData\\Local\\Android\\Sdk), not the uni-app offline SDK zip folder.'
    },
    releaseApk: {
      ok: fs.existsSync(getReleaseApkPublishPath(projectPath)),
      path: getReleaseApkPublishPath(projectPath)
    },
    signing: {
      ok: !!(project.certFile && project.certAlias && project.certPassword),
      hint:
        project.certFile && project.certAlias && project.certPassword
          ? ''
          : 'Release build needs keystore, alias and password in Project config'
    }
  }
}

function writeLocalProperties(nativeRoot, androidSdkPath) {
  if (!androidSdkPath) return
  const sdkDir = androidSdkPath.replace(/\\/g, '/')
  const content = `sdk.dir=${sdkDir}\n`
  fs.writeFileSync(path.join(nativeRoot, 'local.properties'), content, 'utf8')
}

/** 项目路径含中文时 Android Gradle 插件会拒绝构建，需显式放开 */
function ensureGradleProperties(nativeRoot) {
  const file = path.join(nativeRoot, 'gradle.properties')
  const line = 'android.overridePathCheck=true'
  let content = ''
  if (fs.existsSync(file)) {
    content = fs.readFileSync(file, 'utf8')
    if (/android\.overridePathCheck\s*=/m.test(content)) return
    if (!content.endsWith('\n')) content += '\n'
    content += `\n# Allow non-ASCII project paths on Windows (e.g. Chinese folder names)\n${line}\n`
  } else {
    content = `${line}\n`
  }
  fs.writeFileSync(file, content, 'utf8')
}

function patchDcloudControl(nativeRoot, appid) {
  const file = path.join(nativeRoot, 'simpleDemo', 'src', 'main', 'assets', 'data', 'dcloud_control.xml')
  if (!fs.existsSync(file)) throw new Error(`dcloud_control.xml not found: ${file}`)
  let xml = fs.readFileSync(file, 'utf8')
  if (/appid="[^"]*"/.test(xml)) {
    xml = xml.replace(/appid="[^"]*"/, `appid="${escapeXml(appid)}"`)
  } else {
    xml = xml.replace(
      /<app\s+/,
      `<app appid="${escapeXml(appid)}" `
    )
  }
  fs.writeFileSync(file, xml, 'utf8')
}

function normalizeAppkey(value) {
  return String(value || '').trim().replace(/\s+/g, '')
}

function patchAndroidManifest(nativeRoot, appkey) {
  const file = path.join(nativeRoot, 'simpleDemo', 'src', 'main', 'AndroidManifest.xml')
  if (!fs.existsSync(file)) return
  const key = normalizeAppkey(appkey)
  let xml = fs.readFileSync(file, 'utf8')
  if (key) {
    xml = xml.replace(
      /android:name="dcloud_appkey"[^>]*android:value="[^"]*"/,
      `android:name="dcloud_appkey" android:value="${escapeXml(key)}"`
    )
  }
  fs.writeFileSync(file, xml, 'utf8')
}

function patchStringsXml(nativeRoot, appName) {
  const file = path.join(nativeRoot, 'simpleDemo', 'src', 'main', 'res', 'values', 'strings.xml')
  if (!fs.existsSync(file) || !appName) return
  let xml = fs.readFileSync(file, 'utf8')
  xml = xml.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${escapeXml(appName)}</string>`)
  fs.writeFileSync(file, xml, 'utf8')
}

function patchBuildGradle(nativeRoot, project) {
  const file = path.join(nativeRoot, 'simpleDemo', 'build.gradle')
  if (!fs.existsSync(file)) throw new Error(`build.gradle not found: ${file}`)
  let gradle = fs.readFileSync(file, 'utf8')
  const appId = project.packagename || `uni.app.${(project.appid || '').replace(/__/g, '')}`
  gradle = gradle.replace(/applicationId\s+"[^"]*"/, `applicationId "${appId}"`)
  if (/namespace\s+/.test(gradle)) {
    gradle = gradle.replace(/namespace\s+'[^']*'/, `namespace '${appId}'`)
  }

  const simpleDemoDir = getSimpleDemoDir(nativeRoot)
  let storeFileName = 'test.jks'
  let keyAlias = project.certAlias || 'key0'
  let certPassword = project.certPassword || '123456'
  let storePassword = project.storePassword || project.certPassword || certPassword

  if (project.certFile && fs.existsSync(project.certFile)) {
    storeFileName = path.basename(project.certFile)
    fs.copyFileSync(project.certFile, path.join(simpleDemoDir, storeFileName))
    keyAlias = project.certAlias || keyAlias
  }

  const signingBlock = `    signingConfigs {
        config {
            keyAlias '${escapeGradleString(keyAlias)}'
            keyPassword '${escapeGradleString(certPassword)}'
            storeFile file('${storeFileName.replace(/'/g, "\\'")}')
            storePassword '${escapeGradleString(storePassword)}'
            v1SigningEnabled true
            v2SigningEnabled true
        }
    }`

  if (/signingConfigs\s*\{/.test(gradle)) {
    gradle = gradle.replace(/signingConfigs\s*\{[\s\S]*?\n    \}/, signingBlock)
  }

  if (project.versionCode) {
    const code = String(project.versionCode).replace(/\D/g, '') || '1'
    if (/versionCode\s+/.test(gradle)) {
      gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`)
    }
  }
  if (project.versionName) {
    const ver = escapeGradleString(project.versionName)
    if (/versionName\s+/.test(gradle)) {
      gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${ver}"`)
    }
  }

  fs.writeFileSync(file, gradle, 'utf8')
}

function validateReleaseSigning(project) {
  const missing = []
  if (!project.certFile || !fs.existsSync(project.certFile)) missing.push('keystore (.jks/.keystore)')
  if (!project.certAlias) missing.push('certificate alias')
  if (!project.certPassword) missing.push('certificate password')
  if (missing.length) {
    throw new Error(
      `Release build requires signing config in Project settings: ${missing.join(', ')}. Debug builds can use the template test certificate.`
    )
  }
}

function getReleaseApkPublishPath(projectPath) {
  return path.join(projectPath, 'unpackage', 'release', 'android_release.apk')
}

function publishReleaseApk(projectPath, apkSource) {
  if (!apkSource || !fs.existsSync(apkSource)) return null
  const dest = getReleaseApkPublishPath(projectPath)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(apkSource, dest)
  return dest
}

function getApkOutputDir(nativeRoot, buildType) {
  const variant = buildType === 'release' ? 'release' : 'debug'
  return path.join(nativeRoot, 'simpleDemo', 'build', 'outputs', 'apk', variant)
}

function syncWwwToNative(nativeRoot, wwwDir, appid) {
  const appsDir = path.join(nativeRoot, 'simpleDemo', 'src', 'main', 'assets', 'apps')
  fs.mkdirSync(appsDir, { recursive: true })
  const targetAppDir = path.join(appsDir, appid)
  const targetWww = path.join(targetAppDir, 'www')
  rimraf(targetAppDir)
  fs.mkdirSync(targetWww, { recursive: true })
  copyDirFiltered(wwwDir, targetWww, { skipNames: ['.DS_Store'] })
  const entries = fs.readdirSync(appsDir, { withFileTypes: true })
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (ent.name === appid) continue
    if (ent.name.startsWith('__UNI__') || ent.name === '__UNI__A') {
      rimraf(path.join(appsDir, ent.name))
    }
  }
  return targetWww
}

function applyNativeConfig(nativeRoot, project, env) {
  if (!project.appid) throw new Error('AppID is empty; import manifest.json first')
  patchDcloudControl(nativeRoot, project.appid)
  patchAndroidManifest(nativeRoot, project.dcloudAppkey || project.appkey)
  patchStringsXml(nativeRoot, project.name || '')
  patchBuildGradle(nativeRoot, project)
  writeLocalProperties(nativeRoot, resolveAndroidSdkPath(env) || '')
  ensureGradleProperties(nativeRoot)
}

function generateAndroidProject(project, env, options = {}) {
  const sdkRoot = resolveOfflineSdkRoot(env, project)
  const template = findIntegrateTemplate(sdkRoot)
  const nativeRoot = getNativeProjectDir(project.path)
  const force = !!options.force

  if (fs.existsSync(nativeRoot)) {
    if (!force) {
      applyNativeConfig(nativeRoot, project, env)
      return {
        nativeRoot,
        sdkRoot,
        sdkVersion: parseSdkVersionLabel(sdkRoot),
        updated: false
      }
    }
    rimraf(nativeRoot)
  }

  fs.mkdirSync(path.dirname(nativeRoot), { recursive: true })
  copyDirFiltered(template, nativeRoot, {
    skipNames: ['.gradle', 'build', '.idea', '.DS_Store']
  })
  applyNativeConfig(nativeRoot, project, env)
  return {
    nativeRoot,
    sdkRoot,
    sdkVersion: parseSdkVersionLabel(sdkRoot),
    updated: true,
    copiedFrom: template
  }
}

function syncResourcesToNative(project, env) {
  const nativeRoot = getNativeProjectDir(project.path)
  const gradlew = path.join(nativeRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  if (!fs.existsSync(gradlew)) {
    throw new Error('Android native project not found. Generate Android source project first.')
  }
  const wwwDir = readAppResourceWww(project.path, project.appid)
  if (!wwwDir) {
    throw new Error(
      'App resources (www) not found. Run "Sync app resources" to compile and export unpackage/resources first.'
    )
  }
  const targetWww = syncWwwToNative(nativeRoot, wwwDir, project.appid)
  applyNativeConfig(nativeRoot, project, env)
  return { nativeRoot, wwwSource: wwwDir, wwwTarget: targetWww }
}

function getCustomDebugBasePath(projectPath) {
  return path.join(projectPath, 'unpackage', 'debug', 'android_debug.apk')
}

function installCustomDebugBase(projectPath, buildType = 'debug') {
  const nativeRoot = getNativeProjectDir(projectPath)
  const apk = findApkOutput(nativeRoot, buildType)
  if (!apk || !fs.existsSync(apk)) {
    throw new Error(
      `Debug APK not found. Run offline pack (assembleDebug) first. Expected under simpleDemo/build/outputs/apk/debug/`
    )
  }
  const dest = getCustomDebugBasePath(projectPath)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(apk, dest)
  return { source: apk, dest }
}

function findApkOutput(nativeRoot, buildType) {
  const variant = buildType === 'release' ? 'release' : 'debug'
  const base = path.join(nativeRoot, 'simpleDemo', 'build', 'outputs', 'apk', variant)
  if (!fs.existsSync(base)) return ''
  const files = []
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.name.endsWith('.apk')) files.push(full)
    }
  }
  walk(base)
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return files[0] || base
}

function runGradleAssemble(nativeRoot, buildType, env, onLog) {
  const gradlew = path.join(nativeRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  if (!fs.existsSync(gradlew)) {
    throw new Error('gradlew not found. Generate Android source project first.')
  }
  const androidSdkPath = resolveAndroidSdkPath(env)
  if (!androidSdkPath) {
    throw new Error(
      'Android SDK not found for Gradle. In Environment settings, set "Android SDK" to your local SDK folder (e.g. C:\\Users\\Administrator\\AppData\\Local\\Android\\Sdk). This is NOT the uni-app offline SDK (Android-SDK@4.87) zip.'
    )
  }
  const javaHome = resolveJavaHome(env.javaPath)
  if (!javaHome) {
    throw new Error('Java path not configured (JDK 17+ required) in Environment settings.')
  }
  if (!env.androidSdkPath && onLog) {
    onLog(`[auto] Android SDK: ${androidSdkPath}\n`)
  }

  writeLocalProperties(nativeRoot, androidSdkPath)
  const task = buildType === 'release' ? 'assembleRelease' : 'assembleDebug'
  const gradleEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidSdkPath,
    ANDROID_SDK_ROOT: androidSdkPath
  }
  const javaBin = path.join(javaHome, 'bin')
  if (!gradleEnv.Path?.includes(javaBin)) {
    gradleEnv.Path = `${javaBin};${gradleEnv.Path || ''}`
  }

  return { gradlew, task, gradleEnv, apkDir: findApkOutput(nativeRoot, buildType) }
}

module.exports = {
  getNativeProjectDir,
  inspectOfflineProject,
  generateAndroidProject,
  syncResourcesToNative,
  applyNativeConfig,
  readAppResourceWww,
  runGradleAssemble,
  findApkOutput,
  resolveOfflineSdkRoot,
  resolveAndroidSdkPath,
  isValidAndroidSdkDir,
  getCustomDebugBasePath,
  installCustomDebugBase,
  validateReleaseSigning,
  publishReleaseApk,
  getReleaseApkPublishPath,
  getApkOutputDir
}
