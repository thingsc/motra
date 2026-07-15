// Provider 设置弹窗:
//   - API key(密码框,值为占位时显示为空)
//   - baseURL(默认 DeepSeek Anthropic-compatible)
//   - 默认 model
//   - max_tokens
//   - 默认 system prompt
//
// 保存时调 window.api.setSettings,主进程会自动 reloadBackend 让新配置生效。

import { useEffect, useState } from 'react'
import { useSessionStore } from '../store/sessionStore'

interface Props {
  onClose: () => void
}

const MODEL_PRESETS = ['deepseek-chat', 'deepseek-reasoner']

export function SettingsPopover({ onClose }: Props): JSX.Element {
  const setProvider = useSessionStore((s) => s.setProvider)
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('https://api.deepseek.com/anthropic')
  const [model, setModel] = useState('deepseek-chat')
  const [maxTokens, setMaxTokens] = useState(4096)
  const [system, setSystem] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 拉一次当前 settings 把表单填上
  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setApiKey(s.providerApiKey)
      setBaseURL(s.providerBaseURL)
      setModel(s.providerModel)
      setMaxTokens(s.providerMaxTokens)
      setSystem(s.providerSystem)
    })
  }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    setSaved(null)
    try {
      await window.api.setSettings({
        // 占位符("••••configured")表示已配置但不明文 → 不更新 key 字段
        // 空字符串表示未配置 → 写空,清掉旧 key
        providerApiKey:
          apiKey === '••••configured' ? '__keep__' : apiKey,
        providerBaseURL: baseURL,
        providerModel: model,
        providerMaxTokens: maxTokens,
        providerSystem: system
      } as unknown as Parameters<typeof window.api.setSettings>[0])
      // 同步到本地 store(只 model/system 会被前端用)
      setProvider({ providerModel: model, providerSystem: system })
      setSaved('已保存')
    } catch (err) {
      setSaved(`保存失败: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="font-medium">Provider 配置</div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg-base text-xs">
          关闭
        </button>
      </div>

      <label className="block">
        <span className="text-fg-muted text-xs">API Key(DeepSeek 或 Anthropic)</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="input-base w-full mt-1"
          placeholder="sk-..."
        />
      </label>

      <label className="block">
        <span className="text-fg-muted text-xs">baseURL(Anthropic-compatible)</span>
        <input
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          className="input-base w-full mt-1"
          placeholder="https://api.deepseek.com/anthropic"
        />
      </label>

      <label className="block">
        <span className="text-fg-muted text-xs">默认模型</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="input-base w-full mt-1"
          list="model-presets"
          placeholder="deepseek-chat"
        />
        <datalist id="model-presets">
          {MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="block">
        <span className="text-fg-muted text-xs">单轮 max_tokens</span>
        <input
          type="number"
          value={maxTokens}
          min={256}
          max={32768}
          onChange={(e) => setMaxTokens(Number(e.target.value) || 4096)}
          className="input-base w-full mt-1"
        />
      </label>

      <label className="block">
        <span className="text-fg-muted text-xs">默认 system prompt(可选)</span>
        <textarea
          value={system}
          onChange={(e) => setSystem(e.target.value)}
          className="input-base w-full mt-1"
          rows={2}
          placeholder="留空 = 不发 system 字段"
        />
      </label>

      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-fg-subtle">
          {saved ?? '保存后立即生效,新会话用新配置'}
        </span>
        <button
          onClick={() => void save()}
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          保存
        </button>
      </div>
    </div>
  )
}