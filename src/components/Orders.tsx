import { useState } from "react";
import { X, Copy } from "lucide-react";
import { use_store, Order, ProductCatalog, ShippingAddress } from "../store";
import { Button } from "./button";

function format_shipping_label(addr: ShippingAddress): string {
  const lines = [addr.name];
  if (addr.phone) lines.push(`Phone: ${addr.phone}`);
  lines.push(addr.street1);
  if (addr.street2) lines.push(addr.street2);
  lines.push(`${addr.city}, ${addr.state} ${addr.postcode}`);
  lines.push(addr.country);
  if (addr.email) lines.push(`Email: ${addr.email}`);
  return lines.join("\n");
}

function find_expected_price(
  order: Order,
  catalogs: ProductCatalog[]
): number | null {
  if (!order.product || !order.created_at) return null;
  const order_time = new Date(order.created_at).getTime() / 1000;
  const applicable_catalogs = catalogs.filter((c) => c.timestamp <= order_time);
  if (applicable_catalogs.length === 0) return null;
  const latest_catalog = applicable_catalogs[applicable_catalogs.length - 1];
  const matching_product = latest_catalog.products.find(
    (p) => p.compound_name === order.product.compound_name && p.quantity === order.product.quantity
  );
  if (!matching_product) return null;
  return matching_product.price + matching_product.shipping_cost;
}

function format_payment_received(order: Order): number {
  if (!order.payment) return 0;
  return order.payment.usdc + order.payment.usdt;
}

interface FulfillModalProps {
  order: Order;
  on_close: () => void;
}

function FulfillModal({ order, on_close }: FulfillModalProps) {
  const fulfill_order = use_store((state) => state.fulfill_order);
  const estimate_fulfill_cost = use_store((state) => state.estimate_fulfill_cost);

  const [tracking_url, set_tracking_url] = useState("");
  const [message, set_message] = useState("");
  const [estimating, set_estimating] = useState(false);
  const [cost_eth, set_cost_eth] = useState<string | null>(null);
  const [submitting, set_submitting] = useState(false);
  const [success, set_success] = useState<string | null>(null);

  const can_fulfill = order.buyer_address && order.buyer_gateway && order.buyer_secp256k1;

  const handle_estimate = async () => {
    if (!order.buyer_address || !order.buyer_gateway || !order.buyer_secp256k1 || !order.trx_hash) return;
    set_estimating(true);
    try {
      const result = await estimate_fulfill_cost(
        order.buyer_address,
        order.buyer_gateway,
        order.trx_hash,
        order.buyer_secp256k1,
        { order_trxn_hash: order.trx_hash, tracking_url, message }
      );
      set_cost_eth(result.costEth);
    } catch {
    } finally {
      set_estimating(false);
    }
  };

  const handle_submit = async () => {
    if (!order.buyer_address || !order.buyer_gateway || !order.buyer_secp256k1 || !order.trx_hash) return;
    set_submitting(true);
    try {
      const result = await fulfill_order(
        order.buyer_address,
        order.buyer_gateway,
        order.trx_hash,
        order.buyer_secp256k1,
        { order_trxn_hash: order.trx_hash, tracking_url, message }
      );
      set_success(result.txHash);
    } catch {
    } finally {
      set_submitting(false);
    }
  };

  if (!can_fulfill) {
    return (
      <div className="fixed inset-0 bg-primary/50 z-50 flex items-center justify-center p-[16px]" onClick={on_close}>
        <div className="bg-bg border border-lines rounded max-w-md w-full p-[16px]" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-[16px]">
            <p className="primary text-primary font-medium">Cannot Fulfill</p>
            <X size={16} className="text-secondary cursor-pointer hover:text-primary" onClick={on_close} />
          </div>
          <p className="secondary text-secondary">Missing buyer information for this order.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-primary/50 z-50 flex items-center justify-center p-[16px]" onClick={on_close}>
      <div className="bg-bg border border-lines rounded max-w-md w-full p-[16px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-[16px]">
          <p className="primary text-primary font-medium">Fulfill Order</p>
          <X size={16} className="text-secondary cursor-pointer hover:text-primary" onClick={on_close} />
        </div>
        {success ? (
          <div>
            <p className="primary text-accent-2 mb-[8px]">Fulfillment sent!</p>
            <p className="secondary text-secondary break-all">TX: {success}</p>
          </div>
        ) : (
          <>
            <div className="mb-[12px]">
              <p className="eyebrows text-secondary mb-[4px]">Tracking URL</p>
              <input
                type="text"
                value={tracking_url}
                onChange={(e) => { set_tracking_url(e.target.value); set_cost_eth(null); }}
                placeholder="https://..."
                className="pinput w-full p-[12px] bg-bgs border border-lines rounded text-primary"
              />
            </div>
            <div className="mb-[16px]">
              <p className="eyebrows text-secondary mb-[4px]">Message</p>
              <textarea
                value={message}
                onChange={(e) => { set_message(e.target.value); set_cost_eth(null); }}
                placeholder="Additional info for buyer..."
                className="pinput w-full p-[12px] bg-bgs border border-lines rounded text-primary resize-none h-[80px]"
              />
            </div>
            {cost_eth ? (
              <div className="mb-[12px] p-[12px] border border-lines rounded bg-bgs">
                <p className="secondary text-secondary">Estimated cost: {cost_eth} ETH</p>
              </div>
            ) : null}
            <div className="flex gap-[8px]">
              {cost_eth ? (
                <Button onClick={handle_submit} disabled={submitting}>
                  {submitting ? "Sending..." : "Send"}
                </Button>
              ) : (
                <Button onClick={handle_estimate} disabled={estimating}>
                  {estimating ? "Estimating..." : "Estimate Cost"}
                </Button>
              )}
              <Button variant="secondary" onClick={on_close} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Orders() {
  const orders = use_store((state) => state.orders);
  const product_catalogs = use_store((state) => state.product_catalogs);
  const private_key = use_store((state) => state.private_key);
  const [fulfill_order, set_fulfill_order] = useState<Order | null>(null);
  const [active_tab, set_active_tab] = useState<"unfulfilled" | "fulfilled">("unfulfilled");

  const fulfilled_orders = orders
    .filter((o) => o.reply_trx_hash)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const unfulfilled_orders = orders
    .filter((o) => !o.reply_trx_hash)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (!private_key) {
    return (
      <div className="p-6">
        <p className="primary text-secondary">Set private key to view orders.</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="p-6">
        <p className="primary text-secondary">No orders found.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="heading text-primary mb-[16px]">Orders ({orders.length})</h2>
      <div className="flex gap-[4px] mb-[16px]">
        <div
          onClick={() => set_active_tab("unfulfilled")}
          className={`eyebrows px-[16px] py-[8px] rounded cursor-pointer ${
            active_tab === "unfulfilled"
              ? "bg-accent-1 text-white"
              : "bg-bgs text-secondary hover:bg-lines"
          }`}
        >
          Unfulfilled [{unfulfilled_orders.length}]
        </div>
        <div
          onClick={() => set_active_tab("fulfilled")}
          className={`eyebrows px-[16px] py-[8px] rounded cursor-pointer ${
            active_tab === "fulfilled"
              ? "bg-accent-1 text-white"
              : "bg-bgs text-secondary hover:bg-lines"
          }`}
        >
          Fulfilled [{fulfilled_orders.length}]
        </div>
      </div>
      {(active_tab === "fulfilled" ? fulfilled_orders : unfulfilled_orders).length === 0 ? (
        <p className="primary text-secondary">No {active_tab} orders.</p>
      ) : (
      <div className="flex flex-col gap-[16px]">
        {(active_tab === "fulfilled" ? fulfilled_orders : unfulfilled_orders).map((order, idx) => {
          const payment_received = format_payment_received(order);
          const expected_price = find_expected_price(order, product_catalogs);
          const difference = expected_price !== null ? payment_received - expected_price : null;
          return (
            <div key={order.trx_hash || idx} className="border border-lines p-[16px] rounded bg-bgs">
              <div className="flex justify-between mb-[12px]">
                <span className="primary text-primary font-medium">{order.product?.compound_name || "Unknown Product"}</span>
                <span className="eyebrows text-accent-2">{order.status}</span>
              </div>
              {order.product && (
                <div className="secondary text-secondary mb-[12px]">
                  <p>Quantity: {order.product.quantity}</p>
                  <p>Price: ${order.product.price.toFixed(6)}</p>
                  {order.product.supplier && <p>Supplier: {order.product.supplier}</p>}
                  {order.product.cas_number && <p>CAS: {order.product.cas_number}</p>}
                </div>
              )}
              <div className="secondary text-secondary mb-[12px] p-[12px] border border-lines rounded bg-bg">
                <p>Payment Received: ${payment_received.toFixed(6)}</p>
                {expected_price !== null && (
                  <>
                    <p>Expected Price: ${expected_price.toFixed(6)}</p>
                    {difference !== null && difference >= 0 && (
                      <p className="text-accent-2">Correct Payment{difference > 0 ? ` (with $${difference.toFixed(6)} extra)` : ""}</p>
                    )}
                    {difference !== null && difference < 0 && (
                      <p className="text-error">Payment too low by ${Math.abs(difference).toFixed(6)}</p>
                    )}
                  </>
                )}
                {expected_price === null && (
                  <p className="text-secondary">Expected price not found</p>
                )}
              </div>
              {order.shipping_address && (
                <div className="secondary text-secondary mb-[12px] p-[12px] border border-lines rounded bg-bg">
                  <div className="flex justify-between items-start mb-[8px]">
                    <p className="eyebrows text-secondary">Shipping Address</p>
                    <Copy
                      size={16}
                      className="text-secondary cursor-pointer hover:text-primary"
                      onClick={() => navigator.clipboard.writeText(format_shipping_label(order.shipping_address!))}
                    />
                  </div>
                  <div className="flex flex-col gap-[2px] text-primary">
                    <p className="font-medium">{order.shipping_address.name}</p>
                    <p>{order.shipping_address.street1}</p>
                    {order.shipping_address.street2 && <p>{order.shipping_address.street2}</p>}
                    <p>{order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postcode}</p>
                    <p>{order.shipping_address.country}</p>
                    {(order.shipping_address.phone || order.shipping_address.email) && (
                      <div className="flex gap-[16px] mt-[4px] text-secondary">
                        {order.shipping_address.phone && <span>{order.shipping_address.phone}</span>}
                        {order.shipping_address.email && <span>{order.shipping_address.email}</span>}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {order.trx_hash && (
                <p className="eyebrows text-secondary truncate mb-[12px]">TX: {order.trx_hash}</p>
              )}
              {order.reply_trx_hash ? (
                <p className="eyebrows text-accent-2 truncate">Replied: {order.reply_trx_hash}</p>
              ) : (
                <div className="flex gap-[8px]">
                  <Button onClick={() => set_fulfill_order(order)} className="text-[12px] px-[12px] py-[8px]">Fulfill</Button>
                  <Button variant="secondary" onClick={() => alert("No refund implemented yet")} className="text-[12px] px-[12px] py-[8px]">Refund</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
      {fulfill_order && <FulfillModal order={fulfill_order} on_close={() => set_fulfill_order(null)} />}
    </div>
  );
}
