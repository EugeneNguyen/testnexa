import { useQuery } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { apiFetch } from "./lib/api/client";

interface HealthResponse {
  status: string;
}

/**
 * Scaffold-verification page only. Proves frontend<->backend wiring by
 * calling the backend health endpoint. Not a real feature screen — bespoke
 * workflow screens, generic CRUD, and auth flow are deferred to a later task.
 */
function ScaffoldVerificationPage() {
  const { data, isLoading, isError, error } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: () => apiFetch<HealthResponse>("/api/health"),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="rounded-lg bg-white p-8 shadow">
        <h1 className="mb-4 text-xl font-semibold text-gray-900">TestNexa Scaffold</h1>
        {isLoading && <p data-testid="health-status">Checking backend...</p>}
        {isError && (
          <p data-testid="health-status" className="text-red-600">
            Backend: error ({error instanceof Error ? error.message : "unknown error"})
          </p>
        )}
        {data && (
          <p data-testid="health-status" className="text-green-600">
            Backend: {data.status === "ok" ? "ok" : data.status}
          </p>
        )}
      </div>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<ScaffoldVerificationPage />} />
    </Routes>
  );
}

export default App;
