import { useSessionStore } from '../store/sessionStore'

interface Props {
  onClose: () => void
}

export function SettingsPopover({ onClose }: Props): JSX.Element {
  const cliCmd = useSessionStore((s) => s.cliCmd)
  const cliArgs = useSessionStore((s) => s.cliArgs)
  const cliCwd = useSessionStore((s) => s.cliCwd)
  const setCli = useSessionStore((s) => s.setCli)

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="font-medium">CLI 配置</div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg-base text-xs">
          关闭
        </button>
      </div>
      <label className="block">
        <span className="text-fg-muted text-xs">命令(cli command)</span>
        <input
          value={cliCmd}
          onChange={(e) => setCli({ cliCmd: e.target.value })}
          className="input-base w-full mt-1"
          placeholder="claude"
        />
      </label>
      <label className="block">
        <span className="text-fg-muted text-xs">默认参数(空格分隔)</span>
        <input
          value={cliArgs}
          onChange={(e) => setCli({ cliArgs: e.target.value })}
          className="input-base w-full mt-1"
          placeholder="--print --input-format stream-json --output-format stream-json --verbose --include-partial-messages"
        />
      </label>
      <label className="block">
        <span className="text-fg-muted text-xs">工作目录(可选)</span>
        <input
          value={cliCwd}
          onChange={(e) => setCli({ cliCwd: e.target.value })}
          className="input-base w-full mt-1"
          placeholder="留空 = 当前目录"
        />
      </label>
      <p className="text-xs text-fg-subtle mt-2 leading-relaxed">
        这些值会作为下一次 New Session 的默认 `cmd / args / cwd`。已存在的进程不会受影响,需要 Restart 才能换命令。
      </p>
    </div>
  )
}
