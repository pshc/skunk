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
  scoreList.sort(([idA, scoreA], [idB, scoreB]) => {
    if (scoreB > scoreA) {
      return -1;
    } else if (scoreA > scoreB) {
      return 1;
    } else {
      return Number(idB) - Number(idA); // seniority wins when tied
    }
  });

  const names = await redis.hgetall(`${arena}:names`);
  const scoresWithNames = scoreList.map(([id, score]) => `${names[id] || id}: ${score}`);

  if (scoreList.length > 0) {
    await interaction.reply('Score:\n```\n' + scoresWithNames + '\n```');
  } else {
    await interaction.reply({ content: 'No one is playing yet, sorry!', ephemeral: true });
  }
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
