import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { REST, Routes } from 'discord.js';
import { QueryTypes } from 'sequelize';
import { existsSync } from 'fs';
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pgManager } from './pg/pgManager.js';
import { getConfigPath } from './utils/configPaths.js';
import { loadCommandFiles } from './utils/helper.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(currentDir, '..');
const staticDir = join(rootDir, 'deploy', 'config-wizard');
const configPath = process.env.JSBOT_CONFIG_PATH
    ? getConfigPath()
    : join(rootDir, 'data', 'config.json');
const port = Number(process.env.PORT || process.env.JSBOT_WEB_PORT || 8080);
const host = process.env.JSBOT_WEB_HOST || '0.0.0.0';
const adminPassword = process.env.JSBOT_WEB_PASSWORD || process.env.PASSWORD || process.env.JSBOT_WEB_TOKEN || '';
const maxBodyBytes = 1024 * 1024;
const sessionCookieName = 'jsbot_web_session';
const sessionTtlMs = 24 * 60 * 60 * 1000;
const botConfigStateKey = 'botConfig';
const configStoreRetryMs = 10 * 1000;

let botProcess = null;
let botStarting = false;
let botStopping = false;
let restartTimer = null;
let lastBotStartAt = null;
let lastBotExit = null;
let configStoreReady = false;
let configStoreError = null;
let lastConfigStoreAttemptAt = 0;
const sessions = new Map();

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function log(message) {
    console.log(`[web-config] ${message}`);
}

function safeEqual(a, b) {
    const left = createHash('sha256').update(a).digest();
    const right = createHash('sha256').update(b).digest();
    return timingSafeEqual(left, right);
}

function verifyPassword(password) {
    return Boolean(adminPassword) && typeof password === 'string' && safeEqual(password, adminPassword);
}

function parseCookies(req) {
    const cookies = new Map();
    const header = req.headers.cookie || '';

    for (const part of header.split(';')) {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }
        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        if (key) {
            cookies.set(key, decodeURIComponent(value));
        }
    }

    return cookies;
}

function isSecureRequest(req) {
    return req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted === true;
}

function sessionCookie(value, req, maxAgeSeconds) {
    const parts = [
        `${sessionCookieName}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${maxAgeSeconds}`,
    ];

    if (isSecureRequest(req)) {
        parts.push('Secure');
    }

    return parts.join('; ');
}

function pruneSessions() {
    const now = Date.now();
    for (const [token, expiresAt] of sessions) {
        if (expiresAt <= now) {
            sessions.delete(token);
        }
    }
}

function createSession(req, res) {
    pruneSessions();
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, Date.now() + sessionTtlMs);
    res.setHeader('set-cookie', sessionCookie(token, req, Math.floor(sessionTtlMs / 1000)));
}

function clearSession(req, res) {
    const token = parseCookies(req).get(sessionCookieName);
    if (token) {
        sessions.delete(token);
    }
    res.setHeader('set-cookie', sessionCookie('', req, 0));
}

function isSessionAuthenticated(req) {
    pruneSessions();
    const token = parseCookies(req).get(sessionCookieName);
    if (!token) {
        return false;
    }

    const expiresAt = sessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
        sessions.delete(token);
        return false;
    }

    return true;
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(`${JSON.stringify(payload)}\n`);
}

function sendText(res, statusCode, text) {
    res.writeHead(statusCode, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(text);
}

function requireSession(req, res) {
    if (!adminPassword) {
        sendText(
            res,
            503,
            'JSBOT_WEB_PASSWORD is not set. In Docker/Zeabur, deploy/zeabur/entrypoint.sh normally generates it automatically. If you start this file directly, set JSBOT_WEB_PASSWORD first.\n',
        );
        return false;
    }

    if (isSessionAuthenticated(req)) {
        return true;
    }

    sendJson(res, 401, { error: 'Authentication required' });
    return false;
}

function requireMutationHeader(req, res) {
    const method = req.method || 'GET';
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return true;
    }

    if (req.headers['x-jsbot-config'] === '1') {
        return true;
    }

    sendJson(res, 403, { error: 'Missing x-jsbot-config header' });
    return false;
}

async function readRequestBody(req) {
    const chunks = [];
    let size = 0;

    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBodyBytes) {
            throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
        }
        chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString('utf8');
}

function validateConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('config 必须是 JSON 对象');
    }

    if (!config.token || typeof config.token !== 'string') {
        throw new Error('必须填写 Discord Bot Token');
    }

    if (!config.guilds || typeof config.guilds !== 'object' || Array.isArray(config.guilds)) {
        throw new Error('必须填写 guilds 服务器配置');
    }

    const guildIds = Object.keys(config.guilds);
    if (guildIds.length === 0) {
        throw new Error('至少需要一个 Discord 服务器 ID');
    }

    for (const guildId of guildIds) {
        if (!/^\d{17,20}$/.test(guildId)) {
            throw new Error(`服务器 ID 不像标准 Discord ID: ${guildId}`);
        }

        const guildConfig = config.guilds[guildId];
        if (!guildConfig || typeof guildConfig !== 'object' || Array.isArray(guildConfig)) {
            throw new Error(`服务器 ${guildId} 的配置必须是对象`);
        }
    }
}

// SSRF guard
function isPrivateIp(hostname) {
    if (/^localhost$/i.test(hostname)) return true;
    if (/^\[?::1\]?$/i.test(hostname)) return true;
    if (/^\[?fc[0-9a-f]{2}:/i.test(hostname) || /^\[?fd[0-9a-f]{2}:/i.test(hostname)) return true;
    if (/^\[?fe80:/i.test(hostname)) return true;
    if (/^127\./.test(hostname)) return true;
    if (/^10\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    if (/^169\.254\./.test(hostname)) return true;
    if (/^22[4-9]\./.test(hostname) || /^2[3-5][0-9]\./.test(hostname)) return true;
    if (/\.(local|internal|intranet|lan|corp|home|private|svc|cluster|service)$/i.test(hostname)) return true;
    return false;
}

function assertSafeUrl(rawUrl, label = 'URL') {
    let url;
    try {
        url = new URL(rawUrl);
    } catch (_error) {
        throw Object.assign(new Error(`${label} 格式不正确`), { statusCode: 400 });
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw Object.assign(new Error(`${label} 仅支持 http/https`), { statusCode: 400 });
    }

    if (isPrivateIp(url.hostname)) {
        throw Object.assign(new Error(`${label} 不能指向内部地址或 localhost`), { statusCode: 400 });
    }

    if (process.env.NODE_ENV === 'production' && url.protocol === 'http:') {
        throw Object.assign(new Error(`${label} 在生产环境必须使用 HTTPS`), { statusCode: 400 });
    }

    return url;
}

function normalizeAiError(error, fallback = '请求失败') {
    const message = error?.message || String(error);
    if (/fetch|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket|timeout/i.test(message)) {
        return '网络连接失败，请检查接口地址和本地网络';
    }
    if (/401|403|Unauthorized|Forbidden|invalid.*api.*key|authentication|auth/i.test(message)) {
        return '认证失败（401/403），请检查 API Key 是否正确';
    }
    if (/404|Not Found/i.test(message)) {
        return '接口地址不存在（404），请检查 URL';
    }
    if (/429|Too Many Requests|rate.*limit/i.test(message)) {
        return '请求过于频繁（429），请稍后再试';
    }
    if (/5\d{2}|Server Error|Internal/i.test(message)) {
        return '服务端错误（5xx），请稍后再试';
    }
    if (/abort|AbortError/i.test(message)) {
        return '请求超时，请检查接口响应速度';
    }
    if (/SSRF|内部地址|localhost|不能指向/i.test(message)) {
        return message;
    }
    return `${fallback}：${message}`;
}

function deriveModelsUrl(baseUrl) {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(trimmed)) {
        return trimmed.replace(/\/chat\/completions$/i, '/models');
    }
    if (/\/v\d+$/i.test(trimmed)) {
        return `${trimmed}/models`;
    }
    return `${trimmed}/models`;
}

function createRequestTimeout(milliseconds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), milliseconds);
    return {
        signal: controller.signal,
        clear: () => clearTimeout(timer),
    };
}

async function fetchAiModels({ url, key, provider }) {
    assertSafeUrl(url, '接口地址');
    const isFastGPT = provider === 'fastgpt';
    if (isFastGPT) {
        const modelsUrl = deriveModelsUrl(url);
        assertSafeUrl(modelsUrl, '模型列表地址');
        try {
            const timeout = createRequestTimeout(10000);
            const res = await fetch(modelsUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${key}` },
                signal: timeout.signal,
            });
            timeout.clear();
            if (res.ok) {
                const data = await res.json();
                const models = Array.isArray(data?.data) ? data.data.map((m) => m.id || m.model || m.name || m).filter(Boolean) : [];
                if (models.length) return { models, source: 'fastgpt/models' };
            }
        } catch (_error) {
            // FastGPT endpoints usually do not expose a models endpoint; manual entry is expected.
        }
        return { models: [], unsupported: true, message: 'FastGPT 不支持自动获取模型，请手动填写或在服务商页面复制模型名' };
    }

    const modelsUrl = deriveModelsUrl(url);
    assertSafeUrl(modelsUrl, '模型列表地址');
    const timeout = createRequestTimeout(15000);
    try {
        const res = await fetch(modelsUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${key}` },
            signal: timeout.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`), { statusCode: res.status });
        }
        const data = await res.json();
        const models = Array.isArray(data?.data) ? data.data.map((m) => m.id || m.model || m.name || m).filter(Boolean) : [];
        return { models };
    } catch (error) {
        throw new Error(normalizeAiError(error, '获取模型列表失败'));
    } finally {
        timeout.clear();
    }
}

async function testAiConnectivity({ url, key, provider, model }) {
    assertSafeUrl(url, '接口地址');
    const isFastGPT = provider === 'fastgpt';
    const body = isFastGPT
        ? JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: false })
        : JSON.stringify({ model: model || 'default', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, temperature: 0, stream: false });

    const timeout = createRequestTimeout(15000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body,
            signal: timeout.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`), { statusCode: res.status });
        }
        const data = await res.json().catch(() => null);
        return { ok: true, responseType: data?.choices ? 'chat-completion' : 'unknown' };
    } catch (error) {
        throw new Error(normalizeAiError(error, '连接测试失败'));
    } finally {
        timeout.clear();
    }
}

async function validateDiscordToken(token) {
    const timeout = createRequestTimeout(10000);
    try {
        const res = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { 'Authorization': `Bot ${token}` },
            signal: timeout.signal,
        });
        if (!res.ok) {
            if (res.status === 401) return { ok: false, error: 'Discord Token 无效（401）' };
            if (res.status === 403) return { ok: false, error: 'Discord Token 权限不足（403）' };
            return { ok: false, error: `Discord API 返回 ${res.status}` };
        }
        const data = await res.json().catch(() => null);
        return { ok: true, username: data?.username || null };
    } catch (error) {
        return { ok: false, error: normalizeAiError(error, '无法连接到 Discord API') };
    } finally {
        timeout.clear();
    }
}

async function fetchDiscordApplicationId(token) {
    const timeout = createRequestTimeout(10000);
    try {
        const res = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
            headers: { 'Authorization': `Bot ${token}` },
            signal: timeout.signal,
        });
        if (!res.ok) {
            if (res.status === 401) {
                throw new Error('Discord Bot Token 无效（401）');
            }
            if (res.status === 403) {
                throw new Error('Discord Bot Token 无权读取应用信息（403）');
            }
            throw new Error(`Discord API 返回 ${res.status}`);
        }
        const data = await res.json();
        const applicationId = data?.id;
        if (!applicationId || !/^\d{17,20}$/.test(applicationId)) {
            throw new Error('无法从 Discord API 获取应用 ID');
        }
        return applicationId;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('读取 Discord 应用信息超时');
        }
        throw error;
    } finally {
        timeout.clear();
    }
}

function resolveSyncGuild(config, requestedGuildId) {
    const guildIds = Object.keys(config.guilds || {});
    const guildId = requestedGuildId || (guildIds.length === 1 ? guildIds[0] : '');

    if (!guildId) {
        throw Object.assign(new Error('缺少要同步的服务器 ID'), { statusCode: 400 });
    }
    if (!/^\d{17,20}$/.test(guildId)) {
        throw Object.assign(new Error(`服务器 ID 不像标准 Discord ID: ${guildId}`), { statusCode: 400 });
    }
    if (!config.guilds?.[guildId]) {
        throw Object.assign(new Error(`配置中不存在服务器 ${guildId}`), { statusCode: 400 });
    }

    return guildId;
}

async function syncDiscordCommands(config, guildId) {
    const commandsPath = join(currentDir, 'commands');
    const commands = await loadCommandFiles(commandsPath);
    const commandData = Array.from(commands.values()).map(command => command.data.toJSON());

    if (commandData.length === 0) {
        throw new Error('没有找到可同步的 Discord 指令');
    }

    const applicationId = await fetchDiscordApplicationId(config.token);
    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        const deployedCommands = await rest.put(
            Routes.applicationGuildCommands(applicationId, guildId),
            { body: commandData },
        );

        return {
            applicationId,
            commandCount: Array.isArray(deployedCommands) ? deployedCommands.length : commandData.length,
            localCommandCount: commandData.length,
        };
    } catch (error) {
        if (error.status === 401 || error.code === 0) {
            throw new Error('Discord Bot Token 无效，无法同步指令');
        }
        if (error.status === 403 || error.code === 50001 || error.code === 50013) {
            throw new Error('Bot 无权访问该服务器或缺少注册指令权限，请确认 OAuth2 邀请包含 applications.commands');
        }
        if (error.status === 404 || error.code === 10004) {
            throw new Error('Discord 找不到该服务器，请确认 Guild ID 正确且 Bot 已加入服务器');
        }
        throw new Error(`Discord 指令同步失败: ${error.message || '未知错误'}`);
    }
}

async function validateDiscordGuildAccess(token, guildId) {
    const timeout = createRequestTimeout(10000);
    try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}`, {
            headers: { 'Authorization': `Bot ${token}` },
            signal: timeout.signal,
        });
        if (!res.ok) {
            if (res.status === 404) return { ok: false, error: '服务器不存在，或 Bot 尚未加入该服务器' };
            if (res.status === 403) return { ok: false, error: 'Bot 没有访问该服务器的权限' };
            return { ok: false, error: `Discord API 返回 ${res.status}` };
        }
        const data = await res.json().catch(() => null);
        return { ok: true, name: data?.name || null };
    } catch (error) {
        return { ok: false, error: normalizeAiError(error, '无法连接到 Discord API') };
    } finally {
        timeout.clear();
    }
}

async function runConfigValidation(config) {
    validateConfig(config);

    const checks = [];
    const token = config.token;

    if (!/^\s*[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\s*$/.test(token)) {
        checks.push({ name: 'Discord Token 格式', ok: false, error: 'Token 格式不像是标准 Discord Bot Token' });
    } else {
        checks.push({ name: 'Discord Token 格式', ok: true });
    }

    const guildIds = Object.keys(config.guilds);
    for (const guildId of guildIds) {
        if (!/^\d{17,20}$/.test(guildId)) {
            checks.push({ name: `服务器 ID ${guildId}`, ok: false, error: '不像标准 Discord ID' });
        } else {
            checks.push({ name: `服务器 ID ${guildId}`, ok: true });
        }
    }

    const discordTokenCheck = await validateDiscordToken(token);
    checks.push({ name: 'Discord Token 有效性', ok: discordTokenCheck.ok, error: discordTokenCheck.error });

    for (const guildId of guildIds) {
        const guildCheck = await validateDiscordGuildAccess(token, guildId);
        checks.push({ name: `Discord 服务器 ${guildId} 访问权限`, ok: guildCheck.ok, error: guildCheck.error });
    }

    for (const guildId of guildIds) {
        const g = config.guilds[guildId];
        if (g.fastgpt?.enabled) {
            const eps = g.fastgpt.endpoints || [];
            if (!eps.length) {
                checks.push({ name: 'AI 答疑接口', ok: false, error: '已启用 AI 答疑，但没有配置接口' });
            } else {
                let valid = 0;
                for (const ep of eps) {
                    if (ep.url && ep.key) {
                        if (ep.provider === 'openai-compatible' && !ep.model) continue;
                        valid += 1;
                    }
                }
                if (valid === 0) {
                    checks.push({ name: 'AI 答疑接口', ok: false, error: '已启用 AI 答疑，但没有有效接口（缺少 URL、Key 或模型名）' });
                } else {
                    checks.push({ name: 'AI 答疑接口', ok: true });
                }
            }
        }
        if (g.courtSystem?.enabled) {
            const missing = [];
            if (!g.courtSystem.courtChannelId) missing.push('法院频道 ID');
            if (!g.courtSystem.motionChannelId) missing.push('提案频道 ID');
            if (!g.courtSystem.debateChannelId) missing.push('辩论频道 ID');
            if (!g.courtSystem.debateTagId) missing.push('辩论 Tag ID');
            if (!g.courtSystem.motionTagId) missing.push('提案 Tag ID');
            if (missing.length) {
                checks.push({ name: '社区治理必填项', ok: false, error: `缺少 ${missing.join('、')}` });
            } else {
                checks.push({ name: '社区治理必填项', ok: true });
            }
        }
        if (g.monitor?.enabled) {
            if (!g.monitor.roleMonitorCategoryId || !g.monitor.monitoredRoleId) {
                checks.push({ name: '运行监控必填项', ok: false, error: '缺少角色监控分类 ID 或被监控角色 ID' });
            } else {
                checks.push({ name: '运行监控必填项', ok: true });
            }
        }
        if (g.selfServiceRoles?.enabled) {
            const groups = g.selfServiceRoles.groups || [];
            if (!groups.length) {
                checks.push({ name: '自助身份组', ok: false, error: '已启用自助身份组，但没有配置分组' });
            } else {
                checks.push({ name: '自助身份组', ok: true });
            }
        }
    }

    return { checks };
}

async function ensureConfigStore() {
    if (configStoreReady) {
        return true;
    }

    const now = Date.now();
    if (configStoreError && now - lastConfigStoreAttemptAt < configStoreRetryMs) {
        return false;
    }

    lastConfigStoreAttemptAt = now;

    try {
        await pgManager.connect();
        const sequelize = pgManager.getSequelize();
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS runtime_state (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at BIGINT NOT NULL
            )
        `);
        configStoreReady = true;
        configStoreError = null;
        return true;
    } catch (error) {
        configStoreReady = false;
        configStoreError = error;
        log(`PostgreSQL config store unavailable: ${error.message}`);
        return false;
    }
}

async function readConfigRow() {
    if (!(await ensureConfigStore())) {
        return null;
    }

    const sequelize = pgManager.getSequelize();
    const rows = await sequelize.query(
        'SELECT value, updated_at FROM runtime_state WHERE key = $1',
        { bind: [botConfigStateKey], type: QueryTypes.SELECT },
    );
    const row = rows[0];
    if (!row) {
        return null;
    }

    return {
        config: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
        updatedAt: Number(row.updated_at) || null,
    };
}

async function writeConfigToStore(config) {
    if (!(await ensureConfigStore())) {
        throw new Error(`PostgreSQL 配置存储不可用: ${configStoreError?.message || 'unknown error'}`);
    }

    const sequelize = pgManager.getSequelize();
    await sequelize.query(
        `INSERT INTO runtime_state (key, value, updated_at)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        { bind: [botConfigStateKey, JSON.stringify(config), Date.now()] },
    );
}

async function materializeConfigFile(config) {
    await mkdir(dirname(configPath), { recursive: true });
    const tempPath = `${configPath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(config, null, 4)}\n`, { mode: 0o600 });
    await rename(tempPath, configPath);
}

async function readConfigFileIfExists() {
    if (!existsSync(configPath)) {
        return null;
    }

    return JSON.parse(await readFile(configPath, 'utf8'));
}

async function migrateConfigFileToStoreIfNeeded() {
    const stored = await readConfigRow();
    if (stored?.config) {
        return stored.config;
    }

    const fileConfig = await readConfigFileIfExists();
    if (!fileConfig) {
        return null;
    }

    validateConfig(fileConfig);
    await writeConfigToStore(fileConfig);
    log(`migrated ${configPath} into PostgreSQL runtime_state.${botConfigStateKey}`);
    return fileConfig;
}

async function readConfigIfExists() {
    const stored = await readConfigRow();
    return stored?.config || null;
}

async function writeConfig(config) {
    validateConfig(config);
    await writeConfigToStore(config);
    await materializeConfigFile(config);
}

async function hasStoredConfig() {
    const stored = await readConfigRow();
    return Boolean(stored?.config);
}

async function prepareConfigForBot() {
    const config = await migrateConfigFileToStoreIfNeeded();
    if (!config) {
        return false;
    }

    await materializeConfigFile(config);
    return true;
}

async function importMaterializedConfigIfChanged() {
    const fileConfig = await readConfigFileIfExists();
    if (!fileConfig) {
        return;
    }

    validateConfig(fileConfig);
    const stored = await readConfigRow();
    if (JSON.stringify(stored?.config || null) === JSON.stringify(fileConfig)) {
        return;
    }

    await writeConfigToStore(fileConfig);
    log(`imported updated ${configPath} into PostgreSQL runtime_state.${botConfigStateKey}`);
}

function clearRestartTimer() {
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
}

async function startBot(reason = 'startup') {
    if (botProcess || botStarting || botStopping) {
        return;
    }

    if (!(await prepareConfigForBot())) {
        log(`PostgreSQL botConfig not found; bot is waiting for web configuration`);
        return;
    }

    botStarting = true;
    lastBotStartAt = new Date().toISOString();
    log(`starting Discord bot (${reason})`);

    botProcess = spawn(process.execPath, ['src/index.js'], {
        cwd: rootDir,
        env: {
            ...process.env,
            JSBOT_CONFIG_PATH: configPath,
        },
        stdio: 'inherit',
    });

    botStarting = false;

    botProcess.on('exit', (code, signal) => {
        lastBotExit = {
            code,
            signal,
            at: new Date().toISOString(),
        };
        botProcess = null;

        importMaterializedConfigIfChanged()
            .catch((error) => log(`failed to import materialized config after bot exit: ${error.message}`))
            .finally(() => {
                if (botStopping) {
                    botStopping = false;
                    return;
                }

                log(`bot exited with code=${code ?? 'null'} signal=${signal ?? 'null'}; scheduling restart`);
                clearRestartTimer();
                restartTimer = setTimeout(() => {
                    startBot('auto-restart').catch((error) => log(`auto-restart failed: ${error.message}`));
                }, 5000);
            });
    });
}

function stopBot() {
    return new Promise((resolveStop) => {
        clearRestartTimer();

        if (!botProcess) {
            botStopping = false;
            resolveStop();
            return;
        }

        botStopping = true;
        const processToStop = botProcess;
        const killTimer = setTimeout(() => {
            if (processToStop.exitCode === null) {
                processToStop.kill('SIGKILL');
            }
        }, 10000);

        processToStop.once('exit', () => {
            clearTimeout(killTimer);
            botProcess = null;
            botStopping = false;
            resolveStop();
        });

        processToStop.kill('SIGTERM');
    });
}

async function restartBot(reason = 'manual') {
    await stopBot();
    await startBot(reason);
}

async function getStatus() {
    let configExists = false;
    let configUpdatedAt = null;
    let guildCount = 0;

    try {
        const stored = await readConfigRow();
        const config = stored?.config || null;
        configExists = Boolean(config);
        configUpdatedAt = stored?.updatedAt ? new Date(stored.updatedAt).toISOString() : null;
        guildCount = Object.keys(config?.guilds || {}).length;
    } catch (_error) {
        configExists = false;
    }

    let configFileUpdatedAt = null;
    try {
        configFileUpdatedAt = (await stat(configPath)).mtime.toISOString();
    } catch (_error) {
        configFileUpdatedAt = null;
    }

    return {
        web: {
            enabled: true,
            authConfigured: Boolean(adminPassword),
            port,
        },
        database: {
            connected: configStoreReady,
            error: configStoreError?.message || null,
        },
        config: {
            source: 'postgres',
            path: configPath,
            exists: configExists,
            updatedAt: configUpdatedAt,
            materializedAt: configFileUpdatedAt,
            guildCount,
        },
        bot: {
            running: Boolean(botProcess),
            pid: botProcess?.pid || null,
            starting: botStarting,
            stopping: botStopping,
            lastStartAt: lastBotStartAt,
            lastExit: lastBotExit,
        },
    };
}

async function handleApi(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/session') {
        sendJson(res, 200, {
            authenticated: isSessionAuthenticated(req),
            authConfigured: Boolean(adminPassword),
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/login') {
        if (!adminPassword) {
            sendJson(res, 503, { error: 'JSBOT_WEB_PASSWORD is not set' });
            return;
        }
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}');
        if (!verifyPassword(payload.password || '')) {
            sendJson(res, 401, { error: '密码不正确' });
            return;
        }
        createSession(req, res);
        sendJson(res, 200, { ok: true });
        return;
    }

    if (!requireSession(req, res)) {
        return;
    }

    if (!requireMutationHeader(req, res)) {
        return;
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
        clearSession(req, res);
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/status') {
        sendJson(res, 200, await getStatus());
        return;
    }

    if (req.method === 'GET' && pathname === '/api/config') {
        const config = await readConfigIfExists();
        if (!config) {
            sendJson(res, 404, { config: null, message: 'config.json has not been created yet' });
            return;
        }
        sendJson(res, 200, { config });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/config') {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}');
        const config = payload.config || payload;
        await writeConfig(config);
        await restartBot('config-saved');
        sendJson(res, 200, { ok: true, status: await getStatus() });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/restart') {
        await restartBot('web-restart');
        sendJson(res, 200, { ok: true, status: await getStatus() });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/ai/models') {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}');
        const { url, key, provider } = payload;
        if (!url || typeof url !== 'string') {
            sendJson(res, 400, { error: '缺少接口地址' });
            return;
        }
        if (!key || typeof key !== 'string') {
            sendJson(res, 400, { error: '缺少 API Key' });
            return;
        }
        const result = await fetchAiModels({ url, key, provider: provider || 'custom' });
        sendJson(res, 200, result);
        return;
    }

    if (req.method === 'POST' && pathname === '/api/ai/test') {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}');
        const { url, key, provider, model } = payload;
        if (!url || typeof url !== 'string') {
            sendJson(res, 400, { error: '缺少接口地址' });
            return;
        }
        if (!key || typeof key !== 'string') {
            sendJson(res, 400, { error: '缺少 API Key' });
            return;
        }
        const result = await testAiConnectivity({ url, key, provider: provider || 'custom', model });
        sendJson(res, 200, result);
        return;
    }

    if (req.method === 'POST' && pathname === '/api/config/validate') {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}');
        const config = payload.config || payload;
        const result = await runConfigValidation(config);
        sendJson(res, 200, result);
        return;
    }

    if (req.method === 'POST' && pathname === '/api/commands/sync') {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}');
        const config = payload.config || await readConfigIfExists();
        if (!config) {
            sendJson(res, 400, { error: '请先填写并保存基础配置' });
            return;
        }

        validateConfig(config);
        const guildId = resolveSyncGuild(config, payload.guildId);
        const result = await syncDiscordCommands(config, guildId);

        config.guilds[guildId].commandsDeployed = true;
        await writeConfig(config);

        sendJson(res, 200, {
            ok: true,
            guildId,
            commandCount: result.commandCount,
            localCommandCount: result.localCommandCount,
            commandsDeployed: true,
            status: await getStatus(),
        });
        return;
    }

    sendJson(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed\n');
        return;
    }

    const normalizedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = resolve(staticDir, `.${decodeURIComponent(normalizedPath)}`);

    if (filePath !== staticDir && !filePath.startsWith(`${staticDir}/`)) {
        sendText(res, 403, 'Forbidden\n');
        return;
    }

    try {
        const file = await readFile(filePath);
        const contentType = mimeTypes[extname(filePath)] || 'application/octet-stream';
        res.writeHead(200, {
            'content-type': contentType,
            'cache-control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : file);
    } catch (error) {
        if (error.code === 'ENOENT') {
            sendText(res, 404, 'Not found\n');
            return;
        }
        throw error;
    }
}

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

        if (url.pathname === '/healthz') {
            sendJson(res, 200, { ok: true, botRunning: Boolean(botProcess), configExists: await hasStoredConfig(), databaseConnected: configStoreReady });
            return;
        }

        if (url.pathname.startsWith('/api/')) {
            await handleApi(req, res, url.pathname);
            return;
        }

        await serveStatic(req, res, url.pathname);
    } catch (error) {
        const statusCode = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
        sendJson(res, statusCode, { error: error.message || 'Internal server error' });
    }
});

function shutdown(signal) {
    log(`received ${signal}; shutting down`);
    server.close(() => null);
    stopBot().finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
    console.error(error);
});
process.on('unhandledRejection', (error) => {
    console.error(error);
});

server.listen(port, host, () => {
    log(`configuration page listening on http://${host}:${port}`);
    if (!adminPassword) {
        log('WARNING: JSBOT_WEB_PASSWORD is not set; configuration page is locked until a password is configured');
    }
    ensureConfigStore()
        .then(() => startBot('supervisor-startup'))
        .catch((error) => log(`startup failed: ${error.message}`));
});
