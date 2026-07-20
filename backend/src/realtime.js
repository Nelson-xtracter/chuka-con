const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { prisma } = require("./config/db");
const { isFlagged } = require("./services/moderation");

// userId -> count of open socket connections (a user can have multiple
// tabs/devices open at once, so we only mark them offline when the last
// one disconnects).
const onlineCounts = new Map();

function isOnline(userId) {
  return (onlineCounts.get(userId) || 0) > 0;
}

function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: "*" }, // same permissive policy as the REST API for now
  });

  // ---------- Auth: verify the JWT passed in the connection handshake ----------
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Missing auth token"));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.sub;
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;

    // Each user gets a personal room so we can push events to them
    // (new messages, presence changes) regardless of which chat screen
    // they currently have open.
    socket.join(`user:${userId}`);

    onlineCounts.set(userId, (onlineCounts.get(userId) || 0) + 1);
    io.emit("presence:update", { userId, online: true, lastSeenAt: new Date().toISOString() });

    socket.on("chat:join", (chatId) => {
      socket.join(`chat:${chatId}`);
    });

    socket.on("chat:leave", (chatId) => {
      socket.leave(`chat:${chatId}`);
    });

    socket.on("message:send", async ({ chatId, text }, ack) => {
      try {
        if (!chatId || !text || !text.trim()) return ack && ack({ error: "Empty message" });

        const membership = await prisma.chatMember.findFirst({ where: { chatId, userId } });
        if (!membership) return ack && ack({ error: "Not a member of this chat" });

        const message = await prisma.message.create({
          data: { chatId, senderId: userId, text: text.trim(), flagged: isFlagged(text) },
          include: { sender: true },
        });

        const dto = {
          id: message.id,
          chatId,
          text: message.text,
          senderId: message.senderId,
          senderName: message.sender.name,
          createdAt: message.createdAt.toISOString(),
        };

        io.to(`chat:${chatId}`).emit("message:new", dto);

        // Also push to each member's personal room, so the chat list
        // screen can update its "last message" preview even if that
        // member doesn't currently have this specific chat open.
        const members = await prisma.chatMember.findMany({ where: { chatId } });
        members.forEach((m) => io.to(`user:${m.userId}`).emit("chat:updated", { chatId, lastMessage: dto }));

        ack && ack({ ok: true, message: dto });
      } catch (err) {
        console.error(err);
        ack && ack({ error: "Could not send message" });
      }
    });

    socket.on("disconnect", async () => {
      const remaining = Math.max(0, (onlineCounts.get(userId) || 1) - 1);
      onlineCounts.set(userId, remaining);

      if (remaining === 0) {
        const lastSeenAt = new Date();
        try {
          await prisma.user.update({ where: { id: userId }, data: { lastSeenAt } });
        } catch (err) {
          // user may have been deleted mid-session - not worth crashing over
        }
        io.emit("presence:update", { userId, online: false, lastSeenAt: lastSeenAt.toISOString() });
      }
    });
  });

  return io;
}

module.exports = { attachRealtime, isOnline };
