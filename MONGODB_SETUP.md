# HireTrust MongoDB Atlas setup

1. Create a MongoDB Atlas database/user and allow the deployment server IP (or the appropriate Atlas network access range).
2. Copy your Atlas connection string into `.env` as `MONGODB_URI`. Do not commit `.env`.
3. Set `MONGODB_DB=hiretrust` and `APP_TIMEZONE=Asia/Kolkata`.
4. Run `npm install`.
5. If you have an old `database.json`, run `node migrate-json-to-mongo.js` once, verify the data in Atlas, then remove `database.json`.
6. Start HireTrust with `npm start`. The server will refuse to start if MongoDB is not configured, so it cannot silently fall back to JSON storage.

## Connection-string security
If your MongoDB password contains characters such as `@`, `:`, `/`, `?`, `#`, `%`, or spaces, URL-encode the password before placing it in the MongoDB URI. Never share the URI or password publicly.

## Time handling
HireTrust stores timestamps in UTC. The UI and email notifications display them in `APP_TIMEZONE`, which defaults to `Asia/Kolkata` and is labeled IST.
