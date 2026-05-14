import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import GlobalBackupSection from '../GlobalBackupSection';

// Mock the API
vi.mock('../../lib/api', () => ({
  api: {
    backup: {
      createGlobal: vi.fn(),
      restoreGlobal: vi.fn(),
    },
    workspace: {
      list: vi.fn(),
    },
    project: {
      list: vi.fn(),
    },
  },
}));

// Mock Tauri plugins
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
  confirm: vi.fn(),
  message: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
}));

// Mock workspace store
vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: () => ({
    setWorkspaces: vi.fn(),
    setActiveWorkspaceId: vi.fn(),
    setFoldersForWorkspace: vi.fn(),
  }),
}));

describe('GlobalBackupSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders global backup section', () => {
    render(<GlobalBackupSection />);
    expect(screen.getByText('Global Backup')).toBeInTheDocument();
    expect(screen.getByText(/Save Backup/)).toBeInTheDocument();
    expect(screen.getByText(/Open Backup/)).toBeInTheDocument();
  });

  it('displays create backup section with description', () => {
    render(<GlobalBackupSection />);
    expect(screen.getByText(/Save all workspaces/)).toBeInTheDocument();
  });

  it('displays restore backup section with description', () => {
    render(<GlobalBackupSection />);
    expect(screen.getByText(/Open an Aetherium global backup file/)).toBeInTheDocument();
  });
});
