require('dotenv').config();
const { App } = require('@slack/bolt');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

const slack = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { SYSTEM_PROMPT } = require('./system-prompt');

const DRIVE_FOLDER_ID = '1aO7iWaHoGlO0gEM2ywMi3C0dAxmrDqhP';
const conversations = {};

function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/documents.readonly',
    ],
  });
  return { drive: google.drive({ version: 'v3', auth }), docs: google.docs({ version: 'v1', auth }) };
}

async function searchDrive(query) {
  try {
    const { drive } = getDriveClient();
    const res = await drive.files.list({
      q: `name contains '${query}'`,
      fields: 'files(id, name, mimeType, webViewLink)',
      pageSize: 5,
      corpora: 'allDrives',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    return res.data.files || [];
  } catch (err) {
    console.error('Drive search error:', err.message);
    return [];
  }
}

async function readGoogleDoc(fileId) {
  try {
    const { docs } = getDriveClient();
    const res = await docs.documents.get({ documentId: fileId });
    const content = res.data.body.content
      .map(block => {
        if (block.paragraph) {
          return block.paragraph.elements.map(el => el.textRun?.content || '').join('');
        }
        return '';
      })
      .join('').trim();
    return content;
  } catch (err) {
    console.error('Doc read error:', err.message);
    return null;
  }
}

async function readSheet(fileId) {
  try {
    const { drive } = getDriveClient();
    const res = await drive.files.export({ fileId, mimeType: 'text/csv' });
    return res.data;
  } catch (err) {
    console.error('Sheet read error:', err.message);
    return null;
  }
}

const driveKeywords = [
  'press release', 'pitch', 'brief', 'faq', 'key messages',
  'strategy', 'agenda', 'tracker', 'op-ed', 'doc', 'document',
  'file', 'drive', 'folder', 'media list', 'spokesperson',
  'bios', 'bio', 'question bank', 'note', 'boilerplate', 'coverage',
  'talking points', 'one pager', 'one-pager', 'deck', 'template',
  'action items', 'recap', 'questionnaire', 'messaging',
];

const normalizations = [
  [/faqs|faq's/i, 'FAQ'],
  [/press releases/i, 'press release'],
  [/key messaging|key message/i, 'key messages'],
  [/spokesperson bios|bios/i, 'Spokesperson Bios'],
  [/question bank/i, 'Question Bank'],
  [/media lists|media list/i, 'Media List'],
  [/action items/i, 'action items'],
  [/talking points/i, 'talking points'],
  [/one pager|one-pager/i, 'one pager'],
];

const wantsContent = [
  'read me', 'summarize', "what's in", 'whats in',
  'what does it say', 'draft based on', 'read the',
];

function shouldSearchDrive(text) {
  const lower = text.toLowerCase();
  return driveKeywords.some(k => lower.includes(k));
}

function wantsDocContent(text) {
  const lower = text.toLowerCase();
  return wantsContent.some(k => lower.includes(k));
}

function normalizeQuery(text) {
  let q = text;
  for (const [pattern, replacement] of normalizations) {
    q = q.replace(pattern, replacement);
  }
  for (const keyword of driveKeywords) {
    if (q.toLowerCase().includes(keyword)) return keyword;
  }
  return q;
}

async function processMessage(text, userId) {
  if (!conversations[userId]) conversations[userId] = [];

  let contextNote = '';

  if (shouldSearchDrive(text)) {
    const query = normalizeQuery(text);
    const files = await searchDrive(query);

    if (files.length > 0) {
      const file = files[0];
      const isDoc = file.mimeType === 'application/vnd.google-apps.document';
      const isSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';

      if (wantsDocContent(text) && isDoc) {
        const content = await readGoogleDoc(file.id);
        if (content) contextNote = `\n\n[Retrieved from Google Drive — ${file.name}]:\n${content.slice(0, 6000)}`;
      } else if (wantsDocContent(text) && isSheet) {
        const csv = await readSheet(file.id);
        if (csv) contextNote = `\n\n[Retrieved from Google Drive — ${file.name}]:\n${String(csv).slice(0, 4000)}`;
      } else {
        contextNote = `\n\n[Found in Google Drive]: *${file.name}* — ${file.webViewLink}`;
        if (files.length > 1) {
          const others = files.slice(1).map(f => `• ${f.name}: ${f.webViewLink}`).join('\n');
          contextNote += `\n\nOther matches:\n${others}`;
        }
      }
    }
  }

  const userMessage = contextNote ? text + contextNote : text;
  conversations[userId].push({ role: 'user', content: userMessage });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: conversations[userId],
  });

  const reply = response.content[0].text;
  conversations[userId].push({ role: 'assistant', content: reply });

  if (conversations[userId].length > 20) conversations[userId] = conversations[userId].slice(-20);

  return reply;
}

slack.message(async ({ message, say }) => {
  if (message.subtype) return;
  const userId = message.user;

  if (message.text && message.text.trim().toLowerCase() === 'reset') {
    conversations[userId] = [];
    await say('Conversation reset. What do you need?');
    return;
  }

  try {
    const reply = await processMessage(message.text, userId);
    await say(reply);
  } catch (err) {
    console.error(err);
    await say('Something went wrong. Try again or type `reset` to start fresh.');
  }
});

slack.event('app_mention', async ({ event, say }) => {
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
  try {
    const reply = await processMessage(text, event.user);
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
