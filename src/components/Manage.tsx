import { useState, useRef, useEffect } from "react";
import { Copy, X } from "lucide-react";
import Papa from "papaparse";
import { use_store } from "../store";
import { Button } from "./button";

interface UploadHistory {
  link: string;
  timestamp: number;
}

function CsvModal({ content, on_close }: { content: string; on_close: () => void }) {
  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: true });
  const rows = parsed.data;
  const header = rows[0] || [];
  const data = rows.slice(1);

  return (
    <div className="fixed inset-0 bg-primary/50 z-50 flex items-center justify-center p-[16px]" onClick={on_close}>
      <div className="bg-bg border border-lines rounded max-w-6xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-[16px] border-b border-lines">
          <p className="primary text-primary font-medium">CSV Content ({data.length} rows)</p>
          <X
            size={16}
            className="text-secondary cursor-pointer hover:text-primary"
            onClick={on_close}
          />
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bgs">
              <tr>
                {header.map((col, i) => (
                  <th key={i} className="eyebrows text-secondary text-left p-[8px] border-b border-lines whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, row_idx) => (
                <tr key={row_idx} className="hover:bg-bgs">
                  {row.map((cell, cell_idx) => (
                    <td key={cell_idx} className="secondary text-primary p-[8px] border-b border-lines">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function CopyField({ label, description, value }: { label: string; description: string; value: string }) {
  const handle_copy = () => navigator.clipboard.writeText(value);
  return (
    <div className="p-[16px] border border-lines rounded bg-bgs">
      <p className="eyebrows text-secondary mb-[4px]">{label}</p>
      <p className="secondary text-secondary mb-[8px]">{description}</p>
      <div className="flex items-center gap-[8px]">
        <p className="secondary text-primary break-all">{value}</p>
        <Copy
          size={16}
          className="text-secondary cursor-pointer hover:text-primary shrink-0"
          onClick={handle_copy}
        />
      </div>
    </div>
  );
}

interface PendingUpload {
  compressed: Uint8Array;
  cost_eth: string;
}

export function Manage() {
  const upload_products = use_store((state) => state.upload_products);
  const estimate_upload_cost = use_store((state) => state.estimate_upload_cost);
  const retrieve_products = use_store((state) => state.retrieve_products);
  const fetch_my_uploads = use_store((state) => state.fetch_my_uploads);
  const private_key = use_store((state) => state.private_key);
  const public_key = use_store((state) => state.public_key);
  const address = use_store((state) => state.address);
  const set_error = use_store((state) => state.set_error);

  const [tx_hash, set_tx_hash] = useState("");
  const [upload_result, set_upload_result] = useState<{ txHash: string; blockNumber: number; gasUsed: string } | null>(null);
  const [uploading, set_uploading] = useState(false);
  const [estimating, set_estimating] = useState(false);
  const [pending_upload, set_pending_upload] = useState<PendingUpload | null>(null);
  const [downloading, set_downloading] = useState(false);
  const [download_data, set_download_data] = useState<Uint8Array | null>(null);
  const [upload_history, set_upload_history] = useState<UploadHistory[]>([]);
  const [loading_history, set_loading_history] = useState(false);
  const [modal_content, set_modal_content] = useState<string | null>(null);
  const [loading_csv, set_loading_csv] = useState<string | null>(null);
  const file_input_ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (public_key) {
      set_loading_history(true);
      fetch_my_uploads()
        .then(set_upload_history)
        .catch(() => {})
        .finally(() => set_loading_history(false));
    }
  }, [public_key, fetch_my_uploads]);

  const handle_view_csv = async (link: string) => {
    set_loading_csv(link);
    try {
      const compressed = await retrieve_products(link);
      const decompressed = await gunzip(compressed);
      const text = new TextDecoder().decode(decompressed);
      set_modal_content(text);
    } catch {
    } finally {
      set_loading_csv(null);
    }
  };

  const handle_select_file = () => file_input_ref.current?.click();

  const handle_file_change = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file_input_ref.current) file_input_ref.current.value = "";

    if (!file.name.endsWith(".csv")) {
      set_error("Please upload a CSV file");
      return;
    }

    const text = await file.text();
    const result = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: true,
    });
    if (result.errors.length > 0) {
      set_error(result.errors[0].message);
      return;
    }
    if (result.data.length < 2) {
      set_error("CSV must have at least a header and one row");
      return;
    }
    const header_cols = result.data[0].length;
    for (let i = 1; i < result.data.length; i++) {
      if (result.data[i].length !== header_cols) {
        set_error(`Row ${i + 1} has ${result.data[i].length} columns, expected ${header_cols}`);
        return;
      }
    }

    set_estimating(true);
    try {
      const raw = new TextEncoder().encode(text);
      const compressed = await gzip(raw);
      const estimate = await estimate_upload_cost(compressed);
      set_pending_upload({ compressed, cost_eth: estimate.costEth });
      set_upload_result(null);
    } catch {
    } finally {
      set_estimating(false);
    }
  };

  const handle_confirm_upload = async () => {
    if (!pending_upload) return;
    set_uploading(true);
    try {
      const result = await upload_products(pending_upload.compressed);
      set_upload_result(result);
      set_pending_upload(null);
      const updated_history = await fetch_my_uploads();
      set_upload_history(updated_history);
    } catch {
    } finally {
      set_uploading(false);
    }
  };

  const handle_cancel_upload = () => {
    set_pending_upload(null);
  };

  const handle_download = async () => {
    if (!tx_hash.trim()) {
      set_error("Enter a transaction hash");
      return;
    }

    set_downloading(true);
    try {
      const compressed = await retrieve_products(tx_hash.trim());
      const decompressed = await gunzip(compressed);
      set_download_data(decompressed);
    } catch {
    } finally {
      set_downloading(false);
    }
  };

  const handle_save = () => {
    if (!download_data) return;
    const blob = new Blob([download_data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!private_key) {
    return (
      <div className="p-6">
        <p className="primary text-secondary">Set private key in settings to manage products.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="heading text-primary mb-6">Manage Products</h2>

      <div className="mb-8 flex flex-wrap gap-[16px]">
        <CopyField label="Address" description="Your Ethereum wallet address" value={address} />
        <CopyField label="SECP256K1" description="Public key for encrypted order data" value={public_key} />
      </div>

      <div className="mb-8">
        <h3 className="primary text-primary font-medium mb-2">Upload Products</h3>
        <p className="secondary text-secondary mb-3">Upload a CSV file to the blockchain</p>
        <input
          ref={file_input_ref}
          type="file"
          accept=".csv,text/csv"
          onChange={handle_file_change}
          className="hidden"
        />
        <Button onClick={handle_select_file} disabled={uploading || estimating}>
          {estimating ? "Estimating..." : "Select Products CSV"}
        </Button>
        {pending_upload && (
          <div className="mt-3 p-4 border border-lines rounded bg-bgs">
            <p className="secondary text-secondary mb-2">Estimated cost: {pending_upload.cost_eth} ETH</p>
            <div className="flex gap-[8px]">
              <Button onClick={handle_confirm_upload} disabled={uploading}>
                {uploading ? "Uploading..." : "Confirm"}
              </Button>
              <Button variant="secondary" onClick={handle_cancel_upload} disabled={uploading}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {upload_result && (
          <div className="mt-3 p-4 border border-lines rounded bg-bgs">
            <p className="primary text-accent-2 mb-2">Upload successful!</p>
            <p className="secondary text-secondary">TX: {upload_result.txHash}</p>
            <p className="secondary text-secondary">Block: {upload_result.blockNumber}</p>
            <p className="secondary text-secondary">Gas: {upload_result.gasUsed}</p>
          </div>
        )}
      </div>

      <div>
        <h3 className="primary text-primary font-medium mb-2">Download Products</h3>
        <p className="secondary text-secondary mb-3">Download product data from a transaction</p>
        <div className="flex gap-[8px]">
          <input
            type="text"
            value={tx_hash}
            onChange={(e) => set_tx_hash(e.target.value)}
            placeholder="Transaction hash (0x...)"
            className="pinput flex-1 p-3 bg-bgs border border-lines rounded text-primary"
          />
          <Button
            onClick={handle_download}
            disabled={downloading}
          >
            {downloading ? "..." : "Fetch"}
          </Button>
        </div>
        {download_data && (
          <div className="mt-3 p-4 border border-lines rounded bg-bgs flex items-center justify-between">
            <p className="secondary text-secondary">Ready to save ({download_data.length} bytes)</p>
            <Button onClick={handle_save}>Save CSV</Button>
          </div>
        )}
      </div>

      <div className="mt-8">
        <h3 className="primary text-primary font-medium mb-2">Upload History</h3>
        <p className="secondary text-secondary mb-3">Your previously uploaded CSV files</p>
        {loading_history && <p className="secondary text-secondary">Loading...</p>}
        {!loading_history && upload_history.length === 0 && (
          <p className="secondary text-secondary">No uploads found</p>
        )}
        {!loading_history && upload_history.length > 0 && (
          <div className="flex flex-col gap-[8px]">
            {[...upload_history].sort((a, b) => b.timestamp - a.timestamp).map((item) => (
              <div key={item.link} className="p-[12px] border border-lines rounded bg-bgs flex items-center justify-between gap-[16px]">
                <div className="min-w-0 flex-1">
                  <p className="secondary text-secondary">{new Date(item.timestamp * 1000).toLocaleString()}</p>
                  <p className="secondary text-primary truncate">{item.link}</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => handle_view_csv(item.link)}
                  disabled={loading_csv === item.link}
                >
                  {loading_csv === item.link ? "..." : "View"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal_content && <CsvModal content={modal_content} on_close={() => set_modal_content(null)} />}
    </div>
  );
}
