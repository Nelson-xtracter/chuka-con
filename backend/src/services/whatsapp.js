/**
 * WhatsApp integration via Meta's WhatsApp Business Cloud API.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Requires a WhatsApp Business app configured in the Meta Developer
 * Dashboard, a permanent access token, and a registered phone number ID.
 */
const axios = require("axios");

const GRAPH_VERSION = "v20.0";

function apiUrl() {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

/**
 * Sends a free-form text WhatsApp message.
 * NOTE: Meta only allows free-form messages within a 24h customer service
 * window. Outside that window you must use a pre-approved message template
 * (see sendTemplateMessage below).
 */
async function sendTextMessage(to, body) {
  const { data } = await axios.post(
    apiUrl(),
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  return data;
}

/**
 * Sends a pre-approved template message (required for the first message to a
 * user, or after the 24h session window closes). You must create and get the
 * template approved in the Meta dashboard first.
 */
async function sendTemplateMessage(to, templateName, languageCode = "en_US", components = []) {
  const { data } = await axios.post(
    apiUrl(),
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  return data;
}

module.exports = { sendTextMessage, sendTemplateMessage };
