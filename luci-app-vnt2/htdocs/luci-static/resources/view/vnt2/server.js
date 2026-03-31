'use strict';
'require view';
'require form';

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('vnt2', '服务端配置',
			'配置 VNT2 服务端 (vnts2)。带 * 的为必填项，监听地址至少填写一个。');

		/* ── 主配置 ── */
		s = m.section(form.NamedSection, 'server', 'server');
		s.addremove = false;
		s.anonymous = true;

		s.tab('basic',   '基本设置');
		s.tab('bind',    '监听地址');
		s.tab('web',     'Web 管理');
		s.tab('tls',     'TLS 证书');
		s.tab('cluster', '服务端互联');

		/* == 基本设置 == */

		o = s.taboption('basic', form.Flag, 'enabled', '启用');
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'network', '* 默认虚拟网段',
			'必填。服务端使用的默认虚拟网络段');
		o.placeholder = '10.26.0.0/24';
		o.rmempty = false;

		o = s.taboption('basic', form.DynamicList, 'white_list', '网络编号白名单',
			'留空表示允许所有编号。可添加多个允许的网络编号');
		o.placeholder = 'my-network-code';

		o = s.taboption('basic', form.Value, 'lease_duration', 'IP 租约时长（秒）',
			'设备离线超过此时间后 IP 将被回收');
		o.datatype = 'uinteger';
		o.placeholder = '86400';

		o = s.taboption('basic', form.Flag, 'persistence', '数据持久化',
			'启用后服务端数据在重启后保留');
		o.default = '1';

		/* == 监听地址 == */

		o = s.taboption('bind', form.Value, 'tcp_bind', 'TCP 监听地址',
			'留空不启用 TCP。至少需要启用一个协议');
		o.placeholder = '0.0.0.0:29872';

		o = s.taboption('bind', form.Value, 'quic_bind', 'QUIC 监听地址',
			'留空不启用 QUIC。至少需要启用一个协议');
		o.placeholder = '0.0.0.0:29872';

		o = s.taboption('bind', form.Value, 'ws_bind', 'WSS 监听地址',
			'留空不启用 WSS。至少需要启用一个协议');
		o.placeholder = '0.0.0.0:29872';

		/* == Web 管理 == */

		o = s.taboption('web', form.Value, 'web_bind', '* Web 管理端绑定地址',
			'必填。管理端 Web 界面的监听地址');
		o.placeholder = '0.0.0.0:29871';
		o.rmempty = false;

		o = s.taboption('web', form.Value, 'username', '* 管理端用户名',
			'必填。登录 Web 管理端的用户名');
		o.placeholder = 'admin';
		o.rmempty = false;

		o = s.taboption('web', form.Value, 'password', '* 管理端密码',
			'必填。登录 Web 管理端的密码');
		o.password = true;
		o.placeholder = 'admin';
		o.rmempty = false;

		/* == TLS 证书 == */

		o = s.taboption('tls', form.Value, 'cert', '证书路径',
			'TLS 证书文件路径，留空将自动生成');
		o.placeholder = '/etc/vnt2/cert.pem';

		o = s.taboption('tls', form.Value, 'key', '私钥路径',
			'TLS 私钥文件路径，留空将自动生成');
		o.placeholder = '/etc/vnt2/key.pem';

		/* == 服务端互联 == */

		o = s.taboption('cluster', form.Value, 'server_quic_bind',
			'服务端互联 QUIC 端口',
			'服务端之间通信的 UDP 端口，留空不启用服务互联');
		o.placeholder = '0.0.0.0:29873';

		o = s.taboption('cluster', form.DynamicList, 'peer_servers',
			'其他服务器地址',
			'其他互联服务器地址列表，可添加多个');
		o.placeholder = 'server1.example.com:29873';

		o = s.taboption('cluster', form.Value, 'server_token', '服务器验证码',
			'服务器之间身份验证的密钥');
		o.password = true;

		/* ── 自定义虚拟网段 ── */
		s = m.section(form.TableSection, 'custom_net', '自定义虚拟网段',
			'为不同的网络编号指定特定的虚拟子网');
		s.addremove = true;
		s.anonymous = true;

		o = s.option(form.Value, 'code', '* 网络编号');
		o.rmempty = false;

		o = s.option(form.Value, 'network', '* 网段');
		o.placeholder = '10.25.0.0/24';
		o.rmempty = false;

		return m.render();
	}
});
