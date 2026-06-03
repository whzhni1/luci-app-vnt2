#!/bin/sh
# VNT2 更新脚本 v1.6

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
    echo "$b B"
}

pm_install() {
    local pkg="$1" rc=0
    shift

    if echo "$pkg" | grep -q '/'; then
        case "$PM" in
            apk)  apk add --allow-untrusted "$pkg" >/dev/null 2>&1 || rc=$? ;;
            opkg) opkg install "$pkg" >/dev/null 2>&1 || rc=$? ;;
        esac

    elif ! command -v "$pkg" >/dev/null 2>&1; then
        echo "  [DEP] Installing $pkg"
        $PM update >/dev/null 2>&1
        case "$PM" in
            apk)  apk add "$pkg" >/dev/null 2>&1 || rc=$? ;;
            opkg) opkg install "$pkg" >/dev/null 2>&1 || rc=$? ;;
        esac
    fi

    [ $rc -eq 0 ] && [ $# -gt 0 ] && "$pkg" "$@"
    return $rc
}

manage_service() {
    local action="$1" name="$2"
    [ -z "$action" ] || [ -z "$name" ] && return
    [ "$name" = "luci-app-vnt2" ] && return
    log "$name" "Service action: $action $name"
    case "$action" in
        restart|start) setsid /etc/init.d/vnt2 "$action" >/dev/null 2>&1 & ;;
        *)             /etc/init.d/vnt2 "$action" >/dev/null 2>&1 ;;
    esac
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
    local url raw file_ext lines
    local slim_json first_release current_tag assets_slim first_asset fname count line

    rm -f "$(log_file "$proj")" "$(status_file "$proj")" \
          "$(cache_full "$proj")" "$(cache_slim "$proj")"

    set_status "$proj" "checking"
    log "$proj" "Checking version: project=$proj mirror=$mirror"

    url="$(api_url "$mirror" "$proj")"
    raw="$(curl -fsSL --connect-timeout 10 --max-time 30 "$url" 2>&1 | sed 's/": /":/g')"

    if [ -z "$raw" ] || ! echo "$raw" | grep -q '"tag_name"'; then
        log "$proj" "API request failed or no version found"
        set_status "$proj" "error:API request failed, please switch mirror"
        return 1
    fi

    file_ext=""
    [ "$proj" = "luci-app-vnt2" ] && file_ext="$EXT"

    if [ -n "$file_ext" ]; then
        lines="$(echo "$raw" | grep -o '"tag_name":"[^"]*"\|https://[^"]*\.'"$file_ext"'[^"]*')"
    else
        lines="$(echo "$raw" | grep -o '"tag_name":"[^"]*"\|https://[^"]*linux[^"]*')"
    fi

    slim_json='{"releases":['
    first_release=1 current_tag="" assets_slim="" first_asset=1

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        case "$line" in
            '"tag_name":"'*)
                if [ -n "$current_tag" ] && [ -n "$assets_slim" ]; then
                    [ "$first_release" -eq 1 ] && first_release=0 || slim_json="${slim_json},"
                    slim_json="${slim_json}{\"tag\":\"$current_tag\",\"filenames\":[$assets_slim]}"
                fi
                current_tag="$(echo "$line" | cut -d'"' -f4)"
                assets_slim="" first_asset=1
                ;;
            https://*)
                fname="${line##*/}"
                [ -z "$fname" ] && continue
                case "$fname" in *sha256*) continue ;; esac
                case "$assets_slim" in *"\"$fname\""*) continue ;; esac
                [ "$first_asset" -eq 1 ] && first_asset=0 || assets_slim="${assets_slim},"
                assets_slim="${assets_slim}\"$fname\""
                ;;
        esac
    done <<EOF
$lines
EOF

    if [ -n "$current_tag" ] && [ -n "$assets_slim" ]; then
        [ "$first_release" -eq 1 ] || slim_json="${slim_json},"
        slim_json="${slim_json}{\"tag\":\"$current_tag\",\"filenames\":[$assets_slim]}"
    fi

    slim_json="${slim_json}]}"
    echo "$raw"       > "$(cache_full "$proj")"
    echo "$slim_json" > "$(cache_slim "$proj")"

    count="$(echo "$slim_json" | grep -o '"tag":' | wc -l | tr -d ' ')"
    log "$proj" "Done, found $count versions"

    if [ "$count" -eq 0 ]; then
        set_status "$proj" "error:No matching file found, please switch mirror"
        return 1
    fi

    set_status "$proj" "ready:$count"
}

verify_download() {
    local proj="$1" tmp="$2"
    local actual
    actual="$(sha256sum "$tmp" 2>/dev/null | cut -d' ' -f1)"
    [ -z "$actual" ] && { log "$proj" "sha256sum unavailable, skipping verification"; return 0; }
    log "$proj" "SHA256: $actual"
    if grep -q "$actual" "$(cache_full "$proj")" 2>/dev/null; then
        log "$proj" "SHA256 verification passed"
        return 0
    else
        log "$proj" "SHA256 verification failed, please re-download"
        rm -f "$tmp"
        return 1
    fi
}

cmd_download() {
    local proj="$1" tag="$2" fnames="$3" upx="${4:-}"
    [ -z "$upx" ] || [ "$upx" = "0" ] && \
        upx="$(uci get vnt2.global.upx_compressed 2>/dev/null || echo 0)"

    rm -f "$(log_file "$proj")"
    set_status "$proj" "downloading"
    log "$proj" "Downloading: tag=$tag files=$fnames upx=$upx"

    [ ! -f "$(cache_full "$proj")" ] && {
        log "$proj" "Cache not found, please check version first"
        set_status "$proj" "error:Please check upstream version first"
        return 1
    }

    local installed="" fname
    for fname in $fnames; do
        local is_lang=0
        case "$fname" in *i18n*) is_lang=1 ;; esac
        if [ $is_lang -eq 1 ]; then
            _download_and_install "$proj" "$fname" "0" \
                && installed="${installed:+${installed}, }${fname}" \
                || log "$proj" "Language pack skipped: $fname"
        else
            _download_and_install "$proj" "$fname" "$upx" || return 1
            installed="${installed:+${installed}, }${fname}"
        fi
    done

    set_status "$proj" "done:${installed:-$fnames}"
}

_do_install() {
    local proj="$1" src="$2" dst="$3" upx="$4"
    chmod 755 "$src"
    if [ "$upx" = "1" ]; then
        log "$proj" "UPX compressing: $(basename "$dst")"
        pm_install upx --no-color -q -q --force "$src" -o "$dst" >> "$(log_file "$proj")" 2>&1 \
            && log "$proj" "UPX succeeded" \
            || { log "$proj" "UPX failed, copying directly"; cp "$src" "$dst"; }
    else
        cp "$src" "$dst"
    fi
    chmod 755 "$dst"
    log "$proj" "Installed: $dst"
}

_download_and_install() {
    local proj="$1" fname="$2" upx="$3"
    local cache dl_url tmp size

    cache="$(cache_full "$proj")"
    dl_url="$(grep -o "https://[^\"']*/${fname}" "$cache" | head -1)"
    [ -z "$dl_url" ] && { log "$proj" "URL not found: $fname"; return 1; }

    tmp="$(tmp_file "$proj" "$fname")"
    rm -f "$tmp"

    curl -fsSL --connect-timeout 15 --max-time 300 \
        --retry 3 --retry-delay 5 \
        -o "$tmp" "$dl_url" >> "$(log_file "$proj")" 2>&1
    local rc=$?

    if [ $rc -ne 0 ] || [ ! -s "$tmp" ]; then
        log "$proj" "Download failed rc=$rc: $fname"
        rm -f "$tmp"
        return 1
    fi

    size="$(wc -c < "$tmp" | tr -d ' ')"
    log "$proj" "Downloaded: $fname $(format_size "$size")"
    verify_download "$proj" "$tmp" || return 1

    set_status "$proj" "installing"
    if [ "$proj" = "luci-app-vnt2" ]; then
        pm_install "$tmp" \
            && log "$proj" "Installed: $fname" \
            || { log "$proj" "Install failed: $fname"; rm -f "$tmp"; return 1; }
        rm -f "$tmp"
    else
        _install_bin "$proj" "$tmp" "$upx"
    fi
}

_install_bin() {
    local proj="$1" tmp="$2" upx="$3"
    local bin_path bins installed="" extract_dir="$CACHE_DIR/${proj}_extract"
    bin_path="$(uci get vnt2.global.bin_path 2>/dev/null || echo /usr/bin)"
    [ "$proj" = "vnt" ] && bins="vnt2_cli vnt2_web vnt2_ctrl" || bins="vnts2"

    local ftype
    ftype="$(file_type "$tmp")"
    log "$proj" "File type: $ftype"
    manage_service stop "$proj"
    case "$ftype" in
        elf)
            local b; b="$(echo "$bins" | cut -d' ' -f1)"
            _do_install "$proj" "$tmp" "${bin_path}/${b}" "$upx"
            installed="$b"
            ;;
        gz|zip)
            rm -rf "$extract_dir"; mkdir -p "$extract_dir"
            [ "$ftype" = "gz" ] \
                && tar -xzf "$tmp" -C "$extract_dir" 2>>"$(log_file "$proj")" \
                || pm_install unzip -o  "$tmp" -d "$extract_dir" 2>>"$(log_file "$proj")"
            for b in $bins; do
                local src
                src="$(find "$extract_dir" -name "$b" -type f 2>/dev/null | head -1)"
                [ -z "$src" ] && { log "$proj" "Not found: $b"; continue; }
                [ "$(file_type "$src")" = "elf" ] || { log "$proj" "Not ELF, skipping: $b"; continue; }
                _do_install "$proj" "$src" "${bin_path}/${b}" "$upx"
                installed="${installed:+${installed}, }${b}"
            done
            rm -rf "$extract_dir"
            ;;
        *)
            rm -f "$tmp"
            log "$proj" "Unknown file format"
            set_status "$proj" "error:Unknown file format"
            return 1
            ;;
    esac

    rm -f "$tmp"
    if [ -n "$installed" ]; then
        log "$proj" "Installation complete: $installed"
        manage_service restart "$proj"
        set_status "$proj" "done:$installed"
    else
        log "$proj" "No installable file found"
        set_status "$proj" "error:No installable file found"
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
        f="$(echo "$filenames" | grep "$pattern" | grep -v 'i18n' | head -1)"
        [ -n "$f" ] && { LATEST_FILE="$f"; return 0; }
    done

    LATEST_FILE="$(echo "$filenames" | grep -v 'i18n' | head -1)"
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
    log "$proj" "=== Auto update: $proj ==="

    cmd_check "$proj" "$MIRROR" || return 1

    pick_latest "$proj" "$ARCH" || {
        log "$proj" "No matching file found"
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

    log "$proj" "Local: ${cur_ver:-Not installed}  Upstream: ${latest_ver:-Unknown}"

    if [ -n "$cur_ver" ] && [ -n "$latest_ver" ] && [ "$(printf '%s\n' "$cur_ver" "$latest_ver" | sort -V | tail -1)" = "$cur_ver" ]; then
        log "$proj" "Already up to date, skipping"
        set_status "$proj" "done:Already up to date($cur_ver)"
        return 0
    fi

    log "$proj" "Updating: $LATEST_TAG  $LATEST_FILE"

    local fnames="$LATEST_FILE"
    if [ "$proj" = "luci-app-vnt2" ]; then
        local lang lang_file
        lang=$(
            for f in /usr/lib/lua/luci/i18n/*.lmo; do
                [ -f "$f" ] || continue
                tmp="${f%.lmo}"
                echo "${tmp##*.}"
            done | sort | uniq -c | sort -nr | head -n1 | awk '{print $2}'
        )
        if [ -n "$lang" ]; then
            local slim; slim="$(cache_slim "$proj")"
            lang_file=$(grep -oE '"[^"]*i18n[^"]*'"$lang"'[^"]*"' "$slim" | tr -d '"' | head -1)
            [ -n "$lang_file" ] && fnames="$fnames $lang_file" && \
                log "$proj" "Language pack detected: $lang_file"
        fi
    fi

    cmd_download "$proj" "$LATEST_TAG" "$fnames" "$UPX"
}

cmd_auto_update() {
    load_uci
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting auto update mirror=$MIRROR arch=$ARCH"
    local projects="${*:-vnt vnts luci-app-vnt2}"
    for proj in $projects; do
        auto_update_one "$proj" || true
        log "auto" "[$proj] $(cat "$(status_file "$proj")" 2>/dev/null)"
    done

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done"
}

case "$1" in
    check)    cmd_check    "$2" "$3"           ;;
    download) cmd_download "$2" "$3" "$4" "$5" ;;
    *)        cmd_auto_update "$@"             ;;
esac