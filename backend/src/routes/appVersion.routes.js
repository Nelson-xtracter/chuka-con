const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// ---------- Public: what's the latest version? (no auth - checked at splash) ----------
router.get("/version", async (req, res) => {
  const latest = await prisma.appVersion.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!latest) return res.json(null);
  res.json({
    versionCode: latest.versionCode,
    versionName: latest.versionName,
    apkUrl: latest.apkUrl,
    releaseNotes: latest.releaseNotes,
  });
});

// ---------- Admin: publish a new version ----------
router.put("/version", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { versionCode, versionName, apkUrl, releaseNotes } = req.body;
  if (!versionCode || !versionName || !apkUrl) {
    return res.status(400).json({ error: "versionCode, versionName, and apkUrl are required" });
  }

  const existing = await prisma.appVersion.findFirst();
  const saved = existing
    ? await prisma.appVersion.update({
        where: { id: existing.id },
        data: { versionCode, versionName, apkUrl, releaseNotes },
      })
    : await prisma.appVersion.create({
        data: { versionCode, versionName, apkUrl, releaseNotes },
      });

  res.json(saved);
});

module.exports = router;
