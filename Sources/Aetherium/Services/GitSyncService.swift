import Foundation
import SwiftData

struct SyncResult {
    var pulled: Bool = false
    var pushed: Bool = false
    var conflict: Bool = false
    var error: String? = nil
}

@MainActor
final class GitSyncService {
    enum GitError: Error, LocalizedError {
        case executionFailed(String)
        
        var errorDescription: String? {
            switch self {
            case .executionFailed(let msg): return msg
            }
        }
    }

    /// Run a git command synchronously
    @discardableResult
    private func git(repoPath: URL, args: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = args
        process.currentDirectoryURL = repoPath

        let pipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = pipe
        process.standardError = errorPipe

        do {
            try process.run()
            process.waitUntilExit()
            
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            
            if process.terminationStatus == 0 {
                return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            } else {
                let errString = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Unknown Git Error"
                throw GitError.executionFailed("git \(args[Int(0)]): \(errString)")
            }
        } catch {
            throw GitError.executionFailed(error.localizedDescription)
        }
    }

    /// Ensure directory is a git repo with the given remote URL
    func ensureRepo(repoDir: URL, remoteUrl: String) throws {
        let gitDir = repoDir.appendingPathComponent(".git")
        if !FileManager.default.fileExists(atPath: gitDir.path) {
            try git(repoPath: repoDir, args: ["init"])
            try writeGitignore(repoDir: repoDir)
        }

        let remotes = (try? git(repoPath: repoDir, args: ["remote"])) ?? ""
        if remotes.contains("origin") {
            try git(repoPath: repoDir, args: ["remote", "set-url", "origin", remoteUrl])
        } else {
            try git(repoPath: repoDir, args: ["remote", "add", "origin", remoteUrl])
        }
    }

    private func writeGitignore(repoDir: URL) throws {
        let path = repoDir.appendingPathComponent(".gitignore")
        let content = "# Ignore vector index blobs and temp files\n*.tmp\nvector_index/\n"
        try content.write(to: path, atomically: true, encoding: .utf8)
    }

    /// Commit pending changes. Returns true if a new commit was made
    private func commitIfDirty(repoDir: URL) throws -> Bool {
        try git(repoPath: repoDir, args: ["add", "-A"])
        let status = try git(repoPath: repoDir, args: ["status", "--porcelain"])
        if status.isEmpty {
            return false
        }
        
        let ts = ISO8601DateFormatter().string(from: Date())
        try git(repoPath: repoDir, args: ["commit", "-m", "sync: \(ts)"])
        return true
    }

    /// Full sync cycle: pull --rebase, then push.
    func sync(repoDir: URL) -> SyncResult {
        var result = SyncResult()

        // Commit local changes
        do {
            _ = try commitIfDirty(repoDir: repoDir)
        } catch {
            result.error = error.localizedDescription
            return result
        }

        // Pull with rebase
        do {
            try git(repoPath: repoDir, args: ["pull", "--rebase", "origin", "main"])
            result.pulled = true
        } catch {
            let e = error.localizedDescription
            if e.contains("CONFLICT") || e.contains("conflict") {
                result.conflict = true
                result.error = "Rebase conflict — open a terminal and resolve manually in the data directory."
                return result
            } else if e.contains("couldn't find remote ref") || e.contains("does not appear to be a git") {
                // Remote likely has no commits yet - proceed to push
            } else {
                result.error = e
                return result
            }
        }

        // Push
        do {
            try git(repoPath: repoDir, args: ["push", "-u", "origin", "main"])
            result.pushed = true
        } catch {
            let e = error.localizedDescription
            if e.contains("src refspec main") || e.contains("does not match any") {
                do {
                    try git(repoPath: repoDir, args: ["push", "-u", "origin", "HEAD:main"])
                    result.pushed = true
                } catch {
                    result.error = error.localizedDescription
                }
            } else {
                result.error = e
            }
        }

        return result
    }
}
