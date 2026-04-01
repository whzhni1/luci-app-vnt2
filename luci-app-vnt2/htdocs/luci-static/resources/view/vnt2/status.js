'use strict';
'require view';
'require poll';
'require fs';
'require ui';
'require uci';
'require dom';
'require rpc';

var callServiceList = rpc.declare({
	object: 'service', method: 'list',
	params: ['name'], expect: { '': {} }
});

var callInitAction = rpc.declare({
	object: 'luci', method: 'setInitAction',
	params: ['name', 'action'], expect: { result: false }
});

function isRunning(name) {
	return L.resolveDefault(callServiceList(name), {}).then(function(res) {
		try { return Object.keys(res[name].instances).length > 0; }
		catch(e) { return false; }
	});
}

function badge(up) {
	return E('span', {
		style: 'color:#fff;padding:3px 12px;border-radius:3px;font-weight:bold;' +
		       'background:' + (up ? '#46a546' : '#c43c35')
	}, up ? '运行中' : '已停止');
}

function svcButtons(initName) {
	var acts = [
		['cbi-button-apply',  '启动',     'start'],
		['cbi-button-reset',  '停止',     'stop'],
		['cbi-button-action', '重启',     'restart'],
		['cbi-button-save',   '开机自启', 'enable'],
		['cbi-button',        '取消自启', 'disable']
	];
	return E('div', { style: 'margin:8px 0' },
		acts.map(function(a) {
			return E('button', {
				'class': 'btn cbi-button ' + a[0],
				style: 'margin-right:6px',
				click: ui.createHandlerFn(this, function() {
					return callInitAction(initName, a[2]).then(function() {
						window.setTimeout(function() { location.reload(); }, 2000);
					});
				})
			}, a[1]);
		})
	);
}

/* ── 从绑定地址中提取端口号 ── */
function extractPort(bindAddr) {
	if (!bindAddr) return null;
	var m = bindAddr.match(/:(\d+)$/);
	return m ? m[1] : null;
}

/* ── 生成 Web 访问按钮 ── */
function webAccessButton(label, bindAddr, running) {
	var port = extractPort(bindAddr);
	if (!port || !running) {
		// 未配置或未运行时返回灰色禁用按钮
		return E('button', {
			'class': 'btn cbi-button',
			disabled: 'disabled',
			style: 'margin-left:10px;opacity:0.5;cursor:not-allowed'
		}, label);
	}
	// 用当前浏览器访问的 IP 拼接端口
	var host = window.location.hostname;
	var url = 'http://' + host + ':' + port;
	return E('a', {
		'class': 'btn cbi-button cbi-button-action',
		href: url,
		target: '_blank',
		rel: 'noopener noreferrer',
		style: 'margin-left:10px;text-decoration:none'
	}, label);
}

function infoPanel(id, title) {
	return E('div', {}, [
		E('h4', {}, title),
		E('pre', {
			id: id,
			style: 'white-space:pre-wrap;background:#f5f5f5;padding:10px;' +
			       'border:1px solid #ddd;max-height:200px;overflow:auto;font-size:12px'
		}, '加载中...')
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('vnt2'),
			isRunning('vnt2_client'),
			isRunning('vnt2_server')
		]);
	},

	render: function(data) {
		var cUp = data[1], sUp = data[2];

		/* 读取 Web 地址配置用于按钮 */
		var clientWebAddr = uci.get('vnt2', 'client', 'web_addr') || '';
		var clientWebOn   = uci.get('vnt2', 'client', 'web_enabled') || '0';
		var serverWebBind = uci.get('vnt2', 'server', 'web_bind') || '';

		var body = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'VNT2 运行状态'),

			/* ── 客户端状态 ── */
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '客户端 (vnt2)'),
				E('div', { style: 'display:flex;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, [
					E('strong', {}, '状态：'),
					E('span', { id: 'cb' }, badge(cUp)),
					E('span', { id: 'cli_web_btn' },
						webAccessButton(
							'🌐 打开 VNT Web 管理',
							clientWebOn === '1' ? clientWebAddr : '',
							cUp
						)
					)
				]),
				svcButtons('vnt2_client'),
				E('div', { id: 'cdet', style: cUp ? '' : 'display:none' }, [
					infoPanel('c_info',    '基本信息'),
					infoPanel('c_ips',     'IP 列表'),
					infoPanel('c_clients', '客户端详情'),
					infoPanel('c_route',   '路由信息')
				])
			]),

			/* ── 服务端状态 ── */
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '服务端 (vnts2)'),
				E('div', { style: 'display:flex;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, [
					E('strong', {}, '状态：'),
					E('span', { id: 'sb' }, badge(sUp)),
					E('span', { id: 'srv_web_btn' },
						webAccessButton(
							'🌐 打开 VNTS Web 管理',
							serverWebBind,
							sUp
						)
					)
				]),
				svcButtons('vnt2_server')
			])
		]);

		/* ── 轮询刷新 ── */
		poll.add(function() {
			return L.resolveDefault(
				fs.exec_direct('/usr/share/vnt2/vnt2_api.sh', ['status']), '{}'
			).then(function(raw) {
				var d = {};
				try { d = JSON.parse(raw); } catch(e) { return; }

				var cRun = (d.client_pid || 0) > 0;
				var sRun = (d.server_pid || 0) > 0;
				var wRun = (d.web_pid || 0) > 0;

				/* 更新状态徽章 */
				dom.content(document.getElementById('cb'), badge(cRun));
				dom.content(document.getElementById('sb'), badge(sRun));

				/* 更新客户端 Web 按钮（只有 web_enabled 且 vnt2_web 进程存在时可用） */
				var cwb = document.getElementById('cli_web_btn');
				if (cwb) {
					dom.content(cwb, webAccessButton(
						'🌐 打开 VNT Web 管理',
						d.client_web_addr || '',
						cRun && wRun
					));
				}

				/* 更新服务端 Web 按钮（服务端运行且配置了 web_bind 时可用） */
				var swb = document.getElementById('srv_web_btn');
				if (swb) {
					dom.content(swb, webAccessButton(
						'🌐 打开 VNTS Web 管理',
						d.server_web_bind || '',
						sRun
					));
				}

				/* 详情面板 */
				var det = document.getElementById('cdet');
				if (det) det.style.display = cRun ? '' : 'none';

				var fields = {
					'c_info': d.info, 'c_ips': d.ips,
					'c_clients': d.clients, 'c_route': d.route
				};
				Object.keys(fields).forEach(function(id) {
					var el = document.getElementById(id);
					if (el) el.textContent = fields[id] || '无数据';
				});
			});
		}, 5);

		return body;
	},

	handleSaveApply: null, handleSave: null, handleReset: null
});
