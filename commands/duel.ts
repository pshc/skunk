import { strict as assert } from 'assert';
import { ActionRowBuilder, SlashCommandBuilder, strikethrough } from '@discordjs/builders';
import { ButtonInteraction, CommandInteraction, InteractionReplyOptions, Message, MessageActionRow, MessageButton } from 'discord.js';
import type { Arena, PlayerId } from '../api';
import { lookupArena } from '../api';
import { possessive, sleep } from '../utils';

const NEXT_ROUND_DELAY = 4000;

export interface Duelist {
  id: PlayerId,
  key: string, // redis key
  name: string,
  hp: number,

  // unsure if these belong in duelist state proper?
  hasChosen?: boolean,
  act?: Act,
}

interface ActionButton {
  id: ActString, // customId suffix
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
    let content = 'Please use /squareup to start a new duel.';
    if (await redis.exists(defenderKey) && await redis.exists(challengerKey)) {
      content = 'The duel is starting...';
    }
    await interaction.reply({ content, ephemeral: true });
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

  const msg = duelMessage(arena, Number(duelId), round, defender, challenger, 'picking', []);
  await interaction.reply(msg);
}

enum Act { AA, AD, DA, DD, /*AW, DW,*/ WS, /*WW*/ }

type ActString = keyof typeof Act;

export function duelMessage(
  arena: Arena,
  duelId: number,
  round: number,
  defender: Duelist,
  challenger: Duelist,
  state: 'picking' | 'resolved' | 'end',
  story: string[],
): InteractionReplyOptions {

  let actions: ActionButton[] = [];

  if (state === 'picking') {
    actions = [
      {id: 'AA', label: 'attack x2'},
      {id: 'AD', label: 'atk, def'},
      {id: 'DA', label: 'def, atk'},
      {id: 'DD', label: 'defend x2'},
      //{id: 'AW', label: 'atk, windup'},
      //{id: 'DW', label: 'def, windup'},
      {id: 'WS', label: 'windup, special'},
      //{id: 'WW', label: 'windup x2'},
    ];
  }

  const buttonize = (act: ActionButton) => (
    new MessageButton()
      .setCustomId(`${arena}:duel:${duelId}:round:${round}:${act.id}`)
      .setLabel(act.label)
      .setStyle('SECONDARY')
  );

  // arrange buttons into rows
  const components: MessageActionRow[] = [];
  if (actions.length) {
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

  const content = `>>> __Round ${round}__
\`${defender.name} [${defender.hp} HP]\` ${checkmark(defender.hasChosen)}
\`${challenger.name} [${challenger.hp} HP]\` ${checkmark(challenger.hasChosen)}

${story.length ? story.join('\n') : 'Select your next two moves:'}`;

  return { content, components };
}

export async function chooseAction(
  arena: Arena,
  playerId: PlayerId,
  duelId: number,
  round: number,
  act: string,
  interaction: ButtonInteraction,
) {
  const { redis } = global as any;
  const namesKey = `${arena}:names`;

  // DRY
  const activeKey = `${arena}:duel:active`;
  const roundKey = `${arena}:duel:round`;
  const defenderKey = `${arena}:duel:defender`;
  const challengerKey = `${arena}:duel:challenger`;

  // acquire lock before accessing state (in case the other player acts at the same time)
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
  // this is not watertight; if we crash here, we deadlock.
  // later: use a proper lua lock, or maybe WATCH?
  // for now: just hold the lock for a second
  await redis.expire(roundLock, 1);

  let defender: Duelist;
  let challenger: Duelist;
  let story: string[] = [];
  let state: 'picking' | 'resolved' | 'end';
  try {
    if (duelId !== Number(await redis.get(activeKey))) {
      await interaction.reply({ content: 'Duel is already finished.', ephemeral: true });
      return;
    }
    if (round !== Number(await redis.get(roundKey))) {
      await interaction.reply({ content: 'That round is over.', ephemeral: true });
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

    // DRY
    // load up the rest of the duelists' state
    const fetchDuelist = async (key: string) => {
      const id = await redis.get(key);
      return {
        id,
        key,
        name: await redis.hget(namesKey, id),
        hp: Number(await redis.get(`${key}:hp`)),
      };
    };
    defender = await fetchDuelist(defenderKey);
    challenger = await fetchDuelist(challengerKey);
    // end DRY

    if (player === 'defender') {
      // validate the action enum str
      // TODO check if defender may do this right now
      defender.act = (<any>Act)[act];
      assert(act in Act, `invalid act: ${JSON.stringify(act)} -> ${defender.act}`);
      defender.hasChosen = true;
      // store defender's action and retrieve challenger's
      await redis.set(`${defenderKey}:action`, act);
      challenger.act = (<any>Act)[await redis.get(`${challengerKey}:action`)];
      challenger.hasChosen = challenger.act !== undefined;
    } else {
      assert(player === 'challenger');
      // store challenger's action
      // TODO check if challenger may actually perform this right now
      challenger.act = (<any>Act)[act];
      assert(act in Act, `invalid act: ${JSON.stringify(act)} -> ${challenger.act}`);
      challenger.hasChosen = true;
      await redis.set(`${challengerKey}:action`, act);
      // retrieve defender's action
      defender.act = (<any>Act)[await redis.get(`${defenderKey}:action`)];
      defender.hasChosen = defender.act !== undefined;
    }

    if (defender.hasChosen && challenger.hasChosen) {
      // play out the round
      const outcome = conflict(defender, challenger);
      story = outcome.story;
      state = outcome.state;
      // apply damage and set up for next round if necessary
      const tx = redis.multi()
        .decrby(`${defenderKey}:hp`, outcome.damage.defender)
        .decrby(`${challengerKey}:hp`, outcome.damage.challenger)
        .del(`${defenderKey}:action`)
        .del(`${challengerKey}:action`);
      if (state !== 'end') {
        tx.incr(roundKey);
      }
      await tx.exec();
      // clear checkmarks after battle resolution
      defender.hasChosen = undefined;
      challenger.hasChosen = undefined;
    } else {
      story.push('Select your next two moves:');
      state = 'picking';
    }

  } finally {
    // release the lock (this is also race condition-y)
    if (await redis.get(roundLock) === playerId) {
      await redis.del(roundLock);
    }
  }

  // update the combat message
  const msg = duelMessage(arena, duelId, round, defender, challenger, state, story);
  await interaction.update(msg);

  // todo check win condition

  if (state === 'resolved') {
    await sleep(NEXT_ROUND_DELAY);
    // reset some state for this next round
    defender.act = undefined;
    challenger.act = undefined;
    defender.hasChosen = false;
    challenger.hasChosen = false;
    defender.hp = Number(await redis.get(`${defenderKey}:hp`));
    challenger.hp = Number(await redis.get(`${challengerKey}:hp`));
    // send it
    const msg = duelMessage(arena, duelId, round + 1, defender, challenger, 'picking', []);
    if (interaction.channel) {
      await interaction.channel.send(msg);
    } else {
      await interaction.followUp(msg);
    }
  } else if (state === 'end') {
    // reset everything
    await redis.del(
      activeKey, roundKey,
      defenderKey, `${defenderKey}:hp`, `${defenderKey}:action`,
      challengerKey, `${challengerKey}:hp`, `${challengerKey}:action`,
    );
  }
}

interface Outcome {
  damage: { defender: number, challenger: number },
  story: string[],
  state: 'resolved' | 'end',
}

const HIGH = 9;
const MID = 3;
const LOW = 1;

function conflict(defender: Duelist, challenger: Duelist): Outcome {
  const story = [];
  let state: 'resolved' | 'end' = 'resolved';
  const damage = { defender: 0, challenger: 0 };
  const defenderAlive = () => (defender.hp - damage.defender) > 0;
  const challengerAlive = () => (challenger.hp - damage.challenger) > 0;
  // let's first sanity check that everyone is alive?
  if (defenderAlive() && challengerAlive()) {
    const duo = [
      {name: defender.name, dmg: 0, act: defender.act !== undefined ? Act[defender.act] : '..'},
      {name: challenger.name, dmg: 0, act: challenger.act !== undefined ? Act[challenger.act] : '..'},
    ];
    // break down the moves
    for (let i = 0; i < 2; i++) {
      // to reduce case analysis, swap actions to be alphabetical
      const swapped = duo[0].act[i] > duo[1].act[i];
      if (swapped) {
        const s = duo.shift();
        assert(s);
        duo.push(s);
      }
      const moves = `${duo[0].act[i]} - ${duo[1].act[i]}`;
      switch (moves) {
        case 'A - A':
          story.push(`${duo[0].name} and ${duo[1].name} attack simultaneously. \`both -${MID} HP\``);
          duo[0].dmg += MID;
          duo[1].dmg += MID;
          break;
        case 'D - D':
          story.push(`${duo[0].name} and ${duo[1].name} both block.`);
          break;
        case 'A - D':
          story.push(`${duo[0].name} hits ${possessive(duo[1].name)} shield. \`${duo[1].name} -${LOW} HP\``);
          duo[1].dmg += LOW;
          break;
        case 'A - W':
          story.push(`${duo[0].name} hits ${duo[1].name} while they wind up. \`${duo[1].name} -${MID} HP\``);
          duo[1].dmg += MID;
          break;
        case 'D - W':
          story.push(`${duo[0].name} holds up their shield while ${duo[1].name} winds up.`);
          break;
        case 'W - W':
          story.push(`${duo[0].name} and ${duo[1].name} are winding up...`);
          break;
        case 'A - S':
          story.push(`${duo[0].name} hits ${duo[1].name} \`-${MID} HP\``);
          story.push(`while ${duo[1].name} counters with their special attack! \`${duo[0].name} -${HIGH} HP\``);
          duo[0].dmg += HIGH;
          duo[1].dmg += MID;
          break;
        case 'D - S':
          story.push(`${duo[1].name} attacks desperately,`);
          story.push(`but ${duo[0].name} parries and counter-attacks! \`${duo[1].name} -${HIGH} HP\``);
          duo[1].dmg += HIGH;
          break;
        case 'S - S':
          story.push(`${duo[0].name} and ${duo[1].name} perform their specials. \`both -${HIGH} HP\``);
          duo[0].dmg += HIGH;
          duo[1].dmg += HIGH;
          break;
        default:
          console.error(`conflict: what is '${moves}'?`);
          story.push(`Something unexpected happened, causing psychic damage. \`both -${LOW} HP\``);
          duo[0].dmg += LOW;
          duo[1].dmg += LOW;
      }
      // now swap back if necessary
      if (swapped) {
        const s = duo.shift();
        assert(s);
        duo.push(s);
      }
      damage.defender = duo[0].dmg;
      damage.challenger = duo[1].dmg;
      // anyone go to 0 HP?
      if (!defenderAlive() || !challengerAlive()) {
        story.push('');
        if (defenderAlive()) {
          story.push(`**${defender.name} is victorious!**`);
        } else if (challengerAlive()) {
          story.push(`**${challenger.name} is victorious!**`);
        } else {
          story.push('**Draw.**');
        }
        state = 'end';
        break;
      }
      if (i == 0) {
        story.push('... and ...');
      }
    }
  } else {
    state = 'end';
    if (defenderAlive()) {
      story.push(`**${defender.name} survives.**`);
    } else if (challengerAlive()) {
      story.push(`**${challenger.name} survives.**`);
    } else {
      story.push('**No survivors.**');
    }
  }

  return {
    damage,
    story,
    state,
  };
}

function checkmark(checked: boolean | undefined): string {
  return checked ? '✅' : (checked === false ? '…' : '');
}
