/**
 * Gamification engine: awarding XP and computing levels.
 * Level curve: each level requires (level * 200) more XP than the last.
 * This is intentionally simple and easy to tune from one place.
 */
const { prisma } = require("../config/db");

function xpRequiredForLevel(level) {
  // Total cumulative XP needed to reach `level`
  let total = 0;
  for (let l = 1; l < level; l++) total += l * 200;
  return total;
}

function levelForXp(xp) {
  let level = 1;
  while (xp >= xpRequiredForLevel(level + 1)) level++;
  return level;
}

async function awardXp(userId, amount, reason) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const newXp = user.xp + amount;
  const newLevel = levelForXp(newXp);

  await prisma.xpEvent.create({ data: { userId, amount, reason } });

  return prisma.user.update({
    where: { id: userId },
    data: { xp: newXp, level: newLevel },
  });
}

module.exports = { awardXp, levelForXp, xpRequiredForLevel };
