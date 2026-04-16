const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    console.log("Auth middleware: Verifying token:", token);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Auth middleware: Token decoded:", decoded);

    const user = await User.findById(decoded.id).select("-password");
    console.log("Auth middleware: User found:", user);
    
    if (!user) {
      return res.status(401).json({ message: "Not authorized, User not found" });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.log("Auth middleware: JWT error:", error);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Not authorized, token expired" });
    }
    return res.status(401).json({ message: "Not authorized, invalid token" });
  }
};

module.exports = protect;