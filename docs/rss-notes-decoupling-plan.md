# dotNotes / dotRss 拆分方案

## 目标

- `dotnotes` 只负责 notes 域能力：笔记、文件夹、标签、附件、索引、AI 辅助。
- `dotrss` 只负责 RSS 域能力：订阅源管理、抓取、翻译、reading queue、cron、RSS UI。
- 保留当前 D1 schema，不做立刻拆库。

## 当前耦合点

1. RSS 路由和 cron 仍在 `dotnotes` worker 内注册和调度。
2. `rss_items.note_id` 直接关联 `notes.id`，数据库仍是单库模型。
3. RSS 保存全文时直接依赖 notes 内部实现，包含：
   - folder 保障
   - slug 生成
   - body storage 决策
   - FTS 同步
   - index job 入队

## 拆分原则

1. 先拆运行时职责，再考虑是否拆数据库。
2. `dotrss` 不直接写 `notes` 表。
3. notes 域对外暴露“导入为笔记”的稳定入口，RSS 只调用入口。
4. `rss_items.note_id` 在短期内保留，作为跨域关联字段。

## 分阶段执行

### 阶段 1：把 notes 写入收口到专用导入服务

- 新增 notes 侧导入服务，承接 RSS 转 note 的写入流程。
- 新增专用内部 API：`POST /api/internal/notes/imports/rss`。
- RSS 保存链路不再直接 `INSERT INTO notes`，改为调用 notes 导入服务。

这一阶段完成后：

- RSS 代码不再依赖 notes 的内部写表细节。
- 后续迁出到 `dotrss` 时，只需要迁调用方，不需要重写 notes 写入逻辑。

### 阶段 2：迁出 RSS worker

- 新建 `dotrss` worker。
- 迁移以下模块：
  - RSS route
  - RSS feed/item persistence
  - RSS fetch / translate / reading extract
  - RSS cron
- `dotrss` 继续绑定同一个 D1。
- `dotrss` 通过内部 API 或 service binding 调用 `dotnotes` 的 note import 能力。

### 阶段 3：迁出 RSS UI

- `dotnotes` 首页移除 RSS workspace。
- `dotrss` 提供自己的 UI 和 API client。
- `dotnotes` 如需保留入口，只保留跳转或外链。

### 阶段 4：按需再做深度解耦

- 如果未来要拆数据库，再把 `rss_items.note_id` 改成弱引用或映射表。
- 若要独立部署边界更强，优先用 Cloudflare service binding 替代 HTTP + token。

## 本次已执行范围

- 完成阶段 1 的代码改造。
- 保留现有 schema，不改 RSS/notes 表结构。
- 为阶段 2 的 `dotrss` worker 迁移准备稳定的 notes 导入入口。
