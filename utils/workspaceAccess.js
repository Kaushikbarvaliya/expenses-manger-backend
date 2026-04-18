const mongoose = require("mongoose");
const Sheet = require("../models/Sheet");
const SharedAccess = require("../models/SharedAccess");
const User = require("../models/User");
const FamilyMember = require("../models/FamilyMember");

const PERMISSIONS = {
  view_sheet: ["owner", "admin", "member", "viewer"],
  manage_expenses: ["owner", "admin", "member"],
  delete_expenses: ["owner", "admin"],
  manage_family: ["owner", "admin"],
manage_budget: ["owner", "admin"],
  manage_income: ["owner", "admin", "member"],
  delete_income: ["owner", "admin"],
  send_invite: ["owner", "admin"],
};

function hasPermission(role, permission) {
  const allowedRoles = PERMISSIONS[permission] || [];
  return allowedRoles.includes(role);
}

async function getOrCreateDefaultSheet(user) {
  let sheet = await Sheet.findOne({ owner: user._id, isDefault: true }).lean();

  if (!sheet) {
    const createdSheet = await Sheet.create({
      owner: user._id,
      name: "My Sheet",
      description: "Default personal expense sheet",
      isDefault: true,
    });

    sheet = createdSheet.toObject();
  }

  return sheet;
}

function buildWorkspaceFilter(context, legacyOwnerField = "user") {
  if (context.isLegacyBackedDefault) {
    return {
      $or: [
        { sheet: context.sheetId },
        { sheet: null, [legacyOwnerField]: context.ownerId },
        { sheet: { $exists: false }, [legacyOwnerField]: context.ownerId },
      ],
    };
  }

  return { sheet: context.sheetId };
}

async function resolveWorkspaceContext(req) {
  const requestedSheetId = String(req.query.sheetId || req.query.sheetOwnerId || "").trim();

  if (!req.user) {
    // Guest mode
    return {
      sheetId: null,
      ownerId: null,
      role: "owner", // Guest owns their own data
      isOwner: true,
      isLegacyBackedDefault: false,
    };
  }

  const defaultSheet = await getOrCreateDefaultSheet(req.user);
  const currentUserId = String(req.user._id);

  if (!requestedSheetId) {
    return {
      sheetId: defaultSheet._id,
      sheetName: defaultSheet.name,
      ownerId: req.user._id,
      role: "owner",
      isOwner: true,
      isLegacyBackedDefault: true,
    };
  }

  if (!mongoose.Types.ObjectId.isValid(requestedSheetId)) {
    const error = new Error("Invalid sheet id");
    error.statusCode = 400;
    throw error;
  }

  const sheet = await Sheet.findById(requestedSheetId).lean();

  if (!sheet) {
    const error = new Error("Sheet not found");
    error.statusCode = 404;
    throw error;
  }

  if (String(sheet.owner) === currentUserId) {
    return {
      sheetId: sheet._id,
      sheetName: sheet.name,
      ownerId: new mongoose.Types.ObjectId(currentUserId),
      role: "owner",
      isOwner: true,
      isLegacyBackedDefault: Boolean(sheet.isDefault),
    };
  }

  const accessRow = await SharedAccess.findOne({
    $or: [
      { sheet: requestedSheetId },
      { sheet: null, owner: sheet.owner },
      { sheet: { $exists: false }, owner: sheet.owner },
    ],
    member: req.user._id,
  }).lean();

  if (!accessRow) {
    const error = new Error("You do not have access to this sheet");
    error.statusCode = 403;
    throw error;
  }

  return {
    sheetId: sheet._id,
    sheetName: sheet.name,
    ownerId: new mongoose.Types.ObjectId(String(sheet.owner)),
    role: accessRow.role || "member",
    isOwner: false,
    isLegacyBackedDefault: false,
  };
}

async function resolveWorkspaceOwnerId(req) {
  const context = await resolveWorkspaceContext(req);
  return context.ownerId;
}

async function requireWorkspacePermission(req, permission) {
  const context = await resolveWorkspaceContext(req);

  if (!hasPermission(context.role, permission)) {
    const error = new Error("Your role does not allow this action on the selected sheet");
    error.statusCode = 403;
    throw error;
  }

  return context;
}

module.exports = {
  buildWorkspaceFilter,
  getOrCreateDefaultSheet,
  resolveWorkspaceContext,
  resolveWorkspaceOwnerId,
  requireWorkspacePermission,
  resolveMember,
};

async function resolveMember(memberId, context, currentUser) {
  if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
    return null;
  }

  // 1. Check if it's the owner of the sheet
  if (String(context.ownerId) === String(memberId)) {
    const owner = await User.findById(context.ownerId).lean();
    return {
      type: "user",
      id: owner._id,
      name: owner.name,
      isOwner: true,
    };
  }

  // 2. Check if it's a shared collaborator
  const shared = await SharedAccess.findOne({
    sheet: context.sheetId,
    member: memberId,
  }).populate("member", "name email").lean();

  if (shared && shared.member) {
    return {
      type: "user",
      id: shared.member._id,
      name: shared.member.name,
      isOwner: false,
    };
  }

  // 3. Check if it's a manually added family member
  const familyFilter = {
    _id: memberId,
    ...buildWorkspaceFilter(context, "user"),
  };
  const fm = await FamilyMember.findOne(familyFilter).lean();

  if (fm) {
    return {
      type: "family",
      id: fm._id,
      name: fm.name,
      isOwner: false,
    };
  }

  return null;
}
