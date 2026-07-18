const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const totp = require("../services/totp");

const router = express.Router();

router.get("/stats", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const purchases = await prisma.purchase.findMany();
  const totalSalesAllTime = purchases.reduce((sum, p) => sum + p.amount, 0);
  const yourCommission = purchases.reduce((sum, p) => sum + p.commission, 0);

  const [totalUsers, activeEvents, projectsSold, pendingReviews] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.event.count({ where: { date: { gte: new Date() } } }),
    prisma.purchase.count(),
    prisma.submission.count({ where: { status: "PENDING" } }),
  ]);

  res.json({ totalSalesAllTime, yourCommission, totalUsers, activeEvents, projectsSold, pendingReviews });
});

router.get("/transactions", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const purchases = await prisma.purchase.findMany({
    include: { item: true, buyer: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  res.json(
    purchases.map((p) => ({
      id: p.id,
      item: p.item.title,
      buyer: p.buyer.name,
      amount: p.amount,
      commission: p.commission,
      date: p.createdAt.toISOString(),
    }))
  );
});

// ---------- Real 2FA enrollment for the super-admin account ----------
router.post("/totp/enroll", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const enrollment = await totp.generateEnrollment(req.user.email);

  await prisma.user.update({
    where: { id: req.user.id },
    data: { totpSecret: enrollment.base32Secret, totpEnabled: true },
  });

  // qrDataUrl is shown ONCE for the admin to scan with Google Authenticator/Authy.
  res.json({ qrDataUrl: enrollment.qrDataUrl, base32Secret: enrollment.base32Secret });
});

module.exports = router;
