import nodemailer from 'nodemailer';

/**
 * Creates a standardized Nodemailer transport instance.
 * Reads dynamically from Database Settings or Environment Variables.
 *
 * @param {Object} settings Database settings or custom SMTP configuration object
 * @returns {Object|null} Nodemailer transporter instance or null if credentials missing
 */
export const createMailTransporter = (settings = {}) => {
  const host = settings.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(settings.smtp_port || process.env.SMTP_PORT || 465);
  const user = settings.smtp_user || process.env.SMTP_USER || settings.shop_email || settings.email || process.env.GMAIL_USER;
  const pass = settings.smtp_pass || process.env.SMTP_PASS || process.env.GMAIL_PASS;

  if (!user || !pass) {
    console.error('[MAILER ERROR] Missing SMTP credentials (user or app password).');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

/**
 * Sends a password reset OTP email.
 *
 * @param {string} toEmail Target recipient email address
 * @param {string} code 6-digit verification OTP code
 * @param {Object} settings Optional runtime settings
 */
export const sendResetEmail = async (toEmail, code, settings = {}) => {
  try {
    const transporter = createMailTransporter(settings);
    const user = settings.smtp_user || process.env.SMTP_USER || settings.email || process.env.GMAIL_USER;

    if (!transporter) {
      console.warn(`[Reset Password Simulation] Missing SMTP credentials. Reset code for ${toEmail}: ${code}`);
      return { success: false, reason: 'GMAIL_PASS missing' };
    }

    const info = await transporter.sendMail({
      from: `"Muthuwadige Hardware ERP" <${user}>`,
      to: toEmail,
      subject: 'Muthuwadige Hardware - Password Reset Code',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 500px; margin: 0 auto; border: 1px solid #f3f4f6; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #DAA520; margin: 0; font-size: 22px; font-weight: 800;">Password Reset Request</h2>
            <p style="color: #6b7280; font-size: 13px; margin-top: 5px;">Muthuwadige Hardware ERP</p>
          </div>
          <p style="font-size: 14px; line-height: 1.5; color: #4b5563;">We received a request to reset the password for your staff account. Use the verification code below to complete the reset process:</p>
          <div style="background-color: #f9fafb; padding: 18px; text-align: center; font-size: 28px; font-weight: 800; letter-spacing: 6px; border-radius: 12px; margin: 25px 0; color: #464646; border: 1px solid #f3f4f6;">
            ${code}
          </div>
          <p style="font-size: 13px; line-height: 1.5; color: #6b7280; text-align: center;">This code will expire in <strong>15 minutes</strong> for security.</p>
          <p style="font-size: 13px; line-height: 1.5; color: #9ca3af; margin-top: 25px; border-top: 1px solid #f3f4f6; padding-top: 15px;">If you did not make this request, you can safely ignore this email.</p>
        </div>
      `
    });

    console.log(`[Reset Password] Email sent successfully to ${toEmail} (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Reset Password] Failed to send email:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Sends a notification email alert.
 *
 * @param {string} subject Email subject line
 * @param {string} text Plain text content
 * @param {Object} settings Runtime system settings
 * @param {string|null} targetEmail Target email address override
 */
export const sendNotificationEmail = async (subject, text, settings = {}, targetEmail = null) => {
  try {
    const destination = targetEmail || settings.backup_email || settings.email || process.env.GMAIL_USER || 'sanojhardware@gmail.com';
    const transporter = createMailTransporter(settings);
    const user = settings.smtp_user || process.env.SMTP_USER || settings.email || process.env.GMAIL_USER;

    if (!transporter) {
      console.warn(`[Notification Email Fallback] Missing SMTP credentials. Would send email to ${destination} with Subject: "${subject}". Text: "${text}"`);
      return { success: false, reason: 'GMAIL_PASS missing' };
    }

    const info = await transporter.sendMail({
      from: `"Muthuwadige Hardware Alert" <${user}>`,
      to: destination,
      subject,
      text
    });

    console.log(`[Notification Email] Email sent successfully to ${destination} (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Notification Email] Failed to send email:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Sends automated backup email with attachment.
 *
 * @param {Object} params Mail parameters including toEmail, subject, text, html, fileName, filePath, settings
 */
export const sendBackupEmail = async ({ toEmail, subject, text, html, fileName, filePath, settings = {} }) => {
  try {
    const destination = toEmail || settings.backup_email || settings.email || process.env.GMAIL_USER;
    if (!destination) {
      console.error('[Backup Email] No target email destination specified.');
      return { success: false, error: 'No target email destination' };
    }

    const transporter = createMailTransporter(settings);
    const user = settings.smtp_user || process.env.SMTP_USER || settings.email || process.env.GMAIL_USER;

    if (!transporter) {
      console.error('[Backup Email] Missing SMTP credentials.');
      return { success: false, error: 'Missing SMTP credentials' };
    }

    const info = await transporter.sendMail({
      from: `"Muthuwadige Hardware ERP" <${user}>`,
      to: destination,
      subject,
      text,
      html,
      attachments: [{ filename: fileName, path: filePath }]
    });

    console.log(`[Backup Email] Email sent successfully to ${destination} (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Backup Email] Failed to send email:', err);
    return { success: false, error: err.message };
  }
};

export default {
  createMailTransporter,
  sendResetEmail,
  sendNotificationEmail,
  sendBackupEmail
};
