import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';
import { reload } from './reload';
import { updateHighScore } from './score';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Either double your points or lose them all!');

const MISS = [
  "😅", "🙃", "😉", "😘", "😍", "😊", "😜", "😝",
  "😏", "😒", "😌", "😔", "😷", "😎",
  "😥", "😤", "😠", "💩",
];
const SCHUT = ["😵💥🔫", "💀💥🔫", "💥🔫", "💥💥", "💥🔫💥"];

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);

  // prevent spam
  const cooldownKey = `${arena}:roulette_cooldown:${playerId}`;
  const didSet = await redis.set(cooldownKey, '1', 'NX', 'EX', '3');
  if (didSet !== 'OK') {
    const ttl = await redis.ttl(cooldownKey);
    await interaction.reply({ content: `The revolver is hot! ${ttl}sec left.`, ephemeral: true });
    return;
  }

  const revolver = `${arena}:revolver`;

  // make sure there is a bullet in the chamber
  if (!await redis.exists(revolver)) {
    await reload(revolver);
    await interaction.reply(`You load and spin the revolver.`);
    return;
  }

  // schut
  const blanksLeft = await redis.decr(revolver);
  if (Number(blanksLeft) < 0) {
    // RIP
    await reload(revolver);
    await redis.hset(`${arena}:scores`, playerId, '100');
    await interaction.reply(SCHUT[randomInt(SCHUT.length)]);
    // put 'em on death cooldown
    await redis.set(cooldownKey, '1', 'EX', '20');
    // cancel cooldowns for everyone else
    const tx = redis.multi();
    for (const id in await redis.hkeys(`${arena}:names`)) {
      if (id != playerId) {
        tx.del(`${arena}:roulette_cooldown:${id}`);
      }
    }
    await tx.exec();
  } else {
    // multiply your money
    let multiplier = Number(await redis.incr(revolver + '_multiplier'));
    if (multiplier > 5) {
        multiplier = 10;
    }
    const oldScore = BigInt(await redis.hget(`${arena}:scores`, playerId));
    const newScore = oldScore * BigInt(multiplier);
    await redis.hset(`${arena}:scores`, playerId, newScore.toString());
    const face = MISS[randomInt(MISS.length)];
    await updateHighScore(arena, playerId, newScore);
    await interaction.reply(`${face}🔫 score ${multiplier}x to ${newScore.toLocaleString()}`);
  }
}
