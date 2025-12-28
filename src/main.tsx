import './polyfills'
import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RefreshCw } from "lucide-react"
import './font_faces.css'
import './index.css'
import { LoadingScreen } from "./components/LoadingScreen"
import { Orders } from "./components/Orders"
import { Manage } from "./components/Manage"
import { Button } from "./components/button"
import { ErrorBox } from "./components/error_box"
import { use_store } from "./store"

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="min-h-screen bg-bg">
      <LoadingScreen />
      <KeyOverlay />
      <ErrorBox />
      <Nav />
      <Content />
    </div>
  </StrictMode>,
)

function Content() {
  const route = use_store((state) => state.route)
  if (route === "/manage") return <Manage />
  return <Orders />
}

function KeyOverlay() {
  const private_key = use_store((state) => state.private_key)
  const set_private_key = use_store((state) => state.set_private_key)

  const [pk, setPk] = useState("")

  if (private_key) return null

  const handleSubmit = async () => {
    if (pk.trim()) await set_private_key(pk.trim())
  }

  return (
    <div className="fixed inset-0 bg-bg z-50 flex items-center justify-center">
      <div className="p-8 border border-lines rounded max-w-md w-full">
        <h2 className="heading text-primary mb-4">Setup Required</h2>
        <div className="mb-4">
          <label className="eyebrows text-secondary mb-1 block">Private Key</label>
          <input
            type="password"
            value={pk}
            onChange={(e) => setPk(e.target.value)}
            placeholder="0x..."
            className="pinput w-full p-3 bg-bgs border border-lines rounded text-primary"
          />
        </div>
        <Button
          onClick={handleSubmit}
          className="w-full"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

function format_last_refreshed(timestamp: number | null): string {
  if (!timestamp) return "Never";
  const diff_ms = Date.now() - timestamp;
  const diff_sec = Math.floor(diff_ms / 1000);
  const diff_min = Math.floor(diff_ms / 60000);
  if (diff_min < 1) return `Refreshed ${diff_sec} seconds ago`;
  return `Refreshed ${diff_min} minutes ago`;
}

function Nav() {
  const route = use_store((state) => state.route)
  const set_route = use_store((state) => state.set_route)
  const logout = use_store((state) => state.logout)
  const private_key = use_store((state) => state.private_key)
  const refresh = use_store((state) => state.refresh)
  const refreshing = use_store((state) => state.refreshing)
  const last_refreshed = use_store((state) => state.last_refreshed)
  const [display_time, set_display_time] = useState(format_last_refreshed(last_refreshed))

  useEffect(() => {
    if (!private_key) return;
    const is_stale = !last_refreshed || (Date.now() - last_refreshed) > REFRESH_INTERVAL_MS;
    if (is_stale) refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [private_key, refresh, last_refreshed]);

  useEffect(() => {
    set_display_time(format_last_refreshed(last_refreshed));
    const interval = setInterval(() => {
      set_display_time(format_last_refreshed(last_refreshed));
    }, 1000);
    return () => clearInterval(interval);
  }, [last_refreshed]);

  return (
    <div className="flex gap-[8px] p-[16px] border-b border-lines bg-bg items-center">
      <Button variant={route === "/" ? "primary" : "secondary"} onClick={() => set_route("/")}>Orders</Button>
      <Button variant={route === "/manage" ? "primary" : "secondary"} onClick={() => set_route("/manage")}>Products</Button>
      <div className="flex-1" />
      {private_key && (
        <div className="flex items-center gap-[8px]">
          <p className="secondary text-secondary">{display_time}</p>
          <RefreshCw
            size={16}
            className={`text-secondary ${refreshing ? "animate-spin cursor-not-allowed opacity-50" : "cursor-pointer hover:text-primary"}`}
            onClick={() => !refreshing && refresh()}
          />
        </div>
      )}
      <Button variant="secondary" onClick={logout}>Logout</Button>
    </div>
  )
}
