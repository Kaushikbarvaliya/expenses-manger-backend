const mongoose = require("mongoose");
const Budget = require("../models/Budget");
const { buildWorkspaceFilter, requireWorkspacePermission } = require("../utils/workspaceAccess");

// GET /api/budgets
// Returns all budgets for the active workspace, newest first.
exports.getAllBudgets = async (req, res) => {
  try {
    const workspace = await requireWorkspacePermission(req, "view_sheet");
    const filter = buildWorkspaceFilter(workspace, "user");
    const budgets = await Budget.find(filter).sort({ year: -1, month: -1, createdAt: -1 });
    res.json(budgets);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// POST /api/budgets
// Create or update a budget for a specific period (monthly or yearly).
exports.upsertBudget = async (req, res) => {
  // Only extract the fields the backend actually uses — ignore amount, periodValue, dayFilter, etc.
  const { month, year, totalBudget, categories } = req.body;
  let { periodType } = req.body;

  // --- Normalize periodType ---
  // Accept common variants case-insensitively and map to canonical values
  if (typeof periodType === "string") {
    const normalized = periodType.trim().toLowerCase();
    if (normalized === "month" || normalized === "monthly") {
      periodType = "monthly";
    } else if (normalized === "year" || normalized === "yearly" || normalized === "annual") {
      periodType = "yearly";
    } else {
      periodType = normalized; // will fail the validation below
    }
  }

  // --- Validation ---
  if (!periodType || !year || totalBudget === undefined) {
    return res.status(400).json({ message: "periodType, year and totalBudget are required" });
  }

  if (periodType !== "monthly" && periodType !== "yearly") {
    return res.status(400).json({
      message: "periodType must be either 'monthly' or 'yearly'",
    });
  }

  const numericYear = Number(year);
  const numericTotal = Number(totalBudget);

  // For monthly budgets, month is required
  const numericMonth = periodType === "monthly" ? Number(month) : 1;

  if (Number.isNaN(numericYear) || Number.isNaN(numericTotal) || Number.isNaN(numericMonth)) {
    return res.status(400).json({ message: "Invalid numeric values" });
  }

  if (numericYear < 1970 || numericYear > 3000) {
    return res.status(400).json({ message: "Invalid year" });
  }

  if (periodType === "monthly" && (numericMonth < 1 || numericMonth > 12)) {
    return res.status(400).json({ message: "Invalid month (1–12 required for monthly budgets)" });
  }

  if (numericTotal < 0) {
    return res.status(400).json({ message: "totalBudget must be non-negative" });
  }

  const cleanedCategories = Array.isArray(categories)
    ? categories
        .map((item) => ({
          category: String(item.category || "").trim(),
          amount: Number(item.amount || 0),
        }))
        .filter((item) => item.category && !Number.isNaN(item.amount) && item.amount >= 0)
    : [];

  const budgetDate = new Date(Date.UTC(numericYear, numericMonth - 1, 1));

  try {
    const workspace = await requireWorkspacePermission(req, "manage_budget");
    const ownerId = workspace.ownerId;

    // Build the workspace-scoped query
    const workspaceFilter = workspace.isLegacyBackedDefault
      ? {
          user: ownerId,
          $or: [
            { sheet: workspace.sheetId },
            { sheet: null },
            { sheet: { $exists: false } },
          ],
        }
      : { sheet: workspace.sheetId };

    // findOneAndUpdate keyed on period identity
    const query = {
      ...workspaceFilter,
      periodType,
      month: numericMonth,
      year: numericYear,
    };

    const update = {
      sheet: workspace.sheetId,
      user: ownerId,
      periodType,
      budgetDate,
      month: numericMonth,
      year: numericYear,
      totalBudget: numericTotal,
      categories: cleanedCategories,
    };

    const budget = await Budget.findOneAndUpdate(query, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    res.status(201).json(budget);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// DELETE /api/budgets/:id
// Delete a specific budget by its MongoDB _id.
exports.deleteBudgetById = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid budget id" });
  }

  try {
    const workspace = await requireWorkspacePermission(req, "manage_budget");

    // Ensure the budget belongs to this workspace before deleting
    const workspaceFilter = buildWorkspaceFilter(workspace, "user");
    const deleted = await Budget.findOneAndDelete({ _id: id, ...workspaceFilter });

    if (!deleted) {
      return res.status(404).json({ message: "Budget not found or access denied" });
    }

    res.json({ message: "Budget deleted successfully" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};
