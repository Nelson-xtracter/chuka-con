/**
 * Real TOTP (Time-based One-Time Password) 2FA for the super-admin account.
 * Uses the same RFC 6238 algorithm as Google Authenticator / Authy, so no
 * external SMS/email service is required for this factor — it works fully
 * offline once the secret is enrolled.
 */
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

/**
 * Generates a new TOTP secret + a QR code (as a data URL) the admin scans
 * with an authenticator app during enrollment.
 */
async function generateEnrollment(adminEmail) {
  const secret = speakeasy.generateSecret({
    name: `${process.env.TOTP_ISSUER || "ChukaConnectAdmin"} (${adminEmail})`,
  });

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

  return {
    base32Secret: secret.base32, // store this against the user record
    otpauthUrl: secret.otpauth_url,
    qrDataUrl, // show this to the admin once, to scan
  };
}

/**
 * Verifies a 6-digit code the admin typed in, against the stored secret.
 * `window: 1` allows a ±30s clock-drift tolerance.
 */
function verifyToken(base32Secret, token) {
  return speakeasy.totp.verify({
    secret: base32Secret,
    encoding: "base32",
    token,
    window: 1,
  });
}

module.exports = { generateEnrollment, verifyToken };
