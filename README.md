# Betaworks Slack Bot
ASTRSK PR internal knowledge base bot for the Betaworks account.

## Setup

### 1. Create a Slack App
Go to api.slack.com/apps → Create New App → From Scratch

**OAuth & Permissions — Bot Token Scopes:**
- `app_mentions:read`
- `chat:write`
- `im:history`
- `im:write`
- `channels:history`

**Event Subscriptions — Bot Events:**
- `message.im`
- `app_mention`

**App Home:**
Enable the Messages Tab + allow users to send messages from it.

**Socket Mode:**
Enable Socket Mode → generate an App-Level Token with `connections:write` scope → save as `SLACK_APP_TOKEN`

Install app to workspace. Save:
- `SLACK_BOT_TOKEN` (OAuth & Permissions → Bot User OAuth Token, starts with `xoxb-`)
- `SLACK_SIGNING_SECRET` (Basic Information → App Credentials)
- `SLACK_APP_TOKEN` (the `xapp-` token from Socket Mode)

### 2. Get Anthropic API Key
console.anthropic.com → API Keys

### 3. Deploy on Railway
1. Push these 3 files to a new GitHub repo (e.g. `jtrosie/Betaworks-Bot`)
2. Go to railway.app → New Project → Deploy from GitHub repo
3. Add environment variables in the Variables tab:
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_APP_TOKEN`
   - `ANTHROPIC_API_KEY`
4. Deploy

## Usage
- **DM the bot** directly for any question
- **@ mention** the bot in a channel
- Type `reset` to clear conversation history

## Updating the knowledge base
Go to GitHub → open `system-prompt.js` → click pencil icon → edit → commit. Railway redeploys automatically within ~30 seconds.
