import { useState, type FormEvent } from "react";
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
  const { signIn, signUp, loading } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const isArabic = lang === "ar";
  const submittingText = isArabic ? "جارٍ المتابعة…" : "Please wait…";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          setMessage(isArabic
            ? "تحققي من بريدك الإلكتروني لإكمال إنشاء الحساب، ثم سجّلي الدخول."
            : "Check your email to finish creating your account, then sign in.");
        } else {
          navigate(result.user?.role === "administrator" ? "/admin" : "/user-portal");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isArabic ? "تعذر إكمال الطلب." : "We could not complete that request."));
    } finally {
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
      <button disabled={pending || loading} className="btn-primary w-full disabled:opacity-50">{pending ? submittingText : mode === "sign-in" ? (isArabic ? "دخول" : "Sign in") : (isArabic ? "إنشاء الحساب" : "Create account")}<ArrowRight size={14}/></button>
      <p className="text-xs text-center text-[#795963]">
        {mode === "sign-in" ? (isArabic ? "ليس لديك حساب؟ " : "New to Amore? ") : (isArabic ? "لديك حساب؟ " : "Already have an account? ")}
        <Link className="font-semibold text-[#5B0D1E] underline" href={mode === "sign-in" ? "/sign-up" : "/sign-in"}>
          {mode === "sign-in" ? (isArabic ? "إنشاء حساب" : "Create account") : (isArabic ? "تسجيل الدخول" : "Sign in")}
        </Link>
      </p>
      <Link className="text-center text-xs text-[#795963] underline" href="/">{isArabic ? "المتابعة كضيفة" : "Continue as guest"}</Link>
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
