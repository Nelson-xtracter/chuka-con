const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const totp = require("../services/totp");

const router = express.Router();

router.get("/stats", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const purchases = await prisma.purchase.findMany();
  const totalSalesAllTime = purchases.reduce((sum, p) => sum + p.amount, 0);
  const yourCommission = purchases.reduce((sum, p) => sum + p.commission, 0);

  const [totalUsers, activeEvents, projectsSold, pendingReviews] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.event.count({ where: { date: { gte: new Date() } } }),
    prisma.purchase.count(),
    prisma.submission.count({ where: { status: "PENDING" } }),
  ]);

  res.json({ totalSalesAllTime, yourCommission, totalUsers, activeEvents, projectsSold, pendingReviews });
});

router.get("/transactions", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const purchases = await prisma.purchase.findMany({
    include: { item: true, buyer: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  res.json(
    purchases.map((p) => ({
      id: p.id,
      item: p.item.title,
      buyer: p.buyer.name,
      amount: p.amount,
      commission: p.commission,
      date: p.createdAt.toISOString(),
    }))
  );
});

// ---------- Chat oversight: list every conversation on the platform ----------
router.get("/chats", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const chats = await prisma.chat.findMany({
    include: {
      members: { include: { user: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    chats.map((c) => ({
      id: c.id,
      name: c.name,
      isGroup: c.isGroup,
      participants: c.members.map((m) => m.user.name).join(", "),
      lastMessage: c.messages[0]?.text ?? null,
      lastMessageAt: c.messages[0]?.createdAt?.toISOString() ?? null,
    }))
  );
});

// ---------- Chat oversight: read any conversation's full history ----------
router.get("/chats/:id/messages", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { chatId: req.params.id },
    include: { sender: true },
    orderBy: { createdAt: "asc" },
  });

  res.json(
    messages.map((m) => ({
      id: m.id,
      text: m.text,
      senderId: m.senderId,
      senderName: m.sender.name,
      flagged: m.flagged,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

// ---------- Moderation: messages the filter flagged, across all chats ----------
router.get("/chats/flagged", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { flagged: true },
    include: { sender: true, chat: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(
    messages.map((m) => ({
      id: m.id,
      chatId: m.chatId,
      chatName: m.chat.name,
      text: m.text,
      senderId: m.senderId,
      senderName: m.sender.name,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

// ---------- Moderation: dismiss a flag (message was fine) or delete it ----------
router.put("/messages/:id/unflag", requireAuth, requireRole("ADMIN"), async (req, res) => {
  await prisma.message.update({ where: { id: req.params.id }, data: { flagged: false } });
  res.json({ ok: true });
});

router.delete("/messages/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  await prisma.message.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
router.get("/users", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      level: true, xp: true, suspended: true, createdAt: true,
    },
  });
  res.json(users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })));
});

// ---------- Manage users: change role or suspend/unsuspend ----------
router.put("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { role, suspended } = req.body;
  if (req.params.id === req.user.id && (role || suspended)) {
    return res.status(400).json({ error: "You can't change your own role or suspend yourself" });
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(role !== undefined && { role }),
      ...(suspended !== undefined && { suspended }),
    },
  });
  res.json({
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    role: user.role, level: user.level, xp: user.xp, suspended: user.suspended,
  });
});

// ---------- Real 2FA enrollment for the super-admin account ----------
router.post("/totp/enroll", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const enrollment = await totp.generateEnrollment(req.user.email);

  await prisma.user.update({
    where: { id: req.user.id },
    data: { totpSecret: enrollment.base32Secret, totpEnabled: true },
  });

  // qrDataUrl is shown ONCE for the admin to scan with Google Authenticator/Authy.
  res.json({ qrDataUrl: enrollment.qrDataUrl, base32Secret: enrollment.base32Secret });
});

module.exports = router;
