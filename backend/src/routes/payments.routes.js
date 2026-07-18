const express = require("express");
const { prisma } = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const mpesa = require("../services/mpesa");
const { awardXp } = require("../services/xp");

const router = express.Router();

// ---------- Student/planner initiates a payment ----------
router.post("/stk-push", requireAuth, async (req, res) => {
  try {
    const { purpose, relatedId, phone, amount } = req.body;
    if (!phone || !amount) return res.status(400).json({ error: "phone and amount are required" });

    const payment = await prisma.payment.create({
      data: { purpose, amount, phone, relatedId, userId: req.user.id, status: "PENDING" },
    });

    const stkResult = await mpesa.stkPush({
      phone,
      amount,
      accountRef: `CHUKA-${purpose}`,
      description: purposeLabel(purpose),
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { mpesaCheckoutId: stkResult.CheckoutRequestID },
    });

    res.json({
      paymentId: payment.id,
      checkoutRequestId: stkResult.CheckoutRequestID,
      customerMessage: stkResult.CustomerMessage || "Enter your M-Pesa PIN on your phone to complete payment.",
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      error:
        "Could not start M-Pesa payment. Check that MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY are set correctly in .env.",
    });
  }
});

function purposeLabel(purpose) {
  switch (purpose) {
    case "EVENT_TICKET": return "Event Ticket";
    case "PREMIUM_SUBSCRIPTION": return "Premium Sub";
    case "MARKETPLACE_ITEM": return "Marketplace";
    case "PLANNER_SUBSCRIPTION": return "Planner Sub";
    default: return "Payment";
  }
}

// ---------- Safaricom calls this asynchronously once the customer confirms or cancels ----------
router.post("/mpesa/callback", async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return res.status(400).json({ error: "Malformed callback" });

    const payment = await prisma.payment.findFirst({ where: { mpesaCheckoutId: callback.CheckoutRequestID } });
    if (!payment) return res.status(200).json({ received: true }); // ack anyway, Safaricom retries otherwise

    if (callback.ResultCode === 0) {
      const items = callback.CallbackMetadata?.Item || [];
      const receipt = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value;

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "SUCCESS", mpesaReceipt: receipt, completedAt: new Date() },
      });

      await fulfillPayment(payment);
    } else {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(200).json({ received: true }); // always 200 so Safaricom doesn't hammer retries
  }
});

/** Grants whatever the payment was for, once M-Pesa confirms success. */
async function fulfillPayment(payment) {
  if (payment.purpose === "EVENT_TICKET" && payment.relatedId) {
    await prisma.ticket.create({
      data: {
        code: `TCK-${payment.id.slice(0, 8).toUpperCase()}`,
        eventId: payment.relatedId,
        userId: payment.userId,
        isVip: false,
      },
    });
    await awardXp(payment.userId, 30, "Bought an event ticket");
  }

  if (payment.purpose === "PREMIUM_SUBSCRIPTION") {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    await prisma.user.update({
      where: { id: payment.userId },
      data: { isPremium: true, premiumExpiresAt: expiry },
    });
  }

  if (payment.purpose === "MARKETPLACE_ITEM" && payment.relatedId) {
    const item = await prisma.marketplaceItem.findUnique({ where: { id: payment.relatedId } });
    if (item) {
      const commission = Math.round(item.price * 0.7);
      await prisma.purchase.create({
        data: { itemId: item.id, buyerId: payment.userId, amount: item.price, commission },
      });
    }
  }
}

// ---------- Poll status (used by the Android app while waiting for the callback) ----------
router.get("/:id/status", requireAuth, async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json({ paymentId: payment.id, status: payment.status });
});

module.exports = router;
