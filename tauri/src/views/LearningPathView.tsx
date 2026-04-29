/**
 * LearningPathView — learning goals with progress tracking.
 * Mirrors LearningPathView.swift.
 */
import { useEffect, useState } from "react";
import { Plus, Check, Trash2, Target } from "lucide-react";
import { api, type LearningGoal } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

export default function LearningPathView() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDue, setNewDue] = useState("");

  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.learningGoal.list(activeWorkspaceId).then(setGoals).catch(() => {});
  }, [activeWorkspaceId]);

  async function createGoal() {
    if (!newTitle.trim() || !activeWorkspaceId) {return;}
    const goal = await api.learningGoal.create(activeWorkspaceId, newTitle.trim());
    setGoals((prev) => [goal, ...prev]);
    setNewTitle("");
    setNewDesc("");
    setNewDue("");
    setShowCreate(false);
  }

  async function toggleComplete(goal: LearningGoal) {
    await api.learningGoal.update(goal.id, {
      is_completed: !goal.is_completed,
      progress: goal.is_completed ? goal.progress : 1.0,
    });
    setGoals((prev) =>
      prev.map((g) =>
        g.id === goal.id ? { ...g, is_completed: !g.is_completed } : g
      )
    );
  }

  async function updateProgress(goal: LearningGoal, progress: number) {
    await api.learningGoal.update(goal.id, { progress });
    setGoals((prev) => prev.map((g) => g.id === goal.id ? { ...g, progress } : g));
  }

  async function deleteGoal(id: string) {
    await api.learningGoal.delete(id);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  const incomplete = goals.filter((g) => !g.is_completed);
  const complete = goals.filter((g) => g.is_completed);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Learning Goals</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90"
        >
          <Plus size={12} /> New Goal
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {!activeWorkspaceId && (
          <p className="text-[var(--text-muted)] text-sm">Select a workspace first.</p>
        )}

        {/* Active goals */}
        {incomplete.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
              In Progress ({incomplete.length})
            </h2>
            <div className="space-y-3">
              {incomplete.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  onToggle={() => toggleComplete(goal)}
                  onProgressChange={(p) => updateProgress(goal, p)}
                  onDelete={() => deleteGoal(goal.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Completed */}
        {complete.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
              Completed ({complete.length})
            </h2>
            <div className="space-y-3 opacity-60">
              {complete.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  onToggle={() => toggleComplete(goal)}
                  onProgressChange={(p) => updateProgress(goal, p)}
                  onDelete={() => deleteGoal(goal.id)}
                />
              ))}
            </div>
          </section>
        )}

        {goals.length === 0 && activeWorkspaceId && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Target size={32} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">No learning goals yet.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-[var(--accent-color)] text-white rounded-lg text-sm hover:opacity-90"
            >
              Create your first goal
            </button>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="w-96 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">New Learning Goal</h3>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") {createGoal();} if (e.key === "Escape") {setShowCreate(false);} }}
              placeholder="Goal title"
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none"
            />
            <input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-secondary)] outline-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                Cancel
              </button>
              <button onClick={createGoal} className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GoalCard({
  goal, onToggle, onProgressChange, onDelete,
}: {
  goal: LearningGoal;
  onToggle: () => void;
  onProgressChange: (p: number) => void;
  onDelete: () => void;
}) {
  return (
    <div className="group p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--accent-color)]/30 transition-colors">
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border transition-colors ${
            goal.is_completed
              ? "bg-green-500 border-green-500"
              : "border-[var(--border-color)] hover:border-[var(--accent-color)]"
          }`}
        >
          {goal.is_completed && <Check size={10} className="text-white m-auto" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm text-[var(--text-primary)] ${goal.is_completed ? "line-through opacity-60" : ""}`}>
            {goal.title}
          </p>
          {goal.goal_description && (
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{goal.goal_description}</p>
          )}
          {goal.due_date && (
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Due: {new Date(goal.due_date).toLocaleDateString()}
            </p>
          )}
          {/* Progress bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent-color)] transition-all"
                style={{ width: `${(goal.progress ?? 0) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-[var(--text-muted)] w-8 text-right">
              {Math.round((goal.progress ?? 0) * 100)}%
            </span>
          </div>
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round((goal.progress ?? 0) * 100)}
            onChange={(e) => onProgressChange(Number(e.target.value) / 100)}
            className="w-full mt-1 accent-[var(--accent-color)] h-0.5"
          />
        </div>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-red-400 text-[var(--text-muted)] transition-all"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
