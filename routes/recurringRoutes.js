const express = require("express");
const router = express.Router();
const optionalProtect = require("../middleware/optionalAuth");
const {
  createRecurringTransaction,
  getRecurringTransactions,
  updateRecurringTransaction,
  deleteRecurringTransaction,
  toggleRecurringTransaction,
} = require("../controllers/recurringController");

router.route("/")
  .post(optionalProtect, createRecurringTransaction)
  .get(optionalProtect, getRecurringTransactions);

router.route("/:id")
  .put(optionalProtect, updateRecurringTransaction)
  .delete(optionalProtect, deleteRecurringTransaction);

router.route("/:id/toggle")
  .patch(optionalProtect, toggleRecurringTransaction);

module.exports = router;
