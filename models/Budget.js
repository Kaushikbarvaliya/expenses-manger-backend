const mongoose = require("mongoose");

const budgetCategorySchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const budgetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    sheet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sheet",
      required: false,
    },
    // "monthly" or "yearly"
    periodType: {
      type: String,
      enum: ["monthly", "yearly"],
      required: true,
      default: "monthly",
    },
    budgetDate: {
      type: Date,
      required: true,
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: true,
      min: 1970,
      max: 3000,
    },
    totalBudget: {
      type: Number,
      required: true,
      min: 0,
    },
    categories: {
      type: [budgetCategorySchema],
      default: [],
    },
  },
  { timestamps: true }
);

// One budget per period type+month+year per workspace
budgetSchema.index(
  { user: 1, sheet: 1, periodType: 1, month: 1, year: 1 },
  { unique: true }
);

module.exports = mongoose.model("Budget", budgetSchema);
