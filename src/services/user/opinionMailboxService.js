import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { EmbedFactory } from '../../factories/embedFactory.js';
import { delay } from '../../utils/concurrency.js';
import { ErrorHandler } from '../../utils/errorHandler.js';
import { logTime } from '../../utils/logger.js';
import { runtimeStateService } from '../storage/runtimeStateService.js';

/**
 * 意见信箱服务类
 */
class OpinionMailboxService {
    constructor() {
        this.messageIds = {};
        this.opinionRecords = { validSubmissions: [] };
    }

    async initialize() {
        this.messageIds = await this.loadMessageIds();
        this.opinionRecords = await runtimeStateService.getOpinionRecords();
    }

    /**
     * 加载消息ID配置
     * @returns {Object} 消息ID配置对象
     */
    async loadMessageIds() {
        return ErrorHandler.handleSilent(
            () => runtimeStateService.getMessageIds(),
            "加载消息ID配置",
            {}
        );
    }

    /**
     * 保存消息ID配置
     * @param {Object} messageIds - 消息ID配置对象
     */
    saveMessageIds(messageIds) {
        this.messageIds = messageIds;
        runtimeStateService.setMessageIds(messageIds)
            .catch(error => logTime(`[意见信箱] 保存消息ID失败: ${error.message}`, true));
    }

    /**
     * 创建意见信箱消息内容
     * @returns {Object} 包含embed和components的消息对象
     */
    createMailboxMessage() {
        // 创建意见投稿按钮
        const opinionButton = new ButtonBuilder()
            .setCustomId('submit_opinion')
            .setLabel('提交社区意见')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('💬');

        const row = new ActionRowBuilder().addComponents(opinionButton);

        // 创建嵌入消息
        const embed = EmbedFactory.createOpinionMailboxEmbed();

        return {
            embeds: [embed],
            components: [row],
        };
    }

    /**
     * 发送意见信箱消息到指定频道
     * @param {Channel} channel - 目标频道
     * @param {Client} client - Discord客户端
     * @returns {Promise<Message>} 发送的消息对象
     */
    async sendMailboxMessage(channel, client) {
        return await ErrorHandler.handleService(
            async () => {
                const messageContent = this.createMailboxMessage();
                const message = await channel.send(messageContent);

                // 更新消息ID记录
                this.updateMailboxMessageId(channel.id, message.id, client);

                return message;
            },
            "发送意见信箱消息",
            { throwOnError: true }
        );
    }

    /**
     * 更新频道的意见信箱消息ID记录
     * @param {string} channelId - 频道ID
     * @param {string} messageId - 消息ID
     * @param {Client} client - Discord客户端（用于获取主服务器ID）
     */
    updateMailboxMessageId(channelId, messageId, client) {
        ErrorHandler.handleServiceSync(
            () => {
                const guildId = client.guildManager.getMainServerId();

                // 确保结构存在
                this.messageIds[guildId] ??= {};
                this.messageIds[guildId].opinionMailbox ??= {};

                // 更新内存中的配置
                this.messageIds[guildId].opinionMailbox[channelId] = messageId;

                // 保存到文件
                this.saveMessageIds(this.messageIds);

                logTime(`[意见信箱] 已更新频道 ${channelId} 的消息ID记录: ${messageId}`);
            },
            "更新消息ID记录",
            { throwOnError: true }
        );
    }

    /**
     * 获取频道的意见信箱消息ID
     * @param {string} channelId - 频道ID
     * @param {Client} client - Discord客户端（用于获取主服务器ID）
     * @returns {string|null} 消息ID或null
     */
    getMailboxMessageId(channelId, client) {
        const guildId = client.guildManager.getMainServerId();
        return this.messageIds[guildId]?.opinionMailbox?.[channelId] || null;
    }

    /**
     * 删除旧的意见信箱消息
     * @param {Channel} channel - 频道对象
     * @param {Client} client - Discord客户端
     * @returns {Promise<boolean>} 删除是否成功
     */
    async deleteOldMailboxMessage(channel, client) {
        return await ErrorHandler.handleSilent(
            async () => {
                const oldMessageId = this.getMailboxMessageId(channel.id, client);
                if (!oldMessageId) {
                    return false;
                }

                const oldMessage = await channel.messages.fetch(oldMessageId);
                await oldMessage.delete();
                return true;
            },
            "删除旧意见信箱消息",
            false
        );
    }

    /**
     * 检查频道最后一条消息是否为BOT发送
     * @param {Channel} channel - 频道对象
     * @returns {Promise<boolean>} 最后一条消息是否为BOT发送
     */
    async isLastMessageFromBot(channel) {
        return await ErrorHandler.handleSilent(
            async () => {
                const messages = await channel.messages.fetch({ limit: 1 });
                if (messages.size === 0) {
                    return false;
                }

                const lastMessage = messages.first();
                return lastMessage.author.bot;
            },
            "检查频道最后消息",
            false
        );
    }

    /**
     * 维护意见信箱消息 - 检查并重新发送如果需要
     * @param {Client} client - Discord客户端
     * @param {string} channelId - 频道ID
     * @returns {Promise<boolean>} 是否进行了维护操作
     */
    async maintainMailboxMessage(client, channelId) {
        const result = await ErrorHandler.handleService(
            async () => {
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    throw new Error(`无法获取频道 ${channelId}`);
                }

                // 检查最后一条消息是否为BOT发送
                const isLastFromBot = await this.isLastMessageFromBot(channel);
                if (isLastFromBot) {
                    // 如果最后一条消息是BOT发送的，不需要维护
                    return false;
                }

                // 如果最后一条消息不是BOT发送的，删除旧的意见信箱入口并重新发送
                await this.deleteOldMailboxMessage(channel, client);

                // 发送新的意见信箱消息
                await this.sendMailboxMessage(channel, client);

                logTime(`[意见信箱] 已完成频道 ${channel.name} 的意见信箱入口维护`);
                return true;
            },
            `意见信箱维护 [频道 ${channelId}]`
        );

        return result.success ? result.data : false;
    }

    /**
     * 批量维护所有意见信箱消息
     * @param {Client} client - Discord客户端
     * @returns {Promise<number>} 维护的频道数量
     */
    async maintainAllMailboxMessages(client) {
        const result = await ErrorHandler.handleService(
            async () => {
                // 获取主服务器的频道列表
                const guildId = client.guildManager.getMainServerId();
                const channelIds = Object.keys(this.messageIds[guildId]?.opinionMailbox || {});
                let maintainedCount = 0;

                for (const channelId of channelIds) {
                    const maintained = await this.maintainMailboxMessage(client, channelId);
                    if (maintained) {
                        maintainedCount++;
                    }

                    // 添加延迟以避免API速率限制
                    await delay(1000);
                }

                return maintainedCount;
            },
            "意见信箱批量维护"
        );

        return result.success ? result.data : 0;
    }

    /**
     * 读取意见记录配置
     * @returns {Object} 意见记录配置对象
     */
    getOpinionRecords() {
        return this.opinionRecords;
    }

    /**
     * 写入意见记录配置
     * @param {Object} records - 意见记录对象
     */
    saveOpinionRecords(records) {
        this.opinionRecords = records;
        runtimeStateService.setOpinionRecords(records)
            .catch(error => logTime(`[意见记录] 保存失败: ${error.message}`, true));
    }

    /**
     * 更新意见记录
     * @param {string} userId - 用户ID
     * @param {string} submissionType - 投稿类型 (news/opinion)
     * @param {boolean} isApproved - 是否被批准
     * @param {Object} [submissionData] - 投稿数据 {title: string, content: string}
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async updateOpinionRecord(userId, submissionType, isApproved, submissionData = null) {
        return await ErrorHandler.handleService(
            async () => {
                if (!isApproved) {
                    // 如果是拒绝，不需要记录到文件中
                    return { message: '投稿已标记为不合理' };
                }

                // 读取现有记录
                const records = this.getOpinionRecords();

                // 检查用户是否已有记录
                const existingUserRecord = records.validSubmissions.find(record => record.userId === userId);

                const submissionRecord = {
                    type: submissionType,
                    title: submissionData?.title || '未记录标题',
                    content: submissionData?.content || '未记录内容',
                    approvedAt: new Date().toISOString()
                };

                if (existingUserRecord) {
                    // 更新现有用户记录
                    existingUserRecord.submissions.push(submissionRecord);
                } else {
                    // 创建新用户记录
                    records.validSubmissions.push({
                        userId: userId,
                        submissions: [submissionRecord]
                    });
                }

                // 保存记录
                this.saveOpinionRecords(records);

                logTime(`[意见记录] 已记录用户 ${userId} 的有效${submissionType === 'news' ? '新闻投稿' : '社区意见'}: "${submissionRecord.title}"`);

                return { message: '投稿已标记为合理并记录' };
            },
            "更新意见记录",
            { userFriendly: true }
        );
    }

    /**
     * 检查用户是否有有效的投稿记录
     * @param {string} userId - 用户ID
     * @returns {boolean} 是否有有效记录
     */
    hasValidSubmissionRecord(userId) {
        return ErrorHandler.handleSilentSync(
            () => {
                const records = this.getOpinionRecords();
                const userRecord = records.validSubmissions.find(record => record.userId === userId);
                return userRecord && userRecord.submissions.length > 0;
            },
            "检查投稿记录",
            false
        );
    }

    /**
     * 处理意见投稿提交的业务逻辑
     * @param {Object} client - Discord客户端
     * @param {string} guildId - 服务器ID
     * @param {Object} user - 提交用户
     * @param {string} title - 投稿标题
     * @param {string} content - 投稿内容
     * @param {string} type - 投稿类型
     * @param {string} titlePrefix - 标题前缀
     * @param {number} color - 嵌入消息颜色
     * @returns {Promise<{success: boolean, message?: Object}>} 处理结果
     */
    async handleOpinionSubmission(client, guildId, user, title, content, type, titlePrefix, color) {
        return await ErrorHandler.handleService(
            async () => {
                // 获取服务器配置（启动时已验证）
                const guildConfig = client.guildManager.getGuildConfig(guildId);

                // 创建嵌入消息
                const messageEmbed = EmbedFactory.createSubmissionReviewEmbed(user, title, content, titlePrefix, color);

                // 创建判定按钮
                const buttons = [
                    {
                        type: 2,
                        style: 3, // Success (绿色)
                        label: '合理',
                        custom_id: `approve_submission_${user.id}_${type}`,
                        emoji: { name: '✅' }
                    },
                    {
                        type: 2,
                        style: 4, // Danger (红色)
                        label: '不合理',
                        custom_id: `reject_submission_${user.id}_${type}`,
                        emoji: { name: '🚪' }
                    }
                ];

                const actionRow = {
                    type: 1,
                    components: buttons
                };

                // 获取目标频道并发送消息
                const targetChannel = await client.channels.fetch(guildConfig.opinionMailThreadId);
                if (!targetChannel) {
                    throw new Error('无法获取目标频道');
                }

                const message = await targetChannel.send({
                    embeds: [messageEmbed],
                    components: [actionRow]
                });

                logTime(`用户 ${user.tag} 提交了社区意见: "${title}"`);

                return { success: true, message };
            },
            "处理意见投稿提交"
        );
    }

    /**
     * 处理解锁申请提交的业务逻辑
     * @param {Object} client - Discord客户端
     * @param {Object} user - 申请用户
     * @param {Object} thread - 子区对象
     * @param {string} unlockReason - 解锁理由
     * @param {string} targetChannelId - 目标频道ID
     * @returns {Promise<Object>} 处理结果
     */
    async handleUnlockRequest(client, user, thread, unlockReason, targetChannelId) {
        return await ErrorHandler.handleService(
            async () => {
                // 创建解锁申请embed
                const requestEmbed = EmbedFactory.createUnlockRequestEmbed(
                    user,
                    thread.url,
                    thread.name,
                    unlockReason
                );

                // 创建审核按钮
                const buttons = [
                    {
                        type: 2,
                        style: 3, // Success (绿色)
                        label: '同意解锁',
                        custom_id: `approve_unlock_${user.id}_${thread.id}`,
                        emoji: { name: '✅' }
                    },
                    {
                        type: 2,
                        style: 4, // Danger (红色)
                        label: '拒绝解锁',
                        custom_id: `reject_unlock_${user.id}_${thread.id}`,
                        emoji: { name: '❌' }
                    }
                ];

                const actionRow = {
                    type: 1,
                    components: buttons
                };

                // 获取目标频道并发送消息
                const targetChannel = await client.channels.fetch(targetChannelId);
                if (!targetChannel) {
                    throw new Error('无法获取目标频道');
                }

                const message = await targetChannel.send({
                    embeds: [requestEmbed],
                    components: [actionRow]
                });

                logTime(`用户 ${user.tag} 提交了子区解锁申请: "${thread.name}"`);

                return { success: true, message };
            },
            "处理解锁申请提交"
        );
    }

    /**
     * 处理解锁审核的业务逻辑
     * @param {Object} client - Discord客户端
     * @param {Object} interaction - Discord交互对象
     * @param {boolean} isApproved - 是否批准
     * @param {string} userId - 用户ID
     * @param {Object} thread - 子区对象
     * @returns {Promise<Object>} 处理结果
     */
    async handleUnlockReview(client, interaction, isApproved, userId, thread) {
        return await ErrorHandler.handleService(
            async () => {
                // 如果批准，执行解锁操作
                if (isApproved) {
                    await thread.setArchived(false);
                    await thread.setLocked(false, `管理员批准了 <@${userId}> 的解锁申请`);
                    logTime(`管理员 ${interaction.user.tag} 批准了用户 ${userId} 对子区 ${thread.name} 的解锁申请`);
                } else {
                    logTime(`管理员 ${interaction.user.tag} 拒绝了用户 ${userId} 对子区 ${thread.name} 的解锁申请`);
                }

                // 更新原始消息的embed
                const originalEmbed = interaction.message.embeds[0];
                const updatedEmbed = {
                    ...originalEmbed.toJSON(),
                    color: isApproved ? EmbedFactory.Colors.SUCCESS : EmbedFactory.Colors.ERROR,
                    footer: {
                        text: isApproved ? '已批准' : '已拒绝'
                    }
                };

                // 移除按钮并更新消息
                await interaction.message.edit({
                    embeds: [updatedEmbed],
                    components: []
                });

                // 获取目标用户信息
                const targetUser = await ErrorHandler.handleSilent(
                    async () => await client.users.fetch(userId),
                    "获取用户信息"
                );

                // 发送私聊通知
                await ErrorHandler.handleSilent(
                    async () => {
                        if (!targetUser) return;

                        const feedbackEmbed = EmbedFactory.createUnlockFeedbackEmbed(
                            isApproved,
                            thread.name,
                            thread.url,
                            null
                        );

                        await targetUser.send({ embeds: [feedbackEmbed] });
                        logTime(`已向用户 ${targetUser.tag} 发送解锁申请${isApproved ? '批准' : '拒绝'}通知`);
                    },
                    "发送私聊通知"
                );

                // 发送审核日志消息
                await ErrorHandler.handleSilent(
                    async () => {
                        const auditLogContent = [
                            `### ${interaction.user.tag} ${isApproved ? '批准了' : '拒绝了'}用户 ${targetUser?.tag || `<@${userId}>`} 的解锁申请`,
                            `子区：[${thread.name}](${thread.url})`,
                        ].join('\n');

                        await interaction.message.reply({
                            content: auditLogContent,
                            allowedMentions: { users: [] }
                        });
                    },
                    "发送审核日志"
                );

                return {
                    success: true,
                    isApproved
                };
            },
            `${isApproved ? '批准' : '拒绝'}解锁申请`
        );
    }

    /**
     * 处理投稿审核的业务逻辑
     * @param {Object} client - Discord客户端
     * @param {Object} interaction - Discord交互对象
     * @param {boolean} isApproved - 是否批准
     * @param {string} userId - 用户ID
     * @param {string} submissionType - 投稿类型
     * @param {string} messageId - 消息ID
     * @param {string} adminReply - 管理员回复
     * @returns {Promise<Object>} 处理结果
     */
    async handleSubmissionReview(client, interaction, isApproved, userId, submissionType, messageId, adminReply) {
        return await ErrorHandler.handleService(
            async () => {
                // 通过消息ID获取原始消息（关键操作，失败就抛出）
                const originalMessage = await interaction.channel.messages.fetch(messageId);
                if (!originalMessage) {
                    throw new Error('无法获取原始投稿消息');
                }

                // 从embed中提取投稿信息
                const originalEmbed = originalMessage.embeds[0];
                let submissionData = null;
                let submissionTitle = '未知标题';

                if (originalEmbed) {
                    // 提取标题（去掉前缀）
                    let title = originalEmbed.title || '未记录标题';
                    if (title.startsWith('💬 社区意见：')) {
                        title = title.replace('💬 社区意见：', '').trim();
                    }
                    submissionTitle = title;

                    // 只有批准时才需要完整的投稿数据
                    if (isApproved) {
                        const content = originalEmbed.description || '未记录内容';
                        submissionData = {
                            title: title,
                            content: content
                        };
                    }
                }

                // 根据处理结果更新消息的embed
                const updatedEmbed = EmbedFactory.createUpdatedSubmissionEmbed(originalEmbed, isApproved);

                // 移除按钮并更新消息
                await originalMessage.edit({
                    embeds: [updatedEmbed],
                    components: []
                });

                // 如果是批准，需要更新意见记录
                if (isApproved) {
                    const result = await this.updateOpinionRecord(userId, submissionType, true, submissionData);
                    if (!result.success) {
                        throw new Error(result.message);
                    }
                }

                // 获取目标用户信息（一次性获取，避免重复）
                const targetUser = await ErrorHandler.handleSilent(
                    async () => await client.users.fetch(userId),
                    "获取用户信息"
                );

                // 发送私聊通知（可容错操作）
                const dmSuccess = await ErrorHandler.handleSilent(
                    async () => {
                        if (!targetUser) return false;

                        const dmEmbed = EmbedFactory.createDMFeedbackEmbed(isApproved, submissionTitle, adminReply);

                        await targetUser.send({ embeds: [dmEmbed] });
                        logTime(`已向用户 ${targetUser.tag} 发送投稿${isApproved ? '审定通过' : '拒绝'}通知`);
                        return true;
                    },
                    "发送私聊通知",
                    false
                );

                // 发送审核日志消息（可容错操作）
                await ErrorHandler.handleSilent(
                    async () => {
                        const dmStatus = dmSuccess ? '发送成功' : '发送失败';
                        const auditLogContent = [
                            `### ${interaction.user.tag} ${isApproved ? '审定通过了' : '拒绝了'}用户 ${targetUser?.tag || `<@${userId}>`} 的社区意见`,
                            `回复为（${dmStatus}）：${adminReply}`,
                        ].join('\n');

                        await originalMessage.reply({
                            content: auditLogContent,
                            allowedMentions: { users: [] }
                        });
                    },
                    "发送审核日志"
                );

                logTime(`管理员 ${interaction.user.tag} ${isApproved ? '批准' : '拒绝'}了用户 ${userId} 的社区意见: "${submissionTitle}"`);

                return {
                    success: true,
                    submissionTitle,
                    isApproved
                };
            },
            `${isApproved ? '审定通过' : '拒绝'}投稿`
        );
    }
}

// 创建全局单例
export const opinionMailboxService = new OpinionMailboxService();
export default OpinionMailboxService;
