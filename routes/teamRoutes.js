const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const {
  listMySheets,
  createSheet,
  updateSheet,
  deleteSheet,
  sendInvite,
  getInviteByToken,
  acceptInvite,
} = require("../controllers/teamController");

router.route("/sheets").get(protect, listMySheets).post(protect, createSheet);
router
  .route("/sheets/:id")
  .patch(protect, updateSheet)
  .delete(protect, deleteSheet);
router.post("/invite", protect, sendInvite);
router.get("/invite/:token", getInviteByToken);
router.post("/invite/:token/accept", protect, acceptInvite);

module.exports = router;
