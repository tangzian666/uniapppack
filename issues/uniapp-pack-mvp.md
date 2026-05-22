# uni-app Android 打包助手（uTools）

> iOS 基座 / 正式包规划见：[ios-pack-roadmap.md](./ios-pack-roadmap.md)

## 与参考插件「uniapp应用开发工具」配置对照

| 参考插件配置 | 本插件 | 状态 |
|-------------|--------|------|
| HBuilderX cli 路径 | 环境设置 → cli 路径 | ✅ |
| Node 路径 | 环境设置 → node 路径 | ✅ |
| Java (jdk17+) | 环境设置 → Java | ✅ 已录路径，Gradle 打包待做 |
| Android SDK | 环境设置 → Android SDK | ✅ |
| Android Studio | 环境设置 → Android Studio | ✅ 已录路径，一键打开待做 |
| uni-app 离线 SDK | 环境设置 + 项目配置 | ✅ |
| 应用名 / 包名 / 签名 | 项目配置 | ✅ |
| 同步 app 资源 | 本地打包 → 编译 App 资源 | ✅ |
| 云打包 APK | 云打包 | ✅ |
| 项目检查（资源/工程版本） | 本地打包 → 项目检查 | ✅ |
| 生成/更新 Android 源码工程 | 生成 / 从 SDK 更新 | ✅ |
| debug/release + 同步资源 + Gradle | 打包操作 | ✅ |
| CPU 类型 / min·compile·target SDK | — | ⏳ 二期 |
| 渠道包多选 | 项目配置 → 渠道包 | ✅ 云打包用 |

## 当前可用流程

### 云打包（已可用）
1. 环境：配置 `cli.exe` → 检测 → 启动 HBuilderX
2. 项目：包名、证书（keystore/别名/密码）
3. 云打包 → 开始云打包

### 本地资源（已可用）
1. 同上环境
2. 本地打包 → 编译 App 资源 → 输出在 `unpackage/resources`

### 本地离线 APK（已可用）
1. 环境：Java、Android SDK、uni-app 离线 SDK（含 HBuilder-Integrate-AS）
2. 本地打包 → **生成 Android 工程**（输出到 `项目/native/android`）
3. **同步 app 资源**（CLI 编译 + 拷贝 www 到原生工程）
4. **打调试包** → `apk/debug/simpleDemo-debug.apk`；**打正式包** → `apk/release/` + 副本 `unpackage/release/android_release.apk`
5. 正式包需在项目配置填写 keystore / 别名 / 密码

## 你机器上的推荐路径（来自参考工具截图）

```
HBuilderX CLI: D:\HBuilderX.4.29.2024093009\HBuilderX\cli.exe
Node:          C:\nvm\v20.19.2\node.exe
Java:          C:\Program Files\Java\jdk-17.0.1\bin
Android SDK:   C:\Users\Administrator\AppData\Local\Android\Sdk
```
