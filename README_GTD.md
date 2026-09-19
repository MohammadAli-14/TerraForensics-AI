# GTD Run Notes

Short reference for running AnythingLLM with the GTD database.

## Commands

- `yarn setup`
- `yarn dev:server`
- `yarn dev:frontend`
- `yarn dev:collector`
- `yarn dev:all`
- `yarn prod:server`

## GTD server changes

- `server/index.js` now starts MongoDB integration early when `MONGODB_URI` is set.
- Mongo runs in the background, so the server can boot without waiting for the database check to finish.
- After Mongo is ready, the chat system gets the GTD context extractor injected.
- The GTD flow uses the server-side Mongo helpers in `server/utils/mongoDB/` and the chat handlers in `server/utils/chats/`.

## Env files

- Local: `server/.env.development`
- Docker: `docker/.env.example`
- The Mongo host differs between local and Docker setups.