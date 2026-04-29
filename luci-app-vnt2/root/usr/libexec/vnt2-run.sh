#!/bin/sh
# /usr/libexec/vnt2-run.sh # VNT2 wrapper v1.0

NAME="$1"
LOG_FILE="$2"
shift 2

LOG_MAX=$((300 * 1024))

log() {
    printf '[%s] >>> %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

rotate_log() {
    [ -f "$LOG_FILE" ] || return
    local size
    size=$(wc -c < "$LOG_FILE" 2>/dev/null)
    [ "${size:-0}" -ge "$LOG_MAX" ] && {
        local tmp
        tmp=$(mktemp)
        tail -c $((LOG_MAX / 2)) "$LOG_FILE" > "$tmp" \
            && mv "$tmp" "$LOG_FILE"
        log "日志已自动截断（超过 300KB）"
    }
}

format_line() {
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    printf '%s\n' "$1" \
        | sed "s/^\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)T\([0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}\)\.[^[:space:]]* /[${ts}] /"
}

rotate_log
log "启动: $*"
FIFO=$(mktemp -u)
mkfifo "$FIFO"
while IFS= read -r line; do
    format_line "$line" >> "$LOG_FILE"
done < "$FIFO" &
READER_PID=$!
exec "$@" > "$FIFO" 2>&1
EXIT_CODE=$?
log "启动失败 exit=${EXIT_CODE} cmd: $*"
kill "$READER_PID" 2>/dev/null
rm -f "$FIFO"
exit "$EXIT_CODE"