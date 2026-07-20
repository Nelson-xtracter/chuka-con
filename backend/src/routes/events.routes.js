const express = require("express");
const { v4: uuid } = require("uuid");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { awardXp } = require("../services/xp");

const router = express.Router();

function toEventDto(event) {
  const sold = event.tickets ? event.tickets.length : event._count?.tickets ?? 0;
  return {
    id: event.id,
    title: event.title,
    tag: event.tag,
    description: event.description,
    imageUrl: event.imageUrl,
    date: event.date.toISOString(),
    location: event.location,
    price: event.price,
    capacity: event.capacity,
    sold,
  };
}

// ---------- Browse events ----------
router.get("/", requireAuth, async (req, res) => {
  const { filter } = req.query;
  const where = {};
  if (filter === "VIP") where.tag = "VIP";
  if (filter === "Upcoming") where.date = { gte: new Date() };

  const events = await prisma.event.findMany({
    where,
    include: { _count: { select: { tickets: true } } },
    orderBy: { date: "asc" },
  });

  res.json(events.map(toEventDto));
});

router.get("/my-tickets", requireAuth, async (req, res) => {
  const tickets = await prisma.ticket.findMany({
    where: { userId: req.user.id },
    include: { event: true },
    orderBy: { purchasedAt: "desc" },
  });
  res.json(
    tickets.map((t) => ({
      id: t.id,
      code: t.code,
      isVip: t.isVip,
      checkedIn: t.checkedIn,
      event: toEventDto(t.event),
    }))
  );
});

router.get("/:id", requireAuth, async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { tickets: true } } },
  });
  if (!event) return res.status(404).json({ error: "Event not found" });
  res.json(toEventDto(event));
});

// ---------- Planner: create an event ----------
router.post("/", requireAuth, requireRole("PLANNER", "ADMIN"), async (req, res) => {
  const { title, tag, description, imageUrl, date, location, price, capacity } = req.body;
  const event = await prisma.event.create({
    data: {
      title,
      tag,
      description,
      imageUrl,
      date: new Date(date),
      location,
      price: price || 0,
      capacity: capacity || 100,
      plannerId: req.user.id,
    },
  });
  res.json(toEventDto(event));
});

// ---------- Planner: scan / manual check-in ----------
router.post("/check-in", requireAuth, requireRole("PLANNER", "ADMIN"), async (req, res) => {
  const { ticketCode } = req.body;
  const ticket = await prisma.ticket.findUnique({ where: { code: ticketCode }, include: { event: true } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { checkedIn: true, checkedInAt: new Date() },
    include: { event: true },
  });

  // Reward the attendee with XP for showing up (daily quest style bonus)
  await awardXp(ticket.userId, 50, "Checked in at an event");

  res.json({
    id: updated.id,
    code: updated.code,
    isVip: updated.isVip,
    checkedIn: updated.checkedIn,
    event: toEventDto(updated.event),
  });
});

// ---------- Planner (own event) or Admin (any event): edit ----------
router.put("/:id", requireAuth, requireRole("PLANNER", "ADMIN"), async (req, res) => {
  const event = await prisma.event.findUnique({ where: { id: req.params.id } });
  if (!event) return res.status(404).json({ error: "Event not found" });
  if (req.user.role !== "ADMIN" && event.plannerId !== req.user.id) {
    return res.status(403).json({ error: "You can only edit your own events" });
  }

  const { title, tag, description, imageUrl, date, location, price, capacity } = req.body;
  const updated = await prisma.event.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(tag !== undefined && { tag }),
      ...(description !== undefined && { description }),
      ...(imageUrl !== undefined && { imageUrl }),
      ...(date !== undefined && { date: new Date(date) }),
      ...(location !== undefined && { location }),
      ...(price !== undefined && { price }),
      ...(capacity !== undefined && { capacity }),
    },
    include: { _count: { select: { tickets: true } } },
  });
  res.json(toEventDto(updated));
});

// ---------- Planner (own event) or Admin (any event): delete ----------
router.delete("/:id", requireAuth, requireRole("PLANNER", "ADMIN"), async (req, res) => {
  const event = await prisma.event.findUnique({ where: { id: req.params.id } });
  if (!event) return res.status(404).json({ error: "Event not found" });
  if (req.user.role !== "ADMIN" && event.plannerId !== req.user.id) {
    return res.status(403).json({ error: "You can only delete your own events" });
  }

  await prisma.ticket.deleteMany({ where: { eventId: req.params.id } });
  await prisma.event.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- Planner: list only my own events (for management) ----------
router.get("/mine/list", requireAuth, requireRole("PLANNER", "ADMIN"), async (req, res) => {
  const where = req.user.role === "ADMIN" ? {} : { plannerId: req.user.id };
  const events = await prisma.event.findMany({
    where,
    include: { _count: { select: { tickets: true } } },
    orderBy: { date: "desc" },
  });
  res.json(events.map(toEventDto));
});

module.exports = router;
