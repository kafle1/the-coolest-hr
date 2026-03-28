import { type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type SectionCardProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function SectionCard({
  title,
  eyebrow,
  description,
  children,
  className,
}: SectionCardProps) {
  return (
    <section className={cn("card rounded-[30px] p-6 sm:p-7", className)}>
      <div className="mb-5">
        {eyebrow ? (
          <p className="eyebrow mb-2">{eyebrow}</p>
        ) : null}
        <h2 className="text-2xl font-semibold tracking-tight sm:text-[1.85rem]">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
