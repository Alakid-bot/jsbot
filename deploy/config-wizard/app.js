(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const discordIdPattern = /^\d{17,20}$/;
    const isOnlineMode = ['http:', 'https:'].includes(window.location.protocol);

    const fieldIds = [
        'token',
        'guildId',
        'serverType',
        'commandsDeployed',
        'administratorRoleIds',
        'moderatorRoleIds',
        'moderationLogThreadId',
        'threadLogThreadId',
        'opinionMailThreadId',
        'punishmentConfirmationChannelId',
        'eventsCategoryId',
        'autoDeleteChannels',
        'automationMode',
        'automationThreshold',
        'automationLogThreadId',
        'automationWhitelistedThreads',
        'roleLogThreadId',
        'creatorRoleId',
        'volunteerRoleId',
        'senatorRoleId',
        'appealDebateRoleId',
        'QAerRoleId',
        'senatorRoleForumId',
        'WarnedRoleId',
        'fastgptEnabled',
        'courtEnabled',
        'courtChannelId',
        'motionChannelId',
        'debateChannelId',
        'appealDuration',
        'summitDuration',
        'requiredSupports',
        'debateTagId',
        'motionTagId',
        'voteDuration',
        'monitorEnabled',
        'roleMonitorCategoryId',
        'monitorChannelId',
        'monitoredRoleId',
        'roleDisplayName',
    ];

    function trimValue(id) {
        return $(id).value.trim();
    }

    function nullableValue(id) {
        const value = trimValue(id);
        return value === '' ? null : value;
    }

    function numberValue(id, fallback) {
        const value = Number(trimValue(id));
        return Number.isFinite(value) ? value : fallback;
    }

    function parseList(value) {
        return value
            .split(/[\n,\s]+/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function setTextList(id, values) {
        $(id).value = Array.isArray(values) ? values.join('\n') : '';
    }

    function endpointNameKey(url) {
        try {
            const parsed = new URL(url);
            return `${parsed.protocol}//${parsed.hostname}`;
        } catch (_error) {
            return url;
        }
    }

    function utf8ToBase64(value) {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        const chunkSize = 0x8000;

        for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
        }

        return btoa(binary);
    }

    function base64ToUtf8(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }

        return new TextDecoder().decode(bytes);
    }

    function makeEndpointRow(endpoint = {}) {
        const row = document.createElement('div');
        row.className = 'endpoint-row';
        row.innerHTML = `
            <label class="field">
                <span>Endpoint URL</span>
                <input class="endpoint-url" type="url" placeholder="https://api.fastgpt.in/api/v1/chat/completions" />
            </label>
            <label class="field">
                <span>API Key</span>
                <input class="endpoint-key" type="password" placeholder="FastGPT API Key" autocomplete="new-password" />
            </label>
            <label class="field">
                <span>显示名称</span>
                <input class="endpoint-name" type="text" placeholder="默认AI答疑" />
            </label>
            <button class="danger remove-endpoint" type="button">删除</button>
        `;

        row.querySelector('.endpoint-url').value = endpoint.url || '';
        row.querySelector('.endpoint-key').value = endpoint.key || '';
        row.querySelector('.endpoint-name').value = endpoint.name || '';

        return row;
    }

    function ensureEndpointRow() {
        const container = $('fastgptEndpoints');
        if (!container.children.length) {
            container.appendChild(makeEndpointRow());
        }
    }

    function getEndpointRows() {
        return Array.from(document.querySelectorAll('.endpoint-row'));
    }

    function collectFastGPT(warnings) {
        const endpoints = [];
        const endpointNames = {};
        const rows = getEndpointRows();

        rows.forEach((row, index) => {
            const url = row.querySelector('.endpoint-url').value.trim();
            const key = row.querySelector('.endpoint-key').value.trim();
            const name = row.querySelector('.endpoint-name').value.trim();

            if (!url && !key && !name) {
                return;
            }

            if (!url || !key) {
                warnings.push(`FastGPT endpoint #${index + 1} 缺少 URL 或 API Key，已不会写入 endpoints。`);
                return;
            }

            if (!/^https?:\/\//i.test(url)) {
                warnings.push(`FastGPT endpoint #${index + 1} 建议使用 http(s) URL。`);
            }

            endpoints.push({ url, key });

            if (name) {
                endpointNames[endpointNameKey(url)] = name;
            }
        });

        if ($('fastgptEnabled').checked && endpoints.length === 0) {
            warnings.push('已启用 FastGPT，但还没有可用 endpoint。');
        }

        return {
            enabled: $('fastgptEnabled').checked,
            endpoints,
            endpointNames,
        };
    }

    function warnAboutIds(warnings, label, values) {
        values.filter((value) => value && !discordIdPattern.test(value)).forEach((value) => {
            warnings.push(`${label}「${value}」不像标准 Discord ID，请确认是否复制正确。`);
        });
    }

    function buildConfig() {
        const warnings = [];
        const token = trimValue('token');
        const guildId = trimValue('guildId');
        const administratorRoleIds = parseList($('administratorRoleIds').value);
        const moderatorRoleIds = parseList($('moderatorRoleIds').value);
        const autoDeleteChannels = parseList($('autoDeleteChannels').value);
        const automationWhitelistedThreads = parseList($('automationWhitelistedThreads').value);

        if (!token) {
            warnings.push('Discord Bot Token 为空，部署前必须填写。');
        }

        if (!guildId) {
            warnings.push('Guild / 服务器 ID 为空，部署前必须填写。');
        } else if (!discordIdPattern.test(guildId)) {
            warnings.push('Guild / 服务器 ID 不像标准 Discord ID，请确认是否复制正确。');
        }

        warnAboutIds(warnings, '管理员角色 ID', administratorRoleIds);
        warnAboutIds(warnings, '版主角色 ID', moderatorRoleIds);
        warnAboutIds(warnings, '自动删除频道 ID', autoDeleteChannels);
        warnAboutIds(warnings, '自动化白名单 Thread ID', automationWhitelistedThreads);

        const channelFields = [
            ['moderationLogThreadId', '处罚/管理日志 Thread ID'],
            ['threadLogThreadId', 'Thread 日志 Thread ID'],
            ['opinionMailThreadId', '意见箱 Thread ID'],
            ['punishmentConfirmationChannelId', '处罚确认频道 ID'],
            ['eventsCategoryId', '活动分类 Category ID'],
            ['automationLogThreadId', '自动化日志 Thread ID'],
            ['roleLogThreadId', '身份组申请日志 Thread ID'],
            ['creatorRoleId', '创作者角色 ID'],
            ['volunteerRoleId', '志愿者角色 ID'],
            ['senatorRoleId', '议员角色 ID'],
            ['appealDebateRoleId', '上诉辩论角色 ID'],
            ['QAerRoleId', '答疑者角色 ID'],
            ['senatorRoleForumId', '议员申请 Forum ID'],
            ['WarnedRoleId', '警告角色 ID'],
            ['courtChannelId', '法院频道 ID'],
            ['motionChannelId', '提案频道 ID'],
            ['debateChannelId', '辩论频道 ID'],
            ['debateTagId', '辩论 Tag ID'],
            ['motionTagId', '提案 Tag ID'],
            ['roleMonitorCategoryId', '角色监控分类 ID'],
            ['monitorChannelId', '监控频道 ID'],
            ['monitoredRoleId', '被监控角色 ID'],
        ];

        channelFields.forEach(([id, label]) => {
            const value = trimValue(id);
            if (value && !discordIdPattern.test(value)) {
                warnings.push(`${label}「${value}」不像标准 Discord ID，请确认是否复制正确。`);
            }
        });

        const serverConfig = {
            serverType: trimValue('serverType') || 'Main server',
            commandsDeployed: $('commandsDeployed').checked,
            moderationLogThreadId: nullableValue('moderationLogThreadId'),
            threadLogThreadId: nullableValue('threadLogThreadId'),
            opinionMailThreadId: nullableValue('opinionMailThreadId'),
            punishmentConfirmationChannelId: nullableValue('punishmentConfirmationChannelId'),
            AdministratorRoleIds: administratorRoleIds,
            ModeratorRoleIds: moderatorRoleIds,
            eventsCategoryId: nullableValue('eventsCategoryId'),
            automation: {
                mode: trimValue('automationMode') || 'disabled',
                threshold: numberValue('automationThreshold', 960),
                logThreadId: nullableValue('automationLogThreadId'),
                whitelistedThreads: automationWhitelistedThreads,
            },
            roleApplication: {
                logThreadId: nullableValue('roleLogThreadId'),
                creatorRoleId: nullableValue('creatorRoleId'),
                volunteerRoleId: nullableValue('volunteerRoleId'),
                senatorRoleId: nullableValue('senatorRoleId'),
                appealDebateRoleId: nullableValue('appealDebateRoleId'),
                QAerRoleId: nullableValue('QAerRoleId'),
                senatorRoleForumId: nullableValue('senatorRoleForumId'),
                WarnedRoleId: nullableValue('WarnedRoleId'),
            },
            fastgpt: collectFastGPT(warnings),
            courtSystem: {
                enabled: $('courtEnabled').checked,
                courtChannelId: nullableValue('courtChannelId'),
                motionChannelId: nullableValue('motionChannelId'),
                debateChannelId: nullableValue('debateChannelId'),
                appealDuration: numberValue('appealDuration', 259200000),
                summitDuration: numberValue('summitDuration', 604800000),
                requiredSupports: numberValue('requiredSupports', 20),
                debateTagId: nullableValue('debateTagId'),
                motionTagId: nullableValue('motionTagId'),
                voteDuration: numberValue('voteDuration', 86400000),
            },
            monitor: {
                enabled: $('monitorEnabled').checked,
                roleMonitorCategoryId: nullableValue('roleMonitorCategoryId'),
                monitorChannelId: nullableValue('monitorChannelId'),
                monitoredRoleId: nullableValue('monitoredRoleId'),
                roleDisplayName: trimValue('roleDisplayName') || '角色',
            },
            autoDeleteChannels,
        };

        return {
            config: {
                token,
                guilds: {
                    [guildId || 'YOUR_GUILD_ID']: serverConfig,
                },
            },
            warnings,
        };
    }

    function renderWarnings(warnings) {
        const box = $('warnings');

        if (!warnings.length) {
            box.hidden = true;
            box.innerHTML = '';
            $('statusPill').textContent = '配置可用';
            $('statusPill').classList.add('ok');
            return;
        }

        box.hidden = false;
        box.innerHTML = `<strong>需要确认：</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`;
        $('statusPill').textContent = `${warnings.length} 个提醒`;
        $('statusPill').classList.remove('ok');
    }

    function escapeHtml(value) {
        return value.replace(/[&<>"]/g, (char) => {
            const entities = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
            };
            return entities[char];
        });
    }

    function renderOutput() {
        const { config, warnings } = buildConfig();
        const json = `${JSON.stringify(config, null, 4)}\n`;
        const base64 = utf8ToBase64(json);

        $('configOutput').value = json;
        $('base64Output').value = base64;
        $('envOutput').value = `JSBOT_CONFIG_JSON_BASE64=${base64}\nNODE_ENV=production\n`;
        renderWarnings(warnings);
    }

    async function copyText(value, label) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(value);
            } else {
                const helper = document.createElement('textarea');
                helper.value = value;
                helper.setAttribute('readonly', '');
                helper.style.position = 'fixed';
                helper.style.opacity = '0';
                document.body.appendChild(helper);
                helper.select();
                document.execCommand('copy');
                helper.remove();
            }
            showCopyStatus(`已复制：${label}`);
        } catch (error) {
            showCopyStatus(`复制失败：${error.message}`);
        }
    }

    function showCopyStatus(message) {
        $('copyStatus').textContent = message;
        window.clearTimeout(showCopyStatus.timer);
        showCopyStatus.timer = window.setTimeout(() => {
            $('copyStatus').textContent = '';
        }, 2600);
    }

    function showServerStatus(message, isError = false) {
        const status = $('serverStatus');
        if (!status) {
            return;
        }
        status.textContent = message;
        status.classList.toggle('error', isError);
    }

    async function apiRequest(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            headers: {
                ...(options.body ? { 'content-type': 'application/json' } : {}),
                ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())
                    ? { 'x-jsbot-config': '1' }
                    : {}),
                ...(options.headers || {}),
            },
            cache: 'no-store',
        });

        const text = await response.text();
        let payload = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch (_error) {
                payload = { error: text.trim() };
            }
        }

        if (!response.ok) {
            throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
        }

        return payload;
    }

    function renderRuntimeStatus(status) {
        const box = $('runtimeStatus');
        if (!box || !status) {
            return;
        }

        box.hidden = false;
        const botState = status.bot?.running ? `运行中 PID ${status.bot.pid}` : '未运行';
        const configState = status.config?.exists ? `已保存，服务器数 ${status.config.guildCount}` : '尚未保存';
        box.innerHTML = `
            <strong>运行状态</strong>
            <dl>
                <div><dt>Bot</dt><dd>${escapeHtml(botState)}</dd></div>
                <div><dt>配置</dt><dd>${escapeHtml(configState)}</dd></div>
                <div><dt>配置路径</dt><dd>${escapeHtml(status.config?.path || '-')}</dd></div>
                <div><dt>最后启动</dt><dd>${escapeHtml(status.bot?.lastStartAt || '-')}</dd></div>
                <div><dt>最后退出</dt><dd>${escapeHtml(status.bot?.lastExit?.at || '-')}</dd></div>
            </dl>
        `;
    }

    async function refreshServerStatus() {
        if (!isOnlineMode) {
            return;
        }

        try {
            const status = await apiRequest('/api/status');
            renderRuntimeStatus(status);
            showServerStatus(status.bot?.running ? 'Bot 正在运行' : 'Bot 未运行或等待配置');
        } catch (error) {
            showServerStatus(`读取状态失败：${error.message}`, true);
        }
    }

    async function loadServerConfig() {
        try {
            const payload = await apiRequest('/api/config');
            if (payload.config) {
                applyConfig(payload.config);
                showServerStatus('已读取服务器配置');
            }
        } catch (error) {
            if (/404|not been created|has not been created/i.test(error.message)) {
                showServerStatus('服务器还没有保存配置，请填写后保存。');
                return;
            }
            showServerStatus(`读取服务器配置失败：${error.message}`, true);
        }
    }

    async function saveServerConfig() {
        try {
            const { config, warnings } = buildConfig();
            if (warnings.some((warning) => warning.includes('为空'))) {
                renderWarnings(warnings);
                showServerStatus('请先填写必填项后再保存。', true);
                return;
            }

            showServerStatus('正在保存配置并重启 Bot...');
            const payload = await apiRequest('/api/config', {
                method: 'POST',
                body: JSON.stringify({ config }),
            });
            renderRuntimeStatus(payload.status);
            showServerStatus('配置已保存，Bot 已重启/启动。');
        } catch (error) {
            showServerStatus(`保存失败：${error.message}`, true);
        }
    }

    async function restartBot() {
        try {
            showServerStatus('正在重启 Bot...');
            const payload = await apiRequest('/api/restart', { method: 'POST' });
            renderRuntimeStatus(payload.status);
            showServerStatus('Bot 已重启。');
        } catch (error) {
            showServerStatus(`重启失败：${error.message}`, true);
        }
    }

    function downloadConfig() {
        const blob = new Blob([$('configOutput').value], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'config.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function resetForm() {
        fieldIds.forEach((id) => {
            const element = $(id);
            if (!element) {
                return;
            }
            if (element.type === 'checkbox') {
                element.checked = false;
            } else {
                element.value = '';
            }
        });

        $('serverType').value = 'Main server';
        $('automationMode').value = 'disabled';
        $('automationThreshold').value = '960';
        $('appealDuration').value = '259200000';
        $('summitDuration').value = '604800000';
        $('requiredSupports').value = '20';
        $('voteDuration').value = '86400000';
        $('roleDisplayName').value = '角色';
        $('fastgptEndpoints').innerHTML = '';
        ensureEndpointRow();
        renderOutput();
    }

    function setNullable(id, value) {
        $(id).value = value == null ? '' : String(value);
    }

    function applyConfig(config) {
        $('token').value = config.token || '';

        const guildIds = Object.keys(config.guilds || {});
        const guildId = guildIds[0] || '';
        const guildConfig = (config.guilds && config.guilds[guildId]) || {};

        $('guildId').value = guildId;
        $('serverType').value = guildConfig.serverType || 'Main server';
        $('commandsDeployed').checked = Boolean(guildConfig.commandsDeployed);

        setNullable('moderationLogThreadId', guildConfig.moderationLogThreadId);
        setNullable('threadLogThreadId', guildConfig.threadLogThreadId);
        setNullable('opinionMailThreadId', guildConfig.opinionMailThreadId);
        setNullable('punishmentConfirmationChannelId', guildConfig.punishmentConfirmationChannelId);
        setNullable('eventsCategoryId', guildConfig.eventsCategoryId);
        setTextList('administratorRoleIds', guildConfig.AdministratorRoleIds);
        setTextList('moderatorRoleIds', guildConfig.ModeratorRoleIds);
        setTextList('autoDeleteChannels', guildConfig.autoDeleteChannels);

        const automation = guildConfig.automation || {};
        $('automationMode').value = automation.mode || 'disabled';
        $('automationThreshold').value = automation.threshold ?? 960;
        setNullable('automationLogThreadId', automation.logThreadId);
        setTextList('automationWhitelistedThreads', automation.whitelistedThreads);

        const roleApplication = guildConfig.roleApplication || {};
        setNullable('roleLogThreadId', roleApplication.logThreadId);
        setNullable('creatorRoleId', roleApplication.creatorRoleId);
        setNullable('volunteerRoleId', roleApplication.volunteerRoleId);
        setNullable('senatorRoleId', roleApplication.senatorRoleId);
        setNullable('appealDebateRoleId', roleApplication.appealDebateRoleId);
        setNullable('QAerRoleId', roleApplication.QAerRoleId);
        setNullable('senatorRoleForumId', roleApplication.senatorRoleForumId);
        setNullable('WarnedRoleId', roleApplication.WarnedRoleId);

        const fastgpt = guildConfig.fastgpt || {};
        $('fastgptEnabled').checked = Boolean(fastgpt.enabled);
        $('fastgptEndpoints').innerHTML = '';
        const endpointNames = fastgpt.endpointNames || {};
        const endpoints = Array.isArray(fastgpt.endpoints) ? fastgpt.endpoints : [];
        endpoints.forEach((endpoint) => {
            $('fastgptEndpoints').appendChild(
                makeEndpointRow({
                    url: endpoint.url || '',
                    key: endpoint.key || '',
                    name: endpointNames[endpointNameKey(endpoint.url || '')] || endpointNames[endpoint.url] || '',
                }),
            );
        });
        ensureEndpointRow();

        const courtSystem = guildConfig.courtSystem || {};
        $('courtEnabled').checked = Boolean(courtSystem.enabled);
        setNullable('courtChannelId', courtSystem.courtChannelId);
        setNullable('motionChannelId', courtSystem.motionChannelId);
        setNullable('debateChannelId', courtSystem.debateChannelId);
        $('appealDuration').value = courtSystem.appealDuration ?? 259200000;
        $('summitDuration').value = courtSystem.summitDuration ?? 604800000;
        $('requiredSupports').value = courtSystem.requiredSupports ?? 20;
        setNullable('debateTagId', courtSystem.debateTagId);
        setNullable('motionTagId', courtSystem.motionTagId);
        $('voteDuration').value = courtSystem.voteDuration ?? 86400000;

        const monitor = guildConfig.monitor || {};
        $('monitorEnabled').checked = Boolean(monitor.enabled);
        setNullable('roleMonitorCategoryId', monitor.roleMonitorCategoryId);
        setNullable('monitorChannelId', monitor.monitorChannelId);
        setNullable('monitoredRoleId', monitor.monitoredRoleId);
        $('roleDisplayName').value = monitor.roleDisplayName || '角色';

        if (guildIds.length > 1) {
            showCopyStatus(`已导入第一个服务器配置：${guildId}。多服务器配置请分别生成后手动合并。`);
        } else {
            showCopyStatus('已导入 config.json');
        }

        renderOutput();
    }

    async function importConfig(file) {
        if (!file) {
            return;
        }

        try {
            const text = await file.text();
            const config = JSON.parse(text);
            applyConfig(config);
        } catch (error) {
            showCopyStatus(`导入失败：${error.message}`);
        } finally {
            $('importFile').value = '';
        }
    }

    function wireEvents() {
        document.addEventListener('input', (event) => {
            if (event.target.closest('#configForm')) {
                renderOutput();
            }
        });

        document.addEventListener('change', (event) => {
            if (event.target.closest('#configForm')) {
                renderOutput();
            }
        });

        $('toggleToken').addEventListener('click', () => {
            const token = $('token');
            token.type = token.type === 'password' ? 'text' : 'password';
            $('toggleToken').textContent = token.type === 'password' ? '显示' : '隐藏';
        });

        $('addEndpoint').addEventListener('click', () => {
            $('fastgptEndpoints').appendChild(makeEndpointRow());
            renderOutput();
        });

        $('fastgptEndpoints').addEventListener('click', (event) => {
            const button = event.target.closest('.remove-endpoint');
            if (!button) {
                return;
            }
            button.closest('.endpoint-row').remove();
            ensureEndpointRow();
            renderOutput();
        });

        $('copyConfig').addEventListener('click', () => copyText($('configOutput').value, 'config.json'));
        $('copyBase64').addEventListener('click', () => copyText($('base64Output').value, 'JSBOT_CONFIG_JSON_BASE64'));
        $('copyEnv').addEventListener('click', () => copyText($('envOutput').value, 'Zeabur 环境变量'));
        $('downloadConfig').addEventListener('click', downloadConfig);
        $('resetForm').addEventListener('click', resetForm);
        $('importFile').addEventListener('change', (event) => importConfig(event.target.files[0]));

        if (isOnlineMode) {
            $('onlineActions').hidden = false;
            $('saveServerConfig').addEventListener('click', saveServerConfig);
            $('loadServerConfig').addEventListener('click', loadServerConfig);
            $('restartBot').addEventListener('click', restartBot);
        }
    }

    function setupMode() {
        if (!isOnlineMode) {
            $('modeTitle').textContent = '本地处理';
            $('modeDescription').textContent = '纯静态页面，数据只在浏览器本地处理；复制生成结果到 Zeabur 环境变量即可。';
            return;
        }

        $('modeTitle').textContent = 'Zeabur 在线配置';
        $('modeDescription').textContent = '此页面受 JSBOT_WEB_PASSWORD 保护，可保存配置到服务器并自动启动/重启 Bot。';
    }

    window.JSBotConfigWizard = {
        buildConfig,
        renderOutput,
        utf8ToBase64,
        base64ToUtf8,
        applyConfig,
    };

    ensureEndpointRow();
    setupMode();
    wireEvents();
    renderOutput();
    refreshServerStatus();
    if (isOnlineMode) {
        loadServerConfig();
        window.setInterval(refreshServerStatus, 10000);
    }
})();
