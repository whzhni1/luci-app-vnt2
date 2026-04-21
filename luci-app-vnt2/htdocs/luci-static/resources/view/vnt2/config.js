'use strict';
'require view';
'require ui';
'require uci';
'require rpc';
'require vnt2.common';

function rpcDeclare(method, params) {
    return rpc.declare({ object:'luci.vnt2', method:method, params:params||[] });
}
var callGetTemplateFields = rpcDeclare('get_template_fields', ['type']);
var callListConfigs       = rpcDeclare('list_configs',        ['filter']);
var callReadConfig        = rpcDeclare('read_config',         ['name','type']);
var callSaveConfig = rpcDeclare('save_config', ['name','type','content','old_name']);
var callDeleteConfig      = rpcDeclare('delete_config',       ['name','type']);
var callReadTemplate      = rpcDeclare('read_template',       ['type']);
var callListInstances     = rpcDeclare('list_instances',      []);
var callSetEnabled        = rpcDeclare('set_enabled',         ['type','configs']);
var callGetEnabled        = rpcDeclare('get_enabled',         ['type']);
var callRestartInstance   = rpcDeclare('restart_instance',    ['name']);

var TABS          = { vnt:'客户端', vnts:'服务端' };
var START_METHODS = { vnt:['vnt2_cli','vnt2_web'], vnts:['vnts2'] };

var _tab             = (location.hash === '#vnts') ? 'vnts' : 'vnt';
var _dirty           = false;
var _listState       = { vnt:{}, vnts:{} };
var _listStateLoaded = { vnt:false, vnts:false };
var _statusTimer     = null;

function defaultMethod(tab) { return START_METHODS[tab][0]; }

function parseInstanceList(instances) {
    var status = {}, webAddr = {};
    (instances || []).forEach(function(inst) {
        status[inst.name]  = inst.running;
        webAddr[inst.name] = inst.web_addr || '';
    });
    return { status:status, webAddr:webAddr };
}

function loadListState(tab) {
    if (_listStateLoaded[tab]) return Promise.resolve();
    return callGetEnabled(tab).then(function(r) {
        var state = {};
        ((r && r.configs) || []).forEach(function(item) {
            if (!item.name) return;
            var webReady    = !!(item.web_addr && item.web_addr.trim());
            var startMethod = item.method_set
                ? item.start_method
                : (tab === 'vnt' && webReady ? 'vnt2_web' : defaultMethod(tab));
            state[item.name] = {
                enabled:      !!item.enabled,
                start_method: startMethod,
                _methodSet:   true,
                _cfgWebAddr:  webReady ? '1' : ''
            };
        });
        _listState[tab]       = state;
        _listStateLoaded[tab] = true;
    });
}

function saveListState(self) {
    var state    = _listState;
    var promises = Object.keys(TABS).map(function(tab) {
        if (!_listStateLoaded[tab]) return Promise.resolve();
        var configs = Object.keys(state[tab]).map(function(name) {
            return {
                name:         name,
                enabled:      state[tab][name].enabled,
                start_method: state[tab][name].start_method
            };
        });
        return callSetEnabled(tab, configs);
    });

    return Promise.all(promises).then(function(results) {
        var failed = results.filter(function(r) { return r && r.result !== 'ok'; });
        if (failed.length) {
            self._ui.notify('部分保存失败', 'error');
            return;
        }
        self._ui.notify('配置已保存，等待实例状态更新...', 'success');
        return new Promise(function(resolve) {
            window.setTimeout(function() {
                refreshStatus(self).then(function() {
                    self._ui.notify('实例状态已更新', 'success');
                    resolve();
                });
            }, 3000);
        });
    }).catch(function(err) {
        self._ui.notify('保存出错：' + String(err), 'error');
    });
}

function switchTab(self, tab) {
    if (_tab === tab) return;
    var ew      = document.getElementById('vnt2-edit-wrap');
    var editing = ew && ew.style.display !== 'none';
    function doSwitch() {
        _tab          = tab;
        _dirty        = false;
        location.hash = tab;
        Object.keys(TABS).forEach(function(t) {
            var el = document.getElementById('vnt2-tab-' + t);
            if (!el) return;
            el.style.borderBottom = t === tab ? '2px solid #3498db' : '2px solid transparent';
            el.style.color        = t === tab ? '#3498db' : '#666';
        });
        showList();
        if (!self._configs[tab]) {
            Promise.all([callListConfigs(tab), loadListState(tab)]).then(function(res) {
                self._configs[tab] = (res[0] && Array.isArray(res[0].configs))
                    ? res[0].configs : [];
                rebuildTable(self);
            });
        } else {
            loadListState(tab).then(function() { rebuildTable(self); });
        }
    }
    if (editing && _dirty) {
        self._ui.confirm('放弃修改', '有未保存的修改切换标签将丢失，确定吗？')
            .then(function(ok) { if (ok) doSwitch(); });
    } else {
        doSwitch();
    }
}

function showList() {
    var lw = document.getElementById('vnt2-list-wrap');
    var ew = document.getElementById('vnt2-edit-wrap');
    if (lw) lw.style.display = '';
    if (ew) { ew.style.display = 'none'; ew.innerHTML = ''; }
}

function showEdit() {
    document.getElementById('vnt2-list-wrap').style.display = 'none';
    document.getElementById('vnt2-edit-wrap').style.display = '';
}

function startStatusTimer(self) {
    stopStatusTimer();
    _statusTimer = window.setInterval(function() { refreshStatus(self); }, 5000);
}

function stopStatusTimer() {
    if (_statusTimer) { window.clearInterval(_statusTimer); _statusTimer = null; }
}

function refreshStatus(self) {
    return callListInstances().then(function(r) {
        var parsed   = parseInstanceList(r && r.instances);
        self._status  = parsed.status;
        self._webAddr = parsed.webAddr;
        rebuildTable(self);
    }).catch(function() {});
}

function rebuildTable(self) {
    var wrap = document.getElementById('vnt2-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(buildTable(self));
}

function buildTable(self) {
    var configs = self._configs[_tab] || [];
    if (!configs.length)
        return E('p', { 'class':'vnt2-empty' },
            '暂无' + TABS[_tab] + '配置，点击"新建配置"开始添加。');
    var thStyle = 'padding:8px 12px;text-align:center;';
    var heads   = ['启用', '配置名称', '启动方式', '当前状态', '操作'];
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
            E('tbody', {}, configs.map(function(cfg) { return buildRow(self, cfg); }))
        ])
    );
}

function buildRow(self, cfg) {
    var tab     = _tab;
    var name    = cfg.name;
    var tdStyle = 'padding:8px 12px;text-align:center;vertical-align:middle;';
    var state   = ensureState(tab, name);
    var running = !!(self._status && self._status[name]);

    var cb = E('input', { 'type':'checkbox', 'style':'width:16px;height:16px;cursor:pointer;' });
    if (state.enabled) cb.setAttribute('checked', 'checked');
    cb.addEventListener('change', function() {
        _listState[tab][name].enabled = cb.checked;
        var cell = cb.closest('tr').querySelector('.vnt2-status-cell');
        if (cell) {
            cell.innerHTML = '';
            cell.appendChild(self._ui.statusBadge(
                cb.checked ? (self._status && self._status[name]) : null
            ));
        }
    });

    var btnEdit = E('button', {
        'class': 'btn cbi-button-edit',
        'style': 'margin-right:6px;',
        'click': function() { openEditor(self, name, false); }
    }, '编辑');

    var btnDel = E('button', {
        'class': 'btn cbi-button-negative',
        'click': function() { deleteConfig(self, name); }
    }, '删除');

    var statusCell = E('td', { 'class':'vnt2-status-cell', 'style':tdStyle },
        self._ui.statusBadge(state.enabled ? (self._status && self._status[name]) : null));

    return E('tr', { 'data-cfg-name':name }, [
        E('td', { 'style':tdStyle + 'cursor:pointer;',
            'click': function(ev) { if (ev.target !== cb) cb.click(); } }, cb),
        E('td', { 'class':'vnt2-col-name', 'style':tdStyle }, name),
        E('td', { 'style':tdStyle }, buildMethodSelect(self, tab, name)),
        statusCell,
        E('td', { 'style':tdStyle }, [btnEdit, btnDel])
    ]);
}

function buildMethodSelect(self, tab, name) {
    var state    = _listState[tab][name];
    var webReady = !!(state._cfgWebAddr && state._cfgWebAddr.trim());
    if (!state._methodSet) {
        state.start_method = (tab === 'vnt' && webReady) ? 'vnt2_web' : defaultMethod(tab);
        state._methodSet   = true;
    }
    var sel = E('select', { 'class':'cbi-input-select', 'style':'width:auto;' },
        START_METHODS[tab].map(function(m) {
            var attrs = { 'value':m };
            if (m === state.start_method)      attrs['selected'] = 'selected';
            if (m === 'vnt2_web' && !webReady) attrs['disabled'] = 'disabled';
            return E('option', attrs, m);
        })
    );
    sel.addEventListener('change', function() {
        _listState[tab][name].start_method = sel.value;
    });
    return sel;
}

function ensureState(tab, name) {
    if (!_listState[tab][name])
        _listState[tab][name] = {
            enabled:      false,
            start_method: defaultMethod(tab),
            _methodSet:   false,
            _cfgWebAddr:  ''
        };
    return _listState[tab][name];
}

function openEditor(self, name, isNew) {
    var ew = document.getElementById('vnt2-edit-wrap');
    if (!ew) return;
    ew.innerHTML = '';
    ew.appendChild(E('div', { 'class':'vnt2-loading' }, '加载配置中...'));
    showEdit();
    var tab = _tab;
    var p   = (isNew || !name)
        ? callReadTemplate(tab).then(function(r) {
            return { content: (r && r.content) || '', values: {} };
          })
        : callReadConfig(name, tab).then(function(r) {
            var c = (r && r.content) || '';
            return { content: c, values: self._parser.parseValues(c) };
          });
    p.then(function(res) {
        _dirty = false;
        ew.innerHTML = '';
        ew.appendChild(buildEditor(self, name, isNew, tab, res));
    }).catch(function(err) {
        self._ui.notify('加载失败：' + String(err), 'error');
        showList();
    });
}

function buildEditor(self, name, isNew, tab, res) {
    var fields = self._fields[tab] || [];
    var formEl = buildForm(fields, res.values);
    formEl.addEventListener('input',  function() { _dirty = true; });
    formEl.addEventListener('change', function() { _dirty = true; });

if (isNew && tab === 'vnt') {
    var tunInput = formEl.querySelector('[data-field-name="tun_name"]');
    if (tunInput) {
        tunInput._userEdited = false;
        tunInput.addEventListener('input', function() {
            tunInput._userEdited = true;
        });
    }
}
    var nameErr   = E('span', {
        'style': 'color:#dc3545;font-size:12px;margin-left:8px;display:none;'
    });
    var nameInput = E('input', {
        'type':        'text',
        'class':       'cbi-input-text',
        'style':       'width:auto;',
        'value':       name || '',
        'placeholder': '字母、数字、下划线、连字符'
    });
    nameInput.addEventListener('input', function() {
    _dirty = true;
    nameErr.style.display = 'none';
    if (isNew) {
        var tunInput = formEl.querySelector('[data-field-name="tun_name"]');
        if (tunInput && !tunInput._userEdited) {
            tunInput.value = 'vnt_' + nameInput.value.trim();
        }
    }
});

    function backToList() {
        if (_dirty) {
            self._ui.confirm('放弃修改', '有未保存的修改，确定放弃并返回吗？')
                .then(function(ok) { if (ok) { _dirty = false; showList(); } });
        } else {
            showList();
        }
    }

    return E('div', { 'class':'vnt2-edit-view' }, [
        E('div', { 'class':'vnt2-edit-header' }, [
            E('div', { 'class':'vnt2-breadcrumb' }, [
                E('span', { 'class':'vnt2-breadcrumb-link', 'click':backToList },
                    TABS[tab] + '配置列表'),
                E('span', { 'class':'vnt2-breadcrumb-sep' }, ' › '),
                E('span', {}, (isNew ? '新建' : '编辑') + '配置')
            ]),
            E('div', { 'style':'display:flex;align-items:center;margin-top:8px;' }, [
                E('label', { 'style':'font-weight:bold;margin-right:6px;flex-shrink:0;' },
                    '配置名称：'),
                nameInput,
                nameErr
            ])
        ]),
        E('div', { 'class':'vnt2-edit-body' }, formEl),
        E('div', { 'class':'vnt2-edit-footer' }, [
            E('button', { 'class':'btn', 'click':backToList }, '← 返回列表'),
            E('button', {
                'class': 'btn cbi-button-save',
                'click': function() {
                    var newName = nameInput.value.trim();
                    if (!newName || !/^[\w-]+$/.test(newName)) {
                        nameErr.textContent   = '名称只能包含字母、数字、下划线、连字符';
                        nameErr.style.display = 'inline';
                        nameInput.focus();
                        return;
                    }
                    if (isNew && self._configs[tab] &&
                        self._configs[tab].some(function(c) { return c.name === newName; })) {
                        nameErr.textContent   = '配置名称已存在';
                        nameErr.style.display = 'inline';
                        nameInput.focus();
                        return;
                    }
                    saveConfig(self, name, newName, tab, formEl, fields, res.content);
                }
            }, '保存配置')
        ])
    ]);
}

function buildForm(fields, values) {
    var form = E('div', { 'class':'vnt2-dyn-form' });
    if (!fields.length) {
        form.appendChild(E('p', { 'class':'vnt2-hint' }, '模板字段为空，请检查模板文件。'));
        return form;
    }
    fields.forEach(function(f) { form.appendChild(buildFormRow(f, values)); });
    return form;
}

function getPlaceholder(f) {
    var m = (f.comment || '').match(/示例[：:]\s*(\S+)/);
    return m ? m[1] : '';
}

function buildFormRow(f, values) {
    var val = Object.prototype.hasOwnProperty.call(values, f.name)
        ? values[f.name]
        : (f.type === 'section' ? {} : f['default']);
    var isRequired  = !!(f.comment && f.comment.indexOf('必填') !== -1);
    var nameEl      = E('div', { 'class':'vnt2-field-name' });
    nameEl.appendChild(document.createTextNode(f.name));
    if (isRequired) nameEl.appendChild(E('span', { 'class':'vnt2-required-star' }, ' *'));
    var commentText = (f.comment || '')
        .replace(/示例[：:]\s*\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return E('div', { 'class':'vnt2-field-row' }, [
        E('div', { 'class':'vnt2-field-label' }, [
            nameEl,
            commentText
                ? E('div', { 'class':'vnt2-field-desc' }, commentText)
                : E('span', {})
        ]),
        E('div', { 'class':'vnt2-field-input' }, buildInput(f, val, isRequired))
    ]);
}

var INPUT_BUILDERS = {
    bool:    function(f, v)    { return buildBool(f, v); },
    select:  function(f, v)    { return buildSelect(f, v); },
    array:   function(f, v, r) { return buildArray(f, v, r); },
    int:     function(f, v)    { return buildInt(f, v); },
    section: function(f, v)    { return buildSection(f, v); },
};

function buildInput(f, val, isRequired) {
    return (INPUT_BUILDERS[f.type] || buildText)(f, val, isRequired);
}

function buildBool(f, val) {
    var checked = (val === 'true' || val === true);
    var span    = E('span', { 'class':'vnt2-bool-label' }, checked ? '已启用' : '已禁用');
    var cb      = E('input', {
        'type': 'checkbox', 'class': 'vnt2-checkbox',
        'data-field-name': f.name, 'data-field-type': 'bool'
    });
    if (checked) cb.setAttribute('checked', 'checked');
    cb.addEventListener('change', function() {
        span.textContent = cb.checked ? '已启用' : '已禁用';
    });
    return E('label', { 'class':'vnt2-bool-wrap' }, [cb, span]);
}

function buildSelect(f, val) {
    var opts = [];
    if (Array.isArray(f.options) && f.options.length) {
        opts = f.options;
    } else if (typeof f.options === 'string' && f.options.trim()) {
        opts = f.options.split(',').map(function(o) { return o.trim(); }).filter(Boolean);
    }
    if (!opts.length && f.comment) {
        var m = f.comment.match(/选项[：:]\s*([^\n]+)/);
        if (m) opts = m[1].split(',').map(function(o) { return o.trim(); }).filter(Boolean);
    }
    var parsed = opts.map(function(o) {
        var i = o.indexOf('=');
        return i !== -1
            ? { value: o.substring(0, i).trim(),
                label: o.substring(0, i).trim() + ' — ' + o.substring(i + 1).trim() }
            : { value: o, label: o };
    });
    var options = [];
    if (!parsed.some(function(p) { return p.value === val; }) || val === '' || val == null)
        options.push(E('option', { 'value':'' }, '— 请选择 —'));
    parsed.forEach(function(p) {
        var a = { 'value':p.value };
        if (p.value === val) a['selected'] = 'selected';
        options.push(E('option', a, p.label));
    });
    return E('select', {
        'class': 'vnt2-input vnt2-select cbi-input-select',
        'data-field-name': f.name, 'data-field-type': 'select'
    }, options);
}

function buildText(f, val, isRequired) {
    return E('input', {
        'type': 'text', 'class': 'vnt2-input',
        'data-field-name': f.name, 'data-field-type': 'string',
        'value':       val != null ? String(val) : '',
        'placeholder': getPlaceholder(f)
    });
}

function buildInt(f, val) {
    return E('input', {
        'type': 'number', 'class': 'vnt2-input vnt2-input-number',
        'data-field-name': f.name, 'data-field-type': 'int',
        'value':       val != null ? String(val) : '0',
        'placeholder': getPlaceholder(f)
    });
}

function buildListField(f, items, cls) {
    var container = E('div', {
        'class':           'vnt2-' + cls + '-field',
        'data-field-name': f.name,
        'data-field-type': cls
    });

    function addRow(v) {
        var input = E('input', {
            'type':        'text',
            'class':       'vnt2-input vnt2-' + cls + '-item',
            'value':       v || '',
            'placeholder': getPlaceholder(f)
        });
        var btnAdd = E('button', {
            'type': 'button', 'class': 'btn vnt2-array-btn-add', 'title': '添加一行',
            'click': function(ev) {
                ev.preventDefault();
                var nr = addRow('');
                row.nextSibling
                    ? container.insertBefore(nr, row.nextSibling)
                    : container.appendChild(nr);
                nr.querySelector('.vnt2-' + cls + '-item').focus();
                container.dispatchEvent(new Event('input', { bubbles:true }));
            }
        }, '+');
        var btnDel = E('button', {
            'type': 'button', 'class': 'btn vnt2-array-btn-del', 'title': '删除此行',
            'click': function(ev) {
                ev.preventDefault();
                if (container.querySelectorAll('.vnt2-' + cls + '-row').length <= 1) {
                    input.value = ''; input.focus();
                } else {
                    container.removeChild(row);
                }
                container.dispatchEvent(new Event('input', { bubbles:true }));
            }
        }, '−');
        var row = E('div', { 'class':'vnt2-' + cls + '-row' }, [input, btnAdd, btnDel]);
        return row;
    }
    items.forEach(function(v) { container.appendChild(addRow(v)); });
    return container;
}

function buildArray(f, val, isRequired) {
    var items = Array.isArray(val)
        ? val.filter(function(v) { return String(v).trim() !== ''; })
        : (typeof val === 'string' && val.trim()
            ? (val.trim().charAt(0) === '['
                ? VNT2ConfigParser._parseArray(val.trim())
                : [val.trim()])
            : []);
    if (!items.length) items = [''];
    return buildListField(f, items, 'array');
}

function buildSection(f, val) {
    var items = (val && typeof val === 'object' && !Array.isArray(val))
        ? Object.keys(val).map(function(k) {
            return (val[k] || '').trim();
          }).filter(Boolean)
        : [];
    if (!items.length) items = [''];
    return buildListField(f, items, 'section', '');
}

function collectItems(el, selector) {
    var items = [];
    el.querySelectorAll(selector).forEach(function(inp) {
        var v = inp.value.trim();
        if (v) items.push(v);
    });
    return items;
}

function collectValues(formEl) {
    var vals = {};
    formEl.querySelectorAll('[data-field-name]').forEach(function(el) {
        var name = el.getAttribute('data-field-name');
        var type = el.getAttribute('data-field-type');
        if (!name) return;
        if (type === 'array') {
            vals[name] = collectItems(el, '.vnt2-array-item');
        } else if (type === 'section') {
            var obj     = {};
            var autoIdx = 1;
            collectItems(el, '.vnt2-section-item').forEach(function(line) {
                var eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                    var k = line.substring(0, eqIdx).trim();
                    var v = line.substring(eqIdx + 1).trim();
                    if (k && v) { obj[k] = v; autoIdx++; }
                } else {
                    obj['net' + autoIdx++] = line;
                }
            });
            vals[name] = obj;
        } else if (el.type === 'checkbox') {
            vals[name] = el.checked;
        } else if (type === 'int') {
            vals[name] = parseInt(el.value) || 0;
        } else {
            if (el.value === undefined) return;
            vals[name] = el.value.trim();
        }
    });
    return vals;
}

function validate(fields, formEl) {
    formEl.querySelectorAll('.vnt2-input-error').forEach(function(el) {
        el.classList.remove('vnt2-input-error');
    });
    var errors = [];
    fields.forEach(function(f) {
        if (!f.comment || f.comment.indexOf('必填') === -1) return;
        if (f.type === 'array') {
            var c = formEl.querySelector(
                '[data-field-name="' + f.name + '"][data-field-type="array"]'
            );
            if (!c) return;
            var ok = false;
            c.querySelectorAll('.vnt2-array-item').forEach(function(inp) {
                if (inp.value.trim()) ok = true;
            });
            if (!ok) {
                errors.push(f.name);
                var fi = c.querySelector('.vnt2-array-item');
                if (fi) fi.classList.add('vnt2-input-error');
            }
        } else {
            var el = formEl.querySelector('[data-field-name="' + f.name + '"]');
            if (!el || el.type === 'checkbox') return;
            if (!el.value.trim()) {
                errors.push(f.name);
                el.classList.add('vnt2-input-error');
            }
        }
    });
    return errors;
}

function saveConfig(self, oldName, newName, tab, formEl, fields, templateContent) {
    var errors = validate(fields, formEl);
    if (errors.length) {
        self._ui.notify('以下必填项未填写：' + errors.join('、'), 'error');
        var first = formEl.querySelector('.vnt2-input-error');
        if (first) first.scrollIntoView({ behavior:'smooth', block:'center' });
        return;
    }

    var content = self._parser.serializeToToml(fields, collectValues(formEl), templateContent);
    var renamed = !!(oldName && oldName !== newName);
    callSaveConfig(newName, tab, content, oldName || '').then(function(r) {
        if (!r || r.result !== 'ok') {
            self._ui.notify('保存失败：' + ((r && r.msg) || ''), 'error');
            return;
        }

        if (renamed) {
            _listState[tab][newName] = _listState[tab][oldName] || ensureState(tab, newName);
            delete _listState[tab][oldName];
        }

        _dirty = false;
        self._ui.notify('配置 "' + newName + '" 保存成功', 'success');

        if (tab === 'vnt') {
            var webReady = self._parser.hasWebAddr(content);
            var st       = ensureState(tab, newName);
            st._cfgWebAddr  = webReady ? '1' : '';
            st.start_method = webReady ? 'vnt2_web' : 'vnt2_cli';
            st._methodSet   = true;
        }

        var state = _listState[tab][newName] || ensureState(tab, newName);
        if (state.enabled) {
            self._ui.notify('实例已启用，正在重启...', 'success');
            callRestartInstance(newName).then(function(res) {
                var ok = res && res.result === 'ok';
                self._ui.notify(
                    ok ? '实例 "' + newName + '" 重启成功'
                       : '重启失败：' + ((res && res.msg) || '未知错误'),
                    ok ? 'success' : 'error'
                );
            }).catch(function(err) {
                self._ui.notify('重启出错：' + String(err), 'error');
            });
        }

        return Promise.all([callListConfigs(tab), refreshStatus(self)])
            .then(function(res) {
                self._configs[tab] = (res[0] && Array.isArray(res[0].configs))
                    ? res[0].configs : [];
                ensureState(tab, newName);
                rebuildTable(self);
                showList();
            });
    }).catch(function(err) {
        self._ui.notify('保存出错：' + String(err), 'error');
    });
}

function deleteConfig(self, name) {
    var tab     = _tab;
    var running = !!(self._status && self._status[name]);
    var msg = running
        ? '实例 "' + name + '" 正在运行，删除后将自动停止，确定吗？'
        : '确定要删除配置 "' + name + '" 吗？';

    self._ui.confirm('确认删除', msg).then(function(ok) {
        if (!ok) return;
        callDeleteConfig(name, tab).then(function(r) {
            if (r && r.result === 'ok') {
                self._ui.notify('配置 "' + name + '" 已删除', 'success');
                delete _listState[tab][name];
                return callListConfigs(tab).then(function(res) {
                    self._configs[tab] = (res && Array.isArray(res.configs))
                        ? res.configs : [];
                    rebuildTable(self);
                });
            }
            self._ui.notify('删除失败：' + ((r && r.msg) || ''), 'error');
        });
    });
}

return view.extend({
    load: function() {
        var initTab = (location.hash === '#vnts') ? 'vnts' : 'vnt';
        return Promise.all([
            L.require('vnt2.common'),
            L.uci.load('vnt2'),
            callGetTemplateFields('vnt'),
            callGetTemplateFields('vnts'),
            callListConfigs(initTab),
            callListInstances(),
        ]).then(function(data) {
            data._initTab = initTab;
            return data;
        });
    },

    render: function(data) {
        var self    = this;
        var initTab = data._initTab || 'vnt';
        self._ui     = data[0].VNT2UI;
        self._parser = data[0].VNT2ConfigParser;
        self._fields = {
            vnt:  (data[2] && Array.isArray(data[2].fields)) ? data[2].fields : [],
            vnts: (data[3] && Array.isArray(data[3].fields)) ? data[3].fields : []
        };
        self._configs          = { vnt:null, vnts:null };
        self._configs[initTab] = (data[4] && Array.isArray(data[4].configs))
            ? data[4].configs : [];
        var parsed    = parseInstanceList(data[5] && data[5].instances);
        self._status  = parsed.status;
        self._webAddr = parsed.webAddr;
        _listState       = { vnt:{}, vnts:{} };
        _listStateLoaded = { vnt:false, vnts:false };
        _tab   = initTab;
        _dirty = false;
        startStatusTimer(self);

        var view = E('div', { 'class':'cbi-map' }, [
            E('h2', {}, 'VNT2 配置管理'),
            E('div', { 'class':'cbi-section' }, [
                E('div', {
                    'style': 'display:flex;border-bottom:2px solid #ddd;margin-bottom:16px;'
                }, Object.keys(TABS).map(function(t) {
                    var active = t === initTab;
                    return E('div', {
                        'id':    'vnt2-tab-' + t,
                        'style': [
                            'padding:8px 24px', 'cursor:pointer', 'font-weight:bold',
                            'margin-bottom:-2px',
                            'border-bottom:' + (active ? '2px solid #3498db' : '2px solid transparent'),
                            'color:' + (active ? '#3498db' : '#666')
                        ].join(';'),
                        'click': function() { switchTab(self, t); }
                    }, TABS[t] + '配置');
                })),
                E('div', { 'id':'vnt2-list-wrap' }, [
                    E('div', {
                        'class': 'vnt2-toolbar',
                        'style': 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;'
                    }, [
                        E('button', {
                            'class': 'btn cbi-button-add',
                            'click': function() { openEditor(self, '', true); }
                        }, '+ 新建配置'),
                        E('button', {
                            'class': 'btn cbi-button-save',
                            'click': function() { saveListState(self); }
                        }, '保存并应用')
                    ]),
                    E('div', { 'id':'vnt2-table-wrap' },
                        E('p', { 'class':'vnt2-loading' }, '加载中...')
                    )
                ]),
                E('div', { 'id':'vnt2-edit-wrap', 'style':'display:none;' })
            ])
        ]);

        loadListState(initTab).then(function() { rebuildTable(self); });

        window.requestAnimationFrame(function() {
            var footer = document.querySelector('.cbi-page-actions');
            if (footer) footer.style.display = 'none';
        });

        return view;
    },

    handleSaveApply: function(ev, mode) { return saveListState(this); },
    handleSave:      function(ev)       { return L.uci.save(); },
    handleReset:     function() {
        _listState       = { vnt:{}, vnts:{} };
        _listStateLoaded = { vnt:false, vnts:false };
        loadListState(_tab);
        return L.uci.load('vnt2').then(L.bind(function() {
            rebuildTable(this);
        }, this));
    },
    destroy: function() { stopStatusTimer(); }
});