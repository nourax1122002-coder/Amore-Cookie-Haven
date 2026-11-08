import { HttpError } from "./errors";

type SupabaseAuthError = {
  status?: number;
  code?: string;
  message?: string;
};

const genericRateLimitMessage =
  "Too many attempts. Please wait before trying again. / محاولات كثيرة. يرجى الانتظار قبل المحاولة مجدداً.";
const emailRateLimitMessage =
  "Supabase temporarily limited confirmation emails for this project. Wait for its email quota to reset, or configure SMTP before retrying. Accounts already created remain saved. / قيّد Supabase مؤقتاً إرسال رسائل تأكيد البريد لهذا المشروع. انتظري تجدد حصة البريد أو أعدّي SMTP قبل المحاولة مجدداً. الحسابات التي أُنشئت محفوظة.";
const emailNotConfirmedMessage =
  "Confirm your email using the latest Amore message before signing in. If it did not arrive, wait for the email limit to reset or configure SMTP. / أكّدي بريدك من أحدث رسالة من أموري قبل تسجيل الدخول. إذا لم تصلك الرسالة، انتظري تجدد حد الإرسال أو أعدّي SMTP.";

function normalizedCode(error: SupabaseAuthError): string {
  const code = error.code?.toLowerCase().trim();
  if (code) return code;
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("email rate limit")) return "over_email_send_rate_limit";
  if (message.includes("email not confirmed")) return "email_not_confirmed";
  return "";
}

export function mapSupabaseSignUpError(error: SupabaseAuthError): HttpError {
  const code = normalizedCode(error);
  if (code === "over_email_send_rate_limit") {
    return new HttpError(429, emailRateLimitMessage);
  }
  if (code === "email_address_not_authorized") {
    return new HttpError(
      403,
      "Supabase's built-in email service cannot send to this address. Configure an SMTP provider for customer sign-ups. / لا تسمح خدمة البريد المدمجة في Supabase بإرسال الرسائل إلى هذا العنوان. أعدّي SMTP لتفعيل تسجيل العملاء.",
    );
  }
  if (error.status === 429) return new HttpError(429, genericRateLimitMessage);
  if (error.status && error.status >= 500) {
    return new HttpError(
      503,
      "Account service is temporarily unavailable. Please retry. / خدمة الحسابات غير متاحة مؤقتاً. يرجى المحاولة مجدداً.",
    );
  }
  return new HttpError(
    400,
    "Please check your email and password. / يرجى التحقق من البريد الإلكتروني وكلمة المرور.",
  );
}

export function mapSupabaseSignInError(error: SupabaseAuthError): HttpError {
  const code = normalizedCode(error);
  if (code === "email_not_confirmed") {
    return emailNotConfirmedError();
  }
  if (error.status === 429) return new HttpError(429, genericRateLimitMessage);
  if (error.status && error.status >= 500) {
    return new HttpError(
      503,
      "Account service is temporarily unavailable. Please retry. / خدمة الحسابات غير متاحة مؤقتاً. يرجى المحاولة مجدداً.",
    );
  }
  // Keep invalid-credential responses deliberately generic to avoid revealing
  // whether an email address has an account.
  return new HttpError(
    401,
    "Email or password is incorrect. If you just registered, confirm your email first. / البريد الإلكتروني أو كلمة المرور غير صحيحة. إذا أنشأت حساباً للتو، أكّدي بريدك أولاً.",
  );
}

export function emailNotConfirmedError() {
  return new HttpError(403, emailNotConfirmedMessage);
}
