import nodemailer from "nodemailer";

export default nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  secure: false,
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  }
});
