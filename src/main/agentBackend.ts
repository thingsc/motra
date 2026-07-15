// Provider 后端抽象 + Anthropic SDK 实现。
//
// 动机:STEP 1 之前用 `spawn('claude', ...)` 跑 CLI 子进程,每条消息要经过 CLI 的
// MCP/工具加载 + stdin/stdout 序列化,延迟大。改成直连 provider API 后:
//
//   - 砍掉 CLI 进程层与 MCP 握手
//   - 一层 HTTP,流式 token 直达主进程
//   - 渲染端事件协议(stdout / turn-end / error)保持不变,sessionStore 零改动
//
// 默认 baseURL 指向 DeepSeek 的 Anthropic-compatible 端点
// (`https://api.deepseek.com/anthropic`)。settings 里改回 `https://api.anthropic.com`
// 就能切回真 Anthropic。

import Anthropic from '@anthropic-ai/sdk'

export interface StreamOpts {
  sessionId: string
  /** 完整对话历史(不含当前轮 user 消息,session 层负责 push) */
  history: { role: 'user' | 'assistant'; content: string }[]
  /** 当前轮的 user 文本 */
  userText: string
  /** 模型名,例如 'deepseek-chat' / 'deepseek-reasoner' / 'claude-sonnet-4-5' */
  model: string
  /** 可选 system prompt */
  system?: string
  /** max_tokens,DeepSeek 默认上限较大,这里取 4096 */
  maxTokens?: number
  /** Stop 按钮触发的 abort 信号 */
  signal: AbortSignal
  /** 每收到一段 token 增量调一次(chunk 通常 1-20 字符) */
  onDelta: (text: string) => void
  /** 一轮完整结束(成功) */
  onDone: (info: { inputTokens: number; outputTokens: number }) => void
  /** 中途失败(网络/4xx/abort 等) */
  onError: (err: Error) => void
}

export interface AgentBackend {
  /** 后端标识,用于诊断日志与 telemetry */
  readonly id: string
  /** 流式发一条消息,函数返回即代表"流已结束"(成功或失败都已通过回调上报) */
  stream(opts: StreamOpts): Promise<void>
}

export interface AnthropicSdkBackendOptions {
  apiKey: string
  /** 默认 'https://api.deepseek.com/anthropic' */
  baseURL?: string
  /** 单条回复上限 */
  maxTokens?: number
}

/**
 * 基于 Anthropic SDK 的 backend 实现。同一份代码既能跑 DeepSeek(默认),
 * 也能跑真 Anthropic(改 baseURL)。
 */
export function createAnthropicSdkBackend(opts: AnthropicSdkBackendOptions): AgentBackend {
  const baseURL = opts.baseURL ?? 'https://api.deepseek.com/anthropic'
  const maxTokens = opts.maxTokens ?? 4096

  // dangerouslyAllowBrowser 默认 false,Electron 主进程是 Node 环境,
  // 直接 new 不会触发 SDK 的浏览器检查。
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL })

  return {
    id: `sdk:${baseURL}`,

    async stream(s: StreamOpts): Promise<void> {
      // 把 history + 当前 user 拼成完整 messages 喂给 API。
      // DeepSeek/Anthropic 都要求 messages 是 user/assistant 交替,这里 history
      // 已经由 session 层维护好,不需要再处理。
      const messages = [
        ...s.history,
        { role: 'user' as const, content: s.userText }
      ]

      // SDK 会基于 signal 自动给请求加 abort 行为,但 SDK 0.30 的 stream() 接受
      // options.signal。我们同时自己保留一份 listener 用来兜底(stream 半路崩了
      // 也能 abort 底层 controller)。
      let sdkStream: ReturnType<typeof client.messages.stream> | null = null
      const onAbort = (): void => {
        try {
          sdkStream?.controller.abort()
        } catch {
          // ignore
        }
      }
      if (s.signal.aborted) {
        s.onError(new Error('aborted before start'))
        return
      }
      s.signal.addEventListener('abort', onAbort, { once: true })

      try {
        sdkStream = client.messages.stream({
          model: s.model,
          max_tokens: s.maxTokens ?? maxTokens,
          system: s.system,
          messages
        })

        // for-await 自动解 SSE,event 形状跟 Anthropic 原生 stream 一致。
        // DeepSeek 发的就是标准 content_block_delta + text_delta,SDK 解析后 yield 给我们。
        for await (const event of sdkStream) {
          if (s.signal.aborted) break
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const txt = event.delta.text
            if (txt) s.onDelta(txt)
          }
        }

        // await finalMessage 拿 usage。如果中途 abort 这里会抛 APIUserAbortError,
        // 被下面的 catch 接住。
        const final = await sdkStream.finalMessage()
        s.onDone({
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens
        })
      } catch (err) {
        // SDK 在 abort 时抛 APIUserAbortError,正常路径,不算 error event。
        // 但用户主动 Stop 时希望前端能感知到——onError 仍然报,前端按 error 显示即可。
        s.onError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        s.signal.removeEventListener('abort', onAbort)
      }
    }
  }
}