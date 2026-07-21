/**
 * Seeds the database with a super-admin, a planner, a couple of students,
 * sample events, marketplace items and a chat — so the Android app has
 * something to show immediately after you set things up.
 *
 * Run with: npm run seed
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@chukaconnect.co.ke" },
    update: {},
    create: {
      name: "Chuka Connect Admin",
      email: "admin@chukaconnect.co.ke",
      phone: "254700000001",
      passwordHash,
      role: "ADMIN",
      referralCode: "ADMINROOT",
      // totpEnabled stays false until the admin calls POST /api/admin/totp/enroll
      // and scans the QR code — that's the real enrollment step.
    },
  });

  const planner = await prisma.user.upsert({
    where: { email: "planner@chukaconnect.co.ke" },
    update: {},
    create: {
      name: "John Kamau",
      email: "planner@chukaconnect.co.ke",
      phone: "254700000002",
      passwordHash,
      role: "PLANNER",
      referralCode: "PLANNER01",
    },
  });

  const brian = await prisma.user.upsert({
    where: { email: "brian@chukaconnect.co.ke" },
    update: {},
    create: {
      name: "Brian Mwangi",
      email: "brian@chukaconnect.co.ke",
      phone: "254700000003",
      passwordHash,
      role: "STUDENT",
      referralCode: "CHUKA2024",
      level: 12,
      xp: 1250,
    },
  });

  const amina = await prisma.user.upsert({
    where: { email: "amina@chukaconnect.co.ke" },
    update: {},
    create: {
      name: "Amina Yusuf",
      email: "amina@chukaconnect.co.ke",
      phone: "254700000004",
      passwordHash,
      role: "STUDENT",
      referralCode: "CHUKA2025",
      level: 11,
      xp: 1190,
    },
  });

  const event = await prisma.event.upsert({
    where: { id: "seed-event-tech-summit" },
    update: {},
    create: {
      id: "seed-event-tech-summit",
      title: "Chuka Tech Summit 2024",
      tag: "Featured",
      description: "A full day of talks on AI, fintech, and student startups, capped with a demo showcase.",
      date: new Date("2024-06-15T09:00:00Z"),
      location: "CUEA Main Hall",
      price: 300,
      capacity: 400,
      plannerId: planner.id,
    },
  });

  await prisma.event.upsert({
    where: { id: "seed-event-bash" },
    update: {},
    create: {
      id: "seed-event-bash",
      title: "Chuka University End Year Bash",
      tag: "VIP",
      description: "The biggest night of the academic year — live performances, DJs, and a lantern send-off.",
      date: new Date("2024-05-24T18:00:00Z"),
      location: "CUEA Grounds",
      price: 500,
      capacity: 600,
      plannerId: planner.id,
    },
  });

  await prisma.marketplaceItem.createMany({
    data: [
      { title: "E-commerce Website Source Code", category: "Projects", price: 800, rating: 4.8, reviewsCount: 32 },
      { title: "Hospital Management System", category: "Projects", price: 1100, rating: 4.6, reviewsCount: 39 },
      { title: "AI Research Paper Documentation", category: "Documentation", price: 600, rating: 4.7, reviewsCount: 25 },
      { title: "Accounting System Documentation", category: "Documentation", price: 500, rating: 4.5, reviewsCount: 12 },
    ],
    skipDuplicates: true,
  });

  await prisma.project.createMany({
    data: [
      { title: "E-commerce Website", type: "GROUP", progress: 75, dueDate: new Date("2024-06-12"), ownerId: brian.id },
      { title: "AI Chatbot System", type: "INDIVIDUAL", progress: 40, dueDate: new Date("2024-06-20"), ownerId: brian.id },
    ],
    skipDuplicates: true,
  });

  const chat = await prisma.chat.upsert({
    where: { id: "seed-chat-planner" },
    update: {},
    create: { id: "seed-chat-planner", name: "John Kamau (Planner)", isGroup: false },
  });

  await prisma.chatMember.createMany({
    data: [
      { chatId: chat.id, userId: brian.id },
      { chatId: chat.id, userId: planner.id },
    ],
    skipDuplicates: true,
  });

  await prisma.message.create({
    data: { chatId: chat.id, senderId: planner.id, text: "Thanks for registering!" },
  });

  console.log("Seed complete. Login with:");
  console.log("  Admin:   admin@chukaconnect.co.ke / Password123!");
  console.log("  Planner: planner@chukaconnect.co.ke / Password123!");
  console.log("  Student: brian@chukaconnect.co.ke / Password123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
