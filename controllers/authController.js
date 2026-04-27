const User = require("../models/User");
const Expense = require("../models/Expense");
const Income = require("../models/Income");
const RecurringTransaction = require("../models/RecurringTransaction");
const TeamInvite = require("../models/TeamInvite");
const SharedAccess = require("../models/SharedAccess");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const generateToken = require("../utils/generateToken");
const sendOtpEmail = require("../utils/sendOtpEmail");
const { getOrCreateDefaultSheet } = require("../utils/workspaceAccess");
const mongoose = require("mongoose");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

async function validateResetOtp(user, otp) {
  if (!user || !user.passwordResetOtpHash) {
    return "No active reset request found";
  }

  if (user.passwordResetOtpExpiresAt && new Date(user.passwordResetOtpExpiresAt) < new Date()) {
    return "OTP has expired. Please request a new one.";
  }

  if (hashOtp(otp) !== user.passwordResetOtpHash) {
    return "Invalid reset OTP";
  }

  return null;
}

async function autoAcceptInvitesForEmail(user) {
  if (!user.email) return 0;

  const email = normalizeEmail(user.email);
  const now = new Date();

  const pendingInvites = await TeamInvite.find({
    email,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { $gt: now },
  }).lean();

  let accepted = 0;
  for (const invite of pendingInvites) {
    if (String(invite.owner) === String(user._id)) continue;

    await SharedAccess.findOneAndUpdate(
      { sheet: invite.sheet, member: user._id },
      { sheet: invite.sheet, owner: invite.owner, member: user._id, role: invite.role },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await TeamInvite.findByIdAndUpdate(invite._id, { acceptedAt: now });
    accepted++;
  }
  return accepted;
}

// REGISTER (email/password)
exports.registerUser = async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Please provide name, email and password" });
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: "Please provide a valid email address" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const otp = generateOtp();
    const otpHash = hashOtp(otp);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      isVerified: false,
      verificationOtpHash: otpHash,
      verificationOtpExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    await sendOtpEmail({
      to: user.email,
      subject: "Verify your SpendSmart account",
      text: `Your verification code is ${otp}.`,
      html: `
        <div style="line-height:1.6;color:#111">
          <h2>Welcome to SpendSmart!</h2>
          <p>Please verify your email address to get started.</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0;color:#7c6aff;">${otp}</p>
          <p>This code will expire in 24 hours.</p>
        </div>
      `,
    });

    res.status(201).json({
      message: "Registration successful. Please check your email for the verification code.",
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// LOGIN (email/password)
exports.loginUser = async (req, res) => {
  const { password } = req.body;
  const email = normalizeEmail(req.body.email);

  if (!email || !password) {
    return res.status(400).json({ message: "Please provide email and password" });
  }

  try {
    const user = await User.findOne({ email });

    if (user && user.password && (await bcrypt.compare(password, user.password))) {
      if (!user.isVerified) {
        return res.status(403).json({ 
          message: "Please verify your email to login",
          isVerified: false,
          email: user.email 
        });
      }

      const pendingInvitesAccepted = await autoAcceptInvitesForEmail(user);
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: generateToken(user._id),
        pendingInvitesAccepted,
      });
    } else {
      res.status(401).json({ message: "Invalid email or password" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// VERIFY EMAIL (registration)
exports.verifyEmail = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || "").trim();

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    if (hashOtp(otp) !== user.verificationOtpHash) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    if (user.verificationOtpExpiresAt && new Date(user.verificationOtpExpiresAt) < new Date()) {
      return res.status(400).json({ message: "Verification code has expired" });
    }

    user.isVerified = true;
    user.verificationOtpHash = null;
    user.verificationOtpExpiresAt = null;
    await user.save();

    const pendingInvitesAccepted = await autoAcceptInvitesForEmail(user);

    res.json({
      message: "Email verified successfully",
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id),
      pendingInvitesAccepted,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// RESEND VERIFICATION OTP
exports.resendVerificationOtp = async (req, res) => {
  const email = normalizeEmail(req.body.email);

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    const otp = generateOtp();
    user.verificationOtpHash = hashOtp(otp);
    user.verificationOtpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    await sendOtpEmail({
      to: user.email,
      subject: "Verification code for SpendSmart",
      text: `Your verification code is ${otp}.`,
      html: `
        <div style="line-height:1.6;color:#111">
          <h2>Verify your account</h2>
          <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0;color:#7c6aff;">${otp}</p>
        </div>
      `,
    });

    res.json({ message: "Verification code sent to your email" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET USER PROFILE
exports.getMe = async (req, res) => {
  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
  });
};

// PASSWORD RESET (email OTP - kept)
exports.sendPasswordResetOtp = async (req, res) => {
  const email = normalizeEmail(req.body.email);

  if (!email || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: "Please provide a valid email address" });
  }

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.json({ message: "If the email exists, an OTP has been sent" });
    }

    const otp = generateOtp();
    user.passwordResetOtpHash = hashOtp(otp);
    user.passwordResetOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min
    user.passwordResetOtpVerifiedAt = null;
    user.passwordResetOtpLastSentAt = new Date();
    await user.save();

    await sendOtpEmail({
      to: user.email,
      subject: "Your SpendSmart password reset OTP",
      text: `Your OTP is ${otp}. Expires in 5 minutes.`,
      html: `
        <div style="line-height:1.6;color:#111">
          <h2>Password Reset OTP</h2>
          <p>Hello ${user.name},</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0;color:#7c6aff;">${otp}</p>
          <p>This expires in 5 minutes. If you didn't request, ignore this email.</p>
        </div>
      `,
    });

    res.json({ message: "OTP sent to your email", expiresInMinutes: 5 });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to send OTP" });
  }
};

exports.verifyPasswordResetOtp = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || "").trim();

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  try {
    const user = await User.findOne({ email });
    const validationError = await validateResetOtp(user, otp);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    user.passwordResetOtpVerifiedAt = new Date();
    await user.save();

    res.json({ message: "OTP verified successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to verify OTP" });
  }
};

exports.resetPasswordWithOtp = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || "").trim();
  const newPassword = req.body.newPassword || "";
  const confirmPassword = req.body.confirmPassword || "";

  if (!email || !otp || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  try {
    const user = await User.findOne({ email });
    const validationError = await validateResetOtp(user, otp);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword && user.password) {
      return res.status(400).json({ message: "New password cannot be the same as current" });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpVerifiedAt = null;
    user.passwordResetOtpLastSentAt = null;
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to update password" });
  }
};

// Merge guest data with user account
exports.mergeGuestData = async (req, res) => {
  console.log(`[Merge] Starting merge for user: ${req.user.email} (${req.user._id})`);
  try {
    const { guestExpenses, guestIncomes, guestId, sheetId } = req.body;
    const userId = req.user._id;

    // Validate input
    if (!guestExpenses && !guestIncomes && !guestId) {
      return res.status(400).json({ message: "No guest data provided" });
    }

    // Robust sheetId resolution
    let finalSheetId = null;
    if (sheetId && mongoose.Types.ObjectId.isValid(sheetId)) {
      finalSheetId = new mongoose.Types.ObjectId(sheetId);
    } else {
      const defaultSheet = await getOrCreateDefaultSheet(req.user);
      finalSheetId = defaultSheet._id;
    }
    console.log(`[Merge] Target sheet: ${finalSheetId}`);

    const results = {
      expensesMerged: 0,
      incomesMerged: 0,
      backendRecordsMerged: 0,
      errors: []
    };

    // 1. Update existing backend records that have a guestId
    if (guestId) {
       console.log(`[Merge] Updating backend records with guestId: ${guestId}`);
       const [recurringRes, expenseRes, incomeRes] = await Promise.all([
         RecurringTransaction.updateMany({ guestId }, { $set: { user: userId, sheet: finalSheetId, guestId: null } }),
         Expense.updateMany({ guestId }, { $set: { user: userId, sheet: finalSheetId, guestId: null } }),
         Income.updateMany({ guestId }, { $set: { user: userId, sheet: finalSheetId, guestId: null } })
       ]);

       results.backendRecordsMerged = (recurringRes.modifiedCount || 0) + 
                                      (expenseRes.modifiedCount || 0) + 
                                      (incomeRes.modifiedCount || 0);
       console.log(`[Merge] Backend records updated: ${results.backendRecordsMerged}`);
    }

    // 2. Process guest expenses from frontend
    if (guestExpenses && Array.isArray(guestExpenses)) {
      console.log(`[Merge] Processing ${guestExpenses.length} frontend expenses`);
      for (const guestExp of guestExpenses) {
        try {
          if (!guestExp.name || guestExp.amount === undefined || !guestExp.date) continue;

          const expenseData = {
            user: userId,
            sheet: finalSheetId,
            name: guestExp.name,
            category: (guestExp.category || guestExp.cat || "others").toLowerCase(),
            amount: Number(guestExp.amount),
            date: new Date(guestExp.date),
            method: guestExp.method || "upi",
            familyMemberName: guestExp.familyMemberName || req.user.name,
            note: guestExp.note || "",
            recurring: guestExp.recurring || false,
            localId: guestExp._id // Store the frontend UUID as localId
          };

          if (guestExp.recurring) {
            expenseData.frequency = guestExp.frequency || "monthly";
            expenseData.nextDue = guestExp.nextDue ? new Date(guestExp.nextDue) : null;
          }

          // Duplicate prevention logic:
          // Check if localId already exists for this user OR if it's a valid ObjectId we can update
          let query = { user: userId, localId: guestExp._id };
          
          if (mongoose.Types.ObjectId.isValid(guestExp._id)) {
            query = { _id: guestExp._id };
          }

          await Expense.findOneAndUpdate(query, { $set: expenseData }, { upsert: true, new: true });
          results.expensesMerged++;
        } catch (error) {
          console.error(`[Merge] Expense error (${guestExp.name}):`, error.message);
          results.errors.push(`Expense "${guestExp.name}": ${error.message}`);
        }
      }
    }

    // 3. Process guest incomes from frontend
    if (guestIncomes && Array.isArray(guestIncomes)) {
      console.log(`[Merge] Processing ${guestIncomes.length} frontend incomes`);
      for (const guestInc of guestIncomes) {
        try {
          if (!guestInc.name || guestInc.amount === undefined || !guestInc.date) continue;

          const incomeData = {
            user: userId,
            sheet: finalSheetId,
            name: guestInc.name,
            source: (guestInc.source || "others").toLowerCase(),
            amount: Number(guestInc.amount),
            date: new Date(guestInc.date),
            method: guestInc.method || "upi",
            familyMemberName: guestInc.familyMemberName || req.user.name,
            note: guestInc.note || "",
            localId: guestInc._id
          };

          let query = { user: userId, localId: guestInc._id };
          if (mongoose.Types.ObjectId.isValid(guestInc._id)) {
            query = { _id: guestInc._id };
          }

          await Income.findOneAndUpdate(query, { $set: incomeData }, { upsert: true, new: true });
          results.incomesMerged++;
        } catch (error) {
          console.error(`[Merge] Income error (${guestInc.name}):`, error.message);
          results.errors.push(`Income "${guestInc.name}": ${error.message}`);
        }
      }
    }

    console.log(`[Merge] Completed successfully for ${req.user.email}`);
    res.json({ message: "Guest data merge completed", results });
  } catch (error) {
    console.error("[Merge] Fatal error:", error);
    res.status(500).json({ message: "Failed to merge guest data" });
  }
};

