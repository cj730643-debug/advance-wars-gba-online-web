# 高级战争 GBA 联机 · 网页版 α 0.4
真实 mGBA libretro 核心编译为 WebAssembly，运行在专用 Worker。支持本地 ROM、Canvas 视频、Web Audio、键盘/触控、电池存档与 2–4 人 WSS 中继适配。单人模式下普通核心诊断日志不再误判为联机同步失败；真正的核心停止仍会显示诊断提示。没有商业 ROM 或 BIOS。

## 构建
上游 https://github.com/Aelvryx/mgba-wifi-link commit `9e919b0cfbb93af7d1171570dfc6745d00eeebab`，修改后完整源码在网页「对应源码」中。
安装 Emscripten 3.1.74、Python 3、CMake >=3.21、Ninja、Node >=22。
```
python scripts/build_core.py --emsdk /absolute/path/emsdk --source vendor/mgba-wifi-link
npm ci --prefix relay --ignore-scripts --no-audit --no-fund
python scripts/prepare.py
node tests/core-smoke.mjs
node tests/worker-smoke.mjs
node tests/core-group-smoke.mjs
node tests/worker-group-smoke.mjs
node tests/group-failure-smoke.mjs
npm test --prefix relay
NODE_USE_ENV_PROXY=1 RELAY_URL=https://aw-relay-production.up.railway.app node tests/worker-smoke.mjs
python scripts/prepare.py
python scripts/validate.py
```
下载源码压缩包包含完整 vendor。GitHub checkout 通过 dist/source.zip 提供相同源码；首次构建先解压其中 vendor 至项目。

## 使用
打开 HTTPS 网页，选择版本和合法 `.gba`，点击单人开始，Enter 打开标题菜单，Z 确认、X 返回。**单人摸鱼模式支持切换标签页或最小化后继续运行，不会自动暂停；手动暂停按钮仍有效。** 页面下方提供鼠标虚拟手柄：按住方向键移动，点击 A/B/开始/选择/L/R；这是鼠标操控 GBA 按键，并非直接点击战场格子。 后台速度取决于浏览器调度，电脑休眠时模拟也会停止。
全员选择相同的对局人数（2、3 或 4）、同一网页及完全相同 ROM。房主创建房间，分享房间码；其他玩家依次加入，满员并显示「联机游戏中」后，进入游戏内对应人数的 Multi-Pak 流程。每人控制独立军队。3–4 人为核心测试版，两代商业游戏完整对局未验证。联机期间可切换标签页或最小化，页面不会主动结束会话；客户端与 Relay 心跳容错为 5 分钟，多人同步等待也延长，并扩大后台接收缓冲。浏览器仍可能限制后台 Worker，系统长时间休眠、断网、队列积压或状态校验失败仍可能结束对局。当前不支持断线无缝重连，真正断线后需重建房间。网页与 Windows 版构建哈希不同，不能混用。
电池存档按 ROM SHA-256 与 solo/p0/p1/p2/p3 分槽，IndexedDB 存储。请定期导出。联机存档在核心停止并恢复本地逻辑玩家最后验证检查点后写出。多人模式全员每 60 帧比较各逻辑机器的完整状态摘要，校验失败、断线、卡住都结束会话；不提供自动重连。网页不提供任意即时存档。

## 验证范围
详见 TEST_REPORT.txt。CC0 自制测试 ROM 只能证明适配链路；商业游戏完整对局及两台异地 Windows 浏览器仍未验证，不是正式版。

## Vercel
已包含 vercel.json，选择 Other 框架，输出 dist。构建仅验证既有真实 WASM 并复制最新网页源码；修改模拟器后仍需完整原生编译与测试。WebSocket Relay 继续部署 Railway，不能作为无状态函数替代。详见 docs/VERCEL_DEPLOYMENT.md。

完整对应源码归档为避免上传请求大小限制，分块保存在 source-archive。执行 `node scripts/vercel-build.mjs` 会校验并重建 dist/source.zip，网页下载仍是标准 ZIP。重新生成源码 ZIP 后执行 `node scripts/split-source.mjs` 更新分块。

## 多人核心
见 [docs/GROUP_PROTOCOL.md](docs/GROUP_PROTOCOL.md) 和 [docs/FOUR_PLAYER_REPORT.md](docs/FOUR_PLAYER_REPORT.md)。原双人协议保留；3–4 人使用独立 group 协议、N 机复制执行和 N 路输入环形缓冲。未修改原版游戏 ROM。每个客户端运行全体逻辑机器，只显示和保存自己的逻辑玩家；对电脑性能要求随人数增加。
