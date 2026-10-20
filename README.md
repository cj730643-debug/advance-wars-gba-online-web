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


## Web α 0.5：统一 2–4 人同步

网页端所有联机人数统一使用 aw-relay-group-1 的快照交换、8 帧输入缓冲和每 60 帧状态共识。双人网页不再走旧版 protocol-v2 时长校准，避免后台计时延迟触发 calibration duration invalid。原双人核心保留供底层回归，不作为网页联机入口。所有玩家需要关闭旧页面、刷新相同网址并重建房间；旧房间不可沿用。诊断日志包含构建 ID、实际 WASM 哈希、配置哈希和人数。

回归命令：`node tests/worker-group-smoke.mjs` 覆盖 2、3、4 人；设置 `STALL_PEER_MS=2200` 会在房主握手和进入游戏时各冻结真实 Worker 2.2 秒，再验证恢复运行与状态共识。该注入不等同于 Windows 浏览器休眠实测。商业 ROM 完整对局仍未验证。


## Web α 0.5.1：联机性能优化

取消默认每帧全机状态诊断 trace（可用 AW_GROUP_FRAME_TRACE 重新开启），保留每 60 帧完整状态共识；收包改为事件唤醒，取消后台人为 250 ms 轮询等待。界面显示 FPS、模拟 ms/帧和等包 ms/帧。FPS 偏低时，模拟耗时高表示客户端计算较慢，等包耗时高表示同步链路等待较多；这些为当前端测量，不能代替全员诊断。

同一 CI Runner、CC0 诊断 ROM、每组 360 帧：双人模拟耗时 6.34 → 1.87 ms/帧；四人 12.15 → 3.29 ms/帧。真实 Chrome 与公网 Worker 对端完成同步，页面观测 58.4 FPS、模拟 2.5 ms/帧、等包 1.1 ms/帧；该单次读数不是商业 ROM 或所有设备的帧率保证。公网 2/3/4 人和状态错误注入检查通过。

## Web α 0.6：本地续玩与接近满速的联机

- 同一浏览器、同一网址保留上次选择的 ROM 和设置，文件仅存本地 IndexedDB，不上传服务器；旧 `aw-web-1:<ROM hash>:<slot>` 电池存档键保持不变。
- 单人约每 2 秒保存即时状态和对应电池存档。刷新后选择“继续单人游戏”；“从游戏内存档启动”忽略即时现场，从游戏标题/读档菜单开始。异常关闭或浏览器冻结可能丢失最近几秒；清除网站数据会删除本地记录。此功能不能追溯恢复旧版已经丢失的内存现场。
- 联机在全员状态核对后，约每 5 秒保存当前玩家已确认的电池存档。电池存档需要游戏本身写入保存；不是对局即时快照。刷新/关闭仍会结束整个联机会话，原局重连尚未实现，运行中的联机页面新增离开确认。
- 全员选择相同的 8、16 或 32 帧输入缓冲，默认 32 帧“流畅优先”（原生满速时约 0.54 秒操作延迟）。32 帧种子输入拆成两个合法的 16 条记录包，未扩大网络包限制。
- 附加的状态核对不再每秒阻塞整局：检查点后台交换摘要，最多允许向前运行一个 60 帧区间；若上一检查点尚未核对，下一检查点前停止推进；任何摘要不一致立即结束。电池存档先暂存检查点时的内容，只有全员确认才更新已验证存档。
- GBA 原生帧率约 59.73。此处目标是保持模拟满速，不能保证弱设备、长时间后台冻结或高延迟网络下始终 60 FPS。低帧率时检查“模拟/等包”读数。


- α 0.6 验收（核心 ea5b53500b0b56fc66e7784403b32e52a3afe4abe058f1b536a937c7b3135698）：原生逻辑状态往返一致，新 Worker 从第 120 帧恢复并继续至第 240 帧。原生序列化往返的 4 字节内部记账不同，CPU、各 RAM 区域、显存和视频帧计数校验通过。
- 真实 Worker/核心每端额外 180 ms 接收延迟，2/3/4 人测量窗口 59.6–59.8 FPS；公网 Railway WSS 2/3/4 人本次读数 59.6–59.9 FPS。全部使用 CC0 诊断 ROM 和 32 帧缓冲，不代表商业 ROM 完整对局或用户设备保证。
- 注入第 60 帧状态错误后全部停止，verifiedFrame 保持 0，未提交错误现场的电池存档。检查点采用摘要匹配后再全员 ACK 的两阶段确认。
- 生产 Chrome 完成 ROM/设置刷新保留、运行中刷新、发现即时存档及点击继续，页面确认“单人游戏中 · 已继续上次进度”。单人画面是诊断 ROM 的预期黑屏。


2026-10-20 Web α 0.6.1 网页播放修复：
- 画面按 requestAnimationFrame 绘制；Worker 只保留一个已发送帧和一个最新候选帧，显示缓慢不会堆积历史画面，模拟不等 UI 确认。后台仍继续模拟。
- 支持的浏览器使用 AudioWorklet 连续 PCM 环形缓冲，45 ms 起播缓冲、采样率插值、欠载后重新缓冲、溢出丢弃旧声音；不支持时回退原播放路径。
- 单人与联机都显示模拟 FPS、实际绘制 FPS、核心耗时与等包耗时，日志增加画面合并次数及声音欠载计数。计时器等待扣除当帧处理实际耗时。
- 人为将每次画面确认延迟 150 ms，真实核心仍运行 121 帧，显示仅交付 14 帧、合并 106 帧，测量窗口模拟 59.7 FPS，自动即时存档正常。音频立体声极性、重采样、3000 次连续输出、溢出与欠载恢复通过。
- 单人真实核心恢复、2/3/4 人同步回归通过。诊断 ROM 结果不能证明用户的商业游戏满速，仍需用户实际运行时的 FPS/核心/等包读数或新版日志定位剩余瓶颈。

- 生产 Chrome 实测发现可见窗口的 rAF 回调也可能被限制至 1 Hz，已增加 59.73 Hz 定时器回退；两条调度路径只执行一次绘制，停止时一起取消，回归检查通过。
- α 0.6.1 生产单人续玩启用了 44100 Hz AudioWorklet；36 个绘制窗口的中位数为 59.7 FPS，范围 35.9–60.7 FPS，浏览器交互时有短暂掉帧。这里计数的是 Canvas 绘制提交，不是物理屏幕扫描；不能等同商业游戏稳定锁帧。日志末尾音频欠载 0、溢出后丢弃旧音频 1 次。
