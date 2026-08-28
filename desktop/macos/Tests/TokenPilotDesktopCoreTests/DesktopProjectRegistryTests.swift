import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop Project Registry")
struct DesktopProjectRegistryTests {
    @Test("ProjectRoot identity stays distinct from execution workspace")
    func projectRootAndWorkspaceAreDistinct() throws {
        let json = """
        {
          "ok": true,
          "initialized": true,
          "configRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "projects": [
            {
              "project": {
                "id": "project_alpha",
                "slug": "alpha",
                "displayName": "Alpha",
                "defaultWorkspaceId": "workspace_alpha",
                "status": "active"
              },
              "workspaces": [
                {
                  "id": "workspace_alpha",
                  "projectId": "project_alpha",
                  "repoId": "alpha",
                  "kind": "checkout",
                  "privatePath": "/tmp/alpha",
                  "branch": "main",
                  "headCommit": "0123456789abcdef",
                  "dirty": false,
                  "status": "ready"
                }
              ],
              "roots": [
                {
                  "id": "root_source",
                  "projectId": "project_alpha",
                  "kind": "git-repository",
                  "role": "primary-source",
                  "access": "read-write",
                  "status": "ready",
                  "primary": false,
                  "pathVisibility": "machine-local-owner",
                  "privatePath": "/tmp/alpha",
                  "executionWorkspaceIds": ["workspace_alpha"]
                },
                {
                  "id": "root_docs",
                  "projectId": "project_alpha",
                  "kind": "directory",
                  "role": "documentation",
                  "access": "read-only",
                  "status": "ready",
                  "primary": true,
                  "pathVisibility": "machine-local-owner",
                  "privatePath": "/tmp/alpha-docs",
                  "executionWorkspaceIds": []
                }
              ]
            }
          ]
        }
        """

        let snapshot = try JSONDecoder().decode(
            DesktopProjectRegistrySnapshot.self,
            from: Data(json.utf8)
        )
        let project = try #require(snapshot.projects.first)

        #expect(snapshot.initialized)
        #expect(project.primaryRoot?.id == "root_docs")
        #expect(project.primaryRoot?.kind == .directory)
        #expect(project.primaryRoot?.role == .documentation)
        #expect(project.primaryRoot?.access == .readOnly)
        #expect(project.primaryRoot?.privatePath == "/tmp/alpha-docs")
        #expect(project.defaultWorkspace?.id == "workspace_alpha")
        #expect(project.defaultWorkspace?.repoId == "alpha")
        #expect(project.defaultWorkspace?.privatePath == "/tmp/alpha")
        #expect(project.defaultWorkspace?.url.path == "/tmp/alpha")
        #expect(project.primaryRoot?.executionWorkspaceIds.isEmpty == true)
    }

    @Test("directory primary root may have no execution workspace")
    func directoryPrimaryMayHaveNoWorkspace() throws {
        let project = DesktopProjectRegistryProject(
            project: DesktopProjectRecord(
                id: "project_docs",
                slug: "docs",
                displayName: "Docs",
                defaultWorkspaceId: nil,
                status: "active"
            ),
            workspaces: [],
            roots: [
                DesktopProjectRoot(
                    id: "root_docs",
                    projectId: "project_docs",
                    kind: .directory,
                    role: .documentation,
                    access: .readOnly,
                    status: "ready",
                    primary: true,
                    pathVisibility: "machine-local-owner",
                    privatePath: "/tmp/docs",
                    executionWorkspaceIds: []
                )
            ]
        )

        #expect(project.primaryRoot?.id == "root_docs")
        #expect(project.defaultWorkspace == nil)
    }

    @Test("selected project preference is independent from workspace preference")
    func projectPreferenceIsIndependent() throws {
        let suiteName = "chatcockpit-project-preference-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let projectStore = UserDefaultsProjectPreferenceStore(defaults: defaults)
        let workspaceStore = UserDefaultsWorkspacePreferenceStore(defaults: defaults)
        let workspace = URL(fileURLWithPath: "/tmp/alpha", isDirectory: true)

        projectStore.saveProjectID("project_alpha")
        workspaceStore.saveWorkspaceURL(workspace)

        #expect(projectStore.loadProjectID() == "project_alpha")
        #expect(workspaceStore.loadWorkspaceURL() == workspace.standardizedFileURL)

        projectStore.saveProjectID(nil)
        #expect(projectStore.loadProjectID() == nil)
        #expect(workspaceStore.loadWorkspaceURL() == workspace.standardizedFileURL)
    }

    @Test("folder classification derives stable project identity and keeps roots provider-neutral")
    func folderClassification() throws {
        let root = URL(fileURLWithPath: "/tmp/My Project", isDirectory: true)
        let marker = root.appendingPathComponent(".git", isDirectory: false)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: marker.path, contents: Data())
        defer { try? FileManager.default.removeItem(at: root) }

        let classification = DesktopProjectFolderClassifier.classify(
            root,
            existingSlugs: ["my-project"],
            existingRepoIDs: ["my-project", "my-project-2"]
        )

        #expect(classification.kind == .gitRepository)
        #expect(classification.displayName == "My Project")
        #expect(classification.slug == "my-project-2")
        #expect(classification.repoID == "my-project-3")
    }
}
