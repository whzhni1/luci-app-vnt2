'use strict';
'require view';
'require rpc';
'require poll';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callListInstances = rpcDeclare('list_instances', []);
var callGetLog        = rpcDeclare('get_log',        ['name','lines']);
var callClearLog      = rpcDeclare('clear_log',      ['name']);

var LINE_OPTIONS = [100, 200, 500, 1000, 0];

var MONTH_MAP = {
    Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
    Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12'
};

var LOG_COLORS = [
    [/\b(ERROR|error|ERR)\b/,   '#f04040'],
    [/\b(WARN|warn|WARNING)\b/, '#f0c040'],
    [/\b(INFO|info)\b/,         '#6ab0f5'],
    [/\b(DEBUG|debug)\b/,       '#888888'],
];

function getLogEl() {
    return document.getElementById('vnt2-log-content');
}

function scrollLog(toBottom) {
    var el = getLogEl();
    if (el) el.scrollTop = toBottom ? el.scrollHeight : 0;
}

function parseLogreadTime(raw) {
    raw = raw.trim();
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var m1  = raw.match(/^\w{3}\s+(\w{3})\s+(\d+)\s+([\d:]+)\s+(\d{4})$/);
    if (m1)
        return m1[4] + '-' + (MONTH_MAP[m1[1]]||'01') + '-' + pad(m1[2]) + ' ' + m1[3];
    var m2 = raw.match(/^(\w{3})\s+(\d+)\s+([\d:]+)$/);
    if (m2)
        return new Date().getFullYear() + '-' + (MONTH_MAP[m2[1]]||'01') + '-'
            + pad(m2[2]) + ' ' + m2[3];
    return raw;
}

function getLineColor(line) {
    for (var i = 0; i < LOG_COLORS.length; i++)
        if (LOG_COLORS[i][0].test(line)) return LOG_COLORS[i][1];
    return '#d4d4d4';
}

function buildLogLine(timeStr, body) {
    var span = E('span', { 'style':'display:block;line-height:1.6;' });
    if (timeStr)
        span.appendChild(E('span', { 'style':'color:#6a9153;margin-right:8px;' }, timeStr));
    span.appendChild(E('span', { 'style':'color:' + getLineColor(body) + ';' }, body));
    return span;
}

return view.extend({

    _pollHandle:     null,
    _instPollHandle: null,

    load: function() {
        return Promise.all([
            L.require('vnt2.common'),
            callListInstances()
        ]);
    },

    render: function(data) {
        var self      = this;
        self._ui      = data[0].VNT2UI;
        var instances = (data[1] && Array.isArray(data[1].instances))
            ? data[1].instances : [];
        self._instances       = instances;
        self._currentInstance = instances.length ? instances[0].name : null;

        var node = E('div', { 'class':'cbi-map' }, [
            E('h2', {}, 'VNT2 日志'),
            E('div', { 'class':'cbi-section' }, [
                self._renderToolbar(),
                E('pre', {
                    'id':    'vnt2-log-content',
                    'style': [
                        'background:#1e1e1e', 'color:#d4d4d4', 'padding:16px',
                        'border-radius:8px', 'outline:1px solid #fff',
                        'font-family:monospace', 'font-size:12px',
                        'height:500px', 'overflow-y:auto',
                        'white-space:pre-wrap', 'word-break:break-all',
                        'margin-top:12px'
                    ].join(';')
                }, self._currentInstance ? '加载中...' : '暂无实例')
            ])
        ]);

        if (self._currentInstance)
            window.setTimeout(function() { self._loadLog(); }, 200);
        self._instPollHandle = window.setInterval(function() {
            self._refreshInstances();
        }, 5000);

        window.setTimeout(function() {
            var el = document.querySelector('.cbi-page-actions');
            if (el) el.style.display = 'none';
        }, 0);

        return node;
    },

    _instLabel: function(inst) {
        var type   = inst.type === 'vnt' ? '客户端' : '服务端';
        var status = inst.running ? '运行中' : '已停止';
        return inst.name + ' (' + type + ' · ' + status + ')';
    },

    _renderToolbar: function() {
        var self = this;

        var instanceSelect = E('select', {
            'id':     'vnt2-inst-select',
            'class':  'cbi-input-select',
            'style':  'width:auto;',
            'change': function(ev) {
                self._currentInstance = ev.target.value;
                self._loadLog();
            }
        }, self._instances.length
            ? self._instances.map(function(inst) {
                var a = { 'value':inst.name };
                if (inst.name === self._currentInstance) a['selected'] = 'selected';
                return E('option', a, self._instLabel(inst));
              })
            : [E('option', { 'value':'' }, '暂无实例')]
        );

        var linesSelect = E('select', {
            'class':  'cbi-input-select',
            'id':     'vnt2-log-lines',
            'style':  'width:auto;',
            'change': function() { self._loadLog(); }
        }, LINE_OPTIONS.map(function(n) {
            var a = { 'value': String(n) };
            if (n === 200) a['selected'] = 'selected';
            return E('option', a, n === 0 ? '全部' : '最近 ' + n + ' 行');
        }));

        var autoCheck = E('input', {
            'type':   'checkbox',
            'style':  'vertical-align:middle;margin-right:4px;',
            'change': function(ev) { self._toggleAuto(ev.target.checked); }
        });

        var btns = [
            { label:'刷新',     cls:'btn cbi-button-action',  fn: function() { self._loadLog(); }  },
            { label:'清理日志', cls:'btn cbi-button-negative', fn: function() { self._clearLog(); } },
            { label:'滚到顶部', cls:'btn',                     fn: function() { scrollLog(false); } },
            { label:'滚到底部', cls:'btn',                     fn: function() { scrollLog(true);  } },
        ];

        return E('div', {
            'style': [
                'display:flex', 'align-items:center', 'flex-wrap:wrap', 'gap:8px',
                'padding:12px', 'border-radius:8px', 'box-shadow:0 0 0 1px #ddd',
                'margin-bottom:12px'
            ].join(';')
        }, [
            E('label', {}, '实例：'),
            instanceSelect,
            linesSelect,
            E('label', { 'style':'cursor:pointer;user-select:none;' },
                [autoCheck, '自动刷新(5s)']),
        ].concat(btns.map(function(b) {
            return E('button', { 'class':b.cls, 'click':b.fn }, b.label);
        })));
    },

    _refreshInstances: function() {
        var self = this;
        callListInstances().then(function(r) {
            var instances = (r && Array.isArray(r.instances)) ? r.instances : [];
            self._instances = instances;
            var selExists = instances.some(function(i) {
                return i.name === self._currentInstance;
            });
            if (!selExists)
                self._currentInstance = instances.length ? instances[0].name : null;

            self._rebuildSelect(instances);
        }).catch(function() {});
    },

    _rebuildSelect: function(instances) {
        var self = this;
        var sel  = document.getElementById('vnt2-inst-select');
        if (!sel) return;

        sel.innerHTML = '';

        if (!instances.length) {
            var opt         = document.createElement('option');
            opt.value       = '';
            opt.textContent = '暂无实例';
            sel.appendChild(opt);
            var el = getLogEl();
            if (el) el.textContent = '暂无实例';
            return;
        }

        instances.forEach(function(inst) {
            var opt         = document.createElement('option');
            opt.value       = inst.name;
            opt.textContent = self._instLabel(inst);
            if (inst.name === self._currentInstance) opt.selected = true;
            sel.appendChild(opt);
        });
    },

    _formatLog: function(content) {
        var el = getLogEl();
        if (!el) return;
        el.innerHTML = '';

        var lines      = content.split('\n');
        var hasContent = false;

        lines.forEach(function(line) {
            if (!line.trim()) return;
            hasContent = true;
            var timeStr = '';
            var body    = line;
            var m1 = line.match(
                /^(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+\S+\s+\S+\s+(.*)$/
            );
            var m2 = !m1 && line.match(
                /^(\w{3}\s+\d+\s+[\d:]+)\s+\S+\s+\S+\s+(.*)$/
            );

            if (m1)      { timeStr = parseLogreadTime(m1[1]); body = m1[2]; }
            else if (m2) { timeStr = parseLogreadTime(m2[1]); body = m2[2]; }
            body = body.replace(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})\s*/,
                ''
            );

            el.appendChild(buildLogLine(timeStr, body || line));
        });

        if (!hasContent)
            el.appendChild(E('span', {
                'style': 'color:#888;font-style:italic;'
            }, '（暂无日志）'));

        el.scrollTop = el.scrollHeight;
    },

    _loadLog: function() {
        var self    = this;
        if (!self._currentInstance) return;
        var linesEl = document.getElementById('vnt2-log-lines');
        var lines   = linesEl ? parseInt(linesEl.value) : 200;
        var linesArg = lines === 0 ? null : lines;
        var el = getLogEl();
        if (el) el.textContent = '加载中...';

        callGetLog(self._currentInstance, linesArg).then(function(r) {
            var content = (r && r.content) || '';
            if (!content.trim()) {
                var el2 = getLogEl();
                if (el2) {
                    el2.innerHTML = '';
                    el2.appendChild(E('span', {
                        'style': 'color:#888;font-style:italic;'
                    }, '（暂无日志，实例可能尚未启动或未产生输出）'));
                }
                return;
            }
            self._formatLog(content);
        }).catch(function() {
            var el2 = getLogEl();
            if (el2) el2.textContent = '加载日志失败';
        });
    },

    _clearLog: function() {
        var self = this;
        if (!self._currentInstance) return;
        callClearLog(self._currentInstance).then(function() {
            self._loadLog();
        });
    },

    _stopAuto: function() {
        if (this._pollHandle) {
            window.clearInterval(this._pollHandle);
            this._pollHandle = null;
        }
    },

    _toggleAuto: function(enabled) {
        var self = this;
        self._stopAuto();
        if (enabled)
            self._pollHandle = window.setInterval(function() { self._loadLog(); }, 5000);
    },

    destroy: function() {
        this._stopAuto();
        if (this._instPollHandle) {
            window.clearInterval(this._instPollHandle);
            this._instPollHandle = null;
        }
    }
});