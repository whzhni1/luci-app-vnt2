'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require uci';
'require dom';

/* ── 版本状态渲染 ── */
function verText(version, exists) {
	if (!exists) return E('span', { style: 'color:#c43c35;font-weight:bold' }, '未安装');
	return E('span', { style: 'color:#46a546;font-weight:bold' }, version || '已安装');
}

function infoTable(arch, ver) {
	var rows = [
		['设备架构', arch || '未知'],
		['客户端 (vnt2_cli)', verText(ver.client, ver.client_exists)],
		['服务端 (vnts2)',     verText(ver.server, ver.server_exists)],
		['控制工具 (vnt2_ctrl)', verText(ver.ctrl, ver.ctrl_exists)]
	];
	return E('table', { 'class': 'table', style: 'margin-bottom:16px' },
		[E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, '组件'),
			E('th', { 'class': 'th' }, '状态')
		])].concat(rows.map(function(r) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, r[0]),
				E('td', { 'class': 'td' }, r[1])
			]);
		}))
	);
}

/* ── 下载面板 ── */
function downloadPanel(arch) {
	var versionInput = E('input', {
		type: 'text', placeholder: '例如 v2.0.0',
		style: 'width:200px;margin-right:10px', id: 'dl_ver'
	});
	var sha256Input = E('input', {
		type: 'text', placeholder: 'SHA256 校验值（可选）',
		style: 'width:420px;margin-right:10px', id: 'dl_sha'
	});
	var statusEl = E('pre', {
		id: 'dl_st',
		style: 'white-space:pre-wrap;background:#f5f5f5;padding:8px;' +
		       'border:1px solid #ddd;min-height:40px;font-size:12px;margin-top:10px'
	}, '就绪');

	// 客户端和服务端是两个独立包，ctrl 在 vnt 包内，web 也在 vnt 包内
	// 因此只提供 客户端(含ctrl+web) 和 服务端 两个下载按钮
	var dlItems = [
		{ label: '下载客户端 (vnt2_cli)',  name: 'vnt2_cli',  key: 'client_bin' },
		{ label: '下载服务端 (vnts2)',      name: 'vnts2',     key: 'server_bin' }
	];

	var buttons = dlItems.map(function(item) {
		return E('button', {
			'class': 'btn cbi-button cbi-button-action',
			style: 'margin-right:6px;margin-bottom:6px',
			click: ui.createHandlerFn(this, function() {
				return doDownload(item.name, item.key, arch, statusEl);
			})
		}, item.label);
	});

	var checkBtn = E('button', {
		'class': 'btn cbi-button cbi-button-save',
		style: 'margin-right:6px;margin-bottom:6px',
		click: ui.createHandlerFn(this, function() {
			return doCheckUpdate(statusEl);
		})
	}, '检查更新');

	return E('div', {}, [
		E('div', { style: 'margin-bottom:10px' }, [
			E('label', { style: 'font-weight:bold;margin-right:8px' }, '版本号：'),
			versionInput
		]),
		E('div', { style: 'margin-bottom:10px' }, [
			E('label', { style: 'font-weight:bold;margin-right:8px' }, 'SHA256：'),
			sha256Input
		]),
		E('div', { style: 'margin-bottom:10px' }, buttons.concat([checkBtn])),
		statusEl
	]);
}

function buildUrl(binName, arch) {
	var version = (document.getElementById('dl_ver') || {}).value || '';
	if (!version) return null;

	var mirror = uci.get('vnt2', 'globals', 'mirror') || 'github';
	var base = '';
	switch (mirror) {
		case 'github': base = 'https://github.com/lbl8603/vnt/releases/download'; break;
		case 'gitee':  base = 'https://gitee.com/lbl8603/vnt/releases/download'; break;
		case 'custom': base = uci.get('vnt2', 'globals', 'mirror_url') || ''; break;
	}
	if (!base) return null;
	return base + '/' + version + '/' + binName + '_' + arch;
}

function doDownload(binName, uciKey, arch, statusEl) {
	var url = buildUrl(binName, arch);
	if (!url) {
		statusEl.textContent = '错误：请先填写版本号';
		return;
	}
	var dest = uci.get('vnt2', 'globals', uciKey) || '/usr/bin/' + binName;
	statusEl.textContent = '正在下载 ' + binName + '...\n' + url + '\n目标路径：' + dest;

	return fs.exec('/usr/share/vnt2/vnt2_api.sh', ['download', url, dest])
		.then(function(res) {
			var out = ((res || {}).stdout || '').trim();
			if (out === 'OK') {
				statusEl.textContent += '\n✓ 下载成功';
				var sha = (document.getElementById('dl_sha') || {}).value || '';
				if (sha) {
					return fs.exec('/usr/share/vnt2/vnt2_api.sh', ['sha256', dest, sha])
						.then(function(r2) {
							var o2 = ((r2 || {}).stdout || '').trim();
							statusEl.textContent += '\n' +
								(o2 === 'OK' ? '✓ SHA256 校验通过' : '✗ SHA256 校验失败：' + o2);
						});
				}
			} else {
				statusEl.textContent += '\n✗ 下载失败：' + out;
			}
		})
		.catch(function(e) {
			statusEl.textContent += '\n✗ 错误：' + e.message;
		});
}

function doCheckUpdate(statusEl) {
	statusEl.textContent = '正在检查更新...';
	return L.resolveDefault(
		fs.exec_direct('/usr/share/vnt2/vnt2_api.sh', ['check_update']), '{}'
	).then(function(raw) {
		try {
			var d = JSON.parse(raw);
			if (d.error)
				statusEl.textContent = '检查失败：' + d.error;
			else
				statusEl.textContent = '上游最新版本：' + (d.latest || '未知');
		} catch(e) {
			statusEl.textContent = '解析响应失败';
		}
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('vnt2'),
			L.resolveDefault(fs.exec_direct('/usr/share/vnt2/vnt2_api.sh', ['arch']), ''),
			L.resolveDefault(fs.exec_direct('/usr/share/vnt2/vnt2_api.sh', ['version']), '{}')
		]);
	},

	render: function(data) {
		var arch = (data[1] || '').trim();
		var ver = {};
		try { ver = JSON.parse(data[2]); } catch(e) {}

		var m, s, o;

		m = new form.Map('vnt2', '程序设置',
			'管理二进制文件路径、下载镜像源和自动更新策略。');

		s = m.section(form.NamedSection, 'globals', 'globals');
		s.addremove = false;
		s.anonymous = true;

		s.tab('paths',    '文件路径');
		s.tab('download', '下载与更新');

		/* == 文件路径 == */

		o = s.taboption('paths', form.Value, 'client_bin', '客户端程序路径',
			'vnt2_cli 二进制文件路径');
		o.placeholder = '/usr/bin/vnt2_cli';

		o = s.taboption('paths', form.Value, 'server_bin', '服务端程序路径',
			'vnts2 二进制文件路径');
		o.placeholder = '/usr/bin/vnts2';

		o = s.taboption('paths', form.Value, 'ctrl_bin', '控制工具路径',
			'vnt2_ctrl 二进制文件路径');
		o.placeholder = '/usr/bin/vnt2_ctrl';

		o = s.taboption('paths', form.Value, 'web_bin', 'Web 服务路径',
			'vnt2_web 二进制文件路径');
		o.placeholder = '/usr/bin/vnt2_web';

		o = s.taboption('paths', form.Value, 'server_conf', '服务端配置文件路径',
			'自动生成的 vnts2 TOML 配置文件存放路径');
		o.placeholder = '/var/etc/vnts2.toml';

		/* == 下载与更新 == */

		o = s.taboption('download', form.ListValue, 'mirror', '镜像源',
			'选择下载二进制文件的镜像源');
		o.value('github', 'GitHub');
		o.value('gitee', 'Gitee');
		o.value('custom', '自定义');

		o = s.taboption('download', form.Value, 'mirror_url', '自定义镜像源地址',
			'完整的 releases 下载基础 URL');
		o.depends('mirror', 'custom');
		o.placeholder = 'https://example.com/releases/download';

		o = s.taboption('download', form.ListValue, 'update_policy', '更新策略',
			'选择手动更新或自动定期检查');
		o.value('manual', '手动更新');
		o.value('auto', '自动更新');

		o = s.taboption('download', form.Value, 'update_interval', '自动更新间隔（天）',
			'每隔多少天自动检查并更新');
		o.datatype = 'uinteger';
		o.placeholder = '7';
		o.depends('update_policy', 'auto');

		o = s.taboption('download', form.Flag, 'upx_enabled', 'UPX 压缩',
			'下载完成后自动使用 UPX 压缩二进制文件（需要已安装 upx）');

		/* ── 渲染表单 + 操作面板 ── */
		return m.render().then(function(formEl) {
			var panel = E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '版本信息'),
				infoTable(arch, ver),
				E('hr'),
				E('h3', {}, '下载管理'),
				downloadPanel(arch)
			]);
			return E('div', {}, [formEl, panel]);
		});
	}
});
