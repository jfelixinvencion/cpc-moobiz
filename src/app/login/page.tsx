"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error ?? "Credenciales incorrectas");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("No se pudo iniciar sesion. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0f2e] px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1742] p-6 shadow-2xl sm:p-8">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-[#00e676]">moobiz</h1>
          <p className="mt-2 text-sm text-white/70">Inicia sesion para acceder al panel</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-sm text-white/80">
              Usuario
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-11 w-full rounded-lg border border-white/20 bg-[#0a0f2e] px-3 text-sm text-white outline-none transition focus:border-[#00e676] focus:ring-2 focus:ring-[#00e676]/40"
              placeholder="Ingresa tu usuario"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm text-white/80">
              Contrasena
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-lg border border-white/20 bg-[#0a0f2e] px-3 text-sm text-white outline-none transition focus:border-[#00e676] focus:ring-2 focus:ring-[#00e676]/40"
              placeholder="Ingresa tu contrasena"
              required
            />
          </div>

          {error ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-lg bg-[#00e676] font-semibold text-[#0a0f2e] transition hover:bg-[#00c765] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}
