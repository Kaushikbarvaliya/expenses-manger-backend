const express = require("express");
const router = express.Router();

const optionalProtect = require("../middleware/optionalProtect");

const {
  getIncomes,
  createIncome,
  updateIncome,
  deleteIncome,
} = require("../controllers/incomeController");

router.route("/").get(optionalProtect, getIncomes).post(optionalProtect, createIncome);
router.route("/:id")
  .put(optionalProtect, updateIncome)
  .delete(optionalProtect, deleteIncome);

module.exports = router;

