const Sheet = require("../models/Sheet");
const { requireWorkspacePermission, buildWorkspaceFilter } = require("../utils/workspaceAccess");

// GET /api/sheets - Get user's sheets
exports.getSheets = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get all sheets owned by the user
    const sheets = await Sheet.find({ owner: userId })
      .sort({ isDefault: -1, createdAt: -1 });
    
    res.json(sheets);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// POST /api/sheets - Create a new sheet
exports.createSheet = async (req, res) => {
  try {
    const { name, description, isDefault } = req.body;
    const userId = req.user._id;

    if (!name || name.trim() === '') {
      return res.status(400).json({ message: "Sheet name is required" });
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await Sheet.updateMany({ owner: userId }, { isDefault: false });
    }

    const sheet = await Sheet.create({
      owner: userId,
      name: name.trim(),
      description: description?.trim() || "",
      isDefault: isDefault || false
    });

    res.status(201).json(sheet);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};
