# dsh-archived-tasks — DeepSeek Harness 已归档任务插件

[English](README.md) | 中文

> DeepSeek Harness Web GUI 插件：在设置页新增一个**已归档任务**页面，列出所有
> 已归档会话，可一键恢复，或彻底删除其日志文件与注册表引用。

## 安装

已发布到 npm，作为 profile bundle 一条命令安装：

```sh
dsh plugin --profile web add dsh-archived-tasks
```

安装后**重启 `dsh web`**，打开 **设置 → 已归档任务** 即可看到。

卸载：

```sh
dsh plugin --profile web remove dsh-archived-tasks
```

## 功能

设置页列出 workspace 注册表中归档集合（`archivedSessionIds`）里的会话：

- **恢复**：把会话 id 从注册表的 `archivedSessionIds` 中移除；会话日志与
  workspace 记账保持不变。
- **删除**：破坏性且不可恢复。会 `rm -rf` 删除 `data/sessions` 下的会话日志
  目录，从归档集合中移除该 id，摘除内存中的会话，并从所有 workspace 的
  记账列表中清除该 id。

删除路由有刻意防护：

- 仅接受 POST 且同源请求（对 Origin 头做轻量 CSRF 校验）。
- 会话 id 必须匹配 `^session-[0-9a-f-]+$`，杜绝路径穿越。
- 删除前会确认解析出的会话路径恰好位于 `data/sessions/<encoded-cwd>/`
  下一层。
- `dataRoot` 解析顺序：`config.dataRoot` → `$DSH_DATA_ROOT` → `$DSH_HOME`
  → 从模块位置向上自动探测（本地 vendor 布局与 npm 安装布局均可用）。

## 开发

```sh
# 本地 link 安装（在本仓库目录下）
dsh plugin --profile web add link:$(pwd)

# 发布新版本
npm publish --access public
```

## 许可证

Apache-2.0
