import { SlashCommandBuilder } from 'discord.js';
import { messageStatsService } from '../../services/user/messageStatsService.js';
import { handleCommandError } from '../../utils/helper.js';

export default {
    cooldown: 5,
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('发言统计')
        .setDescription('私密查询近 7 天发言统计')
        .addStringOption(option =>
            option
                .setName('用户编号')
                .setDescription('可选：要查询的 Discord 用户编号。不填则查询自己')
                .setRequired(false),
        ),

    async execute(interaction, guildConfig) {
        try {
            await messageStatsService.handleStatsCommand(interaction, guildConfig);
        } catch (error) {
            await handleCommandError(interaction, error, '查询发言统计');
        }
    },
};
