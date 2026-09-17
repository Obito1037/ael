# Skill · Tauri 2 Windows 构建缺少 C++ Build Tools

> 这是 AEL 沉淀经验的可读格式示例(DB 里以 skill-schema.json 的字段存储,导出时转成这种 markdown)。

- **id**: example-tauri-build-fix
- **status**: active
- **version**: 1
- **tags**: tauri, windows, build, toolchain
- **success / fail**: 3 / 0
- **来源任务**: (示例)

## Trigger(何时适用)
在 Windows 上首次执行 `pnpm tauri build` 或 `tauri dev`,报 `link.exe not found`、`linker not found` 或 MSVC 相关链接错误。

## Body

### 约束
- 构建前必须确认已安装 Visual Studio Build Tools,且勾选了 "Desktop development with C++"。
- 装完工具链后必须重开终端,让 PATH 生效,否则照样报错。

### 步骤
1. 安装 VS Build Tools(或完整 VS),勾选 C++ 桌面开发负载。
2. 确认 `rustc`/`cargo` 可用(`rustup` 安装)。
3. 重开终端。
4. `cargo clean`,再 `pnpm tauri build`。

### 验证
- 命令产出 `.msi` 或 `.exe` 安装包即成功。
- 若仍失败,检查是否缺 WebView2 Runtime。
