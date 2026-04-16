const User = require("../models/User");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const generateToken = require("../utils/generateToken");
const sendOtpEmail = require("../utils/sendOtpEmail");

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

  const TeamInvite = require("../models/TeamInvite");
  const SharedAccess = require("../models/SharedAccess");
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
  try {
    const { guestExpenses, guestIncomes, sheetId } = req.body;
    const userId = req.user._id;

    // Validate input
    if (!guestExpenses && !guestIncomes) {
      return res.status(400).json({ message: "No guest data provided" });
    }

    if (guestExpenses && !Array.isArray(guestExpenses)) {
      return res.status(400).json({ message: "guestExpenses must be an array" });
    }

    if (guestIncomes && !Array.isArray(guestIncomes)) {
      return res.status(400).json({ message: "guestIncomes must be an array" });
    }

    // Validate sheetId if provided
    if (sheetId && (typeof sheetId !== 'string' || sheetId.trim() === '')) {
      return res.status(400).json({ message: "sheetId must be a valid string" });
    }

    const Expense = require("../models/Expense");
    const Income = require("../models/Income");
    const FamilyMember = require("../models/FamilyMember");

    const results = {
      expensesMerged: 0,
      expensesSkipped: 0,
      incomesMerged: 0,
      incomesSkipped: 0,
      errors: []
    };

    // Helper function to check for duplicates using UUID
    const isDuplicateExpense = async (expense, userId) => {
      // First check if there's an existing expense with the same UUID (for re-merge scenarios)
      if (expense._id) {
        const existingByUuid = await Expense.findOne({
          user: userId,
          _id: expense._id
        });
        if (existingByUuid) return true;
      }

      // Then check for duplicates using UUID-based logic
      const duplicate = await Expense.findOne({
        user: userId,
        name: expense.name,
        amount: expense.amount,
        category: expense.category,
        date: new Date(expense.date)
      });

      return duplicate !== null;
    };

    const isDuplicateIncome = async (income, userId) => {
      // First check if there's an existing income with the same UUID (for re-merge scenarios)
      if (income._id) {
        const existingByUuid = await Income.findOne({
          user: userId,
          _id: income._id
        });
        if (existingByUuid) return true;
      }

      // Then check for duplicates using UUID-based logic
      const duplicate = await Income.findOne({
        user: userId,
        name: income.name,
        amount: income.amount,
        source: income.source,
        date: new Date(income.date)
      });

      return duplicate !== null;
    };

    // Process guest expenses
    if (guestExpenses && Array.isArray(guestExpenses)) {
      for (const guestExpense of guestExpenses) {
        try {
          // Validate expense data
          if (!guestExpense.name || typeof guestExpense.name !== 'string' || guestExpense.name.trim() === '') {
            results.errors.push(`Skipping expense: name is required`);
            continue;
          }
          if (!guestExpense.category || typeof guestExpense.category !== 'string' || guestExpense.category.trim() === '') {
            results.errors.push(`Skipping expense "${guestExpense.name}": category is required`);
            continue;
          }
          if (!guestExpense.amount || typeof guestExpense.amount !== 'number' || guestExpense.amount <= 0) {
            results.errors.push(`Skipping expense "${guestExpense.name}": amount must be a positive number`);
            continue;
          }
          if (!guestExpense.date || !Date.parse(guestExpense.date)) {
            results.errors.push(`Skipping expense "${guestExpense.name}": valid date is required`);
            continue;
          }

          // Check if expense already exists
          const isDuplicate = await isDuplicateExpense(guestExpense, userId);
          if (isDuplicate) {
            results.expensesSkipped++;
            continue;
          }

          // Create new expense with preserved UUID
          const expenseData = {
            _id: guestExpense._id, // Preserve UUID from guest data
            user: userId,
            sheet: sheetId || null,
            name: guestExpense.name,
            category: guestExpense.category,
            amount: guestExpense.amount,
            date: new Date(guestExpense.date),
            method: guestExpense.method || "upi",
            familyMemberName: guestExpense.familyMemberName || req.user.name,
            recurring: guestExpense.recurring || false,
            note: guestExpense.note || ""
          };

          // Handle recurring expenses
          if (guestExpense.recurring && guestExpense.frequency) {
            expenseData.frequency = guestExpense.frequency;
            expenseData.nextDue = guestExpense.nextDue ? new Date(guestExpense.nextDue) : null;
            expenseData.recurringPaused = guestExpense.recurringPaused || false;
          }

          await Expense.create(expenseData);
          results.expensesMerged++;
        } catch (error) {
          results.errors.push(`Failed to merge expense "${guestExpense.name}": ${error.message}`);
        }
      }
    }

    // Process guest incomes
    if (guestIncomes && Array.isArray(guestIncomes)) {
      for (const guestIncome of guestIncomes) {
        try {
          // Validate income data
          if (!guestIncome.name || typeof guestIncome.name !== 'string' || guestIncome.name.trim() === '') {
            results.errors.push(`Skipping income: name is required`);
            continue;
          }
          if (!guestIncome.source || typeof guestIncome.source !== 'string' || guestIncome.source.trim() === '') {
            results.errors.push(`Skipping income "${guestIncome.name}": source is required`);
            continue;
          }
          if (!guestIncome.amount || typeof guestIncome.amount !== 'number' || guestIncome.amount <= 0) {
            results.errors.push(`Skipping income "${guestIncome.name}": amount must be a positive number`);
            continue;
          }
          if (!guestIncome.date || !Date.parse(guestIncome.date)) {
            results.errors.push(`Skipping income "${guestIncome.name}": valid date is required`);
            continue;
          }

          // Check if income already exists
          const isDuplicate = await isDuplicateIncome(guestIncome, userId);
          if (isDuplicate) {
            results.incomesSkipped++;
            continue;
          }

          // Create new income with preserved UUID
          const incomeData = {
            _id: guestIncome._id, // Preserve UUID from guest data
            user: userId,
            sheet: sheetId || null,
            name: guestIncome.name,
            source: guestIncome.source,
            amount: guestIncome.amount,
            date: new Date(guestIncome.date),
            method: guestIncome.method || "upi",
            familyMemberName: guestIncome.familyMemberName || req.user.name,
            note: guestIncome.note || ""
          };

          await Income.create(incomeData);
          results.incomesMerged++;
        } catch (error) {
          results.errors.push(`Failed to merge income "${guestIncome.name}": ${error.message}`);
        }
      }
    }

    res.json({
      message: "Guest data merge completed",
      results
    });
  } catch (error) {
    console.error("Merge guest data error:", error);
    res.status(500).json({ message: error.message || "Failed to merge guest data" });
  }
};

