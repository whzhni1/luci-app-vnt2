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
    'respawn_threshold','respawn_timeout','respawn_retry',
    'log_max_kb',
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
    { key: 'fw_vnt_to_lan', label: 'VNT → LAN', desc: _('Allow virtual network to access LAN') },
    { key: 'fw_lan_to_vnt', label: 'LAN → VNT', desc: _('Allow LAN to access virtual network') },
    { key: 'fw_vnt_to_wan', label: 'VNT → WAN', desc: _('Allow virtual network to access WAN')       },
    { key: 'fw_wan_to_vnt', label: 'WAN → VNT', desc: _('Allow WAN to access virtual network')       },
    { key: 'fw_vnt_web',  label: _('VNT Web External Access'),  desc: _('Requires web_addr configuration') },
    { key: 'fw_vnts_web', label: _('VNTS Web External Access'), desc: _('Requires web_bind configuration') },
];

function detectLang() {
    var htmlLang = document.documentElement.lang || '';
    if (htmlLang && htmlLang !== 'auto') return htmlLang.toLowerCase();
    return (navigator.language || navigator.userLanguage || '').toLowerCase();
}

(function() {
    var id = 'vnt2-inline-style';
    if (document.getElementById(id)) return;
    var style = document.createElement('style');
    style.id = id;
    style.textContent = [
        '.vnt2-progress-track{background:#eee;border-radius:4px;height:8px;margin-top:8px;overflow:hidden;}',
        '.vnt2-progress-bar{height:100%;border-radius:4px;background:#4caf50;width:0%;transition:width 0.5s ease,background 0.3s;}'
    ].join('');
    document.head.appendChild(style);
})();

return view.extend({

    load: function() {
        return Promise.all([
            L.require('vnt2.common'),
            L.require('vnt2.i18n-map'),
            uci.load('vnt2'),
            callGetSystemInfo(),
            callCheckBinaries()
        ]);
    },

    render: function(data) {
        var self       = this;
        self._ui       = data[0].VNT2UI;
        self._i18n     = data[1];
        self._sysinfo  = data[3] || {};
        self._binaries = data[4] || {};
        window.requestAnimationFrame(function() {
            var initHash = location.hash.replace('#','');
            var footer = document.querySelector('.cbi-page-actions');
            if (footer) footer.style.display = initHash === 'tab-update' ? 'none' : '';
        });
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('VNT2 Settings & Update')),
            self._buildTabContainer([
                { id: 'tab-settings', label: _('Settings'), content: self._buildSettingsTab() },
                { id: 'tab-update',   label: _('Update'), content: self._buildUpdateTab()   }
            ])
        ]);
    },

    _getUciSettings: function() {
        var g = function(k) { return uci.get('vnt2', 'global', k); };
        var boolStr = function(v) { return v === '1' ? '1' : '0'; };
        return [
            g('bin_path')                  || '/usr/bin',
            g('config_path')               || '/etc/vnt2_config',
            g('arch')                      || 'auto',
            g('mirror')                    || 'github',
            boolStr(g('auto_update')),
            parseInt(g('update_interval')) || 7,
            boolStr(g('upx_compressed')),
            parseInt(g('respawn_threshold')) || 3600,
            parseInt(g('respawn_timeout'))   || 5,
            parseInt(g('respawn_retry'))     || 5,
            parseInt(g('log_max_kb'))        || 300,
            boolStr(g('fw_vnt_to_lan')),
            boolStr(g('fw_lan_to_vnt')),
            boolStr(g('fw_vnt_to_wan')),
            boolStr(g('fw_wan_to_vnt')),
            boolStr(g('fw_vnt_web')),
            boolStr(g('fw_vnts_web')),
        ];
    },

    handleSave: function() {
        return callSaveSettings.apply(null, this._getUciSettings());
    },

    handleSaveApply: function() {
        var self = this;
        return callSaveSettings.apply(null, self._getUciSettings())
            .then(function() { return ui.changes.apply(); });
    },

    handleReset: function() {
        return uci.load('vnt2').then(function() { location.reload(); });
    },

    _buildTabContainer: function(tabs) {
        var self   = this;
        var header = E('div', { 'style': 'display:flex;border-bottom:2px solid #ddd;margin-bottom:20px;' });
        var body   = E('div', {});
        var activeHash = location.hash.replace('#','') || tabs[0].id;
        var hasMatch = tabs.some(function(t){ return t.id === activeHash; });
        if(!hasMatch) activeHash = tabs[0].id;
        tabs.forEach(function(tab, idx) {
            var active = tab.id === activeHash;
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
        location.hash = activeId;
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
                'style':  style || 'width:100%;max-width:360px;box-sizing:border-box;',
                'change': function() { uci.set('vnt2', 'global', uciKey, this.value.trim()); }
            });
        }

        function buildCheckRow(opt) {
            return vui.buildFormRow(opt.label,
                E('label', { 'style': 'cursor:pointer;user-select:none;' }, [
                    buildCheck('s-' + opt.key, opt.key),
                    E('span', { 'style': 'margin-left:6px;' }, _('Enabled'))
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
                E('h3', {}, _('Basic Settings')),
                vui.buildFormRow(_('Binary Path'),
                    buildText('s-bin-path', 'bin_path'),
                    _('Directory of binary files, default /usr/bin')),
                vui.buildFormRow(_('Configuration Path'),
                    buildText('s-config-path', 'config_path'),
                    _('Directory of configuration files, default /etc/vnt2_config')),
                vui.buildFormRow(_('Device Architecture'),
                    buildText('s-arch', 'arch', 'width:100%;max-width:200px;box-sizing:border-box;'),
                    _('Current detected: %s, automatic recognition by auto, or manual specification')
                       .format(self._sysinfo.arch || _('Unknown'))),
                vui.buildFormRow(_('Download Mirror'), mirrorSel, _('Multiple mirrors ensure successful downloads')),
                vui.buildFormRow(_('Auto Update'),
                    E('label', { 'style': 'cursor:pointer;user-select:none;' }, [
                        (function() {
                            var cb = E('input', { 'type': 'checkbox', 'id': 's-auto-update',
                                'change': function() {
                                    uci.set('vnt2', 'global', 'auto_update', this.checked ? '1' : '0');
                                    var row = document.getElementById('s-interval-row');
                                    if (row) row.style.display = this.checked ? '' : 'none';
                                }
                            });
                            if (g('auto_update') === '1') cb.setAttribute('checked', 'checked');
                            return cb;
                        })(),
                        E('span', { 'style': 'margin-left:6px;' }, _('Enable auto update'))
                    ]), _('Automatically check and update programs periodically')),
                E('div', { 'id': 's-interval-row', 'style': 'display:' + (g('auto_update') === '1' ? '' : 'none') + ';' }, [
                    (function() {
                        var inpInterval = E('input', { 'type': 'number', 'class': 'cbi-input-text',
                            'id': 's-interval',
                            'value': g('update_interval') || '7',
                            'min': '1', 'max': '365', 'style': 'width:80px;',
                            'input': function() {
                                descInterval.textContent = _('Check for updates every %d days').format(this.value || '7');
                            },
                            'change': function() {
                                uci.set('vnt2', 'global', 'update_interval', this.value || '7');
                            }
                        });
                        var descInterval = E('span', {}, _('Check for updates every %d days').format(inpInterval.value));
                        return vui.buildFormRow(_('Update Interval (Days)'), inpInterval, descInterval);
                    })()
                ]),
                vui.buildFormRow(_('UPX Compression'),
                    E('label', { 'style': 'cursor:pointer;user-select:none;' }, [
                        buildCheck('s-upx', 'upx_compressed'),
                        E('span', { 'style': 'margin-left:6px;' }, _('Use UPX to compress after installation'))
                    ]), _('Significantly reduce binary file size'))
            ]),
            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Process Watchdog (Respawn)')),
                    ...(function() {
                        var inpThreshold = E('input', { 'type': 'number', 'class': 'cbi-input-text',
                            'id': 's-respawn-threshold',
                            'value': g('respawn_threshold') || '3600', 'min': '0', 'style': 'width:100px;',
                            'input':  function() {
                                descThreshold.textContent = _('Count crashes within %d seconds, 0 = unlimited').format(this.value || '3600');
                            },
                            'change': function() {
                                uci.set('vnt2', 'global', 'respawn_threshold', this.value || '3600');
                            }
                        });
                        var descThreshold = E('span', {}, _('Count crashes within %d seconds, 0 = unlimited').format(inpThreshold.value));

                        var inpTimeout = E('input', { 'type': 'number', 'class': 'cbi-input-text',
                            'id': 's-respawn-timeout',
                            'value': g('respawn_timeout') || '5', 'min': '0', 'style': 'width:100px;',
                            'input': function() {
                                uci.set('vnt2', 'global', 'respawn_timeout', this.value || '5');
                                descTimeout.textContent = _('Wait %d seconds before restart after crash').format(this.value || '5');
                            }
                        });
                        var descTimeout = E('span', {}, _('Wait %d seconds before restart after crash').format(inpTimeout.value));

                        var inpRetry = E('input', { 'type': 'number', 'class': 'cbi-input-text',
                            'id': 's-respawn-retry',
                            'value': g('respawn_retry') || '5', 'min': '0', 'style': 'width:100px;',
                            'input': function() {
                                uci.set('vnt2', 'global', 'respawn_retry', this.value || '5');
                                descRetry.textContent = _('Max %d restarts then give up, 0 = unlimited').format(this.value || '5');
                            }
                        });
                        var descRetry = E('span', {}, _('Max %d restarts then give up, 0 = unlimited').format(inpRetry.value));

                        return [
                            vui.buildFormRow(_('Failure Threshold (s)'), inpThreshold, descThreshold),
                            vui.buildFormRow(_('Restart Delay (s)'),     inpTimeout,   descTimeout),
                            vui.buildFormRow(_('Restart Retries'),        inpRetry,     descRetry),
                        ];
                    })()
                ]),
            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Log Settings')),
                ...(function() {
                    var inpLogMax = E('input', { 'type': 'number', 'class': 'cbi-input-text',
                        'id': 's-log-max-kb',
                        'value': g('log_max_kb') || '300', 'min': '50', 'max': '10240', 'style': 'width:100px;',
                        'input': function() {
                            uci.set('vnt2', 'global', 'log_max_kb', this.value || '300');
                            descLogMax.textContent = _('Each instance log truncated at %d KB').format(this.value || '300');
                        }
                    });
                    var descLogMax = E('span', {}, _('Each instance log truncated at %d KB').format(inpLogMax.value));
                    return [
                        vui.buildFormRow(_('Log Max Size (KB)'), inpLogMax, descLogMax),
                    ];
                })()
            ]),
            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Firewall Forwarding')),
                E('div', {}, FW_OPTIONS.map(buildCheckRow))
            ])
        ]);
    },

    _buildUpdateTab: function() {
        var self = this, sys = self._sysinfo, bins = self._binaries;
        var thStyle = 'padding:8px 12px;text-align:center;white-space:nowrap;';
        var tdStyle = 'padding:8px 12px;text-align:center;vertical-align:middle;white-space:nowrap;';

        return E('div', { 'class': 'cbi-section' }, [
            E('h3', {}, _('Current Version Info')),
            E('div', { 'style': 'width:100%;max-width:100%;box-sizing:border-box;display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #ddd;border-radius:8px;margin-bottom:20px;' },
                E('table', {
                    'style': [
                        'width:100%', 'min-width:360px', 'border-collapse:collapse',
                        'border-spacing:0', 'box-sizing:border-box'
                    ].join(';')
                }, [
                    E('thead', {}, E('tr', {},
                        [_('Component'), _('Version'), _('Status')].map(function(h) {
                            return E('th', { 'style': thStyle }, h);
                        })
                    )),
                    E('tbody', {}, [
                        E('tr', {}, [
                            E('td', { 'style': tdStyle }, 'luci-app-vnt2'),
                            E('td', { 'style': tdStyle }, sys.luci_version || _('Unknown')),
                            E('td', { 'style': tdStyle + 'color:#28a745;font-weight:bold;' }, _('✓ Installed'))
                        ])
                    ].concat(self._buildVersionRows(sys, bins)))
                ])
            ),
            E('h3', {}, _('Check Update')),
            self._buildUpdateBlock('luci-app-vnt2', _('LuCI Plugin (luci-app-vnt2)')),
            self._buildUpdateBlock('vnt',  _('VNT Client (vnt2_cli / vnt2_web / vnt2_ctrl)')),
            self._buildUpdateBlock('vnts', _('VNTS Server (vnts2)'))
        ]);
    },

    _buildVersionRows: function(sys, bins) {
        var tdStyle = 'padding:8px 12px;text-align:center;vertical-align:middle;';
        return COMPONENTS.map(function(comp) {
            var installed = !!bins[comp.binKey];
            return E('tr', { 'data-comp': comp.name }, [
                E('td', { 'style': tdStyle }, comp.name),
                E('td', { 'style': tdStyle },
                    installed ? (sys[comp.versionKey] || _('Unknown')) : _('Not installed')),
                E('td', { 'style': tdStyle + 'color:' +
                    (installed ? '#28a745' : '#dc3545') + ';font-weight:bold;' },
                    installed ? _('✓ Installed') : _('✗ Not installed'))
            ]);
        });
    },

    _refreshVersionTable: function() {
        var self = this;
        Promise.all([callGetSystemInfo(), callCheckBinaries()]).then(function(res) {
            self._sysinfo  = res[0] || {};
            self._binaries = res[1] || {};
            var tbody = document.querySelector('[data-comp]');
            if (!tbody) return;
            tbody = tbody.parentNode;
            var newRows = self._buildVersionRows(self._sysinfo, self._binaries);
            var old = tbody.querySelectorAll('[data-comp]');
            old.forEach(function(el) { el.parentNode.removeChild(el); });
            newRows.forEach(function(row) { tbody.appendChild(row); });
        });
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
                }, _('Check Upstream Version')),
                E('span', { 'id': bid + '-status', 'style': 'font-size:13px;color:#888;' },
                    _('Click to check and get version info'))
            ]),
            E('div', { 'id': bid + '-progress', 'style': 'display:none;margin-top:10px;' }, [
                E('div', { 'class': 'vnt2-progress-track' }, [
                E('div', { 'id': bid + '-bar', 'class': 'vnt2-progress-bar' })
                ])
            ]),
            E('div', { 'id': bid + '-mirror-row',
                'style': 'display:none;margin-top:8px;align-items:center;gap:8px;' }, [
                E('span', { 'style': 'font-size:13px;color:#666;' }, _('Switch mirror and retry:')),
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
                }, _('Retry'))
            ]),
            E('div', { 'id': bid + '-selects',
                'style': 'display:none;margin-top:10px;' }, [
                E('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;box-sizing:border-box;overflow:hidden;' }, [
                    E('label', {}, _('Version:')),
                    E('select', { 'class': 'cbi-input-select', 'id': bid + '-tag',
                        'style': 'width:auto;max-width:100%;min-width:0;box-sizing:border-box;' }),
                    E('label', {}, _('File:')),
                    E('select', { 'class': 'cbi-input-select', 'id': bid + '-file',
                        'style': 'width:auto;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;' }),
                    E('button', {
                        'class': 'btn cbi-button-apply',
                        'id':    bid + '-btn',
                        'click': function() { self._doUpdate(project, bid); }
                    }, _('Update Now'))
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

    _setBar: function(bid, pct) {
        var bar      = this._el(bid + '-bar');
        var progress = this._el(bid + '-progress');
        if (!bar || !progress) return;
        var p = Math.min(100, Math.max(0, pct || 0));
        progress.style.display = 'block';
        bar.style.width        = p + '%';
    },

    _setStatus: function(bid, text, color) {
        var el = this._el(bid + '-status');
        if (el) { el.textContent = text; el.style.color = color || '#888'; }
    },

    _showLog: function(bid, text) {
        var el = this._el(bid + '-log');
        if (!el) return;
        el.style.display = 'block';
        var self = this;
        el.innerHTML = '';
        text.split('\n').forEach(function(line) {
            if (!line) return;
            var span = document.createElement('span');
            span.style.display = 'block';
            span.textContent = (self._i18n && self._i18n.translate)
                ? self._i18n.translate(line) : line;
            el.appendChild(span);
        });
        el.scrollTop = el.scrollHeight;
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
        self._hide(bid + '-progress');
        self._setStatus(bid, _('Checking...'), '#888');
        callGetUpstreamVersion(project, mirror).then(function() {
            self._pollStatus(project, bid, 'check');
        }).catch(function(err) {
            if (checkBtn) checkBtn.disabled = false;
            self._setStatus(bid, _('✗ Start failed: %s').format(String(err)), '#dc3545');
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
            self._setStatus(bid, _('✗ Please check version first'), '#dc3545');
            return;
        }

        var upx = project !== 'luci-app-vnt2' &&
                  !!(this._el('s-upx') || {}).checked;

        if (project === 'luci-app-vnt2' && fname.toLowerCase().indexOf('i18n') === -1) {
            var lang = detectLang();
            var langFile = '';
            var releases = self._currentReleases || [];
            for (var i = 0; i < releases.length; i++) {
                if (releases[i].tag === tag) {
                    var files = releases[i].filenames || [];
                    for (var j = 0; j < files.length; j++) {
                        var fn = files[j].toLowerCase();
                        if (fn.indexOf('i18n') !== -1 && fn.indexOf(lang) !== -1) {
                            langFile = files[j];
                            break;
                        }
                    }
                    break;
                }
            }
            if (langFile) fname = fname + ' ' + langFile;
        }

        if (btn) btn.disabled = true;
        self._hide(bid + '-mirror-row');
        self._setBar(bid, 0);
        self._showLog(bid, _('Preparing to download...'));
        self._setStatus(bid, _('Downloading...'), '#888');

        callDoUpdate(project, tag, fname, upx).then(function(r) {
            if (!r || r.result !== 'ok') {
                if (btn) btn.disabled = false;
                self._setStatus(bid, _('✗ Download start failed'), '#dc3545');
                self._show(bid + '-mirror-row', true);
                return;
            }
            self._pollStatus(project, bid, 'download');
        }).catch(function(err) {
            if (btn) btn.disabled = false;
            self._setStatus(bid, _('✗ Error: %s').format(String(err)), '#dc3545');
            self._show(bid + '-mirror-row', true);
        });
    },

    _pollStatus: function(project, bid, phase) {
        var tr = function(s) {
            return (self._i18n && self._i18n.translate) ? self._i18n.translate(s||'') : (s||'');
        };
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
                    self._setStatus(bid, _('Checking') + dot, '#888');
                    return;
                }
                if (s.status === 'downloading') {
                    if (s.log) self._showLog(bid, s.log);
                    var pct = 0;
                    var lines = (s.log || '').split('\n');
                    for (var i = lines.length - 1; i >= 0; i--) {
                        var m = lines[i].match(/PROGRESS:(\d+)/);
                        if (m) { pct = parseInt(m[1]); break; }
                    }
                    self._setBar(bid, pct);
                    self._setStatus(bid, _('Downloading... %d%%').format(pct), '#888');
                    return;
                }
                if (s.status === 'installing' || s.status === 'processing') {
                    if (s.log) self._showLog(bid, s.log);
                    self._setBar(bid, 100);
                    self._setStatus(bid, _('Installing...'), '#888');
                    return;
                }
                stopAll();
                if (s.status === 'ready') {
                    if (checkBtn) checkBtn.disabled = false;
                    self._setStatus(bid, _('✓ Found %d versions').format(s.count), '#28a745');
                    self._populateReleases(s.releases, bid);
                    self._show(bid + '-selects');
                    return;
                }
                if (s.status === 'done') {
                    if (btn) btn.disabled = false;
                    self._setBar(bid, 100);
                    var installed = tr(s.installed) || '';
                    self._setStatus(bid, _('✓ Installation complete: %s').format(installed), '#28a745');
                    if (s.log) self._showLog(bid, s.log);
                    self._refreshVersionTable();
                    return;
                }
                if (s.status === 'error') {
                    if (checkBtn) checkBtn.disabled = false;
                    if (btn)      btn.disabled      = false;
                    var msg       = tr(s.msg)       || _('Failed');
                    self._setStatus(bid, _('✗ %s').format(msg || _('Failed')), '#dc3545');
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
            self._setStatus(bid, _('✗ Timeout, please retry'), '#dc3545');
            self._show(bid + '-mirror-row', true);
        }, timeoutMs);
    },

    _populateReleases: function(releasesData, bid) {
        var self = this;
        if (!releasesData || !releasesData.releases) return;
        var releases = releasesData.releases;
        self._currentReleases = releases;
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
            var uciArch   = uci.get('vnt2', 'global', 'arch') || '';
            var sysArch   = (self._sysinfo && self._sysinfo.arch) || '';
            var rawArch   = (uciArch && uciArch !== 'auto') ? uciArch : sysArch;
            var archParts = rawArch ? rawArch.split(' ') : [];
            if (archParts.length === 1 && sysArch) {
                var sysParts = sysArch.split(' ');
                if (sysParts[0] === archParts[0] && sysParts[1]) {
                    archParts.push(sysParts[1]);
                }
            }
            var arch1     = archParts[0] || '';
            var arch2     = archParts[1] || '';
            var matched   = -1;
            release.filenames.forEach(function(fname, idx) {
                fileSel.appendChild(E('option', { 'value': fname }, fname));
                if (matched < 0 && bid.indexOf('luci-app') !== -1
                    && fname.indexOf('luci-app') !== -1) matched = idx;
                if (matched >= 0) return;
                if (!arch1) return;
                var hit = arch2
                    ? (fname.indexOf(arch1) !== -1 && fname.indexOf(arch2) !== -1
                       && !(arch2.slice(-1) !== 'f' && fname.indexOf(arch2 + 'hf') !== -1))
                    : (fname.indexOf(arch1) !== -1);
                if (hit) matched = idx;
            });
            if (matched >= 0) fileSel.selectedIndex = matched;
        }
        tagSel.onchange = updateFiles;
        updateFiles();
    }
});