import React, { useState } from "react";
import { X, Plus, Eye, Zap, AlertCircle } from "lucide-react";
import type { TopicSignature, TopicTag } from "../lib/api";
import { api } from "../lib/api";

interface TopicsSectionProps {
  workspaceId: string;
  topicSignature: TopicSignature | null;
  onUpdate: (updated: TopicSignature) => void;
}

export const TopicsSection: React.FC<TopicsSectionProps> = ({
  workspaceId,
  topicSignature,
  onUpdate,
}) => {
  const [newManualTag, setNewManualTag] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!topicSignature) {
    return (
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
          <AlertCircle size={16} />
          No topics generated yet. Regenerate workspace signature to analyze topics.
        </div>
      </div>
    );
  }

  const handleRemoveTopic = async (tag: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSig = await api.topicSignature.update(
        workspaceId,
        topicSignature.manual_tags,
        [...topicSignature.ignored_tags, tag]
      );
      onUpdate(updatedSig);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove topic");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddManualTag = async () => {
    if (!newManualTag.trim()) { return; }

    setIsLoading(true);
    setError(null);
    try {
      const newTag = newManualTag.trim().toLowerCase();
      // Check if already exists
      if (
        topicSignature.manual_tags.includes(newTag) ||
        topicSignature.ignored_tags.includes(newTag) ||
        topicSignature.domain_tags.some((t) => t.tag === newTag)
      ) {
        setError("This topic already exists");
        setIsLoading(false);
        return;
      }

      const updatedSig = await api.topicSignature.update(
        workspaceId,
        [...topicSignature.manual_tags, newTag],
        topicSignature.ignored_tags
      );
      onUpdate(updatedSig);
      setNewManualTag("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add topic");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnignoreTopic = async (tag: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const updatedSig = await api.topicSignature.update(
        workspaceId,
        topicSignature.manual_tags,
        topicSignature.ignored_tags.filter((t) => t !== tag)
      );
      onUpdate(updatedSig);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unignore topic");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Domain Tags (Auto-detected) */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={16} className="text-[var(--accent-color)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Auto-Detected Topics ({topicSignature.domain_tags.length})
          </h3>
        </div>
        {topicSignature.domain_tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {topicSignature.domain_tags.map((tag: TopicTag) => (
              <div
                key={tag.tag}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
                title={`Weight: ${tag.weight.toFixed(2)} (${tag.source})`}
              >
                <span>{tag.tag}</span>
                <button
                  onClick={() => handleRemoveTopic(tag.tag)}
                  disabled={isLoading}
                  className="ml-1 rounded hover:bg-[var(--bg-hover)] p-0.5 transition-colors disabled:opacity-50"
                  title="Blacklist this topic (prevents it from appearing again)"
                  aria-label={`Remove ${tag.tag}`}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No topics detected yet</p>
        )}
      </div>

      {/* Manual Tags (User-added) */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={16} className="text-[var(--accent-color)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Custom Topics ({topicSignature.manual_tags.length})
          </h3>
        </div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add a custom topic (e.g., 'machine-learning')"
              value={newManualTag}
              onChange={(e) => {
                setNewManualTag(e.target.value);
                setError(null);
              }}
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  handleAddManualTag();
                }
              }}
              disabled={isLoading}
              className="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-color)] focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleAddManualTag}
              disabled={isLoading || !newManualTag.trim()}
              className="rounded border border-[var(--border-color)] bg-[var(--bg-hover)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--accent-color)]/10 hover:border-[var(--accent-color)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
          {topicSignature.manual_tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {topicSignature.manual_tags.map((tag: string) => (
                <div
                  key={tag}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-color)] bg-[var(--accent-color)]/10 px-3 py-1.5 text-xs font-medium text-[var(--accent-color)]"
                >
                  <span>{tag}</span>
                  <button
                    onClick={() =>
                      handleRemoveTopic(tag)
                    }
                    disabled={isLoading}
                    className="ml-1 rounded hover:bg-[var(--accent-color)]/20 p-0.5 transition-colors disabled:opacity-50"
                    title="Remove this custom topic"
                    aria-label={`Remove ${tag}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No custom topics added</p>
          )}
        </div>
      </div>

      {/* Ignored Tags (Blacklisted) */}
      {topicSignature.ignored_tags.length > 0 && (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye size={16} className="text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Blacklisted Topics ({topicSignature.ignored_tags.length})
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {topicSignature.ignored_tags.map((tag: string) => (
              <div
                key={tag}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] opacity-60"
                title="This topic is blacklisted and will not appear in suggestions"
              >
                <span>{tag}</span>
                <button
                  onClick={() => handleUnignoreTopic(tag)}
                  disabled={isLoading}
                  className="ml-1 rounded hover:bg-[var(--bg-hover)] p-0.5 transition-colors disabled:opacity-50"
                  title="Un-blacklist this topic"
                  aria-label={`Restore ${tag}`}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Info text */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)]/50 p-3 text-xs text-[var(--text-muted)]">
        <p className="leading-relaxed">
          <strong>Auto-Detected Topics</strong> are extracted from your notes and chats. Click the <span className="text-red-500">✕</span> to blacklist them.
        </p>
        <p className="mt-2 leading-relaxed">
          <strong>Custom Topics</strong> are ones you add manually to ensure they appear in suggestions.
        </p>
        <p className="mt-2 leading-relaxed">
          <strong>Blacklisted Topics</strong> won&apos;t appear in future topic regenerations. Click to restore them.
        </p>
      </div>
    </div>
  );
};
