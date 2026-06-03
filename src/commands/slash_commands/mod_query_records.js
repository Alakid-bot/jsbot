import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { ProcessModel } from '../../sqlite/models/processModel.js';
import { PunishmentModel } from '../../sqlite/models/punishmentModel.js';
import { VoteModel } from '../../sqlite/models/voteModel.js';
import { checkModeratorPermission, formatPunishmentDuration, handleCommandError } from '../../utils/helper.js';

export default {
    cooldown: 5,
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('查询记录')
        .setDescription('查询数据库记录')
        .addStringOption(option =>
            option
                .setName('类型')
                .setDescription('要查询的记录类型')
                .setRequired(true)
                .addChoices(
                    { name: '处罚记录', value: 'punishment' },
                    { name: '流程记录', value: 'process' },
                    { name: '投票记录', value: 'vote' }
                ),
        )
        .addUserOption(option => option.setName('用户').setDescription('筛选特定用户（可选）').setRequired(false))
        .addStringOption(option => option.setName('记录编号').setDescription('通过记录编号直接查询特定记录（可选）').setRequired(false)),

    async execute(interaction, guildConfig) {
        try {
            // 需要版主或管理员权限
            if (!(await checkModeratorPermission(interaction, guildConfig))) {
                return;
            }

            const type = interaction.options.getString('类型');
            const targetUser = interaction.options.getUser('用户');
            const queryId = interaction.options.getString('记录编号');

            if (type === 'punishment') {
                // 根据ID精确查询或按条件查询
                let punishments;
                if (queryId) {
                    // 通过ID精确查询
                    const punishment = await PunishmentModel.getPunishmentById(queryId);
                    punishments = punishment ? [punishment] : [];
                } else {
                    // 查询处罚记录：全库只查活跃，个人查所有历史
                    punishments = targetUser
                        ? await PunishmentModel.getUserPunishments(targetUser.id, true) // 包含历史记录
                        : await PunishmentModel.getAllPunishments(false); // 只显示活跃记录
                }

                if (!punishments || punishments.length === 0) {
                    await interaction.editReply({
                        content: queryId
                            ? `❌ 找不到ID为 ${queryId} 的处罚记录`
                            : targetUser
                            ? `✅ 用户 ${targetUser.tag} 没有任何处罚记录`
                            : '✅ 数据库中没有活跃的处罚记录',
                        flags: ['Ephemeral'],
                    });
                    return;
                }

                // 分页处理（每页10条记录）
                const pages = [];
                const pageSize = 10;
                for (let i = 0; i < punishments.length; i += pageSize) {
                    const pageRecords = punishments.slice(i, i + pageSize);
                    const fields = await Promise.all(
                        pageRecords.map(async (p, index) => {
                            const executor = await interaction.client.users.fetch(p.executorId).catch(() => null);

                            // 处罚类型和状态显示
                            const typeText = {
                                ban: '永封',
                                mute: '禁言',
                                softban: '软封锁',
                                warning: '警告',
                            };

                            const statusText = {
                                active: '🟢 生效中',
                                expired: '⚪ 已到期',
                                appealed: '🔵 已上诉',
                                revoked: '🔴 已撤销',
                            };

                            // 处罚信息格式化
                            const punishmentInfo = [
                                `**执行人:** ${executor ? `<@${executor.id}>` : '未知'}`,
                                !targetUser ? `**处罚对象:** <@${p.targetId || p.userId}>` : null,
                                `**原因:** ${p.reason}`,
                                `**时长:** ${formatPunishmentDuration(p.duration)}`,
                                p.warningDuration ? `**警告剩余时间:** <t:${Math.floor((p.createdAt + p.warningDuration) / 1000)}:R>` : null,
                                p.status === 'active' && p.duration !== -1
                                    ? `**到期时间:** <t:${Math.floor((p.createdAt + p.duration) / 1000)}:R>`
                                    : null,
                                p.status !== 'active' ? `**${statusText[p.status].split(' ')[1]}原因:** ${p.statusReason || '无'}` : null,
                                `**处罚ID:** ${p.id}`,
                            ]
                                .filter(Boolean)
                                .join('\n');

                            return {
                                name: `${statusText[p.status]} ${typeText[p.type]} (#${i + index + 1})`,
                                value: punishmentInfo,
                                inline: false,
                            };
                        }),
                    );

                    pages.push({
                        embeds: [
                            {
                                color: targetUser ? 0x3498db : queryId ? 0xe74c3c : 0x0099ff, // ID查询使用红色
                                title: '处罚记录查询结果',
                                description: queryId
                                    ? `ID ${queryId} 的处罚记录`
                                    : targetUser
                                    ? `用户 <@${targetUser.id}> 的处罚历史记录`
                                    : '当前活跃的处罚记录',
                                fields,
                                timestamp: new Date(),
                                footer: {
                                    text: `第 ${pages.length + 1} 页 | 共 ${Math.ceil(
                                        punishments.length / pageSize,
                                    )} 页 | 总计 ${punishments.length} 条记录`,
                                },
                            },
                        ],
                    });
                }

                // 发送第一页
                const addPaginationButtons = page => {
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('page_prev').setLabel('上一页').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('page_next').setLabel('下一页').setStyle(ButtonStyle.Primary),
                    );
                    return { ...page, components: [row] };
                };

                const message = await interaction.editReply(addPaginationButtons(pages[0]));

                // 缓存页面数据（5分钟后自动清除）
                interaction.client.pageCache = interaction.client.pageCache || new Map();
                interaction.client.pageCache.set(message.id, pages);
                setTimeout(() => interaction.client.pageCache.delete(message.id), 5 * 60 * 1000);
            } else if (type === 'process') {
                // 根据ID精确查询或按条件查询
                let processes;
                if (queryId) {
                    // 通过ID精确查询
                    const process = await ProcessModel.getProcessById(queryId);
                    processes = process ? [process] : [];
                } else {
                    // 查询流程记录
                    processes = targetUser
                        ? await ProcessModel.getUserProcesses(targetUser.id, true) // 包含历史记录
                        : await ProcessModel.getAllProcesses(false); // 只显示进行中和待处理的记录
                }

                if (!processes || processes.length === 0) {
                    await interaction.editReply({
                        content: queryId
                            ? `❌ 找不到ID为 ${queryId} 的流程记录`
                            : targetUser
                            ? `✅ 用户 ${targetUser.tag} 没有相关流程记录`
                            : '✅ 数据库中没有流程记录',
                        flags: ['Ephemeral'],
                    });
                    return;
                }

                // 获取主服务器配置
                const mainGuildConfig = interaction.client.guildManager.getMainServerConfig();

                // 构建消息链接基础URL（如果可用且议事系统已启用）
                const courtChannelId = mainGuildConfig?.courtSystem?.enabled ? mainGuildConfig.courtSystem.courtChannelId : null;
                const mainGuildId = mainGuildConfig?.id;
                const baseMessageUrl = courtChannelId && mainGuildId
                    ? `https://discord.com/channels/${mainGuildId}/${courtChannelId}/`
                    : '';

                // 分页处理（每页10条记录）
                const pages = [];
                const pageSize = 10;
                for (let i = 0; i < processes.length; i += pageSize) {
                    const pageRecords = processes.slice(i, i + pageSize);
                    const fields = await Promise.all(
                        pageRecords.map(async (p, index) => {
                            const typeText = {
                                appeal: '处罚上诉',
                                vote: '投票',
                                debate: '议案议事',
                                court_mute: '禁言申请',
                                court_ban: '永封申请',
                            };

                            const statusText = {
                                pending: '⚪ 待处理',
                                in_progress: '🟡 进行中',
                                completed: '🟢 已完成',
                                rejected: '🔴 已拒绝',
                                cancelled: '⚫ 已取消',
                            };

                            // 获取执行人和目标用户信息
                            const [executor, target] = await Promise.all([
                                interaction.client.users.fetch(p.executorId).catch(() => null),
                                interaction.client.users.fetch(p.targetId).catch(() => null),
                            ]);

                            // 使用预先构建的baseMessageUrl
                            const messageLink = p.messageId && baseMessageUrl ? `${baseMessageUrl}${p.messageId}` : '';

                            return {
                                name: `${statusText[p.status]} ${typeText[p.type]} (#${i + index + 1})`,
                                value: [
                                    `**执行人:** ${executor ? `<@${executor.id}>` : '未知'}`,
                                    `**目标用户:** ${target ? `<@${target.id}>` : '未知'}`,
                                    `**状态:** ${statusText[p.status]}`,
                                    p.status === 'completed'
                                        ? `**结果:** ${p.result || '无'}\n**原因:** ${p.reason || '无'}`
                                        : `**到期时间:** <t:${Math.floor(p.expireAt / 1000)}:R>`,
                                    p.debateThreadId ? `**辩诉帖:** <#${p.debateThreadId}>` : null,
                                    messageLink ? `**议事消息:** [点击查看](${messageLink})` : null,
                                    `**流程ID:** ${p.id}`,
                                ]
                                    .filter(Boolean)
                                    .join('\n'),
                                inline: false,
                            };
                        }),
                    );

                    pages.push({
                        embeds: [
                            {
                                color: queryId ? 0xe74c3c : 0x0099ff, // ID查询使用红色
                                title: '流程记录查询结果',
                                description: queryId
                                    ? `ID ${queryId} 的流程记录`
                                    : targetUser
                                    ? `用户 ${targetUser.tag} (${targetUser.id}) 的流程记录`
                                    : '全库流程记录',
                                fields,
                                timestamp: new Date(),
                                footer: {
                                    text: `第 ${pages.length + 1} 页 | 共 ${Math.ceil(
                                        processes.length / pageSize,
                                    )} 页 | 总计 ${processes.length} 条记录`,
                                },
                            },
                        ],
                    });
                }

                // 发送第一页
                const addPaginationButtons = page => {
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('page_prev').setLabel('上一页').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('page_next').setLabel('下一页').setStyle(ButtonStyle.Primary),
                    );
                    return { ...page, components: [row] };
                };

                const message = await interaction.editReply(addPaginationButtons(pages[0]));

                // 缓存页面数据（5分钟后自动清除）
                interaction.client.pageCache = interaction.client.pageCache || new Map();
                interaction.client.pageCache.set(message.id, pages);
                setTimeout(() => interaction.client.pageCache.delete(message.id), 5 * 60 * 1000);
            } else if (type === 'vote') {
                // 根据ID精确查询或按条件查询
                let votes;
                if (queryId) {
                    // 通过ID精确查询
                    const vote = await VoteModel.getVoteById(queryId);
                    votes = vote ? [vote] : [];
                } else {
                    // 查询投票记录
                    votes = targetUser
                        ? await VoteModel.getUserVotes(targetUser.id, true) // 包含历史记录
                        : await VoteModel.getAllVotes(false); // 全部记录
                }

                if (!votes || votes.length === 0) {
                    await interaction.editReply({
                        content: queryId
                            ? `❌ 找不到ID为 ${queryId} 的投票记录`
                            : targetUser
                            ? `✅ 用户 ${targetUser.tag} 没有参与任何投票记录`
                            : '✅ 数据库中没有投票记录',
                        flags: ['Ephemeral'],
                    });
                    return;
                }

                // 获取主服务器配置
                const mainGuildConfig = interaction.client.guildManager.getMainServerConfig();

                // 构建消息链接和辩诉帖链接的基础URL（如果议事系统已启用）
                const debateChannelId = mainGuildConfig?.courtSystem?.enabled ? mainGuildConfig.courtSystem.debateChannelId : null;
                const mainGuildId = mainGuildConfig?.id;

                // 如果筛选了特定用户，直接使用传入的targetUser，否则只缓存API查询唯一值
                const userCache = new Map();

                // 如果是查询特定用户
                if (targetUser) {
                    // 将目标用户添加到缓存
                    userCache.set(targetUser.id, targetUser);
                } else {
                    // 只有查询全部记录时才需要获取其他用户信息
                    // 收集所有需要获取的用户ID并去重
                    const userIdsToFetch = new Set();
                    for (const vote of votes) {
                        // 只收集执行人和目标用户，不收集投票人(减少API调用)
                        if (vote.details && vote.details.executorId) {
                            userIdsToFetch.add(vote.details.executorId);
                        }
                        if (vote.details && vote.details.targetId) {
                            userIdsToFetch.add(vote.details.targetId);
                        }
                    }

                    // 一次性获取所有用户信息
                    const fetchedUsers = await Promise.allSettled(
                        Array.from(userIdsToFetch).map(id =>
                            interaction.client.users.fetch(id)
                                .then(user => [id, user])
                                .catch(() => [id, null])
                        )
                    );

                    // 将成功获取的用户存入缓存
                    fetchedUsers.forEach(result => {
                        if (result.status === 'fulfilled' && result.value[1]) {
                            userCache.set(result.value[0], result.value[1]);
                        }
                    });
                }

                // 分页处理（每页10条记录）
                const pages = [];
                const pageSize = 10;
                for (let i = 0; i < votes.length; i += pageSize) {
                    const pageRecords = votes.slice(i, i + pageSize);
                    const fields = pageRecords.map((v, index) => {
                        // 投票类型
                        const typeText = {
                            appeal: '处罚上诉',
                            court_mute: '禁言申请',
                            court_ban: '永封申请',
                        };

                        // 投票状态
                        const statusText = {
                            in_progress: '🟡 进行中',
                            completed: '🟢 已完成',
                        };

                        // 投票结果
                        const resultText = {
                            red_win: '🔴 红方胜利',
                            blue_win: '🔵 蓝方胜利',
                            cancelled: '⚫ 已取消',
                        };

                        // 从缓存中获取执行者和目标用户信息
                        const executorId = v.details?.executorId;
                        const targetId = v.details?.targetId;

                        // 构建消息链接
                        let messageLink = '';
                        if (v.messageId && mainGuildId && v.threadId) {
                            messageLink = `https://discord.com/channels/${mainGuildId}/${v.threadId}/${v.messageId}`;
                        }

                        // 确定投票类型显示文本
                        const displayType = typeText[v.type] || '投票';

                        // 检查是否已到公开票数时间
                        // 只有投票结束后才显示票数（匿名投票）
                        const showVotes = v.status === 'completed';

                        // 基本信息 - 使用<@id>格式确保始终正确显示，同时在可能的情况下显示用户名
                        const voteInfo = [
                            `**红方诉求:** ${v.redSide}`,
                            `**蓝方诉求:** ${v.blueSide}`,
                            executorId ? `**发起人:** <@${executorId}>${userCache.has(executorId) && !targetUser ? ` (${userCache.get(executorId).tag})` : ''}` : null,
                            targetId ? `**目标用户:** <@${targetId}>${userCache.has(targetId) && !targetUser ? ` (${userCache.get(targetId).tag})` : ''}` : null,
                            `**状态:** ${statusText[v.status] || v.status}`,
                            v.status === 'completed' ? `**结果:** ${resultText[v.result] || '无结果'}` : null,
                            // 只有已完成的投票才显示票数（匿名投票）
                            showVotes ? `**红方票数:** ${v.redVoters.length}` : null,
                            showVotes ? `**蓝方票数:** ${v.blueVoters.length}` : null,
                            !showVotes && v.status === 'in_progress' ? `**投票将保持匿名直至结束**` : null,
                            `**开始时间:** <t:${Math.floor(v.startTime / 1000)}:R>`,
                            v.status === 'in_progress'
                                ? `**结束时间:** <t:${Math.floor(v.endTime / 1000)}:R>`
                                : `**完成于:** <t:${Math.floor(v.updatedAt / 1000)}:R>`,
                            v.threadId ? `**辩诉帖:** <#${v.threadId}>` : null,
                            messageLink ? `**投票消息:** [点击查看](${messageLink})` : null,
                            `**投票ID:** ${v.id}`,
                            v.processId ? `**关联流程ID:** ${v.processId}` : null,
                        ].filter(Boolean).join('\n');

                        return {
                            name: `${statusText[v.status] || v.status} ${displayType} (#${i + index + 1})`,
                            value: voteInfo,
                            inline: false,
                        };
                    });

                    pages.push({
                        embeds: [
                            {
                                color: queryId ? 0xe74c3c : 0x5865f2, // ID查询使用红色，否则用Discord蓝
                                title: '投票记录查询结果',
                                description: queryId
                                    ? `ID ${queryId} 的投票记录`
                                    : targetUser
                                    ? `用户 ${targetUser.tag} 参与的投票记录`
                                    : '全库投票记录',
                                fields,
                                timestamp: new Date(),
                                footer: {
                                    text: `第 ${pages.length + 1} 页 | 共 ${Math.ceil(
                                        votes.length / pageSize,
                                    )} 页 | 总计 ${votes.length} 条记录`,
                                },
                            },
                        ],
                    });
                }

                // 发送第一页
                const addPaginationButtons = page => {
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('page_prev').setLabel('上一页').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('page_next').setLabel('下一页').setStyle(ButtonStyle.Primary),
                    );
                    return { ...page, components: [row] };
                };

                const message = await interaction.editReply(addPaginationButtons(pages[0]));

                // 缓存页面数据（5分钟后自动清除）
                interaction.client.pageCache = interaction.client.pageCache || new Map();
                interaction.client.pageCache.set(message.id, pages);
                setTimeout(() => interaction.client.pageCache.delete(message.id), 5 * 60 * 1000);
            }
        } catch (error) {
            await handleCommandError(interaction, error, '查询记录');
        }
    },
};
