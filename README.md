[![Typechecks and integration tests](https://github.com/pshc/skunk/actions/workflows/test.yml/badge.svg)](https://github.com/pshc/skunk/actions/workflows/test.yml)

## Requirements

- Node.js
- Redis server for persistence
- Create a Discord app and bot, then configure in `.env`:
  * `DISCORD_APP_ID`
  * `DISCORD_PUB_KEY`
  * `DISCORD_BOT_TOKEN`
  * `DISCORD_GUILD_ID` (currently supports only one server)
  * `DISCORD_CHANNEL_ID` (optionally to restrict bot to one channel)

## Development

```
npm install
npm run start
```

### Hall of Fame

Sep 27, 2021: 28,619,966,679,984 by jno (roulette-only run)
