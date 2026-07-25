/**
 * SMS integration via Africa's Talking (widely used across Kenya, supports
 * both sandbox and production sender IDs).
 * Docs: https://developers.africastalking.com/docs/sms/overview
 */
const AfricasTalking = require("africastalking");

let atClient = null;
function getClient() {
  if (!atClient) {
    atClient = AfricasTalking({
      apiKey: process.env.AT_API_KEY,
      username: process.env.AT_USERNAME,
    });
  }
  return atClient;
}

/**
 * Sends an SMS to one or more recipients.
 * @param {string|string[]} to - phone number(s) in international format, e.g. "+2547XXXXXXXX"
 * @param {string} message
 */
async function sendSMS(to, message) {
  const sms = getClient().SMS;
  const recipients = Array.isArray(to) ? to : [to];

  const response = await sms.send({
    to: recipients,
    message,
    from: process.env.AT_SENDER_ID || undefined,
  });

  return response;
}

module.exports = { sendSMS };
