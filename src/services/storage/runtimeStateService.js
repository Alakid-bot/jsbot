import { QueryTypes } from 'sequelize';
import { pgManager } from '../../pg/pgManager.js';
import { ErrorHandler } from '../../utils/errorHandler.js';

const DEFAULTS = {
    messageIds: {},
    carouselConfig: { channelCarousels: {} },
    opinionRecords: { validSubmissions: [] },
    creatorRoleOptOut: { optOutUsers: [] },
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

class RuntimeStateService {
    async getState(key, defaultValue = {}) {
        return ErrorHandler.handleService(
            async () => {
                const sequelize = pgManager.getSequelize();
                const rows = await sequelize.query(
                    'SELECT value FROM runtime_state WHERE key = $1',
                    { bind: [key], type: QueryTypes.SELECT },
                );
                if (!rows[0]) {
                    return clone(defaultValue);
                }
                return typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
            },
            `读取运行时状态-${key}`,
            { throwOnError: true, userFriendly: false },
        );
    }

    async setState(key, value) {
        await ErrorHandler.handleService(
            async () => {
                const sequelize = pgManager.getSequelize();
                await sequelize.query(
                    `INSERT INTO runtime_state (key, value, updated_at)
                     VALUES ($1, $2::jsonb, $3)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
                    { bind: [key, JSON.stringify(value), Date.now()] },
                );
            },
            `保存运行时状态-${key}`,
            { throwOnError: true, userFriendly: false },
        );
    }

    async getMessageIds() {
        return this.getState('messageIds', DEFAULTS.messageIds);
    }

    async setMessageIds(messageIds) {
        await this.setState('messageIds', messageIds);
    }

    async getCarouselConfig() {
        return this.getState('carouselConfig', DEFAULTS.carouselConfig);
    }

    async setCarouselConfig(config) {
        await this.setState('carouselConfig', config);
    }

    async getBotConfig() {
        return this.getState('botConfig', null);
    }

    async setBotConfig(config) {
        await this.setState('botConfig', config);
    }

    async getOpinionRecords() {
        return this.getState('opinionRecords', DEFAULTS.opinionRecords);
    }

    async setOpinionRecords(records) {
        await this.setState('opinionRecords', records);
    }

    async getCreatorRoleOptOut() {
        return this.getState('creatorRoleOptOut', DEFAULTS.creatorRoleOptOut);
    }

    async setCreatorRoleOptOut(state) {
        await this.setState('creatorRoleOptOut', state);
    }

    async getThreadCache(threadId) {
        return this.getState(`threadCache:${threadId}`, null);
    }

    async setThreadCache(threadId, data) {
        await this.setState(`threadCache:${threadId}`, data);
    }

    async getAllThreadCacheIds() {
        return ErrorHandler.handleService(
            async () => {
                const sequelize = pgManager.getSequelize();
                const rows = await sequelize.query(
                    "SELECT key FROM runtime_state WHERE key LIKE 'threadCache:%'",
                    { type: QueryTypes.SELECT },
                );
                return rows.map(row => row.key.replace('threadCache:', ''));
            },
            '读取子区缓存列表',
            { throwOnError: true, userFriendly: false },
        ).then(result => result.data);
    }
}

export const runtimeStateService = new RuntimeStateService();
export default runtimeStateService;
