/**
 * M-Pesa Daraja API integration (Safaricom).
 * Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 *
 * Flow:
 *  1. getAccessToken() — OAuth2 client-credentials grant.
 *  2. stkPush()        — triggers the "Lipa na M-Pesa Online" prompt on the
 *                         customer's phone.
 *  3. Safaricom calls MPESA_CALLBACK_URL asynchronously with the result —
 *     handled in routes/payments.routes.js.
 *
 * Sandbox base URL is used by default. Switch MPESA_ENV=production once you
 * have production credentials from Safaricom.
 */
const axios = require("axios");

const BASE_URL =
  process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return data.access_token;
}

function timestampNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Normalizes a Kenyan phone number to the 2547XXXXXXXX format Daraja expects.
 */
function normalizePhone(phone) {
  let p = phone.replace(/\s+/g, "").replace(/^\+/, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  return p;
}

/**
 * Initiates an STK Push (M-Pesa Express) prompt.
 * @param {string} phone - customer phone number
 * @param {number} amount - amount in KES (whole numbers only)
 * @param {string} accountRef - short reference shown to the customer, e.g. "CHUKA-EVENT-123"
 * @param {string} description - short transaction description
 */
async function stkPush({ phone, amount, accountRef, description }) {
  const token = await getAccessToken();
  const timestamp = timestampNow();
  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString("base64");

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.round(amount),
    PartyA: normalizePhone(phone),
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: normalizePhone(phone),
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: accountRef.slice(0, 12),
    TransactionDesc: description.slice(0, 13),
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // data contains: MerchantRequestID, CheckoutRequestID, ResponseCode, CustomerMessage
  return data;
}

/**
 * Queries the status of an STK push transaction (useful for polling if the
 * async callback hasn't arrived yet).
 */
async function stkQuery(checkoutRequestId) {
  const token = await getAccessToken();
  const timestamp = timestampNow();
  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString("base64");

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

module.exports = { getAccessToken, stkPush, stkQuery, normalizePhone };
