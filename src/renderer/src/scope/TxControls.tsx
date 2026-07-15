import { useState } from 'react'
import { useScopeStore } from './scopeStore'

interface Props {
  disabled: boolean
}

/**
 * TX 控件 — 仿 mcb_host 的 speed_rpm + motor_on 发送
 *   speed_rpm: -30000..30000,步长 50
 *   motor_on:  0/1 checkbox
 *   Send: encodeCommand 写串口
 */
export function TxControls({ disabled }: Props): JSX.Element {
  const txSpeedRpm = useScopeStore((s) => s.txSpeedRpm)
  const txMotorOn = useScopeStore((s) => s.txMotorOn)
  const setTx = useScopeStore((s) => s.setTx)
  const [sending, setSending] = useState(false)

  const handleSend = async (): Promise<void> => {
    setSending(true)
    try {
      await window.api.serialSend([txSpeedRpm, txMotorOn ? 1 : 0])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-fg-muted">Speed (RPM)</label>
      <input
        type="number"
        min={-30000}
        max={30000}
        step={50}
        className="input-base w-24"
        value={txSpeedRpm}
        onChange={(e) => setTx(Number(e.target.value) || 0, txMotorOn)}
        disabled={disabled}
      />
      <label className="flex items-center gap-1 text-xs text-fg-muted select-none">
        <input
          type="checkbox"
          checked={txMotorOn}
          onChange={(e) => setTx(txSpeedRpm, e.target.checked)}
          disabled={disabled}
        />
        motor on
      </label>
      <button
        onClick={handleSend}
        disabled={disabled || sending}
        className="btn-ghost"
      >
        Send
      </button>
    </div>
  )
}