import { StartCheckoutBody } from "@workspace/api-zod";
import type { OrderAddress } from "@workspace/db";
import { HttpError } from "./errors";

/** Shared trust boundary for new orders; never apply to historical reads. */
export function checkoutAddress(input: unknown): OrderAddress {
  const parsed = StartCheckoutBody.safeParse({ address: input });
  if (!parsed.success || !parsed.data.address) {
    throw new HttpError(400, "Complete the delivery address. / يرجى إكمال عنوان التوصيل.");
  }
  const a = parsed.data.address;
  const address: OrderAddress = {
    area: a.area.trim(),
    block: a.block.trim(),
    street: a.street.trim(),
    house: a.house.trim(),
  };
  if (!address.area || !address.block || !address.street || !address.house) {
    throw new HttpError(400, "Complete the delivery address. / يرجى إكمال عنوان التوصيل.");
  }
  return a.location ? { ...address, location: a.location } : address;
}
