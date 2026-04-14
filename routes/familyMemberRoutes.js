const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const {
  listFamilyMembers,
  createFamilyMember,
  deleteFamilyMember,
} = require("../controllers/familyMemberController");

router.route("/").get(protect, listFamilyMembers).post(protect, createFamilyMember);
router.route("/:id").delete(protect, deleteFamilyMember);

module.exports = router;
