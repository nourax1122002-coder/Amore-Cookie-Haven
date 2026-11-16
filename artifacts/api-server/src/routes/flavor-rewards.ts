import { Router, type Request, type Response } from "express";
import {
  AskFlavorAssistantBody,
  AskFlavorAssistantResponse,
  CreateFlavorDraftBody,
  CreateFlavorDraftResponse,
  GetAdminFlavorRewardsResponse,
  GetAdminFlavorPaymentReviewsResponse,
  GetMyFlavorRewardsResponse,
  ListMyFlavorIdeasResponse,
  ListPublicFlavorRewardsResponse,
  PublishFlavorDraftParams,
  PublishFlavorDraftResponse,
  ReviewFlavorCommercialOutcomeBody,
  ReviewFlavorCommercialOutcomeParams,
  ReviewFlavorCommercialOutcomeResponse,
  ResolveAdminFlavorPaymentReviewBody,
  ResolveAdminFlavorPaymentReviewParams,
  ResolveAdminFlavorPaymentReviewResponse,
  CreateAdminFlavorTestRefundBody,
  CreateAdminFlavorTestRefundParams,
  CreateAdminFlavorTestRefundResponse,
  UpdateFlavorDraftBody,
  UpdateFlavorDraftParams,
  UpdateFlavorDraftResponse,
} from "@workspace/api-zod";
import { createSupabaseUserClient, supabase } from "@workspace/db";
import { getCatalog } from "../lib/catalog";
import { getAuthenticatedUserContext } from "../lib/auth";
import { AssistantError, createOpenRouter, validatePrivateInput } from "../lib/assistant/openrouter";
import { createGroqGateway } from "../lib/assistant/groq";
import { createAssistantQuota } from "../lib/assistant/quota";
import { HttpError } from "../lib/errors";
import { createStripeFlavorTestRefund } from "../lib/stripe-functions";
import {
  buildCreatorFlavorPerformance,
  type VerifiedFlavorOrderSnapshot,
  type VerifiedFlavorRewardEntry,
} from "../lib/flavor-rewards-wallet";
import { requireAdmin } from "../middlewares/security";

const router = Router();
const groq = createGroqGateway();
const openRouter = createOpenRouter();
const quota = createAssistantQuota(undefined, "flavor_assistant");
const ONE_TIME_FLAVOR_REQUEST_KEY = "00000000-0000-4000-8000-000000000100";
type Row = Record<string, unknown>;

const PUBLIC_IDEA_COLUMNS = [
  "id", "title", "title_ar", "description", "description_ar",
  "ingredients", "ingredients_ar", "confirmed_interest_count", "published_at",
].join(",");
const OWNER_IDEA_COLUMNS = [
  "id", "title", "title_ar", "description", "description_ar", "ingredients", "ingredients_ar",
  "status", "commercial_status", "commercial_notes", "confirmed_interest_count",
  "created_at", "updated_at", "published_at",
].join(",");

function text(row: Row, key: string, fallback = ""): string {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function int(row: Row, key: string): number {
  const value = Number(row[key] ?? 0);
  return Number.isSafeInteger(value) ? value : 0;
}

function iso(row: Row, key: string): string {
  const value = row[key];
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function nullableIso(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" || value instanceof Date ? iso(row, key) : null;
}

function requiredText(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(503, "Verified creator performance is temporarily unavailable.");
  }
  return value;
}

function requiredInteger(row: Row, key: string, allowNegative = false): number {
  const raw = row[key];
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new HttpError(503, "Verified creator performance is temporarily unavailable.");
  }
  return value;
}

function isFlavorPerformanceSchemaMissing(error: { code?: string } | null): boolean {
  return Boolean(error && ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? ""));
}

type QueryResult = { data: unknown; error: { code?: string } | null };

async function readFlavorRewardPages(
  req: Request,
  operation: string,
  loadPage: (from: number, to: number) => PromiseLike<QueryResult>,
): Promise<Row[] | null> {
  const pageSize = 500;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await loadPage(from, from + pageSize - 1);
    if (isFlavorPerformanceSchemaMissing(result.error)) {
      req.log.warn(
        { operation, databaseCode: result.error?.code ?? "unknown" },
        "Verified Flavor Rewards performance tables are not available yet",
      );
      return null;
    }
    const page = rowsOrFail(req, operation, result);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function creatorPerformance(
  req: Request,
  userId: string,
  ideaRows: Row[],
  client: ReturnType<typeof createSupabaseUserClient>,
) {
  const publishedFlavors = ideaRows
    .filter(row => text(row, "status") === "published")
    .map(row => ({
      id: requiredText(row, "id"),
      title: text(row, "title"),
      titleAr: text(row, "title_ar"),
    }));
  if (!publishedFlavors.length) {
    return { performanceStatus: "ready" as const, performanceFlavors: [] };
  }

  const flavorIds = publishedFlavors.map(flavor => flavor.id);
  const snapshots = await readFlavorRewardPages(req, "creator_paid_order_snapshots", (from, to) =>
    supabase.from("flavor_reward_order_snapshots")
      .select(
        "customer_order_id,flavor_id,creator_user_id,eligible_order_number,verified_paid_at,eligible_sales_fils,product_refunded_fils,product_disputed_fils",
      )
      .eq("creator_user_id", userId)
      .in("flavor_id", flavorIds)
      .not("verified_paid_at", "is", null)
      .order("verified_paid_at", { ascending: true })
      .range(from, to));
  if (!snapshots) {
    return { performanceStatus: "migration_required" as const, performanceFlavors: [] };
  }

  const ledgerRows = await readFlavorRewardPages(req, "creator_verified_reward_ledger", (from, to) =>
    client.from("flavor_reward_paid_order_ledger")
      .select("flavor_id,creator_user_id,customer_order_id,eligible_order_number,entry_type,amount_fils")
      .eq("creator_user_id", userId)
      .in("flavor_id", flavorIds)
      .order("created_at", { ascending: true })
      .range(from, to));
  if (!ledgerRows) {
    return { performanceStatus: "migration_required" as const, performanceFlavors: [] };
  }

  const verifiedSnapshots: VerifiedFlavorOrderSnapshot[] = snapshots.map(row => {
    if (requiredText(row, "creator_user_id") !== userId) {
      throw new HttpError(503, "Verified creator performance is temporarily unavailable.");
    }
    const paidAt = nullableIso(row, "verified_paid_at");
    const orderNumber = row.eligible_order_number === null
      ? null
      : requiredInteger(row, "eligible_order_number");
    if (!paidAt || !orderNumber) {
      throw new HttpError(503, "A paid creator order is missing its verified payment record.");
    }
    return {
      orderReference: requiredText(row, "customer_order_id"),
      flavorId: requiredText(row, "flavor_id"),
      eligibleOrderNumber: orderNumber,
      verifiedPaidAt: paidAt,
      eligibleSalesFils: requiredInteger(row, "eligible_sales_fils"),
      productRefundedFils: requiredInteger(row, "product_refunded_fils"),
      productDisputedFils: requiredInteger(row, "product_disputed_fils"),
    };
  });
  const verifiedLedger: VerifiedFlavorRewardEntry[] = ledgerRows.map(row => {
    if (requiredText(row, "creator_user_id") !== userId) {
      throw new HttpError(503, "Verified creator performance is temporarily unavailable.");
    }
    const entryType = requiredText(row, "entry_type");
    if (!["milestone_bonus", "commission", "commission_adjustment"].includes(entryType)) {
      throw new HttpError(503, "A creator reward ledger entry has an unsupported type.");
    }
    return {
      flavorId: requiredText(row, "flavor_id"),
      orderReference: requiredText(row, "customer_order_id"),
      eligibleOrderNumber: requiredInteger(row, "eligible_order_number"),
      entryType: entryType as VerifiedFlavorRewardEntry["entryType"],
      amountFils: requiredInteger(row, "amount_fils", true),
    };
  });

  return {
    performanceStatus: "ready" as const,
    performanceFlavors: buildCreatorFlavorPerformance(publishedFlavors, verifiedSnapshots, verifiedLedger),
  };
}

function idea(row: Row) {
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    titleAr: text(row, "title_ar"),
    description: text(row, "description"),
    descriptionAr: text(row, "description_ar"),
    ingredients: text(row, "ingredients"),
    ingredientsAr: text(row, "ingredients_ar"),
    status: text(row, "status", "draft"),
    commercialStatus: text(row, "commercial_status", "not_reviewed"),
    commercialNotes: text(row, "commercial_notes"),
    confirmedInterestCount: int(row, "confirmed_interest_count"),
    createdAt: iso(row, "created_at"),
    updatedAt: iso(row, "updated_at"),
    publishedAt: nullableIso(row, "published_at"),
  };
}

function publicIdea(
  row: Row,
  checkoutProduct: {
    id: string;
    title: string;
    titleAr: string;
    priceFils: number;
    available: boolean;
  } | null = null,
) {
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    titleAr: text(row, "title_ar"),
    description: text(row, "description"),
    descriptionAr: text(row, "description_ar"),
    ingredients: text(row, "ingredients"),
    ingredientsAr: text(row, "ingredients_ar"),
    confirmedInterestCount: int(row, "confirmed_interest_count"),
    publishedAt: iso(row, "published_at"),
    checkoutProduct,
  };
}

function payout(row: Row) {
  return {
    id: text(row, "id"),
    amountFils: int(row, "amount_fils"),
    status: text(row, "status", "pending"),
    adminNote: text(row, "admin_note"),
    payoutReference: text(row, "payout_reference"),
    createdAt: iso(row, "created_at"),
    updatedAt: iso(row, "updated_at"),
  };
}

function rewardEntry(row: Row) {
  const metadata = row.metadata;
  return {
    id: text(row, "id"),
    flavorId: text(row, "flavor_id"),
    entryType: text(row, "entry_type"),
    amountFils: int(row, "amount_fils"),
    currency: "KWD",
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
    createdAt: iso(row, "created_at"),
  };
}

function payoutEvent(row: Row) {
  return {
    id: text(row, "id"),
    requestId: text(row, "request_id"),
    action: text(row, "action"),
    note: text(row, "note"),
    payoutReference: text(row, "payout_reference"),
    createdAt: iso(row, "created_at"),
  };
}

function adminIdea(row: Row) {
  return { ...idea(row), creatorUserId: text(row, "creator_user_id") };
}

function adminSale(row: Row) {
  return {
    id: text(row, "id"),
    flavorId: text(row, "flavor_id"),
    creatorUserId: text(row, "creator_user_id"),
    sourceReference: text(row, "source_reference"),
    netSalesFils: int(row, "net_sales_fils"),
    notes: text(row, "notes"),
    recordedAt: iso(row, "recorded_at"),
  };
}

function databaseFailure(req: Request, operation: string, error: { code?: string } | null) {
  if (!error) return;
  req.log.error({ operation, databaseCode: error.code ?? "unknown" }, "Flavor Rewards database request failed");
  if (error.code === "23505" || error.code === "22023") {
    throw new HttpError(409, "This action could not be completed with the current reward balance or status.");
  }
  if (error.code === "P0002") throw new HttpError(404, "The requested flavor or reward record was not found.");
  if (error.code === "42501") throw new HttpError(403, "This action is not allowed for this account.");
  throw new HttpError(503, "Flavor Rewards is temporarily unavailable. Please retry.");
}

function rowsOrFail(req: Request, operation: string, result: { data: unknown; error: { code?: string } | null }): Row[] {
  databaseFailure(req, operation, result.error);
  return Array.isArray(result.data) ? result.data as Row[] : [];
}

function rowOrFail(req: Request, operation: string, result: { data: unknown; error: { code?: string } | null }): Row {
  databaseFailure(req, operation, result.error);
  if (!result.data || typeof result.data !== "object") {
    throw new HttpError(503, "Flavor Rewards is temporarily unavailable. Please retry.");
  }
  return result.data as Row;
}

async function signedIn(req: Request, res: Response) {
  const context = await getAuthenticatedUserContext(req, res);
  if (!context) throw new HttpError(401, "Sign in to use Flavor Rewards. / يرجى تسجيل الدخول لاستخدام مكافآت النكهات.");
  return {
    user: context.user,
    client: createSupabaseUserClient(context.accessToken),
  };
}

async function adminUser(req: Request, res: Response) {
  const context = await getAuthenticatedUserContext(req, res);
  if (!context || context.user.role !== "administrator") {
    throw new HttpError(403, "Administrator access is required.");
  }
  return context.user;
}

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

router.get("/flavor-rewards", async (req, res): Promise<void> => {
  const result = await supabase.from("published_flavor_ideas")
    .select(PUBLIC_IDEA_COLUMNS)
    .order("published_at", { ascending: false })
    .limit(60);
  const ideaRows = rowsOrFail(req, "public_list", result);
  const mappings = ideaRows.length
    ? await supabase.from("flavor_reward_products")
      .select("flavor_id,product_id")
      .in("flavor_id", ideaRows.map(row => text(row, "id")))
    : { data: [], error: null };
  const mappingRows = mappings.error
    && ["42P01", "PGRST205"].includes(mappings.error.code ?? "")
    ? []
    : rowsOrFail(req, "public_product_mappings", mappings);
  const catalog = mappingRows.length ? await getCatalog(true) : [];
  const byFlavor = new Map(mappingRows.map(mapping => [
    text(mapping as Row, "flavor_id"),
    text(mapping as Row, "product_id"),
  ]));
  const items = ideaRows.map(row => {
    const productId = byFlavor.get(text(row, "id"));
    const product = productId ? catalog.find(item => item.variantId === productId) : undefined;
    const priceFils = product ? Math.round(product.price * 1000) : 0;
    return publicIdea(row, product && Number.isSafeInteger(priceFils) && priceFils > 0
      ? {
        id: product.variantId,
        title: product.title,
        titleAr: product.titleAr,
        priceFils,
        available: product.available,
      }
      : null);
  });
  res.json(ListPublicFlavorRewardsResponse.parse(items));
});

router.get("/flavor-rewards/mine", async (req, res): Promise<void> => {
  const { user } = await signedIn(req, res);
  const result = await supabase.from("flavor_ideas")
    .select("*")
    .eq("creator_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const items = rowsOrFail(req, "creator_ideas", result).map(idea);
  res.json(ListMyFlavorIdeasResponse.parse(items));
});

router.post("/flavor-rewards/drafts", async (req, res): Promise<void> => {
  const { user, client } = await signedIn(req, res);
  const body = CreateFlavorDraftBody.parse(req.body);
  const existing = await client.from("flavor_ideas")
    .select("id")
    .eq("creator_user_id", user.id)
    .limit(1)
    .maybeSingle();
  databaseFailure(req, "draft_limit_check", existing.error);
  if (existing.data) {
    throw new HttpError(409, "You have already used your one Flavor Rewards idea. Edit the existing draft instead.");
  }

  // The constant request key plus the existing (creator_user_id, request_key)
  // uniqueness constraint makes simultaneous app requests fail closed.
  const result = await client.from("flavor_ideas").insert({
    creator_user_id: user.id,
    request_key: ONE_TIME_FLAVOR_REQUEST_KEY,
    title: body.title.trim(),
    title_ar: body.titleAr.trim(),
    description: body.description?.trim() ?? "",
    description_ar: body.descriptionAr?.trim() ?? "",
    ingredients: body.ingredients?.trim() ?? "",
    ingredients_ar: body.ingredientsAr?.trim() ?? "",
  })
    .select(OWNER_IDEA_COLUMNS)
    .single();
  const item = idea(rowOrFail(req, "draft_create", result));
  res.status(201).json(CreateFlavorDraftResponse.parse(item));
});

router.patch("/flavor-rewards/drafts/:id", async (req, res): Promise<void> => {
  const { client } = await signedIn(req, res);
  const { id } = UpdateFlavorDraftParams.parse(req.params);
  const body = UpdateFlavorDraftBody.parse(req.body);
  const fields: Record<string, string> = {};
  if (body.title !== undefined) fields.title = body.title.trim();
  if (body.titleAr !== undefined) fields.title_ar = body.titleAr.trim();
  if (body.description !== undefined) fields.description = body.description.trim();
  if (body.descriptionAr !== undefined) fields.description_ar = body.descriptionAr.trim();
  if (body.ingredients !== undefined) fields.ingredients = body.ingredients.trim();
  if (body.ingredientsAr !== undefined) fields.ingredients_ar = body.ingredientsAr.trim();
  const result = await client.from("flavor_ideas")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(OWNER_IDEA_COLUMNS)
    .maybeSingle();
  if (!result.data && !result.error) throw new HttpError(404, "Draft not found or no longer editable.");
  const item = idea(rowOrFail(req, "draft_update", result));
  res.json(UpdateFlavorDraftResponse.parse(item));
});

router.post("/flavor-rewards/drafts/:id/publish", async (req, res): Promise<void> => {
  const { client } = await signedIn(req, res);
  const { id } = PublishFlavorDraftParams.parse(req.params);
  const rpc = await client.rpc("publish_flavor_idea", { p_flavor_id: id });
  databaseFailure(req, "draft_publish", rpc.error);
  const result = await client.from("flavor_ideas")
    .select(OWNER_IDEA_COLUMNS)
    .eq("id", id)
    .single();
  res.json(PublishFlavorDraftResponse.parse(idea(rowOrFail(req, "published_idea", result))));
});

router.post("/flavor-rewards/:id/interest", async (_req, res): Promise<void> => {
  await signedIn(_req, res);
  // The local SQL draft removes monetary awards but must be approved and
  // applied before interest registration is re-enabled.
  throw new HttpError(409, "Interest registration is paused until reward rules are safely updated.");
});

router.get("/account/flavor-rewards", async (req, res): Promise<void> => {
  const { user, client } = await signedIn(req, res);
  const [ideas, ledger, requests, events] = await Promise.all([
    supabase.from("flavor_ideas").select("*").eq("creator_user_id", user.id)
      .order("created_at", { ascending: false }).limit(100),
    client.from("flavor_reward_ledger").select("*").order("created_at", { ascending: false }).limit(500),
    client.from("flavor_payout_requests").select("*").order("created_at", { ascending: false }).limit(100),
    client.from("flavor_payout_events").select("*").order("created_at", { ascending: false }).limit(250),
  ]);
  const ideaRows = rowsOrFail(req, "creator_ideas", ideas);
  const ledgerRows = rowsOrFail(req, "creator_ledger", ledger);
  const payoutRows = rowsOrFail(req, "creator_payouts", requests);
  const eventRows = rowsOrFail(req, "creator_payout_events", events);
  const performance = await creatorPerformance(req, user.id, ideaRows, client);
  // Existing entries were created by interest counts or manual sale entry,
  // neither of which is proof of a verified paid order.
  const historicalLedgerFils = ledgerRows.reduce((sum, row) => sum + int(row, "amount_fils"), 0);
  const reservedFils = payoutRows.reduce((sum, row) =>
    ["pending", "approved", "paid"].includes(text(row, "status")) ? sum + int(row, "amount_fils") : sum, 0);
  res.json(GetMyFlavorRewardsResponse.parse({
    ideas: ideaRows.map(idea),
    ledger: ledgerRows.map(rewardEntry),
    payoutRequests: payoutRows.map(payout),
    payoutEvents: eventRows.map(payoutEvent),
    earnedFils: historicalLedgerFils,
    reservedFils,
    availableFils: 0,
    ...performance,
  }));
});

router.post("/account/flavor-rewards/payout-requests", async (req, res): Promise<void> => {
  await signedIn(req, res);
  throw new HttpError(409, "Payout requests are paused until rewards are linked to verified paid orders.");
});

router.post("/flavor-rewards/assistant", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const { user } = await signedIn(req, res);
  const parsed = AskFlavorAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send a short flavor-idea conversation.", code: "validation" });
    return;
  }
  const { messages, language } = parsed.data;
  if (messages.reduce((total, message) => total + message.content.length, 0) > 6000
    || messages.at(-1)?.role !== "user"
    || messages.some((message, index) =>
      message.role !== (index % 2 === 0 ? "user" : "assistant") || !message.content.trim())) {
    res.status(400).json({ error: "Please restart with a short flavor-idea message.", code: "validation" });
    return;
  }
  try {
    messages.forEach(message => validatePrivateInput(message.content));
  } catch (error) {
    if (error instanceof AssistantError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }

  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
    throw new AssistantError("configuration");
  }
  const controller = new AbortController();
  const close = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", close);
  const deadline = setTimeout(() => controller.abort(), 45_000);
  let release: (() => Promise<void>) | undefined;
  let provider = "unselected";
  try {
    release = await quota.acquire(req.ip ?? user.id);
    const publicIdeas = await supabase.from("published_flavor_ideas")
      .select(PUBLIC_IDEA_COLUMNS)
      .order("published_at", { ascending: false })
      .limit(10);
    const context = JSON.stringify(rowsOrFail(req, "assistant_context", publicIdeas).map(row => publicIdea(row)));
    let answer;
    if (process.env.GROQ_API_KEY) {
      provider = "groq";
      try {
        answer = await groq.chat(process.env.GROQ_API_KEY, messages, context, controller.signal, language, "flavor");
      } catch (error) {
        const failure = error instanceof AssistantError ? error : new AssistantError("network");
        if (["rate_limit", "daily_limit", "timeout", "cancelled", "private_input"].includes(failure.code)
          || !process.env.OPENROUTER_API_KEY) throw failure;
        req.log.warn({ provider: "groq", assistantCode: failure.code }, "Flavor assistant using free OpenRouter fallback");
        provider = "openrouter_fallback";
        answer = await openRouter.chat(
          process.env.OPENROUTER_API_KEY,
          messages,
          context,
          controller.signal,
          language,
          "flavor",
        );
      }
    } else {
      provider = "openrouter";
      answer = await openRouter.chat(
        process.env.OPENROUTER_API_KEY!,
        messages,
        context,
        controller.signal,
        language,
        "flavor",
      );
    }
    if (!controller.signal.aborted) {
      res.json(AskFlavorAssistantResponse.parse(answer));
    }
  } catch (error) {
    let failure = error instanceof AssistantError ? error : new AssistantError("network");
    req.log.warn({ assistantCode: failure.code, assistantProvider: provider, userId: user.id }, "Flavor assistant request unavailable");
    if (controller.signal.aborted && !res.destroyed) failure = new AssistantError("timeout", 504);
    if (failure.status === 429 && failure.retryAfterSeconds) {
      if (release) await quota.cooldown(failure.retryAfterSeconds).catch(() => {});
      res.setHeader("Retry-After", failure.retryAfterSeconds);
    }
    if (!res.destroyed && !res.headersSent) {
      res.status(failure.status === 499 ? 503 : failure.status).json({
        error: failure.message,
        code: failure.code,
        ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
      });
    }
  } finally {
    clearTimeout(deadline);
    res.off("close", close);
    if (release) await release().catch(() => {});
  }
});

router.use("/admin/flavor-rewards", requireAdmin);
router.get("/admin/flavor-rewards", async (req, res): Promise<void> => {
  await adminUser(req, res);
  const [ideas, sales, payoutRequests, payoutEvents] = await Promise.all([
    supabase.from("flavor_ideas").select("*").order("created_at", { ascending: false }).limit(300),
    supabase.from("flavor_sales").select("*").order("recorded_at", { ascending: false }).limit(300),
    supabase.from("flavor_payout_requests").select("*").order("created_at", { ascending: false }).limit(300),
    supabase.from("flavor_payout_events").select("*").order("created_at", { ascending: false }).limit(500),
  ]);
  res.json(GetAdminFlavorRewardsResponse.parse({
    ideas: rowsOrFail(req, "admin_ideas", ideas).map(adminIdea),
    sales: rowsOrFail(req, "admin_sales", sales).map(adminSale),
    payoutRequests: rowsOrFail(req, "admin_payouts", payoutRequests).map(payout),
    payoutEvents: rowsOrFail(req, "admin_payout_events", payoutEvents).map(payoutEvent),
  }));
});

router.get("/admin/flavor-rewards/payment-reviews", async (req, res): Promise<void> => {
  await adminUser(req, res);
  const result = await supabase.from("flavor_reward_event_reviews")
    .select(
      "stripe_event_id,event_type,stripe_object_type,stripe_object_id,customer_order_id,stripe_payment_intent_id,amount_minor,currency,reason_code,review_status,reviewed_by,reviewed_by_snapshot,reviewed_at,review_note,event_created_at,created_at",
    )
    .order("event_created_at", { ascending: false })
    .limit(100);
  const reviews = rowsOrFail(req, "payment_review_events", result).map(row => ({
    ...row,
    reviewed_by: row.reviewed_by_snapshot ?? row.reviewed_by ?? null,
  }));
  res.json(GetAdminFlavorPaymentReviewsResponse.parse({ reviews }));
});

router.patch("/admin/flavor-rewards/payment-reviews/:eventId", async (req, res): Promise<void> => {
  const { eventId } = ResolveAdminFlavorPaymentReviewParams.parse(req.params);
  const body = ResolveAdminFlavorPaymentReviewBody.parse(req.body);
  const user = await adminUser(req, res);
  const result = await supabase.rpc("resolve_flavor_reward_event_review", {
    p_admin_user_id: user.id,
    p_stripe_event_id: eventId,
    p_decision: body.decision,
    p_note: body.note,
  });
  databaseFailure(req, "payment_review_resolution", result.error);
  res.json(ResolveAdminFlavorPaymentReviewResponse.parse({ ok: true }));
});

router.post("/admin/flavor-rewards/orders/:orderId/refunds", async (req, res): Promise<void> => {
  const { orderId } = CreateAdminFlavorTestRefundParams.parse(req.params);
  const body = CreateAdminFlavorTestRefundBody.parse(req.body);
  await adminUser(req, res);
  const refund = await createStripeFlavorTestRefund({
    orderId,
    component: body.component,
    requestKey: body.requestKey,
    ...(body.quantity === undefined ? {} : { quantity: body.quantity }),
  });
  res.status(201).json(CreateAdminFlavorTestRefundResponse.parse(refund));
});

router.patch("/admin/flavor-rewards/:id/review", async (req, res): Promise<void> => {
  const { id } = ReviewFlavorCommercialOutcomeParams.parse(req.params);
  const body = ReviewFlavorCommercialOutcomeBody.parse(req.body);
  const user = await adminUser(req, res);
  const result = await supabase.rpc("record_flavor_commercial_review", {
    p_admin_user_id: user.id,
    p_flavor_id: id,
    p_decision: body.decision,
    p_notes: body.notes ?? "",
  });
  databaseFailure(req, "commercial_review", result.error);
  res.json(ReviewFlavorCommercialOutcomeResponse.parse({ ok: true }));
});

router.post("/admin/flavor-rewards/:id/sales", async (req, res): Promise<void> => {
  await adminUser(req, res);
  throw new HttpError(409, "Manual sales cannot earn rewards; only verified Stripe Test Mode orders will qualify.");
});

router.patch("/admin/flavor-rewards/payout-requests/:id", async (req, res): Promise<void> => {
  await adminUser(req, res);
  throw new HttpError(409, "Payout processing is paused until balances are backed by verified paid orders.");
});

export default router;
