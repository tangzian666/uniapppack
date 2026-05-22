# uni-app 打包助手（uTools）

个人轻量 uTools 插件：管理 uni-app 项目，Android 本地编译与 HBuilderX 云打包。

## 功能

- 拖入 / 选择 `manifest.json` 导入项目
- 保存 Android 配置（包名、appkey、离线 SDK 路径、证书）
- 本地：`npm run build:app` / `build:app-plus`（若项目支持）
- 云打包：调用 `cli pack --platform android`
- 环境：配置 `cli.exe` 路径、检测 CLI、启动 HBuilderX

## 开发

```bash
npm install
npm run dev
```

在 uTools 开发者工具中新建插件，开发模式指向 `dist/plugin.json`（需先 build）。

```bash
npm run build
```

将 `dist` 目录作为插件根目录加载。

**推荐导入路径（任选其一）：**

- `E:\打包工具\dist\plugin.json`（发布用）
- `E:\打包工具\plugin.json`（开发用，需先 `npm run build` 生成 dist）

勿导入 `public\plugin.json`，否则 preload 不会加载。

## 插件图标（logo）

支持 **PNG / JPG** 等常见格式：

1. 将图片放到 `public/logo.jpg`（或 `logo.png`）
2. 修改 `public/plugin.json` 中 `"logo"` 为对应文件名，例如：

   ```json
   "logo": "logo.jpg"
   ```

3. 执行 `npm run build`（会复制到 `dist/`）
4. 在 uTools 重新加载插件

若 `public/` 下已有自定义 logo，构建时**不会**再用脚本覆盖。

## 使用前准备

1. 安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)
2. 将 HBuilderX 安装目录下的 `cli.exe` 加入 PATH，或在插件「环境设置」中指定完整路径
3. 云打包前：运行「启动 HBuilderX」，并在 HBuilderX 中登录 DCloud 账号

## 说明

- 第一版仅 Android，不做 iOS / UTS / 原生模块
- 无 `package.json` 的纯 HBuilderX 项目，请先在 IDE 中发行 App 资源，再用本插件打开 `unpackage` 目录
- preload 必须是 `preload.js`（uTools 要求）；`dist/package.json` 声明 `"type":"commonjs"` 供 Electron 正确加载
- preload 需保持可读，勿压缩混淆（uTools 规范）
