// A small "?" badge that shows an explanatory tooltip on hover -- used next
// to action headers (e.g. "bTKN + SOL -> LP") so the mechanics/fine-print
// text doesn't have to sit as a permanent paragraph taking up space.
export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="info-tip">
      ?<span className="info-tip-bubble">{text}</span>
    </span>
  );
}
