const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { awardXp } = require("../services/xp");
const { sendSMS } = require("../services/sms");

const router = express.Router();

function toDto(s, studentName) {
  return {
    id: s.id,
    title: s.title,
    fileUrl: s.fileUrl,
    status: s.status,
    studentName,
    submittedAt: s.submittedAt.toISOString(),
  };
}

router.post("/", requireAuth, async (req, res) => {
  const { title, fileUrl } = req.body;
  const submission = await prisma.submission.create({
    data: { title, fileUrl, studentId: req.user.id },
  });
  res.json(toDto(submission, req.user.name));
});

router.get("/pending", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const submissions = await prisma.submission.findMany({
    where: { status: "PENDING" },
    include: { student: true },
    orderBy: { submittedAt: "desc" },
  });
  res.json(submissions.map((s) => toDto(s, s.student.name)));
});

router.post("/:id/review", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { approve, note } = req.body;
  const submission = await prisma.submission.findUnique({ where: { id: req.params.id }, include: { student: true } });
  if (!submission) return res.status(404).json({ error: "Submission not found" });

  const updated = await prisma.submission.update({
    where: { id: submission.id },
    data: { status: approve ? "APPROVED" : "REJECTED", reviewedAt: new Date(), reviewNote: note },
  });

  if (approve) {
    await awardXp(submission.studentId, 150, "Project approved by admin");
  }

  // Real SMS notification via Africa's Talking (requires AT credentials in .env)
  try {
    await sendSMS(
      submission.student.phone,
      approve
        ? `Chuka Connect: Your project "${submission.title}" was approved! ✅`
        : `Chuka Connect: Your project "${submission.title}" needs changes. Check the app for details.`
    );
  } catch (err) {
    console.warn("SMS notification failed (check AT_API_KEY in .env):", err.message);
  }

  res.json(toDto(updated, submission.student.name));
});

module.exports = router;
