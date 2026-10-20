# 高级战争 GBA 联机 · 网页版 α 0.3
真实 mGBA libretro 核心编译为 WebAssembly，运行在专用 Worker。支持本地 ROM、Canvas 视频、Web Audio、键盘/触控、电池存档与双人 WSS 中继适配。没有商业 ROM 或 BIOS。

## 构建
上游 https://github.com/Aelvryx/mgba-wifi-link commit `9e919b0cfbb93af7d1171570dfc6745d00eeebab`，修改后完整源码在网页「对应源码」中。
安装 Emscripten 3.1.74、Python 3、CMake >=3.21、Ninja、Node >=22。
```
python scripts/build_core.py --emsdk /absolute/path/emsdk --source vendor/mgba-wifi-link
npm ci --prefix relay --ignore-scripts --no-audit --no-fund
python scripts/prepare.py
node tests/core-smoke.mjs
node tests/worker-smoke.mjs
npm test --prefix relay
NODE_USE_ENV_PROXY=1 RELAY_URL=https://aw-relay-production.up.railway.app node tests/worker-smoke.mjs
python scripts/prepare.py
python scripts/validate.py
```
下载源码压缩包包含完整 vendor。Sites Git checkout 通过 dist/source.zip 提供相同源码；首次构建先解压其中 vendor 至项目。

## 使用
打开 HTTPS 网页，选择版本和合法 `.gba`，点击单人开始，Enter 打开标题菜单，Z 确认、X 返回。
联机两边使用同一网页及完全相同 ROM：创建房间、复制房间码、另一边加入；等待「联机游戏中」，在游戏中进入双人 Multi-Pak 流程。保持页面前台。断线安全结束，无无缝恢复。网页与 Windows 版构建哈希不同，不能混用。
电池存档按 ROM SHA-256 与 solo/p0/p1 分槽，IndexedDB 存储。请定期导出。联机存档在核心停止并恢复本地逻辑玩家状态后写出。网页不提供任意即时存档。

## 验证范围
详见 TEST_REPORT.txt。CC0 自制测试 ROM 只能证明适配链路；商业游戏完整对局及两台异地 Windows 浏览器仍未验证，不是正式版。

## Vercel
已包含 vercel.json，选择 Other 框架，输出 dist。构建仅验证既有真实 WASM 并复制最新网页源码；修改模拟器后仍需完整原生编译与测试。WebSocket Relay 继续部署 Railway，不能作为无状态函数替代。详见 docs/VERCEL_DEPLOYMENT.md。

完整对应源码归档为避免上传请求大小限制，分块保存在 source-archive。执行 `node scripts/vercel-build.mjs` 会校验并重建 dist/source.zip，网页下载仍是标准 ZIP。重新生成源码 ZIP 后执行 `node scripts/split-source.mjs` 更新分块。
