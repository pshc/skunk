// dispatches button events back to our command handlers

import { strict as assert } from 'assert';
import { ButtonInteraction } from 'discord.js';
import { squareUp } from './commands/squareup';
import { chooseAction } from './commands/duel';
import { lookupPlayerId } from './api';
import { Sorry } from './utils';

export async function handleButton(interaction: ButtonInteraction) {
  try {
    await dispatch(interaction);
  } catch (error: any) {
    if (!(error instanceof Sorry)) {
      console.error(error);
    }
    const content = (error && error.message) || 'Oops, something went wrong!';
    await interaction.reply({ content, ephemeral: true });
  }
}

async function dispatch(interaction: ButtonInteraction) {
  // parse the customId we assigned to this button
  const { customId, component } = interaction;
  const match = /^(arena:\d+):(.+)$/.exec(customId);
  assert(match, "bad customId");
  const arena = match[1];
  const payload = match[2]; // the part after the arena
  const playerId = await lookupPlayerId(arena, interaction);

  // look up the appropriate handler
  if (payload.startsWith('challenge:')) {
    // player clicked :swords: on a challenge, parse it
    const match = /^challenge:(\d+)$/.exec(payload);
    assert(match, 'bad duel id');
    const duelId = Number(match[1]);
    await squareUp(arena, playerId, duelId, interaction);

  } else if (payload.startsWith('duel:')) {
    // player clicked an action in a duel
    const match = /^duel:(\d+):round:(\d+):(.+)$/.exec(payload);
    assert(match, 'bad duel');
    const duelId = Number(match[1]);
    const round = Number(match[2]);
    const act = match[3];
    await chooseAction(arena, playerId, duelId, round, act, interaction);

  } else {
    console.error(`unknown button customId: ${customId}`);
  }
}
