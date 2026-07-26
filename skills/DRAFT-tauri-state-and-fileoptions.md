# Skill · Tauri State 解引用 + zip 0.6 FileOptions 版本坑

> 实现 AEL 后端骨架时自举沉淀,合并两条相关的 Rust/Tauri 小坑。

- **id**: draft-tauri-state-fileoptions
- **status**: draft
- **version**: 1
- **tags**: rust, tauri, zip, types
- **来源任务**: AEL 后端骨架 / 接手包

## Trigger(何时适用)
在 Tauri 命令里把 `State<T>` 传给一个吃 `&T` 的函数;或用 `zip` crate 写包时设置 `FileOptions`。两处都会报类型不匹配 / 泛型参数错误。

## Body

### 根因
1. `State<'_, T>` 是 wrapper,`&state` 得到的是 `&State<T>`,不会自动当成 `&T`。字段访问/方法调用能靠 Deref 自动解引用,但**作为函数实参传递时不会**。
2. `zip` 0.6 的 `FileOptions` 不是泛型;`FileOptions::<()>::default()` 那种写法是 0.9+ 才有的。照抄新版示例会编译失败。

### 约束
- 传 `State` 内部值给 `&T` 形参时用 `state.inner()`(或 `&*state`)。
- 锁定 crate 大版本后再抄示例;`zip` 0.6 直接 `let opts = FileOptions::default().compression_method(...)`,不带泛型标注。

### 步骤
1. 命令里:`do_thing(state.inner(), ...)`。
2. zip:按 Cargo.toml 实际版本写 `FileOptions`,先 `cargo doc -p zip --open` 或看 docs.rs 对应版本。

### 验证
- `cargo check` 通过,无类型/泛型报错。

### 对应的 Failure Guard 约束(注入新任务)
> 引第三方 crate 的用法示例前,先确认本仓锁定的版本号,按该版本的 API 写,别照抄最新文档。
