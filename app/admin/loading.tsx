export default function AdminLoading() {
  const widths = ["72%", "58%", "64%", "69%", "55%"];

  return (
    <div className="grid gap-8">
      <div className="card rounded-[30px] p-8">
        <div className="mb-6 space-y-3">
          <div className="h-3 w-28 animate-pulse rounded-full bg-black/8" />
          <div className="h-6 w-72 animate-pulse rounded-full bg-black/8" />
          <div className="h-4 w-96 animate-pulse rounded-full bg-black/5" />
        </div>
        <div className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-white">
          <div className="grid grid-cols-5 gap-3 border-b divider px-5 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-3 w-20 animate-pulse rounded-full bg-black/8" />
            ))}
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-5 gap-3 border-b divider px-5 py-5">
              {Array.from({ length: 5 }).map((_, j) => (
                <div
                  key={j}
                  className="h-4 animate-pulse rounded-full bg-black/5"
                  style={{ width: widths[(i + j) % widths.length] }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
