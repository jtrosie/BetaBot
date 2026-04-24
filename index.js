require('dotenv').config();
const { App } = require('@slack/bolt');
const Anthropic = require('@anthropic-ai/sdk');

const slack = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { SYSTEM_PROMPT } = require('./system-prompt');

// Per-user conversation history
const conversations = {};

// Handle DMs
slack.message(async ({ message, say }) => {
  if (message.subtype) return;

  const userId = message.user;

  if (message.text && message.text.trim().toLowerCase() === 'reset') {
    conversations[userId] = [];
    await say('Conversation reset. What do you need?');
    return;
  }

  if (!conversations[userId]) conversations[userId] = [];

  conversations[userId].push({ role: 'user', content: message.text });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: conversations[userId],
    });

    const reply = response.content[0].text;
    conversations[userId].push({ role: 'assistant', content: reply });

    // Keep conversation history manageable
    if (conversations[userId].length > 20) {
      conversations[userId] = conversations[userId].slice(-20);
    }

    await say(reply);
  } catch (err) {
    console.error(err);
    await say('Something went wrong. Try again or type `reset` to start over.');
  }
});

// Handle @ mentions in channels
slack.event('app_mention', async ({ event, say }) => {
  const userId = event.user;
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: 'user', content: text });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: conversations[userId],
    });

    const reply = response.content[0].text;
    conversations[userId].push({ role: 'assistant', content: reply });

    if (conversations[userId].length > 20) {
      conversations[userId] = conversations[userId].slice(-20);
    }

    await say({ text: reply, thread_ts: event.ts });
  } catch (err) {
    console.error(err);
    await say({ text: 'Something went wrong. Try again.', thread_ts: event.ts });
  }
});

(async () => {
  await slack.start();
  console.log('Betaworks bot is running.');
})();
