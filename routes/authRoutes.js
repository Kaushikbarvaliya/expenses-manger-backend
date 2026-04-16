const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,

  getMe,
  sendPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPasswordWithOtp,
  verifyEmail,
  resendVerificationOtp,
  mergeGuestData,
} = require("../controllers/authController");
const protect = require("../middleware/authMiddleware");

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerificationOtp);

router.post("/forgot-password/send-otp", sendPasswordResetOtp);
router.post("/forgot-password/verify-otp", verifyPasswordResetOtp);
router.post("/forgot-password/reset-password", resetPasswordWithOtp);
router.post("/merge-guest-data", protect, mergeGuestData);
router.get("/me", protect, getMe);

module.exports = router;