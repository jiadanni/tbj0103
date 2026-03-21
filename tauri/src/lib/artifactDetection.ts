/**
 * Detects potential artifacts in markdown content from the assistant.
 */

export type ArtifactType = 'code' | 'document' | 'diagram' | 'config' | 'data' | 'other';

export interface DetectedArtifact {
  title: string;
  artifact_type: ArtifactType;
  language: string;
  content: string;
  description: string;
}

const LANGUAGE_TO_TYPE: Record<string, ArtifactType> = {
  // Diagrams
  'mermaid': 'diagram',
  'plantuml': 'diagram',
  'dot': 'diagram',
  'graphviz': 'diagram',
  
  // Config
  'json': 'config',
  'yaml': 'config',
  'yml': 'config',
  'toml': 'config',
  'xml': 'config',
  
  // Data
  'csv': 'data',
  'sql': 'data',
};

export function detectArtifacts(content: string): DetectedArtifact[] {
  const artifacts: DetectedArtifact[] = [];

  // 1. Detect Fenced Code Blocks
  // Regex for triple-backtick blocks: ```lang\ncontent\n```
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const lang = match[1] || '';
    const code = match[2].trim();
    
    // Rule: Fenced code block >= 5 lines or specific types
    const lineCount = code.split('\n').length;
    const artifactType = LANGUAGE_TO_TYPE[lang.toLowerCase()] || 'code';
    
    if (lineCount >= 5 || artifactType === 'diagram' || artifactType === 'config' || artifactType === 'data') {
      // Heuristic for title: Look for comments or first line
      let title = `New ${artifactType === 'code' ? (lang || 'Code') : artifactType}`;
      
      // Try to find a filename in the first line if it's a comment
      const firstLine = code.split('\n')[0].trim();
      if (firstLine.startsWith('// ') || firstLine.startsWith('# ') || firstLine.startsWith('/* ')) {
        const potentialTitle = firstLine.replace(/[\/#\*]/g, '').trim();
        if (potentialTitle && potentialTitle.length < 50) {
          title = potentialTitle;
        }
      }

      artifacts.push({
        title,
        artifact_type: artifactType,
        language: lang,
        content: code,
        description: `Generated ${lang} snippet`,
      });
    }
  }

  // 2. Detect Large Prose Blocks (Document)
  // Look for paragraphs or sections that are significantly long (>= 500 chars)
  // and NOT already part of a code block.
  // This is a bit more complex with regex, so we'll start with code blocks as MVP.

  return artifacts;
}
