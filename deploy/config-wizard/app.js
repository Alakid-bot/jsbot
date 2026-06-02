(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const discordIdPattern = /^\d{17,20}$/;
    const isOnlineMode = ['http:', 'https:'].includes(window.location.protocol);
    let statusTimer = null;

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
        'appealDurationHours',
        'summitDurationHours',
        'requiredSupports',
        'debateTagId',
        'motionTagId',
        'voteDurationHours',
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

    function durationMsFromHours(id, fallbackHours) {
        const value = Number(trimValue(id));
        const hours = Number.isFinite(value) ? value : fallbackHours;
        return Math.max(0, Math.round(hours * 60 * 60 * 1000));
    }

    function hoursFromMs(value, fallbackHours) {
        const milliseconds = Number(value);
        const hours = Number.isFinite(milliseconds) ? milliseconds / 60 / 60 / 1000 : fallbackHours;
        return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
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

    function normalizeOpenAICompatibleUrl(url) {
        const trimmed = url.trim().replace(/\/+$/, '');
        if (!trimmed || /\/chat\/completions$/i.test(trimmed)) {
            return trimmed;
        }

        if (/\/v\d+$/i.test(trimmed)) {
            return `${trimmed}/chat/completions`;
        }

        try {
            const parsed = new URL(trimmed);
            if (/deepseek\.com$/i.test(parsed.hostname)) {
                return `${trimmed}/chat/completions`;
            }
        } catch (_error) {
            // 非 URL 时保持后续通用拼接和提醒逻辑。
        }

        return `${trimmed}/v1/chat/completions`;
    }

    function endpointPreset(type) {
        if (type === 'openai') {
            return {
                provider: 'openai-compatible',
                url: 'https://api.openai.com/v1/chat/completions',
                model: 'gpt-4o-mini',
                name: 'OpenAI',
                contentFormat: 'text',
            };
        }

        if (type === 'deepseek') {
            return {
                provider: 'openai-compatible',
                url: 'https://api.deepseek.com/chat/completions',
                model: 'deepseek-chat',
                name: 'DeepSeek',
                contentFormat: 'text',
            };
        }

        if (type === 'fastgpt') {
            return {
                provider: 'fastgpt',
                url: 'https://api.fastgpt.in/api/v1/chat/completions',
                name: 'FastGPT',
                contentFormat: 'multimodal',
            };
        }

        return {};
    }

    function recommendedContentFormat(provider) {
        if (provider === 'fastgpt') {
            return 'multimodal';
        }

        if (provider === 'openai-compatible') {
            return 'text';
        }

        return 'auto';
    }

    function applyEndpointProviderHints(row) {
        const provider = row.querySelector('.endpoint-provider').value;
        const urlInput = row.querySelector('.endpoint-url');
        const keyInput = row.querySelector('.endpoint-key');
        const modelInput = row.querySelector('.endpoint-model');

        if (provider === 'fastgpt') {
            urlInput.placeholder = 'https://api.fastgpt.in/api/v1/chat/completions';
            keyInput.placeholder = 'FastGPT API Key';
            modelInput.placeholder = 'FastGPT 可留空';
        } else if (provider === 'openai-compatible') {
            urlInput.placeholder = 'https://api.openai.com/v1/chat/completions';
            keyInput.placeholder = 'sk-...';
            modelInput.placeholder = 'gpt-4o-mini / deepseek-chat';
        } else {
            urlInput.placeholder = 'https://your-provider.example/v1/chat/completions';
            keyInput.placeholder = 'API Key / Bearer Token';
            modelInput.placeholder = '模型名，可选';
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
                <span>接口类型</span>
                <select class="endpoint-provider">
                    <option value="fastgpt">FastGPT</option>
                    <option value="openai-compatible">OpenAI 兼容</option>
                    <option value="custom">自定义</option>
                </select>
            </label>
            <label class="field">
                <span>API 接口地址</span>
                <input class="endpoint-url" type="url" placeholder="https://api.openai.com/v1/chat/completions" />
                <small>可填完整 <code>/chat/completions</code> 地址，也可只填服务根地址（如 <code>https://api.openai.com/v1</code>），保存时会自动补齐。</small>
            </label>
            <label class="field">
                <span>SK / API Key <em class="key-warning">会保存到服务器</em></span>
                <div class="password-row">
                    <input class="endpoint-key" type="password" placeholder="sk-..." autocomplete="new-password" />
                    <button class="ghost small toggle-key" type="button">显示</button>
                </div>
            </label>
            <label class="field">
                <span>模型名</span>
                <input class="endpoint-model" type="text" placeholder="gpt-4o-mini / deepseek-chat" />
                <small>FastGPT 可留空；OpenAI 兼容通常必填。</small>
            </label>
            <label class="field">
                <span>内容格式</span>
                <select class="endpoint-content-format">
                    <option value="auto">自动</option>
                    <option value="text">纯文本兼容</option>
                    <option value="multimodal">多模态/图片</option>
                </select>
                <small>DeepSeek 等文本模型选“纯文本”；视觉模型可选“多模态”。</small>
            </label>
            <label class="field">
                <span>显示名称</span>
                <input class="endpoint-name" type="text" placeholder="默认 AI 答疑" />
            </label>
            <button class="danger remove-endpoint" type="button">删除</button>
        `;

        const providerSelect = row.querySelector('.endpoint-provider');
        providerSelect.value = endpoint.provider || (endpoint.model ? 'openai-compatible' : 'fastgpt');
        row.querySelector('.endpoint-url').value = endpoint.url || '';
        const keyInput = row.querySelector('.endpoint-key');
        keyInput.value = endpoint.key || '';
        row.querySelector('.endpoint-model').value = endpoint.model || '';
        row.querySelector('.endpoint-content-format').value = endpoint.contentFormat || recommendedContentFormat(providerSelect.value);
        row.querySelector('.endpoint-name').value = endpoint.name || '';
        applyEndpointProviderHints(row);

        const toggleBtn = row.querySelector('.toggle-key');
        toggleBtn.addEventListener('click', () => {
            keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
            toggleBtn.textContent = keyInput.type === 'password' ? '显示' : '隐藏';
        });

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
            const provider = row.querySelector('.endpoint-provider').value.trim() || 'fastgpt';
            const rawUrl = row.querySelector('.endpoint-url').value.trim();
            const key = row.querySelector('.endpoint-key').value.trim();
            const model = row.querySelector('.endpoint-model').value.trim();
            const contentFormat = row.querySelector('.endpoint-content-format').value.trim() || 'auto';
            const name = row.querySelector('.endpoint-name').value.trim();

            if (!rawUrl && !key && !model && !name) {
                return;
            }

            const url = provider === 'openai-compatible' ? normalizeOpenAICompatibleUrl(rawUrl) : rawUrl;

            if (!url || !key) {
                warnings.push(`AI 接口 #${index + 1} 缺少 URL 或 SK/API Key，已不会写入 endpoints。`);
                return;
            }

            if (!/^https?:\/\//i.test(url)) {
                warnings.push(`AI 接口 #${index + 1} 建议使用 http(s) URL。`);
            }

            if (provider === 'openai-compatible') {
                if (!model) {
                    warnings.push(`OpenAI 兼容接口 #${index + 1} 模型名为空，已不会写入 endpoints。`);
                    return;
                }
            }

            endpoints.push({
                provider,
                url,
                key,
                contentFormat,
                ...(model ? { model } : {}),
            });

            if (name) {
                endpointNames[endpointNameKey(url)] = name;
            }
        });

        if ($('fastgptEnabled').checked && endpoints.length === 0) {
            warnings.push('已启用 AI 答疑，但还没有可用接口。');
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

    function validateForSave() {
        const errors = [];
        const token = trimValue('token');
        const guildId = trimValue('guildId');

        if (!token) {
            errors.push('Discord Bot Token 为空，部署前必须填写。');
        }

        if (!guildId) {
            errors.push('Guild / 服务器 ID 为空，部署前必须填写。');
        } else if (!discordIdPattern.test(guildId)) {
            errors.push('Guild / 服务器 ID 不像标准 Discord ID，请确认是否复制正确。');
        }

        if ($('fastgptEnabled').checked) {
            const rows = getEndpointRows();
            let validCount = 0;
            rows.forEach((row, index) => {
                const provider = row.querySelector('.endpoint-provider').value.trim() || 'fastgpt';
                const rawUrl = row.querySelector('.endpoint-url').value.trim();
                const key = row.querySelector('.endpoint-key').value.trim();
                const model = row.querySelector('.endpoint-model').value.trim();
                if (!rawUrl && !key && !model) return;

                if (!rawUrl) errors.push(`AI 接口 #${index + 1} 缺少 URL。`);
                if (!key) errors.push(`AI 接口 #${index + 1} 缺少 SK/API Key。`);
                if (provider === 'openai-compatible' && !model) {
                    errors.push(`AI 接口 #${index + 1} 为 OpenAI 兼容，必须填写模型名。`);
                }
                if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
                    errors.push(`AI 接口 #${index + 1} URL 必须以 http(s) 开头。`);
                }
                if (rawUrl) {
                    try {
                        new URL(rawUrl);
                    } catch (_error) {
                        errors.push(`AI 接口 #${index + 1} URL 格式不正确。`);
                    }
                }
                if (rawUrl && key && (provider !== 'openai-compatible' || model)) {
                    validCount += 1;
                }
            });
            if (validCount === 0) {
                errors.push('已启用 AI 答疑，但还没有有效接口。请至少填写一个接口的 URL、SK/API Key 和模型名。');
            }
        }

        if ($('courtEnabled').checked) {
            const courtFields = [
                ['courtChannelId', '法院频道 ID'],
                ['motionChannelId', '提案频道 ID'],
                ['debateChannelId', '辩论频道 ID'],
                ['debateTagId', '辩论 Tag ID'],
                ['motionTagId', '提案 Tag ID'],
            ];
            courtFields.forEach(([id, label]) => {
                const value = trimValue(id);
                if (!value) {
                    errors.push(`已启用社区治理，${label} 不能为空。`);
                } else if (!discordIdPattern.test(value)) {
                    errors.push(`${label}「${value}」不像标准 Discord ID。`);
                }
            });
            const appealHours = Number(trimValue('appealDurationHours'));
            const summitHours = Number(trimValue('summitDurationHours'));
            const voteHours = Number(trimValue('voteDurationHours'));
            const requiredSupports = Number(trimValue('requiredSupports'));
            if (!Number.isFinite(appealHours) || appealHours <= 0) {
                errors.push('上诉有效期必须大于 0 小时。');
            }
            if (!Number.isFinite(summitHours) || summitHours <= 0) {
                errors.push('提案征集期必须大于 0 小时。');
            }
            if (!Number.isFinite(voteHours) || voteHours <= 0) {
                errors.push('投票持续时间必须大于 0 小时。');
            }
            if (!Number.isFinite(requiredSupports) || requiredSupports < 1) {
                errors.push('进入辩论所需支持数必须至少为 1。');
            }
        }

        if ($('monitorEnabled').checked) {
            const monitorFields = [
                ['roleMonitorCategoryId', '角色监控分类 ID'],
                ['monitoredRoleId', '被监控角色 ID'],
            ];
            monitorFields.forEach(([id, label]) => {
                const value = trimValue(id);
                if (!value) {
                    errors.push(`已启用运行监控，${label} 不能为空。`);
                } else if (!discordIdPattern.test(value)) {
                    errors.push(`${label}「${value}」不像标准 Discord ID。`);
                }
            });
        }

        return errors;
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

        if ($('courtEnabled').checked) {
            const courtFields = [
                ['courtChannelId', '法院频道 ID'],
                ['motionChannelId', '提案频道 ID'],
                ['debateChannelId', '辩论频道 ID'],
                ['debateTagId', '辩论 Tag ID'],
                ['motionTagId', '提案 Tag ID'],
            ];
            courtFields.forEach(([id, label]) => {
                const value = trimValue(id);
                if (!value) warnings.push(`已启用社区治理，${label} 为空，法院系统可能无法正常工作。`);
            });
            const appealHours = Number(trimValue('appealDurationHours'));
            const summitHours = Number(trimValue('summitDurationHours'));
            const voteHours = Number(trimValue('voteDurationHours'));
            const requiredSupports = Number(trimValue('requiredSupports'));
            if (!Number.isFinite(appealHours) || appealHours <= 0) warnings.push('上诉有效期应大于 0 小时。');
            if (!Number.isFinite(summitHours) || summitHours <= 0) warnings.push('提案征集期应大于 0 小时。');
            if (!Number.isFinite(voteHours) || voteHours <= 0) warnings.push('投票持续时间应大于 0 小时。');
            if (!Number.isFinite(requiredSupports) || requiredSupports < 1) warnings.push('进入辩论所需支持数应至少为 1。');
        }

        if ($('monitorEnabled').checked) {
            const monitorFields = [
                ['roleMonitorCategoryId', '角色监控分类 ID'],
                ['monitoredRoleId', '被监控角色 ID'],
            ];
            monitorFields.forEach(([id, label]) => {
                const value = trimValue(id);
                if (!value) warnings.push(`已启用运行监控，${label} 为空，监控可能无法正常工作。`);
            });
        }

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
                appealDuration: durationMsFromHours('appealDurationHours', 72),
                summitDuration: durationMsFromHours('summitDurationHours', 168),
                requiredSupports: numberValue('requiredSupports', 20),
                debateTagId: nullableValue('debateTagId'),
                motionTagId: nullableValue('motionTagId'),
                voteDuration: durationMsFromHours('voteDurationHours', 24),
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

    function renderWarnings(warnings, title = '需要确认：') {
        const box = $('warnings');

        if (!warnings.length) {
            box.hidden = true;
            box.innerHTML = '';
            $('statusPill').textContent = '配置可用';
            $('statusPill').classList.add('ok');
            return;
        }

        box.hidden = false;
        box.innerHTML = `<strong>${escapeHtml(title)}</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`;
        $('statusPill').textContent = `${warnings.length} 个提醒`;
        $('statusPill').classList.remove('ok');
    }

    function renderSummary(config) {
        const box = $('configSummary');
        if (!box) {
            return;
        }

        const guildId = Object.keys(config.guilds || {})[0] || '';
        const guildConfig = config.guilds?.[guildId] || {};
        const aiConfig = guildConfig.fastgpt || {};
        const endpoints = Array.isArray(aiConfig.endpoints) ? aiConfig.endpoints : [];
        const endpointNames = aiConfig.endpointNames || {};
        const openaiCount = endpoints.filter((endpoint) => endpoint.provider === 'openai-compatible' || endpoint.model).length;
        const courtSystem = guildConfig.courtSystem || {};
        const monitor = guildConfig.monitor || {};

        const items = [
            {
                title: 'AI 答疑',
                value: aiConfig.enabled ? `启用，${endpoints.length} 个接口` : '关闭',
                detail: (() => {
                    if (!aiConfig.enabled) return '可添加 FastGPT 或 OpenAI 兼容接口';
                    if (endpoints.length === 0) return '已启用但无有效接口，请检查配置';
                    const names = endpoints.map((endpoint, index) => {
                        const displayName = endpointNames[endpointNameKey(endpoint.url || '')] || endpointNames[endpoint.url];
                        return displayName || `${endpoint.provider || '接口'} ${index + 1}`;
                    });
                    return names.join('、') + (openaiCount ? `（${openaiCount} 个 OpenAI 兼容）` : '');
                })(),
            },
            {
                title: '投票系统',
                value: courtSystem.enabled ? `启用，投票 ${hoursFromMs(courtSystem.voteDuration, 24)} 小时` : '关闭',
                detail: courtSystem.enabled ? `需要 ${courtSystem.requiredSupports || 20} 个支持进入辩论` : '法院/议案/辩论流程未启用',
            },
            {
                title: '运行监控',
                value: monitor.enabled ? '启用' : '关闭',
                detail: monitor.enabled
                    ? `监控角色：${monitor.roleDisplayName || '角色'}${monitor.monitorChannelId ? `，频道 ${monitor.monitorChannelId}` : '，频道待配置'}`
                    : '可展示 Bot 在线状态和角色人数',
            },
        ];

        box.innerHTML = items
            .map(
                (item) => `
                    <div class="summary-item">
                        <span>${escapeHtml(item.title)}</span>
                        <strong>${escapeHtml(item.value)}</strong>
                        <small>${escapeHtml(item.detail)}</small>
                    </div>
                `,
            )
            .join('');
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
        renderSummary(config);
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

    function showLogin(message = '') {
        $('loginView').hidden = false;
        $('consoleView').hidden = true;
        $('loginStatus').textContent = message;
        $('loginStatus').classList.toggle('error', Boolean(message));
        if (statusTimer) {
            window.clearInterval(statusTimer);
            statusTimer = null;
        }
        window.setTimeout(() => $('loginPassword')?.focus(), 0);
    }

    function showConsole() {
        $('loginView').hidden = true;
        $('consoleView').hidden = false;
        $('loginStatus').textContent = '';
    }

    async function apiRequest(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            credentials: 'same-origin',
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
            if (response.status === 401 && isOnlineMode) {
                showLogin('登录已过期，请重新输入密码。');
            }
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
                <div><dt>更新时间</dt><dd>${escapeHtml(status.config?.updatedAt || '-')}</dd></div>
                <div><dt>Web 端口</dt><dd>${escapeHtml(String(status.web?.port || '-'))}</dd></div>
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

    async function checkSession() {
        try {
            const payload = await apiRequest('/api/session');
            if (!payload.authConfigured) {
                showLogin('JSBOT_WEB_PASSWORD 尚未设置，请先在 Zeabur 环境变量中配置。');
                return false;
            }
            if (!payload.authenticated) {
                showLogin();
                return false;
            }
            showConsole();
            return true;
        } catch (error) {
            showLogin(`检查登录状态失败：${error.message}`);
            return false;
        }
    }

    async function login(password) {
        const button = $('loginButton');
        button.disabled = true;
        $('loginStatus').textContent = '正在验证密码...';
        $('loginStatus').classList.remove('error');

        try {
            await apiRequest('/api/login', {
                method: 'POST',
                body: JSON.stringify({ password }),
            });
            $('loginPassword').value = '';
            showConsole();
            await startOnlineConsole();
        } catch (error) {
            $('loginStatus').textContent = `登录失败：${error.message}`;
            $('loginStatus').classList.add('error');
            $('loginPassword').focus();
        } finally {
            button.disabled = false;
        }
    }

    async function logout() {
        try {
            await apiRequest('/api/logout', { method: 'POST' });
        } catch (_error) {
            // 即使服务端会话已过期，也直接回到登录页。
        }
        showLogin();
    }

    async function startOnlineConsole() {
        $('onlineActions').hidden = false;
        await refreshServerStatus();
        await loadServerConfig();
        if (!statusTimer) {
            statusTimer = window.setInterval(refreshServerStatus, 10000);
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
            const errors = validateForSave();
            if (errors.length) {
                renderWarnings(errors, '以下问题阻止保存：');
                showServerStatus('请修正以下错误后再保存：' + errors[0], true);
                return;
            }

            showServerStatus('正在保存配置并重启 Bot...');
            const { config } = buildConfig();
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
        $('appealDurationHours').value = '72';
        $('summitDurationHours').value = '168';
        $('requiredSupports').value = '20';
        $('voteDurationHours').value = '24';
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
                    provider: endpoint.provider || endpoint.type || (endpoint.model ? 'openai-compatible' : 'fastgpt'),
                    model: endpoint.model || '',
                    contentFormat: endpoint.contentFormat || 'auto',
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
        $('appealDurationHours').value = hoursFromMs(courtSystem.appealDuration, 72);
        $('summitDurationHours').value = hoursFromMs(courtSystem.summitDuration, 168);
        $('requiredSupports').value = courtSystem.requiredSupports ?? 20;
        setNullable('debateTagId', courtSystem.debateTagId);
        setNullable('motionTagId', courtSystem.motionTagId);
        $('voteDurationHours').value = hoursFromMs(courtSystem.voteDuration, 24);

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
        $('loginForm').addEventListener('submit', (event) => {
            event.preventDefault();
            const password = $('loginPassword').value;
            if (!password) {
                $('loginStatus').textContent = '请输入密码。';
                $('loginStatus').classList.add('error');
                $('loginPassword').focus();
                return;
            }
            login(password);
        });

        $('logoutButton').addEventListener('click', logout);

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

        document.querySelectorAll('[data-add-endpoint]').forEach((button) => {
            button.addEventListener('click', () => {
                $('fastgptEndpoints').appendChild(makeEndpointRow(endpointPreset(button.dataset.addEndpoint)));
                renderOutput();
            });
        });

        $('fastgptEndpoints').addEventListener('change', (event) => {
            const provider = event.target.closest('.endpoint-provider');
            if (provider) {
                const row = provider.closest('.endpoint-row');
                row.querySelector('.endpoint-content-format').value = recommendedContentFormat(provider.value);
                applyEndpointProviderHints(row);
            }
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
            $('logoutButton').hidden = false;
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
        $('modeDescription').textContent = '打开页面先输入 JSBOT_WEB_PASSWORD，登录后可保存配置到服务器并自动启动/重启 Bot。';
    }

    async function bootstrap() {
        ensureEndpointRow();
        setupMode();
        wireEvents();
        renderOutput();

        if (!isOnlineMode) {
            showConsole();
            return;
        }

        const authenticated = await checkSession();
        if (authenticated) {
            await startOnlineConsole();
        }
    }

    window.JSBotConfigWizard = {
        buildConfig,
        renderOutput,
        utf8ToBase64,
        base64ToUtf8,
        applyConfig,
        validateForSave,
    };

    bootstrap();
})();
