const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function toDto(n) {
  return { id: n.id, title: n.title, body: n.body, createdAt: n.createdAt.toISOString() };
}

// ---------- Everyone: latest notifications ----------
// No server-side read tracking - the client keeps a local "last seen"
// timestamp and treats anything newer as unread, which is enough for a
// single-admin-broadcast use case without needing a per-user join table.
router.get("/", requireAuth, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(notifications.map(toDto));
});

// ---------- Admin: broadcast a notification to everyone ----------
router.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: "title and body are required" });

  const notification = await prisma.notification.create({
    data: { title, body, createdById: req.user.id },
  });

  // Real-time push so anyone with the app open sees it immediately.
  const io = req.app.locals.io;
  if (io) io.emit("notification:new", toDto(notification));

  res.json(toDto(notification));
});

module.exports = router;
