const Income = require("../models/Income");
const FamilyMember = require("../models/FamilyMember");
const { buildWorkspaceFilter, requireWorkspacePermission, resolveMember } = require("../utils/workspaceAccess");

// GET /api/incomes
exports.getIncomes = async (req, res) => {
  try {
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
  const { name, source, amount, date, method, member, memberId, note, recurring } = req.body;
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

  try {
    const workspace = await requireWorkspacePermission(req, "manage_income");
    const ownerId = workspace.ownerId;
    const resolvedMemberId = memberId || member;
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

    const income = await Income.create({
      sheet: workspace.sheetId,
      user: ownerId,
      name,
      source: resolvedSource.trim(),
      amount: numericAmount,
      date,
      method: method || "salary",
      familyMember: selectedMember || null,
      assignedUser: selectedUser || null,
      familyMemberName: resolvedMemberName,
      note: note || "",
      recurring: Boolean(recurring),
    });

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
    const workspace = await requireWorkspacePermission(req, "manage_income");
    const income = await Income.findOne({ _id: req.params.id, ...buildWorkspaceFilter(workspace, "user") });
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
      if (resolvedMemberId === "self") {
        income.familyMember = null;
        income.assignedUser = req.user._id;
        income.familyMemberName = req.user.name;
      } else {
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
    const workspace = await requireWorkspacePermission(req, "delete_income");
    const income = await Income.findOne({ _id: req.params.id, ...buildWorkspaceFilter(workspace, "user") });

    if (!income) {
      return res.status(404).json({ message: "Income not found" });
    }

    await income.deleteOne();
    res.json({ message: "Income removed" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

