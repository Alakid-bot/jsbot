import { jest, describe, expect, test, beforeEach } from '@jest/globals';

const addToQueue = jest.fn();
const checkCooldown = jest.fn();

jest.unstable_mockModule('../utils/concurrency.js', () => ({
    globalRequestQueue: {
        add: addToQueue,
    },
}));

jest.unstable_mockModule('../utils/cooldownManager.js', () => ({
    globalCooldownManager: {
        checkCooldown,
    },
}));

const { handleCommand } = await import('../handlers/commands.js');

function createInteraction(guildConfig, commandName = '测试指令') {
    const command = {
        cooldown: 5,
        data: { name: commandName },
        execute: jest.fn(),
        shouldDefer: false,
    };
    const reply = jest.fn();

    return {
        command,
        interaction: {
            commandName,
            guildId: '123456789012345678',
            user: { tag: 'tester' },
            channel: { id: 'channel-id', name: 'channel-name' },
            client: {
                commands: new Map([[commandName, command]]),
                guildManager: {
                    getGuildConfig: jest.fn(() => guildConfig),
                },
            },
            reply,
        },
        reply,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    checkCooldown.mockResolvedValue({ inCooldown: false });
    addToQueue.mockImplementation(async task => task());
});

describe('handleCommand enabledCommands guard', () => {
    test('blocks disabled stale commands before cooldown and queue', async () => {
        const { command, interaction, reply } = createInteraction({ enabledCommands: [] });

        await handleCommand(interaction);

        expect(reply).toHaveBeenCalledWith({
            content: '此指令已在当前服务器禁用，请联系管理员重新同步指令。',
            flags: ['Ephemeral'],
        });
        expect(checkCooldown).not.toHaveBeenCalled();
        expect(addToQueue).not.toHaveBeenCalled();
        expect(command.execute).not.toHaveBeenCalled();
    });

    test('keeps legacy configs without enabledCommands fully enabled', async () => {
        const { command, interaction } = createInteraction({});

        await handleCommand(interaction);

        expect(checkCooldown).toHaveBeenCalledTimes(1);
        expect(addToQueue).toHaveBeenCalledTimes(1);
        expect(command.execute).toHaveBeenCalledTimes(1);
    });

    test('allows sync command even when command selection is empty', async () => {
        const { command, interaction } = createInteraction({ enabledCommands: [] }, '同步指令');

        await handleCommand(interaction);

        expect(checkCooldown).toHaveBeenCalledTimes(1);
        expect(addToQueue).toHaveBeenCalledTimes(1);
        expect(command.execute).toHaveBeenCalledTimes(1);
    });
});
