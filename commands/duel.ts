import { strict as assert } from 'assert';
import { SlashCommandBuilder } from '@discordjs/builders';
import { ButtonInteraction, CommandInteraction, InteractionReplyOptions, Message, MessageActionRow, MessageButton } from 'discord.js';
import type { Arena, PlayerId } from '../api';
import { lookupArena } from '../api';
import { Sorry, possessive, sleep } from '../utils';

const NEXT_ROUND_DELAY = 4000;
const MAX_CHARGE = 3;
const TURNS_PER_ROUND = 2;

// damage tiers
const LOW = 2;
const MID = 4;
const HIGH = 10;

export const STARTING_HP = 25;

type Act = 'A' | 'D' | 'S' | 'W';
const ACT_DOT_STR = 'ADSW.';

export interface Duelist {
  id: PlayerId,
  key: string, // redis key
  name: string,
  hp: number,
  charge: number,

  // unsure if these belong in duelist state proper?
  acts: (Act | '.')[],
  hasChosen?: boolean,
}

interface ActionButton {
  id: Act, // customId suffix
  emoji: string,
  enabled?: boolean,
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

  // load up the state (but don't expose the selections)
  const round = Number(await redis.get(roundKey));
  const fetchDuelist = async (key: string) => {
    const id = await redis.get(key);
    const acts = await redis.get(`${key}:action`) || emptySelections();
    const hasChosen = !acts.includes('.');
    return {
      id,
      key,
      name: await redis.hget(namesKey, id),
      hp: Number(await redis.get(`${key}:hp`)),
      charge: Number(await redis.get(`${key}:charge`)),
      hasChosen,
      acts: emptySelections(), // these are secret, after all
    };
  };
  const defender = await fetchDuelist(defenderKey);
  const challenger = await fetchDuelist(challengerKey);

  const msg = duelMessage(arena, Number(duelId), round, defender, challenger, 'picking');
  // typescript why?
  const reply = <any>await interaction.reply({ fetchReply: true, ...msg });
  cacheDuelMessage(reply, arena, duelId, round);
}

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

export const emptySelections = () => Array(TURNS_PER_ROUND).fill('.');

// Shows a private action list to the duelists.
function actionPalette(arena: Arena, duelId: number, round: number, duelist: Duelist) {
  const selections = duelist.acts;
  assert(selections.length === TURNS_PER_ROUND);
  const components: MessageActionRow[] = [];

  // build up the customId for each button
  let roundPrefix = `${arena}:duel:${duelId}:round:${round}:`;

  // simulation state
  let reachedThisTurn = true;
  let { charge } = duelist;

  // one row of emoji per turn
  for (let turn = 0; turn < TURNS_PER_ROUND; turn++) {
    const picked = selections[turn];
    const buttonize = (act: ActionButton) => (
      new MessageButton()
        .setCustomId(`${roundPrefix}${act.id}` + '.'.repeat(TURNS_PER_ROUND - turn - 1))
        .setEmoji(act.emoji)
        .setStyle(act.id === picked ? 'PRIMARY' : 'SECONDARY')
        .setDisabled(!reachedThisTurn || act.enabled === false)
    );
    const actions: ActionButton[] = [
      {id: 'A', emoji: '🗡️'},
      {id: 'D', emoji: '🛡️'},
      {id: 'W', emoji: '🔥'},
      {id: 'S', emoji: '☄️', enabled: charge > 0},
    ];
    const row = new MessageActionRow().addComponents(... actions.map(buttonize));
    components.push(row);

    // simulate to determine which buttons are enabled in the next row
    if (picked === 'W') {
      charge = Math.min(charge + 1, MAX_CHARGE);
    } else {
      charge = 0;
    }
    if (picked === '.') {
      reachedThisTurn = false;
    }
    roundPrefix += picked;
  }

  const content = `Choose your next ${TURNS_PER_ROUND} actions:`;
  return { content, components };
}

/// Parse and validate a string of actions into an array e.g. 'A.' -> ['A', '.']
function parseActs(str: string, duelist?: Duelist): (Act | '.')[] {
  assert(str.length === TURNS_PER_ROUND, 'wrong number of actions');
  const parsed: (Act | '.')[] = [];

  // simulate to validate incoming choices
  let charge = duelist?.charge || 0;
  let stillSelecting = true;

  for (let i = 0; i < TURNS_PER_ROUND; i++) {
    const c = str[i];
    assert(ACT_DOT_STR.includes(c), `invalid act ${c}`);
    assert(stillSelecting || c === '.', "cannot select ahead of time");

    // validate game logic if a duelist was provided
    if (duelist) {
      // DRY-ish with above
      if (c === 'W') {
        charge = Math.min(charge + 1, MAX_CHARGE);
      } else if (c === 'S') {
        assert(charge > 0, 'no charge for special');
        charge = 0;
      } else {
        charge = 0;
      }
    }
    // ensure turns are picked in order
    if (c === '.') {
      stillSelecting = false;
    }

    parsed.push(c as any);
  }
  return parsed;
}

/// Handles duel button callbacks.
export async function chooseAction(
  arena: Arena,
  playerId: PlayerId,
  duelId: number,
  round: number,
  chosenActs: string,
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

    // load up the rest of the duelists' state
    const fetchDuelist = async (key: string) => {
      const id = await redis.get(key);
      const acts = await redis.get(`${key}:action`);
      return {
        id,
        key,
        name: await redis.hget(namesKey, id),
        hp: Number(await redis.get(`${key}:hp`)),
        charge: Number(await redis.get(`${key}:charge`)),
        acts: acts ? parseActs(acts) : emptySelections(),
      };
    };
    defender = await fetchDuelist(defenderKey);
    challenger = await fetchDuelist(challengerKey);

    // show the action palette on request
    if (chosenActs === 'choose') {
      await releaseLock();
      const duelist = player === 'defender' ? defender : challenger;
      const msg = actionPalette(arena, duelId, round, duelist);
      await interaction.reply({ ephemeral: true, ...msg });
      return;
    }

    if (player === 'defender') {
      defender.acts = parseActs(chosenActs, defender);
      await redis.set(`${defenderKey}:action`, defender.acts.join(''));

    } else {
      assert(player === 'challenger');
      challenger.acts = parseActs(chosenActs, challenger);
      challenger.hasChosen = true;
      await redis.set(`${challengerKey}:action`, challenger.acts.join(''));
    }
    // are we all ready?
    defender.hasChosen = !defender.acts.includes('.');
    challenger.hasChosen = !challenger.acts.includes('.');

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
    const msg = actionPalette(arena, duelId, round, duelist);
    await interaction.update(msg);
  } catch (e) {
    console.warn('while trying to update button palette', e);
  }

  // now post the story
  if (story.length) {
    const content = story.join('\n');
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
    defender.acts = emptySelections();
    challenger.acts = emptySelections();
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
  let a = {
    name: defender.name,
    dmg: 0,
    charge: defender.charge,
    acts: defender.acts,
  };
  let b = {
    name: challenger.name,
    dmg: 0,
    charge: challenger.charge,
    acts: challenger.acts,
  };

  // let's first sanity check that everyone is alive?
  if (defenderAlive() && challengerAlive()) {
    // break down the moves
    for (let i = 0; i < TURNS_PER_ROUND; i++) {
      // to reduce case analysis, swap actions to be alphabetical
      const swapped = a.acts[i] > b.acts[i];
      if (swapped) {
        const temp = b;
        b = a;
        a = temp;
      }
      const moves = `${a.acts[i]} - ${b.acts[i]}`;
      const specialA = HIGH * a.charge;
      const specialB = HIGH * b.charge;
      switch (moves) {
        case 'A - A':
          story.push(`${a.name} and ${b.name} attack simultaneously. \`both -${MID} HP\``);
          a.dmg += MID;
          b.dmg += MID;
          a.charge = 0;
          b.charge = 0;
          break;
        case 'D - D':
          story.push(`${a.name} and ${b.name} both block.`);
          a.charge = 0;
          b.charge = 0;
          break;
        case 'A - D':
          story.push(`${a.name} hits ${possessive(b.name)} shield. \`${b.name} -${LOW} HP\``);
          b.dmg += LOW;
          a.charge = 0;
          b.charge = 0;
          break;
        case 'A - W':
          story.push(`${a.name} hits ${b.name} while they wind up. \`${b.name} -${MID} HP\``);
          b.dmg += MID;
          a.charge = 0;
          b.charge++;
          break;
        case 'D - W':
          story.push(`${a.name} holds up their shield while ${b.name} winds up.`);
          a.charge = 0;
          b.charge++;
          break;
        case 'S - W':
          story.push(`while ${b.name} is winding up,`);
          story.push(`${a.name} performs ${a.charge}x special! \`${b.name} -${specialA} HP\``);
          b.dmg += specialA;
          a.charge = 0;
          b.charge++;
          break;
        case 'W - W':
          story.push(`${a.name} and ${b.name} are winding up.`);
          a.charge++;
          b.charge++;
          break;
        case 'A - S':
          story.push(`${a.name} hits ${b.name} \`-${MID} HP\``);
          story.push(`while ${b.name} counters with ${b.charge}x special attack! \`${a.name} -${specialB} HP\``);
          a.dmg += specialB;
          b.dmg += MID;
          a.charge = 0;
          b.charge = 0;
          break;
        case 'D - S':
          story.push(`${b.name} attempts their special,`);
          story.push(`but ${a.name} parries and counter-attacks! \`${b.name} -${HIGH} HP\``);
          // skip multiplier on counter attack (for now?)
          b.dmg += HIGH;
          a.charge = 0;
          b.charge = 0;
          break;
        case 'S - S':
          story.push(`${a.name} performs ${a.charge}x special, \`${b.name} -${specialA} HP\``);
          story.push(`while ${b.name} hits back with ${b.charge}x special! \`${a.name} -${specialB} HP\``);
          a.dmg += specialB;
          b.dmg += specialA;
          a.charge = 0;
          b.charge = 0;
          break;
        default:
          console.error(`conflict: what is '${moves}'?`);
          story.push(`Something unexpected happened, causing psychic damage. \`both -${LOW} HP\``);
          a.dmg += LOW;
          b.dmg += LOW;
          a.charge = 0;
          b.charge = 0;
      }
      // clamp charges
      a.charge = Math.max(0, Math.min(a.charge, MAX_CHARGE));
      b.charge = Math.max(0, Math.min(b.charge, MAX_CHARGE));
      // now swap back if necessary
      if (swapped) {
        const temp = b;
        b = a;
        a = temp;
      }

      damage.defender = a.dmg;
      damage.challenger = b.dmg;
      // anyone go to 0 HP?
      if (!defenderAlive() || !challengerAlive()) {
        state = 'end';
        break;
      } else if (i < TURNS_PER_ROUND - 1) {
        story.push('... and ...');
      }
    }
  } else {
    state = 'end';
    a.charge = 0;
    b.charge = 0;
  }

  return {
    damage,
    charge: { defender: a.charge, challenger: b.charge },
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
