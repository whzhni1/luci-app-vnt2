#!/bin/sh
# 统一后端 API
# Usage: vnt2_api.sh <cmd> [args...]

. /lib/functions.sh
config_load vnt2

_g() { local v; config_get v globals "$1" "$2"; echo "$v"; }

CLI_BIN=$(_g client_bin /usr/bin/vnt2_cli)
SRV_BIN=$(_g server_bin /usr/bin/vnts2)
CTL_BIN=$(_g ctrl_bin   /usr/bin/vnt2_ctrl)
WEB_BIN=$(_g web_bin    /usr/bin/vnt2_web)

# ── JSON 转义 ──
json_escape() {
	printf '%s' "$1" | \
		sed 's/\\/\\\\/g;s/"/\\"/g;s/	/\\t/g' | \
		awk '{if(NR>1)printf "\\n";printf "%s",$0}' | \
		sed 's/^/"/;s/$/"/'
}

# ── status ──
cmd_status() {
	local ctrl_port
	config_get ctrl_port client ctrl_port ''
	local pa=""
	[ -n "$ctrl_port" ] && [ "$ctrl_port" != "0" ] && pa="-p $ctrl_port"

	local cpid=$(pgrep -f "$(basename "$CLI_BIN")" 2>/dev/null | head -1)
	local spid=$(pgrep -f "$(basename "$SRV_BIN")" 2>/dev/null | head -1)
	local wpid=$(pgrep -f "$(basename "$WEB_BIN")" 2>/dev/null | head -1)

	local info="" ips="" clients="" route=""
	if [ -n "$cpid" ] && [ -x "$CTL_BIN" ]; then
		info=$($CTL_BIN $pa info    2>/dev/null)
		ips=$($CTL_BIN $pa ips     2>/dev/null)
		clients=$($CTL_BIN $pa clients 2>/dev/null)
		route=$($CTL_BIN $pa route  2>/dev/null)
	fi

	local web_addr
	config_get web_addr client web_addr ''
	local svr_web_bind
	config_get svr_web_bind server web_bind ''

	cat <<-EOF
	{
	  "client_pid": ${cpid:-0},
	  "server_pid": ${spid:-0},
	  "web_pid": ${wpid:-0},
	  "client_web_addr": "${web_addr}",
	  "server_web_bind": "${svr_web_bind}",
	  "info":    $(json_escape "$info"),
	  "ips":     $(json_escape "$ips"),
	  "clients": $(json_escape "$clients"),
	  "route":   $(json_escape "$route")
	}
	EOF
}

# ── hostname ──
cmd_hostname() {
	cat /proc/sys/kernel/hostname 2>/dev/null || uname -n 2>/dev/null || echo "OpenWrt"
}

# ── log ──
cmd_log() {
	local n="${1:-100}"
	logread -e 'vnt2\|vnts2' 2>/dev/null | tail -"$n"
}

# ── arch ──
cmd_arch() {
	local arch=$(uname -m)
	case "$arch" in
		x86_64)  echo "x86_64"  ;;
		aarch64) echo "aarch64" ;;
		armv7*)  echo "armv7"   ;;
		mips)    echo "mips"    ;;
		mipsel)  echo "mipsel"  ;;
		*)       echo "$arch"   ;;
	esac
}

# ── version ──
cmd_version() {
	local cv="" sv="" ctv=""
	[ -x "$CLI_BIN" ] && cv=$("$CLI_BIN" --version 2>/dev/null | awk '{print $NF}')
	[ -x "$SRV_BIN" ] && sv=$("$SRV_BIN" --version 2>/dev/null | awk '{print $NF}')
	[ -x "$CTL_BIN" ] && ctv=$("$CTL_BIN" --version 2>/dev/null | awk '{print $NF}')
	cat <<-EOF
	{
	  "client": "${cv:-}",
	  "server": "${sv:-}",
	  "ctrl":   "${ctv:-}",
	  "client_exists": $([ -x "$CLI_BIN" ] && echo true || echo false),
	  "server_exists": $([ -x "$SRV_BIN" ] && echo true || echo false),
	  "ctrl_exists":   $([ -x "$CTL_BIN" ] && echo true || echo false)
	}
	EOF
}

# ── check_update ──
cmd_check_update() {
	local mirror=$(_g mirror github)
	local api_url=""
	case "$mirror" in
		github) api_url="https://api.github.com/repos/lbl8603/vnt/releases/latest" ;;
		gitee)  api_url="https://gitee.com/api/v5/repos/lbl8603/vnt/releases/latest" ;;
		custom) api_url="$(_g mirror_url)" ;;
	esac
	[ -z "$api_url" ] && { echo '{"error":"未配置镜像源地址"}'; return 1; }

	local resp=$(wget -qO- --timeout=15 "$api_url" 2>/dev/null)
	[ -z "$resp" ] && { echo '{"error":"获取版本信息失败"}'; return 1; }

	local tag=$(echo "$resp" | jsonfilter -e '@.tag_name' 2>/dev/null)
	[ -z "$tag" ] && tag=$(echo "$resp" | jsonfilter -e '@.name' 2>/dev/null)
	echo "{\"latest\":\"${tag:-unknown}\"}"
}

# ── download ──
cmd_download() {
	local url="$1" dest="$2"
	[ -z "$url" ] || [ -z "$dest" ] && { echo "ERR:缺少参数"; return 1; }

	local tmp="${dest}.tmp.$$"
	wget -qO "$tmp" --timeout=60 "$url" 2>/dev/null
	if [ $? -ne 0 ] || [ ! -s "$tmp" ]; then
		rm -f "$tmp"
		echo "ERR:下载失败"
		return 1
	fi
	mv -f "$tmp" "$dest"
	chmod +x "$dest"

	local upx_en=$(_g upx_enabled 0)
	[ "$upx_en" = "1" ] && command -v upx >/dev/null 2>&1 && \
		upx -q --best "$dest" >/dev/null 2>&1

	echo "OK"
}

# ── sha256 ──
cmd_sha256() {
	local file="$1" expected="$2"
	[ -f "$file" ] || { echo "ERR:文件不存在"; return 1; }
	local actual=$(sha256sum "$file" 2>/dev/null | awk '{print $1}')
	if [ "$actual" = "$expected" ]; then
		echo "OK"
	else
		echo "ERR:校验不匹配 预期=$expected 实际=$actual"
		return 1
	fi
}

# ── upx ──
cmd_upx() {
	command -v upx >/dev/null 2>&1 || { echo "ERR:upx未安装"; return 1; }
	local action="$1" file="$2"
	[ -f "$file" ] || { echo "ERR:文件不存在"; return 1; }
	case "$action" in
		compress)   upx -q --best "$file" 2>&1 && echo "OK" ;;
		decompress) upx -q -d "$file" 2>&1 && echo "OK" ;;
		*)          echo "ERR:未知操作" ;;
	esac
}

# ── export_log ──
cmd_export_log() {
	logread -e 'vnt2\|vnts2' 2>/dev/null
}

# ── auto_update ──
cmd_auto_update() {
	local cur=$("$CLI_BIN" --version 2>/dev/null | awk '{print $NF}')
	local latest_json=$(cmd_check_update)
	local latest=$(echo "$latest_json" | jsonfilter -e '@.latest' 2>/dev/null)
	[ -z "$latest" ] || [ "$latest" = "unknown" ] && return 0
	[ "$cur" = "$latest" ] && return 0

	local mirror=$(_g mirror github)
	local arch=$(cmd_arch)
	local base=""
	case "$mirror" in
		github) base="https://github.com/lbl8603/vnt/releases/download/${latest}" ;;
		gitee)  base="https://gitee.com/lbl8603/vnt/releases/download/${latest}" ;;
		custom) base="$(_g mirror_url)/${latest}" ;;
	esac
	[ -z "$base" ] && return 1

	# vnt2_cli 和 vnts2 各自是独立压缩包，ctrl在vnt包内
	for bin_name in vnt2_cli vnts2 vnt2_ctrl; do
		local dest
		case "$bin_name" in
			vnt2_cli)  dest="$CLI_BIN" ;;
			vnts2)     dest="$SRV_BIN" ;;
			vnt2_ctrl) dest="$CTL_BIN" ;;
		esac
		cmd_download "${base}/${bin_name}_${arch}" "$dest" >/dev/null 2>&1
	done

	/etc/init.d/vnt2_client restart 2>/dev/null
	/etc/init.d/vnt2_server restart 2>/dev/null
	logger -t vnt2_update "已更新至 $latest"
}

# ── setup_cron ──
cmd_setup_cron() {
	crontab -l 2>/dev/null | grep -v 'vnt2_api.sh' | crontab -
	local policy=$(_g update_policy manual)
	local interval=$(_g update_interval 7)
	if [ "$policy" = "auto" ]; then
		(crontab -l 2>/dev/null
		 echo "0 3 */${interval} * * /usr/share/vnt2/vnt2_api.sh auto_update >/dev/null 2>&1"
		) | crontab -
	fi
}

# ── 路由入口 ──
case "$1" in
	status)       cmd_status ;;
	hostname)     cmd_hostname ;;
	log)          cmd_log "$2" ;;
	arch)         cmd_arch ;;
	version)      cmd_version ;;
	check_update) cmd_check_update ;;
	download)     cmd_download "$2" "$3" ;;
	sha256)       cmd_sha256 "$2" "$3" ;;
	upx)          cmd_upx "$2" "$3" ;;
	export_log)   cmd_export_log ;;
	auto_update)  cmd_auto_update ;;
	setup_cron)   cmd_setup_cron ;;
	*) echo "Usage: $0 {status|hostname|log|arch|version|check_update|download|sha256|upx|export_log|auto_update|setup_cron}"; exit 1 ;;
esac
