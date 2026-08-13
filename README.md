# Motra

Motra 是一个面向电机开发与调试场景的桌面工作台。目前项目包含两个主要功能：

- 基于 Anthropic-compatible API 的 Task 工作台，支持草稿任务、Workspace、每任务模型与 System Prompt；
- 通过串口连接电机控制板的独立虚拟示波器，支持多通道波形、HEX 数据查看和控制命令发送。

项目仍在持续开发中。当前 AI 对话和虚拟示波器已经可以独立使用；让 AI 调用工具、读取波形以及操作工程文件的 Agent 能力尚未实现。

## 技术栈

- Electron 33
- React 18 + TypeScript
- Vite / electron-vite
- Tailwind CSS
- Zustand
- `@anthropic-ai/sdk`
- `serialport`

## 环境要求

- Node.js 22 或更高版本（项目验收环境使用 Node.js 24）
- npm
- 使用虚拟示波器时，需要操作系统能够识别目标串口
- 只有运行离线串口 mock 时才需要 Python 3

可先检查本机环境：

```bash
node --version
npm --version
```

## 启动项目

在项目根目录执行：

```bash
npm install
npm run dev
```

`npm run dev` 会启动 Vite 开发服务器并打开 Motra 的 Electron 主窗口。

如果依赖已经安装，可以直接执行：

```bash
npm run dev
```

## 配置 AI Provider

首次启动后，从 Sidebar 打开完整 **Settings** 页面，填写：

- API Key
- Anthropic-compatible Base URL
- 默认模型和本地模型列表
- 单轮最大输出 token 数
- System Prompt
- 主窗口语言（简体中文 / English）

System Prompt 会在新 Task 第一次发送时冻结到该 Task，并真实传入后续模型请求；更改默认值不会覆盖已有 Task。

默认配置面向 DeepSeek：

```text
Base URL: https://api.deepseek.com/anthropic
Model:    deepseek-chat
```

也可以把 Base URL 和模型名称改为其他兼容 Anthropic Messages API 的服务。API Key 保存在 Electron 的 `userData/settings.json` 中，不会写入项目仓库；当前版本使用本机明文 JSON 存储，请不要在共享机器上保存敏感密钥。

配置保存后，点击左侧 **New task** 进入草稿。草稿不会立即写入磁盘；发送第一条消息时才创建真实 Task。Composer 可以选择本地 Workspace，并只读显示 Git 分支与 dirty 状态。

也可以通过环境变量提供 DeepSeek API Key：

```bash
DEEPSEEK_API_KEY=your_api_key npm run dev
```

如果 Settings 中已经保存了 API Key，会优先使用保存的配置。

## 使用虚拟示波器

1. 启动 Motra；
2. 点击左侧 **AI 工具箱 → 虚拟示波器**；
3. 在独立窗口中选择串口和波特率；
4. 点击连接，等待状态栏显示已连接；
5. 查看实时波形，或切换到 HEX 视图查看原始字节；
6. 在 TX 区设置转速与启停状态并发送命令。

默认串口参数为 `1,500,000 baud / 8N1`。默认协议格式如下：

```text
TX: [speed_rpm, motor_on]，两个 uint16 little-endian，无帧头
RX: 0x53 0x53 + 600 × [CH1, CH2, ...] uint16 little-endian + 0x45 0x45
```

默认接收通道为 `Ia (ADC counts)` 和 `Speed (RPM)`。目标固件的通道定义和协议必须与 [src/shared/scope.ts](src/shared/scope.ts) 中的配置一致。

### 无硬件运行示波器 smoke demo

macOS 或 Linux 下，可以使用仓库内的 Python mock target 模拟串口设备：

```bash
python3 -m pip install -r ref/mcb_host/requirements.txt
bash scripts/scope-smoke.sh
```

脚本会创建一对临时 PTY、启动 mock target、执行协议链路检查，并以 demo 模式打开 Motra。相关日志写入 `/tmp/scope-smoke/`。

停止 demo：

```bash
bash scripts/scope-smoke.sh stop
```

该脚本使用了 `pkill` 清理 mock、relay 和 electron-vite 进程；如果本机同时运行其他 electron-vite 项目，建议先手动关闭它们。

Windows 可以参考 [ref/mcb_host/README.md](ref/mcb_host/README.md)，使用 com0com 创建虚拟串口对并运行 `mock_target.py`。

## 构建与检查

```bash
# TypeScript 类型检查
npm run typecheck

# 构建主进程、preload、主窗口和示波器窗口
npm run build

# 启动构建后的应用
npm run preview

# 执行项目 spec 中定义的全部验收项
npm run verify
```

`npm run verify` 会递归读取 `spec/**/*.md` 中的 `verify:item`，检查构建、类型、持久化、IPC、示波器协议和关键文件。部分真实 Provider、GUI 与硬件链路项目属于人工 smoke，不会在每次运行时自动访问外部服务或串口。

## 项目结构

```text
src/
├── main/                 Electron 主进程、会话、Provider、IPC、串口
├── preload/              暴露给 Renderer 的受控 API
├── renderer/
│   ├── src/components/   主窗口组件
│   └── src/scope/        虚拟示波器窗口及状态管理
└── shared/               主进程与 Renderer 共用的类型和串口协议

spec/                     可执行合约与验收项
plans/                    分阶段开发计划
scripts/                  verify 和示波器 smoke 脚本
ref/mcb_host/             Python 串口协议参考实现与 mock target
```

## 当前开发状态

- 已完成：Agent 风格双语主界面、Task 草稿、Workspace/Git 状态、完整 Settings；
- 已完成：SDK 流式对话、v3 Task 持久化、单 Provider 多模型；
- 已完成：独立虚拟示波器、串口收发、多通道显示；
- 待实现：Tool Calling Agent；
- 待实现：文件 Diff、权限、MCP 和插件系统；
- 待实现：AI 对示波器数据的直接访问与分析。

更详细的设计和阶段状态请参阅 [spec/index.md](spec/index.md) 与 [plans/index.md](plans/index.md)。
