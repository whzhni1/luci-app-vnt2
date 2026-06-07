#!/bin/sh
# /usr/libexec/vnt2-run.sh  VNT2 wrapper v1.5

NAME="$1"
LOG_FILE="$2"
shift 2

CHECK_INTERVAL=100

log() {
    printf '[%s] >>> %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

rotate_log() {
    [ -f "$LOG_FILE" ] || return
    local log_max_kb log_max
    log_max_kb=$(uci get vnt2.global.log_max_kb 2>/dev/null || echo 300)
    log_max=$(( log_max_kb * 1024 ))
    
    local size
    size=$(wc -c < "$LOG_FILE" 2>/dev/null)
    [ "${size:-0}" -ge "$log_max" ] || return
    
    local tmp
    tmp=$(mktemp) || return
    tail -c $((log_max / 2)) "$LOG_FILE" > "$tmp" \
        && mv "$tmp" "$LOG_FILE" \
        && log "Log truncated (exceeded ${log_max_kb}KB)"
}

format_line() {
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    printf '%s\n' "$1" \
        | sed "s/^\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)T\([0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}\)\.[^[:space:]]* /[${ts}] /" \
        | sed 's/\] INFO /\]［INFO］/g;
               s/\] WARN /\]［WARN］/g;
               s/\] ERROR /\]［ERROR］/g;
               s/\] DEBUG /\]［DEBUG］/g'
}

reader_loop() {
    local count=0
    while IFS= read -r line; do
        format_line "$line" >> "$LOG_FILE"
        count=$((count + 1))
        if [ $((count % CHECK_INTERVAL)) -eq 0 ]; then
            rotate_log
            count=0
        fi
    done
}

rotate_log
log "Starting: $*"

FIFO=$(mktemp -u)
mkfifo "$FIFO" || { log "mkfifo failed"; exit 1; }

reader_loop < "$FIFO" &
READER_PID=$!

exec "$@" > "$FIFO" 2>&1
EXIT_CODE=$?

log "Process exited exit=${EXIT_CODE} cmd: $*"
wait "$READER_PID" 2>/dev/null
rm -f "$FIFO"
exit "$EXIT_CODE"