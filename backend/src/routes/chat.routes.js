const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const memberships = await prisma.chatMember.findMany({
    where: { userId: req.user.id },
    include: {
      chat: {
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const dtos = memberships.map((m) => {
    const lastMsg = m.chat.messages[0];
    return {
      id: m.chat.id,
      name: m.chat.name,
      isGroup: m.chat.isGroup,
      lastMessage: lastMsg?.text ?? null,
      lastMessageAt: lastMsg?.createdAt?.toISOString() ?? null,
      unreadCount: 0, // hook up real unread tracking (e.g. lastReadAt per member) as a next step
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

  const message = await prisma.message.create({
    data: { chatId: req.params.id, senderId: req.user.id, text: req.body.text },
    include: { sender: true },
  });

  res.json({
    id: message.id,
    text: message.text,
    senderId: message.senderId,
    senderName: message.sender.name,
    createdAt: message.createdAt.toISOString(),
    isMe: true,
  });
});

module.exports = router;
