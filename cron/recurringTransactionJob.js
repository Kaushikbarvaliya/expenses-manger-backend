const cron = require("node-cron");
const mongoose = require("mongoose");
const RecurringTransaction = require("../models/RecurringTransaction");
const Expense = require("../models/Expense");
const Income = require("../models/Income");
const { computeNextDue } = require("../controllers/recurringController");

const startRecurringTransactionCron = () => {
  // Run every day at midnight server time
  cron.schedule("0 0 * * *", async () => {
    console.log("[CRON] Running daily RecurringTransaction check...");
    try {
      const todayString = new Date().toISOString().slice(0, 10);
      const today = new Date(todayString);

      // Find all active recurring transactions due today or earlier
      const dueTransactions = await RecurringTransaction.find({
        isActive: true,
        nextRunDate: { $lte: today },
      });

      if (dueTransactions.length === 0) {
        console.log("[CRON] No recurring transactions due today.");
        return;
      }

      console.log(`[CRON] Found ${dueTransactions.length} recurring transactions to process.`);

      for (const transaction of dueTransactions) {
        const cycleDate = transaction.nextRunDate || today;

        // 1. Create a concrete ledger entry
        if (transaction.type === "expense") {
          await Expense.create({
            sheet: transaction.sheet,
            user: transaction.user,
            guestId: transaction.guestId,
            name: transaction.name,
            category: transaction.category,
            amount: transaction.amount,
            date: cycleDate,
            method: transaction.method,
            familyMember: transaction.familyMember,
            familyMemberName: transaction.familyMemberName,
            note: transaction.note || "Auto-deducted recurring expense",
            recurringTransactionId: transaction._id,
          });
        } else if (transaction.type === "income") {
           await Income.create({
            sheet: transaction.sheet,
            user: transaction.user,
            guestId: transaction.guestId,
            name: transaction.name,
            source: transaction.category, // Map category to source for Income
            amount: transaction.amount,
            date: cycleDate,
            method: transaction.method,
            familyMember: transaction.familyMember,
            familyMemberName: transaction.familyMemberName,
            note: transaction.note || "Auto-added recurring income",
            recurringTransactionId: transaction._id,
          });
        }

        // 2. Advance the template's nextRunDate
        const nextDateStr = computeNextDue(cycleDate, transaction.frequency);
        const nextDateObj = new Date(nextDateStr);

        // 3. If endDate exists and nextRunDate exceeds it, set isActive = false
        if (transaction.endDate && nextDateObj > transaction.endDate) {
          transaction.isActive = false;
        } else {
          transaction.nextRunDate = nextDateStr;
        }

        await transaction.save();

        console.log(`[CRON] Processed recurring ${transaction.type} '${transaction.name}' for cycle ${cycleDate}. Next run: ${nextDateStr}`);
      }

      console.log("[CRON] Daily recurring transaction check completed.");
    } catch (error) {
      console.error("[CRON] Error processing recurring transactions:", error);
    }
  });

  console.log("⏱️  RecurringTransaction Cron Scheduler initialized.");
};

module.exports = startRecurringTransactionCron;
