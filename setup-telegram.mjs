const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

if (!token || !chatId) {
  console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then run this command again.');
  process.exit(2);
}
if (!/^\d+:[A-Za-z0-9_-]+$/.test(token) || !/^-?\d+$/.test(chatId)) {
  console.error('Telegram token or chat ID format is invalid.');
  process.exit(2);
}

try {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: 'Telegram test: Resy availability monitor notifications connected.' }),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error();
  console.log('Telegram test message sent.');
} catch {
  console.error('Telegram test failed. Check the token, chat ID, /start status, and network connection.');
  process.exit(1);
}