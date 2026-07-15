#!/bin/bash
# 一键启动虚拟示波器 smoke 环境
# 用法: ./scripts/scope-smoke.sh
# 作用: 启 PTY relay + mock_target, 跑 Node smoke 验证链路, 启 GUI
# 停止: ./scripts/scope-smoke.sh stop

set -e
cd "$(dirname "$0")/.."

LOG_DIR=/tmp/scope-smoke
mkdir -p "$LOG_DIR"

stop_all() {
  echo "停止所有进程..."
  pkill -f mock_target.py 2>/dev/null || true
  pkill -f 'scope-relay\|scope_smoke_relay' 2>/dev/null || true
  pkill -f electron-vite 2>/dev/null || true
  rm -f /tmp/scope-smoke-ptyA /tmp/scope-smoke-ptyB
  echo "已停止"
}

case "${1:-start}" in
  stop)
    stop_all
    exit 0
    ;;
  start) ;;
  *)
    echo "用法: $0 [start|stop]"
    exit 1
    ;;
esac

# 先把旧的清掉
stop_all
sleep 0.5

# 1) PTY relay
echo "[1/4] 启动 PTY relay..."
nohup python3 -u -c "
import pty, os, tty, select, signal
ma, sa = pty.openpty(); mb, sb = pty.openpty()
for link, slave in [('/tmp/scope-smoke-ptyA', os.ttyname(sa)), ('/tmp/scope-smoke-ptyB', os.ttyname(sb))]:
    try: os.unlink(link)
    except FileNotFoundError: pass
    os.symlink(slave, link)
for fd in [ma, mb, sa, sb]: tty.setraw(fd)
print('relay up', flush=True)
running = True
def stop(*_): global running; running = False
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
while running:
    try: r,_,_ = select.select([ma,mb],[],[],1.0)
    except: break
    if ma in r:
        try:
            d = os.read(ma, 4096)
            if d: os.write(mb, d)
        except: break
    if mb in r:
        try:
            d = os.read(mb, 4096)
            if d: os.write(ma, d)
        except: break
" > "$LOG_DIR/relay.log" 2>&1 &
RELAY_PID=$!
disown
sleep 0.5

if [ ! -L /tmp/scope-smoke-ptyB ]; then
  echo "FAIL: relay 没起来,看 $LOG_DIR/relay.log"; exit 1
fi
echo "    OK PID=$RELAY_PID /tmp/scope-smoke-ptyB -> $(readlink /tmp/scope-smoke-ptyB)"

# 2) mock_target
echo "[2/4] 启动 mock_target (5fps sin)..."
PYTHONPATH=ref/mcb_host nohup python3 -u ref/mcb_host/tools/mock_target.py \
  --port /tmp/scope-smoke-ptyA --baud 115200 --fps 5 \
  > "$LOG_DIR/mock.log" 2>&1 &
MOCK_PID=$!
disown
sleep 1
echo "    OK PID=$MOCK_PID"

# 3) Node smoke (验证链路)
echo "[3/4] 跑 Node smoke harness (4s)..."
if node --experimental-strip-types scripts/scope-multichannel-smoke.ts 4 \
  > "$LOG_DIR/smoke.log" 2>&1; then
  echo "    OK smoke 通过"
  tail -6 "$LOG_DIR/smoke.log" | sed 's/^/      /'
else
  echo "    FAIL smoke 没通过,看 $LOG_DIR/smoke.log"
  stop_all
  exit 1
fi

# 4) 启 GUI
echo "[4/4] 启动 GUI (MOTRA_SCOPE_DEMO=1 自动连)..."
# 用 env 命令确保 MOTRA_SCOPE_DEMO 传到 npm → electron 子进程
env MOTRA_SCOPE_DEMO=1 nohup npm run dev > "$LOG_DIR/electron.log" 2>&1 &
disown
sleep 8

cat <<EOF

================================================================
smoke 环境就绪
================================================================
  relay:    PID=$RELAY_PID  log=$LOG_DIR/relay.log
  mock:     PID=$MOCK_PID   log=$LOG_DIR/mock.log
  electron: log=$LOG_DIR/electron.log

链路:
  /tmp/scope-smoke-ptyA (mock 写)
  /tmp/scope-smoke-ptyB (GUI 读, 已自动连)

下一步:
  - 看 scope 窗口:已经自动开了,Ia 蓝/Speed 橙 两道波形在动
  - 手动验证:拖 bias slider, 改 V/div, 点颜色色块, 取消 CH2
  - 看状态栏: frames 累加、dropped=0、connected 绿点

停止:
  bash scripts/scope-smoke.sh stop
================================================================
EOF
