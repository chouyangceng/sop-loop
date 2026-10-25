# SOP Loop

SOP Loop 是一个本地优先的个人执行系统，把 SOP、学习任务、专注记录、错题本和每日复盘放在同一个工作区里。

数据流是：

```text
SOP → 学习任务 → 专注记录 → 学习结果 / 错题 → 每日复盘 → 下一步任务和 SOP 调整
```

## 已合并的功能

- **virtual-study-room**：今日任务、专注计时、专注记录、每日复盘、周报、DeepSeek / OpenAI 兼容接口。
- **mistake-notebook**：科目、知识路径、题型、标签、题目与解析、图片/PDF 附件、复习记录。
- **SOP Loop**：SOP 编辑、从 SOP 创建学习任务、任务完成统计、7 天专注分析、JSON 导入导出。

支持导入原项目导出的 JSON；打开设置页选择“导入其他项目备份”即可合并到当前工作区。

## 本地运行

```bash
pnpm install
pnpm build
pnpm dev
```

打开 `http://localhost:4173`。数据保存在当前设备的 `localStorage`，附件保存在 IndexedDB。

## 桌面端

```bash
pnpm tauri dev
pnpm tauri build
```

Tauri 工程同时支持 macOS 和 Windows。当前 macOS 应用构建在本地 `outputs/SOP Loop.app`；Windows 安装包通过 GitHub Actions 的 Windows runner 生成。

## Android

```bash
pnpm tauri android init
pnpm tauri android build --debug
```

本地首版 APK 在 `outputs/SOP-Loop-android-debug.apk`，AAB 在 `outputs/SOP-Loop-android-debug.aab`。GitHub Actions 会在 Android 构建任务中上传同样的产物。

## DeepSeek 接口

进入“设置”，填写兼容 OpenAI Chat Completions 的接口地址、模型和 API Key。默认值是：

```text
https://api.deepseek.com/chat/completions
deepseek-chat
```

没有 API Key 时，复盘页使用本地规则整理，不依赖网络。

## 备份与边界

设置页的 JSON 备份包含工作区数据和附件 ID。附件本体仍保存在设备的 IndexedDB 中，换设备前需要保留原设备或重新添加附件。同步协议暂时采用导出/导入，后续再接入局域网或云端同步。

## 设计文档

- [产品设计蓝图](outputs/SOP-Loop-产品设计蓝图.md)
- [融合设计](outputs/SOP-Loop-融合设计.md)
