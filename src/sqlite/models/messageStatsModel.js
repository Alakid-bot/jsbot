import { dbManager } from '../dbManager.js';
import { BaseModel } from './BaseModel.js';

class MessageStatsModel extends BaseModel {
    static get tableName() {
        return 'message_stats';
    }

    static get numberFields() {
        return ['messageCount', 'firstMessageAt', 'lastMessageAt', 'createdAt', 'updatedAt'];
    }

    static async increment(guildId, userId, timestamp = Date.now()) {
        await dbManager.safeExecute(
            'run',
            `INSERT INTO message_stats (
                guildId, userId, messageCount, firstMessageAt, lastMessageAt, createdAt, updatedAt
            ) VALUES (?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(guildId, userId) DO UPDATE SET
                messageCount = messageCount + 1,
                lastMessageAt = excluded.lastMessageAt,
                updatedAt = excluded.updatedAt`,
            [guildId, userId, timestamp, timestamp, timestamp, timestamp],
        );
        this.clearCache(this.getCacheKey(`${guildId}_${userId}`));
    }

    static async getByUser(guildId, userId) {
        const cacheKey = this.getCacheKey(`${guildId}_${userId}`);
        const cached = this.getCache(cacheKey);
        if (cached) {
            return cached;
        }

        const record = await this.findOne('guildId = ? AND userId = ?', [guildId, userId]);
        if (record) {
            this.setCache(cacheKey, record);
        }
        return record;
    }
}

export { MessageStatsModel };
export default MessageStatsModel;
