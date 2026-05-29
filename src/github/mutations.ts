import type { BatchResult } from '../domain/batch'
import type { PermissionLevel } from '../domain/permissions'

interface BatchMutationClient {
  setTeamRepoPermission: (
    teamSlug: string,
    repoName: string,
    permission: PermissionLevel,
  ) => Promise<void>
  removeTeamRepoPermission: (teamSlug: string, repoName: string) => Promise<void>
  setUserRepoPermission: (
    repoName: string,
    userLogin: string,
    permission: PermissionLevel,
  ) => Promise<void>
  removeUserRepoPermission: (repoName: string, userLogin: string) => Promise<void>
}

export interface BatchMutationRequest {
  subject:
    | { kind: 'team'; key: string }
    | { kind: 'user'; key: string }
  repoNames: string[]
  target: PermissionLevel
}

export async function executePermissionBatch(
  client: BatchMutationClient,
  request: BatchMutationRequest,
): Promise<BatchResult[]> {
  const results: BatchResult[] = []

  for (const repoName of request.repoNames) {
    try {
      if (request.subject.kind === 'team') {
        if (request.target === 'none') {
          await client.removeTeamRepoPermission(request.subject.key, repoName)
        } else {
          await client.setTeamRepoPermission(request.subject.key, repoName, request.target)
        }
      } else if (request.target === 'none') {
        await client.removeUserRepoPermission(repoName, request.subject.key)
      } else {
        await client.setUserRepoPermission(repoName, request.subject.key, request.target)
      }

      results.push({
        repo: repoName,
        success: true,
      })
    } catch (error) {
      results.push({
        repo: repoName,
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      })
    }
  }

  return results
}
