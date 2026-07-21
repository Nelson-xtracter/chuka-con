const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function toSceneDto(scene) {
  return {
    id: scene.id,
    category: scene.category,
    title: scene.title,
    description: scene.description,
    emoji: scene.emoji,
    contact: scene.contact,
    createdAt: scene.createdAt.toISOString(),
  };
}

// ---------- Browse (any logged-in user) ----------
router.get("/", requireAuth, async (req, res) => {
  const { category } = req.query;
  const where = category ? { category } : {};
  const scenes = await prisma.scene.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json(scenes.map(toSceneDto));
});

// ---------- Create (admin only) ----------
router.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { category, title, description, emoji, contact } = req.body;
  if (!category || !title || !description) {
    return res.status(400).json({ error: "category, title, and description are required" });
  }
  const scene = await prisma.scene.create({
    data: { category, title, description, emoji: emoji || "✨", contact, createdById: req.user.id },
  });
  res.json(toSceneDto(scene));
});

// ---------- Edit (admin only) ----------
router.put("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { category, title, description, emoji, contact } = req.body;
  const scene = await prisma.scene.update({
    where: { id: req.params.id },
    data: {
      ...(category !== undefined && { category }),
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(emoji !== undefined && { emoji }),
      ...(contact !== undefined && { contact }),
    },
  });
  res.json(toSceneDto(scene));
});

// ---------- Delete (admin only) ----------
router.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  await prisma.scene.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
