import { Buffer } from "buffer";
import { ethers } from "ethers";
import EthCrypto from "eth-crypto";
import { MARKET_CONTRACT_ADDRESS, ETHERSCAN_API_KEY } from "./store";

const RPC = "https://ethereum-rpc.publicnode.com";

const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": { symbol: "WBTC", decimals: 8 },
};

interface TokenTransfer {
  hash: string;
  to: string;
  contractAddress: string;
  value: string;
}

interface Transaction {
  hash: string;
  to: string;
  from: string;
  input: string;
  value: string;
  isError: string;
  txreceipt_status: string;
}

export interface OrderPayment {
  eth: number;
  usdc: number;
  usdt: number;
  wbtc: number;
}

export interface DecryptedOrder {
  order: any;
  payment: OrderPayment;
  txHash: string;
  buyer_address: string;
  buyer_gateway: string;
}

export function derive_public_key(privateKey: string): string {
  const pk = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  return EthCrypto.publicKeyByPrivateKey(pk);
}

export function derive_address(privateKey: string): string {
  const publicKey = derive_public_key(privateKey);
  return EthCrypto.publicKey.toAddress(publicKey);
}

const PURCHASE_WITH_ETH_SELECTOR = "0x" + ethers.id("purchaseWithEth(uint256,address,address,uint256,bytes)").slice(0, 10).slice(2);
const PURCHASE_WITH_TOKEN_SELECTOR = "0x" + ethers.id("purchaseWithToken(uint256,address,uint256,address,address,uint256,bytes)").slice(0, 10).slice(2);
const REPLY_TO_ORDER_SELECTOR = "0x" + ethers.id("replyToOrder(address,address,bytes32,bytes)").slice(0, 10).slice(2);

interface ParsedCalldata {
  encrypted: string;
  buyer_gateway: string;
}

function extract_encrypted_calldata(input: string): ParsedCalldata | null {
  const selector = input.slice(0, 10);
  const iface = new ethers.Interface([
    "function purchaseWithEth(uint256 productId, address vendorAddr, address buyerGateway, uint256 someValue, bytes encryptedCalldata)",
    "function purchaseWithToken(uint256 productId, address tokenAddress, uint256 tokenAmount, address vendorAddr, address buyerGateway, uint256 someValue, bytes encryptedCalldata)",
  ]);
  if (selector === PURCHASE_WITH_ETH_SELECTOR) {
    const decoded = iface.decodeFunctionData("purchaseWithEth", input);
    const buyer_gateway = decoded[2] as string;
    const calldata_bytes = decoded[4];
    const encrypted = Buffer.from(calldata_bytes.slice(2), "hex").toString("utf8");
    return { encrypted, buyer_gateway };
  }
  if (selector === PURCHASE_WITH_TOKEN_SELECTOR) {
    const decoded = iface.decodeFunctionData("purchaseWithToken", input);
    const buyer_gateway = decoded[4] as string;
    const calldata_bytes = decoded[6];
    const encrypted = Buffer.from(calldata_bytes.slice(2), "hex").toString("utf8");
    return { encrypted, buyer_gateway };
  }
  return null;
}

export async function list_orders(
  privateKey: string,
  fetch_etherscan: (url: string) => Promise<any>,
  set_error: (error: string) => void
): Promise<DecryptedOrder[]> {
  const pk = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;

  const [transactions, tokenTransfers] = await Promise.all([
    fetch_etherscan(
      `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${MARKET_CONTRACT_ADDRESS}&sort=asc&apikey=${ETHERSCAN_API_KEY}`
    ),
    fetch_etherscan(
      `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&address=${MARKET_CONTRACT_ADDRESS}&sort=desc&apikey=${ETHERSCAN_API_KEY}`
    ),
  ]);

  const incomingTxs = (transactions as Transaction[]).filter(
    (tx) => tx.to && tx.to.toLowerCase() === MARKET_CONTRACT_ADDRESS.toLowerCase() && tx.isError === "0" && tx.txreceipt_status === "1"
  );

  const seller_address = derive_address(privateKey).toLowerCase();
  const tokensByTx: Record<string, TokenTransfer[]> = {};
  for (const transfer of tokenTransfers as TokenTransfer[]) {
    if (!transfer.to) continue;
    if (transfer.to.toLowerCase() !== seller_address) continue;
    if (!tokensByTx[transfer.hash]) tokensByTx[transfer.hash] = [];
    tokensByTx[transfer.hash].push(transfer);
  }

  const orders: DecryptedOrder[] = [];

  for (const tx of incomingTxs) {
    try {
      const parsed = extract_encrypted_calldata(tx.input);
      if (!parsed || !parsed.encrypted.includes("@@@")) continue;

      const parts = parsed.encrypted.split("@@@");
      const encrypted = parts[0];
      const encryptedObj = EthCrypto.cipher.parse(encrypted);
      const decrypted = await EthCrypto.decryptWithPrivateKey(pk, encryptedObj);
      const order = JSON.parse(decrypted);

      const buyer_address = tx.from;

      const eth = Number(tx.value) / 1e18;

      const transfers = tokensByTx[tx.hash] || [];
      let usdt = 0n;
      for (const t of transfers) {
        const token = TOKENS[t.contractAddress.toLowerCase()];
        if (!token) continue;
        const amount = BigInt(t.value);
        if (token.symbol === "USDT") usdt += amount;
      }

      orders.push({
        order,
        payment: {
          eth,
          usdc: 0,
          usdt: Number(usdt) / 1e6,
          wbtc: 0,
        },
        txHash: tx.hash,
        buyer_address,
        buyer_gateway: parsed.buyer_gateway,
      });
    } catch (e) {
      set_error(`Failed to process tx ${tx.hash}: ${e}`);
    }
  }

  return orders;
}

const MARKET_ABI = [
  "function approvedSellers(address) view returns (bool)",
  "function blacklistedSellers(address) view returns (bool)",
  "function uploadProduct(bytes secp256k1, string link) external",
  "function products(uint256) view returns (uint256 timestamp, bytes secp256k1, string link)",
  "function getProducts() view returns (tuple(address sellerAddr, bytes sellerPubKey, string link, uint256 timestamp)[])",
];

export async function estimate_upload_cost(
  privateKey: string,
  fileData: Uint8Array
): Promise<{ gas: bigint; gasPrice: bigint; costWei: bigint; costEth: string }> {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(privateKey, provider);

  const data_tx = {
    to: wallet.address,
    value: 0,
    data: "0x" + Buffer.from(fileData).toString("hex"),
  };

  const pk = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  const compressed_pub_key = EthCrypto.publicKeyByPrivateKey(pk);
  const uncompressed_pub_key = "0x04" + compressed_pub_key;

  const contract = new ethers.Contract(MARKET_CONTRACT_ADDRESS, MARKET_ABI, wallet);
  const placeholder_link = "0x" + "0".repeat(64);

  const [data_gas, contract_gas, feeData] = await Promise.all([
    provider.estimateGas({ ...data_tx, from: wallet.address }),
    contract.uploadProduct.estimateGas(uncompressed_pub_key, placeholder_link),
    provider.getFeeData(),
  ]);

  const total_gas = data_gas + contract_gas;
  const gasPrice = feeData.gasPrice || 0n;
  const costWei = total_gas * gasPrice;
  const costEth = ethers.formatEther(costWei);

  return { gas: total_gas, gasPrice, costWei, costEth };
}

export async function upload_products(
  privateKey: string,
  fileData: Uint8Array
): Promise<{ txHash: string; blockNumber: number; gasUsed: string }> {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("[upload_products] Starting upload...");
  console.log("[upload_products] File data size:", fileData.length, "bytes");

  const data_tx = await wallet.sendTransaction({
    to: wallet.address,
    value: 0,
    data: "0x" + Buffer.from(fileData).toString("hex"),
  });

  console.log("[upload_products] Data transaction sent:", data_tx.hash);

  const data_receipt = await data_tx.wait();
  if (!data_receipt) {
    throw new Error("Data transaction failed - no receipt");
  }

  console.log("[upload_products] Data transaction confirmed in block:", data_receipt.blockNumber);

  const pk = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  const compressed_pub_key = EthCrypto.publicKeyByPrivateKey(pk);
  const uncompressed_pub_key = "0x04" + compressed_pub_key;

  console.log("[upload_products] Calling uploadProduct on contract...");
  console.log("[upload_products] Public key:", uncompressed_pub_key);
  console.log("[upload_products] Link (data tx hash):", data_tx.hash);

  const contract = new ethers.Contract(MARKET_CONTRACT_ADDRESS, MARKET_ABI, wallet);

  const contract_tx = await contract.uploadProduct(uncompressed_pub_key, data_tx.hash);
  console.log("[upload_products] Contract transaction sent:", contract_tx.hash);

  const contract_receipt = await contract_tx.wait();
  if (!contract_receipt) {
    throw new Error("Contract transaction failed - no receipt");
  }

  console.log("[upload_products] Contract transaction confirmed in block:", contract_receipt.blockNumber);

  const total_gas = data_receipt.gasUsed + contract_receipt.gasUsed;

  return {
    txHash: contract_tx.hash,
    blockNumber: contract_receipt.blockNumber,
    gasUsed: total_gas.toString(),
  };
}

export async function retrieve_products(txHash: string): Promise<Uint8Array> {
  const provider = new ethers.JsonRpcProvider(RPC);

  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    throw new Error("Transaction not found");
  }

  return new Uint8Array(Buffer.from(tx.data.slice(2), "hex"));
}

export async function is_approved_seller(
  sellerAddress: string
): Promise<boolean> {
  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(MARKET_CONTRACT_ADDRESS, MARKET_ABI, provider);

  const [approved, blacklisted] = await Promise.all([
    contract.approvedSellers(sellerAddress),
    contract.blacklistedSellers(sellerAddress),
  ]);

  return approved && !blacklisted;
}

export async function get_contract_products(): Promise<Array<{
  sellerAddr: string;
  sellerPubKey: string;
  link: string;
  timestamp: number;
}>> {
  const provider = new ethers.JsonRpcProvider(RPC);
  const contract = new ethers.Contract(MARKET_CONTRACT_ADDRESS, MARKET_ABI, provider);

  const products = await contract.getProducts();
  return products.map((p: { sellerAddr: string; sellerPubKey: string; link: string; timestamp: bigint }) => ({
    sellerAddr: p.sellerAddr,
    sellerPubKey: p.sellerPubKey,
    link: p.link,
    timestamp: Number(p.timestamp),
  }));
}

export interface FulfillmentData {
  order_trxn_hash: string;
  tracking_url: string;
  message: string;
}

export async function fetch_reply_transactions(
  seller_address: string,
  fetch_etherscan: (url: string) => Promise<any>
): Promise<Record<string, string>> {
  const transactions = await fetch_etherscan(
    `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${seller_address}&sort=asc&apikey=${ETHERSCAN_API_KEY}`
  );

  const reply_iface = new ethers.Interface([
    "function replyToOrder(address buyerAddress, address buyerGateway, bytes32 orderTxnHash, bytes encryptedData)",
  ]);

  const replies: Record<string, string> = {};

  for (const tx of transactions as Transaction[]) {
    if (!tx.to || tx.to.toLowerCase() !== MARKET_CONTRACT_ADDRESS.toLowerCase()) continue;
    if (tx.from.toLowerCase() !== seller_address.toLowerCase()) continue;
    if (tx.isError !== "0" || tx.txreceipt_status !== "1") continue;
    const selector = tx.input.slice(0, 10);
    if (selector !== REPLY_TO_ORDER_SELECTOR) continue;
    try {
      const decoded = reply_iface.decodeFunctionData("replyToOrder", tx.input);
      const order_txn_hash = decoded[2] as string;
      console.log("[fetch_reply_transactions] found reply for order:", order_txn_hash);
      replies[order_txn_hash.toLowerCase()] = tx.hash;
    } catch {
    }
  }
  console.log("[fetch_reply_transactions] replies:", replies);

  return replies;
}

const REPLY_ABI = [
  "function replyToOrder(address buyerAddress, address buyerGateway, bytes32 orderTxnHash, bytes encryptedData) external",
];

export async function estimate_reply_cost(
  privateKey: string,
  buyerAddress: string,
  buyerGateway: string,
  orderTxnHash: string,
  buyerPublicKey: string,
  fulfillment: FulfillmentData
): Promise<{ gas: bigint; gasPrice: bigint; costWei: bigint; costEth: string }> {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("[estimate_reply_cost] buyerAddress:", buyerAddress);
  console.log("[estimate_reply_cost] buyerGateway:", buyerGateway);
  console.log("[estimate_reply_cost] orderTxnHash:", orderTxnHash);
  console.log("[estimate_reply_cost] buyerPublicKey:", buyerPublicKey);

  const pub_key = buyerPublicKey.startsWith("0x") ? buyerPublicKey.slice(2) : buyerPublicKey;
  const encrypted = await EthCrypto.encryptWithPublicKey(pub_key, JSON.stringify(fulfillment));
  const encrypted_str = EthCrypto.cipher.stringify(encrypted);
  const encrypted_bytes = "0x" + Buffer.from(encrypted_str).toString("hex");

  const contract = new ethers.Contract(MARKET_CONTRACT_ADDRESS, REPLY_ABI, wallet);

  const [gas, feeData] = await Promise.all([
    contract.replyToOrder.estimateGas(buyerAddress, buyerGateway, orderTxnHash, encrypted_bytes),
    provider.getFeeData(),
  ]);

  const gasPrice = feeData.gasPrice || 0n;
  const costWei = gas * gasPrice;
  const costEth = ethers.formatEther(costWei);

  return { gas, gasPrice, costWei, costEth };
}

export async function reply_to_order(
  privateKey: string,
  buyerAddress: string,
  buyerGateway: string,
  orderTxnHash: string,
  buyerPublicKey: string,
  fulfillment: FulfillmentData
): Promise<{ txHash: string; blockNumber: number; gasUsed: string }> {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(privateKey, provider);

  const pub_key = buyerPublicKey.startsWith("0x") ? buyerPublicKey.slice(2) : buyerPublicKey;
  const encrypted = await EthCrypto.encryptWithPublicKey(pub_key, JSON.stringify(fulfillment));
  const encrypted_str = EthCrypto.cipher.stringify(encrypted);
  const encrypted_bytes = "0x" + Buffer.from(encrypted_str).toString("hex");

  const contract = new ethers.Contract(MARKET_CONTRACT_ADDRESS, REPLY_ABI, wallet);

  const tx = await contract.replyToOrder(buyerAddress, buyerGateway, orderTxnHash, encrypted_bytes);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("Transaction failed - no receipt");
  }

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };
}
