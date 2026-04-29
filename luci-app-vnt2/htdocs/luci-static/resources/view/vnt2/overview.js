'use strict';
'require view';
'require poll';
'require rpc';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callCheckBinaries   = rpcDeclare('check_binaries',   []);
var callListInstances   = rpcDeclare('list_instances',   []);
var callStartInstance   = rpcDeclare('start_instance',   ['name']);
var callStopInstance    = rpcDeclare('stop_instance',    ['name']);
var callRestartInstance = rpcDeclare('restart_instance', ['name']);
var callGetCtrlInfo     = rpcDeclare('get_ctrl_info',    ['name','cmd']);
var callGetCpuTicks     = rpcDeclare('get_cpu_ticks',    ['name']);

var CTRL_TABS = [
    { id:'info',    label:'基本信息' },
    { id:'ips',     label:'IP 列表'  },
    { id:'clients', label:'客户端'   },
    { id:'route',   label:'路由'     }
];

var BIN_KEYS = [
    ['vnt2_cli',  'vnt2_cli' ],
    ['vnt2_web',  'vnt2_web' ],
    ['vnt2_ctrl', 'vnt2_ctrl'],
    ['vnts2',     'vnts2'    ],
];

var LINKS = [
    ['http://rustvnt.com',                        '官网'  ],
    ['https://github.com/vnt-dev/vnt',            'GitHub'],
    ['https://github.com/vnt-dev/VntApp',         'GUIApp'],
    ['https://github.com/whzhni1/luci-app-vnt2', 'Luci'  ],
];

var ACTIONS = [
    { id:'start',   label:'启动', needRunning:false, fn:callStartInstance   },
    { id:'restart', label:'重启', needRunning:true,  fn:callRestartInstance },
    { id:'stop',    label:'停止', needRunning:true,  fn:callStopInstance    },
];

var _lastTicks = {};

function runningColor(running) {
    return running ? '#28a745' : '#dc3545';
}

function getInstEls(name) {
    var els = {};
    ['uptime','pid','res','actions','web'].forEach(function(k) {
        els[k] = document.getElementById('vnt2-' + k + '-' + name);
    });
    return els;
}

function fetchCpuAsync(inst, onResult) {
    if (!inst.running) return;
    callGetCpuTicks(inst.name).then(function(r) {
        if (!r || !r.alive) return;
        var last = _lastTicks[inst.name];
        _lastTicks[inst.name] = { proc:r.proc, total:r.total };
        if (!last) return;
        var dp  = r.proc  - last.proc;
        var dt  = r.total - last.total;
        var cpu = dt > 0 ? (dp / dt * 100).toFixed(1) : '0.0';
        onResult(cpu);
    }).catch(function(){});
}

function formatUptime(seconds) {
    seconds = parseInt(seconds) || 0;
    if (seconds <= 0) return '-';
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var parts = [];
    if (d > 0) parts.push(d + '天');
    if (h > 0) parts.push(h + '时');
    if (m > 0) parts.push(m + '分');
    parts.push(s + '秒');
    return parts.join('');
}

return view.extend({
    load: function() {
        return Promise.all([
            L.require('vnt2.common'),
            callCheckBinaries(),
            callListInstances()
        ]);
    },

    render: function(data) {
        var self      = this;
        self._destroyed = false;
        _lastTicks      = {};
        self._ui        = data[0].VNT2UI;
        var binaries    = data[1] || {};
        var instances   = (data[2] && Array.isArray(data[2].instances))
            ? data[2].instances : [];
        self._instances = instances;

        instances.forEach(function(inst) {
            if (!inst.running) return;
            callGetCpuTicks(inst.name).then(function(r) {
                if (r && r.alive)
                    _lastTicks[inst.name] = { proc:r.proc, total:r.total };
            }).catch(function(){});
        });

        var firstVnt = instances.filter(function(i) { return i.type === 'vnt'; })[0];
        self._selectedInstance = firstVnt ? firstVnt.name : null;
        self._activeCtrlTab    = 'info';

        var linkNodes = [E('span', {}, '💡 '), E('b', {}, 'VNT'),
            E('span', {}, ' - 简便高效的异地组网工具 | ')];
        LINKS.forEach(function(lk, i) {
            if (i > 0) linkNodes.push(E('span', {}, ' | '));
            linkNodes.push(E('a', { 'href':lk[0], 'target':'_blank' }, lk[1]));
        });

        var node = E('div', { 'class':'cbi-map' }, [
            E('h2', {}, 'VNT2 概览'),
            self._renderBinaryAlert(binaries),
            E('div', { 'class':'cbi-section' }, [
                E('h3', {}, '实例运行状态'),
                self._renderInstanceTable(instances)
            ]),
            E('div', { 'class':'cbi-section' }, [
                E('h3', {}, '节点信息'),
                self._renderCtrlPanel(instances)
            ]),
            E('div', {
                'style': [
                    'text-align:center', 'padding:12px', 'margin-top:16px',
                    'border-radius:8px', 'outline:1px solid #ddd',
                    'font-size:13px', 'color:#666', 'margin-bottom:60px'
                ].join(';')
            }, linkNodes)
        ]);

        if (self._selectedInstance && instances.some(function(i) {
            return i.name === self._selectedInstance && i.running;
        })) {
            window.setTimeout(function() {
                self._loadCtrlTab(self._selectedInstance, 'info');
            }, 300);
        }

        self._pollFn = function() {
            return callListInstances().then(function(r) {
                self._refreshRows((r && Array.isArray(r.instances)) ? r.instances : []);
            });
        };
        poll.add(self._pollFn, 5);

        window.setTimeout(function() {
            var el = document.querySelector('.cbi-page-actions');
            if (el) el.style.display = 'none';
        }, 0);

        return node;
    },

    _renderBinaryAlert: function(binaries) {
        var missing = [];
        BIN_KEYS.forEach(function(pair) {
            if (!binaries[pair[0]]) missing.push(pair[1]);
        });
        if (!missing.length) return E('span', {});
        return E('div', { 'class':'alert-message warning', 'style':'margin-bottom:16px;' }, [
            E('strong', {}, '⚠ 程序文件缺失：'),
            E('span',   {}, ' ' + missing.join(', ')),
            E('br'),
            E('span',   {}, '请前往 '),
            E('a', {
                'href':  L.url('admin/vpn/vnt2/settings'),
                'style': 'text-decoration:underline;color:#0069d9;'
            }, '设置与更新'),
            E('span', {}, ' 页面下载安装。')
        ]);
    },

    _renderInstanceTable: function(instances) {
        var self = this;
        if (!instances.length)
            return E('p', { 'style':'color:#888;' },
                '暂无实例，请先在客户端或服务端配置页新建实例。');
        var thStyle = 'padding:8px 12px;text-align:center;';
        var heads   = ['实例名称','实例类型','运行时间','PID','CPU／RAM','快捷操作','Web UI'];
        return E('div', { 'class':'vnt2-table-wrap', 'style':'width:100%;display:block;' },
            E('table', {
                'class': 'vnt2-table',
                'style': [
                    'width:100%', 'min-width:480px', 'border-collapse:separate',
                    'border-spacing:0', 'border:1px solid #ddd', 'border-radius:8px',
                    'overflow:hidden', 'box-sizing:border-box'
                ].join(';')
            }, [
                E('thead', {}, E('tr', {},
                    heads.map(function(h) { return E('th', { 'style':thStyle }, h); })
                )),
                E('tbody', { 'id':'vnt2-instance-tbody' },
                    instances.map(function(inst) { return self._buildRow(inst); }))
            ])
        );
    },

    _buildRow: function(inst) {
        var self    = this;
        var running = !!inst.running;
        var hasWeb  = !!(inst.web_addr && inst.web_addr !== '');
        var tdStyle = 'padding:8px 12px;text-align:center;vertical-align:middle;color:'
            + runningColor(running) + ';';
        return E('tr', { 'id':'vnt2-row-' + inst.name }, [
            E('td', { 'class':'vnt2-col-name', 'style':tdStyle }, inst.name),
            E('td', { 'style':tdStyle }, inst.type === 'vnt' ? '客户端' : '服务端'),
            E('td', { 'id':'vnt2-uptime-'  + inst.name, 'style':tdStyle },
                running ? formatUptime(inst.uptime) : '-'),
            E('td', { 'id':'vnt2-pid-'     + inst.name, 'style':tdStyle }, inst.pid || '-'),
            E('td', { 'id':'vnt2-res-'     + inst.name, 'style':tdStyle },
                running ? '-／' + inst.mem + 'M' : '-'),
            E('td', { 'id':'vnt2-actions-' + inst.name, 'style':tdStyle },
                self._buildActionBtns(inst)),
            E('td', { 'id':'vnt2-web-'     + inst.name, 'style':tdStyle },
                self._buildWebBtn(inst, hasWeb))
        ]);
    },

    _buildActionBtns: function(inst) {
        var self    = this;
        var running = !!inst.running;
        var wrap    = E('div', { 'style':'display:flex;gap:4px;justify-content:center;' });
        ACTIONS.forEach(function(act) {
            var disabled = running !== act.needRunning;
            wrap.appendChild(E('button', {
                'class':    'btn cbi-button' + (disabled ? '' : '-action'),
                'disabled': disabled ? 'disabled' : null,
                'style':    'padding:2px 8px;font-size:12px;',
                'click':    disabled ? null : function() {
                    self._doAction(act, inst.name);
                }
            }, act.label));
        });
        return wrap;
    },

    _buildWebBtn: function(inst, hasWeb) {
        if (hasWeb && inst.running) {
            var port = inst.web_addr.split(':')[1] || '80';
            return E('a', {
                'href':   window.location.protocol + '//' + window.location.hostname + ':' + port,
                'target': '_blank',
                'style':  'font-size:18px;text-decoration:none;',
                'title':  '进入 Web 管理'
            }, '🌐 ');
        }
        return E('span', { 'style':'color:#ccc;' }, '-');
    },

    _doAction: function(act, name) {
        var self = this;
        act.fn(name).then(function(result) {
            var ok = act.id === 'stop'
                ? result && (result.result === 'ok' || result.result === 'not_running')
                : result && result.result === 'ok';
            self._ui.notify(
                '实例 "' + name + '" ' + act.label +
                (ok ? ' 成功' : ' 失败：' + ((result && result.msg) || '未知错误')),
                ok ? 'success' : 'error'
            );
            callListInstances().then(function(r) {
                self._refreshRows((r && Array.isArray(r.instances)) ? r.instances : []);
            });
        }).catch(function(err) {
            self._ui.notify('操作失败：' + String(err), 'error');
        });
    },

    _renderCtrlPanel: function(instances) {
        var self = this;
        var wrap = E('div', { 'id':'vnt2-ctrl-panel-wrap' });
        self._syncCtrlPanelDom(
            wrap,
            instances.filter(function(i) { return i.type === 'vnt' && i.running; })
        );
        return wrap;
    },

    _syncCtrlPanelDom: function(wrap, vntInsts) {
        var self      = this;
        var hasTip    = !!wrap.querySelector('#vnt2-no-inst-tip');
        var hasSel    = !!wrap.querySelector('#vnt2-inst-select');

        if (!vntInsts.length) {
            if (!hasTip) {
                wrap.innerHTML = '';
                wrap.appendChild(E('p', {
                    'id':    'vnt2-no-inst-tip',
                    'style': 'color:#888;'
                }, '暂无运行中的客户端实例。'));
                self._selectedInstance = null;
            }
            return;
        }

        if (!hasSel) {
            wrap.innerHTML = '';
            var selValid = vntInsts.some(function(i) { return i.name === self._selectedInstance; });
            if (!selValid) self._selectedInstance = vntInsts[0].name;

            wrap.appendChild(self._buildCtrlPanelContent(vntInsts));

            window.setTimeout(function() {
                self._loadCtrlTab(self._selectedInstance, self._activeCtrlTab);
            }, 100);
            return;
        }

        self._syncInstSelect(vntInsts);
    },

    _syncInstSelect: function(vntInsts) {
        var self = this;
        var sel  = document.getElementById('vnt2-inst-select');
        if (!sel) return;

        var oldNames = [];
        for (var i = 0; i < sel.options.length; i++)
            oldNames.push(sel.options[i].value);
        var newNames = vntInsts.map(function(i) { return i.name; });

        var changed = oldNames.length !== newNames.length ||
            newNames.some(function(n, idx) { return n !== oldNames[idx]; });
        if (!changed) return;

        var selValid = vntInsts.some(function(i) { return i.name === self._selectedInstance; });
        if (!selValid) self._selectedInstance = vntInsts[0].name;

        sel.innerHTML = '';
        vntInsts.forEach(function(inst) {
            var opt = document.createElement('option');
            opt.value       = inst.name;
            opt.textContent = inst.name;
            if (inst.name === self._selectedInstance) opt.selected = true;
            sel.appendChild(opt);
        });
    },

    _buildCtrlPanelContent: function(vntInsts) {
        var self = this;

        var instSelect = E('select', {
            'id':     'vnt2-inst-select',
            'class':  'cbi-input-select',
            'style':  'width:auto;',
            'change': function(ev) {
                self._selectedInstance = ev.target.value;
                self._loadCtrlTab(self._selectedInstance, self._activeCtrlTab);
            }
        }, vntInsts.map(function(inst) {
            var a = { 'value':inst.name };
            if (inst.name === self._selectedInstance) a['selected'] = 'selected';
            return E('option', a, inst.name);
        }));

        var tabHeader = E('div', {
            'style': 'display:flex;border-bottom:2px solid #ddd;margin-top:12px;'
        }, CTRL_TABS.map(function(t) {
            var active = t.id === self._activeCtrlTab;
            return E('div', {
                'id':    'vnt2-ctrl-tabl-' + t.id,
                'style': [
                    'padding:6px 18px', 'cursor:pointer', 'font-size:13px', 'margin-bottom:-2px',
                    'border-bottom:' + (active ? '2px solid #3498db' : '2px solid transparent'),
                    'color:'         + (active ? '#3498db' : '#666')
                ].join(';'),
                'click': function() { self._switchCtrlTab(t.id); }
            }, t.label);
        }));

        var tabBody = E('div', {}, CTRL_TABS.map(function(t) {
            return E('div', {
                'id':    'vnt2-ctrl-tab-' + t.id,
                'style': 'display:' + (t.id === self._activeCtrlTab ? 'block' : 'none')
                       + ';padding:12px 0;'
            }, E('p', { 'style':'color:#888;font-style:italic;' }, '加载中...'));
        }));

        return E('div', {}, [
            E('div', { 'style':'display:flex;align-items:center;gap:8px;' }, [
                E('label', {}, '选择实例：'),
                instSelect,
                E('button', {
                    'class': 'btn cbi-button-action',
                    'click': function() {
                        if (self._selectedInstance)
                            self._loadCtrlTab(self._selectedInstance, self._activeCtrlTab);
                    }
                }, '刷新')
            ]),
            tabHeader,
            tabBody
        ]);
    },

    _switchCtrlTab: function(tid) {
        var self = this;
        self._activeCtrlTab = tid;
        CTRL_TABS.forEach(function(t) {
            var active = t.id === tid;
            var tabEl  = document.getElementById('vnt2-ctrl-tabl-' + t.id);
            var bodyEl = document.getElementById('vnt2-ctrl-tab-'  + t.id);
            if (tabEl) {
                tabEl.style.borderBottom = active ? '2px solid #3498db' : '2px solid transparent';
                tabEl.style.color        = active ? '#3498db' : '#666';
            }
            if (bodyEl) bodyEl.style.display = active ? 'block' : 'none';
        });
        if (self._selectedInstance)
            self._loadCtrlTab(self._selectedInstance, tid);
    },

    _loadCtrlTab: function(name, cmd) {
        var el = document.getElementById('vnt2-ctrl-tab-' + cmd);
        if (!el) return;
        el.innerHTML = '<p style="color:#888;font-style:italic;">加载中...</p>';
        callGetCtrlInfo(name, cmd).then(function(r) {
            el.innerHTML = '';
            var output = ((r && r.output) || '').replace(/\x1b\[[0-9;]*m/g, '');
            if (!output || output === '非客户端实例' || output === '控制端口已禁用') {
                el.appendChild(E('p', { 'style':'color:#888;' }, output || '暂无数据'));
                return;
            }
            el.appendChild(E('pre', {
                'style': [
                    'border:1px solid #ddd', 'border-radius:4px',
                    'padding:12px', 'margin:0', 'font-size:12px', 'line-height:1.6',
                    'max-height:300px', 'overflow-y:auto',
                    'white-space:pre-wrap', 'word-break:break-all'
                ].join(';')
            }, output));
        }).catch(function() {
            el.innerHTML = '<p style="color:#e00;">加载失败</p>';
        });
    },

    _refreshRows: function(instances) {
        var self = this;
        instances.forEach(function(inst) {
            var running = !!inst.running;
            var color   = runningColor(running);
            var hasWeb  = !!(inst.web_addr && inst.web_addr !== '');
            var row     = document.getElementById('vnt2-row-' + inst.name);
            if (!row) return;

            row.querySelectorAll('td').forEach(function(td) { td.style.color = color; });

            var els = getInstEls(inst.name);
            if (els.uptime) els.uptime.textContent = running ? formatUptime(inst.uptime) : '-';
            if (els.pid)    els.pid.textContent    = inst.pid || '-';
            if (els.res) {
                if (!running) {
                    els.res.textContent = '-';
                    delete _lastTicks[inst.name];
                } else {
                    var mem = inst.mem;
                    var el  = els.res;
                    fetchCpuAsync(inst, function(cpu) {
                        if (self._destroyed) return;
                        el.textContent = cpu + '%／' + mem + 'M';
                    });
                }
            }
            if (els.actions) {
                els.actions.innerHTML = '';
                els.actions.appendChild(self._buildActionBtns(inst));
            }
            if (els.web) {
                els.web.innerHTML = '';
                els.web.appendChild(self._buildWebBtn(inst, hasWeb));
            }
        });

        var wrap = document.getElementById('vnt2-ctrl-panel-wrap');
        if (wrap) {
            self._syncCtrlPanelDom(
                wrap,
                instances.filter(function(i) { return i.type === 'vnt' && i.running; })
            );
        }
    },

    destroy: function() {
        this._destroyed = true;
        _lastTicks = {};
        if (this._pollFn) poll.remove(this._pollFn);
    }
});