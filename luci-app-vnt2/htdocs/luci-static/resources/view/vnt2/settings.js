'use strict';
'require view';
'require ui';
'require uci';
'require rpc';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callGetSystemInfo      = rpcDeclare('get_system_info',      []);
var callCheckBinaries      = rpcDeclare('check_binaries',       []);
var callGetUpstreamVersion = rpcDeclare('get_upstream_version', ['project','mirror']);
var callDoUpdate           = rpcDeclare('do_update',            ['project','filename','upx','mirror']);
var callRebuildFirewall    = rpcDeclare('rebuild_firewall',     []);

var SETTING_DEFS = [
    ['bin_path',        '/usr/bin'        ],
    ['config_path',     '/etc/vnt2_config'],
    ['arch',            ''                ],
    ['mirror',          'github'          ],
    ['auto_update',     '0'               ],
    ['update_interval', '7'               ],
    ['upx_compressed',  '0'               ],
    ['fw_vnt_to_lan',   '1'               ],
    ['fw_lan_to_vnt',   '1'               ],
    ['fw_vnt_to_wan',   '0'               ],
    ['fw_wan_to_vnt',   '0'               ],
    ['fw_vnts_web',     '0'               ],
];

var MIRROR_OPTIONS = [
    { value:'github', label:'GitHub' },
    { value:'gitee',  label:'Gitee'  },
    { value:'gitlab', label:'GitLab' },
];

var COMPONENTS = [
    { name:'vnt2_cli',  binKey:'vnt2_cli',  versionKey:'vnt_version'  },
    { name:'vnt2_web',  binKey:'vnt2_web',  versionKey:'vnt_version'  },
    { name:'vnt2_ctrl', binKey:'vnt2_ctrl', versionKey:'vnt_version'  },
    { name:'vnts2',     binKey:'vnts2',     versionKey:'vnts_version' },
];

var FW_OPTIONS = [
    { key:'fw_vnt_to_lan', label:'VNT → LAN', desc:'允许虚拟网络访问本地局域网' },
    { key:'fw_lan_to_vnt', label:'LAN → VNT', desc:'允许本地局域网访问虚拟网络' },
    { key:'fw_vnt_to_wan', label:'VNT → WAN', desc:'允许虚拟网络访问外网'    },
    { key:'fw_wan_to_vnt', label:'WAN → VNT', desc:'允许外网访问虚拟网络'    },
    { key:'fw_vnts_web',   label:'VNTS Web 外网访问', desc:'需配置 web_bind' },
];

function buildMirrorSelect(id, currentVal, style) {
    return E('select', {
        'class': 'cbi-input-select',
        'id':    id,
        'style': style || 'width:auto;'
    }, MIRROR_OPTIONS.map(function(o) {
        var a = { 'value':o.value };
        if (o.value === currentVal) a['selected'] = 'selected';
        return E('option', a, o.label);
    }));
}

function getUpdEls(bid) {
    var els = {};
    ['status','selects','tag','file','count','mirror','mirror-row','log','log-content','btn']
        .forEach(function(k) {
            els[k.replace('-','_')] = document.getElementById(bid + '-' + k);
        });
    return els;
}

function showMirrorRow(el, show) {
    if (el) el.style.display = show ? 'flex' : 'none';
}

function setStatus(el, text, color) {
    if (!el) return;
    el.textContent = text;
    el.style.color = color || '#888';
}

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
        self._s        = {};
        SETTING_DEFS.forEach(function(def) {
            self._s[def[0]] = uci.get('vnt2','global',def[0]) || def[1];
        });

        return E('div', { 'class':'cbi-map' }, [
            E('h2', {}, 'VNT2 设置与更新'),
            self._buildTabContainer([
                { id:'tab-settings', label:'设置', content:self._buildSettingsTab() },
                { id:'tab-update',   label:'更新', content:self._buildUpdateTab()   }
            ])
        ]);
    },

    handleSave: function() { return uci.save(); },
    handleSaveApply: function() {
    return uci.save().then(function() {
        return ui.changes.apply();
    }).then(function() {
        return callRebuildFirewall();
    });
},
    handleReset: function() { return uci.load('vnt2'); },

    _buildTabContainer: function(tabs) {
        var self   = this;
        var header = E('div', { 'style':'display:flex;border-bottom:2px solid #ddd;margin-bottom:20px;' });
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
                'click': function(ev) { self._switchTab(ev.currentTarget.getAttribute('data-tab')); }
            }, tab.label));
            body.appendChild(E('div', {
                'id':    tab.id,
                'style': 'display:' + (active ? 'block' : 'none') + ';'
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
        ['tab-settings','tab-update'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = id === activeId ? 'block' : 'none';
        });
        var footer = document.querySelector('.cbi-page-actions');
        if (footer) footer.style.display = activeId === 'tab-settings' ? '' : 'none';
    },

    _buildSettingsTab: function() {
        var self = this, s = self._s, vui = self._ui;

        function buildCheck(id, val, uciKey) {
            var cb = E('input', { 'type':'checkbox', 'id':id,
                'change': function() {
                    uci.set('vnt2','global', uciKey, this.checked ? '1' : '0');
                }
            });
            if (val === '1') cb.setAttribute('checked','checked');
            return cb;
        }

        function buildText(id, value, uciKey, style) {
            return E('input', { 'type':'text', 'class':'cbi-input-text', 'id':id,
                'value':  value,
                'style':  style || 'width:360px;',
                'change': function() { uci.set('vnt2','global', uciKey, this.value.trim()); }
            });
        }

        function buildCheckRow(opt) {
            return vui.buildFormRow(opt.label,
                E('label', { 'style':'cursor:pointer;user-select:none;' }, [
                    buildCheck('s-' + opt.key, s[opt.key], opt.key),
                    E('span', { 'style':'margin-left:6px;' }, '启用')
                ]), opt.desc || '');
        }

        var mirrorSel = buildMirrorSelect('s-mirror', s.mirror);
        mirrorSel.addEventListener('change', function() {
            uci.set('vnt2','global','mirror', this.value);
        });

        return E('div', {}, [
            E('div', { 'class':'cbi-section' }, [
                E('h3', {}, '基本设置'),
                vui.buildFormRow('二进制程序路径',
                    buildText('s-bin-path', s.bin_path, 'bin_path'),
                    '程序文件所在目录，默认 /usr/bin'),
                vui.buildFormRow('配置文件路径',
                    buildText('s-config-path', s.config_path, 'config_path'),
                    '配置文件存储目录，默认 /etc/vnt2_config'),
                vui.buildFormRow('设备架构',
                    buildText('s-arch', s.arch || self._sysinfo.arch || '', 'arch', 'width:200px;'),
                    '当前检测：' + (self._sysinfo.arch || '未知')),
                vui.buildFormRow('下载镜像源', mirrorSel, '下载失败时切换其他镜像源重试'),
                vui.buildFormRow('自动更新',
                    E('label', { 'style':'cursor:pointer;user-select:none;' }, [
                        buildCheck('s-auto-update', s.auto_update, 'auto_update'),
                        E('span', { 'style':'margin-left:6px;' }, '启用自动更新')
                    ]), '定期自动检查并更新程序'),
                vui.buildFormRow('更新间隔（天）',
                    E('input', { 'type':'number', 'class':'cbi-input-text', 'id':'s-interval',
                        'value':s.update_interval, 'min':'1', 'max':'365', 'style':'width:80px;',
                        'change':function() { uci.set('vnt2','global','update_interval',this.value||'7'); }
                    }), '自动检查更新的间隔天数'),
                vui.buildFormRow('UPX 压缩',
                    E('label', { 'style':'cursor:pointer;user-select:none;' }, [
                        buildCheck('s-upx', s.upx_compressed, 'upx_compressed'),
                        E('span', { 'style':'margin-left:6px;' }, '安装后使用 UPX 压缩')
                    ]), '可显著减小程序文件体积')
            ]),
            E('div', { 'class':'cbi-section' }, [
                E('h3', {}, '防火墙转发'),
                E('div', {}, FW_OPTIONS.map(buildCheckRow))
            ])
        ]);
    },

    _buildUpdateTab: function() {
        var self = this, sys = self._sysinfo, bins = self._binaries;
        var thStyle = 'padding:8px 12px;text-align:center;';
        var tdStyle = 'padding:8px 12px;text-align:center;vertical-align:middle;';

        return E('div', { 'class':'cbi-section' }, [
            E('h3', {}, '当前版本信息'),
            E('div', { 'class':'vnt2-table-wrap', 'style':'width:100%;display:block;margin-bottom:20px;' },
                E('table', {
                    'class': 'vnt2-table',
                    'style': [
                        'width:100%', 'min-width:300px', 'border-collapse:separate',
                        'border-spacing:0', 'border:1px solid #ddd', 'border-radius:8px',
                        'overflow:hidden', 'box-sizing:border-box'
                    ].join(';')
                }, [
                    E('thead', {}, E('tr', {},
                        ['组件','版本','状态'].map(function(h) {
                            return E('th', { 'style':thStyle }, h);
                        })
                    )),
                    E('tbody', {}, COMPONENTS.map(function(comp) {
                        var installed   = !!bins[comp.binKey];
                        var color       = installed ? '#28a745' : '#dc3545';
                        var version     = installed ? (sys[comp.versionKey] || '未知') : '未安装';
                        return E('tr', {}, [
                            E('td', { 'style':tdStyle }, comp.name),
                            E('td', { 'style':tdStyle }, version),
                            E('td', { 'style':tdStyle + 'color:' + color + ';font-weight:bold;' },
                                installed ? '✓ 已安装' : '✗ 未安装')
                        ]);
                    }))
                ])
            ),
            E('h3', {}, '一键更新'),
            self._buildUpdateBlock('vnt',  'VNT 客户端（vnt2_cli / vnt2_web / vnt2_ctrl）'),
            E('div', { 'style':'margin:12px 0;border-top:1px solid #eee;' }),
            self._buildUpdateBlock('vnts', 'VNTS 服务端（vnts2）')
        ]);
    },

    _buildUpdateBlock: function(project, title) {
        var self = this, bid = 'vnt2-upd-' + project;
        return E('div', {
            'style': 'border:1px solid #e0e0e0;border-radius:6px;padding:16px;margin-bottom:12px;'
        }, [
            E('h4', { 'style':'margin-top:0;' }, title),
            E('button', { 'class':'btn cbi-button-action',
                'click': function() { self._checkUpstream(project, bid); }
            }, '检查上游版本'),
            E('div', { 'id':bid+'-status', 'style':'margin-top:8px;color:#888;font-size:13px;' },
                '点击"检查上游版本"获取信息'),
            E('div', { 'id':bid+'-selects', 'style':'display:none;margin-top:10px;' }, [
                E('div', { 'style':'display:flex;flex-direction:column;gap:8px;' }, [
                    E('div', { 'style':'display:flex;align-items:center;gap:8px;' }, [
                        E('label', {}, '版本选择：'),
                        E('select', { 'class':'cbi-input-select', 'id':bid+'-tag', 'style':'width:auto;' }),
                        E('span',   { 'id':bid+'-count', 'style':'color:#888;font-size:13px;' })
                    ]),
                    E('div', { 'style':'display:flex;align-items:center;gap:8px;' }, [
                        E('label', {}, '文件选择：'),
                        E('select', { 'class':'cbi-input-select', 'id':bid+'-file', 'style':'width:auto;' })
                    ]),
                    E('div', { 'style':'display:flex;align-items:center;gap:8px;' }, [
                        E('button', { 'class':'btn cbi-button-apply', 'id':bid+'-btn',
                            'click': function() { self._doUpdate(project, bid); }
                        }, '立即更新'),
                        E('span', { 'id':bid+'-mirror-row', 'style':'display:none;align-items:center;gap:6px;' }, [
                            E('label', {}, '切换镜像源：'),
                            buildMirrorSelect(bid+'-mirror', self._s.mirror)
                        ])
                    ])
                ])
            ]),
            E('div', { 'id':bid+'-log', 'style':'display:none;margin-top:8px;' }, [
                E('pre', { 'id':bid+'-log-content',
                    'style': [
                        'background:#1e1e1e', 'color:#d4d4d4', 'padding:10px',
                        'font-size:12px', 'max-height:200px', 'overflow-y:auto',
                        'border-radius:4px', 'white-space:pre-wrap'
                    ].join(';')
                })
            ])
        ]);
    },

    _checkUpstream: function(project, bid) {
        var self   = this;
        var els    = getUpdEls(bid);
        var mirror = (els.mirror || {}).value || self._s.mirror || 'github';

        setStatus(els.status, '检查中...', '#888');
        showMirrorRow(els.mirror_row, false);

        callGetUpstreamVersion(project, mirror).then(function(info) {
            var releases = (info && Array.isArray(info.releases)) ? info.releases : [];
            if (!releases.length) {
                setStatus(els.status, '✗ 未找到可用版本，请切换镜像源重试', '#dc3545');
                showMirrorRow(els.mirror_row, true);
                return;
            }

            setStatus(els.status, '', '#888');
            showMirrorRow(els.mirror_row, false);
            if (els.count) els.count.textContent = '共 ' + releases.length + ' 个版本';

            var tagSel  = els.tag;
            var fileSel = els.file;
            tagSel.innerHTML = '';
            releases.forEach(function(r) {
                tagSel.appendChild(E('option', { 'value':r.tag }, r.tag));
            });

            function updateFiles() {
                var tag     = tagSel.value;
                var release = null;
                for (var i = 0; i < releases.length; i++) {
                    if (releases[i].tag === tag) { release = releases[i]; break; }
                }
                fileSel.innerHTML = '';
                if (!release || !release.assets.length) {
                    setStatus(els.status, '✗ 未找到可用文件，请切换镜像源重试', '#dc3545');
                    showMirrorRow(els.mirror_row, true);
                    return;
                }
                setStatus(els.status, '', '#888');
                var arch    = self._s.arch || self._sysinfo.arch || '';
                var matched = -1;
                release.assets.forEach(function(a, idx) {
                    fileSel.appendChild(E('option', { 'value':a.name }, a.name));
                    if (matched < 0 && arch && a.name.indexOf(arch) !== -1) matched = idx;
                });
                if (matched >= 0) fileSel.selectedIndex = matched;
            }

            tagSel.onchange = updateFiles;
            updateFiles();
            if (els.selects) els.selects.style.display = 'block';

        }).catch(function() {
            setStatus(els.status, '✗ 检查失败，请切换镜像源重试', '#dc3545');
            showMirrorRow(els.mirror_row, true);
        });
    },

    _doUpdate: function(project, bid) {
        var self  = this;
        var els   = getUpdEls(bid);
        var fname = els.file ? els.file.value : '';
        if (!fname) { self._ui.notify('请选择文件', 'error'); return; }

        var mirror = (els.mirror || {}).value || self._s.mirror || 'github';
        var upx    = !!((document.getElementById('s-upx') || {}).checked);

        if (els.log)         els.log.style.display       = 'block';
        if (els.log_content) els.log_content.textContent = '正在下载 ' + fname + '...\n';
        if (els.btn)         els.btn.disabled             = true;

        callDoUpdate(project, fname, upx, mirror).then(function(r) {
            if (els.btn) els.btn.disabled = false;
            var ok = r && r.result === 'ok';
            if (r && r.msg && els.log_content)
                els.log_content.textContent += r.msg;
            if (ok) {
                if (els.log_content)
                    els.log_content.textContent += '✓ 更新成功，已安装：' + (r.installed || '') + '\n';
                showMirrorRow(els.mirror_row, false);
            } else {
                if (els.log_content)
                    els.log_content.textContent += '✗ 更新失败，请切换镜像源重试\n';
                showMirrorRow(els.mirror_row, true);
            }
        }).catch(function(err) {
            if (els.btn) els.btn.disabled = false;
            if (els.log_content)
                els.log_content.textContent += '✗ 错误：' + String(err) + '，请切换镜像源重试\n';
            showMirrorRow(els.mirror_row, true);
        });
    },
});