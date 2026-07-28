const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function toDto(c) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    experienceNeeded: c.experienceNeeded,
    createdAt: c.createdAt.toISOString(),
  };
}

// ---------- Everyone: browse courses ----------
router.get("/", requireAuth, async (req, res) => {
  const courses = await prisma.course.findMany({ orderBy: { createdAt: "desc" } });
  res.json(courses.map(toDto));
});

// ---------- Admin: add a course ----------
router.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { title, description, experienceNeeded } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: "title and description are required" });
  }
  const course = await prisma.course.create({
    data: {
      title,
      description,
      experienceNeeded: experienceNeeded || "None required",
      createdById: req.user.id,
    },
  });
  res.json(toDto(course));
});

// ---------- Admin: edit a course ----------
router.put("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { title, description, experienceNeeded } = req.body;
  const course = await prisma.course.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(experienceNeeded !== undefined && { experienceNeeded }),
    },
  });
  res.json(toDto(course));
});

// ---------- Admin: delete a course ----------
router.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  await prisma.course.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
