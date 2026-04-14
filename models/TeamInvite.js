const mongoose = require("mongoose");

const teamInviteSchema = new mongoose.Schema(
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
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    role: {
      type: String,
      enum: ["admin", "member", "viewer"],
      default: "member",
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

teamInviteSchema.index({ sheet: 1, email: 1, acceptedAt: 1, revokedAt: 1 });
teamInviteSchema.index({ owner: 1, email: 1, acceptedAt: 1, revokedAt: 1 });

module.exports = mongoose.model("TeamInvite", teamInviteSchema);
