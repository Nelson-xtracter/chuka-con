const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function toProjectDto(p) {
  return { id: p.id, title: p.title, type: p.type, progress: p.progress, dueDate: p.dueDate.toISOString() };
}

router.get("/", requireAuth, async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(projects.map(toProjectDto));
});

router.post("/", requireAuth, async (req, res) => {
  const { title, type, dueDate } = req.body;
  const project = await prisma.project.create({
    data: { title, type: type === "GROUP" ? "GROUP" : "INDIVIDUAL", dueDate: new Date(dueDate), ownerId: req.user.id },
  });
  res.json(toProjectDto(project));
});

router.patch("/:id/progress", requireAuth, async (req, res) => {
  const { progress } = req.body;
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || project.ownerId !== req.user.id) return res.status(404).json({ error: "Project not found" });

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: { progress: Math.max(0, Math.min(100, progress)) },
  });
  res.json(toProjectDto(updated));
});

module.exports = router;
