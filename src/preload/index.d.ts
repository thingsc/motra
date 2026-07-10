// 给 renderer 一个 window.api 的类型提示
import type { MotraApi } from '../shared/types'

declare global {
  interface Window {
    api: MotraApi
  }
}

export {}
