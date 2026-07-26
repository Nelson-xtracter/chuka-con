// Lightweight, easily-extended moderation filter. This is NOT a full
// moderation system - it's a keyword/pattern net that flags obviously
// risky messages for an admin to review, not something that silently
// blocks anything. False negatives are expected; that's fine, a human
// reviews flagged messages, this just surfaces likely candidates.

const BLOCKLIST = [
  // profanity - kept short and generic, extend as needed
  "fuck", "shit", "bitch", "asshole",
  // scam / solicitation patterns common in campus chat spam
  "send money", "wire transfer", "bitcoin investment", "click this link",
  "whatsapp me for", "forex trading", "quick loan",
];

function isFlagged(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return BLOCKLIST.some((term) => lower.includes(term));
}

module.exports = { isFlagged };
