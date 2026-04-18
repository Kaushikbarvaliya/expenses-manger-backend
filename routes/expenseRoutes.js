const express = require("express");
const router = express.Router();

const optionalProtect = require("../middleware/optionalProtect");

const {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  processVoiceExpense,
} = require("../controllers/expenseController");

router.route("/").get(optionalProtect, getExpenses).post(optionalProtect, createExpense);
router.post("/voice", optionalProtect, processVoiceExpense);
router.route("/:id")
  .put(optionalProtect, updateExpense)
  .delete(optionalProtect, deleteExpense);

module.exports = router;
