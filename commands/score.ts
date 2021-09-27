import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { Arena, PlayerId, lookupArena } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('score')
    .setDescription('Show all player balances.');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  let scores: Map<PlayerId, bigint> = await fetchScores(arena);

  // highest score first
  const scoreList = Array.from(scores.entries());
  if (!scoreList.length) {
    await interaction.reply({ content: 'No one is playing yet, sorry!', ephemeral: true });
    return;
  }

  scoreList.sort(([idA, scoreA], [idB, scoreB]) => {
    if (scoreB > scoreA) {
      return 1;
    } else if (scoreA > scoreB) {
      return -1;
    } else {
      return Number(idB) - Number(idA); // seniority wins when tied
    }
  });

  const names = await redis.hgetall(`${arena}:names`);
  const scoresWithNames = scoreList.map(([id, score]) => `${names[id] || id}: ${BigInt(score).toLocaleString()}`).join('\n');

  let highScore = await redis.get(`${arena}:high_score`);
  let highName = 'no one';
  const highPlayerId = (await redis.get(`${arena}:high_player_id`));
  if (!highPlayerId) {
    highScore = '(none yet)';
  } else {
    highScore = BigInt(highScore).toLocaleString();
    highName = names[highPlayerId] || `(deleted player #${highPlayerId})`;
  }
  await interaction.reply(`High score: ${highScore} by ${highName}` + '\n```\n' + scoresWithNames + '\n```');
}

async function fetchScores(arena: Arena): Promise<Map<PlayerId, bigint>> {
  const { redis } = global as any;
  const scores = await redis.hgetall(`${arena}:scores`);
  const map = new Map();
  for (let k in scores) {
    map.set(k, BigInt(scores[k]));
  }
  return map;
}

export async function updateHighScore(arena: Arena, playerId: PlayerId, score: BigInt) {
  const { redis } = global as any;
  const highScoreKey = `${arena}:high_score`;
  const existingHighScore = BigInt((await redis.get(highScoreKey)) || '0');
  if (score <= existingHighScore) {
    return;
  }
  const tx = redis.multi();
  tx.set(highScoreKey, score);
  tx.set(`${arena}:high_player_id`, playerId);
  await tx.exec();
}
