const mongoose = require("mongoose");

const recurringTransactionSchema = new mongoose.Schema(
  {
    sheet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sheet",
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: function () {
        return !this.guestId;
      },
      ref: "User",
      default: null,
      index: true,
    },
    guestId: {
      type: String,
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["expense", "income"],
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      // Maps to 'category' for Expense and 'source' for Income
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
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
    familyMemberName: {
      type: String,
      default: "Me",
      trim: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly"],
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      default: null,
    },
    nextRunDate: {
      type: Date,
      required: true,
      index: true, // Critical for efficient cron queries
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Compound index for cron job
recurringTransactionSchema.index({ isActive: 1, nextRunDate: 1 });

module.exports = mongoose.model("RecurringTransaction", recurringTransactionSchema);
