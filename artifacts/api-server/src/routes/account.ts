import { Router } from "express";
import {
  AddAccountFavoriteBody, AddAccountFavoriteResponse,
  ListAccountFavoritesResponse, ListAccountOrdersResponse,
  RemoveAccountFavoriteBody, RemoveAccountFavoriteResponse,
} from "@workspace/api-zod";
import {
  addFavoriteRow, createSupabaseUserClient, listAccountOrderRows,
  listFavoriteRows, removeFavoriteRow,
} from "@workspace/db";
import { getCatalog } from "../lib/catalog";
import { getAuthenticatedUserContext } from "../lib/auth";
import { HttpError } from "../lib/errors";

const router = Router();

router.use("/account", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

async function accountClient(req: Parameters<typeof getAuthenticatedUserContext>[0], res: Parameters<typeof getAuthenticatedUserContext>[1]) {
  const context = await getAuthenticatedUserContext(req, res);
  if (!context) throw new HttpError(401, "Sign in to continue. / يرجى تسجيل الدخول للمتابعة.");
  return {
    user: context.user,
    client: createSupabaseUserClient(context.accessToken),
  };
}

router.get("/account/orders", async (req, res): Promise<void> => {
  const { client } = await accountClient(req, res);
  const rows = await listAccountOrderRows(client);
  const orders = rows.map(order => ({
    id: order.id,
    number: order.number,
    stage: order.paymentStatus === "cancelled" ? "cancelled" : order.fulfillmentStatus,
    financialStatus: order.paymentStatus.toUpperCase(),
    fulfillmentStatus: order.fulfillmentStatus.toUpperCase(),
    createdAt: order.createdAt.toISOString(),
    total: (order.totalFils / 1000).toFixed(3),
    currency: order.currency,
    items: order.items,
    hasMoreItems: false,
  }));
  res.json(ListAccountOrdersResponse.parse(orders));
});

router.get("/account/favorites", async (req, res): Promise<void> => {
  const { client } = await accountClient(req, res);
  const [favorites, products] = await Promise.all([listFavoriteRows(client), getCatalog()]);
  const productsById = new Map(products.map(product => [product.id, product]));
  const result = favorites.flatMap(favorite => {
    const product = productsById.get(favorite.productId);
    return product ? [{
      productId: favorite.productId,
      addedAt: favorite.createdAt.toISOString(),
      product,
    }] : [];
  });
  res.json(ListAccountFavoritesResponse.parse(result));
});

router.post("/account/favorites", async (req, res): Promise<void> => {
  const { productId } = AddAccountFavoriteBody.parse(req.body);
  const { user, client } = await accountClient(req, res);
  const product = (await getCatalog()).find(item => item.id === productId);
  if (!product) throw new HttpError(404, "Product not found. / المنتج غير موجود.");
  const favorite = await addFavoriteRow(client, user.id, productId);
  res.json(AddAccountFavoriteResponse.parse({
    productId: favorite.productId,
    addedAt: favorite.createdAt.toISOString(),
    product,
  }));
});

router.delete("/account/favorites", async (req, res): Promise<void> => {
  const { productId } = RemoveAccountFavoriteBody.parse(req.body);
  const { client } = await accountClient(req, res);
  await removeFavoriteRow(client, productId);
  res.json(RemoveAccountFavoriteResponse.parse({ ok: true }));
});

export default router;
