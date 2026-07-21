const express = require("express");
const bcrypt = require("bcryptjs");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const totp = require("../services/totp");
const mpesa = require("../services/mpesa");

const router = express.Router();

function toUserDto(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    level: user.level,
    xp: user.xp,
    isPremium: user.isPremium,
    referralCode: user.referralCode,
    walletBalance: user.walletBalance,
    avatarUrl: user.avatarUrl,
    totpEnabled: user.totpEnabled,
  };
}

// ---------- Change profile photo ----------
// Body: { photoBase64 }  — a data URL, e.g. "data:image/jpeg;base64,...."
// Kept small on the client side (compressed + resized) since it's stored
// directly on the user row rather than in object storage.
router.put("/photo", requireAuth, async (req, res) => {
  try {
    const { photoBase64 } = req.body;
    if (!photoBase64 || !photoBase64.startsWith("data:image/")) {
      return res.status(400).json({ error: "photoBase64 must be a data:image/... URL" });
    }
    if (photoBase64.length > 2_000_000) {
      return res.status(400).json({ error: "Image is too large. Please use a smaller photo." });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl: photoBase64 },
    });
    res.json(toUserDto(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update photo" });
  }
});

// ---------- Change phone number ----------
router.put("/phone", requireAuth, async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: "phone and password are required" });

    const valid = await bcrypt.compare(password, req.user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Incorrect password" });

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: "That phone number is already in use" });
    }

    const user = await prisma.user.update({ where: { id: req.user.id }, data: { phone } });
    res.json(toUserDto(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update phone number" });
  }
});

// ---------- Change password ----------
router.put("/password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const valid = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update password" });
  }
});

// ---------- 2FA: step 1 — start enrollment (returns QR + secret to scan) ----------
// totpEnabled stays false until /2fa/verify confirms the user actually
// scanned it and can produce a valid code.
router.post("/2fa/enroll", requireAuth, async (req, res) => {
  try {
    const enrollment = await totp.generateEnrollment(req.user.email);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { totpSecret: enrollment.base32Secret, totpEnabled: false },
    });
    res.json({ qrDataUrl: enrollment.qrDataUrl, base32Secret: enrollment.base32Secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start 2FA enrollment" });
  }
});

// ---------- 2FA: step 2 — confirm the 6-digit code, turns 2FA on ----------
router.post("/2fa/verify", requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!req.user.totpSecret) return res.status(400).json({ error: "Start enrollment first" });
    if (!totp.verifyToken(req.user.totpSecret, token)) {
      return res.status(401).json({ error: "Invalid code. Check your authenticator app and try again." });
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { totpEnabled: true } });
    res.json(toUserDto(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify 2FA code" });
  }
});

// ---------- 2FA: disable ----------
router.post("/2fa/disable", requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const valid = await bcrypt.compare(password || "", req.user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Incorrect password" });

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    res.json(toUserDto(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not disable 2FA" });
  }
});

// ---------- Wallet: deposit (via M-Pesa STK push) ----------
// Reuses the same STK push flow as event/marketplace payments; the wallet
// balance is credited once payments.routes.js's mpesa/callback confirms the
// transaction succeeded (purpose = WALLET_TOPUP).
router.post("/wallet/deposit", requireAuth, async (req, res) => {
  try {
    const { phone, amount } = req.body;
    if (!phone || !amount || amount <= 0) {
      return res.status(400).json({ error: "phone and a positive amount are required" });
    }

    const payment = await prisma.payment.create({
      data: { purpose: "WALLET_TOPUP", amount, phone, userId: req.user.id, status: "PENDING" },
    });

    const stkResult = await mpesa.stkPush({
      phone,
      amount,
      accountRef: "CHUKA-WALLET",
      description: "Wallet Top-up",
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { mpesaCheckoutId: stkResult.CheckoutRequestID },
    });

    res.json({
      paymentId: payment.id,
      checkoutRequestId: stkResult.CheckoutRequestID,
      customerMessage: stkResult.CustomerMessage || "Enter your M-Pesa PIN on your phone to complete the deposit.",
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      error: "Could not start M-Pesa deposit. Check that your M-Pesa sandbox credentials are set correctly.",
    });
  }
});

// ---------- Wallet: withdraw ----------
// NOTE: this is a simulated payout for the demo. A real payout to the
// user's M-Pesa number requires Safaricom's B2C API, which needs a
// separate, approved production application — it isn't wired up here.
// This deducts the balance immediately and records the request so the UI
// and admin views have something real to show.
router.post("/wallet/withdraw", requireAuth, async (req, res) => {
  try {
    const { phone, amount, totpToken } = req.body;
    if (!phone || !amount || amount <= 0) {
      return res.status(400).json({ error: "phone and a positive amount are required" });
    }
    if (amount > req.user.walletBalance) {
      return res.status(400).json({ error: "Insufficient wallet balance" });
    }
    if (req.user.totpEnabled) {
      if (!totpToken) return res.status(401).json({ error: "2FA code required", requiresTotp: true });
      if (!totp.verifyToken(req.user.totpSecret, totpToken)) {
        return res.status(401).json({ error: "Invalid 2FA code" });
      }
    }

    const [withdrawal, user] = await prisma.$transaction([
      prisma.withdrawal.create({
        data: { userId: req.user.id, amount, phone, status: "SUCCESS" },
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { walletBalance: { decrement: amount } },
      }),
    ]);

    res.json({ withdrawal, user: toUserDto(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not process withdrawal" });
  }
});

module.exports = router;
