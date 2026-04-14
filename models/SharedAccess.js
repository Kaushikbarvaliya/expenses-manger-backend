const mongoose = require("mongoose");

const sharedAccessSchema = new mongoose.Schema(
  {
    sheet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sheet",
      default: null,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "member", "viewer"],
      default: "member",
    },
  },
  { timestamps: true }
);

sharedAccessSchema.index({ sheet: 1, member: 1 }, { unique: true, sparse: true });
sharedAccessSchema.index({ owner: 1, member: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("SharedAccess", sharedAccessSchema);
