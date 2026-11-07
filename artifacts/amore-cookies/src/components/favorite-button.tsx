import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { Link } from "wouter";
import {
  getListAccountFavoritesQueryKey,
  useAddAccountFavorite,
  useRemoveAccountFavorite,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";

type Lang = "en" | "ar";

type FavoriteButtonProps = {
  productId: string;
  isFavorite: boolean;
  lang: Lang;
  className?: string;
  compact?: boolean;
};

export function FavoriteButton({
  productId,
  isFavorite,
  lang,
  className = "",
  compact = false,
}: FavoriteButtonProps) {
  const ar = lang === "ar";
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<"saved" | "removed" | "error" | null>(null);
  const addFavorite = useAddAccountFavorite();
  const removeFavorite = useRemoveAccountFavorite();
  const pending = addFavorite.isPending || removeFavorite.isPending;

  const toggle = async () => {
    setFeedback(null);
    try {
      if (isFavorite) {
        await removeFavorite.mutateAsync({ data: { productId } });
        setFeedback("removed");
      } else {
        await addFavorite.mutateAsync({ data: { productId } });
        setFeedback("saved");
      }
      await queryClient.invalidateQueries({ queryKey: getListAccountFavoritesQueryKey() });
    } catch {
      setFeedback("error");
    }
  };

  const sharedClass = `inline-flex items-center justify-center gap-2 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9d5367] disabled:cursor-wait disabled:opacity-55 ${compact ? "h-10 w-10" : "min-h-10 px-4 py-2 text-xs font-semibold"} ${className}`;
  const label = loading
    ? (ar ? "جارٍ التحقق…" : "Checking…")
    : isFavorite
      ? (ar ? "إزالة من المفضلة" : "Remove from favorites")
      : (ar ? "أضيفي إلى المفضلة" : "Save to favorites");

  if (!user) {
    return <Link
      href="/sign-in"
      aria-label={label}
      title={label}
      className={`${sharedClass} border-[#e9d2d8] bg-[#fffaf8] text-[#5B0D1E] hover:bg-[#f8e8ec]`}
      data-testid={`link-favorite-sign-in-${productId}`}
    >
      <Heart size={compact ? 17 : 15} aria-hidden="true" />
      {!compact && <span>{ar ? "حفظ" : "Save"}</span>}
    </Link>;
  }

  return <div className="inline-flex flex-col items-center">
    <button
      type="button"
      disabled={pending || loading}
      onClick={() => void toggle()}
      aria-label={label}
      aria-pressed={isFavorite}
      title={label}
      className={`${sharedClass} ${isFavorite ? "border-[#5B0D1E] bg-[#5B0D1E] text-[#fffaf8]" : "border-[#e9d2d8] bg-[#fffaf8] text-[#5B0D1E] hover:bg-[#f8e8ec]"}`}
      data-testid={`button-favorite-${productId}`}
    >
      <Heart size={compact ? 17 : 15} fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" />
      {!compact && <span>{isFavorite ? (ar ? "محفوظ" : "Saved") : (ar ? "حفظ" : "Save")}</span>}
    </button>
    {feedback && <span className="sr-only" role={feedback === "error" ? "alert" : "status"}>
      {feedback === "saved"
        ? (ar ? "تمت الإضافة إلى المفضلة." : "Added to favorites.")
        : feedback === "removed"
          ? (ar ? "تمت الإزالة من المفضلة." : "Removed from favorites.")
          : (ar ? "تعذر تحديث المفضلة. حاولي مجدداً." : "Could not update favorites. Please retry.")}
    </span>}
  </div>;
}
