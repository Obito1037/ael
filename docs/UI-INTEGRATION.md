# AEL3 前端集成与稳定性说明

## 依赖与来源

- [thesysdev/openui](https://github.com/thesysdev/openui)：使用已发布的 `@openuidev/react-lang@1.0.1` 和 `zod@4.6.7`。`MemoryEvidenceRenderer.tsx` 用 `defineComponent`、`createLibrary` 与 `Renderer` 展示可展开的记忆证据。数据来自 AEL IPC，不执行模型返回的 JavaScript，也没有注册外部工具或远程组件。
- [Caho1/open-claude-ui](https://github.com/Caho1/open-claude-ui)：上游没有可安装的同名 npm 发布包，使用仓库源码制作 `vendor/open-claude-ui` 本地依赖。上游 commit 为 `c1f923ae0051a871941b98a0e2e3183a545e6a85`。采用上游主题/动效 CSS、按钮、输入法保护及输入框交互，移除 Electron 入口与演示附件行为。文件映射、适配内容与原版 MIT 许可见该目录的 `UPSTREAM.md` / `LICENSE`。

OpenUI 的安装后遥测脚本不是构建所需，已在 `pnpm-workspace.yaml` 明确关闭。开发期自动下载的调试面板也通过 `openui-bootstrap.ts` 关闭；该兼容设置依赖固定版本，升级时需要重新检查。Renderer 的观测发布关闭。主题使用 AEL 原有四种配色映射至 CDS tokens，字体使用本机字体栈。

## 界面与交互

- 桌面常驻侧栏，包含任务搜索、最近任务与主要业务入口；窄窗口切换为可通过 Escape 关闭的焦点约束抽屉。
- 顶部显示实际任务与 Agent，不再展示写死的示例任务。页面按需加载，OpenUI 渲染器也独立加载。
- 输入框支持多行、中文输入法保护、异步防重复发送和失败草稿保留；发送与停止分别操作，结束的会话不能继续发送。
- 切换任务或 Agent 后脱离旧会话，旧任务不会被误发输入。切换会话时丢弃过期快照。
- 对话框具有标题关联、初始焦点、Tab 约束、Escape 和焦点恢复。
- 启动读取失败会显示重试入口；根节点和业务页面使用 ErrorBoundary，单页渲染异常不会让整个导航消失。
- 记忆预览明确标注“匹配结果”，不再声称创建任务已经完成了记忆注入。

## 历史与终端

历史扫描与候选提炼进入后台任务，并共用排他锁；页面切走再回来会重接同一任务。扫描使用独立 WAL 连接，不在扫描期间独占界面数据库连接。

JSONL 按行读取，并设置明确的内存保护：源文件 512 MiB、单行 4 MiB、归一化会话 64 MiB / 100000 条消息。超限文件保留旧索引；跳过与不完整结果必须在扫描摘要中显示，不作为完整扫描成功。源文件不被修改。

历史消息每页默认 30 条，IPC 每条仅返回最多 4000 字的预览和截断提示，不携带完整原始 payload。完整索引供证据/提炼使用。界面切换会话时忽略晚到的旧结果。

终端采用有界队列与写入回调背压，每批最多 65536 个 UTF-16 代码单元；队列达到限制时显示折叠提示。快照回放、实时数据、布局变化与组件卸载使用同一生命周期规则，避免向已销毁终端写入。

原生快照默认只返回最近 1000 个片段、总计最多 1 MiB UTF-8 文本，并返回 `truncated`、`firstSeq`、`lastSeq`。界面明确提示截断，完整证据仍保存在数据库。运行时缓存也有边界，序号保持独立递增，分页继续读取更早或更新的原始记录。

## 安装与运行

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm tauri dev
```

`pnpm dev` 是使用示例数据的浏览器预览，不能证明真实 Tauri 后端已通过验证。`pnpm tauri dev` 和打包程序使用本机真实数据。

如需隔离验证，可为测试进程设置绝对路径环境变量 `AEL_DATA_DIR`，让其建立独立数据目录，不要修改 `HOME` 或覆盖用户配置。该变量只控制 AEL 数据目录；历史扫描源仍按真实 Agent 配置发现，普通界面烟测不应触发真实全量扫描。

发行版发生 Rust panic 时，会尽力写入 `%LOCALAPPDATA%\AEL3\logs\panic.log`；使用 `AEL_DATA_DIR` 时写入该目录的 `logs\panic.log`。此机制不覆盖系统直接终止、内存耗尽或 WebView 进程崩溃。

## 检查

```powershell
pnpm typecheck
pnpm build
pnpm test:e2e
node vendor/open-claude-ui/tests/verify-interactions.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib history:: --no-default-features -j 1
```

浏览器检查包含 mock 与故障注入；Rust 检查使用合成历史和临时数据库。它们与真实用户全量扫描、真实 Agent 运行应分别记录，不应混报。具体本轮结果见交付说明。
