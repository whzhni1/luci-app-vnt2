'use strict';
'require view';
'require form';
'require fs';

return view.extend({
	load: function() {
		// 获取主机名用于设备名称预填
		return L.resolveDefault(
			fs.exec_direct('/usr/share/vnt2/vnt2_api.sh', ['hostname']), 'OpenWrt'
		);
	},

	render: function(hostname) {
		hostname = (hostname || 'OpenWrt').trim();

		var m, s, o;

		m = new form.Map('vnt2', '客户端配置',
			'配置 VNT2 客户端，加入虚拟局域网。所有带 * 的为必填项。');

		s = m.section(form.NamedSection, 'client', 'client');
		s.addremove = false;
		s.anonymous = true;

		s.tab('basic',    '基本设置');
		s.tab('network',  '网络设置');
		s.tab('advanced', '高级设置');
		s.tab('mapping',  '端口映射');
		s.tab('web',      'Web 服务');

		/* ===== 基本设置 ===== */

		o = s.taboption('basic', form.Flag, 'enabled', '启用');
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'server', '* 服务器地址',
			'必填。支持 quic:// tcp:// wss:// dynamic:// 协议');
		o.placeholder = 'quic://1.2.3.4:29872';
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'network_code', '* 网络编号',
			'必填。相同编号的设备会组成同一个虚拟局域网');
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'ip', '* 虚拟 IP',
			'必填。分配给本设备的虚拟 IP 地址');
		o.datatype = 'ipaddr';
		o.placeholder = '10.26.0.1';
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'password', '加密密码',
			'设置后启用数据加密传输');
		o.password = true;

		o = s.taboption('basic', form.Value, 'device_name', '设备名称',
			'自定义设备名称，不填则使用系统主机名');
		o.placeholder = hostname;

		o = s.taboption('basic', form.Value, 'device_id', '设备 ID',
			'设备唯一标识符');

		/* ===== 网络设置 ===== */

		o = s.taboption('network', form.DynamicList, 'input', '入栈监听网段',
			'允许接收数据的网段，可添加多条');
		o.placeholder = '10.26.0.0/24';

		o = s.taboption('network', form.DynamicList, 'output', '出栈允许网段',
			'允许发送数据的目标网段，可添加多条');
		o.placeholder = '0.0.0.0/0';

		o = s.taboption('network', form.Value, 'mtu', 'MTU',
			'虚拟网卡的 MTU 值');
		o.datatype = 'range(68,9000)';
		o.placeholder = '1400';

		o = s.taboption('network', form.Value, 'tun_name', '虚拟网卡名称',
			'自定义 TUN 接口名称');
		o.placeholder = 'vnt-tun';

		o = s.taboption('network', form.Flag, 'no_nat', '关闭内置子网 NAT',
			'关闭 VNT 内置的子网 NAT 转换');

		o = s.taboption('network', form.Flag, 'no_tun', '禁用 TUN',
			'禁用后只能作为流量出口或端口映射，无需管理员权限');

		/* ===== 高级设置 ===== */

		o = s.taboption('advanced', form.Flag, 'rtx', 'QUIC 优化传输 (RTX)',
			'启用 QUIC 协议的优化传输模式');

		o = s.taboption('advanced', form.Flag, 'compress', 'LZ4 压缩',
			'启用 LZ4 数据压缩');

		o = s.taboption('advanced', form.Flag, 'fec', '前向纠错 (FEC)',
			'损失一定带宽来提升网络稳定性');

		o = s.taboption('advanced', form.Flag, 'no_punch', '关闭打洞',
			'关闭 NAT 穿透/打洞功能');

		o = s.taboption('advanced', form.ListValue, 'cert_mode', '证书验证模式',
			'服务端证书验证方式');
		o.value('', '默认');
		o.value('verify', '验证');
		o.value('skip', '跳过');

		o = s.taboption('advanced', form.Value, 'ctrl_port', '控制端口',
			'vnt2_ctrl 查询端口，设置 0 禁用控制服务');
		o.datatype = 'port';

		/* ===== 端口映射 ===== */

		o = s.taboption('mapping', form.Flag, 'allow_mapping', '允许作为端口映射出口',
			'开启后其他设备可使用本设备的 IP 作为目标虚拟 IP');

		o = s.taboption('mapping', form.DynamicList, 'port_mapping', '端口映射规则',
			'格式：协议://本地监听地址-目标虚拟IP-目标映射地址<br/>' +
			'示例：tcp://0.0.0.0:8080-10.26.0.2-192.168.1.1:80<br/>' +
			'可添加多条规则');

		/* ===== Web 服务 ===== */

		o = s.taboption('web', form.Flag, 'web_enabled', '启用 VNT Web 服务',
			'随客户端一起启动 vnt2_web 管理界面');

		o = s.taboption('web', form.Value, 'web_addr', 'Web 监听地址',
			'vnt2_web 的 HTTP 监听地址');
		o.placeholder = '0.0.0.0:29870';
		o.depends('web_enabled', '1');

		o = s.taboption('web', form.Value, 'web_conf', 'Web 配置文件路径',
			'加载 vnt 配置路径，留空使用默认');
		o.depends('web_enabled', '1');

		return m.render();
	}
});
