#!/bin/sh
# VNT2 更新脚本 v1.2

CACHE_DIR="/tmp/vnt2_update"
mkdir -p "$CACHE_DIR"

PM="" EXT=""
command -v apk  >/dev/null 2>&1 && { PM=apk  EXT=apk; }
command -v opkg >/dev/null 2>&1 && { PM=opkg EXT=ipk; }

cache_full()  { echo "$CACHE_DIR/$1.full.json"; }
cache_slim()  { echo "$CACHE_DIR/$1.slim.json"; }
status_file() { echo "$CACHE_DIR/$1.status";    }
log_file()    { echo "$CACHE_DIR/$1.log";       }
tmp_file()    { echo "$CACHE_DIR/$2";           }

log() {
    local f="$(log_file "$1")"; shift
    echo "[$(date '+%H:%M:%S')] $*" >> "$f"
}

set_status() { echo "$2" > "$(status_file "$1")"; }

format_size() {
    local b="$1"
    [ "$b" -gt 1048576 ] && echo "$((b/1048576)) MB" && return
    [ "$b" -gt 1024 ]    && echo "$((b/1024)) KB"    && return
    echo "$b 字节"
}

pm_install() {
    local pkg="$1" mode="$2" rc=0
    case "$PM" in
        apk)
            [ "$mode" = "local" ] \
                && apk add --allow-untrusted "$pkg" >/dev/null 2>&1 || rc=$? \
                || apk add                  "$pkg" >/dev/null 2>&1 || rc=$?
            ;;
        opkg)
            [ "$mode" = "local" ] \
                && opkg install --force-reinstall "$pkg" >/dev/null 2>&1 || rc=$? \
                || opkg install               "$pkg" >/dev/null 2>&1 || rc=$?
            ;;
        *) rc=1 ;;
    esac
    return $rc
}

manage_service() {
    local action="$1" name="$2"
    [ -z "$action" ] || [ -z "$name" ] && return
    [ "$name" = "luci-app-vnt2" ] && return
    log "$name" "服务操作: $action $name"
    /etc/init.d/vnt2 "$action" >/dev/null 2>&1
}

api_url() {
    local mirror="$1" proj="$2"
    case "$mirror" in
        github)     echo "https://api.github.com/repos/vnt-dev/${proj}/releases"                ;;
        gitee)      echo "https://gitee.com/api/v5/repos/whzhni/${proj}/releases"               ;;
        gitlab)     echo "https://gitlab.com/api/v4/projects/whzhni%2F${proj}/releases"         ;;
        cloudflare) echo "https://pub-8a57d35d70d5423aac22a3316867e7ce.r2.dev/${proj}/releases" ;;
        *)          echo "https://api.github.com/repos/vnt-dev/${proj}/releases"                ;;
    esac
}

file_type() {
    local magic=""
    command -v hexdump >/dev/null 2>&1 && \
        magic="$(dd if="$1" bs=4 count=1 2>/dev/null | hexdump -e '1/1 "%02x"')"

    if [ -n "$magic" ]; then
        case "$magic" in
            7f454c46*) echo "elf"     ;;
            1f8b*)     echo "gz"      ;;
            504b0304*) echo "zip"     ;;
            *)         echo "unknown" ;;
        esac
        return
    fi

    case "$1" in
        *.tar.gz|*.tgz) echo "gz"  ;;
        *.zip)           echo "zip" ;;
        *)               echo "elf" ;;
    esac
}

load_uci() {
    MIRROR="$(uci get vnt2.global.mirror          2>/dev/null || echo github)"
    ARCH="$(uci get vnt2.global.arch              2>/dev/null || uname -m)"
    BIN_PATH="$(uci get vnt2.global.bin_path      2>/dev/null || echo /usr/bin)"
    UPX="$(uci get vnt2.global.upx_compressed     2>/dev/null || echo 0)"
    AUTO_UPDATE="$(uci get vnt2.global.auto_update 2>/dev/null || echo 0)"
}

cmd_check() {
    local proj="$1" mirror="${2:-github}"
    pm_install curl

    rm -f "$(log_file "$proj")" "$(status_file "$proj")" \
          "$(cache_full "$proj")" "$(cache_slim "$proj")"

    set_status "$proj" "checking"
    log "$proj" "检查版本: project=$proj mirror=$mirror"

    local url raw
    url="$(api_url "$mirror" "$proj")"
    # log "$proj" "API: $url"

    raw="$(curl -fsSL --connect-timeout 10 --max-time 30 "$url" 2>&1 | sed 's/": /":/g')"

    if [ -z "$raw" ] || ! echo "$raw" | grep -q '"tag_name"'; then
        log "$proj" "API请求失败或无版本"
        set_status "$proj" "error:API请求失败，请切换镜像源"
        return 1
    fi

    local file_ext=""
    [ "$proj" = "luci-app-vnt2" ] && file_ext="$EXT"

    local full_json='{"releases":[' slim_json='{"releases":['
    local first_release=1
    local tags_file="$CACHE_DIR/${proj}_tags.tmp"
    local urls_file="$CACHE_DIR/${proj}_urls.tmp"

    echo "$raw" | grep -o '"tag_name":"[^"]*"' | cut -d'"' -f4 > "$tags_file"

    while IFS= read -r tag; do
        [ -z "$tag" ] && continue

        if [ -n "$file_ext" ]; then
            echo "$raw" | grep -o "https://[^\"']*${proj}[^\"']*\\.${file_ext}" > "$urls_file"
        else
            echo "$raw" | grep -o "https://[^\"']*${proj}[^\"']*linux[^\"']*" > "$urls_file"
        fi

        local assets_full="" assets_slim="" first_asset=1

        while IFS= read -r furl; do
            [ -z "$furl" ] && continue
            local fname
            fname="$(echo "$furl" | grep -o '[^/]*$')"
            [ -z "$fname" ] && continue

            [ "$first_asset" -eq 1 ] && first_asset=0 \
                || { assets_full="${assets_full},"; assets_slim="${assets_slim},"; }

            assets_full="${assets_full}{\"name\":\"${fname}\",\"url\":\"${furl}\"}"
            assets_slim="${assets_slim}\"${fname}\""
        done < "$urls_file"

        rm -f "$urls_file"
        [ -z "$assets_full" ] && continue

        [ "$first_release" -eq 1 ] && first_release=0 \
            || { full_json="${full_json},"; slim_json="${slim_json},"; }

        full_json="${full_json}{\"tag\":\"${tag}\",\"assets\":[${assets_full}]}"
        slim_json="${slim_json}{\"tag\":\"${tag}\",\"filenames\":[${assets_slim}]}"

    done < "$tags_file"
    rm -f "$tags_file"

    full_json="${full_json}]}"
    slim_json="${slim_json}]}"

    echo "$full_json" > "$(cache_full "$proj")"
    echo "$slim_json" > "$(cache_slim "$proj")"

    local count
    count="$(grep -o '"tag":' "$(cache_full "$proj")" | wc -l | tr -d ' ')"
    log "$proj" "完成，共 $count 个版本"

    if [ "$count" -eq 0 ]; then
        set_status "$proj" "error:未找到匹配文件，请切换镜像源"
        return 1
    fi

    set_status "$proj" "ready:$count"
}

cmd_download() {
    local proj="$1" tag="$2" fname="$3" upx="${4:-}"
    pm_install curl

    [ -z "$upx" ] || [ "$upx" = "0" ] && \
        upx="$(uci get vnt2.global.upx_compressed 2>/dev/null || echo 0)"

    rm -f "$(log_file "$proj")"
    set_status "$proj" "downloading"
    log "$proj" "下载: tag=$tag file=$fname upx=$upx"

    local cache dl_url
    cache="$(cache_full "$proj")"
    [ ! -f "$cache" ] && {
        log "$proj" "缓存不存在，请先检查版本"
        set_status "$proj" "error:请先检查上游版本"
        return 1
    }

    dl_url="$(grep -o "https://[^\"']*/${fname}" "$cache" | head -1)"
    [ -z "$dl_url" ] && {
        log "$proj" "未找到下载链接: $fname"
        set_status "$proj" "error:未找到下载链接，请重新检查版本"
        return 1
    }

    # log "$proj" "URL: $dl_url"

    local tmp
    tmp="$(tmp_file "$proj" "$fname")"
    rm -f "$tmp"

    curl -fsSL --connect-timeout 15 --max-time 300 \
        --retry 3 --retry-delay 5 \
        -o "$tmp" "$dl_url" >> "$(log_file "$proj")" 2>&1
    local rc=$?

    if [ $rc -ne 0 ] || [ ! -s "$tmp" ]; then
        log "$proj" "下载失败 rc=$rc"
        set_status "$proj" "error:下载失败(rc=$rc)，请切换镜像源"
        rm -f "$tmp"
        return 1
    fi

    local size
    size="$(wc -c < "$tmp" | tr -d ' ')"
    log "$proj" "下载完成: $(format_size "$size")"

    set_status "$proj" "installing"
    log "$proj" "开始安装..."

    if [ "$proj" = "luci-app-vnt2" ]; then
        pm_install "$tmp" local \
            && { log "$proj" "安装成功"; set_status "$proj" "done:luci-app-vnt2"; } \
            || { log "$proj" "安装失败"; set_status "$proj" "error:包安装失败";   }
        rm -f "$tmp"
    else
        _install_bin "$proj" "$tmp" "$upx"
    fi
}

_do_install() {
    local proj="$1" src="$2" dst="$3" upx="$4"
    chmod 755 "$src"
    if [ "$upx" = "1" ]; then
        pm_install upx
        log "$proj" "UPX压缩: $(basename "$dst")"
        upx --no-color -q -q --force "$src" -o "$dst" >> "$(log_file "$proj")" 2>&1 \
            && log "$proj" "UPX成功" \
            || { log "$proj" "UPX失败，直接复制"; cp "$src" "$dst"; }
    else
        cp "$src" "$dst"
    fi
    chmod 755 "$dst"
    log "$proj" "已安装: $dst"
}

_install_bin() {
    local proj="$1" tmp="$2" upx="$3"
    local bin_path bins installed="" extract_dir="$CACHE_DIR/${proj}_extract"
    bin_path="$(uci get vnt2.global.bin_path 2>/dev/null || echo /usr/bin)"
    [ "$proj" = "vnt" ] && bins="vnt2_cli vnt2_web vnt2_ctrl" || bins="vnts2"

    local ftype
    ftype="$(file_type "$tmp")"
    log "$proj" "文件类型: $ftype"
    manage_service stop "$proj"
    case "$ftype" in
        elf)
            local b; b="$(echo "$bins" | cut -d' ' -f1)"
            _do_install "$proj" "$tmp" "${bin_path}/${b}" "$upx"
            installed="$b"
            ;;
        gz|zip)
            pm_install unzip
            rm -rf "$extract_dir"; mkdir -p "$extract_dir"
            [ "$ftype" = "gz" ] \
                && tar -xzf "$tmp" -C "$extract_dir" 2>>"$(log_file "$proj")" \
                || unzip -o  "$tmp" -d "$extract_dir" 2>>"$(log_file "$proj")"
            for b in $bins; do
                local src
                src="$(find "$extract_dir" -name "$b" -type f 2>/dev/null | head -1)"
                [ -z "$src" ] && { log "$proj" "未找到: $b"; continue; }
                [ "$(file_type "$src")" = "elf" ] || { log "$proj" "非ELF跳过: $b"; continue; }
                _do_install "$proj" "$src" "${bin_path}/${b}" "$upx"
                installed="${installed:+${installed}, }${b}"
            done
            rm -rf "$extract_dir"
            ;;
        *)
            rm -f "$tmp"
            log "$proj" "未知文件格式"
            set_status "$proj" "error:未知文件格式"
            return 1
            ;;
    esac

    rm -f "$tmp"
    if [ -n "$installed" ]; then
        log "$proj" "安装完成: $installed"
        manage_service restart "$proj"
        set_status "$proj" "done:$installed"
    else
        log "$proj" "未找到可安装文件"
        set_status "$proj" "error:未找到可安装文件"
    fi
}

pick_latest() {
    local proj="$1" arch="$2"
    LATEST_TAG="" LATEST_FILE=""

    local slim; slim="$(cache_slim "$proj")"
    [ ! -f "$slim" ] && return 1

    LATEST_TAG="$(grep -oE '"tag":"[^"]*"' "$slim" | head -1 | cut -d'"' -f4)"
    [ -z "$LATEST_TAG" ] && return 1

    local filenames
    filenames="$(grep -o '"filenames":\[[^]]*\]' "$slim" | head -1 \
                 | grep -oE '"[^"]+\.[^"]+"' | tr -d '"')"

    local f
    for pattern in "$arch" "$(echo "$arch" | cut -d'_' -f1)"; do
        f="$(echo "$filenames" | grep "$pattern" | head -1)"
        [ -n "$f" ] && { LATEST_FILE="$f"; return 0; }
    done

    LATEST_FILE="$(echo "$filenames" | head -1)"
    [ -n "$LATEST_FILE" ]
}

extract_version() {
    grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1
}

installed_version() {
    local bin="$1"
    [ ! -x "$bin" ] && echo "" && return
    "$bin" --version 2>/dev/null | extract_version
}

auto_update_one() {
    local proj="$1"
    log "$proj" "=== 自动更新: $proj ==="

    cmd_check "$proj" "$MIRROR" || return 1

    pick_latest "$proj" "$ARCH" || {
        log "$proj" "无法匹配合适文件"
        return 1
    }

    local latest_ver cur_ver raw_ver
    latest_ver="$(echo "$LATEST_TAG" | extract_version)"

    case "$proj" in
        vnt)  cur_ver="$(installed_version "$BIN_PATH/vnt2_cli")" ;;
        vnts) cur_ver="$(installed_version "$BIN_PATH/vnts2")"    ;;
        luci-app-vnt2)
            case "$PM" in
                apk)  raw_ver="$(apk info luci-app-vnt2 2>/dev/null | head -1)" ;;
                opkg) raw_ver="$(opkg info luci-app-vnt2 2>/dev/null | grep '^Version:')" ;;
                *)    raw_ver="" ;;
            esac
            cur_ver="$(echo "$raw_ver" | extract_version)"
            ;;
    esac

    log "$proj" "本地: ${cur_ver:-未安装}  上游: ${latest_ver:-未知}"

    if [ -n "$cur_ver" ] && [ -n "$latest_ver" ] && [ "$(printf '%s\n' "$cur_ver" "$latest_ver" | sort -V | tail -1)" = "$cur_ver" ]; then
        log "$proj" "已是最新，跳过"
        set_status "$proj" "done:已是最新($cur_ver)"
        return 0
    fi

    log "$proj" "执行更新: $LATEST_TAG  $LATEST_FILE"
    cmd_download "$proj" "$LATEST_TAG" "$LATEST_FILE" "$UPX"
}

cmd_auto_update() {
    load_uci
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始自动更新 mirror=$MIRROR arch=$ARCH"
    for proj in vnt vnts luci-app-vnt2; do
        auto_update_one "$proj" || true
        echo "[$proj] $(cat "$(status_file "$proj")" 2>/dev/null)"
    done

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 完成"
}

case "$1" in
    check)    cmd_check    "$2" "$3"           ;;
    download) cmd_download "$2" "$3" "$4" "$5" ;;
    *)        cmd_auto_update                  ;;
esac