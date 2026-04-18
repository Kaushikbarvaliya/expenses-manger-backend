const Income = require("../models/Income");
const FamilyMember = require("../models/FamilyMember");
const RecurringTransaction = require("../models/RecurringTransaction");
const { buildWorkspaceFilter, requireWorkspacePermission, resolveMember } = require("../utils/workspaceAccess");

const VALID_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];

function computeNextDue(baseDate, frequency) {
  const d = new Date(baseDate);
  if (isNaN(d.getTime())) return null;

  switch (frequency) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
    case "monthly":
    default: d.setMonth(d.getMonth() + 1); break;
  }

  return d.toISOString().slice(0, 10);
}

// GET /api/incomes
exports.getIncomes = async (req, res) => {
  try {
    const guestId = req.guestId || req.query.guestId;

    if (!req.user && guestId) {
      const incomes = await Income.find({ guestId })
        .populate("familyMember", "name relation")
        .sort({ date: -1, createdAt: -1 });
      return res.json(incomes);
    }

    const workspace = await requireWorkspacePermission(req, "view_sheet");
    const incomes = await Income.find(buildWorkspaceFilter(workspace, "user"))
      .populate("familyMember", "name relation")
      .sort({ date: -1, createdAt: -1 });
    res.json(incomes);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// POST /api/incomes
exports.createIncome = async (req, res) => {
  const { name, source, amount, date, method, member, memberId, note, recurring, frequency } = req.body;
  const resolvedSource = source;

  if (!name || !resolvedSource || amount === undefined || !date) {
    return res.status(400).json({ message: "name, source, amount and date are required" });
  }

  if (!resolvedSource.trim()) {
    return res.status(400).json({ message: "source is required" });
  }

  if (!member && !memberId) {
    return res.status(400).json({ message: "member is required" });
  }

  const numericAmount = Number(amount);
  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: "amount must be a positive number" });
  }

  const isRecurring = Boolean(recurring);
  const resolvedFrequency = frequency || "monthly";

  if (isRecurring && !VALID_FREQUENCIES.includes(resolvedFrequency)) {
    return res.status(400).json({ message: `Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(", ")}` });
  }

  try {
    const guestId = req.body.guestId;
    let workspace = null;
    let ownerId = null;
    let sheetId = null;
    let selectedMember = null;
    let selectedUser = null;
    let resolvedMemberName = "Me";

    const resolvedMemberId = memberId || member;

    if (!req.user && guestId) {
       // Guest mode
       resolvedMemberName = "Guest";
    } else if (req.user) {
      workspace = await requireWorkspacePermission(req, "manage_income");
      ownerId = workspace.ownerId;
      sheetId = workspace.sheetId;
      resolvedMemberName = req.user.name;

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
    }

    const isRecurring = Boolean(recurring);
    const resolvedFrequency = frequency || "monthly";
    const nextDue = isRecurring ? computeNextDue(date, resolvedFrequency) : null;

    const income = await Income.create({
      sheet: sheetId,
      user: ownerId,
      guestId: !req.user ? guestId : null,
      name,
      source: resolvedSource.trim(),
      amount: numericAmount,
      date,
      method: method || "salary",
      familyMember: selectedMember || null,
      assignedUser: selectedUser || null,
      familyMemberName: resolvedMemberName,
      note: note || "",
      recurring: isRecurring,
    });

    // If recurring is enabled, create a RecurringTransaction entry
    if (isRecurring) {
        await RecurringTransaction.create({
            sheet: sheetId,
            user: ownerId,
            guestId: !req.user ? guestId : null,
            type: "income",
            name: income.name,
            category: income.source,
            amount: income.amount,
            frequency: resolvedFrequency,
            startDate: income.date,
            nextRunDate: nextDue,
            familyMember: income.familyMember,
            familyMemberName: income.familyMemberName,
            method: income.method,
            note: income.note,
            isActive: true
        });
    }

    const populatedIncome = await income.populate("familyMember", "name relation");

    res.status(201).json(populatedIncome);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// PUT /api/incomes/:id
exports.updateIncome = async (req, res) => {
  const { name, source, amount, date, method, member, memberId, note, recurring } = req.body;
  const resolvedMemberId = memberId || member;

  try {
    const guestId = req.guestId || req.body.guestId || req.query.guestId;
    const resolvedMemberId = memberId || member;
    let filter = { _id: req.params.id };
    let workspace = null;

    if (!req.user && guestId) {
      filter.guestId = guestId;
    } else if (req.user) {
      workspace = await requireWorkspacePermission(req, "manage_income");
      filter = {
        ...filter,
        ...buildWorkspaceFilter(workspace, "user"),
      };
    }

    const income = await Income.findOne(filter);
    if (!income) {
      return res.status(404).json({ message: "Income not found" });
    }

    if (name !== undefined && name !== null) income.name = name.trim() || "Income";
    if (source !== undefined) income.source = source.trim();
    if (amount !== undefined) income.amount = Number(amount);
    if (date !== undefined) income.date = date;
    if (method !== undefined) income.method = method;
    if (note !== undefined) income.note = note;
    if (recurring !== undefined) income.recurring = Boolean(recurring);

    // Handle "self" member like createIncome
    if (resolvedMemberId !== undefined) {
      if (resolvedMemberId === "self" && req.user) {
        income.familyMember = null;
        income.assignedUser = req.user._id;
        income.familyMemberName = req.user.name;
      } else if (resolvedMemberId !== "self" && workspace) {
        const memberInfo = await resolveMember(resolvedMemberId, workspace, req.user);
        if (!memberInfo) {
          return res.status(400).json({ message: "Selected member is invalid" });
        }

        if (memberInfo.type === "user") {
          income.assignedUser = memberInfo.id;
          income.familyMember = null;
        } else {
          income.familyMember = memberInfo.id;
          income.assignedUser = null;
        }
        income.familyMemberName = memberInfo.name;
      } else if (!req.user && guestId) {
        income.familyMemberName = "Guest";
      }
    }

    await income.save();
    const populatedIncome = await income.populate("familyMember", "name relation");
    res.json(populatedIncome);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// DELETE /api/incomes/:id
exports.deleteIncome = async (req, res) => {
  try {
    const guestId = req.guestId || req.query.guestId;
    let filter = { _id: req.params.id };

    if (!req.user && guestId) {
      filter.guestId = guestId;
    } else if (req.user) {
      const workspace = await requireWorkspacePermission(req, "delete_income");
      filter = {
        ...filter,
        ...buildWorkspaceFilter(workspace, "user"),
      };
    }

    const income = await Income.findOne(filter);

    await income.deleteOne();
    res.json({ message: "Income removed" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

