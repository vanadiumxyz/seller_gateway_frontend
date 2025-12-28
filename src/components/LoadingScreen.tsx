import { use_store } from "../store";

export function LoadingScreen() {
  const loading = use_store((state) => state.loading);

  if (!loading) return null;

  return (
    <div className="fixed top-0 left-0 w-full h-full bg-black flex items-center justify-center z-50">
      <p className="text-white">LOADING</p>
    </div>
  );
}
