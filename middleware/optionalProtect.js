const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Middleware that allows either a valid JWT token OR a guestId.
 * Sets req.user if a valid token is present.
 * Sets req.guestId if no token is present but guestId is found in headers, query, or body.
 */
const optionalProtect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const guestIdFromHeader = req.headers["x-guest-id"];
  const guestIdFromQuery = req.query ? req.query.guestId : undefined;
  const guestIdFromBody = req.body ? req.body.guestId : undefined;
  const guestId = guestIdFromHeader || guestIdFromQuery || guestIdFromBody;

  // 1. If Token is present, try to authenticate user
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password");
      if (user) {
        req.user = user;
        return next();
      }
    } catch (error) {
      console.log("OptionalProtect: Token verification failed:", error.message);
      // If token is invalid/expired, we don't fall back to guest mode for safety
      // because the app might be sending a stale token.
      return res.status(401).json({ message: "Not authorized, invalid or expired token" });
    }
  }

  // 2. If no valid token, check for Guest ID
  if (guestId) {
    req.guestId = guestId;
    return next();
  }

  // 3. Neither present
  return res.status(401).json({ message: "Not authorized. Login or provide a guest ID." });
};

module.exports = optionalProtect;
