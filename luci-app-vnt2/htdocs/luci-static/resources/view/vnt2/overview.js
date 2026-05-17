'use strict';
'require view';
'require poll';
'require rpc';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callCheckBinaries  = rpcDeclare('check_binaries',   []);
var callListInstances  = rpcDeclare('list_instances',   []);
var callInstanceAction = rpcDeclare('instance_action',  ['name', 'action']);
var callGetCtrlInfo    = rpcDeclare('get_ctrl_info',    ['name', 'cmd']);
var callGetCpuTicks    = rpcDeclare('get_cpu_ticks',    ['name']);

var CTRL_TABS = [
    { id:'info',    label:_('Basic Info') },
    { id:'ips',     label:_('IP List')  },
    { id:'clients', label:_('Clients')   },
    { id:'route',   label:_('Routes')     }
];

var BIN_KEYS = [
    ['vnt2_cli',  'vnt2_cli' ],
    ['vnt2_web',  'vnt2_web' ],
    ['vnt2_ctrl', 'vnt2_ctrl'],
    ['vnts2',     'vnts2'    ],
];

var LINKS = [
    ['http://rustvnt.com',                        _('Official')  ],
    ['https://github.com/vnt-dev/vnt',            'GitHub'],
    ['https://github.com/vnt-dev/VntApp',         'GUIApp'],
    ['https://github.com/whzhni1/luci-app-vnt2', 'LuCI'  ],
];

var ACTIONS = [
    { id:'start',   label:_('Start'), needRunning:false },
    { id:'restart', label:_('Restart'), needRunning:true  },
    { id:'stop',    label:_('Stop'), needRunning:true  },
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
    if (d > 0) parts.push(d + _(' days'));
    if (h > 0) parts.push(h + _(' hrs'));
    if (m > 0) parts.push(m + _(' mins'));
    parts.push(s + _(' secs'));
    return parts.join('');
}

function refreshList(self) {
    return callListInstances().then(function(r) {
        var list = (r && Array.isArray(r.instances)) ? r.instances : [];
        self._instances = list;
        self._refreshRows(list);
        return list;
    });
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
        var self        = this;
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
            E('span', {}, _(' - Simple and efficient remote networking tool | '))];
        LINKS.forEach(function(lk, i) {
            if (i > 0) linkNodes.push(E('span', {}, ' | '));
            linkNodes.push(E('a', { 'href':lk[0], 'target':'_blank' }, lk[1]));
        });

        var node = E('div', { 'class':'cbi-map' }, [
            E('h2', {}, _('VNT2 Overview')),
            self._renderBinaryAlert(binaries),
            E('div', { 'class':'cbi-section' }, [
            E('div', { 'style':'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' }, [
                E('h3', { 'style':'margin:0;' }, [
                    E('span', {}, _('Instance Status ')),
                    E('span', {
                        'data-role': 'run-status',
                        'style':     'font-size:13px;font-weight:normal;color:#28a745;'
                    }, instances.filter(function(i){ return i.running; }).length + ' ' + _('running')),
                    E('span', {
                        'data-role': 'run-total',
                        'style':     'font-size:13px;font-weight:normal;color:#aaa;'
                    }, ' / ' + instances.length + ' ' + _('total'))
                ]),
                E('div', { 'style':'display:flex;gap:6px;' }, [
                    E('button', {
                        'class': 'btn cbi-button-action',
                        'style': 'padding:3px 10px;font-size:12px;',
                        'click': function() { self._doBatchAction('start'); }
                    }, _('Start All')),
                    E('button', {
                        'class': 'btn cbi-button-action',
                        'style': 'padding:3px 10px;font-size:12px;',
                        'click': function() { self._doBatchAction('restart'); }
                    }, _('Restart All')),
                    E('button', {
                        'class': 'btn cbi-button',
                        'style': 'padding:3px 10px;font-size:12px;color:#dc3545;border-color:#dc3545;',
                        'click': function() { self._doBatchAction('stop'); }
                    }, _('Stop All')),
                ])
            ]),
            self._renderInstanceTable(instances)
        ]),
            E('div', { 'class':'cbi-section' }, [
                E('h3', {}, _('Node Info')),
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
            E('strong', {}, _('⚠ Binary files missing: ')),
            E('span',   {}, ' ' + missing.join(', ')),
            E('br'),
            E('span',   {}, _('Please go to ')),
            E('a', {
                'href':  L.url('admin/vpn/vnt2/settings'),
                'style': 'text-decoration:underline;color:#0069d9;'
            }, _('Settings & Update')),
            E('span', {}, _(' page to download and install.'))
        ]);
    },

    _renderInstanceTable: function(instances) {
        var self = this;
        if (!instances.length)
            return E('p', { 'style':'color:#888;' },
                _('No instances yet. Please create one in client or server config page first.'));
        var thStyle = 'padding:8px 12px;text-align:center;';
        var heads   = [_('Instance Name'),_('Type'),_('Uptime'),'PID',_('CPU/RAM'),_('Quick Actions'),'Web UI'];
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
            E('td', { 'style':tdStyle }, inst.type === 'vnt' ? _('Client') : _('Server')),
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
                'click':    function() {
                    if (!disabled) self._doAction(act, inst.name);
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
                'title':  _('Enter Web Admin')
            }, '🌐 ');
        }
        return E('span', { 'style':'color:#ccc;' }, '-');
    },

    _doAction: function(act, name) {
        var self = this;
        callInstanceAction(name, act.id).then(function(result) {
            var ok = act.id === 'stop'
                ? result && (result.result === 'ok' || result.result === 'not_running')
                : result && result.result === 'ok';
            self._ui.notify(
                _('Instance "') + name + '" ' + act.label +
                (ok ? _(' success') : _(' failed: ') + ((result && result.msg) || _('Unknown error'))),
                ok ? 'success' : 'error'
            );
            refreshList(self);
        }).catch(function(err) {
            self._ui.notify(_('Operation failed: ') + String(err), 'error');
        });
    },

    _doBatchAction: function(actId) {
        var self = this;
        var act  = ACTIONS.filter(function(a) { return a.id === actId; })[0];
        if (!act) return;

        callInstanceAction(null, actId).then(function(r) {
            var results = (r && Array.isArray(r.results)) ? r.results : [];
            if (!results.length && r && r.result === 'ok') {
                self._ui.notify(_('All ') + act.label + _(' commands sent'), 'success');
                refreshList(self);
                return;
            }

            if (!results.length) {
                self._ui.notify(
                    _('No ') + (act.needRunning ? _('running') : _('stopped')) + _(' instances available for ') + act.label,
                    'error'
                );
                return;
            }

            var failed = results.filter(function(item) { return item.result !== 'ok'; });
            self._ui.notify(
                failed.length
                    ? act.label + _(' partially failed: ') + failed.map(function(item) {
                        return '"' + item.name + '"' + (item.msg ? ': ' + item.msg : '');
                    }).join(', ')
                    : _('All ') + act.label + _(' success (total ') + results.length + ')',
                failed.length ? 'error' : 'success'
            );
            refreshList(self);
        }).catch(function(err) {
            self._ui.notify(_('Batch ') + act.label + _(' failed: ') + String(err), 'error');
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
        var self   = this;
        var hasTip = !!wrap.querySelector('#vnt2-no-inst-tip');
        var hasSel = !!wrap.querySelector('#vnt2-inst-select');

        if (!vntInsts.length) {
            if (!hasTip) {
                wrap.innerHTML = '';
                wrap.appendChild(E('p', {
                    'id':    'vnt2-no-inst-tip',
                    'style': 'color:#888;'
                }, _('No running client instances.')));
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
            }, E('p', { 'style':'color:#888;font-style:italic;' }, _('Loading...')));
        }));

        return E('div', {}, [
            E('div', { 'style':'display:flex;align-items:center;gap:8px;' }, [
                E('label', {}, _('Select instance: ')),
                instSelect,
                E('button', {
                    'class': 'btn cbi-button-action',
                    'click': function() {
                        if (self._selectedInstance)
                            self._loadCtrlTab(self._selectedInstance, self._activeCtrlTab);
                    }
                }, _('Refresh'))
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
            if (!output || output === _('Non-client instance') || output === _('Control port disabled')) {
                el.appendChild(E('p', { 'style':'color:#888;' }, output || _('No data')));
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
            el.innerHTML = '<p style="color:#e00;">' + _('Loading failed') + '</p>';
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

        var runCount = instances.filter(function(i) { return i.running; }).length;
        var statusEl = document.querySelector('[data-role="run-status"]');
        var totalEl  = document.querySelector('[data-role="run-total"]');
        if (statusEl) statusEl.textContent = runCount + ' ' + _('running');
        if (totalEl)  totalEl.textContent  = ' / ' + instances.length + ' ' + _('total');
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