const nodemailer = require("nodemailer");

function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP configuration is missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in backend/.env");
  }

  const normalizedPassword = String(SMTP_PASS).replace(/\s+/g, "").trim();

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === "true",
    auth: {
      user: SMTP_USER,
      pass: normalizedPassword,
    },
  });
}

async function sendOtpEmail({ to, subject, text, html }) {
  try {
    const transporter = createTransporter();

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    if (error && (error.code === "EAUTH" || String(error.message || "").includes("535"))) {
      throw new Error("SMTP authentication failed. For Gmail, use a 16-character App Password (not your normal Gmail password) and verify SMTP_USER/SMTP_PASS.");
    }

    throw error;
  }
}

module.exports = sendOtpEmail;