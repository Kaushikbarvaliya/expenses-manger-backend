const Expense = require("../models/Expense");
const FamilyMember = require("../models/FamilyMember");
const { buildWorkspaceFilter, requireWorkspacePermission, resolveMember } = require("../utils/workspaceAccess");

// ─── helpers ────────────────────────────────────────────────────────────────

const VALID_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"];

/**
 * Given a base date and a frequency string, return the next occurrence date
 * as a YYYY-MM-DD string.
 */
function computeNextDue(baseDate, frequency) {
  const d = new Date(baseDate);
  if (isNaN(d.getTime())) return null;

  switch (frequency) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
    case "monthly":
    default: d.setMonth(d.getMonth() + 1); break;
  }

  return d.toISOString().slice(0, 10);
}

exports.computeNextDue = computeNextDue;

// ─── GET /api/expenses ───────────────────────────────────────────────────────
exports.getExpenses = async (req, res) => {
  try {
    const workspace = await requireWorkspacePermission(req, "view_sheet");
    const expenses = await Expense.find(buildWorkspaceFilter(workspace, "user"))
      .populate("familyMember", "name relation")
      .sort({ date: -1, createdAt: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// ─── GET /api/expenses/recurring ────────────────────────────────────────────
/**
 * Returns only recurring expenses, optionally filtered by:
 *   ?frequency=monthly|weekly|quarterly|yearly
 *   ?paused=true|false
 *   ?dueSoon=true   →  nextDue within the next 7 days
 */
exports.getRecurringExpenses = async (req, res) => {
  try {
    const workspace = await requireWorkspacePermission(req, "view_sheet");

    const filter = {
      ...buildWorkspaceFilter(workspace, "user"),
      recurring: true,
    };

    if (req.query.frequency) {
      filter.frequency = req.query.frequency;
    }

    if (req.query.paused !== undefined) {
      filter.recurringPaused = req.query.paused === "true";
    }

    let expenses = await Expense.find(filter)
      .populate("familyMember", "name relation")
      .sort({ nextDue: 1, date: -1 });

    // Filter by dueSoon after fetch (avoids complex date range query)
    if (req.query.dueSoon === "true") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 7);
      expenses = expenses.filter((e) => {
        if (!e.nextDue) return false;
        const nd = new Date(e.nextDue);
        return !isNaN(nd.getTime()) && nd <= cutoff;
      });
    }

    res.json(expenses);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// ─── POST /api/expenses ──────────────────────────────────────────────────────
exports.createExpense = async (req, res) => {
  const {
    name, cat, category, amount, date, method,
    member, memberId, note,
    recurring, frequency,
  } = req.body;

  const resolvedCategory = category || cat;
  const resolvedMemberId = memberId || member;

  if (!name || !resolvedCategory || amount === undefined || !date) {
    return res.status(400).json({ message: "name, category, amount and date are required" });
  }

  if (!resolvedMemberId) {
    return res.status(400).json({ message: "member is required" });
  }

  const numericAmount = Number(amount);
  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: "amount must be a positive number" });
  }

  const isRecurring = Boolean(recurring);
  const resolvedFrequency = isRecurring
    ? (VALID_FREQUENCIES.includes(frequency) ? frequency : "monthly")
    : null;

  if (isRecurring && frequency && !VALID_FREQUENCIES.includes(frequency)) {
    return res.status(400).json({
      message: `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}`,
    });
  }

  try {
    const workspace = await requireWorkspacePermission(req, "manage_expenses");
    const ownerId = workspace.ownerId;

    let selectedMember = null;
    let selectedUser = null;
    let resolvedMemberName = req.user.name;

    if (resolvedMemberId === "self") {
      selectedUser = req.user._id;
      resolvedMemberName = req.user.name;
    } else {
      const memberInfo = await resolveMember(resolvedMemberId, workspace, req.user);
      if (!memberInfo) {
        return res.status(400).json({ message: "Selected member is invalid" });
      }

      if (memberInfo.type === "user") {
        selectedUser = memberInfo.id;
      } else {
        selectedMember = memberInfo.id;
      }
      resolvedMemberName = memberInfo.name;
    }

    const expense = await Expense.create({
      sheet: workspace.sheetId,
      user: ownerId,
      name,
      category: resolvedCategory,
      amount: numericAmount,
      date,
      method,
      familyMember: selectedMember || null,
      assignedUser: selectedUser || null,
      familyMemberName: resolvedMemberName,
      note,
      recurring: isRecurring,
      frequency: resolvedFrequency,
      nextDue: isRecurring ? computeNextDue(date, resolvedFrequency) : null,
      recurringPaused: false,
    });

    const populatedExpense = await expense.populate("familyMember", "name relation");
    res.status(201).json(populatedExpense);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// ─── PUT /api/expenses/:id ───────────────────────────────────────────────────
exports.updateExpense = async (req, res) => {
  const {
    name, cat, category, amount, date, method,
    member, memberId, note,
    recurring, frequency,
  } = req.body;

  const resolvedCategory = category || cat;
  const resolvedMemberId = memberId || member;

  if (frequency && !VALID_FREQUENCIES.includes(frequency)) {
    return res.status(400).json({
      message: `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}`,
    });
  }

  try {
    const workspace = await requireWorkspacePermission(req, "manage_expenses");
    const expense = await Expense.findOne({
      _id: req.params.id,
      ...buildWorkspaceFilter(workspace, "user"),
    });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    if (name !== undefined && name !== null) expense.name = name.trim() || "Expense";
    if (resolvedCategory !== undefined) expense.category = resolvedCategory;
    if (amount !== undefined) expense.amount = Number(amount);
    if (date !== undefined) expense.date = date;
    if (method !== undefined) expense.method = method;
    if (note !== undefined) expense.note = note;

    // ── Recurring fields ──
    if (recurring !== undefined) {
      expense.recurring = Boolean(recurring);
    }

    const isNowRecurring = expense.recurring;

    if (frequency !== undefined && isNowRecurring) {
      expense.frequency = VALID_FREQUENCIES.includes(frequency) ? frequency : "monthly";
    }

    if (!isNowRecurring) {
      // Turning recurring off — clear recurring-specific fields
      expense.frequency = null;
      expense.nextDue = null;
      expense.recurringPaused = false;
    } else {
      // Recompute nextDue whenever date or frequency changes
      const baseDate = date !== undefined ? date : expense.date;
      const freq = expense.frequency || "monthly";
      expense.nextDue = computeNextDue(baseDate, freq);
    }

    // ── Family member ──
    if (resolvedMemberId !== undefined) {
      if (resolvedMemberId === "self") {
        expense.familyMember = null;
        expense.assignedUser = req.user._id;
        expense.familyMemberName = req.user.name;
      } else {
        const memberInfo = await resolveMember(resolvedMemberId, workspace, req.user);
        if (!memberInfo) {
          return res.status(400).json({ message: "Selected member is invalid" });
        }

        if (memberInfo.type === "user") {
          expense.assignedUser = memberInfo.id;
          expense.familyMember = null;
        } else {
          expense.familyMember = memberInfo.id;
          expense.assignedUser = null;
        }
        expense.familyMemberName = memberInfo.name;
      }
    }

    await expense.save();
    const populatedExpense = await expense.populate("familyMember", "name relation");
    res.json(populatedExpense);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// ─── PATCH /api/expenses/:id/pause ──────────────────────────────────────────
/**
 * Toggle or explicitly set the paused state of a recurring expense.
 * Body: { paused: true|false }   (omit to toggle)
 */
exports.pauseRecurringExpense = async (req, res) => {
  try {
    const workspace = await requireWorkspacePermission(req, "manage_expenses");
    const expense = await Expense.findOne({
      _id: req.params.id,
      ...buildWorkspaceFilter(workspace, "user"),
    });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    if (!expense.recurring) {
      return res.status(400).json({ message: "Expense is not a recurring expense" });
    }

    expense.recurringPaused =
      req.body.paused !== undefined ? Boolean(req.body.paused) : !expense.recurringPaused;

    await expense.save();
    const populatedExpense = await expense.populate("familyMember", "name relation");
    res.json(populatedExpense);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// ─── POST /api/expenses/:id/process ─────────────────────────────────────────
/**
 * "Process" a recurring expense: mark it as paid for the current cycle and
 * advance nextDue to the following period.
 *
 * Optionally creates a new one-off expense entry for this cycle's payment
 * (useful for keeping a full history) if `createEntry: true` is sent in the body.
 */
exports.processRecurringExpense = async (req, res) => {
  try {
    const workspace = await requireWorkspacePermission(req, "manage_expenses");
    const template = await Expense.findOne({
      _id: req.params.id,
      ...buildWorkspaceFilter(workspace, "user"),
    });

    if (!template) {
      return res.status(404).json({ message: "Expense not found" });
    }

    if (!template.recurring) {
      return res.status(400).json({ message: "Expense is not a recurring expense" });
    }

    if (template.recurringPaused) {
      return res.status(400).json({ message: "Cannot process a paused recurring expense" });
    }

    const cycleDate = template.nextDue || new Date().toISOString().slice(0, 10);

    // Advance to the next cycle
    template.nextDue = computeNextDue(cycleDate, template.frequency || "monthly");
    await template.save();

    // Optionally write a concrete expense entry for this payment
    let entry = null;
    if (req.body.createEntry !== false) {
      entry = await Expense.create({
        sheet: template.sheet,
        user: template.user,
        name: template.name,
        category: template.category,
        amount: template.amount,
        date: cycleDate,
        method: template.method,
        familyMember: template.familyMember,
        familyMemberName: template.familyMemberName,
        note: template.note,
        recurring: false,   // one-off copy – not a recurring template
        sourceRecurringId: template._id,
      });
      await entry.populate("familyMember", "name relation");
    }

    const populatedTemplate = await template.populate("familyMember", "name relation");
    res.json({ template: populatedTemplate, entry });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// ─── POST /api/expenses/voice ───────────────────────────────────────────────
/**
 * Voice command handler for expenses.
 * Expected body: { transcript: string }
 */
exports.processVoiceExpense = async (req, res) => {
  const { transcript } = req.body;

  if (!transcript) {
    return res.status(400).json({ message: "transcript is required" });
  }

  const lowerTranscript = transcript.toLowerCase().trim();

  // 1. Check for special commands
  if (lowerTranscript.includes("show expenses") || lowerTranscript.includes("list expenses")) {
    return res.json({ action: "navigate", target: "AllExpenses", message: "Showing all expenses" });
  }

  if (lowerTranscript.includes("delete last expense") || lowerTranscript.includes("remove last expense")) {
    try {
      const workspace = await requireWorkspacePermission(req, "delete_expenses");
      const lastExpense = await Expense.findOne(buildWorkspaceFilter(workspace, "user"))
        .sort({ createdAt: -1 });

      if (!lastExpense) {
        return res.status(404).json({ message: "No expenses found to delete" });
      }

      await lastExpense.deleteOne();
      return res.json({ action: "refresh", message: `Deleted last expense: ${lastExpense.name}` });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ message: error.message });
    }
  }

  // 2. Parse expense command
  // Support both "Add 500 for pizza" and "pizza 200"
  const amountMatch = lowerTranscript.match(/(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

  if (amount <= 0) {
    return res.status(400).json({ 
      error: "MISSING_AMOUNT",
      message: "Could not detect a valid amount. Please say something like 'Pizza 200' or '200 for food'." 
    });
  }

  // Extract Name/Category
  let name = "";
  const separators = [" for ", " on ", " in ", " ke liye "];
  let foundSeparator = false;

  for (const sep of separators) {
    if (lowerTranscript.includes(sep)) {
      const parts = lowerTranscript.split(sep);
      name = parts[1].trim();
      foundSeparator = true;
      break;
    }
  }

  if (!foundSeparator) {
    // Try to extract name from "pizza 200" or "200 pizza"
    // Remove the amount from the string and clean up
    name = lowerTranscript.replace(amountMatch[0], "").replace(/add|expense|spent|paid/g, "").trim();
  }

  if (!name || name.length < 2) {
    name = "Voice Expense";
  }

  // Improved Category Mapping
  const categoryMap = {
    "Food": ["pizza", "burger", "dinner", "lunch", "breakfast", "khana", "nashta", "chai", "coffee", "restaurant", "swiggy", "zomato", "eat", "food"],
    "Travel": ["uber", "ola", "taxi", "bus", "train", "flight", "petrol", "diesel", "fuel", "auto", "rickshaw", "ghoomna", "travel", "conveyance"],
    "Shopping": ["amazon", "flipkart", "clothes", "shoes", "mall", "shopping", "clothes", "myntra"],
    "Utilities": ["bill", "electricity", "bijli", "water", "gas", "recharge", "phone", "internet", "wifi"],
    "Rent": ["rent", "kiraya", "office rent", "room rent"],
    "Health": ["doctor", "medicine", "dawai", "hospital", "gym", "health", "checkup"],
    "Entertainment": ["movie", "netflix", "game", "party", "fun", "club", "cinema"],
    "Education": ["fees", "school", "college", "book", "course", "udemy"],
    "General": ["kharcha", "misc", "general", "others"]
  };

  let detectedCategory = "Others";
  const searchString = `${name} ${lowerTranscript}`;
  
  for (const [cat, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(kw => searchString.includes(kw))) {
      detectedCategory = cat;
      break;
    }
  }

  // Capitalize name for cleaner display
  name = name.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

  try {
    const workspace = await requireWorkspacePermission(req, "manage_expenses");
    const ownerId = workspace.ownerId;
    const date = new Date().toISOString().slice(0, 10);

    const expense = await Expense.create({
      sheet: workspace.sheetId,
      user: ownerId,
      name,
      category: detectedCategory.toLowerCase(),
      amount,
      date,
      method: "upi",
      familyMember: null,
      assignedUser: req.user._id,
      familyMemberName: req.user.name,
      note: `Added via voice: "${transcript}"`,
      recurring: false,
    });

    const populatedExpense = await expense.populate("familyMember", "name relation");
    
    // Return structured JSON as requested
    res.status(201).json({
      action: "created",
      message: `Added: ${name} - ₹${amount} in ${detectedCategory}`,
      data: {
        amount,
        category: detectedCategory,
        name: name,
        original_transcript: transcript
      },
      expense: populatedExpense,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// ─── DELETE /api/expenses/:id ────────────────────────────────────────────────
exports.deleteExpense = async (req, res) => {
  try {
    const workspace = await requireWorkspacePermission(req, "delete_expenses");
    const expense = await Expense.findOne({
      _id: req.params.id,
      ...buildWorkspaceFilter(workspace, "user"),
    });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    await expense.deleteOne();
    res.json({ message: "Expense removed" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};