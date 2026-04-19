'use strict';

// /www/luci-static/resources/vnt2/common.js

var RE_TOML_TABLE = /^\[([a-zA-Z_][a-zA-Z0-9_]*)\]$/;
function escapeStr(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

var VNT2ConfigParser = {
    parseTemplate: function(content) {
        if (!content || typeof content !== 'string') return [];
        var lines          = content.split('\n');
        var fields         = [];
        var pendingComment = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) { pendingComment = []; continue; }
            if (line.charAt(0) === '#') {
                var commentText = line.substring(1).trim();
                if (/^[-=*\s]*$/.test(commentText)) { pendingComment = []; continue; }
                pendingComment.push(commentText);
                continue;
            }

            var tblMatch = line.match(RE_TOML_TABLE);
            if (tblMatch) {
                var fullCmt = pendingComment.join(' ');
                var typeM   = fullCmt.match(/\[(\w+)\]/);
                if (typeM && typeM[1] === 'section') {
                    fields.push({
                        name:      tblMatch[1],
                        type:      'section',
                        'default': {},
                        comment:   fullCmt.replace(/\[\w+\]/g, '').replace(/\s+/g, ' ').trim(),
                        options:   []
                    });
                }
                pendingComment = [];
                continue;
            }

            var eqIdx = line.indexOf('=');
            if (eqIdx < 0) { pendingComment = []; continue; }
            var key         = line.substring(0, eqIdx).trim();
            var rawVal      = line.substring(eqIdx + 1).trim();
            var fullComment = pendingComment.join(' ');
            var typeMatch   = fullComment.match(/\[(\w+)\]/);
            var fieldType   = typeMatch ? typeMatch[1] : this._inferType(rawVal);
            var options  = [];
            var optMatch = fullComment.match(/选项[：:]\s*([^\n]+)/);
            if (optMatch) {
                var optStr = optMatch[1].trim();
                options = (optStr.indexOf(',') !== -1)
                    ? optStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
                    : optStr.split(/\s+/).filter(Boolean);
            }

            fields.push({
                name:      key,
                type:      fieldType,
                'default': this._parseValue(rawVal, fieldType),
                comment:   fullComment.replace(/\[\w+\]/g, '').replace(/\s+/g, ' ').trim(),
                options:   options
            });
            pendingComment = [];
        }
        return fields;
    },

    parseValues: function(content) {
        if (!content || typeof content !== 'string') return {};
        var values         = {};
        var currentSection = null;
        content.split('\n').forEach(function(line) {
            var trimmed = line.trim();
            if (!trimmed || trimmed.charAt(0) === '#') return;
            var tblMatch = trimmed.match(RE_TOML_TABLE);
            if (tblMatch) {
                currentSection = tblMatch[1];
                if (!values[currentSection]) values[currentSection] = {};
                return;
            }

            var eqIdx = trimmed.indexOf('=');
            if (eqIdx < 0) return;
            var key = trimmed.substring(0, eqIdx).trim();
            var val = trimmed.substring(eqIdx + 1).trim();
            if (currentSection) {
                values[currentSection][key] = val.replace(/^["']|["']$/g, '');
            } else {
                values[key] = VNT2ConfigParser._parseRawValue(val);
            }
        });
        return values;
    },

    serializeToToml: function(fields, values, templateContent) {
        if (!templateContent) return '';
        var typeMap    = {};
        var sectionSet = {};
        fields.forEach(function(f) {
            typeMap[f.name] = f.type;
            if (f.type === 'section') sectionSet[f.name] = true;
        });

        var resultLines = [];
        var tplLines    = templateContent.split('\n');
        var inSection   = null;
        var sectionDone = {};
        for (var i = 0; i < tplLines.length; i++) {
            var line    = tplLines[i];
            var trimmed = line.trim();
            var tblMatch = trimmed.match(RE_TOML_TABLE);
            if (tblMatch) {
                var tbl   = tblMatch[1];
                inSection = sectionSet[tbl] ? tbl : null;
                if (sectionSet[tbl] && !sectionDone[tbl]) {
                    resultLines.push('');
                    resultLines.push('[' + tbl + ']');
                    var obj = values[tbl];
                    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                        Object.keys(obj).forEach(function(k) {
                            var v = String(obj[k]).trim();
                            if (k.trim() && v)
                                resultLines.push(k + ' = "' + escapeStr(v) + '"');
                        });
                    }
                    sectionDone[tbl] = true;
                } else {
                    resultLines.push(line);
                }
                continue;
            }

            if (inSection) {
                if (trimmed.charAt(0) === '#') resultLines.push(line);
                continue;
            }

            if (!trimmed || trimmed.charAt(0) === '#') {
                resultLines.push(line);
                continue;
            }

            var eqIdx = trimmed.indexOf('=');
            if (eqIdx >= 0) {
                var key = trimmed.substring(0, eqIdx).trim();
                resultLines.push(
                    Object.prototype.hasOwnProperty.call(values, key)
                        ? VNT2ConfigParser._formatField(key, values[key], typeMap[key])
                        : line
                );
                continue;
            }

            resultLines.push(line);
        }
        return resultLines.join('\n');
    },

    hasWebAddr: function(content) {
        if (!content || typeof content !== 'string') return false;
        var v = this.parseValues(content)['web_addr'];
        return typeof v === 'string' && v.trim() !== '';
    },

    _formatField: function(key, value, type) {
        if (type === 'array' || Array.isArray(value)) {
            var arr = Array.isArray(value) ? value : [];
            if (!arr.length) return key + ' = []';
            return key + ' = [' + arr.map(function(v) {
                return '"' + escapeStr(v) + '"';
            }).join(', ') + ']';
        }
        if (type === 'bool' || typeof value === 'boolean')
            return key + ' = ' + (value ? 'true' : 'false');
        if (type === 'int' || typeof value === 'number')
            return key + ' = ' + (parseInt(value) || 0);
        if (typeof value === 'string')
            return key + ' = "' + escapeStr(value) + '"';
        return key + ' = ' + String(value);
    },

    _inferType: function(rawVal) {
        if (rawVal === 'true' || rawVal === 'false') return 'bool';
        if (rawVal.charAt(0) === '[')               return 'array';
        if (/^\d+$/.test(rawVal))                   return 'int';
        return 'string';
    },

    _parseValue: function(rawVal, type) {
        if (type === 'bool')  return rawVal === 'true';
        if (type === 'int')   return parseInt(rawVal) || 0;
        if (type === 'array') return this._parseArray(rawVal);
        return rawVal.replace(/^["']|["']$/g, '');
    },

    _parseRawValue: function(rawVal) {
        if (rawVal === 'true')        return true;
        if (rawVal === 'false')       return false;
        if (rawVal.charAt(0) === '[') return this._parseArray(rawVal);
        if (/^\d+$/.test(rawVal))     return parseInt(rawVal);
        return rawVal.replace(/^["']|["']$/g, '');
    },

    _parseArray: function(rawVal) {
        var inner = rawVal.replace(/^\s*\[\s*|\s*\]\s*$/g, '');
        if (!inner.trim()) return [];
        var results = [], re = /"([^"]*)"|'([^']*)'/g, m;
        while ((m = re.exec(inner)) !== null)
            results.push(m[1] !== undefined ? m[1] : m[2]);
        return results.length ? results
            : inner.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    }
};

var VNT2UI = {
    notify: function(msg, type) {
        var bg = { success:'#28a745', error:'#dc3545', info:'#17a2b8' }[type] || '#17a2b8';
        var el = E('div', {
            'style': [
                'position:fixed', 'top:60px', 'right:20px', 'z-index:9999',
                'padding:10px 20px', 'border-radius:4px', 'background:' + bg,
                'color:#fff', 'font-size:14px', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
                'max-width:400px', 'word-break:break-all', 'cursor:pointer'
            ].join(';'),
            'click': function() { if (el.parentNode) el.parentNode.removeChild(el); }
        }, msg);
        document.body.appendChild(el);
        window.setTimeout(function() {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 5000);
    },

    confirm: function(title, msg) {
        return new Promise(function(resolve) {
            L.ui.showModal(title, [
                E('p', {}, msg),
                E('div', { 'class':'right', 'style':'margin-top:12px;' }, [
                    E('button', {
                        'class':'btn', 'style':'margin-right:8px;',
                        'click': function() { L.ui.hideModal(); resolve(false); }
                    }, '取消'),
                    E('button', {
                        'class':'btn cbi-button-action important',
                        'click': function() { L.ui.hideModal(); resolve(true); }
                    }, '确认')
                ])
            ]);
        });
    },

    statusBadge: function(running) {
        if (running === undefined || running === null)
            return E('span', { 'style':'color:#999;font-size:13px;' }, '未启用');
        return E('span', {
            'style': 'color:' + (running ? '#28a745' : '#dc3545') + ';font-weight:bold;font-size:13px;'
        }, running ? '✓ 运行中' : '✗ 未运行');
    },

    buildFormRow: function(label, inputEl, desc) {
        return E('div', {
            'style': 'display:flex;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f0f0f0;'
        }, [
            E('div', { 'style':'width:220px;font-weight:bold;padding-top:4px;flex-shrink:0;' }, label),
            E('div', { 'style':'flex:1;' }, [
                inputEl,
                desc ? E('div', { 'style':'color:#888;font-size:12px;margin-top:4px;' }, desc)
                     : E('span', {})
            ])
        ]);
    }
};

return L.Class.extend({
    VNT2ConfigParser: VNT2ConfigParser,
    VNT2UI:           VNT2UI
});
