const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    sheet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sheet",
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
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
    date: {
      type: Date,
      required: true,
    },
    method: {
      type: String,
      default: "upi",
      trim: true,
    },
    familyMember: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FamilyMember",
      default: null,
    },
    assignedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    familyMemberName: {
      type: String,
      required: true,
      trim: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },

    // ── Recurring ────────────────────────────────────────────────────────────
    recurring: {
      type: Boolean,
      default: false,
      index: true,
    },
    frequency: {
      type: String,
      enum: ["weekly", "monthly", "quarterly", "yearly"],
      default: null,
    },
    nextDue: {
      type: Date,
      default: null,
      index: true,        // enables efficient "due soon" queries
    },
    recurringPaused: {
      type: Boolean,
      default: false,
    },
    // Reference back to the recurring template that spawned this one-off entry
    sourceRecurringId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Expense",
      default: null,
    },
  },
  { timestamps: true }
);

// General query index (sheet + sort fields)
expenseSchema.index({ sheet: 1, date: -1, createdAt: -1 });

// Efficient "fetch all active recurring expenses due soon" query
expenseSchema.index({ sheet: 1, recurring: 1, recurringPaused: 1, nextDue: 1 });

module.exports = mongoose.model("Expense", expenseSchema);