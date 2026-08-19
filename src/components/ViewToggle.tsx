export type WorkflowTab = "plan" | "build" | "review";
export type BuildView = "chat" | "canvas";

// Sub-tabs only exist under Build for now (Chat/Canvas) — Plan and Review
// are placeholders until they get real content of their own. The two-level
// shape (workflow tab + a per-tab sub-tab row) is kept generic on purpose so
// adding Plan's or Review's own sub-tabs later doesn't need restructuring.
export function ViewToggle({
  workflowTab,
  onWorkflowTabChange,
  buildView,
  onBuildViewChange,
}: {
  workflowTab: WorkflowTab;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
  buildView: BuildView;
  onBuildViewChange: (view: BuildView) => void;
}) {
  return (
    <div className="view-toggle-group">
      <div className="view-toggle">
        <button disabled title="Not yet available">
          Plan
        </button>
        <button className={workflowTab === "build" ? "active" : ""} onClick={() => onWorkflowTabChange("build")}>
          Build
        </button>
        <button disabled title="Not yet available">
          Review
        </button>
      </div>
      {workflowTab === "build" && (
        <div className="view-toggle view-toggle-sub">
          <button className={buildView === "chat" ? "active" : ""} onClick={() => onBuildViewChange("chat")}>
            Chat
          </button>
          <button className={buildView === "canvas" ? "active" : ""} onClick={() => onBuildViewChange("canvas")}>
            Canvas
          </button>
        </div>
      )}
    </div>
  );
}
