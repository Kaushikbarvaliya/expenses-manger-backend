const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, no token (P)" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Debug log to terminal
    console.log(`[Auth] Verifying token for user ID: ${decoded.id}`);

    const user = await User.findById(decoded.id).select("-password");
    
    if (!user) {
      console.warn(`[Auth] User not found in DB for ID: ${decoded.id}`);
      return res.status(401).json({ message: "Not authorized, session user not found" });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error("[Auth] Token verification failed:", error.message);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Not authorized, token expired" });
    }
    return res.status(401).json({ message: "Not authorized, invalid token" });
  }
};

module.exports = protect;