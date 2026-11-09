const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type SignedUploadResponse = {
  uploadUrl?: unknown;
  imageUrl?: unknown;
  error?: unknown;
};

function validSupabaseUpload(payload: SignedUploadResponse) {
  if (typeof payload.uploadUrl !== "string" || typeof payload.imageUrl !== "string") return false;
  try {
    const upload = new URL(payload.uploadUrl);
    const image = new URL(payload.imageUrl);
    const path = /^\/storage\/v1\/object\/upload\/sign\/amore-products\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/i.exec(upload.pathname);
    if (!path || upload.protocol !== "https:" || !upload.hostname.endsWith(".supabase.co") ||
      !upload.searchParams.get("token")) return false;
    return image.protocol === "https:" && image.hostname === upload.hostname &&
      image.pathname === `/storage/v1/object/public/amore-products/${path[1]}`;
  } catch {
    return false;
  }
}

export async function uploadAdminProductImage(file: File, fetcher: typeof fetch = fetch) {
  if (!PRODUCT_IMAGE_TYPES.has(file.type) || file.size === 0 || file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error("Choose a JPG, PNG, or WebP image up to 5 MB.");
  }

  const signingResponse = await fetcher("/api/admin/product-images/sign", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type }),
  });
  const payload = await signingResponse.json() as SignedUploadResponse;
  if (!signingResponse.ok || !validSupabaseUpload(payload)) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Could not prepare the product image upload.");
  }

  const uploadResponse = await fetcher(payload.uploadUrl as string, {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": file.type,
      "Cache-Control": "max-age=31536000",
      "x-upsert": "false",
    },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error("Product image upload failed. Please try again.");
  }

  return payload.imageUrl as string;
}
