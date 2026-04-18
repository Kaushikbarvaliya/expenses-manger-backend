const RecurringTransaction = require("../models/RecurringTransaction");
const { 
  buildWorkspaceFilter, 
  requireWorkspacePermission, 
  resolveWorkspaceContext 
} = require("../utils/workspaceAccess");

const VALID_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];

function computeNextDue(baseDate, frequency) {
  const d = new Date(baseDate);
  if (isNaN(d.getTime())) return null;

  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "monthly":
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }

  return d.toISOString().slice(0, 10);
}

exports.createRecurringTransaction = async (req, res) => {
  try {
    const {
      type,
      title,
      amount,
      category,
      frequency,
      startDate,
      endDate,
      guestId,
      familyMemberName,
      method,
    } = req.body;

    if (!type || !["income", "expense"].includes(type)) {
      return res.status(400).json({ message: "Valid type (income, expense) is required" });
    }
    if (!title || !amount || !category || !frequency || !startDate) {
      return res.status(400).json({ message: "title, amount, category, frequency, and startDate are required" });
    }
    if (!VALID_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ message: `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}` });
    }

    if (!req.user && !guestId) {
      return res.status(400).json({ message: "User must be authenticated or provide a guestId" });
    }

    let workspace;
    let ownerId;
    let sheetId;

    if (req.user) {
        workspace = await requireWorkspacePermission(req, "manage_expenses");
        ownerId = workspace.ownerId;
        sheetId = workspace.sheetId;
    }

    const nextRunDate = computeNextDue(startDate, frequency);

    const recurringTransaction = await RecurringTransaction.create({
      sheet: sheetId || null,
      user: ownerId || null,
      guestId: !req.user ? guestId : null,
      type,
      name: title,
      category,
      amount: Number(amount),
      frequency,
      startDate,
      endDate: endDate || null,
      nextRunDate,
      familyMemberName: familyMemberName || (req.user ? req.user.name : "Guest"),
      method: method || "netbanking",
      isActive: true,
    });

    res.status(201).json(recurringTransaction);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.getRecurringTransactions = async (req, res) => {
  try {
    const guestId = req.query.guestId;

    if (!req.user && guestId) {
      const transactions = await RecurringTransaction.find({ guestId }).sort({ createdAt: -1 });
      return res.json(transactions);
    }

    const workspace = await requireWorkspacePermission(req, "view_sheet");
    const filter = buildWorkspaceFilter(workspace, "user");

    const transactions = await RecurringTransaction.find(filter).sort({ createdAt: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.updateRecurringTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, amount, category, frequency, startDate, endDate, isActive } = req.body;

    const guestId = req.body.guestId || req.query.guestId;

    let filter = { _id: id };
    if (!req.user && guestId) {
        filter.guestId = guestId;
    } else if (req.user) {
        const workspace = await requireWorkspacePermission(req, "manage_expenses");
        filter = {
            ...filter,
            ...buildWorkspaceFilter(workspace, "user")
        };
    } else {
        return res.status(400).json({ message: "Not authorized or missing guestId" });
    }

    const transaction = await RecurringTransaction.findOne(filter);

    if (!transaction) {
      return res.status(404).json({ message: "Recurring transaction not found" });
    }

    if (title) transaction.name = title;
    if (amount) transaction.amount = Number(amount);
    if (category) transaction.category = category;

    let needsRecalculation = false;
    if (frequency && VALID_FREQUENCIES.includes(frequency)) {
      transaction.frequency = frequency;
      needsRecalculation = true;
    }
    if (startDate) {
      transaction.startDate = startDate;
      needsRecalculation = true;
    }

    if (endDate !== undefined) transaction.endDate = endDate;
    if (isActive !== undefined) transaction.isActive = Boolean(isActive);

    if (needsRecalculation) {
      transaction.nextRunDate = computeNextDue(transaction.startDate, transaction.frequency);
    }

    await transaction.save();
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteRecurringTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const guestId = req.query.guestId;

    let filter = { _id: id };
    if (!req.user && guestId) {
        filter.guestId = guestId;
    } else if (req.user) {
        const workspace = await requireWorkspacePermission(req, "manage_expenses");
        filter = {
            ...filter,
            ...buildWorkspaceFilter(workspace, "user")
        };
    } else {
        return res.status(400).json({ message: "Not authorized or missing guestId" });
    }

    const transaction = await RecurringTransaction.findOne(filter);
    if (!transaction) {
      return res.status(404).json({ message: "Recurring transaction not found" });
    }

    await transaction.deleteOne();
    res.json({ message: "Recurring transaction deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.toggleRecurringTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const guestId = req.body.guestId || req.query.guestId;

    let filter = { _id: id };
    if (!req.user && guestId) {
        filter.guestId = guestId;
    } else if (req.user) {
        const workspace = await requireWorkspacePermission(req, "manage_expenses");
        filter = {
            ...filter,
            ...buildWorkspaceFilter(workspace, "user")
        };
    } else {
        return res.status(400).json({ message: "Not authorized or missing guestId" });
    }

    const transaction = await RecurringTransaction.findOne(filter);
    if (!transaction) {
      return res.status(404).json({ message: "Recurring transaction not found" });
    }

    transaction.isActive = !transaction.isActive;
    
    // If resuming and nextRunDate is passed, recalculate it based on today
    if (transaction.isActive && transaction.nextRunDate) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const nextRunStr = new Date(transaction.nextRunDate).toISOString().slice(0,10);
        
        if (nextRunStr < todayStr) {
            transaction.nextRunDate = computeNextDue(todayStr, transaction.frequency);
        }
    }

    await transaction.save();
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.computeNextDue = computeNextDue;
