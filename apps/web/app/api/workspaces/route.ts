import { randomUUID } from "node:crypto";
import { z } from "zod";
import { WorkspaceGovernanceSchema, WorkspaceMemberSchema, WorkspaceSchema, WorkspaceSelectionSchema, WorkspaceRoleSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { requireJsonContentType } from "../../../lib/api-errors";
import { getSeededRepository } from "../../../lib/server";

const WorkspaceNameSchema = z.string().trim().min(1).max(120);
const WorkspaceDescriptionSchema = z.string().trim().max(500).default("");
const WorkspaceSlugSchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const WorkspaceIdSchema = z.string().trim().min(1).max(200);
const UserIdSchema = z.string().trim().min(1).max(200);

const WorkspaceActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: WorkspaceNameSchema,
    slug: WorkspaceSlugSchema.optional(),
    description: WorkspaceDescriptionSchema.optional()
  }).strict(),
  z.object({
    action: z.literal("select"),
    workspaceId: WorkspaceIdSchema
  }).strict(),
  z.object({
    action: z.literal("add_member"),
    workspaceId: WorkspaceIdSchema,
    userId: UserIdSchema,
    role: WorkspaceRoleSchema
  }).strict()
]);

function slugifyWorkspaceName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 120);

  const slug = normalized || "workspace";
  return slug.replace(/^-+|-+$/g, "") || "workspace";
}

async function buildWorkspaceResponse(repository: Awaited<ReturnType<typeof getSeededRepository>>, userId: string) {
  const dashboard = await repository.getDashboardData(userId);

  return authenticatedJson({
    dashboard,
    workspaces: dashboard.workspaces,
    activeWorkspace: dashboard.activeWorkspace,
    workspaceSelection: dashboard.workspaceSelection,
    workspaceMembers: dashboard.workspaceMembers,
    workspaceGovernance: dashboard.workspaceGovernance
  });
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();

    return await buildWorkspaceResponse(repository, principal.userId);
  } catch (error) {
    return handleApiError(error, "Failed to load workspaces.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    const body = await parseJsonBody(request, WorkspaceActionSchema);

    if (body.action === "create") {
      const timestamp = nowIso();
      const workspace = WorkspaceSchema.parse({
        id: randomUUID(),
        ownerUserId: principal.userId,
        slug: body.slug ?? slugifyWorkspaceName(body.name),
        name: body.name,
        description: body.description ?? "",
        isPersonal: false,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const membership = WorkspaceMemberSchema.parse({
        id: randomUUID(),
        workspaceId: workspace.id,
        userId: principal.userId,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      });
      const selection = WorkspaceSelectionSchema.parse({
        userId: principal.userId,
        workspaceId: workspace.id,
        selectedAt: timestamp,
        updatedAt: timestamp
      });
      const governance = WorkspaceGovernanceSchema.parse({
        workspaceId: workspace.id,
        approvalMode: "risk_based",
        requireAuditExports: false,
        maxAutoRunRiskClass: "R1",
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        retentionDays: 365,
        updatedBy: principal.userId,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      await repository.saveWorkspace(workspace, principal.userId);
      await repository.saveWorkspaceMember(membership, principal.userId);
      await repository.saveWorkspaceSelection(selection);
      await repository.saveWorkspaceGovernance(governance, principal.userId);

      return await buildWorkspaceResponse(repository, principal.userId);
    }

    if (body.action === "select") {
      const timestamp = nowIso();
      await repository.saveWorkspaceSelection(
        WorkspaceSelectionSchema.parse({
          userId: principal.userId,
          workspaceId: body.workspaceId,
          selectedAt: timestamp,
          updatedAt: timestamp
        })
      );

      return await buildWorkspaceResponse(repository, principal.userId);
    }

    const memberUserId = body.userId.trim();

    if (!memberUserId) {
      throw new ApiRouteError(400, "Workspace member userId must not be empty.");
    }

    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: randomUUID(),
        workspaceId: body.workspaceId,
        userId: memberUserId,
        role: body.role,
        joinedAt: nowIso(),
        updatedAt: nowIso()
      }),
      principal.userId
    );

    return await buildWorkspaceResponse(repository, principal.userId);
  } catch (error) {
    return handleApiError(error, "Failed to update workspaces.");
  }
}
