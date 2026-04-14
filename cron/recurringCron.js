const cron = require("node-cron");
const Expense = require("../models/Expense");
const { computeNextDue } = require("../controllers/expenseController");

const startRecurringCron = () => {
  // Run every day at midnight (Server Time)
  cron.schedule("0 0 * * *", async () => {
    console.log("[CRON] Running daily recurring expense check...");
    try {
      const today = new Date().toISOString().slice(0, 10);
      
      // Find all recurring expenses that are due today or earlier and not paused
      const dueTemplates = await Expense.find({
        recurring: true,
        recurringPaused: false,
        nextDue: { $lte: today },
      });

      if (dueTemplates.length === 0) {
        console.log("[CRON] No recurring expenses due today.");
        return;
      }

      console.log(`[CRON] Found ${dueTemplates.length} recurring expenses to process.`);

      for (const template of dueTemplates) {
        const cycleDate = template.nextDue || today;
        
        // 1. Create a concrete ledger entry for this cycle
        await Expense.create({
          sheet: template.sheet,
          user: template.user,
          name: template.name,
          category: template.category,
          amount: template.amount,
          date: cycleDate,
          method: template.method,
          familyMember: template.familyMember,
          familyMemberName: template.familyMemberName,
          note: template.note || "Auto-deducted recurring expense",
          recurring: false, // This is a specific transaction, not the template
          sourceRecurringId: template._id,
        });

        // 2. Advance the template's nextDue date
        template.nextDue = computeNextDue(cycleDate, template.frequency || "monthly");
        await template.save();
        
        console.log(`[CRON] Processed recurring expense '${template.name}' for cycle ${cycleDate}. Next due: ${template.nextDue}`);
      }
      
      console.log("[CRON] Daily recurring expense check completed.");
    } catch (error) {
      console.error("[CRON] Error processing recurring expenses:", error);
    }
  });

  console.log("⏱️  Recurring Expense Cron Scheduler initialized.");
};

module.exports = startRecurringCron;
