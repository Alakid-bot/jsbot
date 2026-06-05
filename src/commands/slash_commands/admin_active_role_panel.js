import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { activeRoleService } from '../../services/role/activeRoleService.js';
import { checkAndHandlePermission, handleCommandError } from '../../utils/helper.js';
import { logTime } from '../../utils/logger.js';

export default {
    cooldown: 5,
    ephemeral: true,
    data: new SlashCommandBuilder()
        .setName('发送活跃身份组面板')
        .setDescription('发送按近 7 天发言数领取活跃身份组的面板')
        .addChannelOption(option =>
            option
                .setName('频道')
                .setDescription('发送面板的频道，默认当前频道')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread),
        ),

    async execute(interaction, guildConfig) {
        if (!(await checkAndHandlePermission(interaction, guildConfig.AdministratorRoleIds))) {
            return;
        }

        try {
            const targetChannel = interaction.options.getChannel('频道') || interaction.channel;
            const panel = activeRoleService.buildPanel(guildConfig);
            await targetChannel.send(panel);
            await interaction.editReply({ content: `✅ 已在 <#${targetChannel.id}> 发送活跃身份组面板。` });
            logTime(`管理员 ${interaction.user.tag} 在频道 ${targetChannel.name} 创建了活跃身份组面板`);
        } catch (error) {
            await handleCommandError(interaction, error, '发送活跃身份组面板');
        }
    },
};
