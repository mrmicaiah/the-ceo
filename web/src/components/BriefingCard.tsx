// The briefing as a small document. Four sections, section labels in display
// type, bodies in body type, hairline rules between sections.

import type { Briefing } from "../types";

interface Props {
  briefing: Briefing;
}

export function BriefingCard({ briefing }: Props) {
  const sections: Array<{ label: string; value: string }> = [
    { label: "Goal", value: briefing.goal },
    { label: "State", value: briefing.state },
    { label: "Next move", value: briefing.nextMove },
    { label: "Why", value: briefing.why },
  ];

  return (
    <div className="space-y-6">
      {sections.map((section, idx) => (
        <div key={section.label}>
          {idx > 0 && <div className="border-t border-divider mb-6" />}
          <div className="font-display text-[15px] text-ink mb-1.5">
            {section.label}
          </div>
          <p className="text-[14px] text-muted leading-relaxed">
            {section.value.trim().length ? section.value : "—"}
          </p>
        </div>
      ))}
    </div>
  );
}
