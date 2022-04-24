import { strict as assert } from 'assert';
import { SlashCommandBuilder } from '@discordjs/builders';
import { ButtonInteraction, CommandInteraction, InteractionReplyOptions, Message, MessageActionRow, MessageButton } from 'discord.js';
import type { Arena, PlayerId } from '../api';
import { lookupArena } from '../api';
import { Sorry, possessive, sleep } from '../utils';

const NEXT_ROUND_DELAY = 4000;
const MAX_CHARGE = 3;

// damage tiers
const LOW = 2;
const MID = 4;
const HIGH = 10;

export const STARTING_HP = 25;

export interface Duelist {
  id: PlayerId,
  key: string, // redis key
  name: string,
  hp: number,
  charge: number,

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

/// Re-render the duel state display from scratch.
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
      charge: Number(await redis.get(`${key}:charge`)),
      hasChosen: !!await redis.exists(`${key}:action`),
    };
  };
  const defender = await fetchDuelist(defenderKey);
  const challenger = await fetchDuelist(challengerKey);

  const msg = duelMessage(arena, Number(duelId), round, defender, challenger, 'picking');
  // typescript why?
  const reply = <any>await interaction.reply({ fetchReply: true, ...msg });
  cacheDuelMessage(reply, arena, duelId, round);
}

enum Act { AA, AD, DA, DD, AW, DW, WS, WW, SA, SD, SW, SS }

type ActString = keyof typeof Act;

/// Generates current duel round and status in discord data structures.
export function duelMessage(
  arena: Arena,
  duelId: number,
  round: number,
  defender: Duelist,
  challenger: Duelist,
  state: 'picking' | 'resolved' | 'end',
): InteractionReplyOptions {

  const components = [
    new MessageActionRow()
      .addComponents(
        new MessageButton()
          .setCustomId(`${arena}:duel:${duelId}:round:${round}:choose`)
          .setEmoji(state === 'end' ? '💀' : '📝')
          .setStyle('SECONDARY')
          .setDisabled(state !== 'picking')
      )
  ];

  const content = `>>> __Round ${round}__
\`${defender.name}${'🔥'.repeat(defender.charge)} [${defender.hp} HP]\` ${checkmark(defender.hasChosen)}
\`${challenger.name}${'🔥'.repeat(challenger.charge)} [${challenger.hp} HP]\` ${checkmark(challenger.hasChosen)}
`;

  return { content, components };
}

// Shows a private action list to the duelists.
function actionPalette(roundPrefix: string, duelist: Duelist, interaction: ButtonInteraction) {
  const actions: ActionButton[] = [
    {id: 'AA', label: 'attack x2'},
    {id: 'AD', label: 'atk, def'},
    {id: 'DA', label: 'def, atk'},
    {id: 'DD', label: 'defend x2'},
    {id: 'AW', label: 'atk, windup'},
    {id: 'DW', label: 'def, windup'},
    {id: 'WS', label: 'windup, special'},
    {id: 'WW', label: 'windup x2'},
  ];
  if (duelist.charge > 0) {
    actions.push({id: 'SA', label: 'spec, atk'});
    actions.push({id: 'SD', label: 'spec, def'});
    actions.push({id: 'SW', label: 'spec, windup'});
  }
  if (duelist.charge > 1) {
    actions.push({id: 'SS', label: 'special x2'});
  }

  const buttonize = (act: ActionButton) => (
    new MessageButton()
      .setCustomId(`${roundPrefix}:${act.id}`)
      .setLabel(act.label)
      .setStyle(Act[act.id] === duelist.act ? 'PRIMARY' : 'SECONDARY')
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

  const content = 'Choose your next two actions:';
  return { content, components };
}

/// Handles duel button callbacks.
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
    // try one more time
    await sleep(1);
    if (!await redis.setnx(roundLock, playerId)) {
      await interaction.reply({ content: 'Locking bug, please try again.', ephemeral: true });
      return;
    }
  }
  // this is not watertight; if we crash here, we deadlock.
  // later: use a proper lua lock, or maybe WATCH?
  // for now: just hold the lock for a second
  await redis.expire(roundLock, 1);

  const lockState = {taken: true};
  const releaseLock = async () => {
    // this is also race condition-y...
    if (lockState.taken && await redis.get(roundLock) === playerId) {
      lockState.taken = false;
      await redis.del(roundLock);
    }
  };

  let defender: Duelist;
  let challenger: Duelist;
  let story: string[] = [];
  let state: 'picking' | 'resolved' | 'end';
  let player: 'defender' | 'challenger';
  try {
    if (duelId !== Number(await redis.get(activeKey))) {
      throw new Sorry('Duel is already finished.');
    }
    if (round !== Number(await redis.get(roundKey))) {
      await releaseLock();
      try {
        await interaction.update({ content: 'This round is over.', components: [] });
      } catch (e) {
        assert(false, 'That round is over.');
      }
      return;
    }
  
    // check that this player is actually in the battle
    if (playerId === await redis.get(defenderKey)) {
      player = 'defender';
    } else if (playerId === await redis.get(challengerKey)) {
      player = 'challenger';
    } else {
      throw new Sorry('You are not in this duel, sorry!');
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
        charge: Number(await redis.get(`${key}:charge`)),
      };
    };
    defender = await fetchDuelist(defenderKey);
    challenger = await fetchDuelist(challengerKey);
    // end DRY

    // show the action palette on request
    if (act === 'choose') {
      await releaseLock();
      const duelist = player === 'defender' ? defender : challenger;
      const msg = actionPalette(`${arena}:duel:${duelId}:round:${round}`, duelist, interaction);
      await interaction.reply({ ephemeral: true, ...msg });
      return;
    }

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
      const tx = redis.multi();
      tx.del(`${defenderKey}:action`, `${challengerKey}:action`);
      tx.decrby(`${defenderKey}:hp`, outcome.damage.defender);
      tx.decrby(`${challengerKey}:hp`, outcome.damage.challenger);
      tx.set(`${defenderKey}:charge`, outcome.charge.defender);
      tx.set(`${challengerKey}:charge`, outcome.charge.challenger);
      if (state !== 'end') {
        tx.incr(roundKey);
      }
      await tx.exec();

      // game over?
      if (state === 'end') {
        const channel = interaction.channel;
        if (channel) {
          // store result for printing momentarily
          const defHp = Number(await redis.get(`${defenderKey}:hp`));
          const chaHp = Number(await redis.get(`${challengerKey}:hp`));
          let final = `${defender.name} \`[${defHp} HP]\`
${challenger.name} \`[${chaHp} HP]\`

`;
          if (defHp <= 0 && chaHp <= 0) {
            final += '**Draw.**';
          } else if (chaHp <= 0) {
            final += `**${defender.name} is victorious!**`;
          } else if (defHp <= 0) {
            final += `**${challenger.name} is victorious!**`;
          } else {
            final += 'Duel ended mysteriously?';
          }
          // print it soon
          setTimeout(() => channel.send(final), NEXT_ROUND_DELAY / 2);
        }

        // and reset everything
        await redis.del(
          activeKey, roundKey,
          defenderKey, `${defenderKey}:hp`, `${defenderKey}:charge`,
          challengerKey, `${challengerKey}:hp`, `${defenderKey}:charge`,
        );
      }
      // clear checkmarks after battle resolution
      defender.hasChosen = undefined;
      challenger.hasChosen = undefined;
    } else {
      state = 'picking';
    }
  } finally {
    await releaseLock();
  }

  // update the round message
  const msg = duelMessage(arena, duelId, round, defender, challenger, state);
  let cachedMessage = ROUND_MSG_CACHE.get(`${arena}:${duelId}:${round}`);
  if (cachedMessage) {
    await cachedMessage.edit(msg);
  } else if (interaction.channel) {
    // gotta make a new one
    cachedMessage = await interaction.channel.send({ fetchReply: true, ...msg });
    cacheDuelMessage(cachedMessage, arena, duelId, round);
  }

  // acknowledge button press
  try {
    const duelist = player === 'defender' ? defender : challenger;
    const msg = actionPalette(`${arena}:duel:${duelId}:round:${round}`, duelist, interaction);
    await interaction.update(msg);
  } catch (e) {
    console.warn('while trying to update button palette', e);
  }

  // now post the story
  if (story.length) {
    const content = '\n🛡️ COMBAT 🛡️\n' + story.join('\n');
    if (cachedMessage) {
      try {
        await cachedMessage.reply(content);
      } catch (e) {
        console.warn('reply cached story', e);
        await interaction.channel?.send(content);
      }
    } else if (interaction.channel) {
      await interaction.channel.send(content);
    } else {
      console.error(`couldn't post story: ${content}`);
    }
  }

  if (state === 'resolved') {
    await sleep(NEXT_ROUND_DELAY);
    // reset some state for this next round
    defender.act = undefined;
    challenger.act = undefined;
    defender.hasChosen = false;
    challenger.hasChosen = false;
    defender.hp = Number(await redis.get(`${defenderKey}:hp`));
    challenger.hp = Number(await redis.get(`${challengerKey}:hp`));
    defender.charge = Number(await redis.get(`${defenderKey}:charge`));
    challenger.charge = Number(await redis.get(`${challengerKey}:charge`));
    // send it
    const msg = duelMessage(arena, duelId, round + 1, defender, challenger, 'picking');
    let reply;
    if (interaction.channel) {
      reply = await interaction.channel.send({ fetchReply: true, ...msg });
    } else {
      reply = await interaction.followUp({ fetchReply: true, ...msg});
    }
    if (reply instanceof Message) {
      cacheDuelMessage(reply, arena, duelId, round + 1);
    } else {
      console.warn("didn't get message back");
    }
  }
}

interface Outcome {
  damage: { defender: number, challenger: number },
  charge: { defender: number, challenger: number },
  story: string[],
  state: 'resolved' | 'end',
}

function conflict(defender: Duelist, challenger: Duelist): Outcome {
  const story = [];
  let state: 'resolved' | 'end' = 'resolved';
  const damage = { defender: 0, challenger: 0 };
  const defenderAlive = () => (defender.hp - damage.defender) > 0;
  const challengerAlive = () => (challenger.hp - damage.challenger) > 0;

  // we'll use these temporary states while processing both fight steps
  const duo = [
    {
      name: defender.name,
      dmg: 0,
      charge: defender.charge,
      act: defender.act !== undefined ? Act[defender.act] : '..',
    },
    {
      name: challenger.name,
      dmg: 0,
      charge: challenger.charge,
      act: challenger.act !== undefined ? Act[challenger.act] : '..',
    },
  ];

  // let's first sanity check that everyone is alive?
  if (defenderAlive() && challengerAlive()) {
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
          duo[0].charge = 0;
          duo[1].charge = 0;
          break;
        case 'D - D':
          story.push(`${duo[0].name} and ${duo[1].name} both block.`);
          duo[0].charge = 0;
          duo[1].charge = 0;
          break;
        case 'A - D':
          story.push(`${duo[0].name} hits ${possessive(duo[1].name)} shield. \`${duo[1].name} -${LOW} HP\``);
          duo[1].dmg += LOW;
          duo[0].charge = 0;
          duo[1].charge = 0;
          break;
        case 'A - W':
          story.push(`${duo[0].name} hits ${duo[1].name} while they wind up. \`${duo[1].name} -${MID} HP\``);
          duo[0].charge = 0;
          duo[1].dmg += MID;
          duo[1].charge++;
          break;
        case 'D - W':
          story.push(`${duo[0].name} holds up their shield while ${duo[1].name} winds up.`);
          duo[0].charge = 0;
          duo[1].charge++;
          break;
        case 'S - W':
          story.push(`${duo[0].name} performs a special attack on ${duo[1].name} while they wind up. \`${duo[1].name} -${HIGH} HP\``);
          duo[1].dmg += HIGH;
          duo[0].charge--;
          duo[1].charge++;
          break;
        case 'W - W':
          story.push(`${duo[0].name} and ${duo[1].name} are winding up...`);
          duo[0].charge++;
          duo[1].charge++;
          break;
        case 'A - S':
          story.push(`${duo[0].name} hits ${duo[1].name} \`-${MID} HP\``);
          story.push(`while ${duo[1].name} counters with their special attack! \`${duo[0].name} -${HIGH} HP\``);
          duo[0].dmg += HIGH;
          duo[1].dmg += MID;
          duo[0].charge = 0;
          duo[1].charge--;
          break;
        case 'D - S':
          story.push(`${duo[1].name} attacks desperately,`);
          story.push(`but ${duo[0].name} parries and counter-attacks! \`${duo[1].name} -${HIGH} HP\``);
          duo[1].dmg += HIGH;
          duo[0].charge = 0;
          duo[1].charge--;
          break;
        case 'S - S':
          story.push(`${duo[0].name} and ${duo[1].name} perform their specials. \`both -${HIGH} HP\``);
          duo[0].dmg += HIGH;
          duo[1].dmg += HIGH;
          duo[0].charge--;
          duo[1].charge--;
          break;
        default:
          console.error(`conflict: what is '${moves}'?`);
          story.push(`Something unexpected happened, causing psychic damage. \`both -${LOW} HP\``);
          duo[0].dmg += LOW;
          duo[1].dmg += LOW;
          duo[0].charge--;
          duo[1].charge--;
      }
      // clamp charges
      duo[0].charge = Math.max(0, Math.min(duo[0].charge, MAX_CHARGE));
      duo[1].charge = Math.max(0, Math.min(duo[1].charge, MAX_CHARGE));
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
        state = 'end';
        break;
      } else if (i == 0) {
        story.push('... and ...');
      }
    }
  } else {
    state = 'end';
    duo[0].charge = 0;
    duo[1].charge = 0;
  }

  return {
    damage,
    charge: { defender: duo[0].charge, challenger: duo[1].charge },
    story,
    state,
  };
}

// simple cache for the latest `Message` for each round of fighting,
// at least until I figure out where to look up discord messages...
export const ROUND_MSG_CACHE: Map<string, Message> = new Map();
const ROUND_CACHE_EXPIRY = 10 * 60 * 1000;

export function cacheDuelMessage(message: Message, arena: Arena, duelId: number, round: number) {
  if (!(message instanceof Message)) {
    console.error('fetchReply returned something unexpected');
    return;
  }
  // save this message to update it later
  const key = `${arena}:${duelId}:${round}`;
  ROUND_MSG_CACHE.set(key, message);
  // expire it later to avoid leaking memory
  setTimeout(expireDuelMessage.bind(null, key, message.id), ROUND_CACHE_EXPIRY);
}

function expireDuelMessage(key: string, messageId: string) {
  const cached = ROUND_MSG_CACHE.get(key);
  if (cached && cached.id === messageId) {
    ROUND_MSG_CACHE.delete(key);
  }
}

function checkmark(checked: boolean | undefined): string {
  return checked ? '✅' : (checked === false ? '…' : '');
}
