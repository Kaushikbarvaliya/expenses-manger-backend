const express = require("express");
const router = express.Router();

const {
  getSheets,
  createSheet,
} = require("../controllers/sheetController");

const protect = require("../middleware/authMiddleware");

router.get("/", protect, getSheets);
router.post("/", protect, createSheet);

module.exports = router;
