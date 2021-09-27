import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';
import { sanifyName } from './jointhegame';

const INITIAL_PRICE = BigInt(1000);

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Trade your points for goods!');

data.addStringOption(option =>
  option.setName('item')
    .setDescription('What would you like?')
    .addChoice('dog', 'dog')
    .addChoice('cat', 'cat')
    .setRequired(true)
);

data.addStringOption(option =>
  option.setName('name')
    .setDescription('Give your purchase a name.')
    .setRequired(true)
);

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);

  // parse input
  const { options } = interaction;
  const itemType = options.getString('item');
  const itemName = sanifyName(options.getString('name'));
  if (!itemName) {
    await interaction.reply({ content: 'Please provide a valid name.', ephemeral: true });
    return;
  }

  // exponential pricing based on existing inventory size
  const inventory = `${arena}:inventory:${playerId}`;
  const itemCount = BigInt(await redis.scard(inventory));
  const price = INITIAL_PRICE * (BigInt(2) ** itemCount);
  const scoresKey = `${arena}:scores`;
  const oldScore = BigInt(await redis.hget(scoresKey, playerId));
  if (oldScore < price) {
    await interaction.reply({ content: `Price is ${price.toLocaleString()} but you only have ${oldScore.toLocaleString()}, sorry!`, ephemeral: true });
    return;
  }
  const newScore = oldScore - price;

  // prevent buy spam
  const cooldownKey = `${arena}:buy_cooldown:${playerId}`;
  const didSet = await redis.set(cooldownKey, '1', 'NX', 'EX', '5');
  if (didSet !== 'OK') {
    const ttl = await redis.ttl(cooldownKey);
    await interaction.reply({ content: `The market is too hot! ${ttl}sec left.`, ephemeral: true });
    return;
  }

  // okay, generate the new item
  const a = randomInt(6);
  const b = randomInt(6);
  const strength = a + b + 6;

  const itemId = await redis.incr(`${arena}:item_count`);
  const tx = redis.multi();
  tx.sadd(inventory, itemId);
  tx.set(`${arena}:item:${itemId}:name`, itemName);
  tx.set(`${arena}:item:${itemId}:type`, itemType);
  tx.hset(`${arena}:item:${itemId}:stats`, 'STR', strength);
  tx.hset(scoresKey, playerId, newScore); // pay for it
  await tx.exec();
  await interaction.reply(`Bought a ${itemType} named "${itemName}" with STR ${strength} for ${price.toLocaleString()} points.`);
}
