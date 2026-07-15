/**
 * 单通道缓冲区的统计计算(min / max / avg / last)。
 * 单次遍历,跳过 leading stale 段(n - filled 之前是上一轮 buffer 残留)。
 */

export interface ChannelStats {
  min: number
  max: number
  avg: number
  /** 末点(legend 用,filled > 0 时返回真正末点,否则返回 buf 末位值) */
  last: number
}

export function computeStats(
  buf: Float32Array,
  n: number,
  filled: number
): ChannelStats {
  const validLen = Math.max(1, Math.min(filled, n))
  const start = n - validLen
  let mn = Number.POSITIVE_INFINITY
  let mx = Number.NEGATIVE_INFINITY
  let sum = 0
  for (let i = start; i < n; i++) {
    const v = buf[i]
    if (v < mn) mn = v
    if (v > mx) mx = v
    sum += v
  }
  if (!Number.isFinite(mn)) {
    return { min: 0, max: 0, avg: 0, last: buf[n - 1] }
  }
  return { min: mn, max: mx, avg: sum / validLen, last: buf[n - 1] }
}