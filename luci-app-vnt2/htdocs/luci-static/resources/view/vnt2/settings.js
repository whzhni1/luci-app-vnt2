'use strict';
'require view';
'require ui';
'require uci';
'require rpc';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object: 'luci.vnt2', method: method, params: params || [] });
}

var callGetSystemInfo      = rpcDeclare('get_system_info',      []);
var callCheckBinaries      = rpcDeclare('check_binaries',       []);
var callGetUpstreamVersion = rpcDeclare('get_upstream_version', ['project', 'mirror']);
var callGetUpdateStatus    = rpcDeclare('get_update_status',    ['project']);
var callDoUpdate           = rpcDeclare('do_update',            ['project', 'tag', 'filename', 'upx']);
var callSaveSettings       = rpcDeclare('save_settings', [
    'bin_path','config_path','arch','mirror',
    'auto_update','update_interval','upx_compressed',
    'fw_vnt_to_lan','fw_lan_to_vnt',
    'fw_vnt_to_wan','fw_wan_to_vnt',
    'fw_vnt_web','fw_vnts_web'
]);

var MIRROR_OPTIONS = [
    { value: 'github',     label: 'GitHub'     },
    { value: 'gitee',      label: 'Gitee'      },
    { value: 'gitlab',     label: 'GitLab'     },
    { value: 'cloudflare', label: 'Cloudflare' },
];

var COMPONENTS = [
    { name: 'vnt2_cli',  binKey: 'vnt2_cli',  versionKey: 'vnt_version'  },
    { name: 'vnt2_web',  binKey: 'vnt2_web',  versionKey: 'vnt_version'  },
    { name: 'vnt2_ctrl', binKey: 'vnt2_ctrl', versionKey: 'vnt_version'  },
    { name: 'vnts2',     binKey: 'vnts2',     versionKey: 'vnts_version' },
];

var FW_OPTIONS = [
    { key: 'fw_vnt_to_lan', label: 'VNT → LAN', desc: '允许虚拟网络访问本地局域网' },
    { key: 'fw_lan_to_vnt', label: 'LAN → VNT', desc: '允许本地局域网访问虚拟网络' },
    { key: 'fw_vnt_to_wan', label: 'VNT → WAN', desc: '允许虚拟网络访问外网'       },
    { key: 'fw_wan_to_vnt', label: 'WAN → VNT', desc: '允许外网访问虚拟网络'       },
    { key: 'fw_vnt_web',    label: 'VNT Web 外网访问',  desc: '需配置 web_addr'    },
    { key: 'fw_vnts_web',   label: 'VNTS Web 外网访问', desc: '需配置 web_bind'    },
];

return view.extend({

    load: function() {
        return Promise.all([
            L.require('vnt2.common'),
            uci.load('vnt2'),
            callGetSystemInfo(),
            callCheckBinaries()
        ]);
    },

    render: function(data) {
        var self       = this;
        self._ui       = data[0].VNT2UI;
        self._sysinfo  = data[2] || {};
        self._binaries = data[3] || {};
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, 'VNT2 设置与更新'),
            self._buildTabContainer([
                { id: 'tab-settings', label: '设置', content: self._buildSettingsTab() },
                { id: 'tab-update',   label: '更新', content: self._buildUpdateTab()   }
            ])
        ]);
    },

    _getUciSettings: function() {
        var g = function(k) { return uci.get('vnt2', 'global', k); };
        return [
            g('bin_path')                  || '/usr/bin',
            g('config_path')               || '/etc/vnt2_config',
            g('arch')                      || '',
            g('mirror')                    || 'github',
            g('auto_update')               === '1',
            parseInt(g('update_interval')) || 7,
            g('upx_compressed')            === '1',
            g('fw_vnt_to_lan')             === '1',
            g('fw_lan_to_vnt')             === '1',
            g('fw_vnt_to_wan')             === '1',
            g('fw_wan_to_vnt')             === '1',
            g('fw_vnt_web')                === '1',
            g('fw_vnts_web')               === '1',
        ];
    },

    handleSave: function() {
        var self = this;
        return uci.save().then(function() {
            return callSaveSettings.apply(null, self._getUciSettings());
        });
    },

    handleSaveApply: function() {
        var self = this;
        return uci.save()
            .then(function() { return ui.changes.apply(); })
            .then(function() {
                return callSaveSettings.apply(null, self._getUciSettings());
            });
    },

    handleReset: function() {
        return uci.load('vnt2').then(function() { location.reload(); });
    },

    _buildTabContainer: function(tabs) {
        var self   = this;
        var header = E('div', { 'style': 'display:flex;border-bottom:2px solid #ddd;margin-bottom:20px;' });
        var body   = E('div', {});
        tabs.forEach(function(tab, idx) {
            var active = idx === 0;
            header.appendChild(E('div', {
                'data-tab': tab.id,
                'style': [
                    'padding:8px 24px', 'cursor:pointer', 'font-weight:bold', 'margin-bottom:-2px',
                    'border-bottom:' + (active ? '2px solid #3498db' : '2px solid transparent'),
                    'color:'         + (active ? '#3498db' : '#666')
                ].join(';'),
                'click': function(ev) {
                    self._switchTab(ev.currentTarget.getAttribute('data-tab'));
                }
            }, tab.label));
            body.appendChild(E('div', {
                'id': tab.id, 'style': 'display:' + (active ? 'block' : 'none') + ';'
            }, [tab.content]));
        });
        return E('div', {}, [header, body]);
    },

    _switchTab: function(activeId) {
        document.querySelectorAll('[data-tab]').forEach(function(el) {
            var active = el.getAttribute('data-tab') === activeId;
            el.style.borderBottom = active ? '2px solid #3498db' : '2px solid transparent';
            el.style.color        = active ? '#3498db' : '#666';
        });
        ['tab-settings', 'tab-update'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = id === activeId ? 'block' : 'none';
        });
        var footer = document.querySelector('.cbi-page-actions');
        if (footer) footer.style.display = activeId === 'tab-settings' ? '' : 'none';
    },

    _buildSettingsTab: function() {
        var self = this, vui = self._ui;
        var g    = function(k) { return uci.get('vnt2', 'global', k); };

        function buildCheck(id, uciKey) {
            var cb = E('input', { 'type': 'checkbox', 'id': id,
                'change': function() {
                    uci.set('vnt2', 'global', uciKey, this.checked ? '1' : '0');
                }
            });
            if (g(uciKey) === '1') cb.setAttribute('checked', 'checked');
            return cb;
        }

        function buildText(id, uciKey, style, fallback) {
            return E('input', { 'type': 'text', 'class': 'cbi-input-text', 'id': id,
                'value':  g(uciKey) || fallback || '',
                'style':  style || 'width:360px;',
                'change': function() { uci.set('vnt2', 'global', uciKey, this.value.trim()); }
            });
        }

        function buildCheckRow(opt) {
            return vui.buildFormRow(opt.label,
                E('label', { 'style': 'cursor:pointer;user-select:none;' }, [
                    buildCheck('s-' + opt.key, opt.key),
                    E('span', { 'style': 'margin-left:6px;' }, '启用')
                ]), opt.desc || '');
        }

        var mirrorSel = E('select', { 'class': 'cbi-input-select', 'id': 's-mirror',
            'style': 'width:auto;',
            'change': function() { uci.set('vnt2', 'global', 'mirror', this.value); }
        }, MIRROR_OPTIONS.map(function(o) {
            var a = { 'value': o.value };
            if (o.value === (g('mirror') || 'github')) a['selected'] = 'selected';
            return E('option', a, o.label);
        }));

        return E('div', {}, [
            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, '基本设置'),
                vui.buildFormRow('二进制程序路径',
                    buildText('s-bin-path', 'bin_path'),
                    '程序文件所在目录，默认 /usr/bin'),
                vui.buildFormRow('配置文件路径',
                    buildText('s-config-path', 'config_path'),
                    '配置文件存储目录，默认 /etc/vnt2_config'),
                vui.buildFormRow('设备架构',
                    buildText('s-arch', 'arch', 'width:200px;', self._sysinfo.arch || ''),
                    '当前检测：' + (self._sysinfo.arch || '未知')),
                vui.buildFormRow('下载镜像源', mirrorSel, '多镜像源确保成功下载'),
                vui.buildFormRow('自动更新',
                    E('label', { 'style': 'cursor:pointer;user-select:none;' }, [
                        buildCheck('s-auto-update', 'auto_update'),
                        E('span', { 'style': 'margin-left:6px;' }, '启用自动更新')
                    ]), '定期自动检查并更新程序'),
                vui.buildFormRow('更新间隔（天）',
                    E('input', { 'type': 'number', 'class': 'cbi-input-text',
                        'id': 's-interval',
                        'value': g('update_interval') || '7',
                        'min': '1', 'max': '365', 'style': 'width:80px;',
                        'change': function() {
                            uci.set('vnt2', 'global', 'update_interval', this.value || '7');
                        }
                    }), '自动检查更新的间隔天数'),
                vui.buildFormRow('UPX 压缩',
                    E('label', { 'style': 'cursor:pointer;user-select:none;' }, [
                        buildCheck('s-upx', 'upx_compressed'),
                        E('span', { 'style': 'margin-left:6px;' }, '安装后使用 UPX 压缩')
                    ]), '可显著减小程序文件体积')
            ]),
            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, '防火墙转发'),
                E('div', {}, FW_OPTIONS.map(buildCheckRow))
            ])
        ]);
    },

    _buildUpdateTab: function() {
        var self = this, sys = self._sysinfo, bins = self._binaries;
        var thStyle = 'padding:8px 12px;text-align:center;';
        var tdStyle = 'padding:8px 12px;text-align:center;vertical-align:middle;';

        return E('div', { 'class': 'cbi-section' }, [
            E('h3', {}, '当前版本信息'),
            E('div', { 'style': 'width:100%;display:block;margin-bottom:20px;' },
                E('table', {
                    'style': [
                        'width:100%', 'border-collapse:separate', 'border-spacing:0',
                        'border:1px solid #ddd', 'border-radius:8px',
                        'overflow:hidden', 'box-sizing:border-box'
                    ].join(';')
                }, [
                    E('thead', {}, E('tr', {},
                        ['组件', '版本', '状态'].map(function(h) {
                            return E('th', { 'style': thStyle }, h);
                        })
                    )),
                    E('tbody', {}, [
                        E('tr', {}, [
                            E('td', { 'style': tdStyle }, 'luci-app-vnt2'),
                            E('td', { 'style': tdStyle }, sys.luci_version || '未知'),
                            E('td', { 'style': tdStyle + 'color:#28a745;font-weight:bold;' }, '✓ 已安装')
                        ])
                    ].concat(COMPONENTS.map(function(comp) {
                        var installed = !!bins[comp.binKey];
                        return E('tr', {}, [
                            E('td', { 'style': tdStyle }, comp.name),
                            E('td', { 'style': tdStyle },
                                installed ? (sys[comp.versionKey] || '未知') : '未安装'),
                            E('td', { 'style': tdStyle + 'color:' +
                                (installed ? '#28a745' : '#dc3545') + ';font-weight:bold;' },
                                installed ? '✓ 已安装' : '✗ 未安装')
                        ]);
                    })))
                ])
            ),
            E('h3', {}, '检查更新'),
            self._buildUpdateBlock('luci-app-vnt2', 'LuCI 插件（luci-app-vnt2）'),
            E('div', { 'style': 'margin:12px 0;border-top:1px solid #eee;' }),
            self._buildUpdateBlock('vnt',  'VNT 客户端（vnt2_cli / vnt2_web / vnt2_ctrl）'),
            E('div', { 'style': 'margin:12px 0;border-top:1px solid #eee;' }),
            self._buildUpdateBlock('vnts', 'VNTS 服务端（vnts2）')
        ]);
    },

    _buildUpdateBlock: function(project, title) {
        var self   = this;
        var bid    = 'upd-' + project;
        var mirror = uci.get('vnt2', 'global', 'mirror') || 'github';

        return E('div', {
            'style': 'border:1px solid #e0e0e0;border-radius:6px;padding:16px;margin-bottom:12px;'
        }, [
            E('h4', { 'style': 'margin-top:0;margin-bottom:12px;' }, title),
            E('div', { 'style': 'display:flex;align-items:center;gap:10px;' }, [
                E('button', {
                    'class': 'btn cbi-button-action',
                    'id':    bid + '-check-btn',
                    'click': function() { self._checkUpstream(project, bid); }
                }, '检查上游版本'),
                E('span', { 'id': bid + '-status', 'style': 'font-size:13px;color:#888;' },
                    '点击检查获取版本信息')
            ]),
            E('div', { 'id': bid + '-mirror-row',
                'style': 'display:none;margin-top:8px;align-items:center;gap:8px;' }, [
                E('span', { 'style': 'font-size:13px;color:#666;' }, '切换镜像源重试：'),
                E('select', {
                    'class': 'cbi-input-select',
                    'id':    bid + '-mirror',
                    'style': 'width:auto;'
                }, MIRROR_OPTIONS.map(function(o) {
                    var a = { 'value': o.value };
                    if (o.value === mirror) a['selected'] = 'selected';
                    return E('option', a, o.label);
                })),
                E('button', {
                    'class': 'btn cbi-button-action',
                    'click': function() { self._checkUpstream(project, bid); }
                }, '重试')
            ]),
            E('div', { 'id': bid + '-selects',
                'style': 'display:none;margin-top:10px;' }, [
                E('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;' }, [
                    E('label', {}, '版本：'),
                    E('select', { 'class': 'cbi-input-select', 'id': bid + '-tag',
                        'style': 'width:auto;' }),
                    E('label', {}, '文件：'),
                    E('select', { 'class': 'cbi-input-select', 'id': bid + '-file',
                        'style': 'width:auto;' }),
                    E('button', {
                        'class': 'btn cbi-button-apply',
                        'id':    bid + '-btn',
                        'click': function() { self._doUpdate(project, bid); }
                    }, '立即更新')
                ])
            ]),
            E('pre', { 'id': bid + '-log',
                'style': [
                    'display:none', 'margin-top:10px', 'background:#1e1e1e',
                    'color:#d4d4d4', 'padding:10px', 'font-size:12px',
                    'height:200px', 'overflow-y:auto', 'border-radius:4px',
                    'white-space:pre-wrap', 'font-family:monospace'
                ].join(';')
            })
        ]);
    },

    _el: function(id) { return document.getElementById(id); },

    _setStatus: function(bid, text, color) {
        var el = this._el(bid + '-status');
        if (el) { el.textContent = text; el.style.color = color || '#888'; }
    },

    _showLog: function(bid, text) {
        var el = this._el(bid + '-log');
        if (!el) return;
        el.style.display = 'block';
        el.textContent   = text;
        el.scrollTop     = el.scrollHeight;
    },

    _show: function(id, flex) {
        var el = this._el(id);
        if (el) el.style.display = flex ? 'flex' : 'block';
    },

    _hide: function(id) {
        var el = this._el(id);
        if (el) el.style.display = 'none';
    },

    _checkUpstream: function(project, bid) {
        var self     = this;
        var mirrorEl = this._el(bid + '-mirror');
        var mirror   = mirrorEl ? mirrorEl.value
                                : (uci.get('vnt2','global','mirror') || 'github');
        var checkBtn = this._el(bid + '-check-btn');
        if (checkBtn) checkBtn.disabled = true;
        self._hide(bid + '-mirror-row');
        self._hide(bid + '-selects');
        self._hide(bid + '-log');
        self._setStatus(bid, '检查中...', '#888');
        callGetUpstreamVersion(project, mirror).then(function() {
            self._pollStatus(project, bid, 'check');
        }).catch(function(err) {
            if (checkBtn) checkBtn.disabled = false;
            self._setStatus(bid, '✗ 启动失败: ' + String(err), '#dc3545');
            self._show(bid + '-mirror-row', true);
        });
    },

    _doUpdate: function(project, bid) {
        var self   = this;
        var tagEl  = this._el(bid + '-tag');
        var fileEl = this._el(bid + '-file');
        var btn    = this._el(bid + '-btn');
        var tag    = tagEl  ? tagEl.value  : '';
        var fname  = fileEl ? fileEl.value : '';

        if (!tag || !fname) {
            self._setStatus(bid, '✗ 请先检查版本', '#dc3545');
            return;
        }

        var upx = project !== 'luci-app-vnt2' &&
                  !!(this._el('s-upx') || {}).checked;

        if (btn) btn.disabled = true;
        self._hide(bid + '-mirror-row');
        self._showLog(bid, '准备下载...');
        self._setStatus(bid, '下载中...', '#888');

        callDoUpdate(project, tag, fname, upx).then(function(r) {
            if (!r || r.result !== 'ok') {
                if (btn) btn.disabled = false;
                self._setStatus(bid, '✗ 启动下载失败', '#dc3545');
                self._show(bid + '-mirror-row', true);
                return;
            }
            self._pollStatus(project, bid, 'download');
        }).catch(function(err) {
            if (btn) btn.disabled = false;
            self._setStatus(bid, '✗ 错误: ' + String(err), '#dc3545');
            self._show(bid + '-mirror-row', true);
        });
    },

    _pollStatus: function(project, bid, phase) {
        var self     = this;
        var checkBtn = this._el(bid + '-check-btn');
        var btn      = this._el(bid + '-btn');
        var dots     = 0;
        var done     = false;
        var timer    = null;
        var timeout  = null;

        function stopAll() {
            done = true;
            if (timer)   { clearInterval(timer);  timer   = null; }
            if (timeout) { clearTimeout(timeout);  timeout = null; }
        }

        timer = setInterval(function() {
            if (done) return;
            dots++;
            callGetUpdateStatus(project).then(function(s) {
                if (done || !s) return;
                var dot = '.'.repeat(dots % 4 + 1);
                if (s.status === 'checking') {
                    self._setStatus(bid, '检查中' + dot, '#888');
                    return;
                }
                if (s.status === 'downloading') {
                    if (s.log) self._showLog(bid, s.log);
                    self._setStatus(bid, '下载中' + dot, '#888');
                    return;
                }
                if (s.status === 'installing' || s.status === 'processing') {
                    if (s.log) self._showLog(bid, s.log);
                    self._setStatus(bid, '安装中...', '#888');
                    return;
                }
                stopAll();
                if (s.status === 'ready') {
                    if (checkBtn) checkBtn.disabled = false;
                    self._setStatus(bid, '✓ 找到 ' + s.count + ' 个版本', '#28a745');
                    self._populateReleases(s.releases, bid);
                    self._show(bid + '-selects');
                    return;
                }
                if (s.status === 'done') {
                    if (btn) btn.disabled = false;
                    self._setStatus(bid, '✓ 安装完成：' + (s.installed || ''), '#28a745');
                    if (s.log) self._showLog(bid, s.log);
                    return;
                }
                if (s.status === 'error') {
                    if (checkBtn) checkBtn.disabled = false;
                    if (btn)      btn.disabled      = false;
                    self._setStatus(bid, '✗ ' + (s.msg || '失败'), '#dc3545');
                    if (s.log) self._showLog(bid, s.log);
                    self._show(bid + '-mirror-row', true);
                    return;
                }
            }).catch(function() {});
        }, 1500);

        var timeoutMs = phase === 'check' ? 60000 : 600000;
        timeout = setTimeout(function() {
            if (done) return;
            stopAll();
            if (checkBtn) checkBtn.disabled = false;
            if (btn)      btn.disabled      = false;
            self._setStatus(bid, '✗ 超时，请重试', '#dc3545');
            self._show(bid + '-mirror-row', true);
        }, timeoutMs);
    },

    _populateReleases: function(releasesData, bid) {
        var self = this;
        if (!releasesData || !releasesData.releases) return;
        var releases = releasesData.releases;
        var tagSel   = this._el(bid + '-tag');
        var fileSel  = this._el(bid + '-file');
        if (!tagSel || !fileSel) return;
        tagSel.innerHTML = '';
        releases.forEach(function(r) {
            tagSel.appendChild(E('option', { 'value': r.tag }, r.tag));
        });
        function updateFiles() {
            var tag = tagSel.value, release = null;
            for (var i = 0; i < releases.length; i++) {
                if (releases[i].tag === tag) { release = releases[i]; break; }
            }
            fileSel.innerHTML = '';
            if (!release || !release.filenames) return;
            var arch    = uci.get('vnt2','global','arch') || self._sysinfo.arch || '';
            var matched = -1;
            release.filenames.forEach(function(fname, idx) {
                fileSel.appendChild(E('option', { 'value': fname }, fname));
                if (matched < 0 && arch && fname.indexOf(arch) !== -1) matched = idx;
            });
            if (matched >= 0) fileSel.selectedIndex = matched;
        }
        tagSel.onchange = updateFiles;
        updateFiles();
    }
});