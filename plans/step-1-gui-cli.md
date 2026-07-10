# Motra · STEP 1 · GUI 包装 CLI

> 详见 `index.md` 与 `../SPEC.md`(已 deprecated → `../spec/`)。本文件对应第一步的开发计划。

---

## 0. 目标

跑通一个能在桌面里调用 Claude Code(或任何 CLI)子进程、把 stdout 流式渲染到聊天区的壳。验证 IPC、布局、流式回显。

---

## 1. 项目初始化

### 1.1 目录结构

1. 目录结构:
   ```
   gui/
     src/
       main/           # Electron 主进程(Node)
         index.ts
         ipc/
       preload/        # 注入 contextBridge
         index.ts
       renderer/       # React 前端
         App.tsx
         components/
         store/
     package.json
     electron.vite.config.ts(或 electron-forge + vite-plugin)
     tsconfig.json
     tailwind.config.js
   ```

2. 选个脚手架(任选其一):
   - `npm create @quick-start/electron`(electron-vite 模板,最省事)
   - 或 `npx create-electron-vite`

3. 装 Tailwind:`npm i -D tailwindcss postcss autoprefixer && npx tailwindcss init -p`

### 1.2 主进程最小骨架

4. `main/index.ts` 创建 `BrowserWindow`,加载 `http://localhost:5173`(dev)或 `dist/renderer/index.html`(prod)。
5. 开启 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: false`(sandbox 留给 sandbox=true 时再说,先用 false 跑通)。
6. 注册 IPC 处理器(`ipcMain.handle`):
   - `cli:start`:用 `child_process.spawn` 启动 CLI(默认 `claude` 命令,可配置),把 `cmdArgs`、`cwd`、`env` 一并传入。
   - `cli:input(sessionId, text)`:往该 session 的 stdin 写一行。
   - `cli:kill(sessionId)`:结束该 session 进程。

7. 监听子进程的 `stdout`/`stderr`(**`spawn` 而非 `exec`,否则卡缓冲**),按行 split 后通过 `webContents.send('cli:event', {sessionId, kind, data})` 推给渲染端。
8. sessionId 用自增 UUID 维护,`Map<sessionId, ChildProcess>` 存进程引用。

### 1.3 Preload 桥

9. `preload/index.ts` 用 `contextBridge.exposeInMainWorld('api', {...})` 暴露:
   - `startCli(opts)` / `sendInput(sessionId, text)` / `killCli(sessionId)`
   - `onCliEvent(cb)` → 返回一个 `unsubscribe`
   - 这是渲染端能调的全部能力,禁止任何 `require`。

### 1.4 渲染端 UI 骨架

10. 三栏布局(Tailwind grid):
    - **左**:会话列表(`Sidebar`),每个会话显示标题、最后一条消息预览、时间戳。底部"New Session" 按钮。
    - **中**:聊天区(`ChatPane`),消息流用 `messages: Message[]`,每条渲染 `role: 'user' | 'assistant' | 'system'`。
    - **顶**:模型选择 / CLI 命令配置 / Settings 入口(先做成最简 popover)。

11. 输入框(`Composer`):Ctrl+Enter 提交,提交后调用 `api.sendInput(sessionId, text)`,并立刻 push 一条 user 消息。
12. 监听 `window.api.onCliEvent`:
    - 把流式 token 累加到当前 `assistant` 消息上(用 Zustand 的 immutable update 或轻量 reducer)。
    - tool_use / tool_result 这类结构化事件先按纯文本处理(第一步**不**做 tool calling)。

### 1.5 持久化(先做最简)

13. 会话列表与会话内消息写到 `userData/sessions.json`:
    - 主进程启动时读、退出时写(或每次 IPC 都 flush,< 1KB 没事)。
    - 渲染端只通过 IPC 读写,不直接动文件。

### 1.6 验收标准(第一步)

- [ ] `npm run dev` 启动后能看到三栏布局
- [ ] 点 New Session 能 spawn `claude` 子进程(先手动指定 `--print` 或类似只读模式验证管道通畅)
- [ ] 输入消息后 stdout 流式回显到聊天区
- [ ] 关掉窗口再开会话历史还在
- [ ] 重启后能恢复未完成的 session(或放弃这个能力也行,做不做取决于要不要 "resume" CLI 调用)

> 详细可执行验收(9 个 verify:item)在 `../spec/step-1-gui-cli.md`。

### 1.7 风险点(提前知道)

- **流式行切分**:`stdout` 可能半行到达,需要 `StringDecoder('utf8')` + 缓冲累积按 `\n` 切。
- **CLI 鉴权**:子进程要带用户已有的 `~/.claude` 凭据,必须把父进程 env 透传(`spawn(cmd, args, { env: process.env, ... })` 即可)。
- **PTY 需要**:如果你的 CLI 走 TTY(很多 AI CLI 都这样),需要 `node-pty` 而不是普通 `spawn`,第一步先评估是否必需。
