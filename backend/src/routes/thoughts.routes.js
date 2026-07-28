const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function toDto(t) {
  return { id: t.id, text: t.text, createdAt: t.createdAt.toISOString() };
}

// ---------- My own thoughts, newest first ----------
router.get("/mine", requireAuth, async (req, res) => {
  const thoughts = await prisma.thought.findMany({
    where: { authorId: req.user.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(thoughts.map(toDto));
});

// ---------- Write a new thought ----------
router.post("/", requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Write something first" });

  const thought = await prisma.thought.create({
    data: { text: text.trim(), authorId: req.user.id },
  });
  res.json(toDto(thought));
});

// ---------- Delete my own thought ----------
router.delete("/:id", requireAuth, async (req, res) => {
  const thought = await prisma.thought.findUnique({ where: { id: req.params.id } });
  if (!thought || thought.authorId !== req.user.id) {
    return res.status(404).json({ error: "Thought not found" });
  }
  await prisma.thought.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
