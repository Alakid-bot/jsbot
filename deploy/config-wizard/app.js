(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const discordIdPattern = /^\d{17,20}$/;
    const isOnlineMode = ['http:', 'https:'].includes(window.location.protocol);
    let statusTimer = null;
    let availableCommands = [];
    let unknownCommands = [];

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
        'selfServiceRolesEnabled',
        'activeRolesEnabled',
        'activeRolesPanelTitle',
        'activeRolesPanelDescription',
        'activeRolesMutuallyExclusive',
        'activeRolesTrackBots',
        'messageStatsEnabled',
        'messageStatsQueryAllowUserIds',
        'messageStatsAllowSelfQuery',
        'messageStatsTrackBots',
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

    function normalizeEndpointUrlForRequest(row) {
        const provider = row.querySelector('.endpoint-provider').value.trim() || 'fastgpt';
        const rawUrl = row.querySelector('.endpoint-url').value.trim();
        return provider === 'openai-compatible' ? normalizeOpenAICompatibleUrl(rawUrl) : rawUrl;
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

    function makeGroupRow(group = {}) {
        const row = document.createElement('div');
        row.className = 'group-row';
        row.innerHTML = `
            <label class="field">
                <span>分组 ID <em>必填</em></span>
                <input class="group-id" type="text" placeholder="例如 creator" />
            </label>
            <label class="field">
                <span>标签 <em>必填</em></span>
                <input class="group-label" type="text" placeholder="展示给用户的名称" />
            </label>
            <label class="field">
                <span>描述</span>
                <input class="group-description" type="text" placeholder="可选说明" />
            </label>
            <label class="field">
                <span>Emoji</span>
                <input class="group-emoji" type="text" placeholder="例如 🎨" />
            </label>
            <label class="field">
                <span>身份组 ID <em>必填</em></span>
                <input class="group-roleId" type="text" inputmode="numeric" placeholder="123456789012345678" />
            </label>
            <label class="field">
                <span>模式</span>
                <select class="group-mode">
                    <option value="toggle">toggle（领取/取消）</option>
                    <option value="grant">grant（只领取）</option>
                    <option value="remove">remove（只移除）</option>
                </select>
            </label>
            <button class="danger remove-group" type="button">删除</button>
        `;
        row.querySelector('.group-id').value = group.id || '';
        row.querySelector('.group-label').value = group.label || '';
        row.querySelector('.group-description').value = group.description || '';
        row.querySelector('.group-emoji').value = group.emoji || '';
        row.querySelector('.group-roleId').value = group.roleId || '';
        row.querySelector('.group-mode').value = group.mode || 'toggle';
        return row;
    }

    function ensureGroupRow() {
        const container = $('selfServiceRolesGroups');
        if (!container.children.length) {
            container.appendChild(makeGroupRow());
        }
    }

    function getGroupRows() {
        return Array.from(document.querySelectorAll('#selfServiceRolesGroups .group-row'));
    }

    function collectSelfServiceRoles(warnings) {
        const enabled = $('selfServiceRolesEnabled').checked;
        const groups = [];
        const rows = getGroupRows();

        rows.forEach((row, index) => {
            const id = row.querySelector('.group-id').value.trim();
            const label = row.querySelector('.group-label').value.trim();
            const description = row.querySelector('.group-description').value.trim();
            const emoji = row.querySelector('.group-emoji').value.trim();
            const roleId = row.querySelector('.group-roleId').value.trim();
            const mode = row.querySelector('.group-mode').value || 'toggle';

            if (!id && !label && !roleId && !description && !emoji) {
                return;
            }

            if (!id || !label || !roleId) {
                warnings.push(`自助身份组 #${index + 1} 缺少 ID、标签或身份组 ID，已跳过。`);
                return;
            }

            if (!discordIdPattern.test(roleId)) {
                warnings.push(`自助身份组 #${index + 1} 的身份组 ID「${roleId}」不像标准 Discord ID。`);
            }

            groups.push({ id, label, description, emoji, roleId, mode });
        });

        if (enabled && groups.length === 0) {
            warnings.push('已启用自助身份组，但还没有有效分组。');
        }

        return { enabled, groups };
    }

    function collectActiveRoles(warnings) {
        const enabled = $('activeRolesEnabled').checked;
        const panelTitle = trimValue('activeRolesPanelTitle') || '活跃身份组';
        const panelDescription = trimValue('activeRolesPanelDescription') || '根据最近 7 天消息数自动领取';
        const mutuallyExclusive = $('activeRolesMutuallyExclusive').checked;
        const trackBots = $('activeRolesTrackBots').checked;

        const tierIds = ['huangtao', 'baitao', 'shuimitao', 'pantao'];
        const tierLabels = { huangtao: '黄桃', baitao: '白桃', shuimitao: '水蜜桃', pantao: '蟠桃' };
        const tiers = [];
        const thresholds = [];

        tierIds.forEach((tierId) => {
            const row = document.querySelector(`.group-row[data-tier-id="${tierId}"]`);
            if (!row) return;
            const roleId = row.querySelector('.tier-roleId').value.trim();
            const minMessages = Number(row.querySelector('.tier-minMessages').value.trim());
            const emoji = row.querySelector('.tier-emoji').value.trim();
            const description = row.querySelector('.tier-description').value.trim();

            if (enabled) {
                if (!roleId) {
                    warnings.push(`活跃身份组「${tierLabels[tierId]}」缺少角色 ID。`);
                } else if (!discordIdPattern.test(roleId)) {
                    warnings.push(`活跃身份组「${tierLabels[tierId]}」的角色 ID「${roleId}」不像标准 Discord ID。`);
                }
                if (!Number.isFinite(minMessages) || minMessages < 0) {
                    warnings.push(`活跃身份组「${tierLabels[tierId]}」的最低消息数应为非负数。`);
                }
            }

            tiers.push({
                id: tierId,
                label: tierLabels[tierId],
                roleId: roleId || null,
                minMessages: Number.isFinite(minMessages) ? minMessages : 0,
                emoji: emoji || undefined,
                description: description || undefined,
            });

            if (Number.isFinite(minMessages)) {
                thresholds.push({ tierId, label: tierLabels[tierId], minMessages });
            }
        });

        const sorted = thresholds.slice().sort((a, b) => a.minMessages - b.minMessages);
        for (let i = 0; i < sorted.length - 1; i += 1) {
            if (sorted[i].minMessages === sorted[i + 1].minMessages) {
                warnings.push(`活跃身份组「${sorted[i].label}」与「${sorted[i + 1].label}」的最低消息数重复（${sorted[i].minMessages}）。`);
            }
        }

        const tierOrder = ['huangtao', 'baitao', 'shuimitao', 'pantao'];
        const orderedThresholds = tierOrder
            .map((id) => tiers.find((t) => t.id === id))
            .filter((t) => t && Number.isFinite(t.minMessages))
            .map((t) => t.minMessages);
        for (let i = 0; i < orderedThresholds.length - 1; i += 1) {
            if (orderedThresholds[i] > orderedThresholds[i + 1]) {
                warnings.push(`活跃身份组阈值未按等级递增：${tierLabels[tierOrder[i]]}(${orderedThresholds[i]}) > ${tierLabels[tierOrder[i + 1]]}(${orderedThresholds[i + 1]})。建议从低到高设置。`);
            }
        }

        return { enabled, panelTitle, panelDescription, mutuallyExclusive, trackBots, tiers };
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
            <label class="field endpoint-model-field" hidden>
                <span>模型选择</span>
                <select class="endpoint-model-select">
                    <option value="">-- 选择模型 --</option>
                </select>
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
            <div class="endpoint-actions-row">
                <button class="secondary small fetch-models" type="button">获取模型</button>
                <button class="secondary small test-connection" type="button">测试连接</button>
                <span class="endpoint-status" hidden></span>
            </div>
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

        const modelSelect = row.querySelector('.endpoint-model-select');
        modelSelect.addEventListener('change', () => {
            if (modelSelect.value) {
                row.querySelector('.endpoint-model').value = modelSelect.value;
                renderOutput();
            }
        });

        const fetchBtn = row.querySelector('.fetch-models');
        fetchBtn.addEventListener('click', () => handleFetchModels(row));

        const testBtn = row.querySelector('.test-connection');
        testBtn.addEventListener('click', () => handleTestConnection(row));

        return row;
    }

    async function handleFetchModels(row) {
        const url = normalizeEndpointUrlForRequest(row);
        const key = row.querySelector('.endpoint-key').value.trim();
        const provider = row.querySelector('.endpoint-provider').value;
        const modelField = row.querySelector('.endpoint-model-field');
        const modelSelect = row.querySelector('.endpoint-model-select');
        const fetchBtn = row.querySelector('.fetch-models');

        if (!url || !key) {
            setEndpointStatus(row, '请先填写接口地址和 API Key', 'error');
            return;
        }

        setEndpointStatus(row, '正在获取模型列表...', 'pending');
        fetchBtn.disabled = true;
        modelField.hidden = true;
        modelSelect.innerHTML = '<option value="">-- 选择模型 --</option>';

        try {
            const payload = await apiRequest('/api/ai/models', {
                method: 'POST',
                body: JSON.stringify({ url, key, provider }),
            });

            if (payload.unsupported) {
                setEndpointStatus(row, payload.message || '该服务商不支持自动获取模型', 'warning');
                return;
            }

            const models = Array.isArray(payload.models) ? payload.models : [];
            if (models.length === 0) {
                setEndpointStatus(row, '未获取到模型列表', 'warning');
                return;
            }

            models.forEach((m) => {
                const option = document.createElement('option');
                option.value = m;
                option.textContent = m;
                modelSelect.appendChild(option);
            });
            modelField.hidden = false;
            setEndpointStatus(row, `获取到 ${models.length} 个模型`, 'ok');
        } catch (error) {
            setEndpointStatus(row, error.message || '获取模型失败', 'error');
        } finally {
            fetchBtn.disabled = false;
        }
    }

    async function handleTestConnection(row) {
        const url = normalizeEndpointUrlForRequest(row);
        const key = row.querySelector('.endpoint-key').value.trim();
        const provider = row.querySelector('.endpoint-provider').value;
        const model = row.querySelector('.endpoint-model').value.trim();
        const testBtn = row.querySelector('.test-connection');

        if (!url || !key) {
            setEndpointStatus(row, '请先填写接口地址和 API Key', 'error');
            return;
        }

        if (provider === 'openai-compatible' && !model) {
            setEndpointStatus(row, 'OpenAI 兼容接口需要填写模型名', 'error');
            return;
        }

        setEndpointStatus(row, '正在测试连接...', 'pending');
        testBtn.disabled = true;

        try {
            await apiRequest('/api/ai/test', {
                method: 'POST',
                body: JSON.stringify({ url, key, provider, model }),
            });
            setEndpointStatus(row, '连接成功', 'ok');
        } catch (error) {
            setEndpointStatus(row, error.message || '连接测试失败', 'error');
        } finally {
            testBtn.disabled = false;
        }
    }

    function setEndpointStatus(row, message, type) {
        const statusEl = row.querySelector('.endpoint-status');
        statusEl.hidden = false;
        statusEl.textContent = message;
        statusEl.className = 'endpoint-status';
        if (type) {
            statusEl.classList.add(type);
        }
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

        if ($('selfServiceRolesEnabled').checked) {
            const rows = getGroupRows();
            let validCount = 0;
            rows.forEach((row, index) => {
                const id = row.querySelector('.group-id').value.trim();
                const label = row.querySelector('.group-label').value.trim();
                const roleId = row.querySelector('.group-roleId').value.trim();
                if (!id && !label && !roleId) return;

                if (!id) errors.push(`自助身份组 #${index + 1} 缺少分组 ID。`);
                if (!label) errors.push(`自助身份组 #${index + 1} 缺少标签。`);
                if (!roleId) errors.push(`自助身份组 #${index + 1} 缺少身份组 ID。`);
                if (roleId && !discordIdPattern.test(roleId)) {
                    errors.push(`自助身份组 #${index + 1} 身份组 ID 不像标准 Discord ID。`);
                }
                if (id && label && roleId) {
                    validCount += 1;
                }
            });
            if (validCount === 0) {
                errors.push('已启用自助身份组，但还没有有效分组。请至少填写一个分组的 ID、标签和身份组 ID。');
            }
        }

        if ($('messageStatsEnabled').checked) {
            const queryAllowUserIds = parseList($('messageStatsQueryAllowUserIds').value);
            queryAllowUserIds.forEach((value) => {
                if (!discordIdPattern.test(value)) {
                    errors.push(`消息统计查询白名单用户 ID「${value}」不像标准 Discord ID。`);
                }
            });
        }

        if ($('activeRolesEnabled').checked) {
            const tierIds = ['huangtao', 'baitao', 'shuimitao', 'pantao'];
            const tierLabels = { huangtao: '黄桃', baitao: '白桃', shuimitao: '水蜜桃', pantao: '蟠桃' };
            let validCount = 0;
            tierIds.forEach((tierId) => {
                const row = document.querySelector(`.group-row[data-tier-id="${tierId}"]`);
                if (!row) return;
                const roleId = row.querySelector('.tier-roleId').value.trim();
                const minMessages = Number(row.querySelector('.tier-minMessages').value.trim());
                if (!roleId) {
                    errors.push(`已启用活跃身份组，「${tierLabels[tierId]}」缺少角色 ID。`);
                } else if (!discordIdPattern.test(roleId)) {
                    errors.push(`活跃身份组「${tierLabels[tierId]}」的角色 ID「${roleId}」不像标准 Discord ID。`);
                }
                if (!Number.isFinite(minMessages) || minMessages < 0) {
                    errors.push(`活跃身份组「${tierLabels[tierId]}」的最低消息数必须为非负数。`);
                }
                if (roleId && Number.isFinite(minMessages) && minMessages >= 0) {
                    validCount += 1;
                }
            });
            if (validCount === 0) {
                errors.push('已启用活跃身份组，但四个等级均无效。请至少填写一个等级的角色 ID 和最低消息数。');
            }
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

        const selfServiceRoles = collectSelfServiceRoles(warnings);
        const messageStats = collectMessageStats(warnings);
        const activeRoles = collectActiveRoles(warnings);
        const enabledCommands = collectEnabledCommands();

        if (unknownCommands.length > 0) {
            warnings.push(`以下指令不在服务器可用列表中：${unknownCommands.join('、')}。`);
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
            selfServiceRoles,
            messageStats,
            activeRoles,
            autoDeleteChannels,
        };

        if (enabledCommands) {
            serverConfig.enabledCommands = enabledCommands;
        }

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
        const selfServiceRoles = guildConfig.selfServiceRoles || {};
        const messageStats = guildConfig.messageStats || {};

        const enabledCommands = guildConfig.enabledCommands || [];
        const commandCount = enabledCommands.length;
        const totalCommands = availableCommands.length;

        const items = [
            {
                title: 'App 指令',
                value: commandCount > 0 ? `${commandCount} 个已启用` : '未配置',
                detail: totalCommands > 0
                    ? `共 ${totalCommands} 个可用指令${unknownCommands.length > 0 ? `，${unknownCommands.length} 个未知指令` : ''}`
                    : '手动配置模式或离线模式',
            },
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
                title: '自助身份组',
                value: selfServiceRoles.enabled ? `启用，${(selfServiceRoles.groups || []).length} 个分组` : '关闭',
                detail: selfServiceRoles.enabled
                    ? `模式: ${(selfServiceRoles.groups || []).map((g) => g.label || g.id).join('、')}`
                    : '用户可自行申请/切换身份组',
            },
            {
                title: '消息统计',
                value: messageStats.enabled ? '启用' : '关闭',
                detail: messageStats.enabled
                    ? `白名单 ${(messageStats.queryAllowUserIds || []).length} 人，${messageStats.allowSelfQuery ? '允许自助查询' : '不允许自助查询'}`
                    : '用户可私密查自己，白名单可查任意用户',
            },
            {
                title: '活跃身份组',
                value: (guildConfig.activeRoles?.enabled) ? '启用' : '关闭',
                detail: (() => {
                    const ar = guildConfig.activeRoles || {};
                    if (!ar.enabled) return '按最近 7 天消息数自动发放身份组';
                    const tiers = (ar.tiers || []).filter((t) => t.roleId);
                    const tierLabels = { huangtao: '黄桃', baitao: '白桃', shuimitao: '水蜜桃', pantao: '蟠桃' };
                    const tierText = tiers.map((t) => `${tierLabels[t.id]}(${t.minMessages})`).join('、');
                    return `${tierText || '未配置等级'} · ${ar.mutuallyExclusive !== false ? '互斥' : '可共存'}`;
                })(),
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
                <div><dt>配置存储</dt><dd>${escapeHtml(status.config?.source || '-')}</dd></div>
                <div><dt>运行副本</dt><dd>${escapeHtml(status.config?.path || '-')}</dd></div>
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

    function renderCommandSelector() {
        const list = $('commandCheckList');
        const dropdown = $('commandDropdown');
        const manualField = $('manualCommandsField');
        const status = $('commandLoadStatus');

        if (availableCommands.length === 0) {
            dropdown.hidden = true;
            manualField.hidden = false;
            if (!isOnlineMode) {
                status.textContent = '离线模式：请手动填写指令名称';
                status.className = 'command-status';
            }
            return;
        }

        dropdown.hidden = false;
        manualField.hidden = true;
        status.textContent = `已加载 ${availableCommands.length} 个指令`;
        status.className = 'command-status ok';

        list.innerHTML = availableCommands.map((cmd) => {
            const name = typeof cmd === 'string' ? cmd : cmd.name;
            const description = typeof cmd === 'string' ? '' : (cmd.description || '');
            return `
                <label class="command-check-item" title="${escapeHtml(description)}">
                    <input type="checkbox" data-command-name="${escapeHtml(name)}" checked />
                    <span>${escapeHtml(name)}${description ? `<small>${escapeHtml(description)}</small>` : ''}</span>
                </label>
            `;
        }).join('');
    }

    async function fetchAvailableCommands() {
        const status = $('commandLoadStatus');
        try {
            const payload = await apiRequest('/api/commands');
            if (Array.isArray(payload.commands)) {
                availableCommands = payload.commands;
                renderCommandSelector();
            } else {
                throw new Error('返回格式不正确');
            }
        } catch (error) {
            availableCommands = [];
            renderCommandSelector();
            status.textContent = `无法加载指令列表：${error.message}`;
            status.className = 'command-status error';
        }
    }

    function collectEnabledCommands() {
        const list = $('commandCheckList');
        const checkboxes = list.querySelectorAll('input[type="checkbox"]');
        const manualCommands = parseList($('enabledCommandsManual').value);

        if (checkboxes.length > 0) {
            const enabled = Array.from(checkboxes)
                .filter((cb) => cb.checked)
                .map((cb) => cb.dataset.commandName);
            return Array.from(new Set(enabled.concat(manualCommands)));
        }

        return manualCommands.length > 0 ? manualCommands : null;
    }

    async function startOnlineConsole() {
        $('onlineActions').hidden = false;
        await refreshServerStatus();
        await fetchAvailableCommands();
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

    async function validateConfigOnline() {
        try {
            showServerStatus('正在验证配置...');
            const { config } = buildConfig();
            const payload = await apiRequest('/api/config/validate', {
                method: 'POST',
                body: JSON.stringify({ config }),
            });
            renderValidationResult(payload);
            const allOk = payload.checks?.every((c) => c.ok);
            showServerStatus(allOk ? '配置验证通过' : '配置验证发现问题', !allOk);
        } catch (error) {
            renderValidationResult({ checks: [{ name: '配置验证请求', ok: false, error: error.message }] });
            showServerStatus(`验证失败：${error.message}`, true);
        }
    }

    async function syncDiscordCommands() {
        const button = $('syncDiscordCommands');
        try {
            const errors = validateForSave();
            if (errors.length) {
                renderWarnings(errors, '以下问题阻止同步：');
                showServerStatus('请修正以下错误后再同步：' + errors[0], true);
                return;
            }

            button.disabled = true;
            showServerStatus('正在同步 Discord 指令...');

            const { config } = buildConfig();
            const guildId = Object.keys(config.guilds || {})[0] || '';
            if (!guildId || guildId === 'YOUR_GUILD_ID') {
                showServerStatus('服务器 ID 未填写，无法同步指令。', true);
                return;
            }

            const payload = await apiRequest('/api/commands/sync', {
                method: 'POST',
                body: JSON.stringify({ config, guildId }),
            });

            if (payload && payload.ok === false) {
                throw new Error(payload.status || '同步返回失败状态');
            }

            if (payload.commandsDeployed) {
                $('commandsDeployed').checked = true;
            }

            renderOutput();
            renderRuntimeStatus(payload.status);
            const count = payload.commandCount ?? 0;
            showServerStatus(`Discord 指令同步成功：已部署 ${count} 条指令。`);
        } catch (error) {
            showServerStatus(`同步 Discord 指令失败：${error.message}`, true);
        } finally {
            button.disabled = false;
        }
    }

    function renderValidationResult(payload) {
        const box = $('validationPanel');
        if (!box || !payload) {
            return;
        }
        box.hidden = false;
        const checks = Array.isArray(payload.checks) ? payload.checks : [];
        const items = checks.map((check) => {
            const status = check.ok ? '通过' : '失败';
            const cls = check.ok ? 'ok' : 'error';
            return `<div class="validation-item ${cls}"><strong>${escapeHtml(check.name)}</strong><span>${escapeHtml(status)}</span>${check.error ? `<small>${escapeHtml(check.error)}</small>` : ''}</div>`;
        }).join('');
        const summary = checks.filter((c) => c.ok).length;
        box.innerHTML = `<strong>配置验证结果</strong><div class="validation-summary">${summary} / ${checks.length} 项通过</div><div class="validation-list">${items}</div>`;
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
        $('selfServiceRolesEnabled').checked = false;
        $('selfServiceRolesGroups').innerHTML = '';
        $('messageStatsEnabled').checked = false;
        $('messageStatsQueryAllowUserIds').value = '';
        $('messageStatsAllowSelfQuery').checked = true;
        $('messageStatsTrackBots').checked = false;
        $('activeRolesEnabled').checked = false;
        $('activeRolesPanelTitle').value = '';
        $('activeRolesPanelDescription').value = '';
        $('activeRolesMutuallyExclusive').checked = true;
        $('activeRolesTrackBots').checked = false;
        document.querySelectorAll('.group-row[data-tier-id]').forEach((row) => {
            row.querySelector('.tier-roleId').value = '';
            row.querySelector('.tier-minMessages').value = '';
            row.querySelector('.tier-emoji').value = '';
            row.querySelector('.tier-description').value = '';
        });
        unknownCommands = [];
        $('enabledCommandsManual').value = '';
        renderCommandSelector();
        ensureGroupRow();
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

        const selfServiceRoles = guildConfig.selfServiceRoles || {};
        $('selfServiceRolesEnabled').checked = Boolean(selfServiceRoles.enabled);
        $('selfServiceRolesGroups').innerHTML = '';
        const groups = Array.isArray(selfServiceRoles.groups) ? selfServiceRoles.groups : [];
        groups.forEach((group) => {
            $('selfServiceRolesGroups').appendChild(
                makeGroupRow({
                    id: group.id || '',
                    label: group.label || '',
                    description: group.description || '',
                    emoji: group.emoji || '',
                    roleId: group.roleId || '',
                    mode: group.mode || 'toggle',
                }),
            );
        });
        ensureGroupRow();

        const messageStats = guildConfig.messageStats || {};
        $('messageStatsEnabled').checked = Boolean(messageStats.enabled);
        setTextList('messageStatsQueryAllowUserIds', messageStats.queryAllowUserIds);
        $('messageStatsAllowSelfQuery').checked = messageStats.allowSelfQuery !== false;
        $('messageStatsTrackBots').checked = Boolean(messageStats.trackBots);

        const activeRoles = guildConfig.activeRoles || {};
        $('activeRolesEnabled').checked = Boolean(activeRoles.enabled);
        $('activeRolesPanelTitle').value = activeRoles.panelTitle || '';
        $('activeRolesPanelDescription').value = activeRoles.panelDescription || '';
        $('activeRolesMutuallyExclusive').checked = activeRoles.mutuallyExclusive !== false;
        $('activeRolesTrackBots').checked = Boolean(activeRoles.trackBots);

        const defaultTiers = [
            { id: 'huangtao', roleId: null, minMessages: 10, emoji: '🍑', description: '近 7 天发言达到 10 条' },
            { id: 'baitao', roleId: null, minMessages: 30, emoji: '🍑', description: '近 7 天发言达到 30 条' },
            { id: 'shuimitao', roleId: null, minMessages: 60, emoji: '🍑', description: '近 7 天发言达到 60 条' },
            { id: 'pantao', roleId: null, minMessages: 100, emoji: '🍑', description: '近 7 天发言达到 100 条' },
        ];
        const existingTiers = Array.isArray(activeRoles.tiers) ? activeRoles.tiers : [];
        const tierMap = new Map(existingTiers.map((t) => [t.id, t]));
        const tiers = defaultTiers.map((t) => ({ ...t, ...(tierMap.get(t.id) || {}) }));
        tiers.forEach((tier) => {
            const row = document.querySelector(`.group-row[data-tier-id="${tier.id}"]`);
            if (!row) return;
            row.querySelector('.tier-roleId').value = tier.roleId || '';
            row.querySelector('.tier-minMessages').value = tier.minMessages ?? '';
            row.querySelector('.tier-emoji').value = tier.emoji || '';
            row.querySelector('.tier-description').value = tier.description || '';
        });

        const savedEnabledCommands = guildConfig.enabledCommands;
        if (Array.isArray(savedEnabledCommands)) {
            if (availableCommands.length > 0) {
                const availableSet = new Set(availableCommands.map((cmd) => (typeof cmd === 'string' ? cmd : cmd.name)));
                const checkboxes = $('commandCheckList').querySelectorAll('input[type="checkbox"]');
                const enabledSet = new Set(savedEnabledCommands);
                unknownCommands = savedEnabledCommands.filter((name) => !availableSet.has(name));
                checkboxes.forEach((cb) => {
                    cb.checked = enabledSet.has(cb.dataset.commandName);
                });
                if (unknownCommands.length > 0) {
                    $('commandLoadStatus').textContent = `注意：${unknownCommands.length} 个指令在服务器上不存在`;
                    $('commandLoadStatus').className = 'command-status warning';
                    $('manualCommandsField').hidden = false;
                    $('enabledCommandsManual').value = unknownCommands.join('\n');
                }
            } else {
                $('enabledCommandsManual').value = savedEnabledCommands.join('\n');
            }
        } else if (availableCommands.length > 0) {
            const checkboxes = $('commandCheckList').querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach((cb) => {
                cb.checked = true;
            });
        }

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
                const commandCheckbox = event.target.closest('.command-check-item input[type="checkbox"]');
                if (commandCheckbox) {
                    $('commandsDeployed').checked = false;
                }
                renderOutput();
            }
        });

        $('toggleCommandDropdown').addEventListener('click', () => {
            const dropdown = $('commandDropdown');
            dropdown.hidden = !dropdown.hidden;
            $('toggleCommandDropdown').textContent = dropdown.hidden ? '展开指令列表' : '收起指令列表';
        });

        $('selectAllCommands').addEventListener('click', () => {
            $('commandCheckList').querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                cb.checked = true;
            });
            $('commandsDeployed').checked = false;
            renderOutput();
        });

        $('clearAllCommands').addEventListener('click', () => {
            $('commandCheckList').querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                cb.checked = false;
            });
            $('commandsDeployed').checked = false;
            renderOutput();
        });

        $('enabledCommandsManual').addEventListener('input', () => {
            if (availableCommands.length > 0) {
                const availableNames = new Set(availableCommands.map((cmd) => (typeof cmd === 'string' ? cmd : cmd.name)));
                unknownCommands = parseList($('enabledCommandsManual').value).filter((name) => !availableNames.has(name));
            }
            $('commandsDeployed').checked = false;
            renderOutput();
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

        $('addSelfServiceRoleGroup').addEventListener('click', () => {
            $('selfServiceRolesGroups').appendChild(makeGroupRow());
            renderOutput();
        });

        $('selfServiceRolesGroups').addEventListener('click', (event) => {
            const button = event.target.closest('.remove-group');
            if (!button) {
                return;
            }
            button.closest('.group-row').remove();
            ensureGroupRow();
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
            $('validateConfig').addEventListener('click', validateConfigOnline);
            $('syncDiscordCommands').addEventListener('click', syncDiscordCommands);
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
        ensureGroupRow();
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
