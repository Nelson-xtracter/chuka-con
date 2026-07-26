const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const CORPUS_DIR = path.join(__dirname, "..", "..", "uploads", "corpus");
fs.mkdirSync(CORPUS_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB, matches the app's stated limit
});

/**
 * A real (if intentionally lightweight) similarity engine: builds 5-word
 * "shingles" from the document and compares them against every previously
 * checked document using Jaccard similarity. No external plagiarism API is
 * required, which keeps this fully self-hosted — swap in a call to
 * Copyleaks/Turnitin/PlagiarismCheck.org here for production-grade coverage.
 */
function shingles(text, size = 5) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set();
  for (let i = 0; i <= words.length - size; i++) {
    set.add(words.slice(i, i + size).join(" "));
  }
  return set;
}

function jaccardSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) if (b.has(s)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

router.post("/check", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Best-effort text extraction. Plain text decodes directly; for binary
    // formats (docx/pdf) plug in a proper parser (e.g. "mammoth" for docx,
    // "pdf-parse" for PDFs) — left as an extension point.
    const text = req.file.buffer.toString("utf-8");
    const docShingles = shingles(text);

    let maxScore = 0;
    const corpusFiles = fs.readdirSync(CORPUS_DIR);
    for (const filename of corpusFiles) {
      const existingText = fs.readFileSync(path.join(CORPUS_DIR, filename), "utf-8");
      const similarity = jaccardSimilarity(docShingles, shingles(existingText));
      maxScore = Math.max(maxScore, similarity);
    }

    const score = Math.round(maxScore * 100);

    // Save this document into the corpus so future checks compare against it too.
    fs.writeFileSync(path.join(CORPUS_DIR, `${Date.now()}_${req.file.originalname}.txt`), text);

    const record = await prisma.plagiarismCheck.create({
      data: { userId: req.user.id, filename: req.file.originalname, score },
    });

    res.json({ filename: record.filename, score: record.score, checkedAt: record.checkedAt.toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not check this document" });
  }
});

router.get("/history", requireAuth, async (req, res) => {
  const checks = await prisma.plagiarismCheck.findMany({
    where: { userId: req.user.id },
    orderBy: { checkedAt: "desc" },
    take: 20,
  });
  res.json(checks.map((c) => ({ filename: c.filename, score: c.score, checkedAt: c.checkedAt.toISOString() })));
});

module.exports = router;
