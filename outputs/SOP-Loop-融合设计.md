# SOP Loop 融合设计

这次融合的目标不是把两个项目的页面拼在一起，而是让它们共享同一个学习工作流。

## 统一主线

```text
SOP
  ↓ 生成
学习任务
  ↓ 进入
专注计时
  ↓ 产生
学习结果 / 错题 / 阻碍
  ↓ 汇入
每日复盘
  ↓ 形成
下一步任务和 SOP 调整
```

### 三个项目各自保留的价值

| 来源 | 保留 | 放入 SOP Loop 后的位置 |
|---|---|---|
| SOP Loop | SOP、每日执行、复盘、分析、AI | 总入口和长期方法层 |
| virtual-study-room | 任务、番茄钟、专注记录、每日/每周报告 | 学习工作台 |
| mistake-notebook | 错题、知识分类、题型、附件、复习记录 | 错题与知识库 |

`virtual-study-room` 当前使用的关键数据包括 `tasks`、`focusSessions`、`dailyReviews`、`sessionReviews`、`dailyCloseEntries` 和 `weeklyReports`。`mistake-notebook` 当前使用 `shiti-questions`、`shiti-subject-config`、附件 IndexedDB 和题目同步字段。融合后不直接继续依赖这些键，而是迁移到一个统一的 `sop-loop-workspace` 文档。

## 统一数据模型

```js
{
  version: 2,
  sops: [],
  tasks: [],
  focusSessions: [],
  reviews: [],
  mistakes: [],
  subjectConfig: {},
  settings: {},
  sync: {}
}
```

### SOP

```js
{
  id,
  title,
  description,
  estimate,
  steps,
  subject,
  active,
  version,
  createdAt,
  updatedAt
}
```

`subject` 可为空。学习 SOP 可以绑定数学、英语或 822 控制，也可以是写作、运动等非考试流程。

### Task

任务是当天可以执行的实例，不是 SOP 定义本身。

```js
{
  id,
  title,
  date,
  kind: "today" | "habit",
  sopId,
  subject,
  categoryPath,
  tags,
  completed,
  completedPomodoros,
  createdAt,
  updatedAt
}
```

任务可以没有 SOP。这样临时学习任务仍然能进入计时和复盘。

### FocusSession

统一使用 `focusSessions`，替代当前首版的 `runs`。

```js
{
  id,
  date,
  taskId,
  sopId,
  duration,
  startedAt,
  endedAt,
  sessionName,
  sessionNote,
  result,
  difficulty,
  nextAction,
  endedEarly
}
```

来自 virtual-study-room 的 `duration`、`taskId`、`sessionName`、`sessionNote` 直接迁移；SOP Loop 原有的 `runs` 自动转成这个结构。

### Review

统一保存三种复盘：

```js
{
  id,
  date,
  kind: "daily" | "session" | "mistake",
  sourceId,
  energy,
  good,
  block,
  result,
  next,
  aiSummary,
  createdAt,
  updatedAt
}
```

每日复盘使用 `daily`，专注结束复盘使用 `session`，错题复习记录使用 `mistake`。这样分析页可以同时回答“今天学了多久”和“这些时间解决了什么”。

### Mistake

保留错题本的知识树和题型分离设计：

```js
{
  id,
  subject,
  knowledgePath,
  questionType,
  topic,
  tags,
  title,
  question,
  answer,
  reviewCount,
  reviewHistory,
  lastReviewedAt,
  nextReviewAt,
  attachmentIds,
  answerAttachmentIds,
  createdAt,
  updatedAt
}
```

第一版继续支持“滚动复习”和手动记录熟悉程度，不先引入复杂的间隔算法。`nextReviewAt` 先作为可选字段，为后续接 FSRS 或简单间隔复习留位置。

## 页面调整

主导航调整为六项：

1. **今天**：今天的 SOP、学习任务、待复盘事项。
2. **学习**：任务、番茄钟、专注记录和当天学习结果。
3. **SOP**：方法模板和版本。
4. **错题**：快速录入、知识树、滚动复习。
5. **复盘**：每日档案、周报和 AI 总结。
6. **设置**：模型、数据导入导出、同步。

### 今天页的融合卡片

今天页不再只显示 SOP：

- 顶部：今日重点 SOP。
- 中间：来自 SOP 的任务和临时学习任务。
- 右侧或移动端下方：当前专注计时。
- 任务完成后：可以直接新增错题或写结果。
- 晚上：复盘会自动列出今日任务、专注时长、错题数量和未完成事项。

### 学习页

保留 virtual-study-room 的核心体验，但只保留首版真正需要的部分：

- 今日任务和每日坚持。
- 25/5、50/10、自定义计时。
- 计时绑定任务。
- 专注结束后填写结果、难度和下一步。
- 今日专注分钟、番茄次数、完成任务。

成就、复杂课程导入、全年热力图和 Windows 专用归档暂时作为后续模块，不阻塞主闭环。

### 错题页

保留 mistake-notebook 的核心体验：

- 快速录入题目和答案。
- 科目、知识路径、题型、标签分开维护。
- 图片/PDF 先保留附件 ID 接口，第一版先支持文本错题。
- 滚动复习时点击查看答案。
- 每次复习写入 `reviewHistory`，同时产生一条 `Review(kind="mistake")`。

## 数据迁移和互通

### 自动迁移

启动时按下面顺序读取：

1. 有 `sop-loop-workspace` 就直接加载。
2. 没有统一数据时，迁移当前 SOP Loop 的 `sops`、`runs`、`reviews`、`settings`。
3. 同时检测 virtual-study-room 的 `tasks`、`focusSessions`、`dailyReviews`、`sessionReviews`、`dailyCloseEntries`。
4. 检测 mistake-notebook 的 `shiti-questions`、`shiti-subject-config`。
5. 迁移完成后只写入统一文档，旧键保留，不再继续双写。

### 文件导入

设置页新增两个导入入口：

- 导入 virtual-study-room JSON 备份。
- 导入 mistake-notebook JSON 备份。

导入时先显示数量和字段映射，确认后合并。ID 相同的记录按 `updatedAt` 较新的版本保留，附件暂时按 ID 去重。

### 导出

统一导出包含：

- `workspace.json`
- `mistakes.json`
- `focusSessions.json`
- `reviews.json`

第一版先导出文本和元数据；图片/PDF 附件仍通过原项目备份保留，附件合并在下一步接入。

## AI 接入位置

AI 不再只整理每日复盘，还可以处理三类输入：

1. 今日学习事实：任务、专注时长、结果和错题数量。
2. 错题聚类：按知识路径、题型和重复错误归类。
3. SOP 改进：根据任务偏差和复盘内容提出一个下一步改动。

默认生成短结果：

```text
事实：今天完成 2 个任务，专注 85 分钟，新增 3 道错题。
问题：线性代数的错题集中在特征值计算，且两次复习都没有写出完整步骤。
明天：先做 20 分钟特征值专项，再复习这 3 道错题。
```

## 竞品借鉴

- [ActivityWatch](https://github.com/ActivityWatch/activitywatch)：继续作为可选桌面活动数据源。
- [Super Productivity](https://github.com/super-productivity/super-productivity)：借鉴任务和时间块，不复制其复杂集成。
- [Anki](https://github.com/ankitects/anki)：后续参考复习调度，但不在第一版引入完整卡片模型。
- [Logseq](https://github.com/logseq/logseq)：借鉴本地时间线和日记入口。
- [Ollama](https://github.com/ollama/ollama)：作为 DeepSeek API 之外的本地模型入口。

本阶段的判断是：先把学习任务、专注、错题和复盘打通，比先做复杂同步或自动行为监控更有用。

## 实施顺序

1. 建立统一 workspace 数据层和迁移函数。
2. 把当前 SOP Loop 的 `runs` 改为 `focusSessions`。
3. 把 virtual-study-room 的任务和计时逻辑接入学习页。
4. 把 mistake-notebook 的题目和知识树接入错题页。
5. 在今天页汇总任务、专注、错题和复盘。
6. 接 AI 综合复盘。
7. 增加导入导出和同步适配。
8. 跑测试、构建三端，再上传 GitHub。
