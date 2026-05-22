const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

function resolveJavaHome(javaPath) {
  if (!javaPath) return ''
  const resolved = path.resolve(javaPath)
  if (path.basename(resolved).toLowerCase() === 'bin') return path.dirname(resolved)
  return resolved
}

function resolveKeytoolPath(env) {
  const home = resolveJavaHome(env?.javaPath || '')
  const name = process.platform === 'win32' ? 'keytool.exe' : 'keytool'
  if (home) {
    const p = path.join(home, 'bin', name)
    if (fs.existsSync(p)) return p
  }
  return name
}

function runKeytool(keytool, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(keytool, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => {
      stdout += b.toString()
    })
    child.stderr.on('data', (b) => {
      stderr += b.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, text: (stdout || '') + (stderr || '') })
    })
  })
}

function parseAliasesFromKeytoolOutput(text) {
  const aliases = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*Alias name:\s*(.+)\s*$/i)
    if (m) aliases.push(m[1].trim())
  }
  return [...new Set(aliases)]
}

function detectStoreType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.p12' || ext === '.pfx') return 'PKCS12'
  return 'JKS'
}

async function tryListAliases(keytool, keystorePath, storePassword, storeType) {
  const args = ['-list', '-keystore', keystorePath, '-storetype', storeType, '-storepass', storePassword]
  const result = await runKeytool(keytool, args)
  if (result.code !== 0) {
    return { ok: false, aliases: [], raw: result.text || '' }
  }
  return { ok: true, aliases: parseAliasesFromKeytoolOutput(result.text), raw: result.text }
}

/** 仅用用户已填写的库密码/证书密码打开 keystore，解析别名（不读取任何外部密码文件） */
async function inspectKeystore(keystorePath, env, options = {}) {
  if (!keystorePath || !fs.existsSync(keystorePath)) {
    throw new Error('Keystore file not found')
  }
  const ext = path.extname(keystorePath).toLowerCase()
  if (!['.keystore', '.jks', '.p12', '.pfx'].includes(ext)) {
    throw new Error('Unsupported cert file type. Use .keystore, .jks, .p12 or .pfx')
  }

  const storePass = (options.storePassword || options.certPassword || '').trim()
  if (!storePass) {
    return {
      ok: false,
      aliases: [],
      alias: '',
      storeType: detectStoreType(keystorePath),
      message: '请先填写库密码（或证书密码），再读取别名'
    }
  }

  const keytool = resolveKeytoolPath(env)
  const storeType = detectStoreType(keystorePath)
  const r = await tryListAliases(keytool, keystorePath, storePass, storeType)
  if (r.ok && r.aliases.length) {
    return {
      ok: true,
      aliases: r.aliases,
      alias: r.aliases[0],
      storeType,
      message:
        r.aliases.length === 1
          ? `已识别别名：${r.aliases[0]}`
          : `共 ${r.aliases.length} 个别名，已填入：${r.aliases[0]}（${r.aliases.join('、')}）`
    }
  }

  return {
    ok: false,
    aliases: [],
    alias: '',
    storeType,
    message: '无法读取别名，请确认库密码是否正确'
  }
}

function isKeystoreFile(filePath) {
  if (!filePath) return false
  return /\.(keystore|jks|p12|pfx)$/i.test(filePath)
}

module.exports = {
  inspectKeystore,
  isKeystoreFile,
  resolveKeytoolPath
}
