# 前端与稳定性验证记录

此文记录上一轮前端与闪退修复验证。最新的记忆交互演示、26 项浏览器回归和本轮桌面检查见 [记忆演示说明](MEMORY-DEMO.md)；下文安装包哈希属于上一轮构建。

工作目录：`D:\desktop\智创OPC源码\ael3`

工作分支：`codex/ael-ui-stability`。本次没有提交或推送 Git。

## 已通过

- `pnpm install --frozen-lockfile`：依赖与锁文件一致。
- `pnpm typecheck`：TypeScript 检查通过。
- `pnpm exec playwright test`：11/11。覆盖桌面/窄屏导航、任务搜索、创建前审阅、OpenUI 记忆卡片、中文输入法、失败草稿、发送中切换会话、慢快照、卸载、历史分页与跨页面后台任务。
- `node tests/terminal-writer.mjs`：6/6。覆盖分批写入、背压、容量上限、重置/销毁、序号合并和最大缓冲组合。
- 本地 Open Claude UI 适配器：严格类型检查和真实 Chromium 的输入框/滚动交互检查通过；Modal 初始焦点、Tab 循环、Escape、背景点击及焦点恢复通过。
- `cargo test --lib history:: --no-default-features -j 1`：9/9。
- `cargo test --lib terminal_cache -j 1`：1/1。
- `cargo test --test agent_runtime_tests terminal_snapshot -j 1`：2/2。
- `pnpm tauri build --bundles nsis --ci`：Windows x64 发行程序与 NSIS 安装包构建通过，构建采用单任务并行度。
- `node scripts/verify-desktop.mjs`：真实 Tauri/WebView2 检查通过。

## 真实桌面检查

使用单独的 `AEL_DATA_DIR` 和 WebView2 配置目录，没有覆盖用户原有数据或 Agent 配置。

- 确认使用 Tauri 原生 IPC，而非浏览器 mock。
- 通过界面新建一项任务。
- 注入 5000 条合成终端记录，模拟一个已结束会话，不启动 Agent。
- 原生快照返回 1000 条、1020000 字节，序号 4001–5000，`truncated=true`。
- 反复切换页面 19 次，包括在大段回放期间离开工作台后重新附着。
- 页面未出现未处理异常；程序保持运行。
- 最后核对数据库仍完整保留 5000 条记录。
- 测试程序、调试端口和浏览器进程已关闭。

原始结果：`.artifacts/native-smoke/1792904369751/report.json`。

浏览器结果与截图：`.artifacts/ui-final/`。

## 交付文件

- 直接运行：`src-tauri/target/release/ael3.exe`
- 安装包：`src-tauri/target/release/bundle/nsis/AEL3_0.1.0_x64-setup.exe`

SHA-256：

```text
ael3.exe
7E2000ED95B7769BAD658872857905B891B8C57EDA33822DD45B1C66D4584628

AEL3_0.1.0_x64-setup.exe
0A9D9D79D492EB72F1339A898449413695859BDBE77BE10B443FBF8E0CA22304
```

## 验证边界

没有取得用户此前闪退的原始堆栈，因此不声称覆盖所有退出原因。本次修复的是已定位并可验证的主线程阻塞、无界历史/终端读取与页面切换竞态。

未运行用户全量历史扫描，未调用真实模型或付费 API。历史解析使用合成大文件和临时数据库验证；超限与损坏内容会报告跳过原因。真实数据中的特殊格式、驱动或 WebView2 故障仍可能需要新的日志分析。
