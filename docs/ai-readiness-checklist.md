# AI 接入准备度检查单（BeforeAI）

更新时间：2026-03-06

## 评分规则

- 每项满分 20 分，总分 100 分。
- `完成` 得满分，`部分完成` 得 10 分，`未完成` 得 0 分。
- 准入门槛：`>= 80/100`。

## 检查项与当前状态

1. 生命周期闭环（归档/回收站/恢复/永久删除）  
状态：完成（20/20）  
证据：`/api/notes/:id/archive`、`/restore`、`/hard`；`tests/api.spec.ts` 生命周期用例。

2. 检索能力（FTS + 过滤组合 + R2 正文一致性）  
状态：完成（20/20）  
证据：`notes_fts` + 查询排序；创建/更新/迁移时显式同步 FTS；`tests/api.spec.ts` 新增 R2 正文关键词检索用例。

3. 存储解耦（D1/R2 正文与附件链路）  
状态：完成（20/20）  
证据：`/api/assets/upload`、`/api/notes/storage/migrate`；正文阈值切换与读取回填。

4. 索引流水线（chunk/embedding/重试/重建）  
状态：完成（20/20）  
证据：`/api/index/process`、`/api/index/rebuild`、`/api/notes/:id/index/retry`；`note_index_jobs` 状态机。

5. 质量与可观测性（测试/CI/核心指标与告警）  
状态：完成（20/20）  
证据：CI 执行 `typecheck/build/test`；`/api/ops/metrics` 与 `/api/ops/alerts` 提供 API 错误率、搜索 P95、索引成功率/积压告警状态。

## 当前总分

`100/100`（达到 AI 接入前门槛）

## AI 统一接口（预留）

- `/api/ai/context`：仅返回检索上下文，不调用模型。
- `/api/ai/execute`：返回统一响应结构，`enabled=false`，明确“BeforeAI 阶段禁用生成”。

以上保证前后端在不启用正式 AI 的前提下完成接口契约联调。
