import { describe, expect, test } from '@jest/globals';
import { join } from 'node:path';
import {
    alwaysEnabledCommandNames,
    filterCommandsForGuild,
    getCommandInventory,
    getEnabledCommandData,
    getUnknownEnabledCommands,
    isCommandEnabled,
    summarizeCommandSelection,
} from '../utils/commandInventory.js';
import { loadCommandFiles } from '../utils/helper.js';

const commandsPath = join(process.cwd(), 'src', 'commands');
const removedCommandNames = ['ask', 'reload-kb', 'status'];
const englishOnlyName = /^[a-z0-9_-]+$/;

function collectOptionNames(options = []) {
    return options.flatMap(option => [option.name, ...collectOptionNames(option.options)]);
}

describe('Discord command inventory', () => {
    test('does not load removed app commands', async () => {
        const commands = await loadCommandFiles(commandsPath);

        expect([...commands.keys()]).not.toEqual(expect.arrayContaining(removedCommandNames));
    });

    test('keeps visible command and option names in Chinese', async () => {
        const commands = await loadCommandFiles(commandsPath);
        const commandData = [...commands.values()].map(command => command.data.toJSON());
        const commandNames = commandData.map(command => command.name);
        const optionNames = commandData.flatMap(command => collectOptionNames(command.options));

        expect(commandNames.filter(name => englishOnlyName.test(name))).toEqual([]);
        expect(optionNames.filter(name => englishOnlyName.test(name))).toEqual([]);
    });

    test('serializes every loaded command with unique names', async () => {
        const commands = await loadCommandFiles(commandsPath);
        const commandData = [...commands.values()].map(command => command.data.toJSON());
        const commandNames = commandData.map(command => command.name);

        expect(new Set(commandNames).size).toBe(commandNames.length);
        expect(commandData).toHaveLength(commands.size);
    });

    test('treats missing enabledCommands as all commands enabled', async () => {
        const commands = await loadCommandFiles(commandsPath);
        const filtered = filterCommandsForGuild(commands, {});

        expect(filtered.size).toBe(commands.size);
        expect(getEnabledCommandData(commands, {})).toHaveLength(commands.size);
        expect(isCommandEnabled({}, [...commands.keys()][0])).toBe(true);
    });

    test('filters registration data to configured command names only', async () => {
        const commands = await loadCommandFiles(commandsPath);
        const [firstCommandName, secondCommandName] = [...commands.keys()].filter(name => !alwaysEnabledCommandNames.has(name));
        const guildConfig = { enabledCommands: [firstCommandName, '不存在的指令'] };
        const filtered = filterCommandsForGuild(commands, guildConfig);
        const enabledData = getEnabledCommandData(commands, guildConfig);
        const expectedNames = [
            firstCommandName,
            ...[...alwaysEnabledCommandNames].filter(name => commands.has(name)),
        ];

        expect(filtered.size).toBe(expectedNames.length);
        expect(filtered.has(firstCommandName)).toBe(true);
        expect(filtered.has(secondCommandName)).toBe(false);
        expect(enabledData.map(command => command.name)).toEqual(expect.arrayContaining(expectedNames));
        expect(isCommandEnabled(guildConfig, firstCommandName)).toBe(true);
        expect(isCommandEnabled(guildConfig, secondCommandName)).toBe(false);
        for (const commandName of alwaysEnabledCommandNames) {
            expect(isCommandEnabled({ enabledCommands: [] }, commandName)).toBe(true);
        }
    });

    test('reports unknown enabled command names without registering them', async () => {
        const commands = await loadCommandFiles(commandsPath);
        const [knownCommandName] = [...commands.keys()];
        const guildConfig = { enabledCommands: ['不存在的指令', knownCommandName] };
        const summary = summarizeCommandSelection(commands, guildConfig);

        expect(getUnknownEnabledCommands(commands, guildConfig)).toEqual(['不存在的指令']);
        expect(summary.mode).toBe('selected');
        expect(summary.enabledCommandCount).toBe(
            1 + [...alwaysEnabledCommandNames].filter(name => commands.has(name)).length,
        );
        expect(summary.totalCommandCount).toBe(commands.size);
        expect(summary.unknownEnabledCommands).toEqual(['不存在的指令']);
    });

    test('builds sorted serializable command inventory', async () => {
        const commands = await loadCommandFiles(commandsPath);
        const inventory = getCommandInventory(commands);
        const names = inventory.map(command => command.name);

        expect(inventory).toHaveLength(commands.size);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
        expect(inventory[0]).toEqual(expect.objectContaining({
            name: expect.any(String),
            description: expect.any(String),
            type: expect.any(Number),
        }));
    });
});
