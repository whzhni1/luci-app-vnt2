#!/bin/sh
# /usr/libexec/vnt2-run.sh - lightweight procd wrapper for vnt2_web/vnts2

NAME="$1"
LOG_FILE="$2"
INSTANCE_TYPE="$3"
shift 3

CHECK_INTERVAL=100
KILL_RECORD="/tmp/vnt2_log/vnt2_kill_record"
KILL_KEY="${NAME}.${INSTANCE_TYPE}"
SELF_PID=$$
START_TIME=$(date +%s)
KILL_INTERVAL="${KILL_INTERVAL:-$(uci get vnt2.global.kill_interval 2>/dev/null || echo 1800)}"
STARTUP_CHECK_WINDOW="${STARTUP_CHECK_WINDOW:-$(uci get vnt2.global.startup_check_window 2>/dev/null || echo 60)}"
GOT_PUBLIC_ADDR=0
STARTUP_CHECK_DONE=0
ONLINE=0
DNS_LIST="223.5.5.5 119.29.29.29 180.76.76.76"
WEB_RESTORE_FLAG="/tmp/vnt2_log/vnt2_web_restoring"

_load_keys() {
    local v
    if v=$(uci -q get "vnt2.global.$1" 2>/dev/null); then
        printf '%s' "$v"
    else
        printf '%s' "$2"
    fi
}

WEB_SYNC_KEYS=$(_load_keys web_sync_keys "POST /api/config|POST /api/start|POST /api/stop|POST /api/restart")
WEB_START_KEYS=$(_load_keys web_start_keys "Starting VNT service|启用|启动配置|enable|enabled")
WEB_STOP_KEYS=$(_load_keys web_stop_keys "禁用|停用|停止配置|disable|disabled")
WEB_DELETE_KEYS=$(_load_keys web_delete_keys "删除配置|删除|delete config|deleted config|DELETE /api/config")
FAULT_RESTART_KEYS=$(_load_keys fault_restart_keys "Registration failed")
ONLINE_KEYS=$(_load_keys online_keys "public_addr")
ONLINE_EXCLUDE_KEYS=$(_load_keys online_exclude_keys "0.0.0.0:0")

_line_has_key() {
    local line="$1" keys="$2" k oldifs="$IFS"
    [ -n "$keys" ] || return 1
    IFS='|'
    set -- $keys
    IFS="$oldifs"
    for k in "$@"; do
        [ -n "$k" ] || continue
        case "$line" in *"$k"*) return 0 ;; esac
    done
    return 1
}

log() {
    [ "$LOG_TO_FILE" = "1" ] || return
    printf '[%s] >>> %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

rotate_log() {
    LOG_TO_FILE=$(uci get vnt2.global.log_to_file 2>/dev/null || echo 1)
    LOG_ERRORS_ONLY=$(uci get vnt2.global.log_errors_only 2>/dev/null || echo 0)

    [ "$LOG_TO_FILE" = "1" ] || return
    [ -f "$LOG_FILE" ] || return

    local log_max_kb log_max size tmp
    log_max_kb=$(uci get vnt2.global.log_max_kb 2>/dev/null || echo 300)
    log_max=$(( log_max_kb * 1024 ))
    size=$(wc -c < "$LOG_FILE" 2>/dev/null)
    [ "${size:-0}" -ge "$log_max" ] || return

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

_network_ok() {
    local ip
    for ip in $DNS_LIST; do
        ping -c1 -W2 "$ip" >/dev/null 2>&1 && return 0
    done
    return 1
}

_check_and_kill() {
    local now last_time elapsed
    now=$(date +%s)
    mkdir -p "$(dirname "$KILL_RECORD")" 2>/dev/null
    last_time=$(grep "^${KILL_KEY} " "$KILL_RECORD" 2>/dev/null | awk '{print $2}')

    if [ -z "$last_time" ]; then
        sed -i "/^${KILL_KEY} /d" "$KILL_RECORD" 2>/dev/null
        printf '%s %s\n' "$KILL_KEY" "$now" >> "$KILL_RECORD"
        log "First kill, triggering restart..."
        kill "$SELF_PID" 2>/dev/null
        return
    fi

    elapsed=$((now - last_time))
    if [ "${KILL_INTERVAL:-1800}" -le 0 ] || [ "$elapsed" -ge "${KILL_INTERVAL:-1800}" ]; then
        sed -i "/^${KILL_KEY} /d" "$KILL_RECORD" 2>/dev/null
        printf '%s %s\n' "$KILL_KEY" "$now" >> "$KILL_RECORD"
        log "Kill interval reached, triggering restart..."
        kill "$SELF_PID" 2>/dev/null
    else
        log "Skip kill, last/interval ${elapsed}s/${KILL_INTERVAL}s"
    fi
}

_check_startup_timeout() {
    [ "$INSTANCE_TYPE" = "vnt" ] || return
    [ "${STARTUP_CHECK_WINDOW:-60}" -gt 0 ] || return
    [ "$STARTUP_CHECK_DONE" = "1" ] && return
    [ "$GOT_PUBLIC_ADDR" = "1" ] && { STARTUP_CHECK_DONE=1; return; }

    local now elapsed
    now=$(date +%s)
    elapsed=$((now - START_TIME))
    [ "$elapsed" -ge "${STARTUP_CHECK_WINDOW:-60}" ] || return

    STARTUP_CHECK_DONE=1
    if _network_ok; then
        log "No public_addr obtained within ${STARTUP_CHECK_WINDOW}s and network is normal, triggering restart..."
        _check_and_kill
    else
        log "No public_addr within ${STARTUP_CHECK_WINDOW}s, but network unavailable, skip restart..."
    fi
}

_web_sid() {
    printf 'web_%s' "$1" | tr -c 'A-Za-z0-9_' '_' | cut -c1-60
}

_LAST_WEB_SYNC=0

_web_sync_all() {
    local now
    [ -f "$WEB_RESTORE_FLAG" ] && return 0
    now=$(date +%s)
    [ $((now - _LAST_WEB_SYNC)) -lt 3 ] && return 0
    _LAST_WEB_SYNC=$now
    ubus call luci.vnt2 sync_web_state '{}' >/dev/null 2>&1
    /etc/init.d/vnt2 reload >/dev/null 2>&1
}

_web_extract_file() {
    local line="$1" f
    f=$(printf '%s' "$line" | sed -n 's/.*file_name["=: ]\{1,4\}\([A-Za-z0-9._-][A-Za-z0-9._-]*\).*/\1/p' | head -1)
    [ -z "$f" ] && f=$(printf '%s' "$line" | grep -oE '[A-Za-z0-9._-]+\.(toml|vnt)' | head -1)
    printf '%s' "$f"
}

_web_extract_config_name() {
    local line="$1" n
    n=$(printf '%s' "$line" | sed -n 's/.*config_name["=: ]\{1,4\}\([^," }][^," }]*\).*/\1/p' | head -1)
    printf '%s' "$n"
}

_web_record_state() {
    [ "$INSTANCE_TYPE" = "web" ] || return
    [ -f "$WEB_RESTORE_FLAG" ] && return
    local action="$1" file="$2" cfg sid
    [ -n "$file" ] || return

    sid=$(_web_sid "$file")
    cfg=$(_web_extract_config_name "$CURRENT_RAW_LINE")

    case "$action" in
        start|enable|enabled|启用)
            uci set "vnt2.${sid}=vnt"
            uci set "vnt2.${sid}.name=${file}"
            uci set "vnt2.${sid}.file_name=${file}"
            [ -n "$cfg" ] && uci set "vnt2.${sid}.config_name=${cfg}"
            uci set "vnt2.${sid}.enabled=1"
            uci set "vnt2.${sid}.start_method=vnt2_web"
            uci set "vnt2.${sid}.method_set=1"
            uci commit vnt2
            log "Recorded web config state: ${file}=enabled"
            ;;
        stop|disable|disabled|禁用)
            uci set "vnt2.${sid}=vnt"
            uci set "vnt2.${sid}.name=${file}"
            uci set "vnt2.${sid}.file_name=${file}"
            [ -n "$cfg" ] && uci set "vnt2.${sid}.config_name=${cfg}"
            uci set "vnt2.${sid}.enabled=0"
            uci set "vnt2.${sid}.start_method=vnt2_web"
            uci set "vnt2.${sid}.method_set=1"
            uci commit vnt2
            log "Recorded web config state: ${file}=disabled"
            ;;
        delete|deleted|删除|删除配置)
            uci -q delete "vnt2.${sid}"
            uci commit vnt2
            log "Recorded web config deleted: ${file}"
            ;;
    esac

    # 同步 UCI 状态，并刷新 network/firewall 中自动 tun 与端口放行。
    ubus call luci.vnt2 sync_web_state '{}' >/dev/null 2>&1
    /etc/init.d/vnt2 reload >/dev/null 2>&1
}

_web_watch_line() {
    [ "$INSTANCE_TYPE" = "web" ] || return
    CURRENT_RAW_LINE="$1"

    if _line_has_key "$1" "$WEB_SYNC_KEYS"; then
        _web_sync_all
        return
    fi

    local file
    file=$(_web_extract_file "$1")
    [ -n "$file" ] || return

    if _line_has_key "$1" "$WEB_DELETE_KEYS"; then
        _web_record_state delete "$file"
    elif _line_has_key "$1" "$WEB_START_KEYS"; then
        _web_record_state enable "$file"
    elif _line_has_key "$1" "$WEB_STOP_KEYS"; then
        _web_record_state disable "$file"
    fi
}

reader_loop() {
    local count=0 formatted
    rotate_log
    while IFS= read -r line; do
        formatted=$(format_line "$line")

        if [ "$LOG_TO_FILE" = "1" ]; then
            if [ "$LOG_ERRORS_ONLY" = "1" ]; then
                case "$formatted" in
                    *"［ERROR］"*|*"［WARN］"*) printf '%s\n' "$formatted" >> "$LOG_FILE" ;;
                esac
            else
                printf '%s\n' "$formatted" >> "$LOG_FILE"
            fi
        fi

        _web_watch_line "$line"

        if _line_has_key "$line" "$FAULT_RESTART_KEYS"; then
            if [ "$ONLINE" = "0" ]; then
                if _network_ok; then
                    _check_and_kill
                else
                    log "Network unavailable, skip restart..."
                fi
            fi
        elif _line_has_key "$line" "$ONLINE_KEYS"; then
            if _line_has_key "$line" "$ONLINE_EXCLUDE_KEYS"; then
                :
            else
                GOT_PUBLIC_ADDR=1
                ONLINE=1
            fi
        fi

        _check_startup_timeout

        count=$((count + 1))
        if [ $((count % CHECK_INTERVAL)) -eq 0 ]; then
            rotate_log
            count=0
        fi
    done
}

if [ "$INSTANCE_TYPE" = "web" ]; then
    WEB_DATA_DIR="${VNT_WEB_DATA_DIR:-/vnt_config}"
    mkdir -p "$WEB_DATA_DIR" 2>/dev/null
    _web_parent=$(dirname "$WEB_DATA_DIR")
    _web_base=$(basename "$WEB_DATA_DIR")
    if [ "$_web_base" != "vnt_config" ]; then
        if [ -L "$_web_parent/vnt_config" ]; then
            ln -sfn "$WEB_DATA_DIR" "$_web_parent/vnt_config" 2>/dev/null
        elif [ ! -e "$_web_parent/vnt_config" ]; then
            ln -s "$WEB_DATA_DIR" "$_web_parent/vnt_config" 2>/dev/null
        fi
    fi
    cd "$_web_parent" 2>/dev/null || cd / 2>/dev/null
fi

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE" 2>/dev/null
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

