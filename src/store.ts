import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  list_orders as fetch_orders_from_chain,
  upload_products,
  retrieve_products,
  estimate_upload_cost,
  derive_public_key,
  derive_address,
  is_approved_seller,
  get_contract_products,
  reply_to_order,
  estimate_reply_cost,
  fetch_reply_transactions,
  FulfillmentData,
  OrderPayment,
} from "./eth_logic";
import Papa from "papaparse";

const ETHERSCAN_RATE_LIMIT_MS = 1200;

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface Product {
  id: number;
  compound_name: string;
  quantity: string;
  price: number;
  shipping_cost: number;
  supplier: string;
  coa_link: string[];
  total_quantity: string;
  total_quantity_unit: string;
  ship_time: number;
  description: string;
  cas_number: string;
  chemical_formula: string;
  molar_weight: string;
  vendor_addr: string;
  vendor_secp256k1: string;
}

export interface ProductCatalog {
  products: Product[];
  timestamp: number;
}


export interface ShippingAddress {
  name: string;
  phone: string;
  email: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  country: string;
  postcode: string;
}

export interface Order {
  product: Product;
  shipping_address?: ShippingAddress;
  status: string;
  created_at: Date;
  contract_address?: string;
  qa_participant: boolean;
  currency: undefined;
  trx_hash?: string;
  buyer_secp256k1?: string;
  buyer_address?: string;
  buyer_gateway?: string;
  payment?: OrderPayment;
  reply_trx_hash?: string;
}


export const is_local = () => {
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
};

export const API_URL = is_local() ? "http://localhost:11200" : "";

export const MARKET_CONTRACT_ADDRESS =
  "0x5b8902de436A13Cb5097a7cF9bAd16c30fbf5902";

export const ETHERSCAN_API_KEY = import.meta.env.VITE_ETHERSCAN_API_KEY;

export const MARKET_CONTRACT_ABI = [
  {
    type: "function",
    name: "approvedSellers",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "blacklistedSellers",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approvedBuyerGateways",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "blacklistedBuyerGateways",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "products",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "timestamp", type: "uint256" },
      { name: "secp256k1", type: "bytes" },
      { name: "link", type: "string" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getProducts",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "sellerAddr", type: "address" },
          { name: "sellerPubKey", type: "bytes" },
          { name: "link", type: "string" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "uploadProduct",
    inputs: [
      { name: "secp256k1", type: "bytes" },
      { name: "link", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "purchaseWithEth",
    inputs: [
      { name: "productId", type: "uint256" },
      { name: "seller", type: "address" },
      { name: "buyerGateway", type: "address" },
      { name: "minUsdtOut", type: "uint256" },
      { name: "encryptedCalldata", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "purchaseWithToken",
    inputs: [
      { name: "productId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "seller", type: "address" },
      { name: "buyerGateway", type: "address" },
      { name: "minUsdtOut", type: "uint256" },
      { name: "encryptedCalldata", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "replyToOrder",
    inputs: [
      { name: "buyerAddress", type: "address" },
      { name: "buyerGateway", type: "address" },
      { name: "orderTxnHash", type: "bytes32" },
      { name: "encryptedData", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "addSeller",
    inputs: [{ name: "seller", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "blacklistSeller",
    inputs: [{ name: "seller", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "addBuyerGateway",
    inputs: [{ name: "gateway", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "blacklistBuyerGateway",
    inputs: [{ name: "gateway", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rescueTokens",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rescueETH",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ROUTER",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WETH",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "USDT",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "USDC",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WBTC",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "TREASURY",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "TREASURY_CUT",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Purchase",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "buyerGateway", type: "address", indexed: true },
      { name: "productId", type: "uint256", indexed: false },
      { name: "tokenIn", type: "address", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "usdtAmount", type: "uint256", indexed: false },
      { name: "encryptedCalldata", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SellerUpdated",
    inputs: [
      { name: "seller", type: "address", indexed: true },
      { name: "approved", type: "bool", indexed: false },
      { name: "blacklisted", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BuyerGatewayUpdated",
    inputs: [
      { name: "gateway", type: "address", indexed: true },
      { name: "approved", type: "bool", indexed: false },
      { name: "blacklisted", type: "bool", indexed: false },
    ],
  },
  {
    type: "error",
    name: "InvalidSeller",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidBuyerGateway",
    inputs: [],
  },
  {
    type: "error",
    name: "BuyerNotNFTHolder",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedToken",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "NoETHSent",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientOutput",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPubKey",
    inputs: [],
  },
] as const;

interface Store {
  route: string;
  set_route: (route: string) => void;
  private_key: string;
  public_key: string;
  address: string;
  set_private_key: (key: string) => Promise<void>;
  orders: Order[];
  fetch_orders: () => Promise<void>;
  product_catalogs: ProductCatalog[];
  fetch_product_catalogs: () => Promise<void>;
  last_refreshed: number | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  upload_products: (fileData: Uint8Array) => Promise<{ txHash: string; blockNumber: number; gasUsed: string }>;
  estimate_upload_cost: (fileData: Uint8Array) => Promise<{ gas: bigint; costEth: string }>;
  retrieve_products: (txHash: string) => Promise<Uint8Array>;
  fetch_my_uploads: () => Promise<Array<{ link: string; timestamp: number }>>;
  fulfill_order: (buyerAddress: string, buyerGateway: string, orderTxnHash: string, buyerPublicKey: string, fulfillment: FulfillmentData) => Promise<{ txHash: string; blockNumber: number; gasUsed: string }>;
  estimate_fulfill_cost: (buyerAddress: string, buyerGateway: string, orderTxnHash: string, buyerPublicKey: string, fulfillment: FulfillmentData) => Promise<{ gas: bigint; costEth: string }>;
  call_api: (
    endpoint: string,
    data?: Record<string, any>,
    set_data?: any,
  ) => Promise<any>;
  loading: boolean;
  start_loading: (ms: number) => void;
  stop_loading: () => void;
  error: string;
  set_error: (error: string) => void;
  last_etherscan_request: number;
  fetch_etherscan: (url: string) => Promise<any>;
  logout: () => void;
}

export const use_store = create<Store>()(
  persist(
    (set, get) => ({
      route: "/",
      set_route: (route: string) => set({ route }),
      private_key: "",
      public_key: "",
      address: "",
      set_private_key: async (key: string) => {
        if (key) {
          try {
            const public_key = derive_public_key(key);
            const address = derive_address(key);
            const approved = await is_approved_seller(address);
            if (!approved) {
              get().set_error("This address is not an approved seller");
              return;
            }
            set({ private_key: key, public_key, address });
          } catch {
            get().set_error("Invalid private key");
          }
        } else {
          set({ private_key: "", public_key: "", address: "" });
        }
      },
      orders: [],
      fetch_orders: async () => {
        console.log("fetching orders")
        try {
          const seller_address = get().address;
          const [result, replies] = await Promise.all([
            fetch_orders_from_chain(
              get().private_key,
              get().fetch_etherscan,
              get().set_error
            ),
            fetch_reply_transactions(seller_address, get().fetch_etherscan),
          ]);
          console.log("[fetch_orders] replies keys:", Object.keys(replies));
          const new_orders: Order[] = result.map((item) => {
            console.log("[fetch_orders] order txHash:", item.txHash, "looking up:", item.txHash.toLowerCase(), "found:", replies[item.txHash.toLowerCase()]);
            return {
              ...item.order,
              trx_hash: item.txHash,
              buyer_address: item.buyer_address,
              buyer_gateway: item.buyer_gateway,
              buyer_secp256k1: item.order.buyer_secp256k1,
              payment: item.payment,
              reply_trx_hash: replies[item.txHash.toLowerCase()],
            };
          });
          set({ orders: new_orders });
        } catch (e) {
          get().set_error(String(e));
        }
      },
      product_catalogs: [],
      fetch_product_catalogs: async () => {
        try {
          const public_key = get().public_key;
          if (!public_key) return;
          const all_contract_products = await get_contract_products();
          const uncompressed_pub_key = "0x04" + public_key;
          const my_products = all_contract_products.filter(
            (p) => p.sellerPubKey.toLowerCase() === uncompressed_pub_key.toLowerCase()
          );
          const catalogs: ProductCatalog[] = [];
          let product_id = 0;
          for (const cp of my_products) {
            try {
              const compressed = await retrieve_products(cp.link);
              const decompressed = await gunzip(compressed);
              const csv = new TextDecoder().decode(decompressed);
              const result = Papa.parse<string[]>(csv, {
                header: false,
                skipEmptyLines: true,
              });
              if (result.data.length < 2) continue;
              const vendor_addr = cp.sellerAddr;
              const vendor_secp256k1 = cp.sellerPubKey;
              const products: Product[] = [];
              for (let i = 1; i < result.data.length; i++) {
                const cols = result.data[i];
                const base_price = parseFloat(cols[2]) || 0;
                products.push({
                  id: product_id++,
                  compound_name: cols[0],
                  quantity: cols[1],
                  price: base_price,
                  shipping_cost: parseFloat(cols[5]) || 0,
                  supplier: cols[3],
                  coa_link: cols[4] ? cols[4].split("|").filter((l) => l.trim()) : [],
                  total_quantity: cols[6],
                  total_quantity_unit: cols[7],
                  ship_time: parseInt(cols[8]) || 0,
                  description: cols[9],
                  cas_number: cols[10],
                  chemical_formula: cols[11],
                  molar_weight: cols[12],
                  vendor_addr,
                  vendor_secp256k1,
                });
              }
              catalogs.push({ products, timestamp: cp.timestamp });
            } catch (e) {
              get().set_error(`Failed to parse catalog ${cp.link}: ${e}`);
            }
          }
          catalogs.sort((a, b) => a.timestamp - b.timestamp);
          set({ product_catalogs: catalogs });
        } catch (e) {
          get().set_error(String(e));
        }
      },
      last_refreshed: null,
      refreshing: false,
      refresh: async () => {
        const private_key = get().private_key;
        if (!private_key) return;
        set({ refreshing: true });
        try {
          await Promise.all([
            get().fetch_orders(),
            get().fetch_product_catalogs(),
          ]);
          set({ last_refreshed: Date.now() });
        } finally {
          set({ refreshing: false });
        }
      },
      upload_products: async (fileData: Uint8Array) => {
        try {
          return await upload_products(get().private_key, fileData);
        } catch (e) {
          get().set_error(String(e));
          throw e;
        }
      },
      estimate_upload_cost: async (fileData: Uint8Array) => {
        try {
          const result = await estimate_upload_cost(get().private_key, fileData);
          return { gas: result.gas, costEth: result.costEth };
        } catch (e) {
          get().set_error(String(e));
          throw e;
        }
      },
      retrieve_products: async (txHash: string) => {
        try {
          return await retrieve_products(txHash);
        } catch (e) {
          get().set_error(String(e));
          throw e;
        }
      },
      fetch_my_uploads: async () => {
        try {
          const public_key = get().public_key;
          if (!public_key) return [];
          const all_products = await get_contract_products();
          const uncompressed_pub_key = "04" + public_key;
          return all_products
            .filter((p) => p.sellerPubKey.toLowerCase() === "0x" + uncompressed_pub_key.toLowerCase())
            .map((p) => ({ link: p.link, timestamp: p.timestamp }));
        } catch (e) {
          get().set_error(String(e));
          throw e;
        }
      },
      fulfill_order: async (buyerAddress: string, buyerGateway: string, orderTxnHash: string, buyerPublicKey: string, fulfillment: FulfillmentData) => {
        try {
          return await reply_to_order(get().private_key, buyerAddress, buyerGateway, orderTxnHash, buyerPublicKey, fulfillment);
        } catch (e) {
          get().set_error(String(e));
          throw e;
        }
      },
      estimate_fulfill_cost: async (buyerAddress: string, buyerGateway: string, orderTxnHash: string, buyerPublicKey: string, fulfillment: FulfillmentData) => {
        try {
          const result = await estimate_reply_cost(get().private_key, buyerAddress, buyerGateway, orderTxnHash, buyerPublicKey, fulfillment);
          return { gas: result.gas, costEth: result.costEth };
        } catch (e) {
          get().set_error(String(e));
          throw e;
        }
      },
      call_api: async (
        endpoint: string,
        data?: Record<string, any>,
        set_data?: any,
      ) => {
        if (!data) {
          data = {};
        }
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };

          const response = await fetch(`${API_URL}/api/${endpoint}`, {
            method: "POST",
            headers,
            body: JSON.stringify(data),
            credentials: "include",
          });
          if (response.ok) {
            const result = await response.json();
            if (set_data) {
              set_data(result);
            }
            return result;
          } else {
            const error_text = await response.text();
            try {
              const error_obj = JSON.parse(error_text);
              get().set_error(error_obj["detail"]);
            } catch (ne) {
              get().set_error(String(error_text));
            }
          }
        } catch (e) {
          get().set_error(String(e));
        }
      },
      loading: false,
      start_loading: (ms: number) => {
        set({ loading: true });
        setTimeout(() => {
          set({ loading: false });
        }, ms);
      },
      stop_loading: () => {
        set({ loading: false });
      },
      error: "",
      set_error: (error: string) => {
        if (!error) {
          set({ error: "" });
          return;
        }
        const current = get().error;
        const new_error = current ? current + "\n\n" + error : error;
        set({ error: new_error });
        setTimeout(() => {
          set({ error: "" });
        }, 20000);
      },
      last_etherscan_request: 0,
      fetch_etherscan: async (url: string) => {
        while (true) {
          const now = Date.now();
          const time_since_last = now - get().last_etherscan_request;
          if (time_since_last >= ETHERSCAN_RATE_LIMIT_MS) {
            console.log(`[etherscan] executing request: ${url}`);
            set({ last_etherscan_request: Date.now() });
            const response = await fetch(url);
            const data = await response.json();
            if (!Array.isArray(data.result)) {
              throw new Error(JSON.stringify(data));
            }
            return data.result;
          }
          const wait_time = ETHERSCAN_RATE_LIMIT_MS - time_since_last;
          console.log(`[etherscan] rate limited, waiting ${wait_time}ms`);
          await new Promise((resolve) => setTimeout(resolve, wait_time));
        }
      },
      logout: () => {
        set({
          route: "/",
          private_key: "",
          public_key: "",
          address: "",
          orders: [],
          product_catalogs: [],
        });
      },
    }),
    {
      name: "sourcerer_v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).filter(
            ([key]) => !["loading", "error", "last_etherscan_request", "refreshing"].includes(key)
          )
        ),
    }
  )
);
