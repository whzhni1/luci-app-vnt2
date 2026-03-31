'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require poll';

return view.extend({
	render: function() {
		var logEl = E('pre', {
			id: 'vnt2_log',
			style: 'white-space:pre-wrap;background:#f5f5f5;padding:12px;' +
			       'border:1px solid #ddd;max-height:600px;overflow:auto;font-size:12px'
		}, '加载中...');

		function refreshLog() {
			return L.resolveDefault(
				fs.exec_direct('/usr/share/vnt2/vnt2_api.sh', ['log', '200']), ''
			).then(function(txt) {
				logEl.textContent = txt || '暂无日志';
				logEl.scrollTop = logEl.scrollHeight;
			});
		}

		function exportLog() {
			return L.resolveDefault(
				fs.exec_direct('/usr/share/vnt2/vnt2_api.sh', ['export_log']), ''
			).then(function(txt) {
				var blob = new Blob([txt || ''], { type: 'text/plain' });
				var a = document.createElement('a');
				a.href = URL.createObjectURL(blob);
				a.download = 'vnt2_log_' + new Date().toISOString().slice(0, 10) + '.txt';
				a.click();
				URL.revokeObjectURL(a.href);
			});
		}

		var body = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'VNT2 日志'),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { style: 'margin-bottom:10px' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						click: function() { refreshLog(); }
					}, '刷新日志'),
					' ',
					E('button', {
						'class': 'btn cbi-button',
						click: function() { exportLog(); }
					}, '导出日志')
				]),
				logEl
			])
		]);

		refreshLog();
		poll.add(function() { return refreshLog(); }, 10);

		return body;
	},

	handleSaveApply: null, handleSave: null, handleReset: null
});
