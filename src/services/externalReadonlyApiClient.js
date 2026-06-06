import fs from 'fs';
import path from 'path';

class ExternalReadonlyApiClient {
    constructor() {
        this.config = null;
    }

    _loadConfig() {
        if (this.config) {
            return this.config;
        }

        const envConfig = {
            baseUrl: process.env.JSBOT_EXTERNAL_READONLY_API_URL,
            token: process.env.JSBOT_EXTERNAL_READONLY_API_TOKEN,
            timeoutMillis: Number(process.env.JSBOT_EXTERNAL_READONLY_API_TIMEOUT_MS || 10000),
        };

        if (envConfig.baseUrl && envConfig.token) {
            this.config = envConfig;
            return this.config;
        }

        const configPath = path.join(process.cwd(), 'external-readonly-api.config.json');
        if (!fs.existsSync(configPath)) {
            throw new Error('外部只读 API 配置不存在，请设置 JSBOT_EXTERNAL_READONLY_API_URL 和 JSBOT_EXTERNAL_READONLY_API_TOKEN');
        }

        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!fileConfig.baseUrl || !fileConfig.token) {
            throw new Error('外部只读 API 配置缺少 baseUrl 或 token');
        }

        this.config = {
            baseUrl: fileConfig.baseUrl,
            token: fileConfig.token,
            timeoutMillis: Number(fileConfig.timeoutMillis || envConfig.timeoutMillis),
        };
        return this.config;
    }

    async _request(pathname) {
        const config = this._loadConfig();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMillis);

        try {
            const url = new URL(pathname, config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`);
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${config.token}`,
                },
                signal: controller.signal,
            });

            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(body.error || `外部只读 API 请求失败: HTTP ${response.status}`);
            }

            return body;
        } finally {
            clearTimeout(timeout);
        }
    }

    async getStatus() {
        const config = this._loadConfig();
        const status = await this._request('/v1/status');
        return {
            ...status,
            baseUrl: config.baseUrl,
        };
    }

    async getStats() {
        return this._request('/v1/stats');
    }
}

export const externalReadonlyApiClient = new ExternalReadonlyApiClient();
export default externalReadonlyApiClient;
