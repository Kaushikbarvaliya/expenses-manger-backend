const mongoose = require("mongoose");

const incomeSchema = new mongoose.Schema(
  {
    sheet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sheet",
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: function() { return !this.guestId; },
      ref: "User",
      default: null,
    },
    guestId: {
      type: String,
      default: null,
      index: true,
    },
    recurringTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RecurringTransaction",
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    source: {
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
      default: "salary",
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
    recurring: {
      type: Boolean,
      default: false,
    },
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly"],
      default: null,
    },
    nextDue: {
      type: Date,
      default: null,
    },
    recurringPaused: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

incomeSchema.index({ sheet: 1, date: -1, createdAt: -1 });

module.exports = mongoose.model("Income", incomeSchema);

