import { strict as assert } from 'assert';
import { SlashCommandBuilder } from '@discordjs/builders';
import { ButtonInteraction, CommandInteraction, Message, MessageActionRow, MessageButton } from 'discord.js';
import type { Arena, PlayerId } from '../api';
import { lookupArena, lookupPlayerId } from '../api';
import { redis } from '#burrow/db';
import { STARTING_HP, Duelist, duelMessage, cacheDuelMessage, emptySelections } from './duel';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('squareup')
  .setDescription('Start or join a duel.');

export async function execute(interaction: CommandInteraction) {
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);
  await squareUp(arena, playerId, 'next', interaction);
}

// I can't find a convenient way to retrieve discord messages later, so cache them in-memory for now
// Ideally we would cache the message ID in redis so that we could rehydrate properly across restarts...
export const CHALLENGE_MSG_CACHE: Map<number, Message> = new Map();

const CHALLENGE_CACHE_EXPIRY = 6 * 60 * 60 * 1000;
const FIGHT_START_DELAY = 4000;
let PENDING_FIGHT: ReturnType<typeof setTimeout> | undefined;

type EitherInteraction = CommandInteraction | ButtonInteraction;

export async function squareUp(arena: Arena, playerId: PlayerId, requestedDuelId: number | 'next', interaction: EitherInteraction) {
  const namesKey = `${arena}:names`;
  const mentionsKey = `${arena}:mentions`;
  const name: string = (await redis.hget(namesKey, playerId)) || '???';

  const duelCountKey = `${arena}:duel:count`; // ID of the next duel
  const activeKey = `${arena}:duel:active`; // ID of the current duel, if one is happening
  const defenderKey = `${arena}:duel:defender`; // player ID
  const challengerKey = `${arena}:duel:challenger`; // player ID

  if (await redis.get(activeKey) !== null) {
    await interaction.reply({ content: 'Sorry, a duel is already active.', ephemeral: true });
    return;
  }

  // once the challenge is accepted, a duel will be created with id `nextDuel`
  const nextDuel = Number(await redis.get(duelCountKey));
  // if anyone clicks an old challenge button, remove it
  if (requestedDuelId !== 'next' && requestedDuelId !== nextDuel) {
    assert(interaction instanceof ButtonInteraction);
    await interaction.update({ content: 'This challenge has expired.', components: [] });
    return;
  }

  // first try to become the defender, or else become the challenger
  if (await redis.setnx(defenderKey, playerId)) {
    // create a challenge button on the reply
    const content = `${name} offers a duel.`;
    const components = makeChallengeButtons(arena, nextDuel, 'active');
    const message = await interaction.reply({ content, components, fetchReply: true });
    if (!(message instanceof Message)) {
      console.error('fetchReply returned something unexpected');
      return;
    }
    // save this message to update it later
    CHALLENGE_MSG_CACHE.set(nextDuel, message);
    // expire it later to avoid leaking memory
    setTimeout(expireChallengeMessage.bind(null, nextDuel, message.id), CHALLENGE_CACHE_EXPIRY);

  } else {
    const defenderId: PlayerId | null = await redis.get(defenderKey);
    assert(defenderId, 'Opponent disappeared!');
    const defenderName: string | null = await redis.hget(namesKey, defenderId);
    assert(defenderName, 'Opponent disappeared!');

    // load up discord @mention
    const chaUserId = await redis.hget(mentionsKey, playerId);
    const challengerMention = chaUserId ? `<@${chaUserId}>` : name;
    const defUserId = await redis.hget(mentionsKey, defenderId);
    const defenderMention = defUserId ? `<@${defUserId}>` : defenderName;

    // someone is already squared up, try to start a fight
    if (playerId === defenderId) {
      await interaction.reply({ content: 'You are already up for a duel.', ephemeral: true });
    } else if (await redis.setnx(challengerKey, playerId)) {
      // challenge accepted!
      const content = `${defenderMention} VS ${challengerMention}`;
      const components = makeChallengeButtons(arena, nextDuel, 'fighting');

      // update the existing challenge message
      if (interaction instanceof ButtonInteraction) {
        await interaction.update({ content, components });
      } else {
        const challengeMessage = CHALLENGE_MSG_CACHE.get(nextDuel);
        if (challengeMessage) {
          await interaction.deferReply({ ephemeral: true });
          await challengeMessage.edit({ content, components });
          await interaction.editReply("Challenge accepted.");
        } else {
          // fallback if we don't have a cached message
          await interaction.reply({ content });
        }
      }

      // give everyone a second to prepare (or back out)
      const hp = STARTING_HP;
      const charge = 0;
      const hasChosen = false;
      const defender = { id: defenderId, name: defenderName, key: defenderKey, hp, charge, acts: emptySelections(), hasChosen };
      const challenger = { id: playerId, name, key: challengerKey, hp, charge, acts: emptySelections(), hasChosen };
      // prevent simultaneous `startFight` calls by saving and clearing the timeout
      if (PENDING_FIGHT) {
        clearTimeout(PENDING_FIGHT);
      }
      PENDING_FIGHT = setTimeout(async () => {
        PENDING_FIGHT = undefined;
        try {
          await startFight(arena, nextDuel, defender, challenger, interaction);
        } catch (e) {
          console.error(`startFight: ${e}`);
        }
      }, FIGHT_START_DELAY);

    } else {
      await interaction.reply({ content: "404 duel not found.", ephemeral: true });
    }
  }
}

async function startFight(arena: Arena, duelId: number, defender: Duelist, challenger: Duelist, interaction: EitherInteraction) {
  // DRY
  const duelCountKey = `${arena}:duel:count`;
  const activeKey = `${arena}:duel:active`;
  const roundKey = `${arena}:duel:round`;

  // but first, check that the fight is on as expected
  const nextDuel = Number(await redis.get(duelCountKey));
  assert(nextDuel === duelId, 'wrong duel id');
  assert(defender.id === await redis.get(defender.key), 'wrong defender');
  assert(challenger.id === await redis.get(challenger.key), 'wrong challenger');

  // activate the duel
  if (!await redis.setnx(activeKey, duelId)) {
    console.warn(`duel ${duelId} was already active?!`);
    return;
  }
  // set up initial duel state
  const round = 1;
  const tx = redis.multi();
  tx.incr(duelCountKey);
  tx.set(roundKey, round);
  tx.set(`${defender.key}:hp`, defender.hp);
  tx.set(`${challenger.key}:hp`, challenger.hp);
  tx.set(`${defender.key}:charge`, 0);
  tx.set(`${challenger.key}:charge`, 0);
  tx.del(`${defender.key}:action`);
  tx.del(`${challenger.key}:action`);
  await tx.exec();

  // use a follow-up message to print the starting state
  const msg = duelMessage(arena, duelId, round, defender, challenger, 'picking');
  const reply = await interaction.followUp({ fetchReply: true, ...msg });
  if (reply instanceof Message) {
    cacheDuelMessage(reply, arena, duelId, round);
  } else {
    console.warn('got non-Message reply back');
  }
}

function expireChallengeMessage(duelId: number, messageId: string) {
  const cached = CHALLENGE_MSG_CACHE.get(duelId);
  if (cached && cached.id === messageId) {
    CHALLENGE_MSG_CACHE.delete(duelId);
  }
}

export function makeChallengeButtons(arena: Arena, duelId: number, state: 'active' | 'idle' | 'fighting'): MessageActionRow[] {
  const row = new MessageActionRow()
    .addComponents(
      new MessageButton()
        .setCustomId(`${arena}:challenge:${duelId}`)
        .setLabel(state === 'fighting' ? 'Accepted' : 'Accept')
        .setEmoji('🏮')
        .setStyle(state === 'active' ? 'PRIMARY' : 'SECONDARY')
        .setDisabled(state === 'fighting'),
      new MessageButton()
        .setCustomId(`${arena}:rules`)
        .setLabel('Rules')
        .setStyle('SECONDARY')
    );
  return [row];
}
