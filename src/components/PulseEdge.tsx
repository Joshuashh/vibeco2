import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function PulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const active = Boolean((data as { active?: boolean } | undefined)?.active);

  return (
    <>
      <BaseEdge id={id} path={path} className={active ? "stroke-accent stroke-1" : "stroke-border stroke-1"} />
      {active && (
        <circle r="3" className="fill-accent">
          <animateMotion dur="1.2s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
}
