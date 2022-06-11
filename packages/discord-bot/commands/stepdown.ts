import { SlashCommandBuilder } from '@discordjs/builders';
import { CommandInteraction } from 'discord.js';
import type { Arena, PlayerId } from '../api';
import { lookupArena, lookupPlayerId } from '../api';
import { redis } from '#burrow/db';
import { chooseOne } from '#burrow/utils';
import { CHALLENGE_MSG_CACHE, makeChallengeButtons } from './squareup';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('stepdown')
  .setDescription('Flee from the incoming duel.');

export async function execute(interaction: CommandInteraction) {
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);
  await stepDown(arena, playerId, interaction);
}

export async function stepDown(arena: Arena, playerId: PlayerId, interaction: CommandInteraction) {
  // DRY with squareup
  const namesKey = `${arena}:names`;
  const name = (await redis.hget(namesKey, playerId)) || '???';

  const duelCountKey = `${arena}:duel:count`
  const activeKey = `${arena}:duel:active`;
  const defenderKey = `${arena}:duel:defender`;
  const challengerKey = `${arena}:duel:challenger`;

  if (await redis.get(activeKey)) {
    await interaction.reply({ content: 'Sorry, a duel is already active.', ephemeral: true });
    return;
  }
  // end DRY

  const [defenderId, challengerId] = await Promise.all([redis.get(defenderKey), redis.get(challengerKey)]);
  const left = chooseOne(['stepped down', 'backed away', 'pulled out', 'abandoned the fight']);
  let content;

  if (playerId === defenderId) {
    await redis.del(defenderKey);
    // if you flee a challenger, they become the new defender
    if (challengerId) {
      await redis.renamenx(challengerKey, defenderKey);
      const newDefenderName = (await redis.hget(namesKey, challengerId)) || '???';
      content = `${name} has fled from ${newDefenderName}.`;
    } else {
      content = `${name} has ${left}.`;
    }
  } else if (playerId === challengerId) {
    await redis.del(challengerKey);
    content = `${name} has ${left}.`;
  } else {
    await interaction.reply({ content: "You aren't squared up yet.", ephemeral: true });
    return;
  }

  // update the challenge message accordingly
  if (content) {
    const nextDuel = Number(await redis.get(duelCountKey));
    const challengeMessage = CHALLENGE_MSG_CACHE.get(nextDuel);
    if (challengeMessage) {
      await interaction.deferReply({ ephemeral: true });
      // enable the fight button again
      const components = makeChallengeButtons(arena, nextDuel, 'idle');
      await challengeMessage.edit({ content, components });
      await interaction.editReply("You stepped down.");
    } else {
      await interaction.reply({ content }); // fallback
    }
  }
}
