const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");

const {
  getIncomes,
  createIncome,
  updateIncome,
  deleteIncome,
} = require("../controllers/incomeController");

router.route("/").get(protect, getIncomes).post(protect, createIncome);
router.route("/:id")
  .put(protect, updateIncome)
  .delete(protect, deleteIncome);

module.exports = router;

