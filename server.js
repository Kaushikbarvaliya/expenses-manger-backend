const dotenv = require("dotenv");
const cors = require("cors");
const express = require("express");
const morgan = require("morgan");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

// DB
const connectDB = require("./config/Db");


// Routes
const authRoutes = require("./routes/authRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const familyMemberRoutes = require("./routes/familyMemberRoutes");
const budgetRoutes = require("./routes/budgetRoutes");
const teamRoutes = require("./routes/teamRoutes");
const incomeRoutes = require("./routes/incomeRoutes");
const sheetRoutes = require("./routes/sheetRoutes");
const recurringRoutes = require("./routes/recurringRoutes");

// Middleware
const errorHandler = require("./middleware/errorMiddleware");

const app = express();

// Connect DB
connectDB();

// Start Cron Jobs
const startRecurringCron = require("./cron/recurringCron");
startRecurringCron();
const startRecurringTransactionCron = require("./cron/recurringTransactionJob");
startRecurringTransactionCron();

// Global Middleware
app.use(morgan("dev"));
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:8081",
      "https://expenses-manger.vercel.app",
      ...(process.env.CLIENT_ORIGIN ? [process.env.CLIENT_ORIGIN] : [])
    ];
    
    const isAllowed = allowedOrigins.includes(origin) || 
                     /^http:\/\/192\.168\.\d+\.\d+:(8081|8082)$/.test(origin) ||
                     origin.includes("localhost");

    if (isAllowed) {
      callback(null, true);
    } else {
      console.log("Blocked by CORS:", origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());

// Test Route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/family-members", familyMemberRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/incomes", incomeRoutes);
app.use("/api/sheets", sheetRoutes);
app.use("/api/recurring", recurringRoutes);

// Error Middleware (ALWAYS LAST)
app.use(errorHandler);

const PORT = process.env.PORT || 8000;

app.listen(PORT, "0.0.0.0",() => {
  console.log(`🚀 Server running on port ${PORT}`);
});