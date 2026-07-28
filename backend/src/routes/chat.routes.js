const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { isOnline } = require("../realtime");
const { isFlagged } = require("../services/moderation");

const router = express.Router();

// ---------- Directory: everyone you could start a chat with ----------
router.get("/directory", requireAuth, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { id: { not: req.user.id }, suspended: false },
    select: { id: true, name: true, role: true, avatarUrl: true, lastSeenAt: true },
    orderBy: { name: "asc" },
  });

  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      avatarUrl: u.avatarUrl,
      online: isOnline(u.id),
      lastSeenAt: u.lastSeenAt.toISOString(),
    }))
  );
});

// ---------- Find or create a 1:1 chat with another user ----------
router.post("/direct", requireAuth, async (req, res) => {
  const { otherUserId } = req.body;
  if (!otherUserId || otherUserId === req.user.id) {
    return res.status(400).json({ error: "A valid otherUserId is required" });
  }

  const otherUser = await prisma.user.findUnique({ where: { id: otherUserId } });
  if (!otherUser) return res.status(404).json({ error: "User not found" });

  // Look for an existing non-group chat between exactly these two people.
  const existing = await prisma.chat.findFirst({
    where: {
      isGroup: false,
      AND: [
        { members: { some: { userId: req.user.id } } },
        { members: { some: { userId: otherUserId } } },
      ],
    },
  });

  if (existing) return res.json({ id: existing.id, name: existing.name, isGroup: false });

  const chat = await prisma.chat.create({
    data: {
      name: otherUser.name,
      isGroup: false,
      members: { create: [{ userId: req.user.id }, { userId: otherUserId }] },
    },
  });

  res.json({ id: chat.id, name: chat.name, isGroup: false });
});

router.get("/", requireAuth, async (req, res) => {
  const memberships = await prisma.chatMember.findMany({
    where: { userId: req.user.id },
    include: {
      chat: {
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
          members: { include: { user: true } },
        },
      },
    },
  });

  const dtos = memberships.map((m) => {
    const lastMsg = m.chat.messages[0];
    const otherMember = !m.chat.isGroup
      ? m.chat.members.find((mem) => mem.userId !== req.user.id)
      : null;

    return {
      id: m.chat.id,
      name: m.chat.name,
      isGroup: m.chat.isGroup,
      lastMessage: lastMsg?.text ?? null,
      lastMessageAt: lastMsg?.createdAt?.toISOString() ?? null,
      unreadCount: 0, // hook up real unread tracking (e.g. lastReadAt per member) as a next step
      otherUserId: otherMember ? otherMember.userId : null,
      otherUserOnline: otherMember ? isOnline(otherMember.userId) : null,
      otherUserLastSeenAt: otherMember ? otherMember.user.lastSeenAt.toISOString() : null,
    };
  });

  res.json(dtos);
});

router.get("/:id/messages", requireAuth, async (req, res) => {
  const membership = await prisma.chatMember.findFirst({ where: { chatId: req.params.id, userId: req.user.id } });
  if (!membership) return res.status(403).json({ error: "Not a member of this chat" });

  const messages = await prisma.message.findMany({
    where: { chatId: req.params.id },
    include: { sender: true },
    orderBy: { createdAt: "asc" },
  });

  res.json(
    messages.map((m) => ({
      id: m.id,
      text: m.text,
      imageUrl: m.imageUrl,
      senderId: m.senderId,
      senderName: m.sender.name,
      createdAt: m.createdAt.toISOString(),
      isMe: m.senderId === req.user.id,
    }))
  );
});

router.post("/:id/messages", requireAuth, async (req, res) => {
  const membership = await prisma.chatMember.findFirst({ where: { chatId: req.params.id, userId: req.user.id } });
  if (!membership) return res.status(403).json({ error: "Not a member of this chat" });

  const { text, imageUrl } = req.body;
  if ((!text || !text.trim()) && !imageUrl) {
    return res.status(400).json({ error: "Message needs text or an image" });
  }

  const message = await prisma.message.create({
    data: {
      chatId: req.params.id,
      senderId: req.user.id,
      text: text && text.trim() ? text.trim() : null,
      imageUrl: imageUrl || null,
      flagged: isFlagged(text),
    },
    include: { sender: true },
  });

  const dto = {
    id: message.id,
    chatId: req.params.id,
    text: message.text,
    imageUrl: message.imageUrl,
    senderId: message.senderId,
    senderName: message.sender.name,
    createdAt: message.createdAt.toISOString(),
    isMe: true,
  };

  // Real-time push to whoever else has this chat open, and update the
  // chat-list preview for every member even if they don't.
  const io = req.app.locals.io;
  if (io) {
    io.to(`chat:${req.params.id}`).emit("message:new", { ...dto, isMe: undefined });
    const members = await prisma.chatMember.findMany({ where: { chatId: req.params.id } });
    members.forEach((m) => io.to(`user:${m.userId}`).emit("chat:updated", { chatId: req.params.id, lastMessage: dto }));
  }

  res.json(dto);
});

module.exports = router;
