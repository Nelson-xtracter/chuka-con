const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/dashboard", requireAuth, requireRole("PLANNER", "ADMIN"), async (req, res) => {
  const event = await prisma.event.findFirst({
    where: { plannerId: req.user.id },
    orderBy: { date: "desc" },
    include: { tickets: true },
  });

  if (!event) return res.status(404).json({ error: "No events created yet" });

  const ticketsSold = event.tickets.length;
  const checkedIn = event.tickets.filter((t) => t.checkedIn).length;
  const revenue = ticketsSold * event.price;
  const status = new Date(event.date) > new Date() ? "Upcoming" : "Active";

  res.json({
    eventTitle: event.title,
    status,
    date: event.date.toISOString(),
    location: event.location,
    ticketsSold,
    checkedIn,
    revenue,
  });
});

module.exports = router;
