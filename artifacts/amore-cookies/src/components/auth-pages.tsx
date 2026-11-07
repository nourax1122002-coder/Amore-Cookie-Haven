import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, LogOut, UserRound } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type Lang = "en" | "ar";

function AuthHeader({ lang, onToggle }: { lang: Lang; onToggle: () => void }) {
  return <div className="w-full max-w-[440px] flex justify-between items-center mb-4">
    <Link href="/" className="text-xs text-[#5B0D1E] underline">{lang === "ar" ? "العودة للمتجر" : "Back to the shop"}</Link>
    <button type="button" onClick={onToggle} className="text-xs font-bold text-[#5B0D1E]" data-testid="button-auth-language">
      {lang === "ar" ? "English" : "عربي"}
    </button>
  </div>;
}

export function AuthPage({ mode, lang, onToggleLanguage }: { mode: "sign-in" | "sign-up"; lang: Lang; onToggleLanguage: () => void }) {
  const { signIn, signUp, resendConfirmation, loading } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [signupComplete, setSignupComplete] = useState(false);
  const actionLock = useRef(false);
  const isArabic = lang === "ar";
  const submittingText = isArabic ? "جارٍ المتابعة…" : "Please wait…";

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLock.current || signupComplete) return;
    actionLock.current = true;
    setError("");
    setMessage("");
    setPending(true);
    try {
      if (mode === "sign-in") {
        const user = await signIn(email.trim(), password);
        navigate(user.role === "administrator" ? "/admin" : "/user-portal");
      } else {
        const result = await signUp(email.trim(), password, displayName.trim());
        if (result.requiresEmailConfirmation) {
          setSignupComplete(true);
          setConfirmationEmail(email.trim());
          setResendCooldown(60);
          setMessage(isArabic
            ? "أُنشئ الحساب. تحققي من بريدك لإكمال التسجيل؛ يمكنك طلب رسالة جديدة بعد انتهاء المؤقت."
            : "Your account was created. Confirm your email to finish; request another message after the timer ends.");
        } else {
          navigate(result.user?.role === "administrator" ? "/admin" : "/user-portal");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isArabic ? "تعذر إكمال الطلب." : "We could not complete that request."));
    } finally {
      actionLock.current = false;
      setPending(false);
    }
  }

  async function resendConfirmationEmail() {
    if (!confirmationEmail || actionLock.current || resendCooldown > 0) return;
    actionLock.current = true;
    setPending(true);
    setError("");
    try {
      await resendConfirmation(confirmationEmail);
      setMessage(isArabic
        ? "إذا كان الحساب يحتاج إلى تأكيد، فستصل رسالة جديدة. تحققي من أحدث رسالة."
        : "If the account needs confirmation, a new email was requested. Use the latest message.");
      setResendCooldown(60);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isArabic ? "تعذر طلب رسالة التأكيد." : "Could not request a confirmation email."));
    } finally {
      actionLock.current = false;
      setPending(false);
    }
  }

  return <div dir={isArabic ? "rtl" : "ltr"} className="min-h-[100dvh] bg-[#f8e8ec] px-4 py-10 flex flex-col items-center justify-center">
    <AuthHeader lang={lang} onToggle={onToggleLanguage}/>
    <Link href="/" className="mb-6"><img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/images/amore-logo.png`} className="w-24 h-24 rounded-full object-contain" alt="Amore Cookies"/></Link>
    <form onSubmit={submit} className="card-surface w-full max-w-[440px] p-6 sm:p-8 grid gap-4">
      <h1 className="serif text-3xl text-[#5B0D1E]">{mode === "sign-in" ? (isArabic ? "تسجيل الدخول" : "Sign in") : (isArabic ? "إنشاء حساب" : "Create an account")}</h1>
      <p className="text-xs leading-6 text-[#795963]">{mode === "sign-in"
        ? (isArabic ? "سجّلي الدخول إلى حساب أموري." : "Sign in to your Amore account.")
        : (isArabic ? "أنشئي حساباً للمتابعة. يمكنك التسوق كضيفة دون حساب." : "Create an account, or continue shopping as a guest.")}</p>
      {mode === "sign-up" && <label><span className="field-label">{isArabic ? "الاسم" : "Name"}</span><input className="field" autoComplete="name" maxLength={120} value={displayName} onChange={e => setDisplayName(e.target.value)}/></label>}
      <label><span className="field-label">{isArabic ? "البريد الإلكتروني" : "Email"}</span><input className="field" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></label>
      <label><span className="field-label">{isArabic ? "كلمة المرور" : "Password"}</span><input className="field" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required minLength={mode === "sign-in" ? 1 : 8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label>
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      {message && <p className="rounded-xl bg-[#f8e8ec] p-3 text-xs leading-6 text-[#5B0D1E]" role="status">{message}</p>}
      <button disabled={pending || loading || signupComplete} className="btn-primary w-full disabled:opacity-50">{pending ? submittingText : mode === "sign-in" ? (isArabic ? "دخول" : "Sign in") : signupComplete ? (isArabic ? "تم إنشاء الحساب" : "Account created") : (isArabic ? "إنشاء الحساب" : "Create account")}<ArrowRight size={14}/></button>
      {mode === "sign-up" && signupComplete && <button type="button" disabled={pending || resendCooldown > 0} onClick={() => void resendConfirmationEmail()} className="btn-outline w-full disabled:opacity-50">
        {pending ? submittingText : resendCooldown > 0
          ? (isArabic ? `إعادة الإرسال بعد ${resendCooldown} ث` : `Resend in ${resendCooldown}s`)
          : (isArabic ? "إعادة إرسال رسالة التأكيد" : "Resend confirmation email")}
      </button>}
      <p className="text-xs text-center text-[#795963]">
        {mode === "sign-in" ? (isArabic ? "ليس لديك حساب؟ " : "New to Amore? ") : (isArabic ? "لديك حساب؟ " : "Already have an account? ")}
        <Link className="font-semibold text-[#5B0D1E] underline" href={mode === "sign-in" ? "/sign-up" : "/sign-in"}>
          {mode === "sign-in" ? (isArabic ? "إنشاء حساب" : "Create account") : (isArabic ? "تسجيل الدخول" : "Sign in")}
        </Link>
      </p>
      {mode === "sign-in" && <Link className="text-center text-xs text-[#5B0D1E] underline" href="/forgot-password">{isArabic ? "نسيتِ كلمة المرور؟" : "Forgot password?"}</Link>}
      <Link className="text-center text-xs text-[#795963] underline" href="/">{isArabic ? "المتابعة كضيفة" : "Continue as guest"}</Link>
    </form>
  </div>;
}

export function PasswordRecoveryPage({ mode, lang, onToggleLanguage }: { mode: "request" | "reset"; lang: Lang; onToggleLanguage: () => void }) {
  const {
    requestPasswordRecovery, establishRecoverySession, updatePasswordFromRecovery,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [sent, setSent] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const actionLock = useRef(false);
  const recoveryStarted = useRef(false);
  const isArabic = lang === "ar";

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (mode !== "reset" || recoveryStarted.current) return;
    recoveryStarted.current = true;
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const type = fragment.get("type");
    const accessToken = fragment.get("access_token") ?? "";
    const refreshToken = fragment.get("refresh_token") ?? "";
    // Remove one-time credentials from the address bar and browser history
    // before sending them to the backend over the same-origin HTTPS request.
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    if (type !== "recovery" || !accessToken || !refreshToken) {
      setError(isArabic
        ? "رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلبي رابطاً جديداً."
        : "This reset link is invalid or expired. Request a new one.");
      return;
    }
    actionLock.current = true;
    setPending(true);
    void establishRecoverySession(accessToken, refreshToken)
      .then(() => setReady(true))
      .catch(cause => setError(cause instanceof Error ? cause.message : (isArabic ? "تعذر التحقق من رابط الاستعادة." : "Could not verify the reset link.")))
      .finally(() => {
        actionLock.current = false;
        setPending(false);
      });
  }, [establishRecoverySession, isArabic, mode]);

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLock.current || cooldown > 0) return;
    actionLock.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await requestPasswordRecovery(email.trim());
      setSent(true);
      setCooldown(60);
      setMessage(isArabic
        ? "إذا كان البريد مرتبطاً بحساب، فستصل رسالة الاستعادة. استخدمي أحدث رابط فقط."
        : "If this email belongs to an account, a reset message was requested. Use only the latest link.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isArabic ? "تعذر طلب استعادة كلمة المرور." : "Could not request a password reset."));
    } finally {
      actionLock.current = false;
      setPending(false);
    }
  }

  async function saveNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLock.current || !ready) return;
    setError("");
    setMessage("");
    if (password !== confirmPassword) {
      setError(isArabic ? "كلمتا المرور غير متطابقتين." : "The passwords do not match.");
      return;
    }
    actionLock.current = true;
    setPending(true);
    try {
      await updatePasswordFromRecovery(password);
      setUpdated(true);
      setMessage(isArabic ? "تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن." : "Your password was updated. You can sign in now.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isArabic ? "تعذر تحديث كلمة المرور." : "Could not update the password."));
    } finally {
      actionLock.current = false;
      setPending(false);
    }
  }

  const title = mode === "request"
    ? (isArabic ? "استعادة كلمة المرور" : "Reset your password")
    : (isArabic ? "اختاري كلمة مرور جديدة" : "Choose a new password");

  return <div dir={isArabic ? "rtl" : "ltr"} className="min-h-[100dvh] bg-[#f8e8ec] px-4 py-10 flex flex-col items-center justify-center">
    <AuthHeader lang={lang} onToggle={onToggleLanguage}/>
    <Link href="/" className="mb-6"><img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/images/amore-logo.png`} className="w-24 h-24 rounded-full object-contain" alt="Amore Cookies"/></Link>
    <form onSubmit={mode === "request" ? requestReset : saveNewPassword} className="card-surface w-full max-w-[440px] p-6 sm:p-8 grid gap-4">
      <h1 className="serif text-3xl text-[#5B0D1E]">{title}</h1>
      {mode === "request"
        ? <p className="text-xs leading-6 text-[#795963]">{isArabic ? "أدخلي بريد الحساب. إذا كان مسجلاً، سنطلب رسالة استعادة من Supabase." : "Enter the account email. If it is registered, Supabase will send reset instructions."}</p>
        : <p className="text-xs leading-6 text-[#795963]">{isArabic ? "يجب أن يكون الرابط حديثاً ومستخدماً مرة واحدة. لا تشاركيه مع أحد." : "The reset link is single-use. Do not share it with anyone."}</p>}
      {mode === "request" && <label><span className="field-label">{isArabic ? "البريد الإلكتروني" : "Email"}</span><input className="field" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></label>}
      {mode === "reset" && <>
        <label><span className="field-label">{isArabic ? "كلمة المرور الجديدة" : "New password"}</span><input className="field" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label>
        <label><span className="field-label">{isArabic ? "تأكيد كلمة المرور" : "Confirm password"}</span><input className="field" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}/></label>
      </>}
      {pending && mode === "reset" && <p className="text-xs text-[#795963]" role="status">{isArabic ? "جارٍ التحقق من الرابط…" : "Verifying the reset link…"}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      {message && <p className="rounded-xl bg-[#f8e8ec] p-3 text-xs leading-6 text-[#5B0D1E]" role="status">{message}</p>}
      {mode === "request" && !sent && <button disabled={pending || cooldown > 0} className="btn-primary w-full disabled:opacity-50">{pending ? (isArabic ? "جارٍ الإرسال…" : "Sending…") : (isArabic ? "طلب رابط الاستعادة" : "Send reset link")}<ArrowRight size={14}/></button>}
      {mode === "request" && sent && <button type="button" disabled={pending || cooldown > 0} onClick={() => setSent(false)} className="btn-outline w-full disabled:opacity-50">
        {cooldown > 0
          ? (isArabic ? `إعادة الطلب بعد ${cooldown} ث` : `Request again in ${cooldown}s`)
          : (isArabic ? "طلب رسالة أخرى" : "Request another email")}
      </button>}
      {mode === "reset" && !updated && <button disabled={pending || !ready} className="btn-primary w-full disabled:opacity-50">{pending ? (isArabic ? "جارٍ الحفظ…" : "Saving…") : (isArabic ? "حفظ كلمة المرور" : "Save new password")}<ArrowRight size={14}/></button>}
      {(mode === "request" || updated || error) && <Link href="/sign-in" className="text-center text-xs text-[#5B0D1E] underline">{isArabic ? "العودة لتسجيل الدخول" : "Back to sign in"}</Link>}
      {mode === "reset" && error && <Link href="/forgot-password" className="text-center text-xs text-[#5B0D1E] underline">{isArabic ? "طلب رابط جديد" : "Request a new reset link"}</Link>}
    </form>
  </div>;
}

export function AccountPage({ lang }: { lang: Lang }) {
  const { user, loading, error, signOut } = useAuth();
  const [message, setMessage] = useState("");
  const isArabic = lang === "ar";
  if (loading) return <div className="container-wide py-24 text-center text-sm text-[#795963]">{isArabic ? "جارٍ تحميل الحساب…" : "Loading account…"}</div>;
  if (!user) return <div className="container-wide py-24 max-w-xl text-center">
    <UserRound className="mx-auto text-[#9d5367]" size={34}/>
    <h1 className="serif text-4xl text-[#5B0D1E] mt-5">{isArabic ? "حساب أموري" : "Your Amore account"}</h1>
    {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
    <div className="flex flex-wrap justify-center gap-3 mt-6"><Link className="btn-primary" href="/sign-in">{isArabic ? "تسجيل الدخول" : "Sign in"}</Link><Link className="btn-outline" href="/sign-up">{isArabic ? "إنشاء حساب" : "Create account"}</Link></div>
    <Link className="inline-block mt-5 text-xs underline text-[#795963]" href="/">{isArabic ? "المتابعة كضيفة" : "Continue as guest"}</Link>
  </div>;
  return <div className="container-wide py-20 max-w-xl">
    <section className="card-surface p-7 sm:p-9">
      <UserRound className="text-[#9d5367]" size={34}/>
      <h1 className="serif text-4xl text-[#5B0D1E] mt-5">{isArabic ? "حساب أموري" : "Your Amore account"}</h1>
      <p className="mt-4 text-sm text-[#795963]" dir="ltr">{user.email}</p>
      <p className="mt-3 text-xs text-[#795963]">{user.role === "administrator"
        ? (isArabic ? "صلاحية مدير المتجر" : "Store administrator")
        : (isArabic ? "حساب عميل" : "Customer account")}</p>
      {message && <p className="mt-4 text-xs text-[#5B0D1E]" role="status"><Check className="inline me-1" size={14}/>{message}</p>}
      <div className="mt-7 flex flex-wrap gap-3">
        {user.role === "administrator" && <Link className="btn-outline" href="/admin">{isArabic ? "إدارة المتجر" : "Manage store"}</Link>}
        <button className="btn-primary" onClick={async () => {
          try { await signOut(); setMessage(""); }
          catch { setMessage(isArabic ? "تعذر تسجيل الخروج. حاولي مجدداً." : "Sign out failed. Please retry."); }
        }}><LogOut size={14}/>{isArabic ? "تسجيل الخروج" : "Sign out"}</button>
      </div>
    </section>
  </div>;
}
