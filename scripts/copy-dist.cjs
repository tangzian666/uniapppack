const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist')

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

const publicDir = path.join(root, 'public')
const preloadDir = path.join(root, 'preload')

copyFile(path.join(publicDir, 'plugin.json'), path.join(dist, 'plugin.json'))

const pluginJson = JSON.parse(fs.readFileSync(path.join(publicDir, 'plugin.json'), 'utf8'))
const logoCandidates = [
  pluginJson.logo,
  'logo.png',
  'logo.jpg',
  'logo.jpeg',
  'logo.webp'
].filter(Boolean)
const logoName = logoCandidates.find((name) => fs.existsSync(path.join(publicDir, name)))
if (!logoName) {
  throw new Error(
    `Logo file not found in public/. Set "logo" in plugin.json to logo.jpg or logo.png`
  )
}
if (pluginJson.logo !== logoName) {
  pluginJson.logo = logoName
  fs.writeFileSync(
    path.join(publicDir, 'plugin.json'),
    JSON.stringify(pluginJson, null, 2) + '\n',
    'utf8'
  )
}
copyFile(path.join(publicDir, logoName), path.join(dist, logoName))
for (const name of fs.readdirSync(preloadDir)) {
  if (name.endsWith('.js')) {
    copyFile(path.join(preloadDir, name), path.join(dist, name))
  }
}
if (!fs.existsSync(path.join(dist, 'keystore-util.js'))) {
  throw new Error('preload copy failed: keystore-util.js missing')
}

fs.writeFileSync(
  path.join(dist, 'package.json'),
  JSON.stringify({ type: 'commonjs', private: true }, null, 2)
)

for (const old of [path.join(dist, 'preload.cjs'), path.join(publicDir, 'preload.cjs')]) {
  if (fs.existsSync(old)) fs.unlinkSync(old)
}

// uTools 使用 file:// 加载，crossorigin 会导致 app.js / css 加载失败（白屏）
const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>uni-app 打包助手</title>
    <link rel="stylesheet" href="./assets/app.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="./assets/app.js"></script>
  </body>
</html>
`
fs.writeFileSync(path.join(dist, 'index.html'), indexHtml, 'utf8')

console.log('dist ready:', dist)
console.log('>>> 请在 uTools 导入:', path.join(dist, 'plugin.json'))
