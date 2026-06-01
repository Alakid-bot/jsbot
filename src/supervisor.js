import { createHash, timingSafeEqual } from 'crypto';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getConfigPath } from './utils/configPaths.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(currentDir, '..');
const staticDir = join(rootDir, 'deploy', 'config-wizard');
const configPath = process.env.JSBOT_CONFIG_PATH
    ? getConfigPath()
    : join(rootDir, 'data', 'config.json');
const port = Number(process.env.PORT || process.env.JSBOT_WEB_PORT || 8080);
const host = process.env.JSBOT_WEB_HOST || '0.0.0.0';
const adminPassword = process.env.JSBOT_WEB_PASSWORD || process.env.JSBOT_WEB_TOKEN || '';
const username = process.env.JSBOT_WEB_USERNAME || 'admin';
const maxBodyBytes = 1024 * 1024;

let botProcess = null;
let botStarting = false;
let botStopping = false;
let restartTimer = null;
let lastBotStartAt = null;
let lastBotExit = null;

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

function isAuthenticated(req) {
    if (!adminPassword) {
        return false;
    }

    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) {
        return false;
    }

    let decoded = '';
    try {
        decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    } catch (_error) {
        return false;
    }

    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) {
        return false;
    }

    const providedUsername = decoded.slice(0, separatorIndex);
    const providedPassword = decoded.slice(separatorIndex + 1);

    return safeEqual(providedUsername, username) && safeEqual(providedPassword, adminPassword);
}

function requireAuth(req, res) {
    if (!adminPassword) {
        sendText(
            res,
            503,
            'JSBOT_WEB_PASSWORD is not set. Set this environment variable before exposing the web configuration page.\n',
        );
        return false;
    }

    if (isAuthenticated(req)) {
        return true;
    }

    res.writeHead(401, {
        'www-authenticate': 'Basic realm="JSBot Config", charset="UTF-8"',
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end('Authentication required.\n');
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

async function readConfigIfExists() {
    if (!existsSync(configPath)) {
        return null;
    }

    return JSON.parse(await readFile(configPath, 'utf8'));
}

async function writeConfig(config) {
    validateConfig(config);
    await mkdir(dirname(configPath), { recursive: true });
    const tempPath = `${configPath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(config, null, 4)}\n`, { mode: 0o600 });
    await rename(tempPath, configPath);
}

function shouldStartBot() {
    return existsSync(configPath);
}

function clearRestartTimer() {
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
}

function startBot(reason = 'startup') {
    if (botProcess || botStarting || botStopping) {
        return;
    }

    if (!shouldStartBot()) {
        log(`config not found at ${configPath}; bot is waiting for web configuration`);
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

        if (botStopping) {
            botStopping = false;
            return;
        }

        log(`bot exited with code=${code ?? 'null'} signal=${signal ?? 'null'}; scheduling restart`);
        clearRestartTimer();
        restartTimer = setTimeout(() => startBot('auto-restart'), 5000);
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
    startBot(reason);
}

async function getStatus() {
    let configExists = false;
    let configUpdatedAt = null;
    let guildCount = 0;

    try {
        const configStats = await stat(configPath);
        configExists = true;
        configUpdatedAt = configStats.mtime.toISOString();
        const config = await readConfigIfExists();
        guildCount = Object.keys(config?.guilds || {}).length;
    } catch (_error) {
        configExists = false;
    }

    return {
        web: {
            enabled: true,
            authConfigured: Boolean(adminPassword),
            port,
        },
        config: {
            path: configPath,
            exists: configExists,
            updatedAt: configUpdatedAt,
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
    if (!requireAuth(req, res)) {
        return;
    }

    if (!requireMutationHeader(req, res)) {
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

    sendJson(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, pathname) {
    if (!requireAuth(req, res)) {
        return;
    }

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
            sendJson(res, 200, { ok: true, botRunning: Boolean(botProcess), configExists: existsSync(configPath) });
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
    startBot('supervisor-startup');
});
