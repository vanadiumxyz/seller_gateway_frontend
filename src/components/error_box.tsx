import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { use_store } from "../store";

export function ErrorBox() {
  const error = use_store((state) => state.error);
  const set_error = use_store((state) => state.set_error);
  const [key, set_key] = useState(0);

  useEffect(() => {
    if (!error) return;
    set_key((k) => k + 1);
    const timeout = setTimeout(() => set_error(""), 20000);
    return () => clearTimeout(timeout);
  }, [error, set_error]);

  if (!error) return null;

  return (
    <div className="fixed top-[16px] left-[16px] right-[16px] z-50 bg-bg border border-error rounded overflow-hidden">
      <div className="p-[16px] flex items-start justify-between gap-[16px]">
        <div className="flex flex-col gap-[8px]">
          {error.split("\n\n").slice(0, 4).map((line, idx) => (
            <p key={idx} className="primary text-error">{line}</p>
          ))}
          {error.split("\n\n").length > 4 && (
            <p className="primary text-error">... truncated</p>
          )}
        </div>
        <X
          size={16}
          className="text-error cursor-pointer shrink-0 self-start"
          onClick={() => set_error("")}
        />
      </div>
      <div className="h-[4px] bg-lines">
        <div
          key={key}
          className="h-full bg-error"
          style={{ animation: "shrink 20s linear forwards", transformOrigin: "left" }}
        />
      </div>
    </div>
  );
}
