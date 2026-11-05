import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { eventDtos } from '../../contracts/dtos.js';

let transporter = null;
const memorySentMail = [];

export function getSentEmails() {
  return [...memorySentMail];
}

export function clearSentEmails() {
  memorySentMail.length = 0;
}

export function getTransporter() {
  if (transporter) return transporter;

  if (process.env.NODE_ENV !== 'test' && config.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? {
        user: config.SMTP_USER,
        pass: config.SMTP_PASSWORD,
      } : undefined,
    });
  } else {
    // Memory/Stream transport for development and testing
    transporter = {
      sendMail: async (mailOptions) => {
        const record = {
          from: mailOptions.from ?? config.SMTP_FROM,
          to: mailOptions.to,
          subject: mailOptions.subject,
          text: mailOptions.text,
          html: mailOptions.html,
          sentAt: new Date(),
          messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
        memorySentMail.push(record);
        return { messageId: record.messageId, response: '250 Mock message queued' };
      },
    };
  }

  return transporter;
}

export function setCustomTransporter(custom) {
  transporter = custom;
}

export function resetTransporter() {
  transporter = null;
  clearSentEmails();
}

const ROLE_DESCRIPTIONS = Object.freeze({
  SUPER_ADMIN: {
    title: 'Super Administrator',
    description: 'You have unrestricted access to manage system accounts, configure policies, review full audit logs, and oversee all admissions operations.',
  },
  ADMISSION_OFFICER: {
    title: 'Admission Officer',
    description: 'You have permissions to manage applicant marketing campaigns, admission policies, and merit calculation cycles.',
  },
  VERIFIER: {
    title: 'Verification Officer',
    description: 'You are assigned to the document verification queue to inspect uploaded marksheets, certificates, and candidate intake records.',
  },
  AUDITOR: {
    title: 'System Auditor',
    description: 'You have read-only audit inspection rights across system audit trails, candidate history, and finalized merit snapshots.',
  },
});

export function generateUserWelcomeContent({ email, displayName, role, initialPassword, loginUrl = config.APP_ORIGIN }) {
  const roleInfo = ROLE_DESCRIPTIONS[role] ?? {
    title: role,
    description: 'You have been assigned access to the SE Admissions workspace.',
  };

  const subject = `Welcome to SE Admissions — Account Provisioned (${roleInfo.title})`;

  const text = [
    `Hello ${displayName},`,
    '',
    `An administrator has created your staff account on the SE Admissions Automation System.`,
    `You have been assigned the role: ${roleInfo.title}.`,
    '',
    `Role Overview:`,
    `${roleInfo.description}`,
    '',
    `Sign-In Credentials:`,
    `- Login Portal: ${loginUrl}`,
    `- Work Email: ${email}`,
    `- Initial Password: ${initialPassword}`,
    '',
    `SECURITY NOTICE:`,
    `This is a temporary system-generated password. For account protection, please sign in promptly and update your password under your account settings.`,
    '',
    `Best regards,`,
    `SE Admissions Operations Team`,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 24px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.05em; color: #475569; text-transform: uppercase; margin-bottom: 8px; }
    h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 20px; }
    p { font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px; }
    .role-badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 4px; font-weight: 600; font-size: 13px; }
    .creds-box { background: #f1f5f9; border-left: 4px solid #0284c7; padding: 16px; border-radius: 4px; margin: 20px 0; }
    .creds-row { font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin: 6px 0; }
    .security-note { font-size: 12px; color: #64748b; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 4px; padding: 12px; margin-top: 24px; }
    .button { display: inline-block; background: #0f172a; color: #ffffff !important; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">SE Admissions Automation</div>
    <h1>Welcome, ${displayName}</h1>
    <p>An administrator has provisioned your staff account on the admissions platform.</p>
    <p><strong>Assigned Role:</strong> <span class="role-badge">${roleInfo.title}</span></p>
    <p>${roleInfo.description}</p>
    
    <div class="creds-box">
      <div class="creds-row"><strong>Portal URL:</strong> <a href="${loginUrl}">${loginUrl}</a></div>
      <div class="creds-row"><strong>Work Email:</strong> ${email}</div>
      <div class="creds-row"><strong>Temporary Password:</strong> ${initialPassword}</div>
    </div>

    <a href="${loginUrl}" class="button">Sign In to Workspace &rarr;</a>

    <div class="security-note">
      <strong>Security Notice:</strong> Please sign in immediately and update your password via Account Settings. Do not share your credentials with anyone.
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

export async function sendUserWelcomeEmail(payload) {
  const validated = eventDtos.USER_WELCOME_EMAIL.parse(payload);
  const { subject, text, html } = generateUserWelcomeContent(validated);

  const transport = getTransporter();
  return transport.sendMail({
    from: config.SMTP_FROM,
    to: validated.email,
    subject,
    text,
    html,
  });
}
