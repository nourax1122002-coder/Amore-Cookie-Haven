// Explicit setup only: creates the owner's two approved products, zero inventory,
// approved KWD reference prices, and publishes to the Replit channel.
// Never run automatically during startup or deployment.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

function admin(query, variables) {
  return JSON.parse(execFileSync(process.execPath, ["shopify-admin-api.mjs", JSON.stringify({ query, variables })], { encoding: "utf8" })).data;
}
const existing = admin(`query { products(first:100,query:"tag:amore") { nodes { id handle } }
  locations(first:1) { nodes { id } }
  publications(first:20) { nodes { id name } }
  metafieldDefinitions(first:50,ownerType:PRODUCT,namespace:"amore") { nodes { key } }
}`);
const publication = existing.publications.nodes.find(p => /replit/i.test(p.name));
const location = existing.locations.nodes[0];
if (!publication || !location) throw new Error("Replit publication or inventory location is not provisioned.");
const definitions = [
  ["title_ar", "Arabic title", "single_line_text_field"],
  ["description_ar", "Arabic description", "multi_line_text_field"],
  ["price_kwd", "Approved price in KWD", "number_decimal"],
  ["pieces", "Pieces per bag", "number_integer"],
  ["image_path", "Store image path", "single_line_text_field"],
  ["low_stock_threshold", "Low stock threshold", "number_integer"],
  ["ingredients", "Ingredients", "multi_line_text_field"],
  ["ingredients_ar", "Arabic ingredients", "multi_line_text_field"],
];
for (const [key, name, type] of definitions) {
  if (existing.metafieldDefinitions.nodes.some(d => d.key === key)) continue;
  admin(`mutation($d:MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition:$d) { createdDefinition { id } userErrors { field message } }
  }`, { d: { namespace: "amore", key, name, type, ownerType: "PRODUCT", access: { storefront: "PUBLIC_READ" } } });
}

const products = [
  {
    title: "Classic Belgian Cocoa", titleAr: "كاكاو بلجيكي كلاسيكي", handle: "classic-belgian-cocoa",
    description: "Classic cookie dough with Belgian cocoa. Frozen Cookie Dough – Ready to Bake. Each bag contains 12 cookies.",
    descriptionAr: "عجينة كوكيز كلاسيكية بالكاكاو البلجيكي. عجينة كوكيز مفرزنة وجاهزة للخبز. يحتوي كل كيس على 12 حبة.",
    image: "/images/amore-cookie.jpg",
    source: "attached_assets/🚨FALL_FLAVORS_ARE_HERE_🚨___&_New_York_statewide_shipping_is__1793734531685.jpg",
    mime: "image/jpeg",
  },
  {
    title: "Kinder Stuffed Cookie", titleAr: "كوكيز محشي بالكندر", handle: "kinder-stuffed-cookie",
    description: "Cookie dough stuffed with Kinder. Frozen Cookie Dough – Ready to Bake. Each bag contains 12 cookies.",
    descriptionAr: "عجينة كوكيز محشية بالكندر. عجينة كوكيز مفرزنة وجاهزة للخبز. يحتوي كل كيس على 12 حبة.",
    image: "/images/amore-package.png",
    source: "attached_assets/تغليف_كوكيز_أموري_بالتصميم_الكلاسيكي_1793734531683.png",
    mime: "image/png",
  },
];

for (const product of products) {
  const previous = existing.products.nodes.find(p => p.handle === product.handle);
  let p;
  if (previous) {
    p = admin(`query($id:ID!,$pub:ID!) { product(id:$id) { id handle publishedOnPublication(publicationId:$pub) variants(first:1) { nodes { id inventoryItem { id } } } } }`, { id: previous.id, pub: publication.id }).product;
    if (p.publishedOnPublication) { console.log(`Preserving existing product: ${p.handle}`); continue; }
  } else {
  const staged = admin(`mutation($i:[StagedUploadInput!]!) {
    stagedUploadsCreate(input:$i) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } }
  }`, { i: [{ resource: "IMAGE", filename: `${product.handle}.${product.mime === "image/png" ? "png" : "jpg"}`, mimeType: product.mime, httpMethod: "POST" }] });
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([await readFile(product.source)], { type: product.mime }), product.handle);
  const upload = await fetch(target.url, { method: "POST", body: form });
  if (!upload.ok) throw new Error(`Image upload failed: ${upload.status}`);
  const metafields = [
    ["title_ar", product.titleAr, "single_line_text_field"],
    ["description_ar", product.descriptionAr, "multi_line_text_field"],
    ["price_kwd", "10.0", "number_decimal"],
    ["pieces", "12", "number_integer"],
    ["image_path", product.image, "single_line_text_field"],
    ["low_stock_threshold", "0", "number_integer"],
  ].map(([key, value, type]) => ({ namespace: "amore", key, value, type }));
  const created = admin(`mutation($p:ProductCreateInput!,$m:[CreateMediaInput!]) {
    productCreate(product:$p,media:$m) { product { id handle variants(first:1) { nodes { id inventoryItem { id } } } } userErrors { field message } }
  }`, {
    p: { title: product.title, handle: product.handle, descriptionHtml: `<p>${product.description}</p>`, status: "ACTIVE", tags: ["amore"], metafields },
    m: [{ originalSource: target.resourceUrl, mediaContentType: "IMAGE", alt: `${product.title} — Amore Cookies brand image` }],
  });
  p = created.productCreate.product;
  }
  const variant = p.variants.nodes[0];
  admin(`mutation($id:ID!,$v:[ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId:$id,variants:$v) { productVariants { id } userErrors { field message } }
  }`, { id: p.id, v: [{ id: variant.id, price: "10.0", inventoryPolicy: "DENY" }] });
  admin(`mutation($id:ID!,$i:InventoryItemInput!) {
    inventoryItemUpdate(id:$id,input:$i) { inventoryItem { id tracked } userErrors { field message } }
  }`, { id: variant.inventoryItem.id, i: { tracked: true } });
  const levels = admin(`query($id:ID!,$loc:ID!) { inventoryItem(id:$id) { inventoryLevel(locationId:$loc) { id } } }`, { id: variant.inventoryItem.id, loc: location.id });
  if (!levels.inventoryItem.inventoryLevel) admin(`mutation($id:ID!,$loc:ID!,$key:String!) {
    inventoryActivate(inventoryItemId:$id,locationId:$loc) @idempotent(key:$key) { inventoryLevel { id } userErrors { field message } }
  }`, { id: variant.inventoryItem.id, loc: location.id, key: randomUUID() });
  if (!previous) admin(`mutation($i:InventorySetQuantitiesInput!,$key:String!) {
    inventorySetQuantities(input:$i) @idempotent(key:$key) { inventoryAdjustmentGroup { id } userErrors { field message } }
  }`, { key: randomUUID(), i: { name: "available", reason: "correction", quantities: [{ inventoryItemId: variant.inventoryItem.id, locationId: location.id, quantity: 0, changeFromQuantity: 0 }] } });
  admin(`mutation($id:ID!,$pub:ID!) {
    publishablePublish(id:$id,input:[{publicationId:$pub}]) { publishable { publishedOnPublication(publicationId:$pub) } userErrors { field message } }
  }`, { id: p.id, pub: publication.id });
  console.log(`Created and published ${p.handle}; inventory 0; approved KWD price 10. Store currency must be KWD before enabling checkout.`);
}
