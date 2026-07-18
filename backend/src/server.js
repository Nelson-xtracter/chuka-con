require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth.routes");
const eventsRoutes = require("./routes/events.routes");
const projectsRoutes = require("./routes/projects.routes");
const marketplaceRoutes = require("./routes/marketplace.routes");
const plagiarismRoutes = require("./routes/plagiarism.routes");
const submissionsRoutes = require("./routes/submissions.routes");
const paymentsRoutes = require("./routes/payments.routes");
const chatRoutes = require("./routes/chat.routes");
const plannerRoutes = require("./routes/planner.routes");
const adminRoutes = require("./routes/admin.routes");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "*").split(","),
  })
);
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "5mb" }));

// Basic protection against brute-forcing login/admin-login.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/admin-login", authLimiter);

app.get("/health", (req, res) => res.json({ ok: true, service: "chuka-connect-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/marketplace", marketplaceRoutes);
app.use("/api/plagiarism", plagiarismRoutes);
app.use("/api/submissions", submissionsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/planner", plannerRoutes);
app.use("/api/admin", adminRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Central error handler (catches anything thrown synchronously in route handlers)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Chuka Connect backend running on http://localhost:${PORT}`);
});
