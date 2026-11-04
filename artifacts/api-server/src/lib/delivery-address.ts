import { StartCheckoutBody } from "@workspace/api-zod";
import type { OrderAddress } from "@workspace/db";
import { HttpError } from "./errors";

/** Shared trust boundary for new orders; never apply to historical reads. */
export function checkoutAddress(input: unknown): OrderAddress & {
  location: { latitude: number; longitude: number };
} {
  const parsed = StartCheckoutBody.safeParse({ address: input });
  if (!parsed.success || !parsed.data.address) {
    throw new HttpError(400, "Confirm a valid delivery point and complete the address. / حددي موقع التوصيل وأكّديه، ثم أكملي العنوان.");
  }
  const a = parsed.data.address;
  const address = { area: a.area.trim(), block: a.block.trim(), street: a.street.trim(), house: a.house.trim(), location: a.location };
  if (!address.area || !address.block || !address.street || !address.house
    || !Number.isFinite(a.location.latitude) || !Number.isFinite(a.location.longitude)) {
    throw new HttpError(400, "Complete the delivery address and location. / يرجى إكمال عنوان وموقع التوصيل.");
  }
  return address;
}
