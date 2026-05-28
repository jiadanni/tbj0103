import React, { useState, useEffect } from 'react';
import { confirm } from "@tauri-apps/plugin-dialog";
import { useArtifactStore } from '../stores/artifactStore';
import { api } from '../lib/api';
import type { ArtifactSummary } from '../lib/api';
import { 
  X, Pin, PinOff, Copy, Check, Trash2, 
  History, Code, FileText
} from 'lucide-react';
import { Tooltip } from './Tooltip';

const VERSION_DATETIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'short',
});
const FOOTER_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' });

export default function ArtifactPanel() {
  const { 
    isPanelOpen, setPanelOpen, activeArtifact,
    deleteArtifact, togglePin, loadArtifact
  } = useArtifactStore();
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<ArtifactSummary[]>([]);

  useEffect(() => {
    if (showHistory && activeArtifact) {
      api.artifact.versions(activeArtifact.id).then(setVersions).catch(console.error);
    }
  }, [showHistory, activeArtifact]);

  if (!isPanelOpen || !activeArtifact) {
    return null;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(activeArtifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (await confirm("Are you sure you want to delete this artifact?", {
      title: "Delete artifact?",
      kind: "warning",
    })) {
      await deleteArtifact(activeArtifact.id);
      setPanelOpen(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[500px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
            {activeArtifact.artifact_type === 'code' ? <Code size={18} /> : <FileText size={18} />}
          </div>
          <div className="overflow-hidden">
            <h3 className="font-semibold truncate text-zinc-900 dark:text-zinc-100">{activeArtifact.title}</h3>
            <p className="text-xs text-zinc-500 truncate">v{activeArtifact.version} • {activeArtifact.language}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <Tooltip content={activeArtifact.is_pinned ? 'Unpin' : 'Pin'} position="bottom">
            <button 
              onClick={() => togglePin(activeArtifact.id)}
              className={`p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${activeArtifact.is_pinned ? 'text-blue-600' : 'text-zinc-400'}`}
            >
              {activeArtifact.is_pinned ? <Pin size={18} /> : <PinOff size={18} />}
            </button>
          </Tooltip>
          <Tooltip content="Version History" position="bottom">
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${showHistory ? 'text-blue-600' : 'text-zinc-400'}`}
            >
              <History size={18} />
            </button>
          </Tooltip>
          <Tooltip content="Delete" position="bottom">
            <button 
              onClick={handleDelete}
              className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-400 hover:text-red-600"
            >
              <Trash2 size={18} />
            </button>
          </Tooltip>
          <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <button 
            onClick={() => setPanelOpen(false)}
            className="p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-0 relative">
        {showHistory ? (
          <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 h-full">
            <h4 className="text-sm font-medium mb-4 text-zinc-700 dark:text-zinc-300">Version History</h4>
            <div className="space-y-2">
              {versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    loadArtifact(v.id);
                    setShowHistory(false);
                  }}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    v.id === activeArtifact.id
                      ? 'bg-white dark:bg-zinc-800 border-blue-500 shadow-sm'
                      : 'bg-white/50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase">Version {v.version}</span>
                    <span className="text-[10px] text-zinc-400">{VERSION_DATETIME_FORMATTER.format(new Date(v.updated_at))}</span>
                  </div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{v.title}</p>
                  <p className="text-xs text-zinc-500 truncate">{v.artifact_type} • {v.language}</p>
                </button>
              ))}
              {versions.length === 0 && (
                <p className="text-sm text-zinc-500 italic text-center py-8">No other versions found.</p>
              )}
            </div>
          </div>
        ) : (
          <pre className="p-4 font-mono text-sm whitespace-pre-wrap break-all text-zinc-800 dark:text-zinc-200 selection:bg-blue-100 dark:selection:bg-blue-900">
            <code>{activeArtifact.content}</code>
          </pre>
        )}
      </div>

      {/* Footer / Actions */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/80">
        <div className="flex items-center gap-2">
          <button 
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-md text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Content'}
          </button>
        </div>
        
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>{activeArtifact.token_count} tokens</span>
          <span>{FOOTER_DATE_FORMATTER.format(new Date(activeArtifact.updated_at))}</span>
        </div>
      </div>
    </div>
  );
}
