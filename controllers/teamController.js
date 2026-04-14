const crypto = require("crypto");
const Sheet = require("../models/Sheet");
const TeamInvite = require("../models/TeamInvite");
const SharedAccess = require("../models/SharedAccess");
const User = require("../models/User");
const sendOtpEmail = require("../utils/sendOtpEmail");
const { getOrCreateDefaultSheet, requireWorkspacePermission } = require("../utils/workspaceAccess");

const INVITE_EXPIRY_DAYS = Number(process.env.INVITE_EXPIRY_DAYS || 7);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isInviteActive(invite) {
  return !invite.acceptedAt && !invite.revokedAt && invite.expiresAt.getTime() > Date.now();
}

exports.listMySheets = async (req, res) => {
  try {
    const defaultSheet = await getOrCreateDefaultSheet(req.user);
    const ownedRows = await Sheet.find({ owner: req.user._id }).sort({ isDefault: -1, createdAt: -1 }).lean();

    const owned = (ownedRows.length ? ownedRows : [defaultSheet]).map((sheet) => ({
      sheetId: sheet._id,
      sheetName: sheet.name,
      ownerId: req.user._id,
      ownerName: req.user.name,
      ownerEmail: req.user.email,
      role: "owner",
      isOwner: true,
      isDefault: Boolean(sheet.isDefault),
    }));

    const sharedRows = await SharedAccess.find({ member: req.user._id })
      .populate("owner", "name email")
      .populate("sheet", "name isDefault owner")
      .sort({ createdAt: -1 });

    const shared = sharedRows
      .filter((row) => row.owner && row.sheet)
      .map((row) => ({
        sheetId: row.sheet._id,
        sheetName: row.sheet.name,
        ownerId: row.owner._id,
        ownerName: row.owner.name,
        ownerEmail: row.owner.email,
        role: row.role,
        isOwner: false,
        isDefault: Boolean(row.sheet.isDefault),
      }));

    res.json([...owned, ...shared]);
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load sheets" });
  }
};

exports.createSheet = async (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();

  if (!name) {
    return res.status(400).json({ message: "Sheet name is required" });
  }

  try {
    const sheet = await Sheet.create({
      owner: req.user._id,
      name,
      description,
      isDefault: false,
    });

    res.status(201).json({
      sheetId: sheet._id,
      sheetName: sheet.name,
      ownerId: req.user._id,
      ownerName: req.user.name,
      ownerEmail: req.user.email,
      role: "owner",
      isOwner: true,
      isDefault: false,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to create sheet" });
  }
};

exports.sendInvite = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const role = ["admin", "member", "viewer"].includes(req.body.role) ? req.body.role : "member";

  if (!email || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: "Please provide a valid email address" });
  }

  if (req.user.email && normalizeEmail(req.user.email) === email) {
    return res.status(400).json({ message: "You cannot invite yourself" });
  }

  try {
    const workspace = await requireWorkspacePermission(req, "send_invite");
    const sheet = await Sheet.findById(workspace.sheetId).lean();

    if (!sheet) {
      return res.status(404).json({ message: "Sheet not found" });
    }

    const ownerId = workspace.ownerId;

    // Revoke any existing active invites for this member on the selected sheet before sending a new one
    await TeamInvite.updateMany(
      { sheet: workspace.sheetId, email, acceptedAt: null, revokedAt: null },
      { revokedAt: new Date() }
    );

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const alreadyShared = await SharedAccess.findOne({ sheet: workspace.sheetId, member: existingUser._id });
      if (alreadyShared) {
        return res.status(400).json({ message: "This user already has access to your shared sheet" });
      }
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await TeamInvite.create({
      sheet: workspace.sheetId,
      owner: ownerId,
      email,
      role,
      tokenHash,
      expiresAt,
    });

    const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:3000";
    const inviteLink = `${clientOrigin}/invite/${rawToken}`;

    await sendOtpEmail({
      to: email,
      subject: `${req.user.name} invited you to a shared expense sheet`,
      text: `You have been invited to collaborate on the sheet \"${sheet.name}\". Accept invite: ${inviteLink}`,
      html: `
        <div style="line-height:1.6;color:#111">
          <h2>You're invited</h2>
          <p><strong>${req.user.name}</strong> invited you to collaborate on the sheet <strong>${sheet.name}</strong>.</p>
          <p>Role: <strong>${role}</strong></p>
          <p>
            <a href="${inviteLink}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;">
              Accept Invitation
            </a>
          </p>
          <p>Or open this link:</p>
          <p style="word-break:break-all;">${inviteLink}</p>
          <p>This invite expires in ${INVITE_EXPIRY_DAYS} day(s).</p>
        </div>
      `,
    });

    res.status(201).json({
      message: "Invite sent successfully",
      inviteLink,
      expiresAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to send invite" });
  }
};

exports.getInviteByToken = async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ message: "Invite token is required" });
  }

  try {
    const invite = await TeamInvite.findOne({ tokenHash: hashToken(token) }).populate("owner", "name email");
    const sheet = invite?.sheet ? await Sheet.findById(invite.sheet).lean() : null;

    if (!invite || !invite.owner) {
      return res.status(404).json({ message: "Invite not found" });
    }

    if (!isInviteActive(invite)) {
      return res.status(400).json({ message: "Invite is expired or no longer valid" });
    }

    res.json({
      email: invite.email,
      role: invite.role,
      sheetId: invite.sheet,
      sheetName: sheet?.name || "Shared Sheet",
      ownerName: invite.owner.name,
      ownerEmail: invite.owner.email,
      expiresAt: invite.expiresAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load invite" });
  }
};

exports.acceptInvite = async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ message: "Invite token is required" });
  }

  try {
    const invite = await TeamInvite.findOne({ tokenHash: hashToken(token) });

    if (!invite) {
      return res.status(404).json({ message: "Invite not found" });
    }

    if (!isInviteActive(invite)) {
      return res.status(400).json({ message: "Invite is expired or no longer valid" });
    }

    const currentUserEmail = normalizeEmail(req.user.email || "");
    if (!currentUserEmail || currentUserEmail !== invite.email) {
      return res.status(403).json({ message: "Please login with the invited email to accept this invitation" });
    }

    if (String(invite.owner) === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot accept your own invite" });
    }

    await SharedAccess.findOneAndUpdate(
      { sheet: invite.sheet, member: req.user._id },
      { sheet: invite.sheet, owner: invite.owner, member: req.user._id, role: invite.role },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    invite.acceptedAt = new Date();
    await invite.save();

    res.json({
      message: "Invitation accepted. Shared sheet access granted.",
      sheetId: invite.sheet,
      role: invite.role,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to accept invite" });
  }
};
