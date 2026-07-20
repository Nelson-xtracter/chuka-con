const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const totp = require("../services/totp");
const { awardXp } = require("../services/xp");

const router = express.Router();

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

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

// ---------- Register (students only; planners/admins are provisioned by the admin) ----------
router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, password, referredByCode } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: "name, email, phone and password are required" });
    }

    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing) return res.status(409).json({ error: "An account with that email or phone already exists" });

    let referredById = null;
    if (referredByCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: referredByCode } });
      if (referrer) referredById = referrer.id;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const referralCode = `CHUKA${Math.floor(1000 + Math.random() * 9000)}`;

    const user = await prisma.user.create({
      data: { name, email, phone, passwordHash, referralCode, referredById, role: "STUDENT" },
    });

    if (referredById) {
      await awardXp(referredById, 100, "Referral bonus: a friend joined via your code");
    }

    const token = signToken(user);
    res.json({ token, user: toUserDto(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create account" });
  }
});

// ---------- Login (students & planners) ----------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    if (user.suspended) return res.status(403).json({ error: "This account has been suspended. Contact an admin." });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken(user);
    res.json({ token, user: toUserDto(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ---------- Admin login (password + real TOTP 2FA) ----------
router.post("/admin-login", async (req, res) => {
  try {
    const { email, password, totpToken } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== "ADMIN") return res.status(401).json({ error: "Invalid admin credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid admin credentials" });

    if (user.totpEnabled) {
      if (!totpToken) {
        // Step 1 complete: password OK, now require the 6-digit code.
        return res.json({ token: null, requiresTotp: true, user: null });
      }
      const ok = totp.verifyToken(user.totpSecret, totpToken);
      if (!ok) return res.status(401).json({ error: "Invalid 2FA code" });
    }

    const token = signToken(user);
    res.json({ token, requiresTotp: false, user: toUserDto(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Admin login failed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  res.json(toUserDto(req.user));
});

router.get("/leaderboard", requireAuth, async (req, res) => {
  const topUsers = await prisma.user.findMany({
    where: { role: "STUDENT" },
    orderBy: { xp: "desc" },
    take: 10,
  });
  const entries = topUsers.map((u, i) => ({
    rank: i + 1,
    name: u.name,
    xp: u.xp,
    isYou: u.id === req.user.id,
  }));
  res.json(entries);
});

// Awards the "attend any event today" daily quest XP once per calendar day.
router.post("/daily-quest", requireAuth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const alreadyClaimed = await prisma.xpEvent.findFirst({
    where: {
      userId: req.user.id,
      reason: "daily_quest",
      createdAt: { gte: new Date(`${today}T00:00:00.000Z`) },
    },
  });
  if (alreadyClaimed) return res.status(400).json({ error: "Daily quest already claimed today" });

  const updated = await awardXp(req.user.id, 50, "daily_quest");
  res.json(toUserDto(updated));
});

module.exports = router;
