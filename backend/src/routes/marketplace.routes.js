const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function toItemDto(i) {
  return {
    id: i.id,
    title: i.title,
    category: i.category,
    description: i.description,
    price: i.price,
    rating: i.rating,
    reviewsCount: i.reviewsCount,
    imageUrl: i.imageUrl,
    videoUrl: i.videoUrl,
    youtubeUrl: i.youtubeUrl,
    allowPayOnDelivery: i.allowPayOnDelivery,
    createdAt: i.createdAt.toISOString(),
  };
}

// ---------- Browse listings ----------
router.get("/", requireAuth, async (req, res) => {
  const { category } = req.query;
  const where = category && category !== "All" ? { category } : {};
  const items = await prisma.marketplaceItem.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json(items.map(toItemDto));
});

router.get("/:id", requireAuth, async (req, res) => {
  const item = await prisma.marketplaceItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: "Listing not found" });
  res.json(toItemDto(item));
});

// ---------- Admin: create a listing ----------
// Photos are base64 data URLs (same convention as profile photos/event
// banners). Video isn't uploaded as a file here - a 5MB JSON body limit
// makes raw video impractical - so videoUrl/youtubeUrl are just links
// (YouTube, Drive, etc.) that the app opens externally.
router.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { title, category, description, price, imageUrl, videoUrl, youtubeUrl, allowPayOnDelivery } = req.body;
    if (!title || !category) {
      return res.status(400).json({ error: "title and category are required" });
    }
    if (imageUrl && imageUrl.length > 2_000_000) {
      return res.status(400).json({ error: "Image is too large. Please use a smaller photo." });
    }

    const item = await prisma.marketplaceItem.create({
      data: {
        title,
        category,
        description: description || "",
        price: price || 0,
        imageUrl: imageUrl || null,
        videoUrl: videoUrl || null,
        youtubeUrl: youtubeUrl || null,
        allowPayOnDelivery: !!allowPayOnDelivery,
        createdById: req.user.id,
      },
    });
    res.json(toItemDto(item));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create listing" });
  }
});

// ---------- Admin: edit a listing ----------
router.put("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const existing = await prisma.marketplaceItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Listing not found" });

    const { title, category, description, price, imageUrl, videoUrl, youtubeUrl, allowPayOnDelivery } = req.body;
    if (imageUrl && imageUrl.length > 2_000_000) {
      return res.status(400).json({ error: "Image is too large. Please use a smaller photo." });
    }

    const item = await prisma.marketplaceItem.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(category !== undefined && { category }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(videoUrl !== undefined && { videoUrl }),
        ...(youtubeUrl !== undefined && { youtubeUrl }),
        ...(allowPayOnDelivery !== undefined && { allowPayOnDelivery: !!allowPayOnDelivery }),
      },
    });
    res.json(toItemDto(item));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update listing" });
  }
});

// ---------- Buyer: place a Pay on Delivery order ----------
// Only for items the seller has explicitly marked as allowing this -
// unlike the M-Pesa flow, no payment is collected up front; the admin
// confirms the sale once delivered (see admin.routes.js).
router.post("/:id/order", requireAuth, async (req, res) => {
  const item = await prisma.marketplaceItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: "Listing not found" });
  if (!item.allowPayOnDelivery) {
    return res.status(400).json({ error: "This listing doesn't support Pay on Delivery" });
  }

  const { phone, address } = req.body;
  if (!phone) return res.status(400).json({ error: "A contact phone number is required" });

  const order = await prisma.order.create({
    data: { itemId: item.id, buyerId: req.user.id, amount: item.price, phone, address: address || null },
  });

  res.json({
    id: order.id,
    itemTitle: item.title,
    amount: order.amount,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
  });
});

// ---------- Buyer: see my own orders ----------
router.get("/orders/mine", requireAuth, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { buyerId: req.user.id },
    include: { item: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    orders.map((o) => ({
      id: o.id,
      itemTitle: o.item.title,
      amount: o.amount,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
    }))
  );
});

// ---------- Admin: delete a listing ----------
router.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const existing = await prisma.marketplaceItem.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Listing not found" });

  await prisma.purchase.deleteMany({ where: { itemId: req.params.id } });
  await prisma.order.deleteMany({ where: { itemId: req.params.id } });
  await prisma.marketplaceItem.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
