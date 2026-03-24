import { createTransport } from "nodemailer";
import type { Transporter } from "nodemailer";
import { useLogger } from "evlog";

const SMTP_KEYS = ["smtp.host", "smtp.port", "smtp.secure", "smtp.user", "smtp.pass", "smtp.from"];

function getSmtpTransporter(): Transporter | null {
  const settings = getSettingsMap(SMTP_KEYS);
  const host = settings["smtp.host"] as string;
  if (!host) {
    useLogger().set({ email: { warning: "smtp_not_configured" } });
    return null;
  }

  return createTransport({
    host,
    port: (settings["smtp.port"] as number) || 465,
    secure: (settings["smtp.secure"] as boolean) ?? true,
    auth: {
      user: (settings["smtp.user"] as string) || "",
      pass: (settings["smtp.pass"] as string) || "",
    },
  });
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const transporter = getSmtpTransporter();
  if (!transporter) return false;

  const settings = getSettingsMap(["smtp.from"]);
  const from = (settings["smtp.from"] as string) || "Irminsul <noreply@example.com>";

  try {
    await transporter.sendMail({ from, to, subject, html });
    useLogger().set({ email: { sent: true, to, subject } });
    return true;
  } catch (err) {
    useLogger().error(err as Error, { step: "email_send", to });
    return false;
  }
}

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<boolean> {
  const subject = "Irminsul - 密码重置";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">密码重置</h2>
  <p>你好，</p>
  <p>我们收到了你的密码重置请求。请点击下方按钮重置密码：</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${resetLink}"
       style="background-color: #6366f1; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-size: 16px;">
      重置密码
    </a>
  </p>
  <p>或者复制以下链接到浏览器中打开：</p>
  <p style="word-break: break-all; color: #6366f1;">${resetLink}</p>
  <p>此链接将在 <strong>10 分钟</strong>后过期，且只能使用一次。</p>
  <p>如果你没有请求重置密码，请忽略此邮件。</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
  <p style="color: #999; font-size: 12px;">此邮件由 Irminsul 系统自动发送，请勿回复。</p>
</body>
</html>`.trim();

  return sendEmail(to, subject, html);
}

export async function sendEmailVerificationEmail(to: string, verifyLink: string): Promise<boolean> {
  const subject = "Irminsul - 邮箱验证";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">邮箱验证</h2>
  <p>你好，</p>
  <p>请点击下方按钮验证你的邮箱地址：</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${verifyLink}"
       style="background-color: #6366f1; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-size: 16px;">
      验证邮箱
    </a>
  </p>
  <p>或者复制以下链接到浏览器中打开：</p>
  <p style="word-break: break-all; color: #6366f1;">${verifyLink}</p>
  <p>此链接将在 <strong>10 分钟</strong>后过期，且只能使用一次。</p>
  <p>如果你没有请求验证邮箱，请忽略此邮件。</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
  <p style="color: #999; font-size: 12px;">此邮件由 Irminsul 系统自动发送，请勿回复。</p>
</body>
</html>`.trim();

  return sendEmail(to, subject, html);
}
