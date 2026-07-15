/**
 * FrameAssembler 字节级自测脚本
 *
 * 跑法:
 *   node --experimental-strip-types --no-warnings scripts/scope-protocol-self-test.ts
 *
 * 覆盖三类场景:
 *   1. encodeCommand 与 mcb_host/protocol.py 字节级一致(用 README 里的范例验证)
 *   2. FrameAssembler.feed 能正确解出 SS + payload + EE 完整帧
 *   3. 在垃圾字节中能 resync 到下一个 start marker
 */

import {
  DEFAULT_FRAME,
  DEFAULT_RX_CHANNELS,
  DEFAULT_TX_FIELDS,
  FrameAssembler,
  buildFrame,
  decodePayload,
  encodeCommand
} from '../src/shared/scope.ts'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ')
}

/* ----------------------------------------------------------------------------
 * Case 1: encodeCommand 字节级与 mcb_host 一致
 * mcb_host/protocol.py:encode_command([3000, 0], TX_FIELDS) == b'\xb8\x0b\x00\x00'
 * mcb_host/protocol.py:encode_command([-100, 1], TX_FIELDS) == b'\x9c\xff\x01\x00'
 * --------------------------------------------------------------------------*/
console.log('Case 1: encodeCommand 字节级兼容')
{
  const a = encodeCommand([3000, 0], DEFAULT_TX_FIELDS)
  assert(
    hex(a) === 'b8 0b 00 00',
    `[3000, 0] → ${hex(a)} (期望 b8 0b 00 00)`
  )

  const b = encodeCommand([-100, 1], DEFAULT_TX_FIELDS)
  assert(
    hex(b) === '9c ff 01 00',
    `[-100, 1] → ${hex(b)} (期望 9c ff 01 00)`
  )

  // wrap-on-overflow: 65537 应该 wrap 到 1
  const c = encodeCommand([65537, 0], DEFAULT_TX_FIELDS)
  assert(
    hex(c) === '01 00 00 00',
    `[65537, 0] wrap → ${hex(c)} (期望 01 00 00 00)`
  )
}

/* ----------------------------------------------------------------------------
 * Case 2: 完整帧解码
 * 构造 SS + 600 × [Ia, Ib] uint16 LE + EE,其中 Ia=1000 Ib=2000
 * FrameAssembler.feed 应该解出 (600, 2) Float64Array
 * --------------------------------------------------------------------------*/
console.log('\nCase 2: FrameAssembler 解码完整帧')
{
  const samples = new Uint16Array(600 * 2)
  for (let i = 0; i < 600; i++) {
    samples[i * 2] = 1000 + i
    samples[i * 2 + 1] = 2000 - i
  }
  const frame = buildFrame(samples, DEFAULT_FRAME)

  const fa = new FrameAssembler(DEFAULT_RX_CHANNELS, DEFAULT_FRAME)
  const frames = fa.feed(frame)
  assert(frames.length === 1, `解析出 ${frames.length} 帧 (期望 1)`)

  if (frames.length === 1) {
    const f = frames[0]
    assert(f.length === 1200, `帧数据长度 ${f.length} (期望 1200 = 600×2)`)
    assert(f[0] === 1000, `第 1 个值 ${f[0]} (期望 1000)`)
    assert(f[1] === 2000, `第 2 个值 ${f[1]} (期望 2000)`)
    assert(f[1198] === 1599, `最后一对 ch1 ${f[1198]} (期望 1599)`)
    assert(f[1199] === 1401, `最后一对 ch2 ${f[1199]} (期望 1401)`)
  }
  assert(fa.dropped === 0, `dropped=${fa.dropped} (期望 0)`)
}

/* ----------------------------------------------------------------------------
 * Case 3: 分块喂入 + 跨块 frame 边界
 * --------------------------------------------------------------------------*/
console.log('\nCase 3: 分块喂入')
{
  const samples = new Uint16Array(600 * 2).fill(500)
  const frame = buildFrame(samples, DEFAULT_FRAME)

  const fa = new FrameAssembler(DEFAULT_RX_CHANNELS, DEFAULT_FRAME)
  // 每次只喂 100 字节
  let totalFrames = 0
  for (let i = 0; i < frame.length; i += 100) {
    const chunk = frame.subarray(i, Math.min(i + 100, frame.length))
    const out = fa.feed(chunk)
    totalFrames += out.length
  }
  assert(totalFrames === 1, `分块喂入共解出 ${totalFrames} 帧 (期望 1)`)
}

/* ----------------------------------------------------------------------------
 * Case 4: 在垃圾字节中 resync
 * 在帧前后各塞 50 字节垃圾,解码器应能 resync 到合法帧
 * --------------------------------------------------------------------------*/
console.log('\nCase 4: resync after garbage')
{
  const samples = new Uint16Array(600 * 2).fill(777)
  const goodFrame = buildFrame(samples, DEFAULT_FRAME)

  const garbage = new Uint8Array(50).fill(0xff)
  // 注意:0xff 不能跟 SS(0x53)或 EE(0x45)撞,所以是纯垃圾
  const stream = new Uint8Array(garbage.length + goodFrame.length + garbage.length)
  stream.set(garbage, 0)
  stream.set(goodFrame, garbage.length)
  stream.set(garbage, garbage.length + goodFrame.length)

  const fa = new FrameAssembler(DEFAULT_RX_CHANNELS, DEFAULT_FRAME)
  const frames = fa.feed(stream)
  assert(frames.length === 1, `garbage + frame + garbage 解出 ${frames.length} 帧 (期望 1)`)
  if (frames.length === 1) {
    assert(frames[0][0] === 777, `第 1 个值 ${frames[0][0]} (期望 777)`)
  }
}

/* ----------------------------------------------------------------------------
 * Case 5: 通道 signed 重解释
 * ch.signed = true 时,raw > 0x7fff 应被解释为负数
 * --------------------------------------------------------------------------*/
console.log('\nCase 5: signed 重解释')
{
  const ch: typeof DEFAULT_RX_CHANNELS[number] = {
    name: 'speed',
    signed: true,
    scale: 1,
    offset: 0,
    unit: 'rpm'
  }
  const samples = new Uint16Array([0xffff]) // 当 signed=true 时 = -1
  const payload = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  const decoded = decodePayload(payload, [ch])
  assert(decoded.length === 1, `decoded length ${decoded.length} (期望 1)`)
  assert(decoded[0] === -1, `decoded[0] = ${decoded[0]} (期望 -1)`)
}

/* ----------------------------------------------------------------------------
 * Case 6: payload 长度非 stride 倍数时 decodePayload 应抛错
 * --------------------------------------------------------------------------*/
console.log('\nCase 6: decodePayload 长度校验')
{
  let threw = false
  try {
    decodePayload(new Uint8Array([1, 2, 3]), DEFAULT_RX_CHANNELS) // 3 字节,非 4 倍数
  } catch {
    threw = true
  }
  assert(threw, 'decodePayload 收到非法长度应抛错')
}

/* ----------------------------------------------------------------------------
 * Case 7: 非法 payload 对数(pairs 不在 nominal±tolerance) → dropped++
 * --------------------------------------------------------------------------*/
console.log('\nCase 7: 非法 payload 计数')
{
  const wrongSamples = new Uint16Array(2 * 2).fill(1) // 只有 1 对,远小于 nominal=600
  const wrongFrame = buildFrame(wrongSamples, DEFAULT_FRAME)
  const fa = new FrameAssembler(DEFAULT_RX_CHANNELS, DEFAULT_FRAME)
  const out = fa.feed(wrongFrame)
  assert(out.length === 0, `非法帧不解出 (out.length=${out.length})`)
  assert(fa.dropped === 1, `dropped=${fa.dropped} (期望 1)`)
}

/* ----------------------------------------------------------------------------
 * Case 8: 与 mcb_host Python 端 build_frame 输出字节级一致
 * 用 synth_block 的前 4 个值构造一个 micro 帧,断言与 build_frame 等价
 * (Python: build_frame(np.array([[2048,2048+1500],[2048+1500*sin(2pi/600+ph), ...]]), FRAME))
 * 这里简化:用一个全 0xABCD 的 4-sample 帧验证字节序
 * --------------------------------------------------------------------------*/
console.log('\nCase 8: buildFrame 字节序')
{
  const samples = new Uint16Array([0x1234, 0x5678])
  const frame = buildFrame(samples, DEFAULT_FRAME)
  // 期望: SS(53 53) + 1234 LE(34 12) + 5678 LE(78 56) + EE(45 45)
  assert(
    hex(frame) === '53 53 34 12 78 56 45 45',
    `buildFrame → ${hex(frame)} (期望 53 53 34 12 78 56 45 45)`
  )
}

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAIL`} ===`)
process.exit(failures === 0 ? 0 : 1)