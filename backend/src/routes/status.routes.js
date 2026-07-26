const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;

function toItemDto(status, viewerId, viewedStatusIds) {
  return {
    id: status.id,
    mediaUrl: status.mediaUrl,
    mediaType: status.mediaType,
    caption: status.caption,
    createdAt: status.createdAt.toISOString(),
    expiresAt: status.expiresAt.toISOString(),
    viewed: status.userId === viewerId ? true : viewedStatusIds.has(status.id),
  };
}

// ---------- Feed: everyone's active (non-expired) statuses, grouped by user ----------
router.get("/", requireAuth, async (req, res) => {
  const now = new Date();

  const statuses = await prisma.status.findMany({
    where: { expiresAt: { gt: now }, user: { suspended: false } },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  });

  const myViews = await prisma.statusView.findMany({
    where: { viewerId: req.user.id, statusId: { in: statuses.map((s) => s.id) } },
  });
  const viewedIds = new Set(myViews.map((v) => v.statusId));

  const groups = new Map();
  for (const status of statuses) {
    if (!groups.has(status.userId)) {
      groups.set(status.userId, {
        userId: status.userId,
        name: status.user.name,
        avatarUrl: status.user.avatarUrl,
        isMine: status.userId === req.user.id,
        items: [],
      });
    }
    groups.get(status.userId).items.push(toItemDto(status, req.user.id, viewedIds));
  }

  const result = Array.from(groups.values()).map((g) => ({
    ...g,
    allViewed: g.items.every((i) => i.viewed),
  }));

  // Mine first, then whoever has unseen updates, then already-seen, each
  // group ordered by its most recent status.
  result.sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
    const aLatest = a.items[a.items.length - 1].createdAt;
    const bLatest = b.items[b.items.length - 1].createdAt;
    return bLatest.localeCompare(aLatest);
  });

  res.json(result);
});

// ---------- My own active statuses, with per-status viewer lists ----------
router.get("/mine", requireAuth, async (req, res) => {
  const now = new Date();
  const statuses = await prisma.status.findMany({
    where: { userId: req.user.id, expiresAt: { gt: now } },
    include: { views: { orderBy: { viewedAt: "desc" } } },
    orderBy: { createdAt: "asc" },
  });

  const viewerIds = [...new Set(statuses.flatMap((s) => s.views.map((v) => v.viewerId)))];
  const viewers = await prisma.user.findMany({
    where: { id: { in: viewerIds } },
    select: { id: true, name: true, avatarUrl: true },
  });
  const viewerById = new Map(viewers.map((v) => [v.id, v]));

  res.json(
    statuses.map((s) => ({
      id: s.id,
      mediaUrl: s.mediaUrl,
      mediaType: s.mediaType,
      caption: s.caption,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      viewed: true,
      viewers: s.views.map((v) => ({
        viewerId: v.viewerId,
        viewerName: viewerById.get(v.viewerId)?.name ?? "Unknown",
        avatarUrl: viewerById.get(v.viewerId)?.avatarUrl ?? null,
        viewedAt: v.viewedAt.toISOString(),
      })),
    }))
  );
});

// ---------- Post a new status (expires 24h from now) ----------
router.post("/", requireAuth, async (req, res) => {
  const { mediaUrl, mediaType, caption } = req.body;
  if (!mediaUrl) return res.status(400).json({ error: "mediaUrl is required" });

  const now = new Date();
  const status = await prisma.status.create({
    data: {
      userId: req.user.id,
      mediaUrl,
      mediaType: mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
      caption: caption && caption.trim() ? caption.trim() : null,
      expiresAt: new Date(now.getTime() + DAY_MS),
    },
  });

  res.json({
    id: status.id,
    mediaUrl: status.mediaUrl,
    mediaType: status.mediaType,
    caption: status.caption,
    createdAt: status.createdAt.toISOString(),
    expiresAt: status.expiresAt.toISOString(),
    viewed: true,
  });
});

// ---------- Mark a status as viewed by the current user ----------
router.post("/:id/view", requireAuth, async (req, res) => {
  const status = await prisma.status.findUnique({ where: { id: req.params.id } });
  if (!status) return res.status(404).json({ error: "Status not found" });
  if (status.userId === req.user.id) return res.json({ ok: true }); // no need to track own views

  await prisma.statusView.upsert({
    where: { statusId_viewerId: { statusId: req.params.id, viewerId: req.user.id } },
    update: {},
    create: { statusId: req.params.id, viewerId: req.user.id },
  });

  res.json({ ok: true });
});

// ---------- Delete one of my own statuses early ----------
router.delete("/:id", requireAuth, async (req, res) => {
  const status = await prisma.status.findUnique({ where: { id: req.params.id } });
  if (!status || status.userId !== req.user.id) {
    return res.status(404).json({ error: "Status not found" });
  }
  await prisma.statusView.deleteMany({ where: { statusId: req.params.id } });
  await prisma.status.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
