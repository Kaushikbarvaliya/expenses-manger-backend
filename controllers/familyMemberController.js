const FamilyMember = require("../models/FamilyMember");
const Sheet = require("../models/Sheet");
const SharedAccess = require("../models/SharedAccess");
const User = require("../models/User");
const { buildWorkspaceFilter, requireWorkspacePermission } = require("../utils/workspaceAccess");

// GET /api/family-members
exports.listFamilyMembers = async (req, res) => {
  try {
    const workspace = await requireWorkspacePermission(req, "view_sheet");
    const sheetId = workspace.sheetId;

    // 1. Get manually added family members
    const familyMembers = await FamilyMember.find(buildWorkspaceFilter(workspace, "user")).lean();

    // 2. Get sheet owner
    const sheet = await Sheet.findById(sheetId).populate("owner", "name email").lean();
    let ownerParticipant = null;
    if (sheet && sheet.owner) {
      ownerParticipant = {
        _id: sheet.owner._id,
        name: sheet.owner.name,
        relation: "Owner",
        isSystemUser: true,
        email: sheet.owner.email,
      };
    }

    // 3. Get shared participants
    const sharedAccess = await SharedAccess.find({ sheet: sheetId }).populate("member", "name email").lean();
    const sharedParticipants = sharedAccess
      .filter((sa) => sa.member)
      .map((sa) => ({
        _id: sa.member._id,
        name: sa.member.name,
        relation: sa.role.charAt(0).toUpperCase() + sa.role.slice(1),
        isSystemUser: true,
        email: sa.member.email,
      }));

    // Combine all
    const allMembers = [];
    if (ownerParticipant) allMembers.push(ownerParticipant);
    allMembers.push(...sharedParticipants);
    allMembers.push(...familyMembers.map((m) => ({ ...m, isSystemUser: false })));

    // De-duplicate if a user is also a family member (using id or name)
    const seenMap = new Map();
    const result = [];

    for (const m of allMembers) {
      const id = String(m._id);
      if (!seenMap.has(id)) {
        seenMap.set(id, true);
        result.push(m);
      }
    }

    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// POST /api/family-members
exports.createFamilyMember = async (req, res) => {
  const { name, relation } = req.body;

  if (!name || !relation) {
    return res.status(400).json({ message: "name and relation are required" });
  }

  try {
    const workspace = await requireWorkspacePermission(req, "manage_family");
    const ownerId = workspace.ownerId;
    const member = await FamilyMember.create({
      sheet: workspace.sheetId,
      user: ownerId,
      name,
      relation,
    });

    res.status(201).json(member);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// DELETE /api/family-members/:id
exports.deleteFamilyMember = async (req, res) => {
  try {
    const workspace = await requireWorkspacePermission(req, "manage_family");
    const member = await FamilyMember.findOne({ _id: req.params.id, ...buildWorkspaceFilter(workspace, "user") });

    if (!member) {
      return res.status(404).json({ message: "Family member not found" });
    }

    await member.deleteOne();
    res.json({ message: "Family member removed" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};
