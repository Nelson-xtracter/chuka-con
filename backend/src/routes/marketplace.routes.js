const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function toItemDto(i) {
  return { id: i.id, title: i.title, category: i.category, price: i.price, rating: i.rating, reviewsCount: i.reviewsCount };
}

router.get("/", requireAuth, async (req, res) => {
  const { category } = req.query;
  const where = category ? { category } : {};
  const items = await prisma.marketplaceItem.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json(items.map(toItemDto));
});

module.exports = router;
