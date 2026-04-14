const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");

const {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  processVoiceExpense,
} = require("../controllers/expenseController");

router.route("/").get(protect, getExpenses).post(protect, createExpense);
router.post("/voice", protect, processVoiceExpense);
router.route("/:id")
  .put(protect, updateExpense)
  .delete(protect, deleteExpense);

module.exports = router;
