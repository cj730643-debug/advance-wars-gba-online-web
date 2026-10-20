# 源码验收与构建记录

日期：2026-10-19（北京时间）。产品状态：开发测试版，非正式版。

## 上游与环境

- 实际克隆 `https://github.com/Aelvryx/mgba-wifi-link.git`，分支 master。
- 上游 HEAD：`9e919b0cfbb93af7d1171570dfc6745d00eeebab`。
- 上游没有 `.gitmodules`。本包装项目通过 Git submodule 固定该完整源码仓库。
- 实际执行环境为 Linux x86-64；Git 2.51.1、GCC 13.3.0。
- 初始无 CMake/Ninja；在隔离的用户目录安装 CMake 4.4.4、Ninja 1.13.2。
- 实际构建测试依赖 CMocka 1.1.7。Windows 交叉工具链为 Ubuntu MinGW GCC 13 posix、mingw-w64 11、binutils 2.41；NSIS 3.09。
- 没有 Windows、Visual Studio 2022、MSVC、Windows SDK 或两台 Windows 实机。
  因此 MinGW 交叉编译不能替代 VS2022 和 Windows 运行验证。

## 实际检查的主要文件

上游 README、LICENSE、UPSTREAM、CI、CMakeLists，
`docs/gba-wifi-link.md`、`docs/gba-link-protocol-v2.md`、
`docs/gba-wifi-link-integration.md`、诊断 ROM 的 README 和 main.c；
`src/platform/libretro/libretro.h` 的 command 78/Netpacket 契约；
`gba-wifi-link.[ch]` 中注册、配置、握手、收发、失败、停止、检查点、角色映射路径；
`src/gba/sio/netplay/{session-v2,input-sync,protocol-v2,transport}.c` 的编解码、
队列、输入与状态转换路径；对应 netplay、replica、pair 和 libretro replay 测试。

本地新代码：`client/main.cpp`、`network.[ch]pp`、`bridge.hpp`、`bridge_test.cpp`，
`relay/server.mjs` 与 `relay/test/relay.test.mjs`，构建、测试、打包脚本和工作流。

## 已确认的架构

- 实际 CMake 目标为 `mgba_libretro`。默认 Qt/SDL 不是运行此核心的必要依赖。
- 上游支持两人 GBA MULTI/Multi-Pak。每端运行 P0/P1 两个副本；主机呈现 P0、客机呈现 P1。
- 上游可靠有序传输是前端责任；Netpacket 本身不是服务器地址或中继服务。
- command 78 的 `start` 提供 void send 回调和 receive-poll 回调；start(0) 后主机
  通过 connected(1) 接纳唯一对手，客机 start(1) 即已连接到主机。
- 单包上限 64 KiB；可靠、有序，flush 必须不阻塞。回调只能在模拟线程使用。
- 上游有有效 ROM SHA-1/长度、协议与确定性配置握手，以及内部快照 SHA-256 和周期状态验证。
- 本前端额外比对整个未修改 ROM、Core DLL、固定配置的 SHA-256；禁用外挂 BIOS、补丁和作弊。
- 原版 LAN 路径未移除；未修改 Netpacket wire 协议或 GBA CPU/串行/调度时序。

## 上游与公网之间的差距及实现

上游 README 明确没有公网 relay、Single-Pak、RFU、会话重连、主机迁移或在线即时存档。
本次新增前端的 Netpacket→WSS 适配层，不修改 RetroArch，也不注入其他进程。
模拟线程复制数据至有限队列，独立网络线程执行 WinHTTP IO；接收仍由模拟线程轮询回调。
外层 `AWR1 + uint64 big-endian序列号 + 原始Core包` 只用于中继传输。
核心原协议包保持不变，服务端不解析模拟状态。

中继提供两人房间、随机八位邀请码、一次性256位短期凭证、60秒认证期限、
10分钟候场期、8小时会话上限、15秒心跳超时、容量/请求/数据/背压限制与安全清理。
公网 TLS 交给标准 Caddy 反向代理；客户端使用 Windows 证书校验，拒绝非本机明文地址。
无内置服务器已部署；公网 WSS 与异地连接尚未验收。

void send 回调没有错误返回：适配器发送失败时锁存 terminal，在本次模拟线程轮询或
retro_run 返回后禁止后续帧；接着 stop、回滚与关闭。没有伪造发送成功或联网成功的产品状态。

## 修改上游的六个文件

完整可重复补丁：`patches/windows-portability.patch`。

1. `src/gba/replicated-pair.c`：静态函数 `_sleep` 改名 `_pairSleep`，避开 Windows CRT
   同名符号的真实编译冲突，函数内容不变。
2. `CMakeLists.txt`：将目录 VFS 的 `vfs-w32.c` 从 OS_SRC 排除，保留在原有 VFS_SRC。
   避免最小 libretro 目标在没有 ENABLE_DIRECTORIES 时编译目录实现。普通库仍使用原目录实现。
3. `src/util/test/hash.c`：把 stagedCrc32 的一个多字符常量/单字节数组改成两个换行字节。
   消除读取两字节时的越界；保留单字节、整体、分段三个 CRC 断言，后两个期望值
   依据独立 Python zlib.crc32(b'\n\n') 的0x5BE3136B纠正，不删除或跳过测试。

每处保留原版权并标记本项目修改。构建器固定上游 SHA 并应用该补丁；源代码 ZIP 已含补丁后的内容。

4. `src/gba/sio/netplay/session-v2.c`：绝对校准/接受期限读取现有经过验证的 DeadlinePolicy，
   替代忽略该策略的固定三秒常量。默认仍为三秒，仍采用绝对期限而不是收到数据后刷新。
5. `src/platform/libretro/gba-wifi-link.c`：增加可选 internet 网络策略，仅将校准期限设为10秒。
   实测原三秒期限在每端额外50ms接收延迟时超时，24个串行RTT探测需要更长的有限预算。
6. `src/platform/libretro/libretro_core_options.h`：声明 LAN/Internet 选项，默认 LAN，
   因此原有 RetroArch/LAN 行为保持不变。专用桌面前端固定选 Internet。

此处只调整网络握手的墙钟预算；没有变更模拟帧率、串行/CPU时序、样本数量、延迟选择算法、
八帧上限、输入等待/状态校验期限或断线回退机制。所有原有测试仍需执行。

## 可重复构建

无测试的最小 Core 需 `SKIP_LIBRARY=ON`；否则 Windows 默认公共库要求 epoxy，
仅关闭 Qt/SDL 并不足够。核心不需要该公共库或 OpenGL。

```powershell
python scripts/build_core.py --windows-msvc --build build/windows-core
cmake -S . -B build/windows-client -G "Visual Studio 17 2022" -A x64
cmake --build build/windows-client --config Release --parallel
ctest --test-dir build/windows-client -C Release --output-on-failure
python scripts/package.py --client build/windows-client/Release/AdvanceWarsOnline.exe --core build/windows-core/Release/mgba_libretro.dll
makensis /DROOT=$PWD packaging/setup.nsi
python scripts/package.py --hash-only
```

等价上游最小配置要点：BUILD_LIBRETRO=ON、BUILD_QT/SDL=OFF、SKIP_LIBRARY=ON、
BUILD_GL/GLES2/GLES3=OFF、USE_EPOXY=OFF。其他可选依赖由构建器统一关闭。
CMake 4 需 `CMAKE_POLICY_VERSION_MINIMUM=3.5` 兼容嵌套旧项目。
MSVC 构建额外设置 `/experimental:c11atomics` 配合上游 C11 标准，以支持 session-v2.c
的 stdatomic.h；此项来自 Microsoft 文档，当前环境不能替代实际 MSVC 编译验收。
参考：https://devblogs.microsoft.com/cppblog/c11-atomics-in-visual-studio-2022-version-17-5-preview-2/

Linux 全套测试：安装 CMocka 后，运行 `python scripts/build_core.py --tests --build build/linux`
再 `ctest --test-dir build/linux --output-on-failure`。构建器会检查实际生成测试树，
防止上游找不到 CMocka 后静默关闭测试造成空跑。

## 游戏适配边界

Nintendo 官方两代产品说明都提到原版 Multi-Pak；初代与二代分别验证，不能交叉版本联机。
原游戏可提供多人数/Single-Pak 等模式，本产品只接入两人 Multi-Pak，不支持三人或四人。
具体版本、菜单解锁条件、地图限制、雾战和内部保存必须用用户自己的合法 ROM 再逐项实测。
没有用商业游戏文件测试，未宣称两代兼容性通过。

参考原始来源：
- https://github.com/Aelvryx/mgba-wifi-link/tree/9e919b0cfbb93af7d1171570dfc6745d00eeebab
- https://www.nintendo.com/en-gb/Games/Game-Boy-Advance/Advance-Wars-866532.html
- https://www.nintendo.com/en-gb/Games/Game-Boy-Advance/Advance-Wars-2-Black-Hole-Rising-266331.html
- https://www.nintendo.com/en-gb/Support/Legacy-system/What-is-the-difference-between-a-Single-Pak-multiplayer-game-and-a-Multi-Pak-multiplayer-game-619409.html
