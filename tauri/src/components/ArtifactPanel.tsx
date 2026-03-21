import React, { useState } from 'react';
import { useArtifactStore } from '../stores/artifactStore';
import { 
  X, Pin, PinOff, Copy, Check, Trash2, 
  History, Code, FileText, Settings, Share,
  ChevronLeft, ChevronRight
} from 'lucide-react';

export default function ArtifactPanel() {
  const { 
    isPanelOpen, setPanelOpen, activeArtifact, setActiveArtifact,
    deleteArtifact, togglePin 
  } = useArtifactStore();
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (!isPanelOpen || !activeArtifact) {
    return null;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(activeArtifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this artifact?')) {
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
          <button 
            onClick={() => togglePin(activeArtifact.id)}
            className={`p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${activeArtifact.is_pinned ? 'text-blue-600' : 'text-zinc-400'}`}
            title={activeArtifact.is_pinned ? 'Unpin' : 'Pin'}
          >
            {activeArtifact.is_pinned ? <Pin size={18} /> : <PinOff size={18} />}
          </button>
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className={`p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${showHistory ? 'text-blue-600' : 'text-zinc-400'}`}
            title="Version History"
          >
            <History size={18} />
          </button>
          <button 
            onClick={handleDelete}
            className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-400 hover:text-red-600"
            title="Delete"
          >
            <Trash2 size={18} />
          </button>
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
            {/* History list would go here */}
            <p className="text-sm text-zinc-500 italic">Version history coming soon...</p>
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
          <span>{new Date(activeArtifact.updated_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
