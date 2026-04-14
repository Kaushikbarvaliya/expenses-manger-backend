const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const {
  getAllBudgets,
  upsertBudget,
  deleteBudgetById,
} = require("../controllers/budgetController");

router.get("/", protect, getAllBudgets);
router.post("/", protect, upsertBudget);
router.delete("/:id", protect, deleteBudgetById);

module.exports = router;
