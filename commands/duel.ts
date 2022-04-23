import { strict as assert } from 'assert';
import { SlashCommandBuilder } from '@discordjs/builders';
import { ButtonInteraction, CommandInteraction, InteractionReplyOptions, Message, MessageActionRow, MessageButton } from 'discord.js';
import type { Arena, PlayerId } from '../api';
import { lookupArena } from '../api';
import { sleep } from '../utils';

export interface Duelist {
  id: PlayerId,
  key: string, // redis key
  name: string,
  hp: number,
  hasChosen: boolean,
}

interface ActionButton {
  id: string, // customId suffix
  label: string,
}

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('duel')
  .setDescription('Display the current duel.');

export async function execute(interaction: CommandInteraction) {
  const arena = lookupArena(interaction);
  await showCurrentDuel(arena, interaction);
}

export async function showCurrentDuel(arena: Arena, interaction: CommandInteraction) {
  const { redis } = global as any;
  const namesKey = `${arena}:names`;

  // DRY
  const activeKey = `${arena}:duel:active`;
  const roundKey = `${arena}:duel:round`;
  const defenderKey = `${arena}:duel:defender`;
  const challengerKey = `${arena}:duel:challenger`;

  const duelId = await redis.get(activeKey);
  if (duelId === null) {
    await interaction.reply({ content: 'There is no active duel.', ephemeral: true });
    return;
  }

  // load up the state
  const round = Number(await redis.get(roundKey));
  const fetchDuelist = async (key: string) => {
    const id = await redis.get(key);
    return {
      id,
      key,
      name: await redis.hget(namesKey, id),
      hp: Number(await redis.get(`${key}:hp`)),
      hasChosen: !!await redis.exists(`${key}:action`),
    };
  };
  const defender = await fetchDuelist(defenderKey);
  const challenger = await fetchDuelist(challengerKey);

  const msg = duelMessage(arena, Number(duelId), round, defender, challenger);
  await interaction.reply(msg);
}

export function duelMessage(arena: Arena, duelId: number, round: number, defender: Duelist, challenger: Duelist): InteractionReplyOptions {
  const actions: ActionButton[] = [
    {id: 'AA', label: 'attack x2'},
    {id: 'AD', label: 'atk, def'},
    {id: 'DA', label: 'def, atk'},
    {id: 'DD', label: 'defend x2'},
    {id: 'WS', label: 'windup special'},
    {id: 'WW', label: 'windup x2'},
  ];

  const buttonize = (act: ActionButton) => (
    new MessageButton()
      .setCustomId(`${arena}:duel:${duelId}:round:${round}:${act.id}`)
      .setLabel(act.label)
      .setStyle('SECONDARY')
  );

  // arrange buttons into rows
  const components: MessageActionRow[] = [];
  {
    const rowLen = 3;
    let row = new MessageActionRow;
    for (const act of actions) {
      row.addComponents(buttonize(act));
      if (row.components.length >= rowLen) {
        components.push(row);
        row = new MessageActionRow;
      }
    }
    if (row.components.length > 0) {
      components.push(row);
    }
  }

  const status = 'Select your next two moves:';
  const content = `__Round ${round}__
${defender.name}: ${defender.hp} HP ${checkmark(defender.hasChosen)}
${challenger.name}: ${challenger.hp} HP ${checkmark(challenger.hasChosen)}
${status}`;
  return { content, components };
}

export async function chooseAction(arena: Arena, playerId: PlayerId, duelId: number, round: number, act: string, interaction: ButtonInteraction) {
  const { redis } = global as any;
  const namesKey = `${arena}:names`;

  // DRY
  const activeKey = `${arena}:duel:active`;
  const roundKey = `${arena}:duel:round`;
  const defenderKey = `${arena}:duel:defender`;
  const challengerKey = `${arena}:duel:challenger`;

  if (duelId !== Number(await redis.get(activeKey))) {
    await interaction.update({ content: '[expired or finished duel]' });
    return;
  }
  if (round !== Number(await redis.get(roundKey))) {
    await interaction.reply({ content: 'Wrong round error; please /duel and try again?', ephemeral: true });
    return;
  }

  // check that this player is actually in the battle
  let player: 'defender' | 'challenger';
  if (playerId === await redis.get(defenderKey)) {
    player = 'defender';
  } else if (playerId === await redis.get(challengerKey)) {
    player = 'challenger';
  } else {
    await interaction.reply({ content: 'You are not in this duel, sorry!', ephemeral: true });
    return;
  }

  // acquire lock before updating (in case the other player acts at the same time)
  const roundLock = `${arena}:duel:round:${round}:lock`;
  if (!await redis.setnx(roundLock, playerId)) {
    await interaction.deferReply();
    // try one more time
    await sleep(3);
    if (!await redis.setnx(roundLock, playerId)) {
      await interaction.reply({ content: 'Locking bug, please try again.', ephemeral: true });
      return;
    }
  }
  // this is not watertight; if we crash here, we deadlock
  // if we really feel like it, use a proper lua lock, or WATCH, later?
  // anyway for now just hold the lock for a second max
  await redis.expire(roundLock, 1);

  try {
    let defenderAct: string | null;
    let challengerAct: string | null;
    if (player === 'defender') {
      await redis.set(`${defenderKey}:action`, act);
      defenderAct = act;
      challengerAct = await redis.get(`${defenderKey}:action`);
    } else {
      assert(player === 'challenger');
      await redis.set(`${challengerKey}:action`, act);
      challengerAct = act;
      defenderAct = await redis.get(`${defenderKey}:action`);
    }

    if (defenderAct && challengerAct) {
      console.log('resolve', defenderAct, 'vs', challengerAct, 'TODO');
    }
  } finally {
    // release the lock (this is also race condition-y)
    if (await redis.get(roundLock) === playerId) {
      await redis.del(roundLock);
    }
  }

  // DRY
  // load up the rest of the state
  const fetchDuelist = async (key: string) => {
    const id = await redis.get(key);
    return {
      id,
      key,
      name: await redis.hget(namesKey, id),
      hp: Number(await redis.get(`${key}:hp`)),
      hasChosen: key === defenderKey ? !!defenderAct : !!challengerAct,
    };
  };
  const defender = await fetchDuelist(defenderKey);
  const challenger = await fetchDuelist(challengerKey);

  // update the combat message
  const msg = duelMessage(arena, Number(duelId), round, defender, challenger);
  await interaction.update(msg);
}

function checkmark(checked: boolean): string {
  return checked ? '✅' : '…';
}
