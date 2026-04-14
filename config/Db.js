const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const User = require("../models/User");
const Budget = require("../models/Budget");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (typeof uri !== "string" || uri.trim().length === 0) {
    console.error("MONGO_URI is missing or invalid. Set it in backend/.env");
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri);

    await migrateUserIndexes();
    await migrateBudgetIndexes();

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log("Connected DB:", mongoose.connection.name);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
};

async function migrateUserIndexes() {
  // Remove explicit nulls so sparse unique indexes can be created safely.
  await User.collection.updateMany({ email: null }, { $unset: { email: "" } });
  await User.collection.updateMany({ mobile: null }, { $unset: { mobile: "" } });

  const indexList = await User.collection.indexes();
  const byName = new Map(indexList.map((index) => [index.name, index]));

  const emailIndex = byName.get("email_1");
  const mobileIndex = byName.get("mobile_1");

  const needsEmailRebuild =
    emailIndex &&
    emailIndex.unique === true &&
    !emailIndex.partialFilterExpression &&
    emailIndex.sparse !== true;

  const needsMobileRebuild =
    mobileIndex &&
    mobileIndex.unique === true &&
    !mobileIndex.partialFilterExpression &&
    mobileIndex.sparse !== true;

  if (needsEmailRebuild) {
    await User.collection.dropIndex("email_1");
    console.log("Dropped legacy email_1 index");
  }

  if (needsMobileRebuild) {
    await User.collection.dropIndex("mobile_1");
    console.log("Dropped legacy mobile_1 index");
  }

  await User.syncIndexes();
}

async function migrateBudgetIndexes() {
  if (!Budget || !Budget.collection) return;
  
  try {
    const indexList = await Budget.collection.indexes();
    const byName = new Map(indexList.map((index) => [index.name, index]));

    // Index identified in the error: E11000 duplicate key error collection: expenseDB.budgets index: user_1_month_1_year_1
    if (byName.has("user_1_month_1_year_1")) {
      await Budget.collection.dropIndex("user_1_month_1_year_1");
      console.log("Dropped legacy 'user_1_month_1_year_1' index from Budgets");
    }

    // Ensure new schema indexes are synced.
    await Budget.syncIndexes();
  } catch (error) {
    console.error("Migration error for budgets:", error.message);
  }
}

module.exports = connectDB;