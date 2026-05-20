"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ComercialPanel } from "@/components/comercial/ComercialPanel";
import { MouseRevealHeaderLayout } from "@/components/mouse-reveal-header-layout";
import { Button } from "@/components/ui/button";

export default function ComercialPage() {
  const router = useRouter();
  const [toast, setToast] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <main className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <MouseRevealHeaderLayout
        header={
          <div className="border-b border-white/10 bg-[#0b1131] text-white">
            <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-4 py-2 md:px-6">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-[#00e676]">moobiz.</span>
                <span className="text-sm text-white/75">Comercial</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#00e676]/45 bg-transparent text-[#00e676] hover:bg-[#00e676]/15 hover:text-[#00e676]"
                  onClick={() => router.push("/")}
                >
                  Volver al panel
                </Button>
                <Button
                  size="sm"
                  className="bg-[#00e676] text-[#0b1131]"
                  onClick={() => setCreateOpen(true)}
                >
                  Nuevo
                </Button>
              </div>
            </div>
          </div>
        }
      >
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6">
          <ComercialPanel
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
            onToast={(msg) => {
              setToast(msg);
              window.setTimeout(() => setToast(""), 5000);
            }}
            onErrorToast={(msg) => {
              setToast(msg);
              window.setTimeout(() => setToast(""), 6000);
            }}
          />
        </div>
      </MouseRevealHeaderLayout>
      {toast ? (
        <div className="fixed bottom-6 right-6 z-[60] max-w-sm rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg">
          {toast}
        </div>
      ) : null}
    </main>
  );
}
