import { z } from "zod";
import {
  decodeAccessToken,
  V2AddScopeItemRequestSchema,
  V2ScopeItemSchema,
  V2ScopeItemsResponseSchema,
  V2TokenItemsResponseSchema,
  V2RemoveScopeItemResponseSchema,
  V2DeleteScopeResponseSchema,
  V2_CAPABILITIES_HEADER,
  V2_READ_ONLY_CAPABILITY,
  type V2Selector,
} from "@abele/sync-protocol";
import { EngineError, HttpError } from "@abele/sync-core";
import { safeError, safeFetch } from "./errors.js";

export type ScopeItem = z.infer<typeof V2ScopeItemSchema>;
export type ScopeItemsResponse = z.infer<typeof V2ScopeItemsResponseSchema>;

/** Key-level management; item selection is only needed for content sync. */
export class ItemClient {
  private constructor(
    private readonly key: string,
    private readonly address: string,
    private readonly fetcher: typeof fetch,
  ) {}

  static fromToken(
    encoded: string,
    transport: { fetch: typeof fetch },
  ): ItemClient {
    const token = decodeAccessToken(encoded);
    return new ItemClient(
      token.key,
      token.address.replace(/\/$/, ""),
      safeFetch(transport.fetch),
    );
  }

  private async request<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    try {
      const response = await this.fetcher(this.address + path, {
        method,
        headers: {
          authorization: "Bearer " + this.key,
          [V2_CAPABILITIES_HEADER]: V2_READ_ONLY_CAPABILITY,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(idempotencyKey === undefined
            ? {}
            : { "idempotency-key": idempotencyKey }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new HttpError(
          response.status,
          response.status === 401 ? "unauthorized" : "protocol",
          "Item request refused",
        );
      }
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success)
        throw new EngineError("protocol", "Invalid item response");
      return parsed.data;
    } catch (error) {
      throw safeError(error);
    }
  }

  /** The server has no item capability flag: probe its authenticated inventory. */
  async supportsItems(): Promise<boolean> {
    try {
      await this.items();
      return true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return false;
      throw error;
    }
  }

  items(): Promise<ScopeItemsResponse> {
    return this.request(
      V2ScopeItemsResponseSchema,
      "GET",
      "/v2/connection/items",
    );
  }

  /** Inventory of an owned key, without needing the recipient's secret. */
  tokenItems(tokenId: string): Promise<ScopeItemsResponse> {
    return this.request(
      V2TokenItemsResponseSchema,
      "GET",
      `/v2/tokens/${encodeURIComponent(tokenId)}/items`,
    );
  }

  addItem(tokenId: string, scope: V2Selector): Promise<ScopeItem> {
    const body = V2AddScopeItemRequestSchema.parse({ scope });
    return this.request(
      V2ScopeItemSchema,
      "POST",
      `/v2/tokens/${encodeURIComponent(tokenId)}/items`,
      body,
    );
  }

  removeItem(tokenId: string, itemId: string) {
    return this.request(
      V2RemoveScopeItemResponseSchema,
      "DELETE",
      `/v2/tokens/${encodeURIComponent(tokenId)}/items/${encodeURIComponent(itemId)}`,
    );
  }

  /** Delete an owned item's content. Reuse the same idempotency key for retries. */
  deleteItem(itemId: string, idempotencyKey: string) {
    z.string().min(1).max(200).parse(idempotencyKey);
    return this.request(
      V2DeleteScopeResponseSchema,
      "POST",
      `/v2/connection/items/${encodeURIComponent(itemId)}/delete`,
      {},
      idempotencyKey,
    );
  }
}
